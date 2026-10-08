// SPDX-License-Identifier: AGPL-3.0-or-later
// Solver-side rule logic on one person's row of cells (values 0 = off, k+1 = shift k).
// Written separately from the checker on purpose; tests compare both on every output.

import type { Compiled } from './compile';

const idx = (c: Compiled, d: number, v: number) => d * c.K + v - 1;

/** Rest periods (each restMin long) in window w for a row. */
export function restPeriods(c: Compiled, row: ArrayLike<number>, w: number): number {
  const [i, ws, we] = c.windows[w]!;
  let n = 0;
  let cursor = ws;
  for (let d = Math.max(0, i - 2); d < Math.min(c.D, i + 7); d++) {
    const v = row[d]!;
    if (v <= 0) continue;
    const a = Math.max(c.ivStart[idx(c, d, v)]!, ws);
    const b = Math.min(c.ivEnd[idx(c, d, v)]!, we);
    if (b <= a) continue;
    if (a > cursor) n += Math.floor((a - cursor) / c.restMin);
    if (b > cursor) cursor = b;
  }
  if (we > cursor) n += Math.floor((we - cursor) / c.restMin);
  return n;
}

function restOk(c: Compiled, row: ArrayLike<number>, a: number, b: number): boolean {
  // a < b are days with shifts; the gap from end(a) to start(b) must be >= minRest
  // (a negative gap is an overlap, also forbidden).
  const gap = c.ivStart[idx(c, b, row[b]!)]! - c.ivEnd[idx(c, a, row[a]!)]!;
  return gap >= c.minRest && gap >= 0;
}

/**
 * Local hard-rule check for cell d of person s, assuming the rest of the row was valid.
 * `upto` limits the look-ahead (days > upto are treated as unassigned), used by the
 * exact search, which fills the grid day by day.
 */
export function cellOk(
  c: Compiled,
  s: number,
  row: ArrayLike<number>,
  d: number,
  upto = c.D - 1,
): boolean {
  const v = row[d]!;
  if (v <= 0) return true;
  // Rest / overlap with the previous and next shift.
  for (let p = d - 1; p >= 0; p--)
    if (row[p]! > 0) {
      if (!restOk(c, row, p, d)) return false;
      break;
    }
  for (let n = d + 1; n <= upto; n++)
    if (row[n]! > 0) {
      if (!restOk(c, row, d, n)) return false;
      break;
    }
  // Consecutive days.
  let run = 1;
  for (let p = d - 1; p >= 0 && row[p]! > 0; p--) run++;
  for (let n = d + 1; n <= upto && row[n]! > 0; n++) run++;
  if (run > c.maxConsec[s]!) return false;
  // Weekly maximum.
  const w = c.week[d]!;
  let sum = 0;
  for (let x = 0; x <= upto; x++)
    if (c.week[x] === w && row[x]! > 0) sum += c.worked[idx(c, x, row[x]!)]!;
  if (sum > c.maxWeekly[s]!) return false;
  // Rest days in windows touching d that are fully decided.
  if (c.restOn)
    for (const wi of c.windowsContaining[d]!) {
      if (c.windows[wi]![0] + 6 > upto) continue;
      if (restPeriods(c, row, wi) < c.restCount) return false;
    }
  return true;
}

/** Weekly-minimum shortfall (minutes) over full weeks for a complete row. */
export function rowDeficit(c: Compiled, s: number, row: ArrayLike<number>): number {
  if (c.minWeekly[s]! === 0) return 0;
  const sums = new Array<number>(c.weekCount).fill(0);
  for (let d = 0; d < c.D; d++) if (row[d]! > 0) sums[c.week[d]!]! += c.worked[idx(c, d, row[d]!)]!;
  let def = 0;
  for (let w = 0; w < c.weekCount; w++)
    if (c.weekFull[w]) def += Math.max(0, c.minWeekly[s]! - sums[w]!);
  return def;
}

/** Full hard-rule check of a complete row (used for locks and in tests). */
export function rowOk(c: Compiled, s: number, row: ArrayLike<number>): boolean {
  for (let d = 0; d < c.D; d++) {
    if (!c.allowed[(s * c.D + d) * c.V + row[d]!]) return false;
    if (!cellOk(c, s, row, d)) return false;
  }
  return true;
}
