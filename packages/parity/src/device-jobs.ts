// Devices of one target at once (LANE-SPEED): each device's work (the launches and the checks) runs in its own process
// (cli/device-one.ts, the same runOneDevice a sequential run calls), so launches and checks overlap; the parent merges the outcomes
// in matrix order. The parent boots and stops every device itself, so all boots of a run, of both targets, are admitted by the one
// in-memory budget of device-run.ts (under the device lease), and a device is stopped whatever its process did.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { DeviceOutcome, HostSource, RunLog } from './device-lanes.ts';
import { afterRelease, ANIM_LANE, DEVICE_CHECK_LANES, HIT_LANE, isBlockReason, STATE_LANE, TRACE_LANE } from './device-lanes.ts';
import type { DeviceHandle, DeviceSpec } from './device-run.ts';
import { spawnChild } from './device-exec.ts';
import { boot, DEVICE_MATRIX, DeviceLeftRunning, release } from './device-run.ts';
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

/** A job's host run that is handed to its process on stdin, after the device: the host lanes were still running when it started. */
export const HOST_ON_STDIN = 'stdin';

/** What a device process is handed. */
export type DeviceJob = { readonly target: NativeTarget; readonly device: string; readonly artifact: string; readonly host: HostRun | null | typeof HOST_ON_STDIN; readonly vectors: boolean };
/** A device job as the parent holds it: its host run may still be running. */
export type DeviceTask = Omit<DeviceJob, 'host'> & { readonly host: HostSource };

const isHostRun = (h: unknown): h is HostRun => isObj(h) && typeof h['state'] === 'string' && Array.isArray(h['suites']) && isObj(h['digests']);

/** A device job read from its file, checked: a malformed one stops the process before any device work. */
export function parseDeviceJob(text: string): DeviceJob {
  const v = JSON.parse(text) as unknown;
  const o = (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (o['target'] !== 'ios' && o['target'] !== 'android') problems.push('target is not ios or android');
  if (!DEVICE_MATRIX.some((d) => d.target === o['target'] && d.name === o['device'])) problems.push(`device ${JSON.stringify(o['device'])} is not a matrix device of the target`);
  if (typeof o['artifact'] !== 'string' || !existsSync(o['artifact'])) problems.push('artifact is not an existing path');
  if (o['host'] !== null && o['host'] !== HOST_ON_STDIN && !isHostRun(o['host'])) problems.push(`host is neither null, ${HOST_ON_STDIN} nor a host run`);
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
  // The batch set, SELD-R1b's script (device-states) and hit (device-hit) sets, ANIM-b1's frame samples (device-anim) and SELD-R2's
  // trace set (device-traces): each checked the same way.
  // Each set's failures belong to its own lanes: a lane record counts only its lane's failures, so a stray one would go uncounted.
  const lanesOf: { readonly [name: string]: readonly string[] } = { set: DEVICE_CHECK_LANES, states: [STATE_LANE], hits: [HIT_LANE], anim: [ANIM_LANE], traces: [TRACE_LANE] };
  const checkSet = (name: string, set: unknown): void => {
    if (set === null) return;
    if (!isObj(set)) {
      problems.push(`${name} is not an object`);
      return;
    }
    for (const k of ['dpr', 'cases', 'dumps']) if (typeof set[k] !== 'number') problems.push(`${name}.${k} is not a number`);
    if (typeof set['dumpsSha256'] !== 'string') problems.push(`${name}.dumpsSha256 is not a string`);
    if (!isObj(set['device']) || set['device']['name'] !== device) problems.push(`${name}.device is not this device`);
    const compared = set['compared'];
    if (!isObj(compared) || JSON.stringify(Object.keys(compared)) !== JSON.stringify(['a', 'b', 'c', 'd', 'breaks']) || !Object.values(compared).every((n) => typeof n === 'number')) problems.push(`${name}.compared is not the five check counts`);
    if (!Array.isArray(set['failures']) || !set['failures'].every((f) => isObj(f) && typeof f['lane'] === 'string' && typeof f['kind'] === 'string')) problems.push(`${name}.failures is not a failure list`);
    else {
      const lanes = lanesOf[name] ?? [];
      const stray = [...new Set(set['failures'].map((f) => (f as { lane: string }).lane).filter((l) => !lanes.includes(l)))];
      const named = lanes.length > 1 ? `${lanes.slice(0, -1).join(', ')} or ${lanes[lanes.length - 1]}` : lanes.join('');
      for (const l of stray) problems.push(`${name}.failures holds a failure of lane ${l}, not ${named}`);
    }
    if (!Array.isArray(set['faults']) || !set['faults'].every((f) => isObj(f) && typeof f['applicable'] === 'number' && typeof f['caught'] === 'number' && Array.isArray(f['uncaught']))) problems.push(`${name}.faults is not a fault row list`);
  };
  const set = v['set'];
  checkSet('set', set);
  for (const k of ['states', 'hits', 'anim', 'traces']) {
    if (set !== null && v[k] === undefined) problems.push(`a set without its ${k} set`);
    else checkSet(k, v[k] === undefined ? null : v[k]);
  }
  const trust = v['trust'];
  const trustRow = (r: unknown): boolean => isObj(r) && typeof r['case'] === 'string' && typeof r['points'] === 'number' && Array.isArray(r['mismatches']) && r['mismatches'].every((m) => typeof m === 'string');
  if (trust !== null && (!isObj(trust) || trust['device'] !== device || typeof trust['dpr'] !== 'number' || !Array.isArray(trust['rows']) || !trust['rows'].every(trustRow))) problems.push('trust is not this device\'s trust rows');
  if (set !== null && trust === null && v['blocked'] === null) problems.push('a set without its capture-trust rows');
  const vectors = v['vectors'];
  if (vectors !== null && (!isObj(vectors) || vectors['device'] !== device || typeof vectors['state'] !== 'string' || !Array.isArray(vectors['suites']))) problems.push('vectors is not this device\'s vectors run');
  if (v['blocked'] !== null && typeof v['blocked'] !== 'string') problems.push('blocked is neither null nor a string');
  const by = v['blockedBy'];
  if (by !== undefined && (!Array.isArray(by) || !by.every(isBlockReason) || (by.length > 0) !== (v['blocked'] !== null))) problems.push('blockedBy is not the block reasons of a blocked outcome');
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
 * The host run a device process is handed on its second stdin line (HOST_ON_STDIN), or the reason the host lanes failed (thrown,
 * so the vectors lane is never judged without its host run).
 */
export function parseHostLine(text: string): HostRun | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('the device process was handed no host run (the run stopped before the host lanes finished)');
  }
  if (isObj(v) && typeof v['hostError'] === 'string') throw new Error(`the host lanes failed: ${v['hostError']}`);
  if (!isObj(v) || !('host' in v) || (v['host'] !== null && !isHostRun(v['host']))) throw new Error('the device process was handed a malformed host run');
  return v['host'] as HostRun | null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Writes a device process's stdin: the boot's handle, or why the boot failed, on the first line; then, for a host run still
 * running, the run (or why the host lanes failed) on the second line once it is known; then the end.
 */
export function handOver(stdin: Writable | null, booting: Promise<DeviceHandle>, later: Promise<HostRun | null> | null): void {
  if (stdin === null) return;
  // A process that has already exited cannot take its device or its host run; its exit is reported by its done, so the write error adds nothing.
  stdin.on('error', () => undefined);
  const line = (v: unknown): string => `${JSON.stringify(v)}\n`;
  booting.then(
    (h) => {
      if (later === null) return void stdin.end(line({ handle: h }));
      stdin.write(line({ handle: h }));
      later.then(
        (host) => stdin.end(line({ host })),
        (e: unknown) => stdin.end(line({ hostError: message(e) })),
      );
    },
    (e: unknown) => stdin.end(line({ blocked: message(e) })),
  );
}

/**
 * Reads what handOver wrote, in a device process: the handle line, and with hostOnStdin the host run from the next line (an input
 * that ends early gives an empty line, which each parse refuses). The host run is awaited only by the vectors verdict, so its
 * rejection is not left unhandled when the run ends without it. close() stops reading.
 */
export function handedOver(input: Readable, hostOnStdin: boolean): { readonly handle: Promise<string>; readonly host: Promise<HostRun | null> | null; readonly close: () => void } {
  const rl = createInterface({ input });
  const lines = rl[Symbol.asyncIterator]();
  const next = async (): Promise<string> => {
    const r = await lines.next();
    return r.done === true ? '' : r.value;
  };
  const handle = next();
  const host = hostOnStdin ? handle.then(next).then(parseHostLine) : null;
  host?.catch(() => undefined);
  return { handle, host, close: () => rl.close() };
}

/**
 * Runs one device job in its own process, its log lines forwarded. The device is booted here (or was booted early, by EarlyBoots),
 * while the process computes its cases, handed to it on stdin, and stopped here once the process has exited, whatever it did: the
 * outcome, or an error naming the device. A host run still running is handed on a second line once it is known.
 */
export function runDeviceChild(task: DeviceTask, spec: DeviceSpec, log: RunLog, booting: Promise<DeviceHandle> = boot(spec)): Promise<DeviceOutcome> {
  const later = task.host instanceof Promise ? task.host : null;
  const job: DeviceJob = { ...task, host: later === null ? (task.host as HostRun | null) : HOST_ON_STDIN };
  const dir = jobDir(job.target);
  mkdirSync(dir, { recursive: true });
  const jobFile = join(dir, `${slug(job.device)}.job.json`);
  const outFile = join(dir, `${slug(job.device)}.outcome.json`);
  rmSync(outFile, { force: true });
  writeFileSync(jobFile, JSON.stringify(job));
  const handle = booting.catch(() => null);
  const { child: p, done } = spawnChild(process.execPath, ['--conditions=dragon-internal', repoPath('packages/parity/src/cli/device-one.ts'), jobFile, outFile], { stdio: ['pipe', 'pipe', 'pipe'] });
  handOver(p.stdin, booting, later);
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

/** The devices of a target, jobs at a time, each in its own process; the outcomes in matrix order. A device booted early is taken. */
export function runDevicesInChildren(target: NativeTarget, specs: readonly DeviceSpec[], jobs: number, jobOf: (spec: DeviceSpec) => DeviceTask, log: RunLog, early: EarlyBoots | null = null): Promise<DeviceOutcome[]> {
  if (specs.some((s) => s.target !== target)) throw new Error(`a device of another target in the ${target} run`);
  return pool(specs, jobs, (spec) => runDeviceChild(jobOf(spec), spec, log, early?.take(spec, log) ?? boot(spec)), (spec) => SOLO_DEVICES.includes(spec.name));
}

/** The devices a run of a target starts first, so the ones worth booting early: the first `jobs` of its matrix, solo devices last. */
export function earlySpecs(target: NativeTarget, jobs: number): DeviceSpec[] {
  return DEVICE_MATRIX.filter((d) => d.target === target && !SOLO_DEVICES.includes(d.name)).slice(0, Math.max(1, jobs));
}

/**
 * Devices booted ahead of their runs (parity:lanes boots them while the apps build and the host lanes run), each admitted by the
 * memory budget as any boot is. A run takes its device's boot and owns its stop from then on; every boot not taken is stopped by
 * releaseRest, so none outlives the run. A failed early boot is the taker's answer, as a failed boot of its own would be.
 */
export class EarlyBoots {
  private readonly boots = new Map<string, { readonly spec: DeviceSpec; readonly booting: Promise<DeviceHandle> }>();
  private readonly bootIt: (spec: DeviceSpec) => Promise<DeviceHandle>;
  constructor(specs: readonly DeviceSpec[], bootIt: (spec: DeviceSpec) => Promise<DeviceHandle> = boot) {
    this.bootIt = bootIt;
    for (const spec of specs) {
      if (this.boots.has(spec.name)) throw new Error(`${spec.name} is booted early twice`);
      const booting = bootIt(spec);
      booting.catch(() => undefined);
      this.boots.set(spec.name, { spec, booting });
    }
  }
  /**
   * The early boot of a device, handed over once (later calls give undefined). An early boot that failed is tried once more now,
   * when its run starts (the machine may have been busiest at the start), unless it left the device running.
   */
  take(spec: DeviceSpec, log: RunLog = () => undefined): Promise<DeviceHandle> | undefined {
    const b = this.boots.get(spec.name);
    this.boots.delete(spec.name);
    return b?.booting.catch((e: unknown) => {
      if (e instanceof DeviceLeftRunning) throw e;
      log(`${spec.name}: the early boot failed, so it boots again now: ${message(e)}`);
      return this.bootIt(spec);
    });
  }
  /** Stops the early boots not taken (of the devices `which` picks), once each has booted or failed; the stops' problems. */
  async releaseRest(log: RunLog, which: (spec: DeviceSpec) => boolean = () => true, stop: (h: DeviceHandle, log: RunLog) => Promise<string | null> = release): Promise<string[]> {
    const problems: string[] = [];
    for (const [name, b] of [...this.boots]) {
      if (!which(b.spec)) continue;
      this.boots.delete(name);
      const h = await b.booting.catch(() => null);
      if (h === null) continue;
      const p = await stop(h, log).catch((e: unknown) => `${name} could not be stopped: ${message(e)}`);
      if (p !== null) problems.push(p);
    }
    return problems;
  }
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
