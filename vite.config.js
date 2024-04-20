import { defineConfig } from "vite";

export default defineConfig({
  root: "./",
  build: {
    outDir: "dist",
    lib: {
      entry: "src/index.ts",
      name: "palette-shader",
    },
  },
});
