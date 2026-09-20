

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

MODEL_PATH = Path(os.getenv("PASHUGUARD_MODEL", "ml/models/stage2.txt"))

app = FastAPI(
    title="PashuGuard Stage 2",
    description="Learned straying-risk model. Stage 0 remains authoritative.",
    version="0.1.0",
)

_booster = None
_model_is_synthetic = True


def _load():
    """Load lazily so the service starts (and reports honestly) with no model."""
    global _booster, _model_is_synthetic
    if _booster is not None or not MODEL_PATH.exists():
        return
    try:
        import lightgbm as lgb

        _booster = lgb.Booster(model_file=str(MODEL_PATH))
        # A model trained on simulate_herd.py output is synthetic and must be
        # labelled as such everywhere it surfaces (§7.11, §13.2).
        _model_is_synthetic = not (MODEL_PATH.parent / "TRAINED_ON_REAL_DATA").exists()
    except Exception as exc:  # noqa: BLE001
        print(f"model load failed: {exc}")


class Features(BaseModel):
    """Features in expected order of importance (§7.11)."""

    separation_rate: float = Field(..., description="m/min, positive = drifting away")
    distance_from_centroid: float
    distance_to_road: float = Field(..., description="to the nearest high-risk road")
    closing_speed: float
    heading_stability: float = Field(..., description="1 - normalised sd of last 5 headings")
    minutes_outside_zone: float
    hour: int
    day_of_week: int
    prior_approaches_to_this_road: int
    current_traffic_speed: float | None = None


class Prediction(BaseModel):
    p_reaches_road_10min: float | None
    source: Literal["model", "unavailable"]
    # Never report a metric from synthetic data without saying so (§13.2).
    is_synthetic: bool
    note: str


FEATURE_ORDER = [
    "separation_rate",
    "distance_from_centroid",
    "distance_to_road",
    "closing_speed",
    "heading_stability",
    "minutes_outside_zone",
    "hour",
    "day_of_week",
    "prior_approaches_to_this_road",
    "current_traffic_speed",
]


@app.get("/health")
def health() -> dict:
    _load()
    return {
        "ok": True,
        "model_loaded": _booster is not None,
        "is_synthetic": _model_is_synthetic,
    }


@app.post("/predict", response_model=Prediction)
def predict(f: Features) -> Prediction:
    _load()

    if _booster is None:
        # Explicitly unavailable rather than a fabricated default. Stage 0 is
        # authoritative regardless; this service only ever refines it.
        return Prediction(
            p_reaches_road_10min=None,
            source="unavailable",
            is_synthetic=_model_is_synthetic,
            note="No trained model present. Stage 0 weighted score remains authoritative.",
        )

    row = [[getattr(f, k) if getattr(f, k) is not None else -1 for k in FEATURE_ORDER]]
    p = float(_booster.predict(row)[0])

    return Prediction(
        p_reaches_road_10min=p,
        source="model",
        is_synthetic=_model_is_synthetic,
        note=(
            "Trained on SIMULATED herd data — label any displayed metric as simulated."
            if _model_is_synthetic
            else "Trained on observed telemetry."
        ),
    )
