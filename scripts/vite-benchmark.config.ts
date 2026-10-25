import { defineConfig } from "vite";

export default defineConfig({
  cacheDir: "node_modules/.vite-benchmark",
  server: {
    host: "127.0.0.1",
    port: 5281,
    strictPort: true,
    hmr: false,
    watch: null,
  },
});
