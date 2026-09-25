import { initializeApp } from 'firebase/app'
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check'

export const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

// A17: production builds attest with App Check (reCAPTCHA Enterprise); every callable enforces it. In dev the
// emulators are used and need no token. The site key is checked at build time (vite.config.js).
if (!import.meta.env.DEV) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}
