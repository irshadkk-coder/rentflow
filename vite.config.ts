import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  return {
    plugins: [react(), tailwindcss()],
    define: isBuild ? {
      'import.meta.env.PROD': 'true',
      'import.meta.env.DEV': 'false',
    } : {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: process.env.VITE_API_URL || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
