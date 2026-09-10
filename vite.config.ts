import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the committed `docs/` folder from `main`.
// Relative base so assets resolve under /singaporean-bridge/.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
});
