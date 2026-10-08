// SPDX-License-Identifier: AGPL-3.0-or-later
// Exact depth-first branch and bound over the grid, day by day. Each partial assignment
// respects every hard rule that is already decided; the bound is (shortfall so far +
// static bound of later days, soft penalty so far). When the search finishes inside its
// node budget, the best rota found is proven optimal (or proven not to exist).

import type { Compiled } from './compile';
import type { Objective } from './grid';
import { Grid, better } from './grid';
import type { Budget } from './heuristic';
import { spend } from './heuristic';
import { cellOk, restPeriods } from './rows';

export interface ExactResult {
  complete: boolean;
  best: Grid | null;
  bestObj: Objective | null;
  nodes: number;
}

export function exactSearch(
  c: Compiled,
  incumbent: Grid | null,
  futureLB: number[],
  budget: Budget,
): ExactResult {
  const S = c.S;
  const D = c.D;
  const cell = new Int8Array(S * D);
  const count = new Int32Array(D * c.K);
  // suffix[d] = sum of static bounds for days >= d
  const suffix = new Array<number>(D + 1).fill(0);
  for (let d = D - 1; d >= 0; d--) suffix[d] = suffix[d + 1]! + futureLB[d]!;
  let best: Grid | null = null;
  let bestObj: Objective | null = null;
  if (incumbent) {
    const o = incumbent.objective();
    if (o.deficit === 0) {
      best = new Grid(c, incumbent.cell);
      bestObj = o;
    }
  }
  let nodes = 0;
  let aborted = false;
  const scratch = new Grid(c);
  const weekEnd = new Array<number>(c.weekCount).fill(-1);
  for (let d = 0; d < D; d++) weekEnd[c.week[d]!] = d;
  const maxWorkDay: number[] = [];
  for (let s = 0; s < S; s++) {
    let m = 0;
    for (let d = 0; d < D; d++)
      for (let k = 0; k < c.K; k++)
        if (c.allowed[(s * D + d) * c.V + k + 1]) m = Math.max(m, c.worked[d * c.K + k]!);
    maxWorkDay.push(m);
  }

  const dayShortfall = (d: number): number => {
    let short = 0;
    for (let k = 0; k < c.K; k++) {
      const need = c.demand[d * c.K + k]!;
      const have = count[d * c.K + k]!;
      if (have < need) short += need - have;
      for (const r of c.skillReqs[d * c.K + k]!) {
        let q = 0;
        for (let s = 0; s < S; s++)
          if (cell[s * D + d] === k + 1 && (c.staffMask[s]! & r.mask) === r.mask) q++;
        if (q < r.min) short += r.min - q;
      }
    }
    return short;
  };

  const minOk = (s: number, d: number): boolean => {
    // Weekly minimum: can the person still reach it in this week?
    const w = c.week[d]!;
    if (!c.weekFull[w] || c.minWeekly[s]! === 0) return true;
    let sum = 0;
    let left = 0;
    for (let x = 0; x < D; x++) {
      if (c.week[x] !== w) continue;
      if (x <= d) {
        const v = cell[s * D + x]!;
        if (v > 0) sum += c.worked[x * c.K + v - 1]!;
      } else left++;
    }
    return sum + left * maxWorkDay[s]! >= c.minWeekly[s]!;
  };

  const isoAt = (s: number, d: number): number =>
    d >= 2 && cell[s * D + d - 2]! > 0 && cell[s * D + d - 1] === 0 && cell[s * D + d]! > 0 ? 1 : 0;

  const values = (s: number, d: number): number[] => {
    const base = (s * D + d) * c.V;
    const list: number[] = [];
    for (let v = 0; v < c.V; v++) if (c.allowed[base + v]) list.push(v);
    const pref = incumbent ? incumbent.get(s, d) : -1;
    list.sort((a, b) => {
      if (a === pref) return -1;
      if (b === pref) return 1;
      const na = a > 0 && count[d * c.K + a - 1]! < c.demand[d * c.K + a - 1]! ? 0 : 1;
      const nb = b > 0 && count[d * c.K + b - 1]! < c.demand[d * c.K + b - 1]! ? 0 : 1;
      return na - nb || c.cellCost[base + a]! - c.cellCost[base + b]! || a - b;
    });
    return list;
  };

  const rec = (pos: number, accShort: number, accPen: number): void => {
    if (aborted) return;
    if (pos === S * D) {
      scratch.cell.set(cell);
      scratch.recompute();
      const o = scratch.objective();
      if (o.deficit === 0 && (!bestObj || better(o, bestObj))) {
        best = new Grid(c, cell);
        bestObj = o;
      }
      return;
    }
    const d = Math.floor(pos / S);
    const s = pos % S;
    for (const v of values(s, d)) {
      if (!spend(budget)) {
        aborted = true;
        return;
      }
      nodes++;
      if (v > 0 && count[d * c.K + v - 1]! >= c.cap[d * c.K + v - 1]!) continue;
      cell[s * D + d] = v;
      const row = cell.subarray(s * D, (s + 1) * D);
      // A day off can still complete a rest-day window that ends today.
      const restOk =
        v > 0 ||
        !c.restOn ||
        c.windowsEnding[d]!.every((wi) => restPeriods(c, row, wi) >= c.restCount);
      if ((v === 0 || cellOk(c, s, row, d, d)) && restOk && minOk(s, d)) {
        if (v > 0) count[d * c.K + v - 1]!++;
        let short = accShort;
        const pen =
          accPen + c.cellCost[(s * D + d) * c.V + v]! + c.weights.isolatedDayOff * isoAt(s, d);
        if (s === S - 1) short += dayShortfall(d);
        const lbShort = short + (s === S - 1 ? suffix[d + 1]! : suffix[d]!);
        const prune =
          bestObj !== null &&
          (lbShort > bestObj.shortfall ||
            (lbShort === bestObj.shortfall && pen >= bestObj.penalty));
        if (!prune) rec(pos + 1, short, pen);
        if (v > 0) count[d * c.K + v - 1]!--;
      }
      cell[s * D + d] = 0;
      if (aborted) return;
    }
  };
  // `suffix[d]` counts the static bound of day d itself, which is only valid before the
  // day is decided; once a day is complete its real shortfall replaces the bound.
  rec(0, 0, 0);
  return { complete: !aborted, best, bestObj, nodes };
}
