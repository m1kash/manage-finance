import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  base: '/manage-finance/',
  plugins: [
    viteSingleFile(),
    // HTTPS for local dev with a locally-trusted certificate
    mkcert(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // we register manually via virtual:pwa-register
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        navigateFallback: '/manage-finance/index.html',
      },
      manifest: {
        name: 'Finance Entry',
        short_name: 'Finance',
        start_url: '/manage-finance/',
        scope: '/manage-finance/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        description: 'Quickly add expenses to Google Sheets, works offline.',
        icons: [
          // Add real icons later; keeping minimal to avoid errors
        ],
      },
    }),
  ],
  server: {
    https: true,
    host: 'localhost',
  },
  build: {
    target: 'es2018',
    outDir: 'build',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
