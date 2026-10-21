// A17 demo mode, web side. The flag is off unless the build sets VITE_DEMO_MODE=true (.env.production for the
// public demo). The server decides what really works. There is no site-wide demo label (A17); the deposit checkout
// keeps its own "Test mode" note.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

// The mock checkout exists in the emulator (dev) and in demo mode.
export const MOCK_CHECKOUT = import.meta.env.DEV || DEMO_MODE

// A17: App Check is on unless the build sets VITE_APP_CHECK_ENABLED=false (the preview-channel demo does).
// The functions must agree (APP_CHECK_ENFORCE); a mismatch makes callables fail, never silently open up.
export const APP_CHECK_ENABLED = import.meta.env.VITE_APP_CHECK_ENABLED !== 'false'
