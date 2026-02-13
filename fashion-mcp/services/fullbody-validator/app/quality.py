from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass
class QualityMetrics:
    width: int
    height: int
    aspect_ratio: float
    brightness: float
    blur_score: float


def _to_luma_array(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    # ITU-R BT.601 luma approximation
    luma = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    return luma


def estimate_quality(image: Image.Image) -> QualityMetrics:
    width, height = image.size
    aspect_ratio = float(height) / max(width, 1)

    luma = _to_luma_array(image)
    brightness = float(np.mean(luma) / 255.0)

    # Lightweight blur proxy: variance of simple gradient magnitude.
    gx = np.abs(np.diff(luma, axis=1))
    gy = np.abs(np.diff(luma, axis=0))
    gmag = np.zeros_like(luma)
    if gx.size > 0:
        gmag[:, 1:] += gx
    if gy.size > 0:
        gmag[1:, :] += gy
    blur_score = float(np.var(gmag))

    return QualityMetrics(
        width=width,
        height=height,
        aspect_ratio=aspect_ratio,
        brightness=brightness,
        blur_score=blur_score,
    )
