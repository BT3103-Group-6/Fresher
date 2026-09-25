// A17 demo mode, web side. The flag is off unless the build sets VITE_DEMO_MODE=true (.env.production for the
// public demo). The server decides what really works; this only controls labelling and the mock checkout buttons.
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

// The mock checkout exists in the emulator (dev) and in demo mode.
export const MOCK_CHECKOUT = import.meta.env.DEV || DEMO_MODE

// The postal codes the built-in stub knows (the sample shops), for the demo notice.
export const SAMPLE_POSTAL_CODES = ['160055', '520478', '600135']
