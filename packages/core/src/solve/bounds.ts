// SPDX-License-Identifier: AGPL-3.0-or-later
// Staffing lower bounds that follow from availability, leave and locks alone. If the
// bound is above zero, full coverage is provably impossible whatever the other rules say.

import type { Compiled } from './compile';

export interface DayBound {
  day: number;
  /** Lower bound on the shortfall of this day. */
  bound: number;
}

/** Per-day shortfall lower bound (each person works at most one shift per day). */
export function staticBounds(c: Compiled): number[] {
  const out: number[] = [];
  for (let d = 0; d < c.D; d++) {
    let slotSum = 0;
    let totalNeed = 0;
    for (let k = 0; k < c.K; k++) {
      const need = c.demand[d * c.K + k]!;
      totalNeed += need;
      let elig = 0;
      for (let s = 0; s < c.S; s++) if (c.allowed[(s * c.D + d) * c.V + k + 1]) elig++;
      slotSum += Math.max(0, need - elig);
      for (const r of c.skillReqs[d * c.K + k]!) {
        let q = 0;
        for (let s = 0; s < c.S; s++)
          if (c.allowed[(s * c.D + d) * c.V + k + 1] && (c.staffMask[s]! & r.mask) === r.mask) q++;
        slotSum += Math.max(0, r.min - Math.min(q, c.cap[d * c.K + k]!));
      }
    }
    let people = 0;
    for (let s = 0; s < c.S; s++) {
      for (let k = 0; k < c.K; k++)
        if (c.allowed[(s * c.D + d) * c.V + k + 1]) {
          people++;
          break;
        }
    }
    out.push(Math.max(slotSum, totalNeed - people));
  }
  return out;
}
