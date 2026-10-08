// SPDX-License-Identifier: AGPL-3.0-or-later
/** A validation problem: machine-readable code, JSON path, parameters for the message. */
export interface ModelError {
  code: string;
  path: string;
  params?: Record<string, string | number>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: ModelError[] };
