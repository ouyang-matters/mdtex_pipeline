import { defineConfig } from 'vite';

/**
 * Build for the WeChat benchmark page (scripts/bench-wechat.js).
 * Kept separate from the application build so the frozen legacy snapshot is
 * never bundled into the shipped UI.
 */
export default defineConfig({
  root: 'bench',
  base: './',
  build: {
    outDir: '../dist/bench',
    emptyOutDir: true,
  },
});
