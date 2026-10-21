const {setGlobalOptions} = require("firebase-functions");
const {initializeApp} = require("firebase-admin/app");

// Cost control: cap concurrent containers per function.
setGlobalOptions({region: "asia-southeast1", maxInstances: 10});

initializeApp();

// Integration (docs/team-plan.md): each story's PR adds its own requires,
// helpers and export blocks verbatim from the prototype. PR-19 restores the
// prototype file exactly.
