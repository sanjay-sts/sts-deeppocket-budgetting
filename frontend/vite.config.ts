import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: on Windows localhost resolves to ::1 first, and a sibling
        // repo's SurrealDB listens on [::1]:8000 — it would answer every /api call with a 404.
        target: process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});