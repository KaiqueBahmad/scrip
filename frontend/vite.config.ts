import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Third arg '' loads every var from .env, not just the VITE_* ones the browser sees.
  // A real shell env wins over the file.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };

  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.VITE_DEV_PORT || 5273),
      // `npm run dev` here talks to the real API instead of a mock.
      proxy: {
        '/v1': { target: env.PSEUDOPAY_API || 'http://127.0.0.1:4242', changeOrigin: true },
      },
    },
  };
});
