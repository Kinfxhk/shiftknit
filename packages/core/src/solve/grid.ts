// SPDX-License-Identifier: AGPL-3.0-or-later
// Solver state with incremental bookkeeping for the objective
// (weekly-minimum deficit, staffing shortfall, soft penalty), compared lexicographically.

import type { Compiled } from './compile';
import { cellOk, rowDeficit } from './rows';

export interface Objective {
  deficit: number;
  shortfall: number;
  penalty: number;
}

export function better(a: Objective, b: Objective): boolean {
  if (a.deficit !== b.deficit) return a.deficit < b.deficit;
  if (a.shortfall !== b.shortfall) return a.shortfall < b.shortfall;
  return a.penalty < b.penalty;
}

export function sameObjective(a: Objective, b: Objective): boolean {
  return a.deficit === b.deficit && a.shortfall === b.shortfall && a.penalty === b.penalty;
}

function spread(a: number[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of a) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return a.length ? hi - lo : 0;
}

export class Grid {
  readonly c: Compiled;
  readonly cell: Int8Array;
  readonly count: Int32Array;
  readonly worked: number[];
  readonly weekend: number[];
  readonly night: number[];
  readonly deficitOf: number[];
  readonly dayShort: number[];
  cost = 0;
  isolated = 0;

  constructor(c: Compiled, cells?: ArrayLike<number>) {
    this.c = c;
    this.cell = new Int8Array(c.S * c.D);
    if (cells) this.cell.set(cells);
    this.count = new Int32Array(c.D * c.K);
    this.worked = new Array<number>(c.S).fill(0);
    this.weekend = new Array<number>(c.S).fill(0);
    this.night = new Array<number>(c.S).fill(0);
    this.deficitOf = new Array<number>(c.S).fill(0);
    this.dayShort = new Array<number>(c.D).fill(0);
    this.recompute();
  }

  row(s: number): Int8Array {
    return this.cell.subarray(s * this.c.D, (s + 1) * this.c.D);
  }

  get(s: number, d: number): number {
    return this.cell[s * this.c.D + d]!;
  }

  recompute(): void {
    const c = this.c;
    this.count.fill(0);
    this.cost = 0;
    this.isolated = 0;
    for (let s = 0; s < c.S; s++) {
      this.worked[s] = 0;
      this.weekend[s] = 0;
      this.night[s] = 0;
      for (let d = 0; d < c.D; d++) {
        const v = this.get(s, d);
        this.cost += c.cellCost[(s * c.D + d) * c.V + v]!;
        if (v > 0) {
          this.count[d * c.K + v - 1]!++;
          this.worked[s]! += c.worked[d * c.K + v - 1]!;
          if (c.isWeekend[d]) this.weekend[s]!++;
          if (c.isNight[v - 1]) this.night[s]!++;
        }
      }
      this.isolated += this.isolatedIn(s, 0, c.D - 1);
      this.deficitOf[s] = rowDeficit(c, s, this.row(s));
    }
    for (let d = 0; d < c.D; d++) this.dayShort[d] = this.shortOfDay(d);
  }

  /** Work–off–work patterns whose middle day lies in [from, to]. */
  isolatedIn(s: number, from: number, to: number): number {
    let n = 0;
    for (let d = Math.max(1, from); d <= Math.min(this.c.D - 2, to); d++)
      if (this.get(s, d - 1) > 0 && this.get(s, d) === 0 && this.get(s, d + 1) > 0) n++;
    return n;
  }

  shortOfDay(d: number): number {
    const c = this.c;
    let short = 0;
    for (let k = 0; k < c.K; k++) {
      const need = c.demand[d * c.K + k]!;
      const have = this.count[d * c.K + k]!;
      if (have < need) short += need - have;
      for (const r of c.skillReqs[d * c.K + k]!) {
        let q = 0;
        for (let s = 0; s < c.S; s++)
          if (this.get(s, d) === k + 1 && (c.staffMask[s]! & r.mask) === r.mask) q++;
        if (q < r.min) short += r.min - q;
      }
    }
    return short;
  }

  objective(): Objective {
    const c = this.c;
    const w = c.weights;
    let deficit = 0;
    for (const x of this.deficitOf) deficit += x;
    let shortfall = 0;
    for (const x of this.dayShort) shortfall += x;
    const penalty =
      this.cost +
      w.fairHours * Math.floor(spread(this.worked) / 60) +
      w.fairWeekend * spread(this.weekend) +
      w.fairNight * spread(this.night) +
      w.isolatedDayOff * this.isolated;
    return { deficit, shortfall, penalty };
  }

  /** Set cell (s, d) to v if allowed by the hard rules and staffing caps. Returns false
   * (and leaves the grid unchanged) otherwise. Updates all bookkeeping. */
  trySet(s: number, d: number, v: number): boolean {
    const c = this.c;
    if (!c.allowed[(s * c.D + d) * c.V + v]) return false;
    const old = this.get(s, d);
    if (old === v) return true;
    if (v > 0 && this.count[d * c.K + v - 1]! >= c.cap[d * c.K + v - 1]!) return false;
    this.cell[s * c.D + d] = v;
    if (v > 0 && !cellOk(c, s, this.row(s), d)) {
      this.cell[s * c.D + d] = old;
      return false;
    }
    this.cell[s * c.D + d] = old;
    this.apply(s, d, v);
    return true;
  }

  /** Like trySet, but ignores the staffing cap (used by swaps, which keep counts). */
  trySetUncapped(s: number, d: number, v: number): boolean {
    const c = this.c;
    if (!c.allowed[(s * c.D + d) * c.V + v]) return false;
    const old = this.get(s, d);
    if (old === v) return true;
    this.cell[s * c.D + d] = v;
    const ok = v === 0 || cellOk(c, s, this.row(s), d);
    this.cell[s * c.D + d] = old;
    if (ok) this.apply(s, d, v);
    return ok;
  }

  /** Unchecked update with bookkeeping (caller guarantees validity). */
  apply(s: number, d: number, v: number): void {
    const c = this.c;
    const old = this.get(s, d);
    if (old === v) return;
    const isoBefore = this.isolatedIn(s, d - 1, d + 1);
    const base = (s * c.D + d) * c.V;
    this.cost += c.cellCost[base + v]! - c.cellCost[base + old]!;
    if (old > 0) {
      this.count[d * c.K + old - 1]!--;
      this.worked[s]! -= c.worked[d * c.K + old - 1]!;
      if (c.isWeekend[d]) this.weekend[s]!--;
      if (c.isNight[old - 1]) this.night[s]!--;
    }
    this.cell[s * c.D + d] = v;
    if (v > 0) {
      this.count[d * c.K + v - 1]!++;
      this.worked[s]! += c.worked[d * c.K + v - 1]!;
      if (c.isWeekend[d]) this.weekend[s]!++;
      if (c.isNight[v - 1]) this.night[s]!++;
    }
    this.isolated += this.isolatedIn(s, d - 1, d + 1) - isoBefore;
    this.deficitOf[s] = rowDeficit(c, s, this.row(s));
    this.dayShort[d] = this.shortOfDay(d);
  }
}
