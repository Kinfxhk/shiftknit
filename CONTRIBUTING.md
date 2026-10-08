# Contributing to ShiftKnit

Thank you for helping. ShiftKnit exists so that small shops, clinics, care homes,
NGOs and volunteer teams can build fair rotas for free, offline and without an
account. Correctness and legal cleanliness matter as much as features.

## Clean-room rule (mandatory)

1. **Do not copy code, UI, text, icons, colours or assets** from any commercial or
   open-source scheduling product. The solver and the checker are written from
   scratch from general, published operations-research ideas (branch and bound,
   constraint propagation, local search). Please do not paste or translate code
   from other schedulers, including permissively licensed ones, so the provenance
   of every line stays clear.
2. Work only from general knowledge and the written descriptions in this
   repository. Do not use screenshots or recordings of other products as templates.
3. **No trademarks as branding.** Other products may be named only in plain
   factual comparisons in the README, never in the UI, engine strings, examples or
   docs (`npm run check:hygiene` enforces this).
4. **Law.** Quote only public government documents, with a link, and keep the
   "not legal advice" wording.
5. **Third-party code** must be an npm dependency under an AGPL-3.0-compatible
   licence. Do not paste snippets of unknown origin, including from Q&A sites or
   AI tools.

## Correctness rule

Every rota the UI shows must pass the independent checker in
`packages/core/src/check/`. The checker must never import the solver (ESLint and
the hygiene script enforce this). A change to a rule needs golden tests, property
tests and, for the checker, a mutation test showing that a deliberately broken
version is caught. Infeasibility and optimality claims are cross-checked against
an exhaustive oracle on small cases (`test/oracle/`). Never weaken the checker to
make the solver pass.

## Cross-platform rule

CI runs on Linux and Windows. Start child processes with `process.execPath` (see
`scripts/lib/proc.mjs`), build paths with `node:path`, and never assert against a
hard-coded path string. Text files are checked out with LF everywhere
(`.gitattributes`).

## Developer Certificate of Origin

All commits must be signed off (`git commit -s`), certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): you wrote
the change or otherwise have the right to submit it under AGPL-3.0-or-later.

## Development

```bash
npm ci
npm run check      # lint, format, typecheck, tests, licences, hygiene, secrets
npm run test:e2e   # headless browser tests
```

`packages/core` must stay **pure**: no I/O, no clock, no `Math.random()` (ESLint
enforces this). Use the seeded RNG.

## Licence

By contributing you agree that your contribution is licensed under
AGPL-3.0-or-later.
