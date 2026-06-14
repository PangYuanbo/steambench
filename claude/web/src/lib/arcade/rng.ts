/**
 * A tiny, portable, deterministic PRNG (mulberry32).
 *
 * This is the TypeScript mirror of `harness/steambench_harness/rng.py`. Both
 * implementations are byte-for-byte verified against the canonical JavaScript
 * mulberry32 so that a recorded `(seed, actions)` trace replays identically in
 * either language (this is how SteamBench replay-verifies arcade runs).
 *
 * Canonical JS reference:
 *   function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
 *     var t=Math.imul(a^a>>>15,1|a);
 *     t=t+Math.imul(t^t>>>7,61|t)^t;
 *     return((t^t>>>14)>>>0)/4294967296;};}
 */

const MASK = 0xffffffff;

/** Seedable PRNG matching the canonical JS mulberry32 bit-for-bit. */
export class Mulberry32 {
  private a: number;

  constructor(seed = 0) {
    // Keep the state in the unsigned 32-bit domain, matching Python's
    // `self.a = seed & _MASK`.
    this.a = seed & MASK;
  }

  /** Next raw unsigned 32-bit integer. Mirrors `mulberry32()()` pre-divide. */
  nextU32(): number {
    // a = (a + 0x6D2B79F5) & MASK  (the `| 0` in JS works on the signed view,
    // but masking to 32 bits then taking the unsigned value is equivalent for
    // the purposes of the subsequent arithmetic, exactly as Python does it).
    this.a = (this.a + 0x6d2b79f5) & MASK;
    const a = this.a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = ((t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t) & MASK;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1), matching `mulberry32()()` in JS. */
  random(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform integer in [0, n). Same formula as the Python mirror. */
  randrange(n: number): number {
    if (n <= 0) {
      throw new Error("randrange requires n > 0");
    }
    return Math.floor(this.random() * n);
  }

  /** Uniform element of a sequence. */
  choice<T>(seq: readonly T[]): T {
    if (seq.length === 0) {
      throw new Error("cannot choose from an empty sequence");
    }
    return seq[this.randrange(seq.length)];
  }
}
