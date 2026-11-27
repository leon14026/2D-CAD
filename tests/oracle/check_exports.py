"""Independent check of exported DXF files: lengths, areas and positions via ezdxf + shapely.

The TypeScript exporter writes DXF into $EXPORT_DIR (default: the system temp
directory / archilite-export-oracle). This script reads those files with ezdxf
and checks them against hand-calculated values, not against ArchiLite's own numbers.

Run after the emit test:
  npx vitest run tests/unit/io/emit-oracle.test.ts
  python3 tests/oracle/check_exports.py
"""
from __future__ import annotations

import math
import os
import sys
import tempfile

try:
    import ezdxf
except ImportError:
    print("ezdxf is not installed. For the Phase 7 oracle: pip install ezdxf==1.4.3")
    sys.exit(1)

from shapely.geometry import Polygon

DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), "archilite-export-oracle")
TOL = 1e-6  # mm, well inside the 0.001 mm manual gate
STEPS_PER_TURN = 400_000


def bulge_points(a, b, bulge):
    if bulge == 0:
        return []
    theta = 4 * math.atan(bulge)
    chord = math.hypot(b[0] - a[0], b[1] - a[1])
    if chord == 0:
        return []
    r = chord / (2 * math.sin(abs(theta) / 2))
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    h = math.sqrt(max(0.0, r * r - (chord / 2) ** 2))
    side = (1 if bulge > 0 else -1) * (-1 if abs(theta) > math.pi else 1)
    cx = mx + side * -(b[1] - a[1]) / chord * h
    cy = my + side * (b[0] - a[0]) / chord * h
    start = math.atan2(a[1] - cy, a[0] - cx)
    n = max(2, int(abs(theta) / (2 * math.pi) * STEPS_PER_TURN))
    return [
        (cx + r * math.cos(start + theta * k / n), cy + r * math.sin(start + theta * k / n))
        for k in range(1, n)
    ]


def polyline_polygon(verts, closed):
    pts = []
    n = len(verts)
    last = n if closed else n - 1
    for i in range(last):
        a = verts[i]
        b = verts[(i + 1) % n]
        pts.append((a[0], a[1]))
        pts.extend(bulge_points((a[0], a[1]), (b[0], b[1]), a[2] if len(a) > 2 else 0))
    if closed and pts:
        pts.append(pts[0])
    return Polygon(pts) if len(pts) >= 4 else None


def fail(msg):
    print(msg)
    return 1


def check_line_100(doc):
    msp = doc.modelspace()
    lines = [e for e in msp.query("LINE")]
    if len(lines) < 1:
        return fail("line-100.dxf: no LINE entities")
    lengths = [math.hypot(e.dxf.end.x - e.dxf.start.x, e.dxf.end.y - e.dxf.start.y) for e in lines]
    if min(abs(L - 100.0) for L in lengths) > TOL:
        return fail(f"line-100.dxf: expected a 100 mm line, got {lengths}")
    # Position: one line from (0,0) to (100,0)
    hit = any(
        abs(e.dxf.start.x) <= TOL
        and abs(e.dxf.start.y) <= TOL
        and abs(e.dxf.end.x - 100) <= TOL
        and abs(e.dxf.end.y) <= TOL
        for e in lines
    )
    if not hit:
        return fail("line-100.dxf: no line from (0,0) to (100,0)")
    print("line-100.dxf: 100 mm line at (0,0)–(100,0)")
    return 0


def check_bracket(doc):
    msp = doc.modelspace()
    radii = sorted(e.dxf.radius for e in msp.query("CIRCLE"))
    if radii != [4, 4, 4, 4]:
        return fail(f"bracket.dxf: hole radii {radii}, expected four of 4 mm")
    areas = []
    for pl in msp.query("LWPOLYLINE"):
        if not pl.closed:
            continue
        verts = [(p[0], p[1], p[2] if len(p) > 2 else 0.0) for p in pl.get_points("xyb")]
        poly = polyline_polygon(verts, True)
        if poly is not None and poly.area > 1:
            areas.append(poly.area)
    areas.sort()
    # Slot 20×10 + π×5² = 200 + 25π; plate 100×60 minus four (1−π/4)×5².
    slot = 200 + 25 * math.pi
    plate = 6000 - (4 - math.pi) * 25
    if len(areas) < 2:
        return fail(f"bracket.dxf: need two closed areas, got {areas}")
    if min(abs(a - slot) for a in areas) > 1e-4:
        return fail(f"bracket.dxf: slot area not found in {areas}, expected {slot}")
    if min(abs(a - plate) for a in areas) > 1e-4:
        return fail(f"bracket.dxf: outline area not found in {areas}, expected {plate}")
    print(f"bracket.dxf: four Ø8 holes; outline {plate:.6f} mm²; slot {slot:.6f} mm²")
    return 0


def hatch_area(hatch):
    loops = []
    for path in hatch.paths:
        verts = []
        if hasattr(path, "vertices"):
            for v in path.vertices:
                x, y = float(v[0]), float(v[1])
                bulge = float(v[2]) if len(v) > 2 else 0.0
                verts.append((x, y, bulge))
        if len(verts) >= 2:
            poly = polyline_polygon(verts, True)
            if poly is not None:
                loops.append(poly)
    if not loops:
        return None
    outer = max(loops, key=lambda p: p.area)
    holes = [p for p in loops if p is not outer]
    region = outer
    for h in holes:
        region = region.difference(h)
    return region.area


def check_annotate(doc):
    msp = doc.modelspace()
    hatches = list(msp.query("HATCH"))
    if not hatches:
        return fail("annotate.dxf: no HATCH entities")
    expected = 2400 - 41 * math.pi
    areas = [hatch_area(h) for h in hatches]
    areas = [a for a in areas if a is not None]
    if not areas or min(abs(a - expected) for a in areas) > 1e-4:
        return fail(f"annotate.dxf: hatch areas {areas}, expected {expected}")
    # The 60 mm linear dimension's geometry is a 60 mm plate edge, exported as LWPOLYLINE/LINE.
    lengths = [math.hypot(e.dxf.end.x - e.dxf.start.x, e.dxf.end.y - e.dxf.start.y) for e in msp.query("LINE")]
    if not any(abs(L - 60) < 0.05 for L in lengths) and not any(abs(L - 60) < 0.05 for L in [
        sum(
            math.hypot(pl.get_points("xy")[i + 1][0] - pl.get_points("xy")[i][0], pl.get_points("xy")[i + 1][1] - pl.get_points("xy")[i][1])
            for i in range(len(pl.get_points("xy")) - 1)
        )
        for pl in msp.query("LWPOLYLINE")
    ]):
        # The plate is 60×40; a 60 mm edge must exist as a polyline edge or a line.
        found = False
        for pl in msp.query("LWPOLYLINE"):
            pts = list(pl.get_points("xy"))
            n = len(pts)
            for i in range(n if pl.closed else n - 1):
                a, b = pts[i], pts[(i + 1) % n]
                if abs(math.hypot(b[0] - a[0], b[1] - a[1]) - 60) < 0.05:
                    found = True
        if not found:
            return fail("annotate.dxf: no 60 mm edge")
    print(f"annotate.dxf: hatch area {expected:.6f} mm²; 60 mm edge present")
    return 0


def main():
    if not os.path.isdir(DIR):
        print(f"export directory {DIR} is missing; run the emit-oracle unit test first")
        return 1
    checks = {
        "line-100.dxf": check_line_100,
        "bracket.dxf": check_bracket,
        "annotate.dxf": check_annotate,
    }
    worst = 0
    for name, fn in checks.items():
        path = os.path.join(DIR, name)
        if not os.path.isfile(path):
            return fail(f"missing {path}")
        try:
            doc = ezdxf.readfile(path)
        except ezdxf.DXFError as err:
            try:
                doc, auditor = ezdxf.recover.readfile(path)
                if auditor.has_errors:
                    print(f"{name}: recovered with {len(auditor.errors)} messages")
            except Exception as err2:
                return fail(f"{name}: ezdxf could not read it ({err}; recover: {err2})")
        code = fn(doc)
        if code:
            return code
        worst = max(worst, code)
    print("exported DXF files agree with ezdxf and shapely on lengths, areas and positions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
