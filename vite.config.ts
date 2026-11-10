import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./client', import.meta.url));

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        stream: resolve(root, 'stream.html'), // vue 3D pour le stream
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
