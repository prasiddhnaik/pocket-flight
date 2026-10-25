import * as T from "three";
import {
  avionicsUtc,
  projectAureliaMap,
  shouldRenderAureliaAvionics,
  type AureliaAvionicsState,
} from "./avionics-state";

const white = "#eff5fa",
  cyan = "#70dfff",
  green = "#70ed9b",
  muted = "#9aabbf";
const magenta = "#ed84ff",
  dark = "#080f19";
type Page = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: T.CanvasTexture;
};

/** Reference-viewer avionics. Textures replace mounted glass faces; no overlay geometry. */
export class AureliaAvionics {
  private pages = new Map<string, Page>();
  private bindings: {
    mesh: T.Mesh;
    geometry: T.BufferGeometry;
    material: T.Material | T.Material[];
    replacement: T.MeshBasicMaterial;
  }[] = [];
  private lastTime = -Infinity;
  private state: AureliaAvionicsState | null = null;
  private disposed = false;
  updates = 0;
  constructor(root: T.Object3D, initialState: AureliaAvionicsState) {
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      let page: string | undefined,
        axis: "y" | "z" = "z";
      if (object.name.startsWith("Inactive_screen"))
        page = object.parent?.userData.avionicsDisplay;
      if (object.name.startsWith("Touch_controller_placeholder")) {
        page = object.userData.avionicsDisplay;
        axis = "y";
      }
      const legend: unknown = object.userData.cockpitLegend;
      if (typeof legend === "string") {
        page = `legend-${legend}`;
        axis = object.userData.legendAxis === "y" ? "y" : "z";
      }
      if (!page) return;
      if (!this.pages.has(page)) {
        const canvas = document.createElement("canvas");
        canvas.width = page.startsWith("legend")
          ? 1536
          : page.startsWith("touch")
            ? 256
            : 640;
        canvas.height = page.startsWith("legend")
          ? page === "legend-throttle"
            ? 1024
            : 96
          : page.startsWith("touch")
            ? 320
            : 400;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Avionics require a 2D canvas");
        const texture = new T.CanvasTexture(canvas);
        texture.colorSpace = T.SRGBColorSpace;
        texture.generateMipmaps = false;
        texture.minFilter = texture.magFilter = T.LinearFilter;
        texture.name = `Aurelia ${page} display`;
        const item = { canvas, ctx, texture };
        this.pages.set(page, item);
        if (page.startsWith("legend")) this.legend(item, page.slice(7));
      }
      this.bind(object, this.pages.get(page)!.texture, axis);
    });
    if (
      this.bindings.filter(({ mesh }) =>
        /Inactive_screen|Touch_controller_placeholder/.test(mesh.name),
      ).length !== 5
    )
      throw new Error(
        "Expected three primary screens and two touch controllers",
      );
    this.update(initialState, true);
  }
  private bind(mesh: T.Mesh, texture: T.CanvasTexture, axis: "y" | "z") {
    const geometry = mesh.geometry.clone(),
      positions = geometry.getAttribute("position");
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!,
      size = bounds.getSize(new T.Vector3());
    const uv: number[] = [],
      front: number[] = [],
      back: number[] = [];
    for (let i = 0; i < positions.count; i++)
      uv.push(
        (positions.getX(i) - bounds.min.x) / size.x,
        axis === "z"
          ? (positions.getY(i) - bounds.min.y) / size.y
          : (bounds.max.z - positions.getZ(i)) / size.z,
      );
    const index = geometry.index!,
      a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      a.fromBufferAttribute(positions, ids[0]);
      b.fromBufferAttribute(positions, ids[1]);
      c.fromBufferAttribute(positions, ids[2]);
      const normal = b.sub(a).cross(c.sub(a)).normalize();
      (normal[axis] > 0.5 ? front : back).push(...ids);
    }
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geometry.setIndex([...back, ...front]);
    geometry.clearGroups();
    geometry.addGroup(0, back.length, 0);
    geometry.addGroup(back.length, front.length, 1);
    const replacement = new T.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
    });
    replacement.name = `${mesh.name} illuminated face`;
    this.bindings.push({
      mesh,
      geometry: mesh.geometry,
      material: mesh.material,
      replacement,
    });
    mesh.geometry = geometry;
    mesh.material = [
      Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
      replacement,
    ];
  }
  update(state: AureliaAvionicsState, force = false, focused = true) {
    if (this.disposed || document.hidden) return false;
    const now = performance.now() / 1000;
    if (
      !force &&
      !shouldRenderAureliaAvionics(
        this.state,
        state,
        now - this.lastTime,
        focused,
      )
    )
      return false;
    this.lastTime = now;
    this.state = state;
    for (const [name, page] of this.pages) {
      if (name.startsWith("legend")) continue;
      page.ctx.fillStyle = dark;
      page.ctx.fillRect(0, 0, page.canvas.width, page.canvas.height);
      if (name === "pfd") this.pfd(page.ctx, this.state);
      else if (name === "mfd") this.mfd(page.ctx, this.state);
      else this.touch(page.ctx, this.state, name === "touch-systems");
      page.texture.needsUpdate = true;
    }
    this.updates++;
    return true;
  }
  snapshot() {
    return {
      updates: this.updates,
      screens: 5,
      canvases: this.pages.size,
      texturePixels: [...this.pages.values()].reduce(
        (n, p) => n + p.canvas.width * p.canvas.height,
        0,
      ),
      state: this.state ? structuredClone(this.state) : null,
    };
  }
  dispose() {
    if (this.disposed) return;
    for (const { mesh, geometry, material, replacement } of this.bindings) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.material = material;
      replacement.dispose();
    }
    for (const { texture, canvas } of this.pages.values()) {
      texture.dispose();
      canvas.width = canvas.height = 1;
    }
    this.bindings = [];
    this.pages.clear();
    this.disposed = true;
  }
  private text(
    c: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    size = 16,
    color = white,
    align: CanvasTextAlign = "left",
  ) {
    c.fillStyle = color;
    c.font = `600 ${size}px ui-monospace, SFMono-Regular, monospace`;
    c.textAlign = align;
    c.fillText(value, x, y);
  }
  private line(
    c: CanvasRenderingContext2D,
    points: number[][],
    color = white,
    width = 2,
  ) {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  private pfd(c: CanvasRenderingContext2D, s: AureliaAvionicsState) {
    c.save();
    c.beginPath();
    c.rect(76, 32, 477, 226);
    c.clip();
    c.translate(320, 148);
    c.rotate(s.roll);
    const horizon = s.pitch * 330;
    const sky = c.createLinearGradient(0, -180, 0, horizon);
    sky.addColorStop(0, "#063269");
    sky.addColorStop(1, "#419acb");
    c.fillStyle = sky;
    c.fillRect(-700, -700 + horizon, 1400, 700);
    c.fillStyle = "#715741";
    c.fillRect(-700, horizon, 1400, 700);
    this.line(
      c,
      [
        [-700, horizon],
        [700, horizon],
      ],
      white,
      2,
    );
    for (let angle = -30; angle <= 30; angle += 5) {
      if (!angle) continue;
      const y = horizon - ((angle * Math.PI) / 180) * 330,
        w = angle % 10 ? 16 : 30;
      this.line(
        c,
        [
          [-w, y],
          [w, y],
        ],
        white,
        1.5,
      );
      if (angle % 10 === 0) {
        this.text(c, `${Math.abs(angle)}`, -w - 9, y + 4, 12, white, "right");
        this.text(c, `${Math.abs(angle)}`, w + 9, y + 4, 12);
      }
    }
    c.restore();
    // Fixed aircraft symbol and magenta flight-director bars.
    this.line(
      c,
      [
        [245, 148],
        [291, 148],
        [291, 157],
      ],
      "#ffe267",
      4,
    );
    this.line(
      c,
      [
        [395, 148],
        [349, 148],
        [349, 157],
      ],
      "#ffe267",
      4,
    );
    c.fillStyle = "#ffe267";
    c.fillRect(316, 145, 8, 7);
    this.line(
      c,
      [
        [
          272,
          148 +
            T.MathUtils.clamp(
              (s.pitch - s.guidance.directorPitchRad) * 330,
              -65,
              65,
            ),
        ],
        [
          368,
          148 +
            T.MathUtils.clamp(
              (s.pitch - s.guidance.directorPitchRad) * 330,
              -65,
              65,
            ),
        ],
      ],
      magenta,
      3,
    );
    this.line(
      c,
      [
        [
          320 +
            T.MathUtils.clamp(
              (s.guidance.directorRollRad - s.roll) * 320,
              -65,
              65,
            ),
          108,
        ],
        [
          320 +
            T.MathUtils.clamp(
              (s.guidance.directorRollRad - s.roll) * 320,
              -65,
              65,
            ),
          188,
        ],
      ],
      magenta,
      3,
    );
    this.tape(c, s.speedKt, 7, 10, 5, "IAS", 3);
    this.tape(c, s.altitudeFt, 556, 100, 50, "ALT", 5);
    c.fillStyle = dark;
    c.fillRect(0, 0, 640, 31);
    this.text(c, s.guidance.verticalMode, 17, 21, 17, green);
    this.text(
      c,
      `${s.guidance.autopilot ? "AP" : ""}   ${s.guidance.yawDamper ? "YD" : ""}`,
      216,
      21,
      17,
      green,
    );
    this.text(c, s.guidance.lateralMode, 365, 21, 17, green);
    this.text(
      c,
      `ALT ${Math.round(s.guidance.selectedAltitudeFt).toLocaleString("en-US")}`,
      472,
      21,
      15,
      cyan,
    );
    this.text(
      c,
      s.source === "demo"
        ? "AVIONICS DEMO"
        : s.source === "replay"
          ? "REPLAY"
          : "",
      320,
      246,
      12,
      "#d5e3ef",
      "center",
    );
    // HSI compass and supplied desired course, relative to the aircraft heading.
    const cx = 320,
      cy = 326,
      r = 58;
    c.save();
    c.translate(cx, cy);
    c.rotate((-s.headingDeg * Math.PI) / 180);
    for (let angle = 0; angle < 360; angle += 10) {
      const a = (angle * Math.PI) / 180;
      this.line(
        c,
        [
          [
            Math.sin(a) * (r - (angle % 30 ? 5 : 10)),
            -Math.cos(a) * (r - (angle % 30 ? 5 : 10)),
          ],
          [Math.sin(a) * r, -Math.cos(a) * r],
        ],
        muted,
        1,
      );
      if (angle % 30 === 0)
        this.text(
          c,
          ({ 0: "N", 90: "E", 180: "S", 270: "W" } as Record<number, string>)[
            angle
          ] ?? String(angle / 10),
          Math.sin(a) * 43,
          -Math.cos(a) * 43 + 4,
          12,
          white,
          "center",
        );
    }
    c.restore();
    c.save();
    c.translate(cx, cy);
    c.rotate(((s.navigation.desiredTrackDeg - s.headingDeg) * Math.PI) / 180);
    this.line(
      c,
      [
        [0, -40],
        [0, 36],
      ],
      magenta,
      2,
    );
    this.line(
      c,
      [
        [-6, -32],
        [0, -40],
        [6, -32],
      ],
      magenta,
      2,
    );
    c.restore();
    this.line(
      c,
      [
        [305, 326],
        [335, 326],
      ],
      white,
      3,
    );
    this.text(
      c,
      `${Math.round(s.headingDeg).toString().padStart(3, "0")}°`,
      320,
      274,
      18,
      white,
      "center",
    );
    this.text(c, "GPS  ENR", 108, 292, 14, magenta);
    this.text(c, `GS ${Math.round(s.groundSpeedKt)} KT`, 108, 318, 14);
    this.text(c, `BARO ${s.radio.baroInHg.toFixed(2)}`, 470, 292, 14, cyan);
    this.text(
      c,
      `${Math.round(s.verticalSpeedFpm / 10) * 10} FPM`,
      470,
      318,
      14,
    );
    this.text(c, `COM1  ${s.radio.com1MHz.toFixed(3)}`, 10, 390, 13, cyan);
    this.text(
      c,
      `XPDR  ${s.radio.transponderCode} ${s.radio.transponderMode}`,
      628,
      390,
      13,
      cyan,
      "right",
    );
  }
  private tape(
    c: CanvasRenderingContext2D,
    value: number,
    x: number,
    major: number,
    minor: number,
    label: string,
    digits: number,
  ) {
    c.fillStyle = "#152233";
    c.fillRect(x, 33, 72, 225);
    c.save();
    c.beginPath();
    c.rect(x, 34, 72, 222);
    c.clip();
    const base = Math.floor(value / minor) * minor;
    for (let i = -7; i <= 7; i++) {
      const n = base + i * minor,
        y = 148 + ((value - n) / minor) * 26;
      if (n < 0) continue;
      this.line(
        c,
        [
          [x + 61, y],
          [x + 70, y],
        ],
        muted,
        1,
      );
      if (n % major === 0)
        this.text(
          c,
          String(n),
          x + 57,
          y + 5,
          digits === 5 ? 12 : 17,
          white,
          "right",
        );
    }
    c.fillStyle = "#050b13";
    c.fillRect(x + 1, 132, 67, 33);
    c.strokeStyle = white;
    c.lineWidth = 1;
    c.strokeRect(x + 1, 132, 67, 33);
    this.text(
      c,
      Math.round(value).toString().padStart(digits, "0"),
      x + 35,
      155,
      digits === 5 ? 18 : 23,
      white,
      "center",
    );
    c.restore();
    this.text(c, label, x + 35, 50, 12, cyan, "center");
  }
  private mfd(c: CanvasRenderingContext2D, s: AureliaAvionicsState) {
    c.fillStyle = "#142a31";
    c.fillRect(0, 30, 466, 335);
    c.save();
    c.beginPath();
    c.rect(0, 30, 466, 335);
    c.clip();
    const project = (point: { x: number; z: number }) =>
      projectAureliaMap(point, s.navigation, s.headingDeg);
    for (const area of s.navigation.terrain) {
      if (area.points.length < 3) continue;
      c.fillStyle = area.color;
      c.beginPath();
      area.points.forEach((point, i) => {
        const [x, y] = project(point);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.closePath();
      c.fill();
    }
    for (const runway of s.navigation.runways) {
      this.line(c, [project(runway.start), project(runway.end)], white, 4);
      const [x, y] = project(runway.start);
      this.text(c, runway.id, x + 8, y - 7, 11, cyan);
    }
    this.line(c, s.navigation.route.map(project), magenta, 3);
    for (const point of s.navigation.route) {
      const [x, y] = project(point);
      c.strokeStyle = magenta;
      c.strokeRect(x - 4, y - 4, 8, 8);
      this.text(c, point.id, x + 12, y + 5, 13);
    }
    c.restore();
    // Geometry moves relative to the supplied aircraft position. Rings describe distance.
    c.strokeStyle = "#789da8";
    c.lineWidth = 1;
    for (const r of [70, 140]) {
      c.beginPath();
      c.arc(234, 276, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.save();
    c.translate(234, 276);
    if (s.navigation.orientation === "north-up")
      c.rotate((s.headingDeg * Math.PI) / 180);
    this.line(
      c,
      [
        [0, -19],
        [0, 18],
        [-16, 5],
        [16, 5],
      ],
      white,
      3,
    );
    c.restore();
    c.fillStyle = dark;
    c.fillRect(0, 0, 640, 30);
    c.fillRect(0, 365, 640, 35);
    this.text(
      c,
      `MAP  ·  ${s.source === "demo" ? "AVIONICS DEMO" : s.navigation.orientation.toUpperCase()}`,
      12,
      21,
      16,
    );
    this.text(c, `${s.navigation.rangeNm} NM`, 450, 354, 13, cyan, "right");
    this.text(
      c,
      `DTK ${Math.round(s.navigation.desiredTrackDeg).toString().padStart(3, "0")}°   GS ${Math.round(s.groundSpeedKt)} KT`,
      12,
      388,
      14,
      cyan,
    );
    this.text(c, "ENGINE / FUEL", 550, 22, 13, white, "center");
    this.text(c, "L     R", 551, 58, 15, muted, "center");
    for (const [j, x] of [508, 590].entries()) {
      const engine = s.engines[j];
      c.strokeStyle = "#263b4a";
      c.lineWidth = 8;
      c.beginPath();
      c.arc(x, 104, 31, Math.PI * 0.8, Math.PI * 2.2);
      c.stroke();
      c.strokeStyle = green;
      c.beginPath();
      c.arc(
        x,
        104,
        31,
        Math.PI * 0.8,
        Math.PI * (0.8 + (T.MathUtils.clamp(engine.n1, 0, 110) / 100) * 1.4),
      );
      c.stroke();
      this.text(c, engine.n1.toFixed(1), x, 111, 17, green, "center");
      this.text(
        c,
        String(Math.round(engine.ittC)),
        x,
        183,
        19,
        green,
        "center",
      );
      this.text(c, engine.n2.toFixed(1), x, 233, 17, green, "center");
      this.text(
        c,
        `${Math.round(engine.oilPsi)} / ${Math.round(engine.oilC)}`,
        x,
        281,
        12,
        green,
        "center",
      );
      this.text(
        c,
        String(Math.round(engine.fuelLb)),
        x,
        331,
        17,
        green,
        "center",
      );
    }
    this.text(c, "N1 %", 550, 150, 12, muted, "center");
    this.text(c, "ITT °C", 550, 204, 12, muted, "center");
    this.text(c, "N2 %", 550, 254, 12, muted, "center");
    this.text(c, "OIL PSI/°C", 550, 302, 11, muted, "center");
    this.text(c, "FUEL LB", 550, 355, 12, muted, "center");
  }
  private touch(
    c: CanvasRenderingContext2D,
    s: AureliaAvionicsState,
    systems: boolean,
  ) {
    this.text(
      c,
      systems ? "AIRCRAFT SYSTEMS" : "PFD HOME",
      128,
      23,
      15,
      cyan,
      "center",
    );
    const labels = systems
      ? ["GEAR", "FLAPS", "FUEL", "ELECTRICAL", "LIGHTING", "CHECKLIST"]
      : [
          "FLIGHT PLAN",
          "PROCEDURES",
          "RADIO",
          "AUDIO",
          "TRANSPONDER",
          "PFD SETTINGS",
        ];
    for (let i = 0; i < 6; i++) {
      const x = 8 + (i % 2) * 124,
        y = 40 + Math.floor(i / 2) * 80;
      const gradient = c.createLinearGradient(0, y, 0, y + 70);
      gradient.addColorStop(0, "#263f58");
      gradient.addColorStop(1, "#122234");
      c.fillStyle = gradient;
      c.fillRect(x, y, 116, 69);
      c.strokeStyle = "#4e7894";
      c.lineWidth = 1;
      c.strokeRect(x, y, 116, 69);
      const value =
        systems && i === 2
          ? `${Math.round(s.engines[0].fuelLb + s.engines[1].fuelLb)} LB`
          : systems && i === 3
            ? `${s.busVoltage.toFixed(1)} V`
            : ["◇", "≡", "◉", "+", "↗", "☰"][i];
      this.text(
        c,
        value,
        x + 58,
        y + 29,
        systems && (i === 2 || i === 3) ? 15 : 22,
        cyan,
        "center",
      );
      this.text(c, labels[i], x + 58, y + 55, 10, white, "center");
    }
    c.fillStyle = "#102334";
    c.fillRect(8, 283, 240, 29);
    const gear = s.gear > 0.99 ? "DOWN" : s.gear < 0.01 ? "UP" : "TRANSIT";
    this.text(
      c,
      systems
        ? `GEAR ${gear}   FLAPS ${Math.round(s.flaps * 100)}%`
        : `COM1 ${s.radio.com1MHz.toFixed(3)}  ${avionicsUtc(s.utcSeconds)}`,
      128,
      302,
      11,
      systems && gear === "TRANSIT" ? "#ffcf72" : green,
      "center",
    );
  }
  private legend({ canvas, ctx: c, texture }: Page, name: string) {
    c.fillStyle = "#171e22";
    c.fillRect(0, 0, canvas.width, canvas.height);
    if (name === "guidance") {
      for (const [label, x] of [
        ["CRS", 85],
        ["HDG", 355],
        ["ALT SEL", 1180],
        ["VS", 1450],
      ] as const)
        this.text(c, label, x, 22, 18, white, "center");
      for (const [i, label] of [
        "FD",
        "AP",
        "YD",
        "NAV",
        "APR",
        "FLC",
        "VS",
      ].entries())
        this.text(c, label, 512 + i * 85, 26, 17, white, "center");
    } else if (name === "lower") {
      for (const [i, label] of [
        "PFD / RANGE",
        "BARO",
        "AURELIA · PRODIGY STYLE",
        "SYSTEMS",
        "PFD / RANGE",
      ].entries())
        this.text(
          c,
          label,
          150 + i * 310,
          62,
          25,
          i === 2 ? cyan : white,
          "center",
        );
    } else if (name === "yoke")
      this.text(c, "AURELIA", 768, 66, 57, muted, "center");
    else {
      this.text(c, "THRUST", 768, 160, 90, muted, "center");
      for (const [i, label] of ["TO / GA", "CLB", "CRZ", "IDLE"].entries()) {
        this.text(c, label, 768, 350 + i * 170, 76, white, "center");
        this.line(
          c,
          [
            [80, 320 + i * 170],
            [390, 320 + i * 170],
          ],
          muted,
          9,
        );
        this.line(
          c,
          [
            [1146, 320 + i * 170],
            [1456, 320 + i * 170],
          ],
          muted,
          9,
        );
      }
    }
    texture.needsUpdate = true;
  }
}
