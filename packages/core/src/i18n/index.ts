// SPDX-License-Identifier: AGPL-3.0-or-later
// Bilingual message catalogue for errors, rule violations and explanations.
// Every key must exist in both languages (tested).

import { MESSAGES } from './messages';

export type Lang = 'en' | 'zh-HK';
export const LANGS: Lang[] = ['en', 'zh-HK'];

export function t(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const table = MESSAGES[lang] as Record<string, string>;
  const template = table[key] ?? (MESSAGES.en as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] === undefined ? `{${k}}` : String(params[k]),
  );
}

/** "Problem at <path>: <message>" for a validation error. */
export function describeError(
  lang: Lang,
  e: { code: string; path: string; params?: Record<string, string | number> },
): string {
  return t(lang, 'error.at', { path: e.path, message: t(lang, `error.${e.code}`, e.params ?? {}) });
}

export { MESSAGES };
export {
  describeGap,
  describeUnit,
  describeViolation,
  formatMinutes,
  weekdayNames,
} from './describe';
