// Demo mode (decisions A17). Off by default; the public demo deployment turns
// it on with DEMO_MODE=true in functions/.env.prod. It keeps two mocks
// available outside the emulator: the mock checkout (mockPay) and the
// postal-code stub.
const emulator = () => process.env.FUNCTIONS_EMULATOR === "true";
const demoMode = () => process.env.DEMO_MODE === "true";

// Callables enforce App Check everywhere except the Functions emulator, which
// does not attest requests (decisions A17, resolves L1).
const appCheck = () => ({enforceAppCheck: !emulator()});

module.exports = {
  emulator,
  demoMode,
  // True where the mock checkout and the postal-code stub may run.
  mocksAllowed: () => emulator() || demoMode(),
  appCheck,
};
