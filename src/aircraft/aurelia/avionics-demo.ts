import type {
  AureliaAvionicsState,
  AvionicsPose,
  AureliaEngine,
} from "./avionics-state";

/** Only the reference viewer uses this source; the renderer never invents telemetry. */
export function aureliaAvionicsDemo(
  time: number,
  pose: AvionicsPose,
): AureliaAvionicsState {
  // Analytic path: displayed groundspeed and heading are its actual derivatives.
  const vx = 125 + 5 * Math.sin(time * 0.16);
  const vz = -17 + 10 * Math.sin(time * 0.13);
  const groundSpeedKt = Math.hypot(vx, vz) / (1852 / 3600);
  const speedKt = groundSpeedKt - 14;
  const altitudeFt = 18000 + 120 * Math.sin(time * 0.12);
  const verticalSpeedFpm = 864 * Math.cos(time * 0.12);
  const headingDeg = (Math.atan2(vx, -vz) * 180) / Math.PI;
  const turnRate =
    (-vz * 0.8 * Math.cos(time * 0.16) + vx * 1.3 * Math.cos(time * 0.13)) /
    (vx * vx + vz * vz);
  const roll = Math.atan((speedKt * 0.514444 * turnRate) / 9.80665);
  const pitch =
    Math.atan2(verticalSpeedFpm * 0.00508, speedKt * 0.514444) + 0.035;
  const n1 = 83 + 2 * Math.sin(time * 0.2);
  const engine = (side: number): AureliaEngine => ({
    n1: n1 + side * 0.2,
    n2: 94.1 + (n1 - 83) * 0.3,
    ittC: 670 + (n1 - 83) * 9 + side * 3,
    oilPsi: 51,
    oilC: 112,
    fuelLb: Math.max(0, 1200 - time * 0.1 - side * 3),
  });
  return {
    time,
    revision: time,
    source: "demo",
    speedKt,
    groundSpeedKt,
    altitudeFt,
    verticalSpeedFpm,
    headingDeg,
    roll,
    pitch,
    engines: [engine(0), engine(1)],
    busVoltage: 28.3 + 0.15 * Math.sin(time * 0.6),
    utcSeconds: 43200 + time,
    gear: pose.gear,
    flaps: pose.flaps,
    guidance: {
      verticalMode: "FLC",
      lateralMode: "NAV",
      autopilot: true,
      yawDamper: true,
      selectedAltitudeFt: 18000,
      directorPitchRad: pitch - Math.sin(time * 0.3) * 0.015,
      directorRollRad: roll + Math.sin(time * 0.2) * 0.025,
    },
    radio: {
      com1MHz: 121.7,
      baroInHg: 29.92,
      transponderCode: "1200",
      transponderMode: "ALT",
    },
    navigation: {
      position: {
        x: time * 125 + (5 / 0.16) * (1 - Math.cos(time * 0.16)),
        z: -time * 17 + (10 / 0.13) * (1 - Math.cos(time * 0.13)),
      },
      rangeNm: 20,
      orientation: "heading-up",
      desiredTrackDeg: 82,
      route: [
        { id: "PALMBAY", x: -12000, z: 1000 },
        { id: "COAST", x: 22000, z: -4000 },
        { id: "GULFY", x: 50000, z: -19000 },
      ],
      runways: [
        {
          id: "DEMO RWY",
          start: { x: -13000, z: 1000 },
          end: { x: -11000, z: 1000 },
        },
      ],
      terrain: [
        {
          color: "#234e47",
          points: [
            { x: -70000, z: 30000 },
            { x: -20000, z: 10000 },
            { x: 5000, z: 22000 },
            { x: 26000, z: 13000 },
            { x: 70000, z: 30000 },
            { x: 70000, z: 80000 },
            { x: -70000, z: 80000 },
          ],
        },
      ],
    },
  };
}
