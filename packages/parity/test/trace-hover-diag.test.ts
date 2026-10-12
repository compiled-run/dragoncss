// DIAGNOSTIC (temporary, reverted before the PR): drives every interaction group's trace capture in parallel, several rounds, and
// prints every hover-media disagreement with its timeline.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { CHROME_PAGES } from '../src/chrome-pool.ts';
import { captureTraces, traceGroups } from '../src/trace-capture.ts';

const ROUNDS = Number(process.env.DIAG_ROUNDS ?? 10);
// CPU burners, as regen's concurrent steps load the runner while trace-capture runs.
const BURNERS = availableParallelism() + 1;
const WIDTH = Number(process.env.DIAG_WIDTH ?? Math.max(CHROME_PAGES, 6));

describe('trace capture hover media (diagnostic)', () => {
  it('captures every group without a hover media disagreement', async () => {
    const groups = traceGroups();
    const burners = Array.from({ length: BURNERS }, () => new Worker('for (;;) {}', { eval: true }));
    const browser = await launchChrome();
    const errors: string[] = [];
    try {
      for (let r = 0; r < ROUNDS; r++) {
        let next = 0;
        const worker = async (): Promise<void> => {
          while (next < groups.length) {
            const g = groups[next++]!;
            try {
              await captureTraces(browser, g);
            } catch (e) {
              errors.push(`round ${r} ${g.id}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        };
        await Promise.all(Array.from({ length: WIDTH }, worker));
        console.log(`round ${r}: ${groups.length} groups, width ${WIDTH}, ${errors.length} errors so far`);
      }
    } finally {
      await browser.close();
      for (const b of burners) await b.terminate();
    }
    for (const e of errors) console.log(e);
    expect(errors).toEqual([]);
  }, 3_600_000);
});
