// SPDX-License-Identifier: AGPL-3.0-or-later
// A project at the size limits: 30 people × 31 days × 6 shifts.
import type { Project } from '../../src/index';
import { validateProject } from '../../src/index';

export function bigProject(): Project {
  const shifts = [
    {
      id: 'early',
      name: 'Early',
      start: '07:00',
      end: '15:00',
      breakMinutes: 30,
      demand: [4, 4, 4, 4, 4, 5, 5],
    },
    {
      id: 'mid',
      name: 'Middle',
      start: '10:00',
      end: '18:00',
      breakMinutes: 30,
      demand: [2, 2, 2, 2, 3, 3, 3],
    },
    {
      id: 'late',
      name: 'Late',
      start: '15:00',
      end: '23:00',
      breakMinutes: 30,
      demand: [4, 4, 4, 4, 4, 5, 5],
    },
    {
      id: 'night',
      name: 'Night',
      start: '23:00',
      end: '07:00',
      breakMinutes: 30,
      demand: 2,
      skillDemand: [{ skills: ['firstaid'], min: 1 }],
    },
    {
      id: 'am',
      name: 'Morning part-time',
      start: '08:00',
      end: '12:00',
      demand: [1, 1, 1, 1, 1, 2, 2],
    },
    {
      id: 'pm',
      name: 'Evening part-time',
      start: '17:00',
      end: '21:00',
      demand: [1, 1, 1, 1, 1, 2, 2],
    },
  ];
  const staff = Array.from({ length: 30 }, (_, i) => ({
    id: `s${i + 1}`,
    name: `Staff ${i + 1}`,
    skills: i % 3 === 0 ? ['firstaid'] : [],
    maxWeeklyMinutes: i < 24 ? 48 * 60 : 24 * 60,
    maxConsecutiveDays: 5,
    leave: i % 7 === 0 ? [`2026-12-${String(10 + (i % 5)).padStart(2, '0')}`] : [],
    preferences: i % 4 === 0 ? [{ kind: 'avoid' as const, shift: 'night', weight: 2 }] : [],
    availability: i >= 24 ? [{ days: [0, 1, 2, 3, 4, 5, 6], from: '08:00', to: '21:00' }] : [],
  }));
  const v = validateProject({
    schema: 'shiftknit/project',
    version: 1,
    name: 'Large',
    start: '2026-12-01',
    days: 31,
    skills: ['firstaid'],
    shifts,
    staff,
  });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.value;
}
