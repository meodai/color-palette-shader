import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        analyzer: fileURLToPath(new URL('./palette-analyzer.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      // Resolve the lib from source during development so changes
      // are reflected immediately without a build step.
      'palette-shader': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
});
