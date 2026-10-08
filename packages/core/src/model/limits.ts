// SPDX-License-Identifier: AGPL-3.0-or-later
/** Hard size limits. Inputs beyond these are rejected with a clear error. */
export const LIMITS = {
  staff: 30,
  days: 31,
  shifts: 6,
  skills: 8,
  idLength: 40,
  nameLength: 80,
  stringLength: 200,
  jsonChars: 1_000_000,
  jsonDepth: 32,
  windowsPerStaff: 21,
  leavePerStaff: 366,
  preferencesPerStaff: 200,
  skillDemandPerShift: 8,
  locks: 30 * 31,
  previous: 30 * 31,
  assignments: 30 * 31 * 6,
  maxDemand: 30,
} as const;
