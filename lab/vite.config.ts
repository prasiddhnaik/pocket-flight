import { defineConfig } from "vite";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, createReadStream, statSync } from "node:fs";
import { aircraftCatalog } from "./aircraft";

const root = fileURLToPath(new URL(".", import.meta.url));
const assets = resolve(root, "../public/assets");
const sharedFiles = Object.values(aircraftCatalog).flatMap((a) => {
  const bytes = readFileSync(resolve(assets, a.asset));
  const json = a.asset.endsWith(".glb")
    ? bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")
    : bytes.toString("utf8");
  const gltf = JSON.parse(json);
  return [
    a.asset,
    ...gltf.buffers.flatMap((b: { uri?: string }) => (b.uri ? [b.uri] : [])),
  ];
});

export default defineConfig({
  root,
  // The lab and main game run concurrently with different entry points.
  cacheDir: resolve(root, "../node_modules/.vite-lab"),
  publicDir: resolve(root, "public"),
  server: {
    host: "127.0.0.1",
    port: 5186,
    strictPort: true,
    fs: { allow: [resolve(root, "..")] },
  },
  build: {
    outDir: resolve(root, "../output/wind-tunnel-build"),
    emptyOutDir: true,
    rollupOptions: {
      input: { lab: resolve(root, "index.html"), f15c: resolve(root, "f15c.html") },
    },
  },
  plugins: [
    {
      name: "private-aircraft-assets",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = (req.url ?? "").split("?")[0];
          if (!path.startsWith("/aircraft/")) return next();
          const name = path.slice("/aircraft/".length);
          if (name !== basename(name) || !sharedFiles.includes(name)) {
            res.statusCode = 404;
            res.end("Unknown aircraft asset");
            return;
          }
          const info = statSync(resolve(assets, name));
          const etag = `"${info.size}-${info.mtimeMs}"`;
          res.setHeader("ETag", etag);
          res.setHeader("Cache-Control", "private, no-cache");
          if (req.headers["if-none-match"] === etag) {
            res.statusCode = 304;
            res.end();
            return;
          }
          res.setHeader("Content-Length", info.size);
          res.setHeader(
            "Content-Type",
            name.endsWith(".gltf")
              ? "model/gltf+json"
              : "application/octet-stream",
          );
          createReadStream(resolve(assets, name)).pipe(res);
        });
      },
      generateBundle() {
        for (const name of sharedFiles)
          this.emitFile({
            type: "asset",
            fileName: `aircraft/${name}`,
            source: readFileSync(resolve(assets, name)),
          });
      },
    },
  ],
});
