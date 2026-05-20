import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Static manifest at public/pepper-manifest.webmanifest is served
      // alongside the generated one. PepperPage swaps the document's <link
      // rel="manifest"> to it so installs from /pepper register their own
      // scope/start_url.
      includeAssets: ['icon.svg', 'icon-maskable.svg', 'pepper-manifest.webmanifest'],
      manifest: {
        name: 'Menu COGS',
        short_name: 'Menu COGS',
        description: 'Menu cost of goods management for restaurant franchise operators',
        theme_color: '#146A34',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
        // Long-press the home-screen icon (Android) / right-click the dock icon
        // to jump straight into the Pepper standalone chat.
        shortcuts: [
          {
            name: 'Ask Pepper',
            short_name: 'Pepper',
            description: 'Open the Pepper AI assistant',
            url: '/pepper',
            icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
          },
        ],
      },
      workbox: {
        // Main bundle crossed 2 MiB after the QSC Audit module landed.
        // Raise the precache cap to 4 MiB so the PWA installs cleanly.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Cache static assets
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // API calls are never cached — always go to network
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
