import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node', // default; frontend tests opt in to jsdom per-file
  },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
