import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  root: "./",
  build: {
    outDir: "dist",
    lib: {
      entry: "src/index.ts",
      name: "palette-shader",
    },
    
    rollupOptions: {
      external: ["three"],
      output: {
        globals: {
          three: "THREE",
        },
      },
    },
  },
  plugins: [dts()],
});
