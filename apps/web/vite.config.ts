import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true, // expose on the LAN so you can open it from a phone browser in dev
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
