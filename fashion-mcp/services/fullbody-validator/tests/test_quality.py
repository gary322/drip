from PIL import Image

from app.quality import estimate_quality


def test_estimate_quality_reports_dimensions_and_aspect() -> None:
    image = Image.new("RGB", (900, 1600), color=(180, 160, 140))
    metrics = estimate_quality(image)

    assert metrics.width == 900
    assert metrics.height == 1600
    assert metrics.aspect_ratio > 1.7
    assert 0.0 <= metrics.brightness <= 1.0


def test_blur_score_distinguishes_flat_vs_textured_image() -> None:
    flat = Image.new("RGB", (256, 256), color=(120, 120, 120))
    textured = Image.new("RGB", (256, 256), color=(120, 120, 120))
    px = textured.load()
    for y in range(256):
        for x in range(256):
            if (x + y) % 2 == 0:
                px[x, y] = (240, 240, 240)
            else:
                px[x, y] = (10, 10, 10)

    flat_score = estimate_quality(flat).blur_score
    textured_score = estimate_quality(textured).blur_score

    assert textured_score > flat_score
