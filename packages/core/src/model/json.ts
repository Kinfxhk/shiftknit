// SPDX-License-Identifier: AGPL-3.0-or-later
// Defensive JSON parsing for untrusted project files: size and nesting depth are checked
// on the raw text BEFORE JSON.parse runs, and dangerous keys are rejected afterwards.

import { LIMITS } from './limits';
import type { ModelError, Result } from './errors';

export const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Maximum bracket nesting depth of JSON text (strings are skipped). */
export function jsonDepth(text: string, stopAt = Infinity): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c)
        i++; // backslash: skip the escaped char
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth++;
      if (depth > max) {
        max = depth;
        if (max > stopAt) return max;
      }
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  return max;
}

/**
 * Walk an object graph (from JSON.parse or built in code) and report forbidden keys,
 * cycles, excessive depth, non-plain objects and non-finite numbers.
 */
export function inspectGraph(root: unknown, maxDepth: number = LIMITS.jsonDepth): ModelError[] {
  const errors: ModelError[] = [];
  const stack = new Set<object>();
  const visit = (v: unknown, path: string, depth: number): void => {
    if (errors.length > 20) return;
    if (typeof v === 'number' && !Number.isFinite(v)) {
      errors.push({ code: 'field.notFinite', path });
      return;
    }
    if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') {
      errors.push({ code: 'field.type', path, params: { expected: 'JSON' } });
      return;
    }
    if (v === null || typeof v !== 'object') return;
    if (depth > maxDepth) {
      errors.push({ code: 'json.tooDeep', path, params: { max: maxDepth } });
      return;
    }
    if (stack.has(v)) {
      errors.push({ code: 'json.cycle', path });
      return;
    }
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) {
      errors.push({ code: 'field.type', path, params: { expected: 'object' } });
      return;
    }
    stack.add(v);
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
    else
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_KEYS.has(k)) {
          errors.push({ code: 'json.forbiddenKey', path: `${path}.${k}`, params: { key: k } });
          continue;
        }
        visit((v as Record<string, unknown>)[k], `${path}.${k}`, depth + 1);
      }
    stack.delete(v);
  };
  visit(root, '$', 0);
  return errors;
}

/** Parse untrusted JSON text with size, depth and key checks. */
export function safeParseJson(text: string): Result<unknown> {
  if (typeof text !== 'string')
    return { ok: false, errors: [{ code: 'field.type', path: '$', params: { expected: 'text' } }] };
  if (text.length > LIMITS.jsonChars)
    return {
      ok: false,
      errors: [{ code: 'json.tooLarge', path: '$', params: { max: LIMITS.jsonChars } }],
    };
  if (jsonDepth(text, LIMITS.jsonDepth) > LIMITS.jsonDepth)
    return {
      ok: false,
      errors: [{ code: 'json.tooDeep', path: '$', params: { max: LIMITS.jsonDepth } }],
    };
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, errors: [{ code: 'json.syntax', path: '$' }] };
  }
  const errors = inspectGraph(value);
  return errors.length ? { ok: false, errors } : { ok: true, value };
}
