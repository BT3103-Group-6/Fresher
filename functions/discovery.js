// FR-01: the shop summary fields that discovery reads (decisions A11). Clients
// never write these; the services trigger recomputes them from the shop's
// active services.
const CATEGORIES =
  ["haircut", "beard", "shave", "colour", "perm", "kids", "other"];

/**
 * Derives the trigger-owned shop fields from service documents. Inactive
 * services are ignored.
 * @param {Object[]} services Service documents of one shop
 *   (category, durationMin, priceCents, active).
 * @return {Object} priceMin, priceMax, serviceTypes and minDurationMin,
 *   to merge into the shop document.
 */
function summarizeServices(services) {
  const active = services.filter((s) => s.active === true);
  if (active.length === 0) {
    return {
      priceMin: null, priceMax: null, serviceTypes: [], minDurationMin: null,
    };
  }
  const prices = active.map((s) => s.priceCents);
  const types = new Set(active.map((s) => s.category));
  return {
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    serviceTypes: CATEGORIES.filter((c) => types.has(c)),
    minDurationMin: Math.min(...active.map((s) => s.durationMin)),
  };
}

module.exports = {CATEGORIES, summarizeServices};
