// The layout plan's per-ratio recordings (markless-plan.ts recordDensity) in worker threads: each lays a page out at thousands of
// root widths and depends on nothing but its job, so the ratios of both targets run at once. The caller blocks until all are done.
import { availableParallelism } from 'node:os';
import { MessageChannel, type MessagePort, receiveMessageOnPort, Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { NativeStyleTarget, StateProgram } from 'dragon';
import type { PlanDensity } from './markless-plan.ts';

/** One target's recording at one ratio: what recordDensity reads, with the system fonts of systemFontsFor(t, dpr). */
export type DensityJob = {
  readonly t: NativeStyleTarget;
  readonly sp: StateProgram;
  readonly bundled: readonly string[];
  readonly authorFiles: readonly (readonly [string, Uint8Array])[];
  readonly dpr: number;
  readonly height: number;
};
/** A recording, or the message recordDensity threw. */
export type DensityResult = { readonly density: PlanDensity } | { readonly error: string };

/** The threads a page's recordings use: DRAGON_PLAN_WORKERS, or one per core; 1 records in this thread. */
export function planWorkers(): number {
  const given = Number.parseInt(process.env['DRAGON_PLAN_WORKERS'] ?? '', 10);
  return Number.isFinite(given) && given > 0 ? given : availableParallelism();
}

/** Every job's result, in job order, with at most `workers` threads at once. */
export function recordDensitiesInWorkers(jobs: readonly DensityJob[], workers: number): DensityResult[] {
  const results: DensityResult[] = new Array(jobs.length);
  const done = new Int32Array(new SharedArrayBuffer(4));
  const pool: { readonly worker: Worker; readonly port: MessagePort; job: number }[] = [];
  let next = 0;
  let finished = 0;
  const give = (slot: (typeof pool)[number]): void => {
    slot.job = next++;
    slot.worker.postMessage(jobs[slot.job]);
  };
  try {
    for (let i = 0; i < Math.min(workers, jobs.length); i++) {
      const { port1, port2 } = new MessageChannel();
      const worker = new Worker(new URL(import.meta.url), { workerData: { port: port2, done }, transferList: [port2] });
      worker.unref();
      const slot = { worker, port: port1, job: -1 };
      pool.push(slot);
      give(slot);
    }
    while (finished < jobs.length) {
      const seen = Atomics.load(done, 0);
      let got = false;
      for (const slot of pool) {
        const message = receiveMessageOnPort(slot.port);
        if (message === undefined) continue;
        got = true;
        results[slot.job] = message.message as DensityResult;
        finished++;
        if (next < jobs.length) give(slot);
      }
      if (!got && Atomics.wait(done, 0, seen, 600_000) === 'timed-out') throw new Error('a layout plan worker did not answer in 600 s');
    }
    return results;
  } finally {
    for (const slot of pool) void slot.worker.terminate();
  }
}

if (!isMainThread && parentPort !== null && (workerData as { port?: MessagePort } | null)?.port !== undefined) {
  const { port, done } = workerData as { readonly port: MessagePort; readonly done: Int32Array };
  const { recordDensity } = await import('./markless-plan.ts');
  const { systemFontsFor } = await import('./system-fonts/provider.ts');
  const { registerFace } = await import('./text-shaper-host.ts');
  parentPort.on('message', (job: DensityJob) => {
    let result: DensityResult;
    try {
      for (const [, bytes] of job.authorFiles) registerFace(bytes);
      result = { density: recordDensity(job.t, job.sp, systemFontsFor(job.t, job.dpr), job.bundled, new Map(job.authorFiles), job.dpr, job.height) };
    } catch (e) {
      result = { error: (e as Error).message };
    }
    port.postMessage(result);
    Atomics.add(done, 0, 1);
    Atomics.notify(done, 0);
  });
}
