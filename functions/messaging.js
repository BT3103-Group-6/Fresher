// FR-09: messaging provider interface (decisions A4). The prototype only has
// a mock: it logs the message and reports a simulated delivery outcome. A real
// provider would implement the same send() and read its secret from Functions
// secrets. Nothing here reaches a real phone (limitation L4).
const logger = require("firebase-functions/logger");

const MOCK_FAIL_SUFFIX = "0000"; // test numbers ending 0000 always fail.

/**
 * @param {string} phone E.164 number.
 * @return {string} The number with the middle digits hidden, for logs.
 */
function maskForLog(phone) {
  return `${phone.slice(0, 4)}•••${phone.slice(-2)}`;
}

/**
 * @param {Function} log Log function (replaceable in tests).
 * @return {Object} A provider: {name, send({to, body, key})} where send
 *   resolves to {ok: true, providerRef} or {ok: false, error}. `key` is an
 *   idempotency key a real provider can de-duplicate on (limitation L21).
 */
function mockProvider(log) {
  const write = log || ((msg, data) => logger.info(msg, data));
  return {
    name: "mock",
    /**
     * @param {Object} msg {to, body, key}.
     * @return {Promise<Object>} The simulated delivery outcome.
     */
    async send({to, body, key}) {
      if (to.endsWith(MOCK_FAIL_SUFFIX)) {
        write("[mock sms] delivery failed", {to: maskForLog(to), key});
        return {ok: false, error: "MOCK_DELIVERY_FAILED"};
      }
      write("[mock sms] sent", {to: maskForLog(to), body, key});
      return {ok: true, providerRef: `mock-${key}`};
    },
  };
}

module.exports = {mockProvider, MOCK_FAIL_SUFFIX};
