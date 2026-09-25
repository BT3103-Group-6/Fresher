// Demo mode (decisions A17). Off by default; the public demo deployment turns
// it on with DEMO_MODE=true in functions/.env.prod. It keeps two mocks
// available outside the emulator: the mock checkout (mockPay) and the
// postal-code stub.
const emulator = () => process.env.FUNCTIONS_EMULATOR === "true";
const demoMode = () => process.env.DEMO_MODE === "true";

// Callables enforce App Check by default, except in the Functions emulator,
// which does not attest requests. APP_CHECK_ENFORCE=false (functions/.env.prod)
// turns enforcement off for a deployment; only that exact value does (A17, L1).
const appCheckEnforced = () =>
  !emulator() && process.env.APP_CHECK_ENFORCE !== "false";
const appCheck = () => ({enforceAppCheck: appCheckEnforced()});

module.exports = {
  emulator,
  demoMode,
  // True where the mock checkout and the postal-code stub may run.
  mocksAllowed: () => emulator() || demoMode(),
  appCheckEnforced,
  appCheck,
};
