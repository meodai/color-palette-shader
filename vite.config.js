import { defineConfig } from "vite";

export default defineConfig({
  root: "./",
  build: {
    outDir: "dist",
    lib: {
      entry: "src/index.js",
      name: "palette-shader",
    },
  },
});
