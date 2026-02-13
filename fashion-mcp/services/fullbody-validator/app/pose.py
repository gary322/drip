from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Optional

import numpy as np
from PIL import Image


@dataclass
class PoseAssessment:
    body_coverage: float
    frontal_score: float
    landmark_confidence: float
    feet_visible: bool
    front_facing: bool
    head_visible: bool
    people_count: int


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _assess_pose_heuristic(image: Image.Image) -> PoseAssessment:
    """
    Heuristic pose assessment.

    This is a fallback for local/dev usage. Production should use a landmark
    model backend (MediaPipe/OpenPose/etc.).
    """
    width, height = image.size
    aspect_ratio = float(height) / max(width, 1)

    # Tall portrait framing correlates with head-to-toe, but does not prove it.
    body_coverage = _clamp((aspect_ratio - 1.0) / 0.9, 0.0, 1.0)
    feet_visible = aspect_ratio >= 1.45
    head_visible = height >= 900

    # Front-facing proxy: very extreme narrow/wide ratios are usually side/cropped.
    front_facing = 0.42 <= (width / max(height, 1)) <= 0.85
    frontal_score = 0.75 if front_facing else 0.35

    # Confidence proxy: prefer taller frames with enough pixels.
    landmark_confidence = _clamp((body_coverage * 0.7) + (0.3 if head_visible else 0.0), 0.0, 1.0)

    return PoseAssessment(
        body_coverage=body_coverage,
        frontal_score=frontal_score,
        landmark_confidence=landmark_confidence,
        feet_visible=feet_visible,
        front_facing=front_facing,
        head_visible=head_visible,
        people_count=1,
    )


_mp_ok: bool = False
_mp_import_error: Optional[str] = None
_mp_pose = None
_mp_face = None
_pose_lock = threading.Lock()
_face_lock = threading.Lock()


def _init_mediapipe() -> None:
    global _mp_ok, _mp_import_error, _mp_pose, _mp_face
    if _mp_ok or _mp_import_error is not None:
        return

    try:
        import mediapipe as mp  # type: ignore

        # Pose: single-person landmarks.
        _mp_pose = mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=2,
            enable_segmentation=False,
            min_detection_confidence=0.5,
        )

        # Face detection: helps reject group photos.
        _mp_face = mp.solutions.face_detection.FaceDetection(
            model_selection=1,
            min_detection_confidence=0.5,
        )

        _mp_ok = True
    except Exception as exc:  # pragma: no cover
        _mp_import_error = str(exc)
        _mp_ok = False


def _mediapipe_face_count(rgb: np.ndarray) -> int:
    _init_mediapipe()
    if not _mp_ok or _mp_face is None:
        return 0

    with _face_lock:
        result = _mp_face.process(rgb)
    detections = getattr(result, "detections", None)
    if not detections:
        return 0
    try:
        return int(len(detections))
    except Exception:
        return 0


def _assess_pose_mediapipe(image: Image.Image) -> PoseAssessment:
    _init_mediapipe()
    if not _mp_ok or _mp_pose is None:
        # If strict backend requested but unavailable, fail closed.
        return PoseAssessment(
            body_coverage=0.0,
            frontal_score=0.0,
            landmark_confidence=0.0,
            feet_visible=False,
            front_facing=False,
            head_visible=False,
            people_count=0,
        )

    rgb = np.asarray(image.convert("RGB"))
    face_count = _mediapipe_face_count(rgb)

    with _pose_lock:
        result = _mp_pose.process(rgb)
    pose_landmarks = getattr(result, "pose_landmarks", None)
    if not pose_landmarks or not getattr(pose_landmarks, "landmark", None):
        # If we saw a face but no pose, treat as a person present but invalid for full-body.
        people_count = face_count if face_count >= 2 else (1 if face_count == 1 else 0)
        return PoseAssessment(
            body_coverage=0.0,
            frontal_score=0.0,
            landmark_confidence=0.0,
            feet_visible=False,
            front_facing=False,
            head_visible=False,
            people_count=people_count,
        )

    landmarks = list(pose_landmarks.landmark)

    def vis(idx: int) -> float:
        try:
            value = getattr(landmarks[idx], "visibility", 0.0)
            return float(value) if value is not None else 0.0
        except Exception:
            return 0.0

    def xy(idx: int) -> tuple[float, float]:
        try:
            lm = landmarks[idx]
            return float(lm.x), float(lm.y)
        except Exception:
            return 0.0, 0.0

    def z(idx: int) -> float:
        try:
            value = getattr(landmarks[idx], "z", 0.0)
            return float(value) if value is not None else 0.0
        except Exception:
            return 0.0

    # Landmark indices follow MediaPipe Pose (33 landmarks).
    NOSE = 0
    LEFT_EYE = 2
    RIGHT_EYE = 5
    LEFT_EAR = 7
    RIGHT_EAR = 8
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28
    LEFT_HEEL = 29
    RIGHT_HEEL = 30
    LEFT_FOOT_INDEX = 31
    RIGHT_FOOT_INDEX = 32

    head_idxs = [NOSE, LEFT_EYE, RIGHT_EYE, LEFT_EAR, RIGHT_EAR]
    feet_idxs = [LEFT_ANKLE, RIGHT_ANKLE, LEFT_HEEL, RIGHT_HEEL, LEFT_FOOT_INDEX, RIGHT_FOOT_INDEX]
    required_idxs = [
        NOSE,
        LEFT_SHOULDER,
        RIGHT_SHOULDER,
        LEFT_HIP,
        RIGHT_HIP,
        LEFT_KNEE,
        RIGHT_KNEE,
        LEFT_ANKLE,
        RIGHT_ANKLE,
        LEFT_HEEL,
        RIGHT_HEEL,
        LEFT_FOOT_INDEX,
        RIGHT_FOOT_INDEX,
    ]

    visible_points = [xy(i) for i in range(len(landmarks)) if vis(i) >= 0.35]
    if visible_points:
        ys = [p[1] for p in visible_points]
        body_coverage = _clamp(max(ys) - min(ys), 0.0, 1.0)
    else:
        body_coverage = 0.0

    head_visible = max((vis(i) for i in head_idxs), default=0.0) >= 0.5

    feet_vis = min((vis(i) for i in feet_idxs), default=0.0)
    feet_y = max((xy(i)[1] for i in feet_idxs), default=0.0)
    feet_visible = feet_vis >= 0.5 and feet_y >= 0.84

    # Frontal orientation: combine "width vs torso height" with left/right depth symmetry.
    lsx, lsy = xy(LEFT_SHOULDER)
    rsx, rsy = xy(RIGHT_SHOULDER)
    lhx, lhy = xy(LEFT_HIP)
    rhx, rhy = xy(RIGHT_HIP)

    shoulder_width = abs(lsx - rsx)
    hip_width = abs(lhx - rhx)
    shoulder_center_y = (lsy + rsy) / 2.0
    hip_center_y = (lhy + rhy) / 2.0
    torso_height = abs(hip_center_y - shoulder_center_y)

    width_ratio = min(shoulder_width, hip_width) / max(torso_height, 1e-6)
    width_score = _clamp((width_ratio - 0.35) / 0.55, 0.0, 1.0)

    z_delta = abs(z(LEFT_SHOULDER) - z(RIGHT_SHOULDER)) + abs(z(LEFT_HIP) - z(RIGHT_HIP))
    z_score = _clamp(1.0 - (z_delta / 0.6), 0.0, 1.0)

    frontal_score = (0.65 * width_score) + (0.35 * z_score)

    # If core torso landmarks are very uncertain, treat as not front-facing.
    core_vis = min(vis(LEFT_SHOULDER), vis(RIGHT_SHOULDER), vis(LEFT_HIP), vis(RIGHT_HIP))
    if core_vis < 0.35:
        frontal_score = 0.0

    front_facing = frontal_score >= 0.6

    required_vis = [vis(i) for i in required_idxs]
    avg_vis = float(sum(required_vis) / max(1, len(required_vis)))
    min_vis = float(min(required_vis) if required_vis else 0.0)
    landmark_confidence = _clamp((0.6 * avg_vis) + (0.4 * min_vis), 0.0, 1.0)

    # People count: face detection is best-effort for group photos.
    if face_count >= 2:
        people_count = int(face_count)
    else:
        people_count = 1

    return PoseAssessment(
        body_coverage=float(body_coverage),
        frontal_score=float(frontal_score),
        landmark_confidence=float(landmark_confidence),
        feet_visible=bool(feet_visible),
        front_facing=bool(front_facing),
        head_visible=bool(head_visible),
        people_count=int(people_count),
    )


def assess_pose(image: Image.Image) -> PoseAssessment:
    backend = os.getenv("FULLBODY_POSE_BACKEND", "mediapipe").strip().lower()
    if backend == "heuristic":
        return _assess_pose_heuristic(image)
    return _assess_pose_mediapipe(image)

