"""
§7.11 — training-data generator. 10,000 tracks.

A correlated random walk with attraction toward forage and water points, plus
occasional directed excursions. Real cattle do not walk in straight lines and
do not wander uniformly: they graze in loops around resources and occasionally
strike out. A model trained on uniform noise learns nothing transferable.

Everything this produces is SIMULATED. Any metric derived from it must be
labelled simulated in the UI and in every reported figure (§7.11, §13.2).

    python3 scripts/simulate_herd.py --tracks 10000 --out ml/data/tracks.csv
"""

from __future__ import annotations

import argparse
import csv
import math
import random
from dataclasses import dataclass
from pathlib import Path

R_EARTH = 6_371_008.8

# The road runs east-west; the herd lives south of it. Distances below are in
# metres from the road, so "0" is the carriageway.
ROAD_LAT = 13.0
ZONE_LAT = 12.9964  # ~400 m south
ZONE_LON = 77.5500
ZONE_RADIUS_M = 260


@dataclass
class Resource:
    lat: float
    lon: float
    pull: float  # 0..1, how strongly it attracts


def destination(lat: float, lon: float, bearing_deg: float, dist_m: float):
    d = dist_m / R_EARTH
    th = math.radians(bearing_deg)
    p1, l1 = math.radians(lat), math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(th))
    l2 = l1 + math.atan2(
        math.sin(th) * math.sin(d) * math.cos(p1),
        math.cos(d) - math.sin(p1) * math.sin(p2),
    )
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def haversine(lat1, lon1, lat2, lon2) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * R_EARTH * math.asin(min(1, math.sqrt(a)))


def bearing_to(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def simulate_track(rng: random.Random, steps: int = 90, step_s: int = 20):
    """One animal, ~30 minutes at 20 s resolution."""
    forage = [
        Resource(*destination(ZONE_LAT, ZONE_LON, rng.uniform(0, 360), rng.uniform(40, 220)), 0.5)
        for _ in range(3)
    ]
    water = Resource(*destination(ZONE_LAT, ZONE_LON, rng.uniform(0, 360), 120), 0.8)
    targets = forage + [water]

    lat, lon = destination(ZONE_LAT, ZONE_LON, rng.uniform(0, 360), rng.uniform(0, ZONE_RADIUS_M * 0.7))
    heading = rng.uniform(0, 360)
    speed = rng.uniform(0.3, 1.2)  # km/h, grazing

    # ~12% of tracks contain a directed excursion — the behaviour we care about.
    excursion_at = rng.randint(20, steps - 20) if rng.random() < 0.12 else None
    excursion_heading = bearing_to(lat, lon, ROAD_LAT, lon)

    rows = []
    for i in range(steps):
        if excursion_at is not None and i >= excursion_at:
            heading += (((excursion_heading - heading + 540) % 360) - 180) * 0.35
            speed = min(5.0, speed + 0.4)
        else:
            # Correlated random walk: heading persists, drifts slowly.
            heading = (heading + rng.gauss(0, 22)) % 360
            speed = min(1.4, max(0.15, speed + rng.gauss(0, 0.2)))

            # Attraction toward the strongest nearby resource.
            best, best_score = None, 0.0
            for t in targets:
                d = haversine(lat, lon, t.lat, t.lon)
                score = t.pull / max(30.0, d)
                if score > best_score:
                    best, best_score = t, score
            if best is not None and rng.random() < 0.3:
                want = bearing_to(lat, lon, best.lat, best.lon)
                heading = (heading + (((want - heading + 540) % 360) - 180) * 0.25) % 360

        lat, lon = destination(lat, lon, heading, (speed / 3.6) * step_s)
        dist_road = abs(haversine(lat, lon, ROAD_LAT, lon))
        rows.append(
            {
                "t": i * step_s,
                "lat": round(lat, 7),
                "lon": round(lon, 7),
                "speed_kmh": round(speed, 3),
                "heading_deg": round(heading, 1),
                "distance_to_road": round(dist_road, 1),
                "distance_from_centroid": round(haversine(lat, lon, ZONE_LAT, ZONE_LON), 1),
            }
        )
    return rows


def label_tracks(rows: list[dict], horizon_steps: int = 30, threshold_m: float = 50.0):
    """
    The label is free: did she come within 50 m of the road in the NEXT 10 min?
    Computed retroactively, so no annotation is ever required.
    """
    for i, r in enumerate(rows):
        window = rows[i + 1 : i + 1 + horizon_steps]
        r["label"] = int(any(w["distance_to_road"] < threshold_m for w in window))
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracks", type=int, default=10_000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", type=Path, default=Path("ml/data/tracks.csv"))
    args = ap.parse_args()

    rng = random.Random(args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)

    fields = [
        "track", "t", "lat", "lon", "speed_kmh", "heading_deg",
        "distance_to_road", "distance_from_centroid", "label",
    ]

    positives = total = 0
    with args.out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for n in range(args.tracks):
            rows = label_tracks(simulate_track(rng))
            for r in rows:
                r["track"] = n
                w.writerow(r)
                positives += r["label"]
                total += 1
            if n % 1000 == 0:
                print(f"  {n}/{args.tracks}")

    print(f"\n  wrote {total} rows to {args.out}")
    print(f"  positive rate {positives / max(1, total):.3f}")
    print("\n  SIMULATED DATA. Any metric derived from this must be labelled simulated.\n")


if __name__ == "__main__":
    main()
