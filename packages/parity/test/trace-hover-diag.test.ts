// DIAGNOSTIC (temporary, reverted before the PR): drives every interaction group's trace capture in several browsers at once, for
// several rounds, under CPU load, and prints every hover-media disagreement with its timeline.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { captureTraces, traceGroups } from '../src/trace-capture.ts';

const ROUNDS = Number(process.env.DIAG_ROUNDS ?? 5);
const BROWSERS = Number(process.env.DIAG_BROWSERS ?? 3);
const WIDTH = 6;
const BURNERS = availableParallelism();

describe('trace capture hover media (diagnostic)', () => {
  it('captures every group without a hover media disagreement', async () => {
    const groups = traceGroups();
    const errors: string[] = [];
    const burners = Array.from({ length: BURNERS }, () => new Worker('for (;;) {}', { eval: true }));
    const loop = async (b: number): Promise<void> => {
      const browser = await launchChrome();
      try {
        for (let r = 0; r < ROUNDS; r++) {
          let next = 0;
          const worker = async (): Promise<void> => {
            while (next < groups.length) {
              const g = groups[next++]!;
              try {
                await captureTraces(browser, g);
              } catch (e) {
                errors.push(`browser ${b} round ${r} ${g.id}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          };
          await Promise.all(Array.from({ length: WIDTH }, worker));
          console.log(`browser ${b} round ${r}: ${errors.length} errors so far (${new Date().toISOString()})`);
        }
      } finally {
        await browser.close();
      }
    };
    try {
      await Promise.all(Array.from({ length: BROWSERS }, (_, b) => loop(b)));
    } finally {
      for (const w of burners) await w.terminate();
    }
    for (const e of errors) console.log(e);
    expect(errors).toEqual([]);
  }, 3_600_000);
});
