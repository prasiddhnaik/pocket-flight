import * as T from "three";
import { villageRoof, hangarRoof, groundPath } from "./scenery-geometry";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  terrainHeight,
  runways,
  runwayLocal,
  random,
  WORLD_SIZE,
  TERRAIN_SEGMENTS,
  RUNWAY_PAVEMENT_HEIGHT,
  APRON_PAVEMENT_HEIGHT,
} from "./terrain";
export type Obstacle = {
  x: number;
  y: number;
  z: number;
  radius: number;
  label: string;
};
export function makeWorld(scene: T.Scene) {
  const rng = random(512),
    obstacles: Obstacle[] = [];
  const mat = (color: string, roughness = 0.85) =>
    new T.MeshStandardMaterial({ color, roughness });
  const white = mat("#f8f0dd"),
    wood = mat("#796958"),
    sand = mat("#e9d7ac"),
    roof = mat("#cd7552"),
    dark = mat("#46575a"),
    red = mat("#ed8c63");
  function mesh(
    g: T.BufferGeometry,
    m: T.Material,
    x = 0,
    y = 0,
    z = 0,
    parent: T.Object3D = scene,
  ) {
    const a = new T.Mesh(g, m);
    a.position.set(x, y, z);
    a.castShadow = true;
    a.receiveShadow = true;
    parent.add(a);
    return a;
  }
  const sphere = new T.SphereGeometry(1, 20, 14);
  function ball(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    m: T.Material,
    parent: T.Object3D = scene,
  ) {
    const o = mesh(sphere, m, x, y, z, parent);
    o.scale.set(sx, sy, sz);
    return o;
  }
  function box(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    m: T.Material,
    parent: T.Object3D = scene,
  ) {
    return mesh(
      new RoundedBoxGeometry(
        sx,
        sy,
        sz,
        2,
        Math.min(1, sx * 0.08, sy * 0.08, sz * 0.08),
      ),
      m,
      x,
      y,
      z,
      parent,
    );
  }
  const ambient = new T.HemisphereLight("#c5f0fa", "#76845a", 1.55);
  scene.add(ambient);
  const sun = new T.DirectionalLight("#fff0d0", 2.7);
  sun.position.set(-600, 900, 500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -700,
    right: 700,
    top: 700,
    bottom: -700,
    near: 50,
    far: 2200,
  });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 1.6;
  scene.add(sun);
  scene.add(sun.target);
  scene.background = new T.Color("#a8dce5");
  scene.fog = new T.FogExp2("#badfe1", 0.00027);
  const terrain = new T.PlaneGeometry(
    WORLD_SIZE,
    WORLD_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  terrain.rotateX(-Math.PI / 2);
  const pos = terrain.attributes.position;
  const colors = [];
  const beachColor = new T.Color("#e6d3a4"),
    grass = new T.Color("#55794b"),
    forest = new T.Color("#355e47"),
    stone = new T.Color("#8f9581");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i),
      h = terrainHeight(x, z);
    pos.setY(i, h);
    const c = beachColor.clone();
    if (h > 5) c.lerp(grass, Math.min(1, (h - 5) / 16));
    if (h > 35) c.lerp(forest, Math.min(0.65, (h - 35) / 130));
    const slope =
      Math.abs(terrainHeight(x + 6, z) - h) +
      Math.abs(terrainHeight(x, z + 6) - h);
    if (slope > 7 || h > 190)
      c.lerp(stone, Math.min(0.88, Math.max((slope - 7) / 14, (h - 190) / 55)));
    if (slope > 9)
      c.multiplyScalar(0.9 + Math.sin(h * 0.12 + x * 0.014) * 0.06);
    const n = Math.sin(x * 0.08 + z * 0.055) * Math.sin(z * 0.065) * 0.035;
    c.offsetHSL(n * 0.2, n * 0.5, n);
    colors.push(c.r, c.g, c.b);
  }
  terrain.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  terrain.computeVertexNormals();
  const land = mesh(
    terrain,
    new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  land.castShadow = false;
  const depthData = new Uint8Array(256 * 256 * 4);
  for (let z = 0; z < 256; z++)
    for (let x = 0; x < 256; x++) {
      const h = terrainHeight(
        (x / 255 - 0.5) * WORLD_SIZE,
        (z / 255 - 0.5) * WORLD_SIZE,
      );
      const i = (z * 256 + x) * 4;
      depthData[i] = Math.round(Math.max(0, Math.min(1, (h + 45) / 320)) * 255);
      depthData[i + 3] = 255;
    }
  const heightmap = new T.DataTexture(depthData, 256, 256);
  heightmap.needsUpdate = true;
  heightmap.magFilter = T.LinearFilter;
  heightmap.minFilter = T.LinearFilter;
  const oceanMaterial = new T.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      heightmap: { value: heightmap },
      night: { value: 0 },
      fogColor: { value: scene.background },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main(){
        vec4 w=modelMatrix*vec4(position,1.);
        vWorld=w.xyz;
        gl_Position=projectionMatrix*viewMatrix*w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
 #include <logdepthbuf_pars_fragment>
 uniform float time; uniform sampler2D heightmap; uniform float night; uniform vec3 fogColor; varying vec3 vWorld;
 void main(){vec2 p=vWorld.xz;vec2 uv=p/2800.+.5;float h=texture2D(heightmap,clamp(uv,0.,1.)).r*320.-45.; if(abs(p.x)>1400.||abs(p.y)>1400.)h=-45.;float depth=max(0.,-h);
 vec3 shallow=vec3(.075,.49,.40),deep=vec3(.014,.20,.26);vec3 color=mix(shallow,deep,smoothstep(0.,34.,depth));
 float wave=sin(p.x*.15+time*.8+sin(p.y*.11))*sin(p.y*.16-time*.45)+sin(p.x*.041+p.y*.052+time*.35)*.8;
 color+=wave*.018;float foam=(1.-smoothstep(.6,5.,depth))*smoothstep(.25,.8,sin(depth*2.2-time*1.1+sin(p.x*.04)))*.35;color=mix(color,vec3(.82,.94,.85),foam);
 float sparkle=pow(max(0.,sin(p.x*.42+time)*sin(p.y*.39-time*.5)),28.);color+=sparkle*.19;
 color*=mix(1.,.29,night);float fog=smoothstep(1500.,6000.,length(p-cameraPosition.xz));
 #include <logdepthbuf_fragment>
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 gl_FragColor.rgb=mix(gl_FragColor.rgb,linearToOutputTexel(vec4(fogColor,1.)).rgb,fog);
 }
 `,
  });
  const ocean = mesh(new T.PlaneGeometry(15000, 15000), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = 0.1;
  ocean.castShadow = false;
  ocean.receiveShadow = false;
  // Airfields: textured markings, edge lights, apron, hangars, and wind indicators.
  const windsocks: T.Group[] = [],
    nightLights: T.Mesh[] = [];
  for (const [index, r] of runways.entries()) {
    const g = new T.Group();
    g.position.set(r.x, r.y + 0.22, r.z);
    g.rotation.y = r.heading;
    scene.add(g);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 2048;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#656f6b";
    ctx.fillRect(0, 0, 256, 2048);
    for (let i = 0; i < 24000; i++) {
      ctx.fillStyle = `rgba(220,220,200,${rng() * 0.1})`;
      ctx.fillRect(rng() * 256, rng() * 2048, 1.2, 1.2);
    }
    ctx.fillStyle = "#e9e9d7";
    ctx.fillRect(9, 0, 3, 2048);
    ctx.fillRect(244, 0, 3, 2048);
    for (let z = 320; z < 1750; z += 170) ctx.fillRect(125, z, 6, 82);
    for (const end of [0, 1]) {
      ctx.save();
      if (end) {
        ctx.translate(256, 2048);
        ctx.rotate(Math.PI);
      }
      for (let x = 25; x < 235; x += 27) ctx.fillRect(x, 65, 16, 130);
      ctx.font = "bold 98px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(end ? "19" : r.code, 128, 295);
      ctx.restore();
    }
    const texture = new T.CanvasTexture(canvas);
    texture.anisotropy = 8;
    texture.colorSpace = T.SRGBColorSpace;
    const tarmac = mesh(
      new T.PlaneGeometry(r.width, r.length),
      new T.MeshStandardMaterial({ map: texture, roughness: 0.96 }),
      0,
      RUNWAY_PAVEMENT_HEIGHT - 0.22,
      0,
      g,
    );
    tarmac.rotation.x = -Math.PI / 2;
    tarmac.castShadow = false;
    for (const side of [-1, 1])
      for (let z = -r.length / 2 + 5; z < r.length / 2; z += 28) {
        const bulb = ball(
          side * (r.width / 2 + 2),
          0.25,
          z,
          0.35,
          0.3,
          0.35,
          new T.MeshBasicMaterial({ color: "#fff1bb" }),
          g,
        );
        nightLights.push(bulb);
      }
    const apron = mesh(
      new T.PlaneGeometry(64, 110),
      mat("#949482"),
      44,
      APRON_PAVEMENT_HEIGHT - 0.22,
      70,
      g,
    );
    apron.rotation.x = -Math.PI / 2;
    for (let i = 0; i < (index === 0 ? 3 : 1); i++) {
      box(69, 5.3, i * 32 + 25, 23, 10.6, 24, white, g);
      mesh(hangarRoof(), mat("#648b8c"), 69, 10.2, i * 32 + 25, g);
      box(56.9, 4.3, i * 32 + 25, 0.5, 8, 18, dark, g);
      const p = new T.Vector3(69, 9, i * 32 + 25).applyMatrix4(g.matrixWorld);
      g.updateMatrixWorld(true);
      p.set(69, 9, i * 32 + 25).applyMatrix4(g.matrixWorld);
      obstacles.push({
        x: p.x,
        y: r.y + 10,
        z: p.z,
        radius: 17,
        label: "hangar",
      });
    }
    box(42, 2.4, -25, 12, 4.8, 16, white, g);
    box(42, 6.9, -25, 7, 5, 8, wood, g);
    box(42, 9.2, -25, 9, 3, 10, mat("#8cbfc5"), g);
    box(42, 11, -25, 11, 0.7, 12, white, g);
    const sock = new T.Group();
    sock.position.set(-r.width / 2 - 11, 0, r.length / 2 - 80);
    g.add(sock);
    mesh(new T.CylinderGeometry(0.15, 0.22, 9, 10), white, 0, 4.5, 0, sock);
    const flag = new T.Group();
    flag.position.y = 9;
    sock.add(flag);
    windsocks.push(flag);
    for (let i = 0; i < 6; i++) {
      const tube = mesh(
        new T.CylinderGeometry(
          0.85 - i * 0.11,
          0.74 - i * 0.11,
          0.7,
          14,
          1,
          true,
        ),
        i % 2 ? white : red,
        i * 0.68,
        0,
        0,
        flag,
      );
      tube.rotation.z = Math.PI / 2;
    }
  }
  // Curved palm trees assembled once and instanced throughout the coast.
  const palmParts: T.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const geo = new T.CylinderGeometry(
      0.31 - i * 0.018,
      0.34 - i * 0.018,
      1.8,
      7,
    );
    geo.translate(Math.sin(i * 0.18) * 0.65, i * 1.65 + 0.9, 0);
    palmParts.push(geo);
  }
  const trunkGeo = mergeGeometries(palmParts)!;
  const leafParts: T.BufferGeometry[] = [];
  for (let a = 0; a < 8; a++) {
    const verts: number[] = [],
      idx: number[] = [];
    const angle = (a * Math.PI) / 4;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const len = t * 6.6,
        y = 12 + Math.sin(t * Math.PI) * 1.5 - t * 2.3,
        w = Math.sin(t * Math.PI) * 0.7;
      for (const side of [-1, 1])
        verts.push(
          Math.cos(angle) * len - Math.sin(angle) * w * side + 0.5,
          y,
          Math.sin(angle) * len + Math.cos(angle) * w * side,
        );
    }
    for (let i = 0; i < 10; i++) {
      const n = i * 2;
      idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    leafParts.push(geo);
  }
  const trunks = new T.InstancedMesh(trunkGeo, wood, 250),
    leaves = new T.InstancedMesh(
      mergeGeometries(leafParts)!,
      new T.MeshStandardMaterial({
        color: "#397960",
        roughness: 0.85,
        side: T.DoubleSide,
      }),
      250,
    );
  scene.add(trunks, leaves);
  trunks.castShadow = true;
  leaves.castShadow = true;
  const dummy = new T.Object3D();
  let count = 0;
  for (let attempt = 0; attempt < 10000 && count < 250; attempt++) {
    const x = (rng() - 0.5) * 2100,
      z = (rng() - 0.5) * 2100,
      h = terrainHeight(x, z);
    if (
      h < 3 ||
      h > 58 ||
      runways.some((r) => {
        const p = runwayLocal(x, z, r);
        return Math.abs(p.x) < 95 && Math.abs(p.z) < r.length / 2 + 30;
      })
    )
      continue;
    dummy.position.set(x, h, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(0.75 + rng() * 0.8);
    dummy.updateMatrix();
    trunks.setMatrixAt(count, dummy.matrix);
    leaves.setMatrixAt(count, dummy.matrix);
    obstacles.push({
      x,
      y: h + 12 * dummy.scale.x,
      z,
      radius: 1.2,
      label: "palm",
    });
    count++;
  }
  trunks.count = leaves.count = count;
  const canopyMat = mat("#497b5b");
  const crownParts: T.BufferGeometry[] = [];
  for (const [x, y, z, s] of [
    [0, 0.1, 0, 0.8],
    [-0.46, -0.2, 0.05, 0.6],
    [0.42, -0.15, 0.22, 0.64],
    [0.12, -0.15, -0.48, 0.62],
    [0, 0.5, 0.1, 0.55],
  ]) {
    const geo = new T.SphereGeometry(s, 14, 10);
    geo.translate(x, y, z);
    crownParts.push(geo);
  }
  const crowns = new T.InstancedMesh(
    mergeGeometries(crownParts)!,
    canopyMat,
    700,
  );
  scene.add(crowns);
  crowns.castShadow = true;
  count = 0;
  for (let attempt = 0; attempt < 9000 && count < 650; attempt++) {
    const x = (rng() - 0.5) * 1600,
      z = (rng() - 0.5) * 1600,
      h = terrainHeight(x, z);
    if (
      h < 27 ||
      h > 190 ||
      runways.some((r) => {
        const p = runwayLocal(x, z, r);
        return Math.abs(p.x) < 110 && Math.abs(p.z) < r.length / 2 + 50;
      })
    )
      continue;
    const slope = Math.abs(terrainHeight(x + 5, z) - h);
    if (slope > 6) continue;
    dummy.position.set(x, h + 3, z);
    const s = 3 + rng() * 6;
    dummy.scale.set(s, s * 0.85, s * 0.9);
    dummy.rotation.set(rng(), rng() * 6, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(count, dummy.matrix);
    obstacles.push({ x, y: h + s * 1.5, z, radius: s * 0.65, label: "tree" });
    crowns.setColorAt(
      count,
      new T.Color().setHSL(
        0.28 + rng() * 0.055,
        0.22 + rng() * 0.12,
        0.26 + rng() * 0.1,
      ),
    );
    count++;
  }
  crowns.count = count;
  // Coral-roofed village, footpaths and a waterfront marina.
  for (let i = 0; i < 27; i++) {
    const x = -430 + (i % 6) * 27 + (rng() - 0.5) * 6,
      z = 490 + Math.floor(i / 6) * 29,
      h = terrainHeight(x, z);
    if (h < 3) continue;
    const w = 8 + rng() * 5,
      d = 9 + rng() * 7,
      y = 5 + rng() * 4;
    const g = new T.Group();
    g.position.set(x, h, z);
    g.rotation.y = (rng() - 0.5) * 0.5;
    scene.add(g);
    box(0, y / 2, 0, w, y, d, i % 3 === 0 ? mat("#eac7a0") : white, g);
    mesh(villageRoof(w, d), roof, 0, y, 0, g);
    for (let k = -1; k <= 1; k += 2) {
      box(k * w * 0.25, y * 0.55, d / 2 + 0.05, 2, 2, 0.15, mat("#557a82"), g);
      box(k * w * 0.25, y * 0.55, d / 2 + 0.16, 2.8, 0.25, 0.4, white, g);
    }
    box(0, 1.6, d / 2 + 0.1, 1.7, 3, 0.15, wood, g);
    obstacles.push({
      x,
      y: h + y,
      z,
      radius: Math.max(w, d) * 0.65,
      label: "building",
    });
  }
  function path(points: T.Vector3[], width: number, material: T.Material) {
    const m = mesh(groundPath(points, width), material);
    m.castShadow = false;
  }
  path(
    [
      new T.Vector3(-207, 0, 280),
      new T.Vector3(-165, 0, 435),
      new T.Vector3(-275, 0, 490),
      new T.Vector3(-455, 0, 530),
    ],
    6,
    sand,
  );
  for (let i = 0; i < 3; i++) {
    const x = -505 - i * 20,
      z = 600 + i * 8;
    box(x, 2, z, 6, 1.6, 75, wood);
    for (let j = 0; j < 7; j++) {
      box(x, 1, z - 30 + j * 10, 7, 0.22, 0.35, sand);
    }
    for (const s of [-1, 1])
      for (const end of [-1, 1])
        mesh(
          new T.CylinderGeometry(0.35, 0.35, 6, 8),
          wood,
          x + s * 2.4,
          0.5,
          z + end * 30,
        );
  }
  const lighthouse = new T.Group();
  const lx = -680,
    lz = -125,
    lh = terrainHeight(lx, lz);
  lighthouse.position.set(lx, Math.max(3, lh), lz);
  scene.add(lighthouse);
  for (let i = 0; i < 5; i++)
    mesh(
      new T.CylinderGeometry(3.1 - i * 0.2, 3.3 - i * 0.2, 3.5, 24),
      i % 2 ? red : white,
      0,
      1.75 + i * 3.5,
      0,
      lighthouse,
    );
  mesh(new T.CylinderGeometry(3.4, 3.4, 0.6, 24), dark, 0, 17.7, 0, lighthouse);
  mesh(
    new T.CylinderGeometry(2.2, 2.2, 3, 16),
    mat("#b9d8d6"),
    0,
    19.5,
    0,
    lighthouse,
  );
  mesh(new T.ConeGeometry(3.5, 2, 24), red, 0, 22, 0, lighthouse);
  obstacles.push({
    x: lx,
    y: Math.max(3, lh) + 23,
    z: lz,
    radius: 5,
    label: "lighthouse",
  });
  const beacon = new T.PointLight("#fff0b8", 0, 180);
  beacon.position.set(lx, Math.max(3, lh) + 20, lz);
  scene.add(beacon);
  // Slowly moving craft and curved wakes make the water feel inhabited.
  const boats: {
    group: T.Group;
    baseX: number;
    baseZ: number;
    angle: number;
    speed: number;
    radius: number;
  }[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new T.Group();
    scene.add(g);
    const hull = ball(0, 1, 0, 3, 1.4, 8, white, g);
    hull.rotation.x = 0.04;
    box(0, 2.8, 1, 4, 2, 5, i % 2 ? white : wood, g);
    box(0, 4, 1, 4.8, 0.6, 5.8, white, g);
    box(0, 3.1, -1.65, 3.6, 1.1, 0.18, mat("#83b9c0"), g);
    if (i % 3 === 0) {
      mesh(new T.CylinderGeometry(0.12, 0.18, 15, 8), wood, 0, 9, 0, g);
      const sailGeo = new T.BufferGeometry();
      sailGeo.setAttribute(
        "position",
        new T.Float32BufferAttribute([0, 4, 0, 0, 16, 0, 0, 4, 6], 3),
      );
      sailGeo.computeVertexNormals();
      mesh(
        sailGeo,
        new T.MeshStandardMaterial({ color: "#fcf0db", side: T.DoubleSide }),
        0.1,
        0,
        0,
        g,
      );
    }
    const wakeMat = new T.MeshBasicMaterial({
      color: "#bfe5d9",
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    for (const side of [-1, 1]) {
      const wake = mesh(
        new T.PlaneGeometry(1.8, 35),
        wakeMat,
        side * 4,
        0.2,
        21,
        g,
      );
      wake.rotation.x = -Math.PI / 2;
      wake.rotation.z = side * 0.15;
      wake.castShadow = false;
    }
    const baseX = i < 4 ? -800 : 1010,
      baseZ = i < 4 ? 450 : -250;
    boats.push({
      group: g,
      baseX,
      baseZ,
      angle: i * 1.5,
      speed: 0.012 + i * 0.002,
      radius: 80 + i * 12,
    });
  }
  const clouds: T.Group[] = [];
  const cloudMat = new T.MeshStandardMaterial({
    color: "#fff9e8",
    roughness: 1,
  });
  for (let i = 0; i < 27; i++) {
    const g = new T.Group();
    g.position.set(
      (rng() - 0.5) * 6000,
      370 + rng() * 370,
      (rng() - 0.5) * 6000,
    );
    for (let j = 0; j < 5; j++) {
      const s = 30 + rng() * 45;
      ball(j * 47, Math.sin(j * 1.5) * 15, 0, s, s * 0.5, s * 0.6, cloudMat, g);
    }
    g.scale.setScalar(0.6 + rng());
    scene.add(g);
    clouds.push(g);
  }
  const birdGeo = new T.BufferGeometry().setFromPoints([
    new T.Vector3(-1.8, 0, 0.6),
    new T.Vector3(-0.8, 0.4, 0),
    new T.Vector3(0, 0, 0),
    new T.Vector3(0.8, 0.4, 0),
    new T.Vector3(1.8, 0, 0.6),
  ]);
  const birds: T.Line[] = [];
  for (let i = 0; i < 12; i++) {
    const b = new T.Line(
      birdGeo,
      new T.LineBasicMaterial({ color: "#49656a" }),
    );
    scene.add(b);
    birds.push(b);
  }
  const starsGeo = new T.BufferGeometry();
  const stars = [];
  for (let i = 0; i < 500; i++) {
    const a = rng() * Math.PI * 2,
      v = 0.1 + rng() * 0.8;
    stars.push(
      Math.cos(a) * 5000 * Math.sqrt(1 - v * v),
      v * 5000,
      Math.sin(a) * 5000 * Math.sqrt(1 - v * v),
    );
  }
  starsGeo.setAttribute("position", new T.Float32BufferAttribute(stars, 3));
  const starMat = new T.PointsMaterial({
    color: "#e9f5ef",
    size: 3,
    transparent: true,
    opacity: 0,
    sizeAttenuation: false,
  });
  scene.add(new T.Points(starsGeo, starMat));
  let nightValue = 0;
  return {
    obstacles,
    sun,
    update(time: number, night: boolean) {
      nightValue = T.MathUtils.lerp(nightValue, night ? 1 : 0, 0.022);
      oceanMaterial.uniforms.time.value = time;
      oceanMaterial.uniforms.night.value = nightValue;
      ambient.intensity = T.MathUtils.lerp(1.55, 0.6, nightValue);
      sun.intensity = T.MathUtils.lerp(2.7, 0.45, nightValue);
      sun.color.set(nightValue > 0.5 ? "#b6cbe9" : "#fff0d0");
      beacon.intensity = nightValue * 25;
      starMat.opacity = nightValue;
      (scene.background as T.Color).lerpColors(
        new T.Color("#a8dce5"),
        new T.Color("#101f35"),
        nightValue,
      );
      (scene.fog as T.FogExp2).color.lerpColors(
        new T.Color("#badfe1"),
        new T.Color("#14283a"),
        nightValue,
      );
      for (const flag of windsocks) {
        flag.rotation.y = -0.5 + Math.sin(time * 0.5) * 0.15;
        flag.rotation.z = Math.sin(time * 2.8) * 0.06;
      }
      for (const b of boats) {
        const a = b.angle + time * b.speed;
        b.group.position.set(
          b.baseX + Math.sin(a) * b.radius,
          0.1 + Math.sin(time * 1.7 + a) * 0.15,
          b.baseZ + Math.cos(a) * b.radius,
        );
        b.group.rotation.set(
          Math.sin(time + a) * 0.025,
          -a - Math.PI / 2,
          Math.sin(time * 1.2 + a) * 0.035,
        );
      }
      for (let i = 0; i < clouds.length; i++) clouds[i].position.x += 0.012;
      for (let i = 0; i < birds.length; i++) {
        const a = time * 0.13 + i * 0.6;
        birds[i].position.set(
          -400 + Math.cos(a) * 170,
          80 + i * 3 + Math.sin(a * 2) * 12,
          480 + Math.sin(a) * 130,
        );
        birds[i].rotation.y = -a;
        birds[i].scale.y = 0.6 + Math.sin(time * 4 + i) * 0.4;
      }
    },
    dispose() {
      scene.traverse((o) => {
        if (
          o instanceof T.Mesh ||
          o instanceof T.Line ||
          o instanceof T.Points
        ) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      heightmap.dispose();
    },
  };
}
