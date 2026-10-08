// SPDX-License-Identifier: AGPL-3.0-or-later
// Data model (project file schema version 1). Times are local wall-clock 'HH:MM' in the
// project's IANA time zone; dates are 'YYYY-MM-DD'. Weekdays: Monday = 0 … Sunday = 6.

export const PROJECT_SCHEMA = 'shiftknit/project';
export const PROJECT_VERSION = 1;

/** A group of staff counted together, e.g. "at least 1 first-aider". Staff count only
 * when they have ALL listed skills. */
export interface SkillRequirement {
  skills: string[];
  min: number;
}

export interface Shift {
  id: string;
  name: string;
  /** Local start 'HH:MM'. */
  start: string;
  /** Local end 'HH:MM'; if not after `start` the shift ends the next day (overnight). */
  end: string;
  /** Unpaid break inside the shift, in minutes. */
  breakMinutes: number;
  /** Staff needed on each weekday, Monday first (7 numbers). */
  demand: number[];
  /** Skill needs, applied on days where demand > 0. */
  skillDemand: SkillRequirement[];
  /** Counts as a night shift for fairness. Default: true when the shift crosses midnight. */
  night: boolean;
}

/** A weekly window in which a person can work: the whole shift must fit inside. */
export interface AvailabilityWindow {
  /** Weekdays the window starts on (Monday = 0). */
  days: number[];
  from: string;
  /** 'HH:MM' or '24:00'; if not after `from`, the window ends the next day. */
  to: string;
}

export interface Preference {
  kind: 'want' | 'avoid';
  /** Shift id; omitted = any shift (i.e. "want/avoid working"). */
  shift?: string;
  /** A single date, or … */
  date?: string;
  /** … a weekday (Monday = 0). Omit both for every day. */
  weekday?: number;
  /** 1–5. */
  weight: number;
}

export interface Staff {
  id: string;
  name: string;
  skills: string[];
  /** Weekly worked-minutes limits (actual minutes, break excluded). */
  maxWeeklyMinutes: number;
  minWeeklyMinutes: number;
  maxConsecutiveDays: number;
  /** Omitted or empty = always available. */
  availability: AvailabilityWindow[];
  /** Leave dates: no shift may overlap these local calendar days. */
  leave: string[];
  preferences: Preference[];
}

export interface RestDayRule {
  enabled: boolean;
  /** Rest days needed in each 7-day period. */
  count: number;
  /** Length of one rest day: a continuous period without work, in minutes. */
  minMinutes: number;
  /** 'rolling' = every run of 7 consecutive days; 'fixed' = consecutive 7-day blocks
   * from the first day of the period. */
  mode: 'rolling' | 'fixed';
}

export interface Rules {
  /** Minimum rest between the end of one shift and the start of the next. */
  minRestMinutes: number;
  restDay: RestDayRule;
  /** First day of the week for weekly hours (Monday = 0). */
  weekStart: number;
}

export interface Weights {
  preference: number;
  fairHours: number;
  fairWeekend: number;
  fairNight: number;
  stability: number;
  isolatedDayOff: number;
}

/** A fixed cell: `shift: null` means "must be off". */
export interface CellValue {
  staff: string;
  date: string;
  shift: string | null;
}

export interface Assignment {
  staff: string;
  date: string;
  shift: string;
}

export interface Project {
  schema: typeof PROJECT_SCHEMA;
  version: typeof PROJECT_VERSION;
  name: string;
  timeZone: string;
  /** First day of the period. */
  start: string;
  /** Number of days in the period (1–31). */
  days: number;
  skills: string[];
  shifts: Shift[];
  staff: Staff[];
  rules: Rules;
  weights: Weights;
  locks: CellValue[];
  /** Previous rota for the same dates, used only for the stability preference. */
  previous: CellValue[];
}

export interface Roster {
  assignments: Assignment[];
}
