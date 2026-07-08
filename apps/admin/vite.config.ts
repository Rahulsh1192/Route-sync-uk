import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // proxy API calls to the NestJS API in dev to avoid CORS friction
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
