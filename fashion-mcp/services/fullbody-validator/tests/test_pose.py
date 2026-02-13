from PIL import Image

from app.pose import assess_pose


def test_pose_assessment_prefers_tall_portrait_for_feet_visibility(monkeypatch) -> None:
    monkeypatch.setenv("FULLBODY_POSE_BACKEND", "heuristic")
    image = Image.new("RGB", (900, 1600), color=(200, 200, 200))
    assessment = assess_pose(image)

    assert assessment.feet_visible is True
    assert assessment.front_facing is True
    assert assessment.body_coverage > 0.5


def test_pose_assessment_rejects_wide_frame_as_non_fullbody(monkeypatch) -> None:
    monkeypatch.setenv("FULLBODY_POSE_BACKEND", "heuristic")
    image = Image.new("RGB", (1400, 900), color=(200, 200, 200))
    assessment = assess_pose(image)

    assert assessment.feet_visible is False
    assert assessment.front_facing is False
    assert assessment.landmark_confidence < 0.7
