// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@shiftknit/core';
import { UI, ui } from '../src/strings';

describe('interface text', () => {
  it('both languages have the same keys and no empty strings', () => {
    expect(Object.keys(UI['zh-HK']).sort()).toEqual(Object.keys(UI.en).sort());
    for (const lang of ['en', 'zh-HK'] as const)
      for (const [k, v] of Object.entries(UI[lang])) expect(v.trim(), `${lang} ${k}`).not.toBe('');
  });

  it('placeholders match between languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(UI.en) as (keyof typeof UI.en)[])
      expect(ph(UI['zh-HK'][k]), k).toEqual(ph(UI.en[k]));
  });

  it('core rule messages also match between languages', () => {
    expect(Object.keys(MESSAGES['zh-HK']).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it('fills placeholders and keeps unknown ones visible', () => {
    expect(ui('en', 'rota.short', { n: 2 })).toBe('short 2');
    expect(ui('zh-HK', 'rota.short', { n: 2 })).toBe('欠 2 人');
    expect(ui('en', 'rota.short')).toBe('short {n}');
  });

  it('carries the legal disclaimer in both languages', () => {
    expect(UI.en['footer.disclaimer']).toMatch(/not legal advice/);
    expect(UI['zh-HK']['footer.disclaimer']).toMatch(/並非法律意見/);
    expect(UI.en['check.note']).toMatch(/does not mean it complies with any law/);
  });
});
