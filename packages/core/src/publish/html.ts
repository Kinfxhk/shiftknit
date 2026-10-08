// SPDX-License-Identifier: AGPL-3.0-or-later
// The read-only share file: one self-contained HTML page (no scripts, no external files,
// no network) with the whole-team rota, who is on each shift, and one section per person
// with their shifts and weekly hours. Safe to forward in a chat app. All text from the
// project is escaped.

import type { Lang } from '../i18n/index';
import { formatMinutes, weekdayNames } from '../i18n/index';
import type { Project, Roster } from '../model/types';
import { formatDate, parseDate, weekday } from '../time/index';
import type { RosterChange } from './diff';
import { describeChange } from './diff';
import { weeklyHours } from './hours';
import { st } from './labels';

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for HTML element content and quoted attribute values. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

/** JSON that is safe inside <script type="application/json"> (no "</script>", no "<!--"). */
export function jsonForScript(v: unknown): string {
  return (JSON.stringify(v) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface ShareOptions {
  lang: Lang;
  version: string;
  /** When the copy was made or published, already formatted for people. */
  at: string;
  /** Published version number; omit for a draft copy. */
  published?: number;
  /** Changes since an earlier published version. */
  changes?: { since: number; list: RosterChange[] };
}

const SHARE_CSS = `body{font:15px/1.45 system-ui,sans-serif;margin:0;background:#fff;color:#111}
main{max-width:70rem;margin:0 auto;padding:1rem}h1{font-size:1.35rem;margin:.2rem 0}h2{font-size:1.15rem;margin-top:1.6rem}
.meta{color:#444}.wrap{overflow-x:auto}table{border-collapse:collapse;min-width:100%}
th,td{border:1px solid #bbb;padding:.25rem .4rem;text-align:left;vertical-align:top;white-space:nowrap}
thead th{background:#eef3f2;position:sticky;top:0}.we{background:#f6f1e7}.off{color:#888}
details{border:1px solid #ccc;border-radius:.4rem;margin:.4rem 0;padding:.3rem .6rem}summary{cursor:pointer;font-weight:600}
nav a{margin-right:.6rem;display:inline-block}ul.changes li{margin:.15rem 0}footer{margin-top:2rem;color:#555;font-size:.85rem}
@media (prefers-color-scheme:dark){body{background:#121212;color:#eee}thead th{background:#1f2b2a}.we{background:#2a251c}.meta,footer{color:#bbb}th,td{border-color:#444}}
@media print{details{border:0}details>summary{display:none}nav{display:none}}`;

export function shareHtml(project: Project, roster: Roster, o: ShareOptions): string {
  const e = escapeHtml;
  const L = (k: Parameters<typeof st>[1], p: Record<string, string | number> = {}) =>
    e(st(o.lang, k, p));
  const first = parseDate(project.start) ?? 0;
  const dates = Array.from({ length: project.days }, (_, d) => formatDate(first + d));
  const wdn = weekdayNames(o.lang);
  const wd = (date: string) => weekday(parseDate(date) ?? 0);
  const shifts = new Map(project.shifts.map((s) => [s.id, s]));
  const cell = new Map<string, string[]>();
  const slot = new Map<string, string[]>();
  const names = new Map(project.staff.map((s) => [s.id, s.name]));
  const seen = new Set<string>();
  for (const a of roster.assignments) {
    const k = `${a.staff}|${a.date}|${a.shift}`;
    if (seen.has(k) || !shifts.has(a.shift) || !names.has(a.staff)) continue;
    seen.add(k);
    cell.set(`${a.staff}|${a.date}`, [...(cell.get(`${a.staff}|${a.date}`) ?? []), a.shift]);
    slot.set(`${a.date}|${a.shift}`, [
      ...(slot.get(`${a.date}|${a.shift}`) ?? []),
      names.get(a.staff)!,
    ]);
  }
  const shiftLabel = (id: string) => {
    const s = shifts.get(id)!;
    return `${s.name} ${s.start}–${s.end}`;
  };
  const dayHead = dates
    .map((d) => `<th class="${wd(d) >= 5 ? 'we' : ''}">${e(wdn[wd(d)]!)}<br>${e(d.slice(5))}</th>`)
    .join('');
  const team = project.staff
    .map(
      (s) =>
        `<tr><th scope="row">${e(s.name)}</th>${dates
          .map((d) => {
            const ids = cell.get(`${s.id}|${d}`) ?? [];
            return ids.length
              ? `<td>${ids.map((id) => e(shifts.get(id)!.name)).join('<br>')}</td>`
              : `<td class="off">${L('share.off')}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('\n');
  const byShift = project.shifts
    .map(
      (sh) =>
        `<tr><th scope="row">${e(sh.name)}<br><small>${e(sh.start)}–${e(sh.end)}</small></th>${dates
          .map((d) => `<td>${(slot.get(`${d}|${sh.id}`) ?? []).sort().map(e).join('<br>')}</td>`)
          .join('')}</tr>`,
    )
    .join('\n');
  const hours = weeklyHours(project, roster);
  const people = project.staff
    .map((s, i) => {
      const mine = dates.flatMap((d) =>
        (cell.get(`${s.id}|${d}`) ?? []).map(
          (id) => `<li>${e(wdn[wd(d)]!)} ${e(d)}: ${e(shiftLabel(id))}</li>`,
        ),
      );
      const row = hours.rows.find((r) => r.staff === s.id)!;
      const weeks = hours.weeks
        .map(
          (w, j) =>
            `<li>${L('share.week', { date: w })}: ${e(formatMinutes(o.lang, row.minutes[j]!))}</li>`,
        )
        .join('');
      return `<details id="p-${i}"><summary>${e(s.name)} · ${e(formatMinutes(o.lang, row.total))}</summary>
<ul>${mine.length ? mine.join('') : `<li>${L('share.noShifts')}</li>`}</ul>
<p>${L('share.hours')}</p><ul>${weeks}</ul></details>`;
    })
    .join('\n');
  const nav = project.staff.map((s, i) => `<a href="#p-${i}">${e(s.name)}</a>`).join(' ');
  const changes = o.changes
    ? o.changes.list.length
      ? `<h2>${L('share.changes', { n: o.changes.since })}</h2><ul class="changes">${o.changes.list
          .map((c) => `<li>${e(describeChange(o.lang, project, c))}</li>`)
          .join('')}</ul>`
      : `<h2>${L('share.noChanges', { n: o.changes.since })}</h2>`
    : '';
  const status =
    o.published !== undefined
      ? L('share.published', { n: o.published, at: o.at })
      : L('share.draft', { at: o.at });
  const title = `${project.name} — ${st(o.lang, 'share.title')}`;
  return `<!doctype html>
<html lang="${o.lang === 'zh-HK' ? 'zh-Hant-HK' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="ShiftKnit ${e(o.version)}">
<title>${e(title)}</title>
<style>${SHARE_CSS}</style>
</head>
<body>
<main>
<h1>${e(title)}</h1>
<p class="meta">${L('share.period', { from: dates[0]!, to: dates[dates.length - 1]!, tz: project.timeZone })}<br>${status}</p>
${changes}
<h2>${L('share.team')}</h2>
<div class="wrap"><table><thead><tr><th>${L('share.person')}</th>${dayHead}</tr></thead><tbody>
${team}
</tbody></table></div>
<h2>${L('share.byShift')}</h2>
<div class="wrap"><table><thead><tr><th></th>${dayHead}</tr></thead><tbody>
${byShift}
</tbody></table></div>
<h2>${L('share.people')}</h2>
<nav aria-label="${L('share.jump')}">${nav}</nav>
${people}
<footer><p>${L('share.footer', { version: o.version })}</p></footer>
</main>
</body>
</html>
`;
}
