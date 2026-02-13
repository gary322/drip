import base64
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


client = TestClient(app)


def _checkerboard_base64(width: int, height: int) -> str:
    image = Image.new("RGB", (width, height), color=(128, 128, 128))
    px = image.load()
    for y in range(height):
        for x in range(width):
            if (x // 8 + y // 8) % 2 == 0:
                px[x, y] = (230, 230, 230)
            else:
                px[x, y] = (25, 25, 25)
    buf = BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_healthz_returns_ok() -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True


def test_validate_returns_contract_fields() -> None:
    payload = {
        "imageBase64": _checkerboard_base64(900, 1600),
        "mimeType": "image/png",
        "checks": {"requireFeetVisible": True},
    }
    response = client.post("/validate", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert "approved" in data
    assert "reasons" in data
    assert "metrics" in data
    assert "checks" in data

    metrics = data["metrics"]
    assert metrics["width"] == 900
    assert metrics["height"] == 1600
    assert metrics["aspectRatio"] > 1.7


def test_validate_fails_with_no_image() -> None:
    response = client.post("/validate", json={})
    assert response.status_code == 200
    data = response.json()
    assert data["approved"] is False
    assert "no_person_detected" in data["reasons"]
