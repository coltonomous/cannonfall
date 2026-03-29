import { defineConfig } from 'vite';
import { readdirSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

/** Copy onnxruntime-web WASM files into the build output. */
function copyOrtWasm() {
  return {
    name: 'copy-ort-wasm',
    writeBundle(options) {
      const src = resolve('node_modules/onnxruntime-web/dist');
      const dest = resolve(options.dir, 'ort-wasm');
      mkdirSync(dest, { recursive: true });
      for (const f of readdirSync(src)) {
        if (f.endsWith('.wasm')) {
          copyFileSync(join(src, f), join(dest, f));
        }
      }
    },
  };
}

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
  },
  plugins: [copyOrtWasm()],
});
