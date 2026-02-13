from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


FailureReason = str


class ValidateRequest(BaseModel):
    imageUrl: Optional[str] = None
    imageBase64: Optional[str] = None
    mimeType: Optional[str] = None
    checks: dict = Field(default_factory=dict)


class ValidationMetrics(BaseModel):
    width: int
    height: int
    aspectRatio: float
    blurScore: float
    brightness: float
    bodyCoverage: float
    frontalScore: float
    landmarkConfidence: float


class ValidationChecks(BaseModel):
    feetVisible: bool
    frontFacing: bool


class ValidateResponse(BaseModel):
    approved: bool
    reasons: List[FailureReason] = Field(default_factory=list)
    metrics: ValidationMetrics
    checks: ValidationChecks
