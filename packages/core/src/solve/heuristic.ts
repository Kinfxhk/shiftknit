// SPDX-License-Identifier: AGPL-3.0-or-later
// Greedy construction followed by seeded local search (change, fill-gap and swap moves
// with a simple integer annealing rule). Used to find good rotas quickly at any size.

import type { Compiled } from './compile';
import type { Objective } from './grid';
import { Grid, better } from './grid';
import type { Rng } from './rng';
import { cellOk } from './rows';

export interface Budget {
  /** Remaining work units; decremented by the search. */
  left: number;
  /** Optional wall-clock stop (injected; the core never reads the clock itself). */
  timeUp?: () => boolean;
  stoppedByTime: boolean;
}

export function spend(b: Budget, n = 1): boolean {
  b.left -= n;
  if (b.left <= 0) return false;
  if (b.timeUp && (b.left & 1023) === 0 && b.timeUp()) {
    b.stoppedByTime = true;
    b.left = 0;
    return false;
  }
  return true;
}

/** Place locked shifts, then fill each day greedily. */
export function greedy(c: Compiled, rng: Rng): Grid {
  const g = new Grid(c);
  // Locked shifts first (they are the only allowed value of their cell).
  for (let s = 0; s < c.S; s++)
    for (let d = 0; d < c.D; d++) {
      const base = (s * c.D + d) * c.V;
      if (c.allowed[base]) continue;
      for (let v = 1; v < c.V; v++) if (c.allowed[base + v]) g.apply(s, d, v);
    }
  const order = Array.from({ length: c.S }, (_, i) => i);
  for (let d = 0; d < c.D; d++) {
    const slots: { k: number; slack: number; tie: number }[] = [];
    for (let k = 0; k < c.K; k++) {
      const need = c.demand[d * c.K + k]!;
      if (need === 0) continue;
      let elig = 0;
      for (let s = 0; s < c.S; s++) if (c.allowed[(s * c.D + d) * c.V + k + 1]) elig++;
      slots.push({ k, slack: elig - need, tie: rng.next() });
    }
    slots.sort((a, b) => a.slack - b.slack || a.tie - b.tie || a.k - b.k);
    for (const { k } of slots) {
      while (g.count[d * c.K + k]! < c.demand[d * c.K + k]!) {
        // Outstanding skill needs for this slot.
        const missing = c.skillReqs[k]!.filter((r) => {
          let q = 0;
          for (let s = 0; s < c.S; s++)
            if (g.get(s, d) === k + 1 && (c.staffMask[s]! & r.mask) === r.mask) q++;
          return q < r.min;
        });
        let best = -1;
        let bestKey: number[] = [];
        for (const s of order) {
          if (g.get(s, d) !== 0 || !c.allowed[(s * c.D + d) * c.V]) continue;
          if (!c.allowed[(s * c.D + d) * c.V + k + 1]) continue;
          const row = g.row(s);
          row[d] = k + 1;
          const ok = cellOkCached(c, s, row, d);
          row[d] = 0;
          if (!ok) continue;
          const skillHit = missing.some((r) => (c.staffMask[s]! & r.mask) === r.mask) ? 0 : 1;
          const below = g.deficitOf[s]! > 0 ? 0 : 1;
          const key = [
            missing.length ? skillHit : 0,
            below,
            c.cellCost[(s * c.D + d) * c.V + k + 1]! - c.cellCost[(s * c.D + d) * c.V]!,
            Math.floor(g.worked[s]! / 60),
            rng.next(),
          ];
          if (best < 0 || lexLess(key, bestKey)) {
            best = s;
            bestKey = key;
          }
        }
        if (best < 0) break;
        g.apply(best, d, k + 1);
      }
    }
  }
  return g;
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

// Later days hold only locked shifts at this point, so the full-row check is exact
// for them and optimistic (never wrong) for windows that are not yet decided.
function cellOkCached(c: Compiled, s: number, row: Int8Array, d: number): boolean {
  return cellOk(c, s, row, d);
}

/** Seeded local search from `g`. Returns the best grid found. */
export function localSearch(c: Compiled, start: Grid, rng: Rng, budget: Budget): Grid {
  const g = start;
  let cur = g.objective();
  let best = new Grid(c, g.cell);
  let bestObj = cur;
  if (c.S === 0 || c.D === 0 || c.K === 0) return best;
  let temp = 8;
  let sinceBest = 0;
  const accept = (next: Objective): boolean => {
    if (better(next, cur)) return true;
    if (next.deficit > cur.deficit || next.shortfall > cur.shortfall) return false;
    if (next.deficit < cur.deficit || next.shortfall < cur.shortfall) return true;
    const delta = next.penalty - cur.penalty;
    if (delta === 0) return rng.int(2) === 0;
    return rng.int(temp + delta) < temp && rng.int(4) === 0;
  };
  while (spend(budget)) {
    const r = rng.int(100);
    if (r < 35) {
      // Change one cell.
      const s = rng.int(c.S);
      const d = rng.int(c.D);
      const old = g.get(s, d);
      const v = rng.int(c.V);
      if (v === old || !g.trySet(s, d, v)) continue;
      const next = g.objective();
      if (accept(next)) cur = next;
      else g.apply(s, d, old);
    } else if (r < 70) {
      // Fill a gap: a day with shortfall, a shift on it, a person.
      const days: number[] = [];
      for (let d = 0; d < c.D; d++) if (g.dayShort[d]! > 0) days.push(d);
      let d: number;
      let s: number;
      let k: number;
      if (days.length > 0) {
        d = days[rng.int(days.length)]!;
        k = rng.int(c.K);
        s = rng.int(c.S);
      } else {
        // No gaps: work on weekly minimums or soft penalties.
        const short: number[] = [];
        for (let x = 0; x < c.S; x++) if (g.deficitOf[x]! > 0) short.push(x);
        s = short.length ? short[rng.int(short.length)]! : rng.int(c.S);
        d = rng.int(c.D);
        k = rng.int(c.K);
      }
      const old = g.get(s, d);
      if (old === k + 1) continue;
      // Free the slot by removing a random holder when it is full.
      let freed = -1;
      if (g.count[d * c.K + k]! >= c.demand[d * c.K + k]!) {
        const holders: number[] = [];
        for (let x = 0; x < c.S; x++) if (x !== s && g.get(x, d) === k + 1) holders.push(x);
        if (holders.length === 0) continue;
        freed = holders[rng.int(holders.length)]!;
        if (!g.trySet(freed, d, 0)) continue;
      }
      if (!g.trySet(s, d, k + 1)) {
        if (freed >= 0) g.apply(freed, d, k + 1);
        continue;
      }
      const next = g.objective();
      if (accept(next)) cur = next;
      else {
        g.apply(s, d, old);
        if (freed >= 0) g.apply(freed, d, k + 1);
      }
    } else {
      // Swap two people's cells on one day (staffing counts unchanged).
      const d = rng.int(c.D);
      const a = rng.int(c.S);
      const b = rng.int(c.S);
      const va = g.get(a, d);
      const vb = g.get(b, d);
      if (a === b || va === vb) continue;
      g.apply(a, d, 0);
      g.apply(b, d, 0);
      const okA = g.trySetUncapped(a, d, vb);
      const okB = okA && g.trySetUncapped(b, d, va);
      if (!okB) {
        g.apply(a, d, 0);
        g.apply(b, d, 0);
        g.apply(a, d, va);
        g.apply(b, d, vb);
        continue;
      }
      const next = g.objective();
      if (accept(next)) cur = next;
      else {
        g.apply(a, d, 0);
        g.apply(b, d, 0);
        g.apply(a, d, va);
        g.apply(b, d, vb);
      }
    }
    if (better(cur, bestObj)) {
      best = new Grid(c, g.cell);
      bestObj = cur;
      sinceBest = 0;
    } else if (++sinceBest > 4000) {
      temp = Math.max(1, temp >> 1);
      sinceBest = 0;
    }
  }
  return best;
}
