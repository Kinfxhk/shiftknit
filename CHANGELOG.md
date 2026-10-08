# Changelog

All notable changes to ShiftKnit are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-08

First public release. 首個公開版本。

### Added

- **Automatic rota** for up to 30 staff, 31 days, 6 shifts and 8 skills: availability,
  leave, no overlaps, minimum rest between shifts (across midnight), weekly hours
  (exact across daylight-saving changes), maximum days in a row, rest days (at least N
  rest days of 24 continuous hours in every 7 days, rolling or fixed), staffing and
  skill needs, and manual locks.
- **Independent checker**: every rota is checked rule by rule by code that shares
  nothing with the solver; a rota the checker rejects is never shown. Hand edits are
  checked live by the same checker.
- **Honest result labels**: proven best, feasible (not proven best), best with gaps
  (with proof when full staffing is impossible), or no solution.
- **"Why?" explanations**: a small, proven set of your rules that conflict, e.g. a
  skill need plus the leave days that make it impossible.
- **Preferences and fairness** (soft): preferences, spread of hours, weekend and night
  shifts, stability against a previous rota, and fewer single days off.
- **Web app**: staff × days grid and week calendar, locks and re-solve, solver in a
  Web Worker, works offline, data stays in the browser (IndexedDB) with one-click
  delete, English and Traditional Chinese, dark mode, large text, keyboard use.
- **Exports**: CSV (formula-injection safe), per-person iCalendar files (RFC 5545,
  UTC times, folded lines, stable UIDs), project and rota JSON, print views
  (team, per person, rest-day roster).
- **Command line**: `solve`, `check` and `export` with the same core.
- **Hong Kong rest-day preset** based on the Labour Department's Concise Guide
  (chapter 4). Not legal advice.
- Three examples: a small café, a care home with 12-hour night shifts, and a volunteer
  team across a clock change.
- Quality gates on Linux and Windows: lint, format, typecheck, unit/property/golden
  tests, exhaustive brute-force oracle on small cases, checker and solver mutants,
  browser tests (accessibility, offline, zero external requests), licence allowlist,
  secret scan, reproducible site zip, container health check.

[0.1.0]: https://github.com/Kinfxhk/shiftknit/releases/tag/v0.1.0
