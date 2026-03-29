import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __BUILD_NUMBER__: JSON.stringify(process.env.BUILD_NUMBER || 'dev'),
  },
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
    rollupOptions: {
      // onnxruntime-web is loaded via CDN at runtime, not bundled
      external: ['onnxruntime-web'],
    },
  },
});
