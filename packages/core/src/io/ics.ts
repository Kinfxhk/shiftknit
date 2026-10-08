// SPDX-License-Identifier: AGPL-3.0-or-later
// iCalendar (RFC 5545) export, one calendar per person. Times are written in UTC (so no
// VTIMEZONE block is needed and daylight-saving changes are exact). Text is escaped, lines
// are folded at 75 octets without splitting UTF-8 characters, and every line ends in CRLF.
// UIDs are deterministic, so re-importing an updated rota replaces the old events.

import type { Project, Roster } from '../model/types';
import { parseDate, parseTime, shiftInterval } from '../time/index';
import { ENGINE_VERSION } from '../version';

export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Fold one content line to ≤75 octets per physical line (continuations start with a space). */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = encoder.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // continuation lines begin with one space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** 'YYYYMMDDTHHMMSSZ' from epoch minutes. */
export function utcStamp(epochMin: number): string {
  return new Date(epochMin * 60_000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** FNV-1a 32-bit hash as 8 hex digits (stable UIDs, not security). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const b of encoder.encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface IcsOptions {
  /** DTSTAMP (epoch minutes, UTC). Callers pass "now"; tests pass a fixed value. */
  stamp: number;
}

export function staffCalendar(
  project: Project,
  roster: Roster,
  staffId: string,
  opts: IcsOptions,
): string {
  const person = project.staff.find((s) => s.id === staffId);
  const shifts = new Map(project.shifts.map((s) => [s.id, s]));
  const ns = fnv1a(`${project.name}|${project.start}|${project.timeZone}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//ShiftKnit//ShiftKnit ${ENGINE_VERSION}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${project.name} – ${person?.name ?? staffId}`)}`,
  ];
  const mine = roster.assignments
    .filter((a) => a.staff === staffId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.shift < b.shift ? -1 : 1));
  for (const a of mine) {
    const sh = shifts.get(a.shift);
    const day = parseDate(a.date);
    if (!sh || day === undefined) continue;
    const iv = shiftInterval(
      day,
      parseTime(sh.start) ?? 0,
      parseTime(sh.end) ?? 0,
      project.timeZone,
    );
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ns}-${fnv1a(staffId)}-${a.date.replace(/-/g, '')}-${fnv1a(a.shift)}@shiftknit.invalid`,
      `DTSTAMP:${utcStamp(opts.stamp)}`,
      `DTSTART:${utcStamp(iv.start)}`,
      `DTEND:${utcStamp(iv.end)}`,
      `SUMMARY:${escapeText(sh.name)}`,
      `DESCRIPTION:${escapeText(`${project.name}: ${sh.name} ${sh.start}–${sh.end} (${project.timeZone})${sh.breakMinutes ? `, break ${sh.breakMinutes} min` : ''}`)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
