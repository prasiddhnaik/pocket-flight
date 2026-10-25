"""Preserve individually editable internal parts and independently reopen each native file."""
import bpy
import json
import math
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
required = ["InternalSystems", "RearCabinBulkhead", "AftEquipmentBay", "HydraulicServiceBay",
            "FuelSystem", "WingStructure_Left", "WingStructure_Right", "WetWingFuel_Left",
            "WetWingFuel_Right", "Aileron_Left", "Flap_Right"]
calibration = json.loads((root / "src/aircraft/fuel-mass-calibration.json").read_text())
evidence = []
selected = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for aircraft, filename in [
    ("peregrine", "Peregrine-HX27-internals.blend"),
    ("aurelia", "Aurelia-S32-internals.blend"),
    ("stormbird", "Stormbird-HX40-internals.blend"),
]:
    if selected and aircraft not in selected:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source = root / "output/fleet-internals-native" / f"{aircraft}-editable.gltf"
    bpy.ops.import_scene.gltf(filepath=str(source))
    expected = ["ForwardEquipmentBay" if aircraft == "aurelia" and name == "AftEquipmentBay" else name for name in required]
    assert all(name in bpy.data.objects for name in expected), "Internal hierarchy missing"
    data = calibration["aircraft"][aircraft]
    systems = bpy.data.objects["InternalSystems"]
    systems["physics_mass_updated"] = True
    systems["physics_mass_source"] = "src/aircraft/fuel-mass-calibration.json"
    systems["empty_mass_including_unusable_kg"] = data["emptyMassIncludingResidual"]
    systems["usable_fuel_kg"] = data["usableFuelKg"]
    systems["unusable_fuel_kg"] = data["unusableFuelKg"]
    for installation in data["installations"]:
        obj = bpy.data.objects[installation["group"]]
        obj["allocated_mass_kg"] = installation["mass"]
        obj["mass_station_runtime_si"] = installation["center"]
        obj["mass_parent_budget"] = installation["source"]
    for tank in data["tanks"]:
        name = "CentreFuelBay" if tank["id"] == "centre" else "WetWingFuel_" + tank["id"].title()
        obj = bpy.data.objects[name]
        obj["usable_fuel_litres"] = tank["usableLitres"]
        obj["unusable_fuel_litres"] = tank["unusableLitres"]
        obj["density_kg_per_litre"] = tank["densityKgPerLitre"]
    assert all(math.isfinite(c) for o in bpy.data.objects if o.type == "MESH"
               for v in o.data.vertices for c in v.co), "Nonfinite imported geometry"
    bpy.context.preferences.filepaths.save_version = 0
    destination = root / "assets" / aircraft / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(destination))
    bpy.ops.wm.open_mainfile(filepath=str(destination))
    assert all(name in bpy.data.objects for name in expected), "Internal hierarchy missing after reopen"
    assert bpy.data.objects["InternalSystems"]["usable_fuel_kg"] == data["usableFuelKg"]
    assert bpy.data.objects["InternalSystems"]["hardware"]["model"] == data["hardware"]["model"]
    evidence.append({"aircraft": aircraft, "file": str(destination), "nativeReopened": True,
                     "meshes": sum(o.type == "MESH" for o in bpy.data.objects),
                     "actions": len(bpy.data.actions), "required": expected})
    print("FLEET_NATIVE_REOPENED", aircraft, flush=True)
(root / "output/fleet-internals-native-reopen.json").write_text(json.dumps(evidence, indent=2))
print("FLEET_INTERNAL_NATIVE_OK", flush=True)
