import * as T from "three";
import { ObstacleIndex, type CollisionObstacles } from "../flight/obstacle-index";
import { villageRoof, hangarRoof, groundPath, palmGeometry, waveNormals } from "./scenery-geometry";
import { makeTerrainMaterial } from "./terrain-material";
import { loadRangeHeights, rangeLayout, rangeSurface } from "./range-island";
import { addEnvironmentAssets, type VillageSite, type HangarSite, type LandmarkSite } from "./environment-assets";
import type { TreeSite } from "./tree-field";
import {
  AIRFIELD_TOWER,
  MARINA_PIERS,
  PALM_BAY_AIRFIELD,
  PALM_BAY_MARINA,
  PALM_BAY_VILLAGE,
  type Landmark,
} from "./palm-bay-landmarks";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { releaseAfterUpload } from "./texture-memory";
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
const SHADOW_REACH = 350;
const SUN_OFFSET = new T.Vector3(-600, 900, 500);
// The shadow camera's own right and up directions.
const SUN_ACROSS = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), SUN_OFFSET).normalize();
const SUN_ALONG = new T.Vector3().crossVectors(SUN_OFFSET, SUN_ACROSS).normalize();

export function makeWorld(
  scene: T.Scene,
  environmentFactory = addEnvironmentAssets,
) {
  const rng = random(512),
    obstacles: Obstacle[] = [];
  const villageSites: VillageSite[] = [], hangarSites: HangarSite[] = [], landmarkSites: LandmarkSite[] = [];
  /** Places a landmark's model when it loads, standing on `base`, with collision matching its walls. */
  function addLandmark(landmark: Landmark, base: T.Matrix4, footing: number, placeholder: T.Object3D[] = []) {
    landmarkSites.push({
      asset: landmark.asset,
      placeholder,
      matrix: base.clone().multiply(
        new T.Matrix4().compose(
          new T.Vector3(landmark.x, 0, landmark.z),
          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), landmark.angle ?? 0),
          new T.Vector3(1, 1, 1),
        ),
      ),
      tint: landmark.tint ? new T.Color(landmark.tint) : undefined,
    });
    for (const [x, z, radius] of landmark.circles ?? []) {
      const at = new T.Vector3(x, 0, z).applyMatrix4(base);
      obstacles.push({ x: at.x, y: footing + (landmark.height ?? 0), z: at.z, radius, label: "building" });
    }
  }
  // Scenery never edits these after creation, so equal finishes share one material.
  const finishes = new Map<string, T.MeshStandardMaterial>();
  const mat = (color: string, roughness = 0.85) => {
    const key = `${color}/${roughness}`;
    let material = finishes.get(key);
    if (!material)
      finishes.set(key, (material = new T.MeshStandardMaterial({ color, roughness })));
    return material;
  };
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
  const ambient = new T.HemisphereLight("#d0dce4", "#625b48", 1.55);
  scene.add(ambient);
  const sun = new T.DirectionalLight("#fff0d0", 2.7);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  // The box follows the aircraft, so a smaller map keeps the same detail per metre.
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_REACH,
    right: SHADOW_REACH,
    top: SHADOW_REACH,
    bottom: -SHADOW_REACH,
    near: 50,
    far: 2200,
  });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 1.6;
  scene.add(sun);
  scene.add(sun.target);
  scene.background = new T.Color("#a7c3d3");
  scene.fog = new T.FogExp2("#c5d0d1", 0.00027);
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
    if (h > 3) c.lerp(grass, Math.min(1, (h - 3) / 4));
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
    makeTerrainMaterial(),
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
  // Anvil Key's shallows, filled in once its height grid arrives.
  const rangeDepth = new Uint8Array(256 * 256 * 4);
  const rangeMap = new T.DataTexture(rangeDepth, 256, 256);
  rangeMap.magFilter = T.LinearFilter;
  rangeMap.minFilter = T.LinearFilter;
  const rangeHeights =
    typeof window === "undefined"
      ? Promise.resolve()
      : loadRangeHeights()
          .then(() => {
            for (let z = 0; z < 256; z++)
              for (let x = 0; x < 256; x++) {
                const h =
                  rangeSurface(
                    rangeLayout.centre.x + (x / 255 - 0.5) * (rangeLayout.size - 1),
                    rangeLayout.centre.z + (z / 255 - 0.5) * (rangeLayout.size - 1),
                  ) ?? -40;
                const i = (z * 256 + x) * 4;
                rangeDepth[i] = Math.round(Math.max(0, Math.min(1, (h + 45) / 320)) * 255);
                rangeDepth[i + 3] = 255;
              }
            rangeMap.needsUpdate = true;
          })
          .catch((error) => console.error("Anvil Key heights failed to load", error));
  const oceanWaves = waveNormals();
  const oceanMaterial = new T.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      waves: { value: oceanWaves },
      heightmap: { value: heightmap },
      rangeMap: { value: rangeMap },
      rangeArea: { value: new T.Vector3(rangeLayout.centre.x, rangeLayout.centre.z, rangeLayout.size) },
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
 uniform float time; uniform sampler2D waves; uniform sampler2D heightmap; uniform sampler2D rangeMap; uniform vec3 rangeArea; uniform float night; uniform vec3 fogColor; varying vec3 vWorld;
 void main(){vec2 p=vWorld.xz;vec2 uv=p/2800.+.5;float h=texture2D(heightmap,clamp(uv,0.,1.)).r*320.-45.; if(abs(p.x)>1400.||abs(p.y)>1400.)h=-45.;vec2 ruv=(p-rangeArea.xy)/rangeArea.z+.5;if(ruv.x>0.&&ruv.y>0.&&ruv.x<1.&&ruv.y<1.)h=texture2D(rangeMap,ruv).r*320.-45.;float depth=max(0.,-h);
 vec3 shallow=vec3(.055,.24,.20),deep=vec3(.012,.055,.082);vec3 color=mix(shallow,deep,smoothstep(0.,34.,depth));
 // Three scales at unrelated angles, so no grid can line up. Mipmaps fade each to flat water
 // once it shrinks below a pixel, which is what stops moire at altitude.
 float warp=sin(p.x*.009+p.y*.006)*2.1+sin(p.y*.017-p.x*.003)*1.3;
 vec4 swell=texture2D(waves,mat2(.83,-.56,.56,.83)*p*.0073+time*vec2(.006,.004));
 vec4 chop=texture2D(waves,mat2(.39,.92,-.92,.39)*p*.0231+time*vec2(-.011,.016));
 vec4 ripple=texture2D(waves,mat2(-.71,.7,-.7,-.71)*p*.067+time*vec2(.026,-.019));
 vec4 broad=texture2D(waves,mat2(.96,.28,-.28,.96)*p*.00091);
 color*=.9+(broad.b-.5)*.5;
 color+=((swell.b-.5)*.5+(chop.b-.5)*.32+(ripple.b-.5)*.18)*mix(.022,.05,1.-smoothstep(0.,14.,depth));
 float foam=(1.-smoothstep(.4,3.8,depth))*smoothstep(.4,.9,sin(depth*2.1-time*.9+warp+chop.b*4.))*.32*(.55+chop.b*.9);color=mix(color,vec3(.48,.62,.55),foam);
 vec3 view=normalize(cameraPosition-vWorld);
 vec2 slope=(swell.xy-.5)*.17+(chop.xy-.5)*.13+(ripple.xy-.5)*.1;
 vec3 normal=normalize(vec3(slope.x,1.,slope.y));
 vec3 halfVector=normalize(normalize(vec3(-.55,.82,.25))+view);
 float highlight=pow(max(0.,dot(normal,halfVector)),110.);
 // From altitude the ripples have faded, so the glint would spread into a milky sheet.
 color+=vec3(.3,.27,.2)*highlight*mix(1.,.28,smoothstep(120.,800.,length(cameraPosition-vWorld)));
 float fresnel=pow(1.-max(0.,dot(view,normal)),5.);
 color=mix(color,vec3(.20,.28,.33),fresnel*.65);
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
  const windsocks: T.Group[] = [];
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
    releaseAfterUpload([texture]);
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
    // Edge lights are identical: one instanced batch per runway.
    const bulbs: T.Matrix4[] = [];
    for (const side of [-1, 1])
      for (let z = -r.length / 2 + 5; z < r.length / 2; z += 28)
        bulbs.push(
          new T.Matrix4().compose(
            new T.Vector3(side * (r.width / 2 + 2), 0.25, z),
            new T.Quaternion(),
            new T.Vector3(0.35, 0.3, 0.35),
          ),
        );
    const edgeLights = new T.InstancedMesh(
      sphere,
      new T.MeshBasicMaterial({ color: "#fff1bb" }),
      bulbs.length,
    );
    bulbs.forEach((m, i) => edgeLights.setMatrixAt(i, m));
    edgeLights.computeBoundingSphere();
    edgeLights.castShadow = edgeLights.receiveShadow = true;
    edgeLights.name = "Runway edge lights";
    g.add(edgeLights);
    // The apron's paint: a taxi line off the runway and a row of numbered parking stands.
    const apronCanvas = document.createElement("canvas");
    apronCanvas.width = 256;
    apronCanvas.height = 440;
    const paint = apronCanvas.getContext("2d")!;
    paint.fillStyle = "#94948a";
    paint.fillRect(0, 0, 256, 440);
    // Its own stream: drawing from the world's would move every palm and cottage placed after this.
    const speckle = random(731 + index);
    for (let i = 0; i < 5000; i++) {
      paint.fillStyle = `rgba(${speckle() < 0.5 ? "40,40,36" : "220,220,205"},${speckle() * 0.07})`;
      paint.fillRect(speckle() * 256, speckle() * 440, 3, 3);
    }
    paint.fillStyle = "rgba(60,60,54,.35)";
    for (let z = 0; z < 440; z += 40) paint.fillRect(0, z, 256, 1.5);
    for (let x = 0; x < 256; x += 40) paint.fillRect(x, 0, 1.5, 440);
    paint.fillStyle = "#d9b43c";
    paint.fillRect(44, 0, 4, 440);
    paint.font = "bold 22px sans-serif";
    paint.textAlign = "center";
    for (let i = 0; i < 3; i++) {
      const z = 70 + i * 128;
      paint.fillStyle = "#d9b43c";
      paint.fillRect(48, z - 2, 104, 4);
      paint.fillRect(148, z - 26, 4, 52);
      // Turned to read from the taxi line, looking toward the hangars.
      paint.save();
      paint.translate(120, z - 14);
      paint.rotate(Math.PI / 2);
      paint.fillStyle = "#e9e9d7";
      paint.fillText(String(i + 1), 0, 0);
      paint.restore();
    }
    const apronTexture = new T.CanvasTexture(apronCanvas);
    apronTexture.anisotropy = 8;
    apronTexture.colorSpace = T.SRGBColorSpace;
    releaseAfterUpload([apronTexture]);
    const apron = mesh(
      new T.PlaneGeometry(64, 110),
      new T.MeshStandardMaterial({ map: apronTexture, roughness: 0.95 }),
      44,
      APRON_PAVEMENT_HEIGHT - 0.22,
      70,
      g,
    );
    apron.rotation.x = -Math.PI / 2;
    for (let i = 0; i < (index === 1 ? 1 : 3); i++) {
      const shell = box(69, 5.3, i * 32 + 25, 23, 10.6, 24, white, g);
      const covering = mesh(hangarRoof(), mat("#648b8c"), 69, 10.2, i * 32 + 25, g);
      const door = box(56.9, 4.3, i * 32 + 25, 0.5, 8, 18, dark, g);
      g.updateMatrixWorld(true);
      hangarSites.push({ placeholder: [shell, covering, door], matrix: g.matrixWorld.clone().multiply(new T.Matrix4().makeTranslation(69, 0, i * 32 + 25)) });
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
    g.updateMatrixWorld(true);
    addLandmark(AIRFIELD_TOWER, g.matrixWorld, r.y, [
      box(42, 2.4, -25, 12, 4.8, 16, white, g),
      box(42, 6.9, -25, 7, 5, 8, wood, g),
      box(42, 9.2, -25, 9, 3, 10, mat("#8cbfc5"), g),
      box(42, 11, -25, 11, 0.7, 12, white, g),
    ]);
    if (index === 0) for (const landmark of PALM_BAY_AIRFIELD) addLandmark(landmark, g.matrixWorld, r.y);
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
  const palm = palmGeometry();
  const trunks = new T.InstancedMesh(palm.trunk, mat("#85745e"), 250),
    leaves = new T.InstancedMesh(
      palm.fronds,
      new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: T.DoubleSide }),
      250,
    );
  scene.add(trunks, leaves);
  trunks.castShadow = true;
  leaves.castShadow = true;
  const dummy = new T.Object3D();
  const palmSites: TreeSite[] = [];
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
    palmSites.push({
      kind: "palm",
      x,
      y: h,
      z,
      scale: dummy.scale.x,
      yaw: dummy.rotation.y,
      stretch: 1,
      // Not from the shared stream, for the same reason as the apron's speckle.
      shade: 0.84 + ((count * 0.618) % 1) * 0.3,
    });
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
  crowns.name = "Forest crowns";
  trunks.name = "Palm trunks";
  leaves.name = "Palm leaves";
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
    g.name = "Village fallback";
    villageSites.push({ placeholder: g, width: w, depth: d });
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
  const ground = new T.Matrix4();
  for (const [x, z] of MARINA_PIERS) {
    const fallback: T.Object3D[] = [box(x, 1.5, z, 6, 1.6, 75, wood)];
    for (const s of [-1, 1])
      for (const end of [-1, 1])
        fallback.push(mesh(new T.CylinderGeometry(0.35, 0.35, 6, 8), wood, x + s * 2.4, 0.5, z + end * 30));
    addLandmark({ asset: "marina-pier", x, z, reach: 38 }, ground, 0, fallback);
  }
  for (const landmark of [...PALM_BAY_VILLAGE, ...PALM_BAY_MARINA]) {
    const afloat = landmark.asset === "marina-boat";
    const footing = afloat ? 0.1 : terrainHeight(landmark.x, landmark.z);
    addLandmark(landmark, new T.Matrix4().makeTranslation(0, footing, 0), footing);
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
  addLandmark(
    { asset: "palm-bay-lighthouse", x: lx, z: lz, reach: 13 },
    new T.Matrix4().makeTranslation(0, Math.max(3, lh), 0),
    Math.max(3, lh),
    [lighthouse],
  );
  const beacon = new T.PointLight("#fff0b8", 0, 180);
  beacon.position.set(lx, Math.max(3, lh) + 20, lz);
  // A visible light costs every lit pixel even at zero intensity; add it at dusk.
  beacon.visible = false;
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
  const cloudStarts: number[] = [];
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
    // The scenery loader swaps these placeholder puffs for cloud sprites.
    g.name = "Cloud formation";
    clouds.push(g);
    cloudStarts.push(g.position.x);
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
  const environment = typeof window === "undefined" ? undefined : environmentFactory(scene, villageSites, hangarSites, obstacles, land, landmarkSites, palmSites);
  // Asset loading replaces the placeholder tree proxies and adjusts buildings.
  // Keep exhaustive collision until every replacement is complete.
  let collisionObstacles: CollisionObstacles = obstacles;
  const ready = Promise.all([environment?.ready, rangeHeights]).then(() => {
    collisionObstacles = new ObstacleIndex(obstacles);
  });
  let nightValue = 0;
  return {
    obstacles,
    get collisionObstacles() { return collisionObstacles; },
    sun,
    ready,
    /** Centres the shadow map on the aircraft, on whole texels so shadow edges don't crawl. */
    focusSun(focus: T.Vector3) {
      const texel = (2 * SHADOW_REACH) / sun.shadow.mapSize.x,
        a = focus.dot(SUN_ACROSS),
        b = focus.dot(SUN_ALONG);
      sun.target.position
        .copy(focus)
        .addScaledVector(SUN_ACROSS, Math.round(a / texel) * texel - a)
        .addScaledVector(SUN_ALONG, Math.round(b / texel) * texel - b);
      sun.position.copy(sun.target.position).add(SUN_OFFSET);
    },
    update(time: number, night: boolean) {
      nightValue = T.MathUtils.lerp(nightValue, night ? 1 : 0, 0.022);
      oceanMaterial.uniforms.time.value = time;
      oceanMaterial.uniforms.night.value = nightValue;
      ambient.intensity = T.MathUtils.lerp(1.55, 0.6, nightValue);
      sun.intensity = T.MathUtils.lerp(2.7, 0.45, nightValue);
      sun.color.set(nightValue > 0.5 ? "#b6cbe9" : "#fff0d0");
      beacon.intensity = nightValue * 25;
      beacon.visible = nightValue > 0.001;
      starMat.opacity = nightValue;
      (scene.background as T.Color).lerpColors(
        new T.Color("#a7c3d3"),
        new T.Color("#101f35"),
        nightValue,
      );
      (scene.fog as T.FogExp2).color.lerpColors(
        new T.Color("#c5d0d1"),
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
      // Drift with world time (0.72 m/s), not per frame, so speed is display-independent.
      for (let i = 0; i < clouds.length; i++)
        clouds[i].position.x = cloudStarts[i] + time * 0.72;
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
      environment?.dispose();
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
      rangeMap.dispose();
    },
  };
}
