// Small seeded random generator for the demo dataset (A18). Same seed string, same sequence.
export function makeRng(seed) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r = {
    f: next,
    /** Integer in [lo, hi], both included. */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** One item, chosen with probability proportional to weight(item). */
    weighted(items, weight) {
      const ws = items.map(weight)
      let x = next() * ws.reduce((s, w) => s + w, 0)
      for (let i = 0; i < items.length; i++) {
        x -= ws[i]
        if (x < 0) return items[i]
      }
      return items[items.length - 1]
    },
    /** New shuffled array (Fisher-Yates). */
    shuffle(arr) {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    /** n distinct items. */
    sample: (arr, n) => r.shuffle(arr).slice(0, n),
  }
  return r
}
