# Security policy

ShiftKnit is a static web application. All scheduling happens in your browser; it
makes **no network requests** after the page has loaded, has no accounts and no
telemetry, and keeps your project only in your browser's IndexedDB (deletable with
one button). The bundled local server (`npm start`) only serves static files and
binds to `127.0.0.1` by default. The page ships a Content Security Policy that
blocks loading anything from other origins.

Imported project files are treated as untrusted: they are size- and depth-limited,
schema-validated, and names are only ever rendered as plain text. CSV exports
neutralise spreadsheet formulas.

Please report vulnerabilities privately through GitHub's "Report a vulnerability"
(security advisories) on <https://github.com/Kinfxhk/shiftknit> rather than in a
public issue.
