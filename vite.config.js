import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: false,
  },
});
