import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ops: resolve(__dirname, 'ops.html'),
        monitor: resolve(__dirname, 'monitor.html'),
        chart: resolve(__dirname, 'chart.html'),
      },
    },
  },
});
