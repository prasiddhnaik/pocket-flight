import * as T from "three";
import type { AircraftId } from "./aircraft";
import { runways, terrainHeight, WORLD_SIZE } from "../world/terrain";

export type DisplayTelemetry = {
  time: number;
  mode: "flight" | "replay" | "tunnel" | "demo";
  speed: number;
  altitude: number;
  pitch: number;
  roll: number;
  heading: number;
  verticalSpeed: number;
  power: number;
  fuel: number | null;
  x: number;
  z: number;
  engineOut: boolean;
  stall: boolean;
};
type DisplayFace = {
  center: [number, number, number];
  width: number;
  height: number;
  page: 0 | 1 | 2;
};
// Faces sit inside authored bezels, in unscaled glTF right/up/aft coordinates.
export function cockpitDisplayFaces(id: AircraftId): DisplayFace[] {
  // This CAD stage has no authored live-screen bezels yet.
  if (id === "f15c") return [];
  if (id === "heron") return [-0.42, 0, 0.42].map((x, i) => ({
    center: [x, 0.15, -2.02], width: 0.30, height: 0.22, page: i as 0 | 1 | 2,
  }));
  if (id === "finch")
    return [-0.295, 0.295].map((x, i) => ({
      center: [x, 0.46, -0.74],
      width: 0.245,
      height: 0.178,
      page: i === 0 ? 0 : 1,
    }));
  if (id === "peregrine")
    return [-9.923, -8.143].flatMap((z) =>
      [-0.33, 0, 0.33].map((x, i) => ({
        center: [x, 4.32, z],
        width: 0.222,
        height: 0.178,
        page: i as 0 | 1 | 2,
      })),
    );
  if (id === "aurelia")
    return [-0.87, -0.3, 0.3, 0.87].map((x, i) => ({
      center: [x, 4.04, -10.878],
      width: 0.396,
      height: 0.28,
      page: ([0, 1, 2, 0] as const)[i],
    }));
  return [-5.869, -4.289].flatMap((z) =>
    [-0.19, 0.19].map((x, i) => ({
      center: [x, 2.43, z],
      width: 0.263,
      height: 0.202,
      page: i === 0 ? 0 : 1,
    })),
  );
}
const W = 512,
  H = 384,
  deg = 180 / Math.PI;
export function displayDemo(time: number, speed = 48): DisplayTelemetry {
  return {
    time,
    mode: "demo",
    speed: speed + 7 * Math.sin(time * 0.25),
    altitude: 650 + 120 * Math.sin(time * 0.12),
    pitch: 0.1 * Math.sin(time * 0.45),
    roll: 0.32 * Math.sin(time * 0.28),
    heading: time * 0.035,
    verticalSpeed: 3 * Math.cos(time * 0.12),
    power: 0.64 + 0.2 * Math.sin(time * 0.23),
    fuel: 0.76,
    x: -260 + time * 8,
    z: 260 - time * 12,
    engineOut: false,
    stall: false,
  };
}

export class CockpitDisplays {
  readonly canvas = document.createElement("canvas");
  readonly texture: T.CanvasTexture;
  readonly mesh: T.Mesh;
  private context: CanvasRenderingContext2D;
  private map = document.createElement("canvas");
  private lastTime = -Infinity;
  private started: number | null = null;
  private booted = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private updates = 0;
  private drawingMs = 0;
  private telemetry: DisplayTelemetry | null = null;
  private ink: string;
  private disposed = false;
  private staticSymbols: T.Object3D[] = [];
  private id: AircraftId;
  constructor(root: T.Object3D, id: AircraftId) {
    this.id = id;
    // These exported batches contain only the old, raised screen symbols.
    // Keep bezels, switches and cockpit hardware; replace the static readings.
    root.traverse((node) => {
      const name = String(node.userData.name ?? node.name);
      const obsolete =
        id === "peregrine"
          ? /^Instrument_panel_[12] \| Markings \| soft off-white$/.test(name)
          : id === "aurelia" && name === "Cockpit | Pearl | warm ceramic white";
      if (obsolete && node.visible) {
        this.staticSymbols.push(node);
        node.visible = false;
      }
    });
    this.canvas.width = W * 3;
    this.canvas.height = H;
    this.context = this.canvas.getContext("2d", { alpha: false })!;
    this.ink = id === "peregrine" || id === "stormbird" ? "#b5efb5" : "#92e0e8";
    this.texture = new T.CanvasTexture(this.canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = this.texture.magFilter = T.LinearFilter;
    this.texture.name = `${id} live avionics atlas`;
    const positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    for (const face of cockpitDisplayFaces(id)) {
      const [x, y, z] = face.center,
        w = face.width / 2,
        h = face.height / 2,
        n = positions.length / 3;
      positions.push(
        x - w,
        y - h,
        z,
        x + w,
        y - h,
        z,
        x + w,
        y + h,
        z,
        x - w,
        y + h,
        z,
      );
      const u = face.page / 3,
        v = (face.page + 1) / 3;
      uvs.push(u, 0, v, 0, v, 1, u, 1);
      indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const material = new T.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
    });
    material.name = "Live cockpit displays";
    this.mesh = new T.Mesh(geometry, material);
    this.mesh.name = "Cockpit_live_displays";
    this.mesh.userData.mechanical = true;
    this.mesh.userData.cockpitDisplay = true;
    root.add(this.mesh);
    this.buildMap();
    this.update(displayDemo(0), true, true);
    this.started = null;
    this.lastTime = -Infinity;
  }
  private buildMap() {
    this.map.width = this.map.height = 128;
    const ctx = this.map.getContext("2d")!,
      image = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const height = terrainHeight(
            (x / 127 - 0.5) * WORLD_SIZE,
            (y / 127 - 0.5) * WORLD_SIZE,
          ),
          i = (y * 128 + x) * 4;
        const color =
          height > 3
            ? [33 + height * 0.07, 62 + height * 0.09, 57 + height * 0.02]
            : [13, 32, 43];
        image.data.set([...color, 255], i);
      }
    ctx.putImageData(image, 0, 0);
  }
  update(state: DisplayTelemetry, focused = true, force = false) {
    if (this.disposed || document.hidden) return false;
    if (
      !force &&
      Math.abs(state.time - this.lastTime) < (focused ? 0.05 : 0.5) &&
      state.mode === this.telemetry?.mode
    )
      return false;
    const start = performance.now();
    if (
      !this.booted &&
      (this.started === null ||
        state.mode !== this.telemetry?.mode ||
        state.time < this.lastTime)
    )
      this.started = state.time;
    this.started ??= state.time;
    this.booted ||= state.mode === "replay" || state.time - this.started >= 1.6;
    this.telemetry = { ...state };
    this.lastTime = state.time;
    for (let page = 0; page < 3; page++) {
      const ctx = this.context;
      ctx.save();
      ctx.translate(page * W, 0);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      ctx.fillStyle = "#081316";
      ctx.fillRect(0, 0, W, H);
      if (!this.booted) {
        this.boot(state, page);
      } else {
        if (page === 0) this.attitude(state);
        if (page === 1) this.navigation(state);
        if (page === 2) this.engine(state);
        this.chrome(state, page);
      }
      ctx.restore();
    }
    this.texture.needsUpdate = true;
    this.updates++;
    this.drawingMs = performance.now() - start;
    return true;
  }
  private text(
    value: string,
    x: number,
    y: number,
    size = 18,
    color = this.ink,
    align: CanvasTextAlign = "left",
  ) {
    const ctx = this.context;
    ctx.font = `500 ${size}px ui-monospace, SFMono-Regular, monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }
  private line(points: number[][], color: string, width = 2) {
    const c = this.context;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  private chrome(s: DisplayTelemetry, page: number) {
    const c = this.context;
    c.fillStyle = "#081316";
    c.fillRect(0, 0, W, 32);
    c.fillRect(0, H - 32, W, 32);
    this.text(
      ["PRIMARY FLIGHT", "LOCAL NAVIGATION", "ENGINE / SYSTEMS"][page],
      14,
      22,
      17,
    );
    this.text(
      s.mode === "demo"
        ? "DEMO"
        : s.mode === "tunnel"
          ? "RIG"
          : s.mode === "replay"
            ? "REPLAY"
            : "LIVE",
      W - 14,
      22,
      15,
      "#e9f0e4",
      "right",
    );
    c.fillStyle = this.ink;
    c.globalAlpha = 0.6 + 0.4 * Math.sin(s.time * 3) ** 2;
    c.beginPath();
    c.arc(W - 95, 17, 3, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    const heading = (((s.heading * deg) % 360) + 360) % 360;
    this.text(
      s.mode === "tunnel"
        ? "FIXTURE AXES"
        : `HDG ${Math.round(heading).toString().padStart(3, "0")}°`,
      14,
      H - 11,
      17,
      "#e8ede7",
    );
    this.text(
      s.engineOut
        ? "ENGINE OFF"
        : s.stall
          ? "STALL"
          : `${s.mode === "replay" ? "THR" : "POWER"} ${Math.round(s.power * 100)}%`,
      W - 14,
      H - 11,
      16,
      s.engineOut || s.stall ? "#f0b75b" : this.ink,
      "right",
    );
  }
  private boot(s: DisplayTelemetry, page: number) {
    const progress = T.MathUtils.clamp(
      (s.time - (this.started ?? 0)) / 1.6,
      0,
      1,
    );
    this.text("POCKET FLIGHT", W / 2, 132, 31, this.ink, "center");
    this.text(
      ["FLIGHT DISPLAY", "NAVIGATION DISPLAY", "SYSTEMS DISPLAY"][page],
      W / 2,
      169,
      16,
      "#c4d4d2",
      "center",
    );
    this.text("AVIONICS SELF TEST", W / 2, 222, 17, "#7b969a", "center");
    const c = this.context;
    c.fillStyle = "#21373a";
    c.fillRect(96, 247, 320, 4);
    c.fillStyle = this.ink;
    c.fillRect(96, 247, 320 * progress, 4);
    this.text(
      `${Math.round(progress * 100)}%`,
      W / 2,
      286,
      18,
      this.ink,
      "center",
    );
  }
  private attitude(s: DisplayTelemetry) {
    const c = this.context,
      cx = W / 2,
      cy = H / 2;
    c.save();
    c.beginPath();
    c.rect(91, 33, 330, 318);
    c.clip();
    c.translate(cx, cy);
    c.rotate(s.roll);
    const offset = T.MathUtils.clamp(s.pitch * deg, -80, 80) * 4;
    c.fillStyle = "#255a76";
    c.fillRect(-650, -900 + offset, 1300, 900);
    c.fillStyle = "#775a3d";
    c.fillRect(-650, offset, 1300, 900);
    this.line(
      [
        [-650, offset],
        [650, offset],
      ],
      "#e7f0e8",
      3,
    );
    for (let angle = -60; angle <= 60; angle += 5) {
      if (angle === 0) continue;
      const y = offset - angle * 4,
        w = angle % 10 === 0 ? 42 : 23;
      this.line(
        [
          [-w, y],
          [w, y],
        ],
        "#dce9e3",
        1.5,
      );
      if (angle % 10 === 0) {
        this.text(
          String(Math.abs(angle)),
          -w - 10,
          y + 5,
          15,
          "#e8ede7",
          "right",
        );
        this.text(String(Math.abs(angle)), w + 10, y + 5, 15, "#e8ede7");
      }
    }
    c.restore();
    this.line(
      [
        [190, 192],
        [230, 192],
        [238, 200],
        [256, 192],
        [274, 200],
        [282, 192],
        [322, 192],
      ],
      "#f2d18a",
      4,
    );
    this.tape(s.speed * 1.943844, 10, 10, 5, "KT TAS");
    this.tape(
      s.altitude * 3.28084,
      428,
      100,
      50,
      s.mode === "tunnel" ? "FT RIG" : "FT MSL",
    );
    this.text(
      `V/S ${Math.round(s.verticalSpeed * 196.8504)} FPM`,
      W / 2,
      337,
      14,
      "#e5ede8",
      "center",
    );
  }
  private tape(
    value: number,
    x: number,
    major: number,
    minor: number,
    label: string,
  ) {
    const c = this.context;
    c.fillStyle = "#102329";
    c.fillRect(x, 34, 74, 285);
    c.save();
    c.beginPath();
    c.rect(x, 40, 74, 267);
    c.clip();
    const base = Math.floor(value / minor) * minor;
    for (let d = -6; d <= 6; d++) {
      const n = base + d * minor,
        y = 192 + ((value - n) / minor) * 28;
      if (n < 0) continue;
      this.line(
        [
          [x + 58, y],
          [x + 72, y],
        ],
        "#8fadb0",
        1,
      );
      if (n % major === 0)
        this.text(String(Math.round(n)), x + 53, y + 5, 15, "#c5d6d6", "right");
    }
    c.restore();
    c.fillStyle = "#060e10";
    c.fillRect(x, 177, 74, 31);
    c.strokeStyle = this.ink;
    c.lineWidth = 1.5;
    c.strokeRect(x, 177, 74, 31);
    this.text(
      String(Math.max(0, Math.round(value))),
      x + 37,
      199,
      21,
      "#eff5ed",
      "center",
    );
    this.text(label, x + 37, 330, 12, this.ink, "center");
  }
  private navigation(s: DisplayTelemetry) {
    const c = this.context;
    c.drawImage(this.map, 104, 38, 304, 304);
    c.strokeStyle = "#436068";
    c.lineWidth = 0.7;
    for (let i = 0; i < 6; i++) {
      const x = 104 + i * 60.8;
      c.beginPath();
      c.moveTo(x, 38);
      c.lineTo(x, 342);
      c.stroke();
    }
    const px = (x: number) => 104 + (x / WORLD_SIZE + 0.5) * 304,
      pz = (z: number) => 38 + (z / WORLD_SIZE + 0.5) * 304;
    for (const r of runways) {
      const x = px(r.x),
        y = pz(r.z);
      c.save();
      c.translate(x, y);
      c.rotate(-r.heading);
      this.line(
        [
          [0, (-r.length / WORLD_SIZE) * 152],
          [0, (r.length / WORLD_SIZE) * 152],
        ],
        "#e6dca7",
        4,
      );
      c.restore();
      this.text(r.code, x + 8, y + 4, 13, "#dde6d9");
    }
    const x = px(s.x),
      y = pz(s.z);
    if (s.mode !== "tunnel" && x >= 104 && x <= 408 && y >= 38 && y <= 342) {
      c.save();
      c.translate(x, y);
      c.rotate(s.heading);
      this.line(
        [
          [0, -12],
          [-8, 9],
          [0, 4],
          [8, 9],
          [0, -12],
        ],
        this.ink,
        3,
      );
      c.restore();
    }
    this.text("N ↑", W - 22, 60, 17, "#d7e7e4", "right");
    this.text("PALM BAY · 1.5 NM", 54, 327, 14, "#c9d7d1");
  }
  private engine(s: DisplayTelemetry) {
    const c = this.context;
    [s.engineOut ? 0 : s.power, s.fuel].forEach((v, i) => {
      const y = 95 + i * 95;
      this.text(
        [s.mode === "replay" ? "THROTTLE" : "POWER", "FUEL"][i],
        25,
        y,
        19,
        "#c5d5d5",
      );
      c.fillStyle = "#203a40";
      c.fillRect(155, y - 22, 245, 24);
      if (v !== null) {
        c.fillStyle = i === 1 && v < 0.15 ? "#efb45a" : this.ink;
        c.fillRect(155, y - 22, 245 * T.MathUtils.clamp(v, 0, 1), 24);
      }
      this.text(
        v === null ? "—" : `${Math.round(v * 100)}%`,
        W - 22,
        y,
        22,
        "#e8eee7",
        "right",
      );
    });
    this.text(
      s.engineOut ? "ENGINE OFF" : "ENGINE AVAILABLE",
      25,
      278,
      21,
      s.engineOut ? "#efb45a" : this.ink,
    );
    this.text(
      s.mode === "replay"
        ? "RECORDED THROTTLE · FUEL NOT RECORDED"
        : s.mode === "flight"
          ? "ENGINE POWER / AVAILABLE FUEL"
          : s.mode === "tunnel"
            ? "STATIONARY TEST RIG · POWER UNAVAILABLE"
            : "DISPLAY DEMONSTRATION",
      25,
      326,
      13,
      "#869fa3",
    );
  }
  viewTarget(root: T.Object3D) {
    const faces = cockpitDisplayFaces(this.id),
      front = Math.min(...faces.map((f) => f.center[2])),
      row = faces.filter((f) => f.center[2] === front);
    root.updateWorldMatrix(true, true);
    const bounds = new T.Box3();
    for (const face of row)
      for (const sign of [-1, 1])
        bounds.expandByPoint(
          root.localToWorld(
            new T.Vector3(
              face.center[0] + (sign * face.width) / 2,
              face.center[1] + (sign * face.height) / 2,
              face.center[2],
            ),
          ),
        );
    const center = bounds.getCenter(new T.Vector3()),
      width = bounds.getSize(new T.Vector3()).x;
    const rotation = root.getWorldQuaternion(new T.Quaternion());
    return {
      center,
      width,
      forward: new T.Vector3(0, 0, 1).applyQuaternion(rotation),
      up: new T.Vector3(0, 1, 0).applyQuaternion(rotation),
    };
  }

  diagnostics() {
    return {
      screens: this.mesh.geometry.getAttribute("position").count / 4,
      ready: this.booted,
      replacedStaticBatches: this.staticSymbols.length,
      updates: this.updates,
      drawingMs: this.drawingMs,
      textureVersion: this.texture.version,
      textureBytes: W * 3 * H * 4,
      state: this.telemetry,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.staticSymbols.forEach((node) => {
      node.visible = true;
    });
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as T.Material).dispose();
    this.texture.dispose();
    this.canvas.width = this.map.width = 1;
  }
}
