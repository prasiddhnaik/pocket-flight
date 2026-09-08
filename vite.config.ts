import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: "index.html",
        hangar: "hangar.html",
        jet: "jet.html",
        civilian: "civilian.html",
      },
    },
  },
});
