import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const target = process.env.VITE_BACKEND ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // same-origin in dev and prod: REST + WebSocket go through the proxy
    proxy: { '/api': target, '/ws': { target, ws: true } },
  },
  test: { environment: 'jsdom', setupFiles: ['tests/setup.ts'], globals: true, css: false },
});
