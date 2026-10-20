/**
 * Deterministic RNG: the same seed reproduces the same day, everywhere — in the
 * browser, in the check scripts and in the test suite.
 */
export type Rng = () => number

/** the LCG the simulation has always used, now shared by scenarios and tests */
export function lcg(seed: number): Rng {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Box–Muller standard normal — used for arrival/egress spread around event times */
export function gaussian(rand: Rng): number {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
