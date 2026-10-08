# How ShiftKnit builds and checks a rota

ShiftKnit has two independent parts:

1. **The solver** (`packages/core/src/solve/`) searches for a good rota.
2. **The checker** (`packages/core/src/check/`) re-checks every rule from scratch. It
   never imports the solver (ESLint and `npm run check:hygiene` enforce this). A rota is
   shown only when the checker finds no broken hard rule _and_ agrees with the solver's
   own staffing shortfall and penalty score (`solveAndCheck` in `packages/core/src/api.ts`).
   If they disagree, the rota is withheld and the result is marked as rejected.

## What the solver optimises

Lexicographically, in this order:

1. every hard rule holds (availability, leave, no overlap, minimum rest, weekly hours,
   days in a row, rest days, no overstaffing, locks);
2. the **staffing shortfall** is as small as possible (unfilled places plus missing
   skills). If people are short, ShiftKnit reports the gaps instead of breaking rules;
3. the **soft penalty** is as small as possible: preferences, fairness (spread of hours,
   weekend shifts and night shifts between people), stability against a previous rota,
   and work–off–work patterns. All weights are whole numbers you can change.

## How it searches

- A greedy pass fills each day, scarcest shift first.
- Seeded local search then changes single cells, fills gaps and swaps people on a day,
  with a simple integer annealing rule.
- Finally an exact depth-first **branch and bound** explores the whole grid day by day.
  If it finishes inside its node budget the rota is **proven optimal** (or no rota is
  **proven** to exist). If the budget runs out, the result is labelled
  "feasible, not proven optimal".
- Staffing **lower bounds** from availability, leave and locks alone prove that full
  coverage is impossible even when the search is not finished.

The solver uses a seeded random number generator and whole-number arithmetic only, so
the same project and seed give byte-identical output on Linux and Windows (CI compares
a golden hash). A wall-clock time limit, when used, can stop the search at a different
point and is reported as `stoppedBy: "time"`.

## How the claims are tested

- **Exhaustive oracle** (`test/oracle/`): for 340 small random projects every possible
  rota is enumerated and judged by the checker. The solver's "no rota exists", "full
  coverage impossible" and "proven optimal" claims must match exactly.
- **1,000 random projects**: every rota the solver returns passes the checker.
- **Mutation tests**: 16 deliberately broken checkers must each fail the golden table;
  deliberately broken solvers (ignoring the rest minimum or weekly hours, or misreporting
  the score) must be stopped by the checker.

## Modelling notes

- The solver gives each person at most one shift per day. The checker does not assume
  this and checks any roster.
- A **rest day** is a continuous period of at least the set length (default 24 hours)
  without work, counted inside each 7-day window; one 48-hour break counts as two rest
  days. Windows are either every run of 7 consecutive days (_rolling_, the default) or
  consecutive 7-day blocks from the first day (_fixed_). Periods shorter than 7 days are
  not checked.
- **Weekly hours** count real worked minutes (break excluded, daylight-saving changes
  included) in the week of the shift's start date. The maximum applies to every week;
  the minimum only to weeks that lie completely inside the rota period.
- **Days in a row** count calendar days on which a shift starts.
- **Leave** forbids any shift that overlaps the leave day, including a night shift that
  starts the evening before.

## Optional LP/MIP back end (pre-study, 2026-10-08)

The `highs` npm package (HiGHS compiled to WebAssembly, MIT, version 1.15.3) was
considered. Desk review only: about 4.0 MB unpacked, floating-point LP/MIP whose
byte-for-byte reproducibility across platforms was not verified, and it could not be
tested on Windows locally. Because the pure TypeScript solver already meets the oracle
and benchmark tests with zero dependencies, **v0.1 does not use it**. It may be revisited
for larger projects.
