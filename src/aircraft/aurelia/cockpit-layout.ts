import { aureliaBodyAt, aureliaInteriorLayout } from "./exterior-reference";

type Point = [number, number, number];
const panelY = 1.97,
  panelTilt = -0.13;
/** Fit the unchanged panel/glare-shield envelopes inside the tapered nose. */
export function aureliaCockpitLayout(scale = 1) {
  function fits(shift: number) {
    for (const [halfX, lowY, highY, frontZ, rearZ] of [
      [0.53, -0.17, 0.17, -0.045, 0.045],
      [0.545, 0.1575, 0.2025, -0.085, 0.115],
    ])
      for (const y of [lowY, highY])
        for (const z of [frontZ, rearZ]) {
          const py =
            panelY +
            (y * Math.cos(panelTilt) - z * Math.sin(panelTilt)) / scale;
          const pz =
            -5.37 -
            shift +
            (y * Math.sin(panelTilt) + z * Math.cos(panelTilt)) / scale;
          const [outerX, outerY, cy] = aureliaBodyAt(pz);
          const rx = outerX - 0.016,
            ry = outerY - 0.016;
          if ((halfX / scale / rx) ** 2 + ((py - cy) / ry) ** 2 > 0.995)
            return false;
        }
    return true;
  }
  let low = 0,
    high = 0.73;
  for (let i = 0; i < 35; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return {
    forwardShift: low,
    panelY,
    panelTilt,
    panelZ: -5.37 - low,
    seatZ: -4.58 - low,
    yokeZ: -5.13 - low,
    pedalZ: -5.38 - Math.max(0, low - 0.18),
    pedalX: 0.26,
    pedalSpacing: 0.055,
    controlsShift: low,
    noseShift: low,
    noseLift: 0.055,
    seatX: 0.35,
    floorFrontZ: -6.3,
    // This is the non-walking gear enclosure, between the two level footwells.
    tunnelHalfWidth: 0.16,
  };
}

/** Nominal root coordinates; eye height remains a physical 1.035 m above the floor. */
export function aureliaPilotEye(scale: number, side: number): Point {
  const layout = aureliaCockpitLayout(scale);
  return [
    side * layout.seatX,
    aureliaInteriorLayout.floorY + 1.035 / scale,
    layout.seatZ + 0.02 / scale,
  ];
}

/** Centre the forward glazing on the seated eye's horizontal ray through the hull. */
export function aureliaCockpitWindows(scale = 1) {
  const [x, y, z] = aureliaPilotEye(scale, 1);
  let front = -7.955,
    rear = z;
  for (let i = 0; i < 40; i++) {
    const mid = (front + rear) / 2;
    const [rx, ry, cy] = aureliaBodyAt(mid);
    if ((x / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) front = mid;
    else rear = mid;
  }
  const [rx, ry, cy] = aureliaBodyAt(rear);
  return {
    windshield: {
      z: rear,
      angle: Math.atan2(x / rx, (y - cy) / ry),
      halfZ: 0.55,
      halfAngle: 0.35,
    },
    sideWindow: { z: z + 0.12, angle: 1.34, halfZ: 0.384, halfAngle: 0.276 },
  };
}
