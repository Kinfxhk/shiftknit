// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Detects test assertions that compare against a hard-coded filesystem path such as
// 'packages/core/src/x.ts' or 'C:\\tmp\\x.json'. Those pass on one OS and fail on the
// other (CandleDrill review lesson). Tests must build expected paths with node:path or
// compare POSIX-normalised paths. A line may opt out with the comment `path-ok`.

const ASSERT_RE =
  /\.(toBe|toEqual|toStrictEqual|toContain|toMatch|toHaveProperty|endsWith|startsWith)\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g;

/** Does a string literal look like a filesystem path with separators? */
export function looksLikePath(lit) {
  if (!/[\\/]/.test(lit)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(lit)) return false; // URL
  if (/^\/[^/]*$/.test(lit) && !/\.\w{1,6}$/.test(lit)) return false; // '/api', '/healthz'
  if (/^\d{1,4}[\\/]\d{1,2}([\\/]\d{1,4})?$/.test(lit)) return false; // dates like 10/08
  if (/^\.{1,2}[\\/]/.test(lit)) return true; // ./x ../x
  if (/^[A-Za-z]:\\\\?/.test(lit)) return true; // C:\ drive
  if (/^\/(tmp|home|usr|var|etc|Users|workspace)\b/.test(lit)) return true;
  const segments = lit.split(/\\\\|\\|\//).filter(Boolean);
  return segments.length >= 2 && /\.[A-Za-z0-9]{1,6}$/.test(segments[segments.length - 1]);
}

/** Returns `{ line, literal }` for every hard-coded path assertion in `source`. */
export function findHardcodedPathAssertions(source) {
  const hits = [];
  source.split('\n').forEach((text, i) => {
    if (text.includes('path-ok')) return;
    for (const m of text.matchAll(ASSERT_RE)) {
      if (looksLikePath(m[3])) hits.push({ line: i + 1, literal: m[3] });
    }
  });
  return hits;
}
