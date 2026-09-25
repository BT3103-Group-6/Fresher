import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Vendor chunks by service, so a screen downloads only the Firebase parts it uses (NFR-01).
        // `firebase-core` (app, util, component, logger) is shared by all three services.
        codeSplitting: {
          groups: [
            { name: 'firebase-firestore', test: /node_modules[\\/](@firebase[\\/]firestore|firebase[\\/]firestore)[\\/]/, priority: 40, includeDependenciesRecursively: false },
            { name: 'firebase-auth', test: /node_modules[\\/](@firebase[\\/]auth|firebase[\\/]auth)[\\/]/, priority: 40, includeDependenciesRecursively: false },
            { name: 'firebase-functions', test: /node_modules[\\/](@firebase[\\/]functions|firebase[\\/]functions)[\\/]/, priority: 40, includeDependenciesRecursively: false },
            { name: 'firebase-core', test: /node_modules[\\/](@firebase|firebase|idb)[\\/]/, priority: 30 },
            { name: 'vue', test: /node_modules[\\/](vue|@vue|vue-router)[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
