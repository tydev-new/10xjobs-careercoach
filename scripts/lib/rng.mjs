// A small deterministic PRNG, seeded from an arbitrary string, so a
// design-sample run can be reproduced exactly by passing back the same
// --seed. Two well-known public-domain pieces wired together (xmur3 string
// hash -> mulberry32 generator) — written from scratch here, not copied
// from any third party.

/** Turn an arbitrary string into a 32-bit seed-producing function. */
export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** A fast, small, deterministic PRNG: returns a function () => number in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a deterministic () => number in [0, 1) generator from a string seed. */
export function rngFromSeed(seedString) {
  const seedFn = xmur3(String(seedString));
  return mulberry32(seedFn());
}

/**
 * Sample up to n items from arr without replacement, in a deterministic
 * order driven by rng(). Uses the first n steps of a Fisher-Yates shuffle
 * (uniform over the source order, given a fixed rng sequence).
 */
export function sampleWithoutReplacement(arr, n, rng) {
  const pool = arr.slice();
  const count = Math.max(0, Math.min(n, pool.length));
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}
