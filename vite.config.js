import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // A17: a production build must carry the real web config and the App Check site key, never placeholders.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']
    // The site key is needed only while App Check is on (VITE_APP_CHECK_ENABLED=false skips it).
    if (env.VITE_APP_CHECK_ENABLED !== 'false') required.push('VITE_APP_CHECK_SITE_KEY')
    const bad = required
      .filter((k) => !env[k] || env[k].startsWith('demo-'))
    if (bad.length) {
      throw new Error(`Refusing to build: set real values for ${bad.join(', ')} in .env.local (see docs/deployment.md).`)
    }
  }
  return config
})

const config = {
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
}
