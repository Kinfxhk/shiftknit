// SPDX-License-Identifier: AGPL-3.0-or-later
// RFC 4180 CSV with spreadsheet formula-injection protection: any field that starts with
// = + - @, a tab or a carriage return gets a leading apostrophe, so spreadsheet programs
// show it as text instead of running it.

const DANGEROUS = /^[=+\-@\t\r]/;

export function neutralise(field: string): string {
  return DANGEROUS.test(field) ? `'${field}` : field;
}

function quote(field: string): string {
  const f = neutralise(field);
  return /[",\r\n]/.test(f) || f !== f.trim() ? `"${f.replace(/"/g, '""')}"` : f;
}

/** Rows to CSV text (CRLF line ends). `bom` adds a UTF-8 byte-order mark for spreadsheets. */
export function toCsv(rows: string[][], bom = true): string {
  return (bom ? '\ufeff' : '') + rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** Minimal RFC 4180 parser (used for round-trip tests and future import). */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  while (i < s.length) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' && s[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
