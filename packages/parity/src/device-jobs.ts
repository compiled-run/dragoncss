// Devices of one target at once (LANE-SPEED): each device's work (the launches and the checks) runs in its own process
// (cli/device-one.ts, the same runOneDevice a sequential run calls), so launches and checks overlap; the parent merges the outcomes
// in matrix order. The parent boots and stops every device itself, so all boots of a run, of both targets, are admitted by the one
// in-memory budget of device-run.ts (under the device lease), and a device is stopped whatever its process did.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { DeviceOutcome, RunLog } from './device-lanes.ts';
import { afterRelease } from './device-lanes.ts';
import type { DeviceHandle, DeviceSpec } from './device-run.ts';
import { spawnChild } from './device-exec.ts';
import { boot, DEVICE_MATRIX, release } from './device-run.ts';
import type { HostRun } from './lanes.ts';
import { nativeOut } from './native-host.ts';
import { repoPath } from './paths.ts';
import type { NativeTarget } from './targets.ts';

/** Devices that always run alone, after the others (a device found flaky under load; none so far). */
export const SOLO_DEVICES: readonly string[] = [];

/**
 * How many device processes of a target are started at once: the requested number (default all), capped by the matrix. Memory is
 * not judged here: each device is admitted by the run's memory budget before it boots (device-run.ts), so a device process started
 * beyond what memory allows waits for its device there, whichever target it belongs to.
 */
export function deviceJobs(target: NativeTarget, requested: number | null, log: RunLog): number {
  const devices = DEVICE_MATRIX.filter((d) => d.target === target).length;
  const jobs = Math.max(1, Math.min(requested ?? devices, devices));
  log(`${jobs} device process(es) at once (${devices} in the matrix${requested === null ? '' : `, --device-jobs ${requested}`}); each boots once the memory budget admits it`);
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

/**
 * A device handle read by a device process from its stdin, checked against the matrix device it runs: the parent's boot, or the
 * reason the boot failed (thrown, so the device's outcome is blocked, as a failed boot of a sequential run is).
 */
export function parseHandle(text: string, spec: DeviceSpec): DeviceHandle {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(`${spec.name}: the device process was handed no device (the run stopped before the boot finished)`);
  }
  if (isObj(v) && typeof v['blocked'] === 'string') throw new Error(v['blocked']);
  const h = isObj(v) ? v['handle'] : undefined;
  const ok =
    isObj(h) &&
    JSON.stringify(h['spec']) === JSON.stringify(spec) &&
    typeof h['startedHere'] === 'boolean' &&
    (spec.target === 'ios' ? typeof h['udid'] === 'string' && h['udid'] !== '' : h['serial'] === `emulator-${spec.port}` && isObj(h['tools']) && typeof h['tools']['adb'] === 'string');
  if (!ok) throw new Error(`${spec.name}: the device process was handed a malformed device handle`);
  return { ...(h as unknown as DeviceHandle), spec } as DeviceHandle;
}

/**
 * Runs one device job in its own process, its log lines forwarded. The device is booted here, while the process computes its cases,
 * handed to it on stdin, and stopped here once the process has exited, whatever it did: the outcome, or an error naming the device.
 */
export function runDeviceChild(job: DeviceJob, spec: DeviceSpec, log: RunLog): Promise<DeviceOutcome> {
  const dir = jobDir(job.target);
  mkdirSync(dir, { recursive: true });
  const jobFile = join(dir, `${slug(job.device)}.job.json`);
  const outFile = join(dir, `${slug(job.device)}.outcome.json`);
  rmSync(outFile, { force: true });
  writeFileSync(jobFile, JSON.stringify(job));
  const booting = boot(spec);
  const handle = booting.catch(() => null);
  const { child: p, done } = spawnChild(process.execPath, ['--conditions=dragon-internal', repoPath('packages/parity/src/cli/device-one.ts'), jobFile, outFile], { stdio: ['pipe', 'pipe', 'pipe'] });
  // A process that has already exited cannot take its device; its exit is reported by done, so the write error adds nothing.
  p.stdin?.on('error', () => undefined);
  booting.then(
    (h) => p.stdin?.end(JSON.stringify({ handle: h })),
    (e: unknown) => p.stdin?.end(JSON.stringify({ blocked: e instanceof Error ? e.message : String(e) })),
  );
  if (p.stdout !== null) createInterface({ input: p.stdout }).on('line', (l) => log(l));
  const outcome = done
    .then(
      () => parseOutcome(readFileSync(outFile, 'utf8'), job.device),
      (e: unknown) => {
        throw new Error(`${job.device}: the device process failed: ${e instanceof Error ? e.message : String(e)}`);
      },
    )
    .finally(() => {
      rmSync(jobFile, { force: true });
      rmSync(outFile, { force: true });
    });
  // The device is stopped once its process is done, and before the outcome is given back; one that could not be stopped blocks it.
  const settle = async (): Promise<string | null> => {
    const h = await handle;
    if (h === null) return null;
    const r0 = Date.now();
    const problem = await release(h, log);
    log(`${spec.name}: released in ${((Date.now() - r0) / 1000).toFixed(0)} s`);
    return problem;
  };
  return outcome.then(
    async (o) => afterRelease(o, await settle()),
    async (e: unknown) => {
      await settle();
      throw e;
    },
  );
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
  return pool(specs, jobs, (spec) => runDeviceChild(jobOf(spec), spec, log), (spec) => SOLO_DEVICES.includes(spec.name));
}


export type LanesArgs = { readonly runHost: boolean; readonly runDevice: boolean; readonly only: NativeTarget | null; readonly requireAll: boolean; readonly plant: string | null; readonly jobs: number | null; readonly prebuild: NativeTarget | null };

/**
 * The parity:lanes arguments, each checked in place: --run-host, --run-device, --require-all, --target ios|android, --device-jobs N
 * (1 to 99), --plant <fault>, and the internal --prebuild ios|android. A missing or bad value, a repeated option or anything else is
 * a usage error.
 */
export function lanesArgs(args: readonly string[]): LanesArgs | { readonly error: string } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  // pnpm run parity:lanes -- --run-host passes its separator through: one leading -- is skipped, any other is unknown.
  for (let i = args[0] === '--' ? 1 : 0; i < args.length; i++) {
    const a = args[i] as string;
    if (['--run-host', '--run-device', '--require-all'].includes(a)) flags.add(a);
    else if (['--target', '--device-jobs', '--plant', '--prebuild'].includes(a)) {
      const v = args[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (values.has(a)) return { error: `${a} is given twice` };
      values.set(a, v);
    } else return { error: `unknown argument ${JSON.stringify(a)}` };
  }
  const target = (name: string): NativeTarget | null | { readonly error: string } => {
    const v = values.get(name);
    return v === undefined ? null : v === 'ios' || v === 'android' ? v : { error: `${name} takes ios or android, not ${JSON.stringify(v)}` };
  };
  const only = target('--target');
  const prebuild = target('--prebuild');
  if (only !== null && typeof only === 'object') return only;
  if (prebuild !== null && typeof prebuild === 'object') return prebuild;
  const j = values.get('--device-jobs');
  if (j !== undefined && !/^[1-9]\d?$/.test(j)) return { error: `--device-jobs takes a whole number from 1 to 99, not ${JSON.stringify(j)}` };
  return { runHost: flags.has('--run-host'), runDevice: flags.has('--run-device'), only, requireAll: flags.has('--require-all'), plant: values.get('--plant') ?? null, jobs: j === undefined ? null : Number(j), prebuild };
}

/**
 * Builds the apps of the targets, each in its own process (parity:lanes --prebuild, reused when the sources are unchanged), all at
 * once; their lines forwarded. Resolves to the targets whose build failed (a crash, a non-zero exit or a process that could not start).
 */
export async function prebuildApps(targets: readonly NativeTarget[], log: RunLog, command: (t: NativeTarget) => readonly string[] = (t) => ['--conditions=dragon-internal', repoPath('packages/parity/src/cli/lanes.ts'), '--prebuild', t]): Promise<NativeTarget[]> {
  const built = await Promise.all(
    targets.map(
      (t) =>
        new Promise<boolean>((resolve) => {
          const t0 = Date.now();
          const { child: p, done } = spawnChild(process.execPath, [...command(t)], { allowFailure: 'a failed build is this target\'s answer: it is logged, fails the run and the target runs no devices' });
          if (p.stdout !== null) createInterface({ input: p.stdout }).on('line', (l) => log(`[${t} build] ${l}`));
          if (p.stderr !== null) createInterface({ input: p.stderr }).on('line', (l) => log(`[${t} build] ${l}`));
          void done.then((r) => {
            const how = r.ok ? 'done' : r.error !== null ? `could not start: ${r.error}` : `FAILED (${r.signal ?? `exit ${r.status}`})`;
            log(`[${t} build] ${how} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
            resolve(r.ok);
          });
        }),
    ),
  );
  return targets.filter((_, i) => built[i] !== true);
}
