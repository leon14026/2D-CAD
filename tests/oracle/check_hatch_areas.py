"""Independent check of hatch areas: recompute every case in tests/fixtures/hatch-cases.json
with shapely, using only the geometry, and compare with the area ArchiLite reported.

Arcs (circles and polyline bulges) are turned into very fine polygons, so the polygon's area
differs from the true area by less than 1e-8 of itself.

Run:  python3 tests/oracle/check_hatch_areas.py
"""
import json
import math
import pathlib
import sys

from shapely.geometry import Polygon

ROOT = pathlib.Path(__file__).resolve().parents[2]
CASES = ROOT / "tests" / "fixtures" / "hatch-cases.json"
STEPS_PER_TURN = 400_000
TOLERANCE = 2e-8  # relative


def loop_points(loop):
    if loop["kind"] == "circle":
        cx, cy, r = loop["cx"], loop["cy"], loop["r"]
        return [(cx + r * math.cos(2 * math.pi * i / STEPS_PER_TURN), cy + r * math.sin(2 * math.pi * i / STEPS_PER_TURN)) for i in range(STEPS_PER_TURN)]
    pts = []
    v = loop["vertices"]
    for i, a in enumerate(v):
        b = v[(i + 1) % len(v)]
        pts.append((a["x"], a["y"]))
        bulge = a["bulge"]
        if bulge == 0:
            continue
        theta = 4 * math.atan(bulge)  # signed sweep
        chord = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
        r = chord / (2 * math.sin(abs(theta) / 2))
        mx, my = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
        h = math.sqrt(max(0.0, r * r - (chord / 2) ** 2))
        # The centre is left of a->b for a counter-clockwise minor arc.
        side = (1 if bulge > 0 else -1) * (-1 if abs(theta) > math.pi else 1)
        cx = mx + side * -(b["y"] - a["y"]) / chord * h
        cy = my + side * (b["x"] - a["x"]) / chord * h
        start = math.atan2(a["y"] - cy, a["x"] - cx)
        n = max(2, int(abs(theta) / (2 * math.pi) * STEPS_PER_TURN))
        for k in range(1, n):
            t = start + theta * k / n
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts


def main():
    cases = json.loads(CASES.read_text())
    worst = 0.0
    for c in cases:
        poly = Polygon(loop_points(c["outer"]), [loop_points(i) for i in c["islands"]])
        if not poly.is_valid:
            print(f"{c['name']}: shapely says the region is not valid")
            return 1
        expected = poly.area
        err = abs(expected - c["area"]) / max(1.0, expected)
        worst = max(worst, err)
        if err > TOLERANCE:
            print(f"{c['name']}: ArchiLite {c['area']!r} but shapely {expected!r} (relative difference {err:.3e})")
            return 1
    print(f"{len(cases)} hatch areas agree with shapely; worst relative difference {worst:.2e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
