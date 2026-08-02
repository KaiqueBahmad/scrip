import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {

  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    server: {
      // No proxy: the browser calls VITE_API_BASE_URL directly, dev and prod alike.
      port: Number(env.VITE_DEV_PORT || 5273),
    },
  };
});
