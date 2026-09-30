// A sweep worker: builds, flattens and compiles its share of the items, and posts one row per item (pool.ts).
import { parentPort, workerData } from 'node:worker_threads';
import type { DragonResult } from './dragon.ts';
import { compileUtility, SweepHarnessError } from './dragon.ts';
import { flatten } from './flatten.ts';
import type { DragonRow, Item } from './pool.ts';
import { publishedCss } from './tailwind.ts';

/** A compiler exception is a crash, recorded with its stack; a fault of the sweep's own config or fixture stops the run. */
function guarded(name: string, sheet: string, run: () => DragonResult): DragonResult | string {
  try {
    return run();
  } catch (e) {
    if (e instanceof SweepHarnessError) throw e;
    return `${name} (${sheet} sheet): ${String(e instanceof Error ? (e.stack ?? e.message) : e)}`;
  }
}

async function rowOf(item: Item): Promise<DragonRow> {
  const published = await publishedCss(item.classes);
  const swept = flatten(published);
  const name = item.classes.join(' ');
  const asPublished = guarded(name, 'published', () => compileUtility(item.classes, published, published));
  const r = guarded(name, 'swept', () => compileUtility(item.classes, swept.css, published));
  const crashes = [asPublished, r].filter((x): x is string => typeof x === 'string');
  return { key: item.key, shell: swept.shell, sweptCss: swept.css, published: typeof asPublished === 'string' ? null : asPublished.codes, result: typeof r === 'string' ? null : r, crashes };
}

const port = parentPort;
if (port === null) throw new Error('worker.ts runs only as a worker thread');
const rows: DragonRow[] = [];
for (const item of workerData as Item[]) rows.push(await rowOf(item));
port.postMessage(rows);
