import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
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
