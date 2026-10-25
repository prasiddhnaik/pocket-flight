import { makeAureliaExterior } from "./exterior";
import { makeAureliaInterior } from "./interior";
import { aureliaAirframeScale } from "./exterior-reference";

/** Shared assembly for export and geometry verification, in SI metres. */
export function makeAureliaReference(scale = aureliaAirframeScale) {
  const result = makeAureliaExterior(scale);
  result.root.add(makeAureliaInterior(scale));
  result.root.scale.setScalar(scale);
  result.root.userData.airframeScale = scale;
  return result;
}
