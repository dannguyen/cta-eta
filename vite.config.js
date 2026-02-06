import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const ctaProxy = {
  '/api/train': {
    target: 'https://lapi.transitchicago.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/train/, '')
  },
  '/api/bus': {
    target: 'https://www.ctabustracker.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/bus/, '')
  }
};

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: ctaProxy
  },
  preview: {
    proxy: ctaProxy
  }
});
