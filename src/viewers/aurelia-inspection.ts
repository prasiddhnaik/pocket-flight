import * as T from "three";
import {
  aureliaInteriorLayout,
  aureliaAirframeScale,
} from "../aircraft/aurelia/exterior-reference";
import {
  neutralExteriorPose,
  poseAureliaExterior,
  type ExteriorPose,
} from "../aircraft/aurelia/exterior-mechanisms";

import {
  aureliaCockpitLayout,
  aureliaPilotEye,
} from "../aircraft/aurelia/cockpit-layout";
import { aureliaCockpitPartition } from "../aircraft/aurelia/cockpit-partition";

type V = [number, number, number];
export type InspectionShot = {
  label: string;
  eye: V;
  target: V;
  pose: Partial<ExteriorPose>;
  cutaway?: boolean;
  fov?: number;
};
export type InspectionSheet = {
  id: string;
  title: string;
  shots: InspectionShot[];
};
const shot = (
  label: string,
  eye: V,
  target: V,
  pose: Partial<ExteriorPose> = {},
  cutaway = false,
): InspectionShot => ({ label, eye, target, pose, cutaway });
const sweep = [
  0, 0.05, 0.1, 0.16, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.84, 0.9, 0.95, 1,
];
export const aureliaInspectionSheets: InspectionSheet[] = [];
const cockpit = aureliaCockpitLayout(aureliaAirframeScale);
const leftEye = aureliaPilotEye(aureliaAirframeScale, -1),
  rightEye = aureliaPilotEye(aureliaAirframeScale, 1);
const partition = aureliaCockpitPartition;
aureliaInspectionSheets.push({
  id: "cockpit-partition",
  title: "Cockpit partition · door travel and floor",
  shots: [
    ...[0, 0.25, 0.5, 0.75, 1].map((cockpitDoor) => ({
      ...shot(
        `Passenger face / ${cockpitDoor * 100}%`,
        [0, 2.16, -3.45],
        [0, 2.13, partition.z],
        { cockpitDoor },
      ),
      fov: 68,
    })),
    ...[0, 0.5, 1].map((cockpitDoor) => ({
      ...shot(
        `Flight deck face / ${cockpitDoor * 100}%`,
        [0, 2.12, -5.4],
        [0, 2.15, partition.z],
        { cockpitDoor },
      ),
      fov: 78,
    })),
    {
      ...shot(
        "Level floor through open doorway",
        [0, 1.65, -3.7],
        [0, 1.5, -4.85],
        { cockpitDoor: 1 },
      ),
      fov: 72,
    },
    {
      ...shot(
        "Door and seat clearance / above",
        [0, 4, -4.65],
        [0, 1.9, -4.7],
        { cockpitDoor: 1 },
        true,
      ),
      fov: 65,
    },
    {
      ...shot("Entry door and partition", [-3, 2.6, -3.8], [0, 2, -4.25], {
        cockpitDoor: 1,
        entry: 1,
      }),
      fov: 50,
    },
    {
      ...shot(
        "Door hinge attachments",
        [0, 2.4, -4.05],
        [0.26, 2.1, partition.z],
        { cockpitDoor: 0.5 },
      ),
      fov: 70,
    },
  ],
});
aureliaInspectionSheets.push({
  id: "cockpit",
  title: "Cockpit · instruments and mounted controls",
  shots: [
    ...[-1, 0, 1].map((side) =>
      shot(
        `Exterior dashboard containment / ${side}`,
        [side * 1.2, 3.6, -9],
        [0, 2.15, -6.1],
      ),
    ),
    {
      ...shot(
        "Complete flight deck",
        [0, leftEye[1] + 0.08, cockpit.seatZ + 0.34],
        [0, 2.02, cockpit.panelZ],
      ),
      fov: 68,
    },
    ...[leftEye, rightEye].map((eye, i) => ({
      ...shot(
        i ? "Right pilot eye / outside view" : "Left pilot eye / outside view",
        eye,
        [eye[0], eye[1] - 0.12, eye[2] - 1],
      ),
      fov: 58,
    })),
    {
      ...shot(
        "Display bezels and guidance",
        [0, 2.25, cockpit.seatZ + 0.1],
        [0, 1.97, cockpit.panelZ],
      ),
      fov: 65,
    },
    {
      ...shot(
        "Touch controllers and thrust quadrant",
        [0, 2.5, cockpit.seatZ + 0.34],
        [0, 1.88, -5.24 - cockpit.controlsShift],
      ),
      fov: 58,
    },
    {
      ...shot(
        "Yokes and panel / oblique",
        [-0.4, 2.4, cockpit.seatZ + 0.3],
        [0, 1.97, cockpit.yokeZ],
      ),
      fov: 65,
    },
    {
      ...shot(
        "Forward coaming and hull fit",
        [0, 2.6, cockpit.seatZ + 0.1],
        [0, 2.11, cockpit.panelZ - 0.2],
      ),
      fov: 75,
    },
    {
      ...shot(
        "Seat and footwell / left",
        [0, 2.15, -4.7],
        [-0.31, 1.7, cockpit.seatZ],
      ),
      fov: 68,
    },
    {
      ...shot(
        "Seat and footwell / right",
        [0, 2.15, -4.7],
        [0.31, 1.7, cockpit.seatZ],
      ),
      fov: 68,
    },
  ],
});
aureliaInspectionSheets.push({
  id: "exhaust",
  title: "Engine exhausts · recessed outlets",
  shots: [-1, 1].flatMap((side) =>
    [0, -0.45, 0.45].map((offset) =>
      shot(
        `${side < 0 ? "Left" : "Right"} exhaust · offset ${offset}`,
        [side * 1.3 + offset, 2.78 + Math.abs(offset) * 0.6, 6.3],
        [side * 1.3, 2.78, 4.45],
      ),
    ),
  ),
});
for (const gear of [1, 0]) {
  const shots: InspectionShot[] = [];
  for (const elevation of [-30, 0, 30])
    for (let azimuth = 0; azimuth < 360; azimuth += 30) {
      const a = T.MathUtils.degToRad(azimuth),
        e = T.MathUtils.degToRad(elevation),
        r = 29;
      shots.push(
        shot(
          `Az ${azimuth}° / El ${elevation}° / gear ${gear}`,
          [
            r * Math.cos(e) * Math.sin(a),
            2 + r * Math.sin(e),
            -r * Math.cos(e) * Math.cos(a),
          ],
          [0, 2, 0],
          { gear },
        ),
      );
    }
  shots.push(
    shot("Zenith", [0, 31, 0.001], [0, 2, 0], { gear }),
    shot("Nadir", [0, -27, 0.001], [0, 2, 0], { gear }),
  );
  for (let half = 0; half < 2; half++)
    aureliaInspectionSheets.push({
      id: `orbit-${gear}-${half}`,
      title: `Exterior · gear ${gear ? "down" : "up"} · ${half + 1}/2`,
      shots: shots.slice(half * 19, (half + 1) * 19),
    });
}
for (const side of [-1, 1])
  aureliaInspectionSheets.push({
    id: `main-${side}`,
    title: `${side < 0 ? "Left" : "Right"} main gear · full travel`,
    shots: sweep.map((gear) =>
      shot(
        `Gear ${Math.round(gear * 100)}%`,
        [side * 3.4, -1.1, -1.5],
        [side * 1.2, 1, 0.82],
        { gear },
      ),
    ),
  });
aureliaInspectionSheets.push({
  id: "nose",
  title: "Nose gear · full travel and steering",
  shots: [
    ...sweep.map((gear) =>
      shot(
        `Gear ${Math.round(gear * 100)}%`,
        [2, -0.7, -6.8 - cockpit.noseShift],
        [0, 1, -5.05 - cockpit.noseShift],
        {
          gear,
        },
      ),
    ),
    ...[-1, 0, 1].map((steering) =>
      shot(
        `Steering ${steering}`,
        [0, 0.5, -7.3 - cockpit.noseShift],
        [0, 0.65, -5.2 - cockpit.noseShift],
        {
          steering,
        },
      ),
    ),
  ],
});
for (const side of [-1, 1])
  for (const part of ["flap", "aileron"] as const) {
    const target: V =
      part === "flap" ? [side * 2.6, 1.3, 1.5] : [side * 5.5, 1.5, 2.5];
    const eye: V =
      part === "flap" ? [side * 3.5, 3.2, 6] : [side * 5.5, 3.4, 6.8];
    aureliaInspectionSheets.push({
      id: `${part}-${side}`,
      title: `${side < 0 ? "Left" : "Right"} ${part} · full travel`,
      shots: [
        ...Array.from({ length: 11 }, (_, i) =>
          shot(
            `${part} ${part === "flap" ? i * 10 : (i - 5) * 20}%`,
            eye,
            target,
            part === "flap" ? { flaps: i / 10 } : { roll: (i - 5) / 5 },
          ),
        ),
        ...[-1, 0, 1].map((input) =>
          shot(`Underside / ${input}`, [eye[0], -1, eye[2]], target, {
            flaps: (input + 1) / 2,
            roll: input,
          }),
        ),
      ],
    });
  }
aureliaInspectionSheets.push({
  id: "tail",
  title: "Tail controls · both signs and intermediate travel",
  shots: [
    ...Array.from({ length: 11 }, (_, i) =>
      shot(`Pitch / yaw ${(i - 5) * 20}%`, [6, 6, 11], [0, 3.6, 6.5], {
        pitch: (i - 5) / 5,
        yaw: (i - 5) / 5,
      }),
    ),
    ...[-1, 0, 1].map((pitch) =>
      shot(`Tail underside / pitch ${pitch}`, [-4, 2.5, 10], [0, 4.3, 6.3], {
        pitch,
        yaw: 1,
      }),
    ),
  ],
});
aureliaInspectionSheets.push({
  id: "entry",
  title: "Passenger entry · opening, lining and airstair",
  shots: [
    ...Array.from({ length: 11 }, (_, i) =>
      shot(`Entry ${i * 10}%`, [-4, 2.2, -4.3], [-0.7, 1.65, -3.82], {
        entry: i / 10,
      }),
    ),
    shot("Open / front", [-3, 1.5, -6], [-1, 1.3, -3.82], { entry: 1 }),
    shot("Open / aft", [-3, 1.5, -2], [-1, 1.3, -3.82], { entry: 1 }),
    shot("Open / above", [-3, 5, -3.82], [-1, 1.3, -3.82], { entry: 1 }),
    shot("Closed / underside", [-3, 0, -4], [-0.7, 1.6, -3.82]),
  ],
});
aureliaInspectionSheets.push({
  id: "engines-cabin",
  title: "Engine ducts, fan phases, cockpit and cabin",
  shots: [
    ...[-1, 1].flatMap((side) =>
      [0, 0.07, 0.14].map((fan) =>
        shot(
          `${side < 0 ? "Left" : "Right"} inlet / fan ${fan}`,
          [side * 1.45, 2.85, 1.3],
          [side * 1.3, 2.78, 3.5],
          { fan },
        ),
      ),
    ),
    ...[-1, 1].map((side) =>
      shot(
        `${side < 0 ? "Left" : "Right"} exhaust`,
        [side * 2, 3.1, 6],
        [side * 1.3, 2.78, 4],
      ),
    ),
    shot("Cabin / left", [-6, 4, -4], [0, 2, -0.5], {}, true),
    shot("Cabin / right", [6, 4, 3], [0, 2, -0.5], {}, true),
    shot("Cockpit / front", [-2, 3, -7], [0, 2, -4.8], {}, true),
    shot("Cockpit / aft", [-1.3, 2.8, -2.5], [0, 2, -4.8], {}, true),
    shot("Aisle / front", [0, 2.3, -3.3], [0, 2.1, 2], {}, true),
    shot("Cabin / top", [0, 8, 0.01], [0, 1.8, 0], {}, true),
  ],
});

aureliaInspectionSheets.push({
  id: "pod-attachments",
  title: "Flap fairings · attachment close-ups",
  shots: [-1, 1].flatMap((side) =>
    [0, 0.5, 1].map((flaps) =>
      shot(
        `${side < 0 ? "Left" : "Right"} / flaps ${flaps * 100}%`,
        [side * 3.1, 0.25, 5.2],
        [side * 3.05, 1.1, 1.9],
        { flaps, gear: 0 },
      ),
    ),
  ),
});

const floorY = aureliaInteriorLayout.floorY;
aureliaInspectionSheets.push({
  id: "cabin-bay-joints",
  title: "Cabin and gear bays · joints and enclosure",
  shots: [
    shot("Main doors / left", [-3, 0.35, -0.6], [-1.2, 1.05, 0.82]),
    shot("Main doors / right", [3, 0.35, -0.6], [1.2, 1.05, 0.82]),
    shot("Main doors / mid travel", [0.3, 0.3, -0.8], [1.2, 1.05, 0.82], {
      gear: 0.5,
    }),
    shot(
      "Cockpit floor / aisle",
      [0, floorY + 0.42, -2.95],
      [0, floorY, -4.15],
    ),
    shot(
      "Seat mounts / left",
      [0, floorY + 0.08, -1.4],
      [-0.42, floorY + 0.01, -0.55],
    ),
    shot(
      "Seat mounts / right",
      [0, floorY + 0.08, -1.4],
      [0.42, floorY + 0.01, -0.55],
    ),
    shot("Floor underside", [0, 1.1, -1], [0, 1.4, -2], {}, true),
    shot("Nose bay / straight up", [0, -1.4, -5.2], [0, 1.5, -5.2]),
    shot("Nose bay / oblique", [0.8, 0.8, -6.6], [0, 1.45, -5.4]),
    shot("Aft partition / aisle", [0, 2, -1.8], [0, 2, 2.86]),
    shot("Nose bay / mid travel", [0.8, 0.8, -6.6], [0, 1.45, -5.4], {
      gear: 0.5,
    }),
    shot("Nose bay / closed", [0.8, 0.8, -6.6], [0, 1.45, -5.4], { gear: 0 }),
  ],
});

aureliaInspectionSheets.push({
  id: "level-floor",
  title: "Continuous floor · cockpit, entry and cabin",
  shots: [
    shot(
      "Aisle toward flight deck",
      [0, floorY + 0.42, -2.95],
      [0, floorY + 0.04, -4.55],
    ),
    shot(
      "Flight deck toward cabin",
      [0, floorY + 0.6, -4.1],
      [0, floorY + 0.12, 1.8],
    ),
    shot(
      "Entry joint / left",
      [-0.3, floorY + 0.16, -3.4],
      [-0.3, floorY, -4.5],
    ),
    shot(
      "Entry joint / right",
      [0.3, floorY + 0.16, -3.4],
      [0.3, floorY, -4.5],
    ),
    shot(
      "Seat mounts / left",
      [0, floorY + 0.08, -1.4],
      [-0.42, floorY + 0.01, -0.55],
    ),
    shot(
      "Seat mounts / right",
      [0, floorY + 0.08, -1.4],
      [0.42, floorY + 0.01, -0.55],
    ),
    shot("Cabin / above", [0, 7, 0.01], [0, floorY, -0.3], {}, true),
    shot("Cabin / side", [-5, 2.3, 0], [0, 2.1, 0], {}, true),
    shot("Aft partition", [0, 2.15, -1.8], [0, 2.15, 2.86]),
    shot("Entry landing / open", [-3, 2, -4.6], [-0.8, floorY, -3.82], {
      entry: 1,
    }),
    shot("Airstair / front", [-3, 1.5, -6], [-1, 1.1, -3.82], { entry: 1 }),
    shot("Airstair / side", [-4, 1.1, -3.82], [-1, 1.1, -3.82], { entry: 1 }),
  ],
});

/** Reuses the current WebGL renderer and GLB; no second browser or GPU context. */
export async function exportInspectionSheet(
  sheet: InspectionSheet,
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  model: T.Group,
  setCutaway: (value: boolean) => void,
  beforeRender?: (pose: ExteriorPose) => void,
) {
  const width = 600,
    height = 360,
    caption = 34,
    columns = 3;
  const canvas = document.createElement("canvas");
  canvas.width = columns * width;
  canvas.height =
    Math.ceil(sheet.shots.length / columns) * (height + caption) + 52;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#eef1f0";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#172d39";
  context.font = "22px system-ui";
  context.fillText(sheet.title, 16, 34);
  const size = renderer.getSize(new T.Vector2()),
    ratio = renderer.getPixelRatio();
  const camera = new T.PerspectiveCamera(36, width / height, 0.02, 250);
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    for (const [i, shot] of sheet.shots.entries()) {
      setCutaway(Boolean(shot.cutaway));
      const pose = { ...neutralExteriorPose(), ...shot.pose };
      poseAureliaExterior(model, pose);
      beforeRender?.(pose);
      camera.fov = shot.fov ?? 36;
      camera.updateProjectionMatrix();
      camera.position.fromArray(shot.eye).multiplyScalar(aureliaAirframeScale);
      camera.lookAt(
        new T.Vector3()
          .fromArray(shot.target)
          .multiplyScalar(aureliaAirframeScale),
      );
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      const x = (i % columns) * width,
        y = Math.floor(i / columns) * (height + caption) + 52;
      context.drawImage(renderer.domElement, x, y, width, height);
      context.fillStyle = "#172d39";
      context.font = "16px system-ui";
      context.fillText(`${i + 1}. ${shot.label}`, x + 12, y + height + 23);
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Inspection PNG failed"))),
        "image/png",
      ),
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `aurelia-inspection-${sheet.id}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    renderer.setPixelRatio(ratio);
    renderer.setSize(size.x, size.y, false);
    canvas.width = canvas.height = 1;
  }
}
