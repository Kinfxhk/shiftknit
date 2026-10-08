// SPDX-License-Identifier: AGPL-3.0-or-later

export type RuleId =
  | 'structure'
  | 'availability'
  | 'leave'
  | 'overlap'
  | 'rest'
  | 'weeklyMax'
  | 'weeklyMin'
  | 'consecutive'
  | 'restDay'
  | 'overstaffed'
  | 'lock';

/** Hard rules, in the order they are documented (README / docs/rules.md). */
export const HARD_RULES: RuleId[] = [
  'availability',
  'leave',
  'overlap',
  'rest',
  'weeklyMax',
  'weeklyMin',
  'consecutive',
  'restDay',
  'overstaffed',
  'lock',
  'structure',
];

export interface Violation {
  rule: RuleId;
  staff?: string;
  date?: string;
  shift?: string;
  /** Measured value (minutes, days, people …) and the limit it broke. */
  value?: number;
  limit?: number;
  /** A second date involved (e.g. the other shift of a rest violation). */
  otherDate?: string;
  otherShift?: string;
}

/** Unfilled staffing need. Not a rule violation: reported as a shortfall. */
export interface Gap {
  date: string;
  shift: string;
  kind: 'staff' | 'skill';
  skills?: string[];
  need: number;
  have: number;
}

export interface Penalty {
  preference: number;
  fairHours: number;
  fairWeekend: number;
  fairNight: number;
  stability: number;
  isolatedDayOff: number;
  total: number;
}

export interface CheckReport {
  /** True when no hard rule is broken (gaps are allowed and reported separately). */
  valid: boolean;
  violations: Violation[];
  gaps: Gap[];
  /** Sum over gaps of (need − have). */
  shortfall: number;
  penalty: Penalty;
}
