from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from io import BytesIO
from typing import List
from urllib.error import URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI
from PIL import Image

from .models import ValidateRequest, ValidateResponse, ValidationChecks, ValidationMetrics
from .pose import assess_pose
from .quality import estimate_quality


@dataclass
class Settings:
    # Default thresholds mirror the Node service config defaults. Production can
    # tighten these via env vars.
    min_width: int = int(os.getenv("FULLBODY_MIN_WIDTH", "512"))
    min_height: int = int(os.getenv("FULLBODY_MIN_HEIGHT", "900"))
    min_aspect_ratio: float = float(os.getenv("FULLBODY_MIN_ASPECT_RATIO", "1.3"))
    min_blur_score: float = float(os.getenv("FULLBODY_MIN_BLUR_SCORE", "10.0"))
    min_brightness: float = float(os.getenv("FULLBODY_MIN_BRIGHTNESS", "0.12"))
    # Note: these defaults are tuned to accept typical head-to-toe phone captures.
    # Tighten in production if you see false-accepts.
    min_body_coverage: float = float(os.getenv("FULLBODY_MIN_BODY_COVERAGE", "0.70"))
    min_frontal_score: float = float(os.getenv("FULLBODY_MIN_FRONTAL_SCORE", "0.45"))
    min_landmark_confidence: float = float(os.getenv("FULLBODY_MIN_LANDMARK_CONFIDENCE", "0.55"))


settings = Settings()
app = FastAPI(title="fullbody-validator", version="0.1.0")


def _decode_base64_image(payload: str) -> bytes:
    raw = payload
    if "," in payload and payload.strip().startswith("data:image"):
        raw = payload.split(",", 1)[1]
    return base64.b64decode(raw)


def _fetch_url_image(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": "fashion-fullbody-validator/1.0"})
    with urlopen(req, timeout=15) as response:
        return response.read()


def _load_image(request: ValidateRequest) -> Image.Image:
    data: bytes
    if request.imageBase64:
        data = _decode_base64_image(request.imageBase64)
    elif request.imageUrl:
        data = _fetch_url_image(request.imageUrl)
    else:
        raise ValueError("missing_image_payload")
    return Image.open(BytesIO(data)).convert("RGB")


def _fail_response(reasons: List[str]) -> ValidateResponse:
    return ValidateResponse(
        approved=False,
        reasons=reasons,
        metrics=ValidationMetrics(
            width=0,
            height=0,
            aspectRatio=0.0,
            blurScore=0.0,
            brightness=0.0,
            bodyCoverage=0.0,
            frontalScore=0.0,
            landmarkConfidence=0.0,
        ),
        checks=ValidationChecks(feetVisible=False, frontFacing=False),
    )


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "service": "fullbody-validator",
        "version": "0.1.0",
    }


@app.post("/validate", response_model=ValidateResponse)
def validate(request: ValidateRequest) -> ValidateResponse:
    try:
        image = _load_image(request)
    except (ValueError, URLError, OSError, base64.binascii.Error):
        return _fail_response(["no_person_detected"])

    quality = estimate_quality(image)
    pose = assess_pose(image)

    require_feet_visible = bool(request.checks.get("requireFeetVisible", True))
    front_facing = pose.frontal_score >= settings.min_frontal_score

    reasons: List[str] = []
    if pose.people_count == 0:
        return ValidateResponse(
            approved=False,
            reasons=["no_person_detected"],
            metrics=ValidationMetrics(
                width=quality.width,
                height=quality.height,
                aspectRatio=quality.aspect_ratio,
                blurScore=quality.blur_score,
                brightness=quality.brightness,
                bodyCoverage=0.0,
                frontalScore=0.0,
                landmarkConfidence=0.0,
            ),
            checks=ValidationChecks(feetVisible=False, frontFacing=False),
        )

    if quality.width < settings.min_width or quality.height < settings.min_height:
        reasons.append("image_too_small")
    if quality.aspect_ratio < settings.min_aspect_ratio:
        reasons.append("not_head_to_toe_likely")
    if quality.blur_score < settings.min_blur_score:
        reasons.append("too_blurry")
    if quality.brightness < settings.min_brightness:
        reasons.append("too_dark")

    if pose.people_count > 1:
        reasons.append("multiple_people_detected")

    if pose.body_coverage < settings.min_body_coverage:
        reasons.append("not_head_to_toe_likely")

    if not front_facing:
        reasons.append("not_front_facing")
    if require_feet_visible and not pose.feet_visible:
        reasons.append("feet_missing")
    if not pose.head_visible:
        reasons.append("head_missing")
    if pose.landmark_confidence < settings.min_landmark_confidence:
        reasons.append("body_landmarks_low_confidence")

    # Preserve order while dropping duplicates.
    unique_reasons: List[str] = []
    seen = set()
    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            unique_reasons.append(reason)

    return ValidateResponse(
        approved=len(unique_reasons) == 0,
        reasons=unique_reasons,
        metrics=ValidationMetrics(
            width=quality.width,
            height=quality.height,
            aspectRatio=quality.aspect_ratio,
            blurScore=quality.blur_score,
            brightness=quality.brightness,
            bodyCoverage=pose.body_coverage,
            frontalScore=pose.frontal_score,
            landmarkConfidence=pose.landmark_confidence,
        ),
        checks=ValidationChecks(
            feetVisible=pose.feet_visible,
            frontFacing=front_facing,
        ),
    )
