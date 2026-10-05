// Runs the Dragon half of the sweep over worker threads: each compile hashes the three support profiles into its digest, so the
// corpus is split across every core (the main thread only waits). Rows come back in corpus order.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { DragonResult } from './dragon.ts';
import type { ShellPart } from './flatten.ts';

/** One compile: the utility the row is for, and the classes on the element (the utility, or its companion and the utility). */
export type Item = { readonly key: string; readonly classes: readonly string[] };

export type DragonRow = {
  readonly key: string;
  readonly shell: readonly ShellPart[];
  readonly sweptCss: string;
  /** The published sheet's blocking codes per target; null after a crash. */
  readonly published: DragonResult['codes'] | null;
  /** The swept sheet's result; null after a crash. */
  readonly result: DragonResult | null;
  /** Compiler exceptions, with their stacks. */
  readonly crashes: readonly string[];
};

export async function compileAll(items: readonly Item[], threads: number = availableParallelism()): Promise<DragonRow[]> {
  // Interleaved chunks, so each worker gets a like share of the costly utilities that sit together in the class list.
  if (new Set(items.map((it) => it.key)).size !== items.length) throw new Error('two items share a key');
  const n = Math.max(1, Math.min(threads, items.length));
  const chunks: Item[][] = Array.from({ length: n }, () => []);
  items.forEach((it, i) => (chunks[i % n] as Item[]).push(it));
  const url = new URL('./worker.ts', import.meta.url);
  const execArgv = process.execArgv.includes('--conditions=dragon-internal') ? process.execArgv : [...process.execArgv, '--conditions=dragon-internal'];
  const workers: Worker[] = [];
  const run = chunks.filter((c) => c.length > 0).map((chunk) => new Promise<DragonRow[]>((resolve, reject) => {
    const w = new Worker(url, { workerData: chunk, execArgv });
    workers.push(w);
    let done = false;
    w.once('message', (rows: DragonRow[]) => {
      done = true;
      resolve(rows);
    });
    w.once('error', reject);
    w.once('exit', (code) => {
      if (!done) reject(new Error(`a sweep worker exited with code ${code} before posting its rows`));
    });
  }));
  let parts: DragonRow[][];
  try {
    parts = await Promise.all(run);
  } catch (e) {
    // One worker failed: stop the others instead of letting them run to the end.
    await Promise.all(workers.map((w) => w.terminate()));
    throw e;
  }
  const byKey = new Map(parts.flat().map((r) => [r.key, r]));
  const rows = items.map((it) => byKey.get(it.key));
  if (byKey.size !== items.length || rows.some((r) => r === undefined)) throw new Error('the workers returned rows that do not match the items');
  return rows as DragonRow[];
}
