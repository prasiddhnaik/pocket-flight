"""Builds one aircraft's detail cockpit in Blender and exports public/assets/cockpits/<id>.glb.

Run with: blender --background --factory-startup --python scripts/build-cockpit.py -- <id> [--review[=view,view] | --fit-map]
Paint the atlas first with: python3 scripts/build-cockpit-atlas.py <id>
"""
from contextlib import nullcontext
import importlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts/cockpit"))
import kit  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
aircraft = importlib.import_module(args[0])
kit.setup(aircraft)
fit_map = "--fit-map" in args
with kit.capture_fit_surfaces() if fit_map else nullcontext() as surfaces:
    aircraft.build(kit)
result = kit.contact_check()
result.update(triangles=kit.triangle_count(), nodes=len(kit.NODES))
print("COCKPIT", args[0], json.dumps({k: v for k, v in result.items() if k != "floating"}), "floating:", result["floating"][:40])
if result["floating"]:
    raise SystemExit("Floating cockpit parts: " + ", ".join(result["floating"]))
if fit_map:
    output = ROOT / f"assets/{aircraft.ID}/cockpit/fit-map.json"
    kit.write_fit_map(output, surfaces)
    print("Wrote", output)
    raise SystemExit(0)
checks = ROOT / f"assets/{aircraft.ID}/checks"
checks.mkdir(parents=True, exist_ok=True)
(checks / "cockpit-detail.json").write_text(json.dumps(result, indent=1))
output = ROOT / f"public/assets/cockpits/{aircraft.ID}.glb"
kit.export(output)
print("Wrote", output, round(output.stat().st_size / 1e6, 2), "MB")
views = [a for a in args if a.startswith("--review")]
if views:
    kit.review(views[0].split("=")[1].split(",") if "=" in views[0] else [])
