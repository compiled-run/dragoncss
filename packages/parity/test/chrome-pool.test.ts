// inOrder: bounded concurrency, results in item order, failures after every started item settles.
import { describe, expect, it } from 'vitest';
import { inOrder } from '../src/chrome-pool.ts';

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('inOrder', () => {
  it('runs at most width at once and returns results in item order, whatever order they finish in', async () => {
    let running = 0;
    let peak = 0;
    const items = [30, 5, 20, 1, 10, 2, 15, 3];
    const out = await inOrder(items, 3, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await tick(ms);
      running--;
      return `${i}:${ms}`;
    });
    expect(out).toEqual(items.map((ms, i) => `${i}:${ms}`));
    expect(peak).toBe(3);
    expect(await inOrder([], 4, async () => 1)).toEqual([]);
  });

  it('throws the first failure in item order only after every started item ends, and starts nothing after a failure', async () => {
    const ended: number[] = [];
    const started: number[] = [];
    const run = inOrder([0, 1, 2, 3, 4, 5], 2, async (_x, i) => {
      started.push(i);
      await tick(i === 0 ? 30 : 5);
      ended.push(i);
      if (i === 1 || i === 0) throw new Error(`item ${i}`);
      return i;
    });
    await expect(run).rejects.toThrow('item 0');
    expect(ended.sort()).toEqual([...started].sort());
    expect(started).not.toContain(5);
    await expect(inOrder([1], 0, async () => 1)).rejects.toThrow(/whole width/);
  });
});
