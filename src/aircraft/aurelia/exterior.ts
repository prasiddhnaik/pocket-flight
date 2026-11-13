import * as T from "three";
import { aureliaCockpitLayout, aureliaCockpitWindows } from "./cockpit-layout";
import { aureliaExteriorReference as reference } from "./exterior-reference";
import { makeExteriorKit } from "./exterior-kit";
import { buildCarryThroughFairing, buildFuselage } from "./exterior-fuselage";
import { buildWings } from "./exterior-wings";
import { buildEmpennage } from "./exterior-empennage";
import { buildEngines } from "./exterior-engines";
import { buildLandingGear } from "./exterior-gear";
import { buildForwardLining } from "./exterior-lining";

/** SI metres, +Y up, -Z forward. Surface stations are documented visual estimates. */
export function makeAureliaExterior(airframeScale = 1) {
  const { noseShift, noseLift } = aureliaCockpitLayout(airframeScale);
  const cockpitWindows = aureliaCockpitWindows(airframeScale);
  const root = new T.Group();
  root.name = "Aurelia_Phenom300E";
  root.userData = {
    reference,
    units: "metres",
    forward: "-Z",
    revision: reference.revision,
  };
  const kit = makeExteriorKit(root);
  // Build order fixes child order, which the attachment and partition checks rely on.
  const { fuselage, entryLiningGeometry } = buildFuselage(kit, noseShift, cockpitWindows);
  buildWings(kit);
  buildCarryThroughFairing(kit, fuselage);
  buildEmpennage(kit);
  buildEngines(kit);
  buildLandingGear(kit, noseShift, noseLift);
  buildForwardLining(kit, fuselage, entryLiningGeometry);
  entryLiningGeometry?.dispose();
  root.updateMatrixWorld(true);
  return { root, palettes: kit.palettes };
}
