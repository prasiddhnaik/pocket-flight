import * as T from "three";

// AC6-style flyby backdrop: deep blue sky with cirrus streaks above a bright,
// sunlit cloud deck. Equirectangular sRGB canvas, generated once.
export function aircraftBackdrop() {
  const w = 1024,
    h = 512,
    canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const image = g.createImageData(w, h);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      fx = x - xi,
      fy = y - yi;
    const u = fx * fx * (3 - 2 * fx),
      v = fy * fy * (3 - 2 * fy);
    const at = hash;
    return (at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - v) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * v;
  };
  const fbm = (x: number, y: number, octaves: number) => {
    let sum = 0,
      amp = 0.5,
      f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * f, y * f) * amp;
      f *= 2;
      amp *= 0.5;
    }
    return sum;
  };
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  for (let j = 0; j < h; j++) {
    const elevation = Math.PI / 2 - ((j + 0.5) / h) * Math.PI;
    const up = Math.sin(elevation),
      flat = Math.cos(elevation);
    for (let i = 0; i < w; i++) {
      const azimuth = (i / w) * Math.PI * 2;
      // Project onto flat cloud layers: continuous at the poles and the seam.
      const dx = Math.cos(azimuth) * flat,
        dz = Math.sin(azimuth) * flat;
      let c: number[];
      if (up >= 0) {
        c = mix([170, 198, 222], [44, 92, 150], Math.pow(up, 0.55));
        const k = 1 / Math.max(0.06, up);
        const streak = Math.max(0, fbm(dx * k * 0.35 + 50, dz * k * 2.4 + fbm(dx * k * 0.2, dz * k * 0.2, 2) * 3, 4) - 0.5) * 2.2;
        // Fade out near the horizon, where grazing projection would alias.
        const fade = T.MathUtils.smoothstep(up, 0.03, 0.16) * Math.exp(-up * 2.2);
        c = mix(c, [236, 242, 248], Math.min(1, streak * fade * 0.9));
      } else {
        const depth = -up;
        const k = 1 / Math.max(0.035, depth);
        const px = dx * k * 0.8 + 100,
          pz = dz * k * 0.8 + 100;
        const puff = T.MathUtils.smoothstep(fbm(px, pz, 6), 0.38, 0.68);
        const lit = fbm(px + 0.35, pz + 0.35, 4);
        const deck = mix([92, 112, 138], [226, 232, 240], puff * (0.75 + lit * 0.4));
        c = mix(deck, [196, 212, 228], Math.exp(-depth * 9));
      }
      const o = (j * w + i) * 4;
      image.data[o] = c[0];
      image.data[o + 1] = c[1];
      image.data[o + 2] = c[2];
      image.data[o + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.mapping = T.EquirectangularReflectionMapping;
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}
