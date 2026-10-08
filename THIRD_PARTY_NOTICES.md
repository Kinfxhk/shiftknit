# Third-party notices

ShiftKnit is licensed under AGPL-3.0-or-later. The core (`packages/core`) and the
browser UI (`packages/web`) have **no third-party runtime dependencies**: the data
model, time-zone maths, rule checker, solver, CSV and iCalendar writers and the UI
are original code written for this project. Time-zone rules come from the
`Intl` API built into your browser or Node.js.

The full dependency list with licences is produced by `npm run check:licenses`,
which also enforces an AGPL-3.0-compatible allowlist in CI (it fails closed on
unknown or malformed licence expressions).

## Development-only tools (not shipped)

Vite, Vitest, fast-check, Playwright, axe-core (`@axe-core/playwright`, MPL-2.0),
ESLint, Prettier, TypeScript and tsx are used only to build and test ShiftKnit.
MPL-2.0 is accepted for development tooling only.

## Secret scanning

CI runs [gitleaks](https://github.com/gitleaks/gitleaks) (MIT), downloaded at a
pinned version and checked against its published SHA-256 checksums. It is not
part of the repository or of any release artefact.
