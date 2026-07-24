import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Project page: https://imed458.github.io/secrethitleronline.github.io/
// If a custom domain is added later, change base back to '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/secrethitleronline.github.io/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
}));
