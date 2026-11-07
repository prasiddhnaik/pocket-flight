import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: "index.html",
        aircraft: "aircraft.html",
        scenery: "scenery.html",
        hangar: "hangar.html",
        jet: "jet.html",
        civilian: "civilian.html",
        aureliaReference: "aurelia-reference.html",
        stormbird: "stormbird.html",
        heron: "heron.html",
        f15cDesign: "docs/f15c/F15C_DESIGN.html",
        f15cResearch: "docs/f15c/F15C_RESEARCH.html",
        f15cImplementation: "docs/f15c/F15C_IMPLEMENTATION.html",
        f15cRefinement: "docs/f15c/F15C_REFINEMENT.html",
        f15cReferenceDossier: "docs/f15c/F15C_REFERENCE_DOSSIER.html",
        f15cReferenceAudit: "docs/f15c/F15C_CLAUDE_REFERENCE_AUDIT.html",
      },
    },
  },
});
