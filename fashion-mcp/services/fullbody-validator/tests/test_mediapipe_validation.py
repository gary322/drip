import base64
import os
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


client = TestClient(app)


def _fixture_path(name: str) -> Path:
    return Path(__file__).resolve().parent / "fixtures" / name


def _b64_from_bytes(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64_from_image(img: Image.Image, fmt: str = "JPEG") -> str:
    buf = BytesIO()
    img.save(buf, format=fmt)
    return _b64_from_bytes(buf.getvalue())


def test_validate_accepts_fullbody_fixture() -> None:
    # Ensure we exercise the strict backend.
    os.environ["FULLBODY_POSE_BACKEND"] = "mediapipe"

    data = _fixture_path("fullbody.jpg").read_bytes()
    response = client.post(
        "/validate",
        json={
            "imageBase64": _b64_from_bytes(data),
            "mimeType": "image/jpeg",
            "checks": {"requireFeetVisible": True},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["approved"] is True, payload
    assert payload["reasons"] == []
    assert payload["checks"]["feetVisible"] is True
    assert payload["checks"]["frontFacing"] is True


def test_validate_rejects_padded_headshot_even_if_dimensions_match() -> None:
    # Ensure we exercise the strict backend.
    os.environ["FULLBODY_POSE_BACKEND"] = "mediapipe"

    headshot = Image.open(_fixture_path("headshot.jpg")).convert("RGB")
    # Pad to a typical portrait size so simple dimension/aspect heuristics would pass.
    canvas = Image.new("RGB", (900, 1350), color=(255, 255, 255))
    canvas.paste(headshot, (0, 0))

    response = client.post(
        "/validate",
        json={
            "imageBase64": _b64_from_image(canvas, fmt="JPEG"),
            "mimeType": "image/jpeg",
            "checks": {"requireFeetVisible": True},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["approved"] is False, payload
    # Key assertion: strict validator must reject for missing feet / non head-to-toe framing.
    assert "feet_missing" in payload["reasons"] or "not_head_to_toe_likely" in payload["reasons"], payload

