// Chrome captures over several contexts of one browser at once. Each case already gets its own context, so cases do not share
// state; the software raster path and layout are deterministic, so the outputs are those of a serial run.
import { availableParallelism } from 'node:os';

/** Contexts a capture keeps open at once: one per core, at most 8 (measured: 8 gives 70 -> 14 ms per screenshot). */
export const CHROME_PAGES = Math.max(1, Math.min(8, availableParallelism()));

/**
 * f over items, at most width at a time; results in item order. Every started item runs to its end before a failure is thrown
 * (so no page is left mid-capture when the browser closes), no new item starts after one fails, and the first failure in item
 * order is the one thrown.
 */
export async function inOrder<T, R>(items: readonly T[], width: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(width) || width < 1) throw new Error(`inOrder needs a whole width of at least 1, not ${width}`);
  const settled: (PromiseSettledResult<R> | undefined)[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < items.length && !failed) {
      const i = next++;
      try {
        settled[i] = { status: 'fulfilled', value: await f(items[i] as T, i) };
      } catch (e) {
        settled[i] = { status: 'rejected', reason: e };
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  const out: R[] = [];
  for (const s of settled) {
    if (s === undefined) continue;
    if (s.status === 'rejected') throw s.reason;
    out.push(s.value);
  }
  if (out.length !== items.length) throw new Error(`inOrder: ${out.length} of ${items.length} items ran`);
  return out;
}
