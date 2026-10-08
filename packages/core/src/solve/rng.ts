// SPDX-License-Identifier: AGPL-3.0-or-later
/** Small deterministic PRNG (mulberry32-style integer mixing). Same seed → same stream on
 * every platform. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) ^ 0x9e3779b9;
  }
  /** Next 32-bit unsigned integer. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return n <= 1 ? 0 : this.next() % n;
  }
}
