// SPDX-License-Identifier: AGPL-3.0-or-later
// Availability collection without a server. The manager exports a self-contained form
// (one HTML file, works offline); each person fills it in and sends back a short reply
// (text or file). The manager imports replies, sees every difference against the current
// project, and applies them only after confirming. Replies are untrusted input: they are
// parsed strictly, like project files.

import type { Lang } from '../i18n/index';
import { weekdayNames } from '../i18n/index';
import type { ModelError, Result } from '../model/errors';
import { safeParseJson } from '../model/json';
import type { AvailabilityWindow, Preference, Project, Staff } from '../model/types';
import { formatDate, parseDate, parseTime } from '../time/index';
import { escapeHtml, jsonForScript } from './html';
import { st } from './labels';

export const REPLY_SCHEMA = 'shiftknit/availability';
export const REPLY_VERSION = 1;
/** Per weekday: any time, not available, or up to 3 windows starting that day. */
export type DayAvailability = 'any' | 'off' | [string, string][];

export interface AvailabilityReply {
  schema: typeof REPLY_SCHEMA;
  version: typeof REPLY_VERSION;
  /** First day of the period the form was made for. */
  period: string;
  staff: string;
  name: string;
  /** Monday first, 7 entries. */
  days: DayAvailability[];
  /** Leave dates inside the period. */
  leave: string[];
  /** Weekdays the person prefers not to work (Monday = 0). */
  avoid: number[];
  note: string;
}

const MAX_WINDOWS_PER_DAY = 3;
const MAX_TEXT_CHARS = 200_000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/;

function periodDates(p: Project): { first: number; last: number } {
  const first = parseDate(p.start) ?? 0;
  return { first, last: first + p.days - 1 };
}

const isPlainAvoid = (x: Preference) =>
  x.kind === 'avoid' && x.weekday !== undefined && x.shift === undefined && x.date === undefined;

/** The person's current settings in reply form (what the form is pre-filled with). */
export function staffToReply(p: Project, staffId: string): AvailabilityReply {
  const s = p.staff.find((x) => x.id === staffId);
  const { first, last } = periodDates(p);
  const days: DayAvailability[] = [];
  for (let d = 0; d < 7; d++) {
    if (!s || s.availability.length === 0) {
      days.push('any');
      continue;
    }
    const ws = s.availability.filter((w) => w.days.includes(d));
    if (ws.some((w) => w.from === '00:00' && w.to === '24:00')) days.push('any');
    else if (ws.length === 0) days.push('off');
    else {
      const uniq = [...new Set(ws.map((w) => `${w.from}-${w.to}`))].sort();
      days.push(uniq.map((k) => k.split('-') as [string, string]));
    }
  }
  return {
    schema: REPLY_SCHEMA,
    version: REPLY_VERSION,
    period: p.start,
    staff: staffId,
    name: s?.name ?? staffId,
    days,
    leave: (s?.leave ?? [])
      .filter((d) => {
        const n = parseDate(d);
        return n !== undefined && n >= first && n <= last;
      })
      .sort(),
    avoid: [...new Set((s?.preferences ?? []).filter(isPlainAvoid).map((x) => x.weekday!))].sort(
      (a, b) => a - b,
    ),
    note: '',
  };
}

/**
 * "Not available on any weekday" cannot be written as availability windows (an empty list
 * means "always available"), so it becomes leave on every date of the period instead.
 */
export function normalizeReply(p: Project, r: AvailabilityReply): AvailabilityReply {
  if (!r.days.every((d) => d === 'off')) return r;
  const { first, last } = periodDates(p);
  const all = Array.from({ length: last - first + 1 }, (_, i) => formatDate(first + i));
  return { ...r, days: r.days.map(() => 'any' as const), leave: all };
}

/** A copy of the project with the reply's availability, leave and avoid days applied. */
export function applyReply(p: Project, reply: AvailabilityReply): Project {
  const r = normalizeReply(p, reply);
  const out = structuredClone(p);
  const s = out.staff.find((x) => x.id === r.staff);
  if (!s) return out;
  applyToStaff(out, s, r);
  return out;
}

function applyToStaff(p: Project, s: Staff, r: AvailabilityReply): void {
  if (r.days.every((d) => d === 'any')) s.availability = [];
  else {
    const groups = new Map<string, number[]>();
    r.days.forEach((d, wd) => {
      const list: [string, string][] = d === 'any' ? [['00:00', '24:00']] : d === 'off' ? [] : d;
      for (const [from, to] of list) {
        const k = `${from}-${to}`;
        groups.set(k, [...(groups.get(k) ?? []), wd]);
      }
    });
    s.availability = [...groups]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, days]): AvailabilityWindow => {
        const [from, to] = k.split('-') as [string, string];
        return { days, from, to };
      });
  }
  const { first, last } = periodDates(p);
  const outside = s.leave.filter((d) => {
    const n = parseDate(d);
    return n === undefined || n < first || n > last;
  });
  s.leave = [...new Set([...outside, ...r.leave])].sort();
  const weights = new Map(
    s.preferences.filter(isPlainAvoid).map((x) => [x.weekday!, x.weight] as const),
  );
  s.preferences = [
    ...s.preferences.filter((x) => !isPlainAvoid(x)),
    ...r.avoid.map((wd): Preference => ({
      kind: 'avoid',
      weekday: wd,
      weight: weights.get(wd) ?? 3,
    })),
  ];
}

export interface AvailabilityDiff {
  /** 'day' rows carry the weekday; leave/avoid rows list added and removed items. */
  field: 'day' | 'leave' | 'avoid' | 'note';
  weekday?: number;
  before: string;
  after: string;
}

export function describeDay(lang: Lang, d: DayAvailability): string {
  if (d === 'any') return st(lang, 'avail.any');
  if (d === 'off') return st(lang, 'avail.off');
  return d.map(([a, b]) => `${a}–${b}`).join(', ');
}

/** What would change if the reply were applied (empty = nothing to do). */
export function diffAvailability(
  lang: Lang,
  p: Project,
  reply: AvailabilityReply,
): AvailabilityDiff[] {
  const r = normalizeReply(p, reply);
  const cur = staffToReply(p, r.staff);
  const out: AvailabilityDiff[] = [];
  for (let d = 0; d < 7; d++) {
    const a = describeDay(lang, cur.days[d]!);
    const b = describeDay(lang, r.days[d]!);
    if (a !== b) out.push({ field: 'day', weekday: d, before: a, after: b });
  }
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : st(lang, 'avail.none'));
  if (cur.leave.join() !== r.leave.join())
    out.push({ field: 'leave', before: list(cur.leave), after: list(r.leave) });
  const names = weekdayNames(lang);
  const wd = (xs: number[]) => list(xs.map((x) => names[x]!));
  if (cur.avoid.join() !== r.avoid.join())
    out.push({ field: 'avoid', before: wd(cur.avoid), after: wd(r.avoid) });
  if (r.note) out.push({ field: 'note', before: '', after: r.note });
  return out;
}

// ---------- strict parsing ----------
type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function validateReply(raw: unknown, p: Project, path: string): Result<AvailabilityReply> {
  const errors: ModelError[] = [];
  const err = (code: string, at: string, params?: Record<string, string | number>) => {
    if (errors.length < 20) errors.push(params ? { code, path: at, params } : { code, path: at });
  };
  if (!isObj(raw) || raw.schema !== REPLY_SCHEMA) {
    return { ok: false, errors: [{ code: 'reply.schema', path }] };
  }
  const keys = ['schema', 'version', 'period', 'staff', 'name', 'days', 'leave', 'avoid', 'note'];
  for (const k of Object.keys(raw)) if (!keys.includes(k)) err('field.unknown', `${path}.${k}`);
  if (raw.version !== REPLY_VERSION)
    err('schema.unsupported', `${path}.version`, { version: String(raw.version) });
  if (raw.period !== p.start)
    err('reply.period', `${path}.period`, {
      date: String(raw.period).slice(0, 20),
      start: p.start,
    });
  const staff = typeof raw.staff === 'string' ? raw.staff : '';
  if (!p.staff.some((s) => s.id === staff))
    err('field.unknownRef', `${path}.staff`, { id: staff.slice(0, 40) });
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (name.length > 80) err('field.tooLong', `${path}.name`, { max: 80 });
  const note = raw.note === undefined ? '' : raw.note;
  if (typeof note !== 'string') err('field.type', `${path}.note`, { expected: 'text' });
  else if (note.length > 200) err('field.tooLong', `${path}.note`, { max: 200 });
  else if (CONTROL.test(note)) err('field.control', `${path}.note`);
  if (CONTROL.test(name)) err('field.control', `${path}.name`);

  const days: DayAvailability[] = [];
  if (!Array.isArray(raw.days) || raw.days.length !== 7)
    err('field.length', `${path}.days`, { n: 7 });
  else
    raw.days.forEach((d: unknown, i) => {
      const at = `${path}.days[${i}]`;
      if (d === 'any' || d === 'off') return days.push(d);
      if (!Array.isArray(d) || d.length < 1 || d.length > MAX_WINDOWS_PER_DAY) {
        err('field.enum', at, { values: `any, off, 1–${MAX_WINDOWS_PER_DAY} [from, to]` });
        return days.push('off');
      }
      const list: [string, string][] = [];
      d.forEach((w: unknown, j) => {
        const wat = `${at}[${j}]`;
        if (
          !Array.isArray(w) ||
          w.length !== 2 ||
          typeof w[0] !== 'string' ||
          typeof w[1] !== 'string'
        )
          return err('field.type', wat, { expected: '[HH:MM, HH:MM]' });
        const [from, to] = w as [string, string];
        if (parseTime(from) === undefined) return err('field.time', `${wat}[0]`);
        if (parseTime(to, true) === undefined) return err('field.time', `${wat}[1]`);
        if (from === to) return err('reply.zeroLength', wat);
        list.push([from, to]);
      });
      const uniq = [...new Set(list.map((x) => `${x[0]}-${x[1]}`))].sort();
      days.push(uniq.length ? uniq.map((k) => k.split('-') as [string, string]) : 'off');
    });

  const { first, last } = periodDates(p);
  const leave: string[] = [];
  if (!Array.isArray(raw.leave) || raw.leave.length > 62)
    err('field.type', `${path}.leave`, { expected: 'a list of up to 62 dates' });
  else
    raw.leave.forEach((x: unknown, i) => {
      const n = typeof x === 'string' ? parseDate(x) : undefined;
      if (n === undefined) err('field.date', `${path}.leave[${i}]`);
      else if (n < first || n > last) err('date.outsidePeriod', `${path}.leave[${i}]`);
      else leave.push(formatDate(n));
    });
  const avoid: number[] = [];
  if (!Array.isArray(raw.avoid) || raw.avoid.length > 7)
    err('field.type', `${path}.avoid`, { expected: 'a list of weekdays 0–6' });
  else
    raw.avoid.forEach((x: unknown, i) => {
      if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x > 6)
        err('field.range', `${path}.avoid[${i}]`, { min: 0, max: 6 });
      else avoid.push(x);
    });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schema: REPLY_SCHEMA,
      version: REPLY_VERSION,
      period: p.start,
      staff,
      name,
      days,
      leave: [...new Set(leave)].sort(),
      avoid: [...new Set(avoid)].sort((a, b) => a - b),
      note: typeof note === 'string' ? note.trim() : '',
    },
  };
}

/**
 * Parse pasted text or a reply file: one reply object, a JSON array of replies, or
 * several replies one after another (as pasted from a chat). Text around the JSON is
 * ignored. Later replies from the same person replace earlier ones.
 */
export function parseAvailabilityReplies(text: string, p: Project): Result<AvailabilityReply[]> {
  if (typeof text !== 'string' || text.length > MAX_TEXT_CHARS)
    return {
      ok: false,
      errors: [{ code: 'json.tooLarge', path: '$', params: { max: MAX_TEXT_CHARS } }],
    };
  const items: { raw: unknown; path: string }[] = [];
  let firstError: Result<AvailabilityReply[]> | undefined;
  const gen = extractJson(text);
  for (let step = gen.next(false); !step.done;) {
    const parsed = safeParseJson(step.value);
    if (!parsed.ok) {
      firstError ??= parsed;
      step = gen.next(false); // e.g. "[10:01]" from a chat log
      continue;
    }
    step = gen.next(true);
    const v = parsed.value;
    const list = Array.isArray(v) ? v : [v];
    const looksLikeReply = (x: unknown) => isObj(x) && 'schema' in x;
    if (!list.some(looksLikeReply)) continue;
    if (items.length + list.length > p.staff.length * 2 + 1)
      return {
        ok: false,
        errors: [
          {
            code: 'limit.exceeded',
            path: '$',
            params: { what: 'replies', max: p.staff.length * 2 + 1 },
          },
        ],
      };
    for (const x of list) items.push({ raw: x, path: `$[${items.length}]` });
  }
  if (items.length === 0)
    return firstError ?? { ok: false, errors: [{ code: 'reply.schema', path: '$' }] };
  if (items.length === 1) items[0]!.path = '$';
  const out = new Map<string, AvailabilityReply>();
  const errors: ModelError[] = [];
  for (const it of items) {
    const r = validateReply(it.raw, p, it.path);
    if (r.ok) out.set(r.value.staff, r.value);
    else errors.push(...r.errors);
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, value: [...out.values()] };
}

/**
 * JSON values ({…} or […}) found in free text. A bracketed piece that is not valid JSON
 * (for example "[10:01]" from a chat log) is skipped one character at a time, so a reply
 * inside it is still found.
 */
function* extractJson(text: string): Generator<string, void, boolean> {
  let i = 0;
  let found = 0;
  while (i < text.length && found < 500) {
    const c = text[i];
    if (c !== '{' && c !== '[') {
      i++;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') j++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) break;
      }
    }
    found++;
    const ok = yield depth === 0 ? text.slice(i, j + 1) : text.slice(i);
    i = ok && depth === 0 ? j + 1 : i + 1;
  }
}

/** The reply as the form writes it (compact JSON). */
export function replyText(r: AvailabilityReply): string {
  return JSON.stringify(r);
}

// ---------- the offline form ----------
const FORM_KEYS = [
  'form.title',
  'form.who',
  'form.pick',
  'form.day',
  'form.any',
  'form.offDay',
  'form.between',
  'form.from',
  'form.to',
  'form.avoid',
  'form.leave',
  'form.note',
  'form.make',
  'form.copy',
  'form.download',
  'form.copied',
  'form.reply',
  'form.errorName',
  'form.errorTime',
  'form.errorDate',
  'form.privacy',
] as const;

/**
 * One self-contained HTML file. It contains the names of the people on the project and
 * each person's current settings (to pre-fill the form), nothing else. It needs no
 * network: the reply is shown as text to copy and offered as a file to download.
 */
export function availabilityFormHtml(lang: Lang, p: Project, version: string): string {
  const { first, last } = periodDates(p);
  const from = formatDate(first);
  const to = formatDate(last);
  const labels = Object.fromEntries(FORM_KEYS.map((k) => [k, st(lang, k)]));
  const data = {
    schema: REPLY_SCHEMA,
    version: REPLY_VERSION,
    period: p.start,
    first: from,
    last: to,
    weekdays: weekdayNames(lang),
    staff: p.staff.map((s) => ({ id: s.id, name: s.name, reply: staffToReply(p, s.id) })),
    labels,
  };
  const title = `${p.name} — ${st(lang, 'form.title')}`;
  return `<!doctype html>
<html lang="${lang === 'zh-HK' ? 'zh-Hant-HK' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="ShiftKnit ${escapeHtml(version)}">
<title>${escapeHtml(title)}</title>
<style>${FORM_CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(st(lang, 'form.intro', { from, to, project: p.name }))}</p>
<p class="small">${escapeHtml(st(lang, 'form.leaveHint', { example: from }))}</p>
<div id="app"></div>
<p class="small">${escapeHtml(st(lang, 'form.privacy'))} ShiftKnit ${escapeHtml(version)}</p>
</main>
<script type="application/json" id="data">${jsonForScript(data)}</script>
<script>${FORM_JS}</script>
</body>
</html>
`;
}

const FORM_CSS = `body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f7f7f4;color:#1b1b1b}
main{max-width:40rem;margin:0 auto;padding:1rem}h1{font-size:1.4rem}
table{border-collapse:collapse;width:100%}td,th{padding:.35rem;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}
label{display:inline-flex;gap:.25rem;align-items:center;margin-right:.6rem}
input,select,textarea,button{font:inherit}input[type=time]{width:7rem}
textarea{width:100%;box-sizing:border-box}button{padding:.5rem 1rem;margin:.25rem .25rem .25rem 0}
.err{color:#a00;font-weight:600}.small{font-size:.875rem;color:#444}
@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}.small{color:#bbb}td,th{border-color:#444}}`;

// Plain ES2017 so it runs in any current phone browser. DOM is built with textContent
// only; data comes from the JSON block above.
const FORM_JS = `(function(){'use strict';
var D=JSON.parse(document.getElementById('data').textContent);var L=D.labels;
function el(t,a,k){var e=document.createElement(t);if(a)for(var n in a){if(n==='text')e.textContent=a[n];else e.setAttribute(n,a[n]);}if(k)k.forEach(function(c){if(c)e.appendChild(c);});return e;}
var app=document.getElementById('app');var who=el('select',{id:'who'});who.appendChild(el('option',{value:'',text:L['form.pick']}));
D.staff.forEach(function(s){who.appendChild(el('option',{value:s.id,text:s.name}));});
app.appendChild(el('p',null,[el('label',{'for':'who',text:L['form.who']}),who]));
var tb=el('tbody');var rows=[];
D.weekdays.forEach(function(w,d){var g='d'+d;
var any=el('input',{type:'radio',name:g,value:'any',id:g+'-any'});var off=el('input',{type:'radio',name:g,value:'off',id:g+'-off'});var btw=el('input',{type:'radio',name:g,value:'between',id:g+'-between'});
var f=el('input',{type:'time',id:g+'-from','aria-label':w+' '+L['form.from']});var t=el('input',{type:'time',id:g+'-to','aria-label':w+' '+L['form.to']});
var av=el('input',{type:'checkbox',id:g+'-avoid'});
tb.appendChild(el('tr',null,[el('th',{scope:'row',text:w}),el('td',null,[el('label',null,[any,document.createTextNode(L['form.any'])]),el('label',null,[off,document.createTextNode(L['form.offDay'])]),el('label',null,[btw,document.createTextNode(L['form.between'])]),f,document.createTextNode(' – '),t]),el('td',null,[el('label',null,[av,document.createTextNode(L['form.avoid'])])])]));
rows.push({any:any,off:off,btw:btw,f:f,t:t,av:av});});
app.appendChild(el('table',null,[el('thead',null,[el('tr',null,[el('th',{text:L['form.day']}),el('th',{text:''}),el('th',{text:''})])]),tb]));
var leave=el('textarea',{id:'leave',rows:'3'});app.appendChild(el('p',null,[el('label',{'for':'leave',text:L['form.leave']})]));app.appendChild(leave);
var note=el('textarea',{id:'note',rows:'2',maxlength:'200'});app.appendChild(el('p',null,[el('label',{'for':'note',text:L['form.note']})]));app.appendChild(note);
var make=el('button',{type:'button',id:'make',text:L['form.make']});app.appendChild(make);
var msg=el('p',{id:'msg',role:'alert','class':'err'});app.appendChild(msg);
var out=el('textarea',{id:'reply',rows:'5',readonly:'','aria-label':L['form.reply']});var copy=el('button',{type:'button',id:'copy',text:L['form.copy']});var dl=el('button',{type:'button',id:'download',text:L['form.download']});
var done=el('section',{id:'done',hidden:''},[el('h2',{text:L['form.reply']}),out,copy,dl,el('p',{id:'copied',role:'status'})]);app.appendChild(done);
function fill(r){r.days.forEach(function(x,d){var o=rows[d];o.any.checked=x==='any';o.off.checked=x==='off';o.btw.checked=Array.isArray(x);o.f.value=Array.isArray(x)?x[0][0]:'';o.t.value=Array.isArray(x)?(x[0][1]==='24:00'?'23:59':x[0][1]):'';o.end24=Array.isArray(x)&&x[0][1]==='24:00';o.av.checked=r.avoid.indexOf(d)>=0;});leave.value=r.leave.join('\\n');}
who.addEventListener('change',function(){var s=D.staff.filter(function(x){return x.id===who.value;})[0];if(s)fill(s.reply);done.hidden=true;});
var TIME=/^([01]\\d|2[0-3]):[0-5]\\d$/;var DATE=/^\\d{4}-\\d{2}-\\d{2}$/;
make.addEventListener('click',function(){msg.textContent='';done.hidden=true;
if(!who.value){msg.textContent=L['form.errorName'];return;}
var days=[];var avoid=[];for(var d=0;d<7;d++){var o=rows[d];if(o.btw.checked){if(!TIME.test(o.f.value)||!TIME.test(o.t.value)||o.f.value===o.t.value){msg.textContent=L['form.errorTime'].replace('{day}',D.weekdays[d]);return;}days.push([[o.f.value,(o.end24&&o.t.value==='23:59')?'24:00':o.t.value]]);}else days.push(o.off.checked?'off':'any');if(o.av.checked)avoid.push(d);}
var ls=leave.value.split(/[\\s,，、]+/).filter(function(x){return x;});var seen={};var lv=[];
for(var i=0;i<ls.length;i++){var x=ls[i];if(!DATE.test(x)||x<D.first||x>D.last||isNaN(Date.parse(x+'T00:00:00Z'))||new Date(x+'T00:00:00Z').toISOString().slice(0,10)!==x){msg.textContent=L['form.errorDate'].replace('{date}',x);return;}if(!seen[x]){seen[x]=1;lv.push(x);}}
lv.sort();var s=D.staff.filter(function(x){return x.id===who.value;})[0];
var r={schema:D.schema,version:D.version,period:D.period,staff:s.id,name:s.name,days:days,leave:lv,avoid:avoid,note:note.value.trim().slice(0,200)};
out.value=JSON.stringify(r);done.hidden=false;out.focus();out.select();});
copy.addEventListener('click',function(){var c=document.getElementById('copied');function ok(){c.textContent=L['form.copied'];}
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(out.value).then(ok,function(){out.select();document.execCommand('copy');ok();});else{out.select();document.execCommand('copy');ok();}});
dl.addEventListener('click',function(){var b=new Blob([out.value+'\\n'],{type:'application/json'});var u=URL.createObjectURL(b);var a=el('a',{href:u,download:'availability-'+(who.value||'reply')+'.json'});document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},1000);});
})();`;
