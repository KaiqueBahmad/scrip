import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.PSEUDOPAY_API ?? 'http://127.0.0.1:4242';

export default defineConfig({
  // The panel is served from /admin by Fastify (specs.md:52).
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    // `npm --prefix admin run dev` talks to the real API instead of a mock.
    proxy: {
      '/admin/api': { target: API_TARGET, changeOrigin: true },
      '/v1': { target: API_TARGET, changeOrigin: true },
    },
  },
});
