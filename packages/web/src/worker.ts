// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the solver and the explainer off the main thread so the page stays responsive.
import type { Explanation, Project, SolveResult, VerifiedResult } from '@shiftknit/core';
import { explain, solveAndCheck } from '@shiftknit/core';

export type WorkerRequest =
  | { id: number; kind: 'solve'; project: Project; seed: number; timeLimitMs: number }
  | { id: number; kind: 'explain'; project: Project; result: SolveResult };

export type WorkerResponse =
  | { id: number; kind: 'solved'; verified: VerifiedResult; ms: number }
  | { id: number; kind: 'explained'; explanation: Explanation | null }
  | { id: number; kind: 'error'; message: string };

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'solve') {
      const t0 = performance.now();
      const deadline = t0 + req.timeLimitMs;
      const verified = solveAndCheck(req.project, {
        seed: req.seed,
        timeUp: () => performance.now() > deadline,
      });
      post({ id: req.id, kind: 'solved', verified, ms: Math.round(performance.now() - t0) });
    } else {
      post({ id: req.id, kind: 'explained', explanation: explain(req.project, req.result) });
    }
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
