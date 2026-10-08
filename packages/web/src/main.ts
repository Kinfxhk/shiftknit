// SPDX-License-Identifier: AGPL-3.0-or-later
// ShiftKnit web UI: set up a project, make a rota in a Web Worker, edit it by hand with
// live checking, then export or print. Everything stays in this browser.

import type {
  CheckReport,
  Explanation,
  Lang,
  Project,
  Roster,
  Shift,
  Staff,
  VerifiedResult,
} from '@shiftknit/core';
import {
  checkRoster,
  describeError,
  describeGap,
  describeUnit,
  describeViolation,
  exportProject,
  formatDate,
  gapsCsv,
  gridCsv,
  importProject,
  listCsv,
  parseDate,
  staffCalendar,
  validateProject,
  validateRoster,
  weekday,
  weekdayNames,
} from '@shiftknit/core';
import sampleText from '../../../examples/small-shop.json?raw';
import { byId, download, fileName, h } from './dom';
import { printRestDays, printStaffPages, printTeam } from './print';
import { loadSettings, loadState, saveSettings, saveState, wipeAll, type Settings } from './store';
import { ui, type UiKey } from './strings';
import type { WorkerRequest, WorkerResponse } from './worker';
import './styles.css';

const VERSION = __SHIFTKNIT_VERSION__;

// ---------- state ----------
const settings: Settings = loadSettings();
let lang: Lang =
  settings.lang === 'en' || settings.lang === 'zh-HK'
    ? settings.lang
    : navigator.language.toLowerCase().startsWith('zh')
      ? 'zh-HK'
      : 'en';
let project: Project = sample();
let raw: Project = structuredClone(project);
let setupErrors: string[] = [];
let roster: Roster | null = null;
let verified: VerifiedResult | null = null;
let edited = false;
let explanation: Explanation | null | 'working' | undefined;
let solving = false;
let stopped = false;
let view: 'grid' | 'week' = settings.view === 'week' ? 'week' : 'grid';
let timeLimit = [5, 15, 60].includes(settings.timeLimit ?? 0) ? settings.timeLimit! : 15;
let note = '';

const T = (key: UiKey, params: Record<string, string | number> = {}) => ui(lang, key, params);

function sample(): Project {
  const r = importProject(sampleText);
  if (!r.ok) throw new Error('sample project is invalid');
  return r.value;
}

function nextMonday(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() + (7 - wd));
  return d.toISOString().slice(0, 10);
}

function newProject(): Project {
  const r = validateProject({
    schema: 'shiftknit/project',
    version: 1,
    name: T('new.project'),
    timeZone: 'Asia/Hong_Kong',
    start: nextMonday(),
    days: 7,
    skills: [],
    shifts: [
      {
        id: 'day',
        name: T('new.shift'),
        start: '09:00',
        end: '17:00',
        breakMinutes: 60,
        demand: 1,
      },
    ],
    staff: [1, 2, 3].map((n) => ({ id: `p${n}`, name: T('new.person', { n }) })),
  });
  if (!r.ok) throw new Error('template invalid');
  return r.value;
}

// ---------- worker ----------
let worker: Worker | null = null;
let reqId = 0;
let pendingSnapshot = '';

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => onWorker(e.data));
  }
  return worker;
}

function send(req: WorkerRequest): void {
  getWorker().postMessage(req);
}

function onWorker(m: WorkerResponse): void {
  if (m.id !== reqId) return; // stale
  if (m.kind === 'error') {
    solving = false;
    note = m.message;
    if (explanation === 'working') explanation = null;
    renderRota();
    return;
  }
  if (m.kind === 'explained') {
    explanation = m.explanation;
    renderRota();
    return;
  }
  solving = false;
  verified = m.verified;
  edited = false;
  roster = m.verified.result.roster;
  if (roster && JSON.stringify(project) !== pendingSnapshot) {
    // The project changed while solving: keep the rota but re-check it as an edit.
    roster = prune(roster);
    edited = true;
  }
  explanation = undefined;
  const r = m.verified.result;
  if (
    !edited &&
    ((r.status === 'none' && r.proven) || (r.status === 'shortfall' && r.coverageImpossible))
  ) {
    explanation = 'working';
    send({ id: ++reqId, kind: 'explain', project, result: r });
  }
  persist();
  renderRota();
  renderExport();
}

function startSolve(): void {
  if (setupErrors.length) return;
  solving = true;
  stopped = false;
  note = '';
  explanation = undefined;
  pendingSnapshot = JSON.stringify(project);
  send({ id: ++reqId, kind: 'solve', project, seed: 1, timeLimitMs: timeLimit * 1000 });
  renderRota();
}

function stopSolve(): void {
  worker?.terminate();
  worker = null;
  reqId++;
  solving = false;
  stopped = true;
  if (explanation === 'working') explanation = null;
  renderRota();
}

// ---------- project editing ----------
function uniqueId(prefix: string, taken: string[]): string {
  for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`;
}

function inPeriod(p: Project, date: string): boolean {
  const d = parseDate(date);
  const s = parseDate(p.start);
  return d !== undefined && s !== undefined && d >= s && d < s + p.days;
}

/** Drop references that no longer exist after an edit. */
function tidy(p: Project): void {
  const staff = new Set(p.staff.map((s) => s.id));
  const shifts = new Set(p.shifts.map((s) => s.id));
  const keep = (c: { staff: string; date: string; shift: string | null }) =>
    staff.has(c.staff) && (c.shift === null || shifts.has(c.shift)) && inPeriod(p, c.date);
  p.locks = p.locks.filter(keep);
  p.previous = p.previous.filter(keep);
  const skills = new Set(p.skills);
  for (const s of p.staff) {
    s.skills = s.skills.filter((k) => skills.has(k));
    s.preferences = s.preferences.filter((x) => x.shift === undefined || shifts.has(x.shift));
  }
  for (const sh of p.shifts) {
    sh.skillDemand = sh.skillDemand
      .map((r) => ({ ...r, skills: r.skills.filter((k) => skills.has(k)) }))
      .filter((r) => r.skills.length > 0);
  }
}

function prune(r: Roster): Roster {
  const staff = new Set(project.staff.map((s) => s.id));
  const shifts = new Set(project.shifts.map((s) => s.id));
  return {
    assignments: r.assignments.filter(
      (a) => staff.has(a.staff) && shifts.has(a.shift) && inPeriod(project, a.date),
    ),
  };
}

/** Validate the edited copy; on success it becomes the project. */
function commit(rerenderSetup = false): void {
  tidy(raw);
  const r = validateProject(raw);
  if (r.ok) {
    setupErrors = [];
    project = r.value;
    raw = structuredClone(project);
    if (roster) {
      const pruned = prune(roster);
      if (pruned.assignments.length !== roster.assignments.length) edited = true;
      roster = pruned;
    }
    persist();
  } else {
    setupErrors = r.errors.slice(0, 12).map((e) => describeError(lang, e));
  }
  if (rerenderSetup) renderSetup();
  else renderSetupErrors();
  renderRota();
  renderExport();
}

function loadProject(p: Project, r: Roster | null = null): void {
  project = p;
  raw = structuredClone(p);
  setupErrors = [];
  roster = r;
  verified = null;
  edited = r !== null;
  explanation = undefined;
  persist();
  renderAll();
}

// ---------- persistence ----------
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveState({
      project,
      roster,
      verified: verified && { ...verified, report: null },
      edited,
    });
  }, 200);
}

function storeSettings(): void {
  saveSettings({ lang, theme: settings.theme, large: settings.large, view, timeLimit });
}

// ---------- rendering helpers ----------
function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = input.id;
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('small', {}, hint) : null,
  );
}

function num(
  id: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
  label?: string,
): HTMLInputElement {
  return h('input', {
    id,
    type: 'number',
    inputmode: 'decimal',
    value,
    min,
    max,
    step,
    'aria-label': label,
    onchange: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      onChange(Number.isFinite(v) ? v : 0);
    },
  });
}

function text(
  id: string,
  value: string,
  onChange: (v: string) => void,
  attrs: Record<string, string> = {},
): HTMLInputElement {
  return h('input', {
    id,
    type: 'text',
    value,
    ...attrs,
    onchange: (e: Event) => onChange((e.target as HTMLInputElement).value),
  });
}

function dayLabel(d: number): { wd: string; date: string } {
  const first = parseDate(project.start) ?? 0;
  const iso = formatDate(first + d);
  return { wd: weekdayNames(lang)[weekday(first + d)]!, date: iso };
}

const hours = (m: number) => Math.round((m / 60) * 100) / 100;

// ---------- setup ----------
function renderSetup(): void {
  const host = byId('setup-body');
  host.replaceChildren(projectForm(), shiftsTable(), staffTable());
  renderSetupErrors();
}

function renderSetupErrors(): void {
  const box = byId('setup-errors');
  box.hidden = setupErrors.length === 0;
  box.replaceChildren(
    h('p', {}, T('setup.errors')),
    h(
      'ul',
      {},
      setupErrors.map((e) => h('li', {}, e)),
    ),
  );
}

function projectForm(): HTMLElement {
  const restDay = raw.rules.restDay;
  return h(
    'fieldset',
    { class: 'project' },
    h('legend', {}, T('setup.project')),
    h(
      'div',
      { class: 'fields' },
      field(
        T('setup.name'),
        text('p-name', raw.name, (v) => ((raw.name = v), commit()), { maxlength: '80' }),
      ),
      field(
        T('setup.tz'),
        text('p-tz', raw.timeZone, (v) => ((raw.timeZone = v.trim()), commit()), {
          list: 'tz-list',
          spellcheck: 'false',
        }),
      ),
      field(
        T('setup.start'),
        h('input', {
          id: 'p-start',
          type: 'date',
          value: raw.start,
          onchange: (e: Event) => ((raw.start = (e.target as HTMLInputElement).value), commit()),
        }),
      ),
      field(
        T('setup.days'),
        num('p-days', raw.days, 1, 31, 1, (v) => ((raw.days = Math.round(v)), commit())),
      ),
      field(
        T('setup.rest'),
        num(
          'p-rest',
          hours(raw.rules.minRestMinutes),
          0,
          48,
          0.5,
          (v) => ((raw.rules.minRestMinutes = Math.round(v * 60)), commit()),
        ),
      ),
      field(
        T('setup.skills'),
        text('p-skills', raw.skills.join(', '), (v) => {
          raw.skills = [
            ...new Set(
              v
                .split(/[,，、]/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ];
          commit(true);
        }),
      ),
    ),
    h(
      'div',
      { class: 'restday' },
      h(
        'label',
        { class: 'check' },
        h('input', {
          id: 'p-restday',
          type: 'checkbox',
          checked: restDay.enabled,
          onchange: (e: Event) => {
            raw.rules.restDay = {
              ...raw.rules.restDay,
              enabled: (e.target as HTMLInputElement).checked,
              count: 1,
              minMinutes: 1440,
            };
            commit(true);
          },
        }),
        T('setup.restDay'),
      ),
      field(
        T('setup.restMode'),
        h(
          'select',
          {
            id: 'p-restmode',
            disabled: !restDay.enabled,
            onchange: (e: Event) => {
              raw.rules.restDay = {
                ...raw.rules.restDay,
                mode: (e.target as HTMLSelectElement).value === 'fixed' ? 'fixed' : 'rolling',
              };
              commit();
            },
          },
          (['rolling', 'fixed'] as const).map((m) =>
            h('option', { value: m, selected: restDay.mode === m }, T(`setup.restMode.${m}`)),
          ),
        ),
      ),
      h('p', { class: 'note' }, T('setup.restDayNote')),
    ),
  );
}

function shiftsTable(): HTMLElement {
  const wds = weekdayNames(lang);
  const rows = raw.shifts.map((sh: Shift, i) => {
    const req = sh.skillDemand[0];
    const overnight = sh.end <= sh.start;
    return h(
      'tr',
      {},
      h(
        'td',
        {},
        text(`sh-name-${i}`, sh.name, (v) => ((sh.name = v), commit()), {
          'aria-label': `${T('shifts.name')} ${i + 1}`,
          maxlength: '40',
        }),
      ),
      h(
        'td',
        {},
        h('input', {
          id: `sh-start-${i}`,
          type: 'time',
          value: sh.start,
          'aria-label': `${T('shifts.start')} (${sh.name})`,
          onchange: (e: Event) => ((sh.start = (e.target as HTMLInputElement).value), commit(true)),
        }),
      ),
      h(
        'td',
        {},
        h('input', {
          id: `sh-end-${i}`,
          type: 'time',
          value: sh.end,
          'aria-label': `${T('shifts.end')} (${sh.name})`,
          onchange: (e: Event) => ((sh.end = (e.target as HTMLInputElement).value), commit(true)),
        }),
        overnight ? h('small', { class: 'overnight' }, T('shifts.overnight')) : null,
      ),
      h(
        'td',
        {},
        num(
          `sh-break-${i}`,
          sh.breakMinutes,
          0,
          240,
          5,
          (v) => ((sh.breakMinutes = Math.round(v)), commit()),
          `${T('shifts.break')} (${sh.name})`,
        ),
      ),
      h(
        'td',
        { class: 'demand' },
        sh.demand.map((n, d) =>
          num(
            `sh-demand-${i}-${d}`,
            n,
            0,
            30,
            1,
            (v) => ((sh.demand[d] = Math.round(v)), commit()),
            `${T('shifts.demand')}, ${wds[d]} (${sh.name})`,
          ),
        ),
      ),
      h(
        'td',
        { class: 'skillneed' },
        h(
          'select',
          {
            id: `sh-skill-${i}`,
            'aria-label': `${T('shifts.skill')} (${sh.name})`,
            disabled: raw.skills.length === 0,
            onchange: (e: Event) => {
              const k = (e.target as HTMLSelectElement).value;
              const rest = sh.skillDemand.slice(1);
              sh.skillDemand = k ? [{ skills: [k], min: req?.min ?? 1 }, ...rest] : rest;
              commit(true);
            },
          },
          h('option', { value: '' }, T('shifts.skillNone')),
          raw.skills.map((k) =>
            h('option', { value: k, selected: req?.skills.length === 1 && req.skills[0] === k }, k),
          ),
        ),
        req
          ? h(
              'span',
              { class: 'min' },
              T('shifts.skillMin'),
              ' ',
              num(
                `sh-skillmin-${i}`,
                req.min,
                1,
                30,
                1,
                (v) => ((req.min = Math.max(1, Math.round(v))), commit()),
                `${T('shifts.skillMin')} (${sh.name})`,
              ),
            )
          : null,
      ),
      h(
        'td',
        {},
        h(
          'button',
          {
            type: 'button',
            class: 'icon',
            'aria-label': T('shifts.remove', { name: sh.name }),
            disabled: raw.shifts.length <= 1,
            onclick: () => {
              raw.shifts.splice(i, 1);
              commit(true);
            },
          },
          '×',
        ),
      ),
    );
  });
  return h(
    'fieldset',
    {},
    h('legend', {}, T('shifts.title')),
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        { class: 'edit', id: 'shifts-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            [
              T('shifts.name'),
              T('shifts.start'),
              T('shifts.end'),
              T('shifts.break'),
              `${T('shifts.demand')} (${wds.join(' ')})`,
              T('shifts.skill'),
              '',
            ].map((c) => h('th', { scope: 'col' }, c)),
          ),
        ),
        h('tbody', {}, rows),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        id: 'add-shift',
        disabled: raw.shifts.length >= 6,
        onclick: () => {
          const id = uniqueId(
            'shift',
            raw.shifts.map((s) => s.id),
          );
          raw.shifts.push({
            id,
            name: `${T('new.shift')} ${raw.shifts.length + 1}`,
            start: '09:00',
            end: '17:00',
            breakMinutes: 60,
            demand: [1, 1, 1, 1, 1, 1, 1],
            skillDemand: [],
            night: false,
          });
          commit(true);
        },
      },
      T('shifts.add'),
    ),
  );
}

function staffTable(): HTMLElement {
  const wds = weekdayNames(lang);
  const rows = raw.staff.map((s: Staff, i) => {
    const avoids = (d: number) =>
      s.preferences.some(
        (p) =>
          p.kind === 'avoid' && p.weekday === d && p.shift === undefined && p.date === undefined,
      );
    return h(
      'tr',
      {},
      h(
        'td',
        {},
        text(`st-name-${i}`, s.name, (v) => ((s.name = v), commit()), {
          'aria-label': `${T('staff.name')} ${i + 1}`,
          maxlength: '40',
        }),
      ),
      h(
        'td',
        { class: 'chips' },
        raw.skills.length === 0
          ? '—'
          : raw.skills.map((k, j) =>
              h(
                'label',
                { class: 'chip' },
                h('input', {
                  type: 'checkbox',
                  id: `st-skill-${i}-${j}`,
                  checked: s.skills.includes(k),
                  onchange: (e: Event) => {
                    s.skills = (e.target as HTMLInputElement).checked
                      ? [...s.skills, k]
                      : s.skills.filter((x) => x !== k);
                    commit();
                  },
                }),
                k,
              ),
            ),
      ),
      h(
        'td',
        {},
        num(
          `st-max-${i}`,
          hours(s.maxWeeklyMinutes),
          0,
          168,
          0.5,
          (v) => ((s.maxWeeklyMinutes = Math.round(v * 60)), commit()),
          `${T('staff.maxH')} (${s.name})`,
        ),
      ),
      h(
        'td',
        {},
        num(
          `st-min-${i}`,
          hours(s.minWeeklyMinutes),
          0,
          168,
          0.5,
          (v) => ((s.minWeeklyMinutes = Math.round(v * 60)), commit()),
          `${T('staff.minH')} (${s.name})`,
        ),
      ),
      h(
        'td',
        {},
        num(
          `st-cons-${i}`,
          s.maxConsecutiveDays,
          1,
          31,
          1,
          (v) => ((s.maxConsecutiveDays = Math.round(v)), commit()),
          `${T('staff.maxC')} (${s.name})`,
        ),
      ),
      h(
        'td',
        {},
        text(
          `st-leave-${i}`,
          s.leave.join(', '),
          (v) => {
            s.leave = [
              ...new Set(
                v
                  .split(/[,，\s]+/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              ),
            ];
            commit();
          },
          {
            'aria-label': `${T('staff.leave')} (${s.name})`,
            placeholder: 'YYYY-MM-DD',
            class: 'wide',
          },
        ),
      ),
      h(
        'td',
        { class: 'chips days' },
        wds.map((w, d) =>
          h(
            'label',
            { class: 'chip' },
            h('input', {
              type: 'checkbox',
              id: `st-avoid-${i}-${d}`,
              checked: avoids(d),
              onchange: (e: Event) => {
                s.preferences = s.preferences.filter(
                  (p) =>
                    !(
                      p.kind === 'avoid' &&
                      p.weekday === d &&
                      p.shift === undefined &&
                      p.date === undefined
                    ),
                );
                if ((e.target as HTMLInputElement).checked)
                  s.preferences.push({ kind: 'avoid', weekday: d, weight: 3 });
                commit();
              },
            }),
            w,
          ),
        ),
      ),
      h(
        'td',
        {},
        h(
          'button',
          {
            type: 'button',
            class: 'icon',
            'aria-label': T('staff.remove', { name: s.name }),
            disabled: raw.staff.length <= 1,
            onclick: () => {
              raw.staff.splice(i, 1);
              commit(true);
            },
          },
          '×',
        ),
      ),
    );
  });
  return h(
    'fieldset',
    {},
    h('legend', {}, T('staff.title')),
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        { class: 'edit', id: 'staff-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            [
              T('staff.name'),
              T('staff.skills'),
              T('staff.maxH'),
              T('staff.minH'),
              T('staff.maxC'),
              T('staff.leave'),
              T('staff.avoid'),
              '',
            ].map((c) => h('th', { scope: 'col' }, c)),
          ),
        ),
        h('tbody', {}, rows),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        id: 'add-staff',
        disabled: raw.staff.length >= 30,
        onclick: () => {
          const id = uniqueId(
            'p',
            raw.staff.map((s) => s.id),
          );
          raw.staff.push({
            id,
            name: T('new.person', { n: raw.staff.length + 1 }),
            skills: [],
            maxWeeklyMinutes: 48 * 60,
            minWeeklyMinutes: 0,
            maxConsecutiveDays: 6,
            availability: [],
            leave: [],
            preferences: [],
          });
          commit(true);
        },
      },
      T('staff.add'),
    ),
    h('p', { class: 'note' }, T('staff.more')),
  );
}

// ---------- rota ----------
function currentReport(): CheckReport | null {
  return roster ? checkRoster(project, roster) : null;
}

function statusInfo(report: CheckReport | null): { kind: string; lines: string[] } {
  if (solving) return { kind: 'solving', lines: [T('rota.solving')] };
  const lines: string[] = [];
  if (note) lines.push(note);
  if (stopped && !roster) return { kind: 'empty', lines: [T('rota.stopped'), T('rota.none')] };
  if (verified?.rejected) return { kind: 'rejected', lines: [T('status.rejected')] };
  if (!roster) {
    const r = verified?.result;
    if (r?.status === 'none')
      return { kind: 'none', lines: [T(r.proven ? 'status.provenNone' : 'status.none')] };
    return { kind: 'empty', lines: [...lines, T('rota.none')] };
  }
  if (edited || !verified) {
    lines.push(T('status.edited'));
    if (report) lines.push(T('status.penalty', { n: report.penalty.total }));
    return { kind: 'edited', lines };
  }
  const r = verified.result;
  let kind: string;
  if (r.status === 'complete') {
    kind = r.proven ? 'proven' : 'feasible';
    lines.push(T(r.proven ? 'status.provenComplete' : 'status.complete'));
  } else {
    kind = 'shortfall';
    const n = r.objective?.shortfall ?? 0;
    lines.push(T(r.proven ? 'status.provenShortfall' : 'status.shortfall', { n }));
    if (r.coverageImpossible && !r.proven) lines.push(T('status.coverageImpossible'));
  }
  if (stopped) lines.unshift(T('rota.stopped'));
  lines.push(T('status.penalty', { n: r.objective?.penalty ?? 0 }));
  return { kind, lines };
}

function renderRota(): void {
  const report = currentReport();
  const st = statusInfo(report);
  const status = byId('status');
  status.dataset.status = st.kind;
  status.replaceChildren(...st.lines.map((l) => h('p', {}, l)));
  byId<HTMLButtonElement>('solve-btn').disabled = solving || setupErrors.length > 0;
  byId<HTMLButtonElement>('stop-btn').hidden = !solving;
  byId('rota').setAttribute('aria-busy', String(solving));
  renderExplain();
  byId('view-grid').setAttribute('aria-pressed', String(view === 'grid'));
  byId('view-week').setAttribute('aria-pressed', String(view === 'week'));
  const active = document.activeElement?.id;
  byId('rota-view').replaceChildren(view === 'grid' ? gridView(report) : weekView(report));
  if (active) document.getElementById(active)?.focus();
  renderCheck(report);
}

function renderExplain(): void {
  const box = byId('explain-box');
  box.hidden = explanation === undefined;
  if (explanation === undefined) return;
  const parts: HTMLElement[] = [h('h3', {}, T('explain.title'))];
  if (explanation === 'working') parts.push(h('p', {}, T('explain.working')));
  else if (explanation === null) parts.push(h('p', {}, T('explain.notFound')));
  else {
    const e = explanation;
    parts.push(
      h('p', {}, T('explain.intro', { date: e.start, days: e.days })),
      h(
        'ul',
        { id: 'explain-list' },
        e.units.map((u) => h('li', {}, describeUnit(lang, u, project, e.goal))),
      ),
      h('p', { class: 'note' }, T(e.minimal ? 'explain.minimal' : 'explain.notMinimal')),
    );
  }
  box.replaceChildren(...parts);
}

function cellMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of roster?.assignments ?? []) m.set(`${a.staff}|${a.date}`, a.shift);
  return m;
}

function setCell(staff: string, date: string, shift: string): void {
  const rest = (roster?.assignments ?? []).filter((a) => !(a.staff === staff && a.date === date));
  roster = { assignments: shift ? [...rest, { staff, date, shift }] : rest };
  const lock = raw.locks.find((l) => l.staff === staff && l.date === date);
  edited = true;
  explanation = undefined;
  if (lock) {
    lock.shift = shift || null;
    commit();
    return;
  }
  persist();
  renderRota();
  renderExport();
}

function toggleLock(staff: string, date: string): void {
  const i = raw.locks.findIndex((l) => l.staff === staff && l.date === date);
  if (i >= 0) raw.locks.splice(i, 1);
  else raw.locks.push({ staff, date, shift: cellMap().get(`${staff}|${date}`) ?? null });
  commit();
}

function gridView(report: CheckReport | null): HTMLElement {
  const cells = cellMap();
  const locked = new Map(project.locks.map((l) => [`${l.staff}|${l.date}`, l.shift]));
  const bad = new Map<string, string[]>();
  const mark = (k: string, text: string) => bad.set(k, [...(bad.get(k) ?? []), text]);
  for (const v of report?.violations ?? []) {
    if (!v.date) continue;
    const text = describeViolation(lang, v, project);
    if (v.staff) mark(`${v.staff}|${v.date}`, text);
    else if (v.shift)
      // A slot-level problem (e.g. too many people): mark everyone on that shift.
      for (const a of roster?.assignments ?? [])
        if (a.date === v.date && a.shift === v.shift) mark(`${a.staff}|${a.date}`, text);
  }
  const shiftIndex = new Map(project.shifts.map((s, i) => [s.id, i]));
  const days = Array.from({ length: project.days }, (_, d) => dayLabel(d));
  const gapByDay = new Map<string, number>();
  for (const g of report?.gaps ?? [])
    gapByDay.set(g.date, (gapByDay.get(g.date) ?? 0) + g.need - g.have);
  return h(
    'div',
    { class: 'scroll grid-wrap' },
    h(
      'table',
      { class: 'grid', id: 'grid-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, T('staff.title')),
          days.map((d) =>
            h(
              'th',
              { scope: 'col', class: d.wd && weekendClass(d.date) },
              h('span', { class: 'wd' }, d.wd),
              h('span', { class: 'dt' }, d.date.slice(5)),
            ),
          ),
        ),
      ),
      h(
        'tbody',
        {},
        project.staff.map((s, si) =>
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, s.name),
            days.map((d, di) => {
              const k = `${s.id}|${d.date}`;
              const cur = cells.get(k) ?? '';
              const isLocked = locked.has(k);
              const problems = bad.get(k);
              return h(
                'td',
                {
                  class: [
                    'cell',
                    cur ? `s${shiftIndex.get(cur) ?? 0}` : 'off',
                    problems ? 'bad' : '',
                    isLocked ? 'locked' : '',
                  ]
                    .join(' ')
                    .trim(),
                  title: problems?.join('\n'),
                },
                h(
                  'select',
                  {
                    id: `cell-${si}-${di}`,
                    'aria-label': T('rota.cellLabel', { name: s.name, date: `${d.wd} ${d.date}` }),
                    'aria-invalid': problems ? 'true' : undefined,
                    onchange: (e: Event) =>
                      setCell(s.id, d.date, (e.target as HTMLSelectElement).value),
                  },
                  h('option', { value: '', selected: cur === '' }, T('rota.off')),
                  project.shifts.map((sh) =>
                    h('option', { value: sh.id, selected: cur === sh.id }, sh.name),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    id: `lock-${si}-${di}`,
                    class: 'lock',
                    'aria-pressed': String(isLocked),
                    'aria-label': T('rota.lockLabel', { name: s.name, date: d.date }),
                    title: T(isLocked ? 'rota.locked' : 'rota.lock'),
                    onclick: () => toggleLock(s.id, d.date),
                  },
                  isLocked ? '■' : '□',
                ),
              );
            }),
          ),
        ),
      ),
      h(
        'tfoot',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, T('check.gaps')),
          days.map((d) => {
            const n = gapByDay.get(d.date) ?? 0;
            return h('td', { class: n ? 'gap' : '' }, n ? T('rota.short', { n }) : '');
          }),
        ),
      ),
    ),
  );
}

function weekendClass(date: string): string {
  const w = weekday(parseDate(date) ?? 0);
  return w >= 5 ? 'weekend' : '';
}

function weekView(report: CheckReport | null): HTMLElement {
  const names = new Map(project.staff.map((s) => [s.id, s.name]));
  const by = new Map<string, string[]>();
  for (const a of roster?.assignments ?? []) {
    const k = `${a.date}|${a.shift}`;
    by.set(k, [...(by.get(k) ?? []), names.get(a.staff) ?? a.staff]);
  }
  const shortBy = new Map<string, number>();
  for (const g of report?.gaps ?? []) {
    const k = `${g.date}|${g.shift}`;
    shortBy.set(k, Math.max(shortBy.get(k) ?? 0, g.need - g.have));
  }
  const weeks: HTMLElement[] = [];
  for (let w = 0; w < project.days; w += 7) {
    const days = Array.from({ length: Math.min(7, project.days - w) }, (_, i) => dayLabel(w + i));
    weeks.push(
      h(
        'div',
        { class: 'scroll' },
        h(
          'table',
          { class: 'week' },
          h('caption', {}, T('rota.week', { date: days[0]!.date })),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, T('shifts.title')),
              days.map((d) =>
                h(
                  'th',
                  { scope: 'col', class: weekendClass(d.date) },
                  `${d.wd} ${d.date.slice(5)}`,
                ),
              ),
            ),
          ),
          h(
            'tbody',
            {},
            project.shifts.map((sh, i) =>
              h(
                'tr',
                {},
                h(
                  'th',
                  { scope: 'row' },
                  h('span', { class: `swatch s${i}` }),
                  sh.name,
                  h('small', {}, ` ${sh.start}–${sh.end}`),
                ),
                days.map((d) => {
                  const people = (by.get(`${d.date}|${sh.id}`) ?? []).sort();
                  const short = shortBy.get(`${d.date}|${sh.id}`) ?? 0;
                  return h(
                    'td',
                    { class: short ? 'gap' : '' },
                    h(
                      'ul',
                      {},
                      people.map((n) => h('li', {}, n)),
                    ),
                    short ? h('span', { class: 'short' }, T('rota.short', { n: short })) : null,
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }
  return h('div', { class: 'weeks' }, weeks);
}

function renderCheck(report: CheckReport | null): void {
  const box = byId('check-body');
  if (!report) {
    box.replaceChildren(h('p', { class: 'note' }, T('check.note')));
    return;
  }
  const parts: HTMLElement[] = [];
  if (report.violations.length === 0)
    parts.push(h('p', { class: 'ok', id: 'check-ok' }, T('check.ok')));
  else
    parts.push(
      h('p', { class: 'bad' }, T('check.violations', { n: report.violations.length })),
      h(
        'ul',
        { id: 'violations' },
        report.violations
          .slice(0, 50)
          .map((v) => h('li', { 'data-rule': v.rule }, describeViolation(lang, v, project))),
      ),
    );
  if (report.gaps.length === 0) parts.push(h('p', {}, T('check.noGaps')));
  else
    parts.push(
      h('p', {}, T('check.gaps')),
      h(
        'ul',
        { id: 'gaps' },
        report.gaps.slice(0, 50).map((g) => h('li', {}, describeGap(lang, g, project))),
      ),
    );
  const pen = report.penalty;
  const items = (
    ['preference', 'fairHours', 'fairWeekend', 'fairNight', 'stability', 'isolatedDayOff'] as const
  ).filter((k) => pen[k] > 0);
  if (items.length)
    parts.push(
      h(
        'dl',
        { class: 'penalty' },
        items.flatMap((k) => [h('dt', {}, T(`penalty.${k}`)), h('dd', {}, String(pen[k]))]),
      ),
    );
  parts.push(h('p', { class: 'note' }, T('check.note')));
  box.replaceChildren(...parts);
}

// ---------- export ----------
function renderExport(): void {
  const sel = byId<HTMLSelectElement>('ics-staff');
  const prev = sel.value;
  sel.replaceChildren(
    ...project.staff.map((s) => h('option', { value: s.id, selected: s.id === prev }, s.name)),
  );
  for (const id of [
    'csv-grid',
    'csv-list',
    'csv-gaps',
    'json-rota',
    'ics-btn',
    'print-team',
    'print-staff',
    'print-rest',
  ])
    byId<HTMLButtonElement>(id).disabled = !roster;
  byId('export-msg').textContent = roster ? '' : T('export.needRota');
}

function withRoster(fn: (r: Roster) => void): void {
  if (roster) fn(roster);
}

// ---------- shell ----------
function applySettings(): void {
  const root = document.documentElement;
  root.lang = lang === 'zh-HK' ? 'zh-Hant-HK' : 'en';
  const dark =
    settings.theme === 'dark' ||
    (settings.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.size = settings.large ? 'large' : 'normal';
}

function renderStatic(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]'))
    el.textContent = T(el.dataset.t as UiKey);
  byId<HTMLSelectElement>('lang').value = lang;
  const theme = byId<HTMLSelectElement>('theme');
  theme.replaceChildren(
    ...(['system', 'light', 'dark'] as const).map((k) =>
      h(
        'option',
        { value: k, selected: (settings.theme ?? 'system') === k },
        T(`settings.theme.${k}`),
      ),
    ),
  );
  byId<HTMLInputElement>('large').checked = Boolean(settings.large);
  byId<HTMLSelectElement>('time-limit').value = String(timeLimit);
  document.title = `ShiftKnit · 排更易 — ${T('app.tagline')}`;
}

function renderAll(): void {
  applySettings();
  renderStatic();
  renderSetup();
  renderRota();
  renderExport();
}

function wire(): void {
  byId('lang').addEventListener('change', (e) => {
    lang = (e.target as HTMLSelectElement).value === 'zh-HK' ? 'zh-HK' : 'en';
    storeSettings();
    if (setupErrors.length) commit();
    renderAll();
  });
  byId('theme').addEventListener('change', (e) => {
    settings.theme = (e.target as HTMLSelectElement).value;
    storeSettings();
    applySettings();
  });
  byId('large').addEventListener('change', (e) => {
    settings.large = (e.target as HTMLInputElement).checked;
    storeSettings();
    applySettings();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
  byId('new-btn').addEventListener('click', () => loadProject(newProject()));
  byId('sample-btn').addEventListener('click', () => loadProject(sample()));
  byId('import-file').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const msg = byId('import-msg');
    if (file.size > 1_000_000) {
      msg.textContent = `${T('setup.importFailed')} > 1 MB`;
      return;
    }
    const r = importProject(await file.text());
    if (r.ok) {
      loadProject(r.value);
      byId('import-msg').textContent = T('setup.imported');
    } else
      msg.textContent = `${T('setup.importFailed')} ${r.errors
        .slice(0, 3)
        .map((x) => describeError(lang, x))
        .join('; ')}`;
  });
  byId('delete-btn').addEventListener('click', async () => {
    if (!confirm(T('setup.deleteConfirm'))) return;
    stopSolve();
    clearTimeout(saveTimer);
    await wipeAll();
    location.reload();
  });
  byId('solve-btn').addEventListener('click', startSolve);
  byId('stop-btn').addEventListener('click', stopSolve);
  byId('clear-btn').addEventListener('click', () => {
    roster = null;
    verified = null;
    edited = false;
    explanation = undefined;
    stopped = false;
    persist();
    renderRota();
    renderExport();
  });
  byId('unlock-btn').addEventListener('click', () => {
    raw.locks = [];
    commit();
  });
  byId('time-limit').addEventListener('change', (e) => {
    timeLimit = Number((e.target as HTMLSelectElement).value) || 15;
    storeSettings();
  });
  byId('view-grid').addEventListener(
    'click',
    () => ((view = 'grid'), storeSettings(), renderRota()),
  );
  byId('view-week').addEventListener(
    'click',
    () => ((view = 'week'), storeSettings(), renderRota()),
  );
  const base = () => project.name;
  byId('csv-grid').addEventListener('click', () =>
    withRoster((r) =>
      download(fileName(base(), 'csv'), gridCsv(project, r, lang), 'text/csv;charset=utf-8'),
    ),
  );
  byId('csv-list').addEventListener('click', () =>
    withRoster((r) =>
      download(
        fileName(`${base()}-list`, 'csv'),
        listCsv(project, r, lang),
        'text/csv;charset=utf-8',
      ),
    ),
  );
  byId('csv-gaps').addEventListener('click', () =>
    withRoster((r) =>
      download(
        fileName(`${base()}-gaps`, 'csv'),
        gapsCsv(project, checkRoster(project, r).gaps, lang),
        'text/csv;charset=utf-8',
      ),
    ),
  );
  byId('json-project').addEventListener('click', () =>
    download(fileName(base(), 'json'), exportProject(project), 'application/json'),
  );
  byId('json-rota').addEventListener('click', () =>
    withRoster((r) =>
      download(
        fileName(`${base()}-rota`, 'json'),
        JSON.stringify({ schema: 'shiftknit/roster', version: 1, ...r }, null, 2) + '\n',
        'application/json',
      ),
    ),
  );
  byId('ics-btn').addEventListener('click', () =>
    withRoster((r) => {
      const id = byId<HTMLSelectElement>('ics-staff').value;
      const person = project.staff.find((s) => s.id === id);
      if (!person) return;
      download(
        fileName(`${base()}-${person.name}`, 'ics'),
        staffCalendar(project, r, id, { stamp: Math.floor(Date.now() / 60_000) }),
        'text/calendar;charset=utf-8',
      );
    }),
  );
  const print = (fill: () => void) => {
    fill();
    window.print();
  };
  const ctx = () => ({ project, roster: roster!, lang, version: VERSION });
  byId('print-team').addEventListener('click', () =>
    withRoster(() => print(() => printTeam(byId('print-area'), ctx()))),
  );
  byId('print-staff').addEventListener('click', () =>
    withRoster(() => print(() => printStaffPages(byId('print-area'), ctx()))),
  );
  byId('print-rest').addEventListener('click', () =>
    withRoster(() => print(() => printRestDays(byId('print-area'), ctx()))),
  );
}

async function init(): Promise<void> {
  const saved = (await loadState()) as
    | { project?: unknown; roster?: unknown; verified?: VerifiedResult | null; edited?: boolean }
    | undefined;
  if (saved && typeof saved === 'object' && saved.project) {
    const p = validateProject(saved.project);
    if (p.ok) {
      project = p.value;
      raw = structuredClone(project);
      if (saved.roster) {
        const r = validateRoster(saved.roster, project);
        if (r.ok) roster = r.value;
      }
      const v = saved.verified;
      if (
        roster &&
        v &&
        typeof v === 'object' &&
        v.result &&
        typeof v.result.status === 'string' &&
        !saved.edited
      )
        verified = v;
      edited = roster !== null && verified === null;
    }
  }
  wire();
  renderAll();
  document.body.dataset.ready = 'true';
  if ('serviceWorker' in navigator && import.meta.env.PROD)
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

void init();
