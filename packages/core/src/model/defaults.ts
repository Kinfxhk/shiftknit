// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Rules, Weights } from './types';

export const DEFAULT_RULES: Rules = {
  minRestMinutes: 11 * 60,
  restDay: { enabled: true, count: 1, minMinutes: 24 * 60, mode: 'rolling' },
  weekStart: 0,
};

/** Hong Kong preset: one rest day of at least 24 continuous hours in every 7 days
 * (Labour Department, Concise Guide to the Employment Ordinance, chapter 4). The
 * stricter "any 7 consecutive days" reading is the default. Not legal advice. */
export const HK_REST_DAY_PRESET = {
  enabled: true,
  count: 1,
  minMinutes: 24 * 60,
  mode: 'rolling',
} as const;

export const DEFAULT_WEIGHTS: Weights = {
  preference: 10,
  fairHours: 1,
  fairWeekend: 5,
  fairNight: 5,
  stability: 3,
  isolatedDayOff: 4,
};

export const DEFAULT_STAFF_LIMITS = {
  maxWeeklyMinutes: 7 * 24 * 60,
  minWeeklyMinutes: 0,
  maxConsecutiveDays: 6,
};
