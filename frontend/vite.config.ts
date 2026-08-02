import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.PSEUDOPAY_API ?? 'http://127.0.0.1:4242';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    // `npm run dev` here talks to the real API instead of a mock.
    proxy: {
      '/v1': { target: API_TARGET, changeOrigin: true },
    },
  },
});
