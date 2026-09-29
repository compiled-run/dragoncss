// Devices of one target at once (LANE-SPEED): each device runs in its own process (cli/device-one.ts, the same runOneDevice a
// sequential run calls), so boots, launches and checks overlap; the parent merges the outcomes in matrix order. The number at once is
// capped by the devices of the target, the memory free now (a simulator or emulator needs DEVICE_MEMORY of it) and --device-jobs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { DeviceOutcome, RunLog } from './device-lanes.ts';
import type { DeviceSpec } from './device-run.ts';
import { DEVICE_MATRIX } from './device-run.ts';
import type { HostRun } from './lanes.ts';
import { nativeOut } from './native-host.ts';
import { repoPath } from './paths.ts';
import type { NativeTarget } from './targets.ts';

const GIB = 1024 ** 3;
/** Memory one booted device holds with its app (resident size measured with a full run: see notes/LANE-SPEED.md), rounded up. */
export const DEVICE_MEMORY: { readonly [T in NativeTarget]: number } = { ios: 3 * GIB, android: 4 * GIB };
/** Memory left to the rest of the machine (the host lanes, the checks, other agents) when devices are started. */
export const MEMORY_RESERVE = 8 * GIB;
/** Devices that always run alone, after the others (a device found flaky under load; none so far). */
export const SOLO_DEVICES: readonly string[] = [];

/** Memory free for new processes: free, inactive and speculative pages on macOS (vm_stat), else os.freemem(). */
export function availableMemory(): number {
  if (process.platform !== 'darwin') return freemem();
  const r = spawnSync('vm_stat', { encoding: 'utf8' });
  const parsed = r.status === 0 ? parseVmStat(r.stdout) : null;
  return parsed ?? freemem();
}

/** Free, inactive and speculative bytes from vm_stat output; null when a count or the page size is missing. */
export function parseVmStat(text: string): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const count = (name: string): number => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.`, 'm').exec(text)?.[1]);
  const pages = count('free') + count('inactive') + count('speculative');
  return Number.isFinite(page) && page > 0 && Number.isFinite(pages) ? pages * page : null;
}

/** How many devices of a target run at once: the requested number (default all), capped by the matrix and by memory; at least 1. */
export function deviceJobs(target: NativeTarget, requested: number | null, log: RunLog, available: number = availableMemory()): number {
  const devices = DEVICE_MATRIX.filter((d) => d.target === target).length;
  const byMemory = Math.max(1, Math.floor((available - MEMORY_RESERVE) / DEVICE_MEMORY[target]));
  const jobs = Math.max(1, Math.min(requested ?? devices, devices, byMemory));
  log(`${jobs} device(s) at once (${devices} in the matrix${requested === null ? '' : `, --device-jobs ${requested}`}; ${(available / GIB).toFixed(1)} GiB free allows ${byMemory})`);
  return jobs;
}

/** What a device process is handed. */
export type DeviceJob = { readonly target: NativeTarget; readonly device: string; readonly artifact: string; readonly host: HostRun | null; readonly vectors: boolean };

/** A device job read from its file, checked: a malformed one stops the process before any device work. */
export function parseDeviceJob(text: string): DeviceJob {
  const v = JSON.parse(text) as unknown;
  const o = (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (o['target'] !== 'ios' && o['target'] !== 'android') problems.push('target is not ios or android');
  if (!DEVICE_MATRIX.some((d) => d.target === o['target'] && d.name === o['device'])) problems.push(`device ${JSON.stringify(o['device'])} is not a matrix device of the target`);
  if (typeof o['artifact'] !== 'string' || !existsSync(o['artifact'])) problems.push('artifact is not an existing path');
  if (o['host'] !== null && (typeof o['host'] !== 'object' || typeof (o['host'] as Record<string, unknown>)['state'] !== 'string')) problems.push('host is neither null nor a host run');
  if (typeof o['vectors'] !== 'boolean') problems.push('vectors is not a boolean');
  if (problems.length > 0) throw new Error(`malformed device job: ${problems.join('; ')}`);
  return o as unknown as DeviceJob;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * A device process's outcome, checked field by field against the device it ran: a set with its DPR, device record, counts, dumps
 * digest, failures and fault rows; the trust rows; the vectors run; the blocked reason. Anything else stops the run (fail closed).
 */
export function parseOutcome(text: string, device: string): DeviceOutcome {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`${device}: the device process wrote no outcome JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const problems: string[] = [];
  if (!isObj(v)) throw new Error(`${device}: the device outcome is not an object`);
  if (v['device'] !== device) problems.push(`device ${JSON.stringify(v['device'])}`);
  const set = v['set'];
  if (set !== null) {
    if (!isObj(set)) problems.push('set is not an object');
    else {
      for (const k of ['dpr', 'cases', 'dumps']) if (typeof set[k] !== 'number') problems.push(`set.${k} is not a number`);
      if (typeof set['dumpsSha256'] !== 'string') problems.push('set.dumpsSha256 is not a string');
      if (!isObj(set['device']) || set['device']['name'] !== device) problems.push('set.device is not this device');
      const compared = set['compared'];
      if (!isObj(compared) || JSON.stringify(Object.keys(compared)) !== JSON.stringify(['a', 'b', 'c', 'd', 'breaks']) || !Object.values(compared).every((n) => typeof n === 'number')) problems.push('set.compared is not the five check counts');
      if (!Array.isArray(set['failures']) || !set['failures'].every((f) => isObj(f) && typeof f['lane'] === 'string' && typeof f['kind'] === 'string')) problems.push('set.failures is not a failure list');
      if (!Array.isArray(set['faults']) || !set['faults'].every((f) => isObj(f) && typeof f['applicable'] === 'number' && typeof f['caught'] === 'number' && Array.isArray(f['uncaught']))) problems.push('set.faults is not a fault row list');
    }
  }
  const trust = v['trust'];
  const trustRow = (r: unknown): boolean => isObj(r) && typeof r['case'] === 'string' && typeof r['points'] === 'number' && Array.isArray(r['mismatches']) && r['mismatches'].every((m) => typeof m === 'string');
  if (trust !== null && (!isObj(trust) || trust['device'] !== device || typeof trust['dpr'] !== 'number' || !Array.isArray(trust['rows']) || !trust['rows'].every(trustRow))) problems.push('trust is not this device\'s trust rows');
  if (set !== null && trust === null && v['blocked'] === null) problems.push('a set without its capture-trust rows');
  const vectors = v['vectors'];
  if (vectors !== null && (!isObj(vectors) || vectors['device'] !== device || typeof vectors['state'] !== 'string' || !Array.isArray(vectors['suites']))) problems.push('vectors is not this device\'s vectors run');
  if (v['blocked'] !== null && typeof v['blocked'] !== 'string') problems.push('blocked is neither null nor a string');
  if (v['blocked'] === null && set === null) problems.push('neither a set nor a blocked reason');
  if (problems.length > 0) throw new Error(`${device}: malformed device outcome: ${problems.join('; ')}`);
  return v as unknown as DeviceOutcome;
}

const jobDir = (target: NativeTarget): string => join(nativeOut(target), 'lanes', 'jobs');
const slug = (device: string): string => device.replace(/[^A-Za-z0-9-]+/g, '_');

/** Runs one device job in its own process, its log lines forwarded; the outcome, or an error naming the device and the exit. */
export function runDeviceChild(job: DeviceJob, log: RunLog): Promise<DeviceOutcome> {
  const dir = jobDir(job.target);
  mkdirSync(dir, { recursive: true });
  const jobFile = join(dir, `${slug(job.device)}.job.json`);
  const outFile = join(dir, `${slug(job.device)}.outcome.json`);
  rmSync(outFile, { force: true });
  writeFileSync(jobFile, JSON.stringify(job));
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--conditions=dragon-internal', repoPath('packages/parity/src/cli/device-one.ts'), jobFile, outFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const tail: string[] = [];
    createInterface({ input: p.stdout }).on('line', (l) => log(l));
    createInterface({ input: p.stderr }).on('line', (l) => {
      tail.push(l);
      if (tail.length > 40) tail.shift();
    });
    const clean = (): void => {
      rmSync(jobFile, { force: true });
      rmSync(outFile, { force: true });
    };
    p.once('error', (e) => {
      clean();
      reject(e);
    });
    p.once('close', (code, signal) => {
      try {
        if (code !== 0) throw new Error(`${job.device}: the device process failed (${signal ?? `exit ${code}`}): ${tail.join('\n')}`);
        resolve(parseOutcome(readFileSync(outFile, 'utf8'), job.device));
      } catch (e) {
        reject(e);
      } finally {
        clean();
      }
    });
  });
}

/**
 * Runs f over items, at most jobs at a time, with the items in SOLO_DEVICES alone after the rest; results in item order. Every item
 * runs to its end before a failure is thrown (so every device is released), and the first failure in item order is the one thrown.
 */
export async function pool<T, R>(items: readonly T[], jobs: number, f: (x: T) => Promise<R>, solo: (x: T) => boolean = () => false): Promise<R[]> {
  const settled: PromiseSettledResult<R>[] = new Array(items.length);
  const run = async (idx: readonly number[], width: number): Promise<void> => {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < idx.length) {
        const i = idx[next++] as number;
        try {
          settled[i] = { status: 'fulfilled', value: await f(items[i] as T) };
        } catch (e) {
          settled[i] = { status: 'rejected', reason: e };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(width, idx.length) }, worker));
  };
  const all = items.map((_, i) => i);
  await run(all.filter((i) => !solo(items[i] as T)), jobs);
  await run(all.filter((i) => solo(items[i] as T)), 1);
  const out: R[] = [];
  for (const s of settled) {
    if (s.status === 'rejected') throw s.reason;
    out.push(s.value);
  }
  return out;
}

/** The devices of a target, jobs at a time, each in its own process; the outcomes in matrix order. */
export function runDevicesInChildren(target: NativeTarget, specs: readonly DeviceSpec[], jobs: number, jobOf: (spec: DeviceSpec) => DeviceJob, log: RunLog): Promise<DeviceOutcome[]> {
  if (specs.some((s) => s.target !== target)) throw new Error(`a device of another target in the ${target} run`);
  return pool(specs, jobs, (spec) => runDeviceChild(jobOf(spec), log), (spec) => SOLO_DEVICES.includes(spec.name));
}

/** The shared device lease (one per platform): a command runs under it when the script exists, else directly. */
export const LEASE_SCRIPT = '/tmp/device-lease.sh';

/** The command line that runs cmd under the target's lease: DRAGON_LEASE=<target> <script> cmd ...args, or cmd itself without one. */
export function leased(target: NativeTarget, cmd: string, args: readonly string[], script: string | null): { readonly cmd: string; readonly args: readonly string[]; readonly env: NodeJS.ProcessEnv } {
  if (script === null) return { cmd, args, env: process.env };
  return { cmd: script, args: [cmd, ...args], env: { ...process.env, DRAGON_LEASE: target } };
}

/** parity:devices fails when any step it ran failed (a crash, a reference proof or a lane of its own target) or the merged file fails. */
export function devicesExit(steps: readonly { readonly code: number | null }[], merged: 0 | 1): 0 | 1 {
  return merged === 0 && steps.every((s) => s.code === 0) ? 0 : 1;
}
