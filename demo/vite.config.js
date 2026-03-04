import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the lib from source during development so changes
      // are reflected immediately without a build step.
      "palette-shader": fileURLToPath(
        new URL("../src/index.ts", import.meta.url)
      ),
    },
  },
});
