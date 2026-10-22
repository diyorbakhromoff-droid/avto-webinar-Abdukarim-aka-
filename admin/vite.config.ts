import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Admin panel Caddy orqali domen ildizida (/) beriladi — SPA fallback: try_files {path} /index.html
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  preview: { port: 4174 },
  build: { outDir: 'dist', sourcemap: false },
});
