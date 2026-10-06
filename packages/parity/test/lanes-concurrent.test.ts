// LANE-SPEED: one parity:lanes process runs both targets at once under the device lease; it boots and stops every device itself,
// admitted by one in-memory budget, while each device's work runs in its own process and the outcomes merge in matrix order.
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceJob } from '../src/device-jobs.ts';
import { deviceJobs, EarlyBoots, earlySpecs, handedOver, handOver, HOST_ON_STDIN, lanesArgs, parseDeviceJob, parseHandle, parseHostLine, parseOutcome, pool, prebuildApps, SOLO_DEVICES } from '../src/device-jobs.ts';
import type { DeviceOutcome, DeviceSet } from '../src/device-lanes.ts';
import { afterRelease, mergeOutcomes } from '../src/device-lanes.ts';
import type { AvdDeviceSpec, DeviceHandle, IosDeviceSpec } from '../src/device-run.ts';
import { ExecError, exec, execAsync, execBytes, spawnChild } from '../src/device-exec.ts';
import { noteStartedSim, spawnDetached, stopStartedNow } from '../src/device-run.ts';
import { admitDevice, admits, DEVICE_MATRIX, DEVICE_MEMORY, DeviceLeftRunning, failBoot, heldBytes, isAncestor, leaseHolder, MEMORY_RESERVE, parentPid, parseVmStat, release, releaseDeviceMemory, requireDeviceLease, stopDevice, stopSpawned, withDeviceSlot } from '../src/device-run.ts';
import type { HostRun, LanesFile } from '../src/lanes.ts';
import { readLanesFile } from '../src/lanes.ts';
import { repoPath } from '../src/paths.ts';

const committed = readLanesFile() as LanesFile;
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dragon-lanes-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const GIB = 1024 ** 3;

describe('devices of a target at once', () => {
  const set = committed.targets[0]?.lanes.find((l) => l.lane === 'device-frames')?.device?.sets[0];
  if (set === undefined) throw new Error('no committed set');
  const outcome = (device: string, extra: Partial<DeviceOutcome> = {}): DeviceOutcome => ({
    device,
    set: { dpr: set.dpr, device: { ...set.device, name: device }, cases: set.cases, dumps: set.dumps, compared: set.compared, dumpsSha256: 'x', failures: [{ lane: 'device-frames', case: 'c', dpr: 3, node: null, kind: 'frame-chrome', detail: 'd' }], faults: [{ fault: 'frame-shift-1px', check: 'a', applicable: 1, caught: 1, uncaught: [] }] } as unknown as DeviceSet,
    // SELD-R1b: the script and hit sets travel with the batch set.
    states: { dpr: set.dpr, device: { ...set.device, name: device }, cases: 126, dumps: 126, compared: set.compared, dumpsSha256: 's', failures: [], faults: [] } as unknown as DeviceSet,
    hits: { dpr: set.dpr, device: { ...set.device, name: device }, cases: set.cases, dumps: set.cases, compared: set.compared, dumpsSha256: 'h', failures: [], faults: [] } as unknown as DeviceSet,
    // MQ-R1: the device-env rotation set travels with them too.
    env: { dpr: set.dpr, device: { ...set.device, name: device }, cases: 3, dumps: 3, compared: set.compared, dumpsSha256: 'e', failures: [], faults: [] } as unknown as DeviceSet,
    trust: { device, dpr: set.dpr, rows: [] },
    vectors: null,
    blocked: null,
    ...extra,
  });
  it('an outcome survives the JSON round trip; a malformed one or another device\'s is refused', () => {
    const o = outcome('iPhone 17');
    expect(parseOutcome(JSON.stringify(o), 'iPhone 17')).toEqual(o);
    expect(() => parseOutcome('{', 'iPhone 17')).toThrow(/wrote no outcome JSON/);
    expect(() => parseOutcome(JSON.stringify(o), 'iPad (A16)')).toThrow(/malformed device outcome: device "iPhone 17"; set.device is not this device; states.device is not this device; hits.device is not this device; env.device is not this device; trust is not/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: { ...o.set, failures: 'none' } }), 'iPhone 17')).toThrow(/set.failures is not a failure list/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: null }), 'iPhone 17')).toThrow(/neither a set nor a blocked reason/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: { ...o.set, faults: [{ caught: 1 }] } }), 'iPhone 17')).toThrow(/set.faults is not a fault row list/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: { ...o.set, compared: { a: 1 } } }), 'iPhone 17')).toThrow(/set.compared is not the five check counts/);
    expect(() => parseOutcome(JSON.stringify({ ...o, trust: { ...o.trust, rows: [{ case: 'x', points: 'many', mismatches: [] }] } }), 'iPhone 17')).toThrow(/trust is not this device's trust rows/);
    expect(() => parseOutcome(JSON.stringify({ ...o, trust: null }), 'iPhone 17')).toThrow(/a set without its capture-trust rows/);
    expect(parseOutcome(JSON.stringify({ ...o, set: null, states: null, hits: null, env: null, trust: null, blocked: 'did not boot' }), 'iPhone 17').blocked).toBe('did not boot');
    expect(() => parseOutcome(JSON.stringify({ ...o, states: undefined }), 'iPhone 17')).toThrow(/a set without its states set/);
    expect(() => parseOutcome(JSON.stringify({ ...o, hits: { ...o.hits, failures: 'none' } }), 'iPhone 17')).toThrow(/hits.failures is not a failure list/);
    expect(() => parseOutcome(JSON.stringify({ ...o, env: undefined }), 'iPhone 17')).toThrow(/a set without its env set/);
    expect(() => parseOutcome(JSON.stringify({ ...o, states: { ...o.states, device: { name: 'other' } } }), 'iPhone 17')).toThrow(/states.device is not this device/);
  });
  it('a device job is checked before any device work', () => {
    const job: DeviceJob = { target: 'android', device: 'dragon-320', artifact: repoPath('package.json'), host: null, vectors: true };
    expect(parseDeviceJob(JSON.stringify(job))).toEqual(job);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, device: 'iPhone 17' }))).toThrow(/not a matrix device of the target/);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, artifact: '/nonexistent' }))).toThrow(/artifact is not an existing path/);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, host: 3, vectors: 'yes' }))).toThrow(/host is neither null, stdin nor a host run; vectors is not a boolean/);
    // A host run still running is handed later, on stdin; any other string, or a run without its suites and digests, is refused.
    expect(parseDeviceJob(JSON.stringify({ ...job, host: HOST_ON_STDIN })).host).toBe(HOST_ON_STDIN);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, host: 'later' }))).toThrow(/host is neither null, stdin nor a host run/);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, host: { state: 'pass' } }))).toThrow(/host is neither null, stdin nor a host run/);
  });
  it('outcomes merge in matrix order, the blocked reasons joined; two vectors runs are refused', () => {
    const run = mergeOutcomes([outcome('a'), { ...outcome('b'), set: null, trust: null, blocked: 'b blocked' }, outcome('c'), { ...outcome('d'), set: null, trust: null, blocked: 'd blocked' }], { laneCode: '1', referenceData: '2', app: '3' });
    expect(run.sets.map((s) => s.device.name)).toEqual(['a', 'c']);
    expect(run.trust.map((t) => t.device)).toEqual(['a', 'c']);
    expect(run.blocked).toBe('b blocked; d blocked');
    const v = { state: 'pass' as const, reason: null, toolchain: null, suites: [], digests: { p1: null, extended: null } };
    expect(() => mergeOutcomes([outcome('a', { vectors: { ...v, device: 'a' } }), outcome('b', { vectors: { ...v, device: 'b' } })], { laneCode: '', referenceData: '', app: '' })).toThrow(/two devices ran the vectors lane/);
  });
  it('the pool keeps item order and its width, runs every item before throwing, throws the first failure in order, runs solo items alone', async () => {
    let running = 0;
    let widest = 0;
    const done: number[] = [];
    const f = async (x: number): Promise<number> => {
      running++;
      widest = Math.max(widest, running);
      await new Promise((r) => setTimeout(r, (5 - x) * 5));
      running--;
      done.push(x);
      if (x === 3 || x === 1) throw new Error(`item ${x}`);
      return x * 10;
    };
    await expect(pool([0, 1, 2, 3, 4], 2, f)).rejects.toThrow('item 1');
    expect(done.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(widest).toBe(2);
    widest = 0;
    expect(await pool([4, 2, 0], 3, async (x) => (await f(x)) + 1)).toEqual([41, 21, 1]);
    expect(widest).toBe(3);
    widest = 0;
    const order: number[] = [];
    await pool([0, 2, 4], 3, async (x) => { order.push(x); return f(x); }, (x) => x === 0);
    expect(order[order.length - 1]).toBe(0);
  });
  it('the number of device processes at once is capped by the matrix and the request (memory is the budget\'s job)', () => {
    const log = (): void => undefined;
    const android = DEVICE_MATRIX.filter((d) => d.target === 'android').length;
    expect(deviceJobs('android', null, log)).toBe(android);
    expect(deviceJobs('android', 99, log)).toBe(android);
    expect(deviceJobs('android', 1, log)).toBe(1);
    expect(deviceJobs('ios', 2, log)).toBe(2);
  });
  // PR #42 finding 4149997382: a device that could not be stopped is a tooling fault, never a pass.
  it('a device whose stop failed gives a blocked outcome naming the problem; a stopped one keeps its outcome', () => {
    const o = outcome('dragon-480');
    expect(afterRelease(o, null)).toBe(o);
    const b = afterRelease(o, 'emulator-5582 (dragon-480) still runs after adb emu kill');
    expect(b).toEqual({ device: 'dragon-480', set: null, trust: null, vectors: null, blocked: 'dragon-480: the device could not be stopped after its run (tooling fault), so its results are not used: emulator-5582 (dragon-480) still runs after adb emu kill' });
    expect(parseOutcome(JSON.stringify(b), 'dragon-480')).toEqual(b);
    expect(afterRelease({ ...o, set: null, trust: null, blocked: 'no fit' }, 'x').blocked).toMatch(/results are not used: x; no fit$/);
    const run = mergeOutcomes([outcome('a'), b], { laneCode: '', referenceData: '', app: '' });
    expect(run.sets.map((s) => s.device.name)).toEqual(['a']);
    expect(run.blocked).toMatch(/dragon-480: the device could not be stopped/);
  });
  it('a device process takes only its own matrix device from the parent, or the reason its boot failed', () => {
    const ios = DEVICE_MATRIX.find((d) => d.target === 'ios') as IosDeviceSpec;
    const avd = DEVICE_MATRIX.find((d) => d.target === 'android') as AvdDeviceSpec;
    const h = { spec: ios, udid: 'U-1', startedHere: true };
    expect(parseHandle(JSON.stringify({ handle: h }), ios)).toEqual(h);
    expect(() => parseHandle(JSON.stringify({ blocked: 'the iPhone 17 simulator failed to boot twice' }), ios)).toThrow('failed to boot twice');
    expect(() => parseHandle('', ios)).toThrow(/handed no device/);
    expect(() => parseHandle(JSON.stringify({ handle: { ...h, udid: '' } }), ios)).toThrow(/malformed device handle/);
    expect(() => parseHandle(JSON.stringify({ handle: { ...h, spec: avd } }), ios)).toThrow(/malformed device handle/);
    const a = { spec: avd, serial: `emulator-${avd.port}`, startedHere: false, tools: { adb: '/x/adb' } };
    expect(parseHandle(JSON.stringify({ handle: a }), avd)).toEqual(a);
    expect(() => parseHandle(JSON.stringify({ handle: { ...a, serial: 'emulator-1' } }), avd)).toThrow(/malformed device handle/);
  });
});

// DEVICE-SPEED (a): the devices boot while the apps build and the host lanes run; only the vectors verdict waits for its host run.
describe('devices boot while the host lanes run', () => {
  const ios = DEVICE_MATRIX.find((d) => d.target === 'ios') as IosDeviceSpec;
  const avd = DEVICE_MATRIX.find((d) => d.target === 'android') as AvdDeviceSpec;
  const hostRun = (): HostRun => {
    const l = committed.targets[0]?.lanes.find((x) => x.lane === 'layout-vectors-host');
    if (l === undefined || l.run === null) throw new Error('no committed host run');
    return { state: l.state, reason: l.reason, toolchain: l.run.toolchain, suites: l.run.suites, digests: l.run.digests };
  };
  const later = <T,>(): { readonly promise: Promise<T>; readonly resolve: (v: T) => void; readonly reject: (e: unknown) => void } => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => {
      resolve = a;
      reject = b;
    });
    return { promise, resolve, reject };
  };
  const text = async (s: PassThrough): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  };

  it('a host run line is the run, null, or the host lanes\' failure; anything else is refused', () => {
    const h = hostRun();
    expect(parseHostLine(JSON.stringify({ host: h }))).toEqual(h);
    expect(parseHostLine(JSON.stringify({ host: null }))).toBeNull();
    expect(() => parseHostLine(JSON.stringify({ hostError: 'swiftc crashed' }))).toThrow('the host lanes failed: swiftc crashed');
    expect(() => parseHostLine('')).toThrow(/handed no host run/);
    expect(() => parseHostLine(JSON.stringify({}))).toThrow(/malformed host run/);
    expect(() => parseHostLine(JSON.stringify({ host: { state: 'pass' } }))).toThrow(/malformed host run/);
  });

  it('the device goes on the first line at once; a host run still running follows on the second, and only then the input ends', async () => {
    const h = { spec: ios, udid: 'U-1', startedHere: true };
    const stdin = new PassThrough();
    const host = later<HostRun | null>();
    handOver(stdin, Promise.resolve(h), host.promise);
    const handed = handedOver(stdin, true);
    // The handle is read while the host run is still running.
    expect(parseHandle(await handed.handle, ios)).toEqual(h);
    host.resolve(hostRun());
    expect(await handed.host).toEqual(hostRun());
    handed.close();
  });

  it('without a host run to wait for, the input ends after the device; a failed boot is handed as its reason', async () => {
    const h = { spec: ios, udid: 'U-1', startedHere: true };
    const one = new PassThrough();
    handOver(one, Promise.resolve(h), null);
    expect(await text(one)).toBe(`${JSON.stringify({ handle: h })}\n`);
    const blocked = new PassThrough();
    handOver(blocked, Promise.reject(new Error('the iPhone 17 simulator failed to boot twice')), later<HostRun | null>().promise);
    const handed = handedOver(blocked, true);
    await expect(handed.handle.then((l) => parseHandle(l, ios))).rejects.toThrow('failed to boot twice');
    // The input ended after the reason, so a host run is never read as the device's.
    await expect(handed.host).rejects.toThrow(/handed no host run/);
  });

  it('host lanes that fail reach the vectors device as their failure, never as a missing host run', async () => {
    const stdin = new PassThrough();
    handOver(stdin, Promise.resolve({ spec: ios, udid: 'U-1', startedHere: true }), Promise.reject(new Error('native:swift could not start')));
    const handed = handedOver(stdin, true);
    await handed.handle;
    await expect(handed.host).rejects.toThrow('the host lanes failed: native:swift could not start');
  });

  it('a device process that never reads its host run is not killed by it, and the parent survives its closed input', async () => {
    const stdin = new PassThrough();
    const host = later<HostRun | null>();
    handOver(stdin, Promise.resolve({ spec: ios, udid: 'U-1', startedHere: true }), host.promise);
    const handed = handedOver(stdin, true);
    await handed.handle;
    handed.close();
    stdin.destroy();
    host.resolve(null);
    await new Promise((r) => setTimeout(r, 10));
  });

  it('a target boots early the devices its run starts first: the first jobs of its matrix, solo devices left out', () => {
    expect(earlySpecs('android', 99).map((d) => d.name)).toEqual(DEVICE_MATRIX.filter((d) => d.target === 'android' && !SOLO_DEVICES.includes(d.name)).map((d) => d.name));
    expect(earlySpecs('android', 1).map((d) => d.name)).toEqual([avd.name]);
    expect(earlySpecs('ios', 2).every((d) => d.target === 'ios')).toBe(true);
  });

  it('each early boot is taken once by its run; the rest are stopped, a failed boot needing no stop, and a failed stop reported', async () => {
    const booted: string[] = [];
    const bootIt = (s: AvdDeviceSpec | IosDeviceSpec): Promise<DeviceHandle> => {
      booted.push(s.name);
      return s.name === 'dragon-480' ? Promise.reject(new Error('the dragon-480 emulator failed to boot twice')) : Promise.resolve(s.target === 'ios' ? { spec: s, udid: `U-${s.name}`, startedHere: true } : ({ spec: s, serial: `emulator-${s.port}`, startedHere: true, tools: { adb: 'adb' } } as unknown as DeviceHandle));
    };
    const specs = [...earlySpecs('ios', 2), ...earlySpecs('android', 3)];
    const early = new EarlyBoots(specs, bootIt);
    // Every boot starts at once, before any run takes one.
    expect(booted).toEqual(specs.map((s) => s.name));
    expect(() => new EarlyBoots([ios, ios], bootIt)).toThrow(/booted early twice/);
    const taken = early.take(ios);
    expect(taken).toBeDefined();
    expect(early.take(ios)).toBeUndefined();
    const stopped: string[] = [];
    const stop = async (h: DeviceHandle): Promise<string | null> => {
      stopped.push(h.spec.name);
      return h.spec.name === 'dragon-smoke' ? 'emulator-5582 (dragon-smoke) still runs after adb emu kill' : null;
    };
    // Only the android boots (a failed android build): the iOS boot left stays for its run.
    expect(await early.releaseRest(() => undefined, (s) => s.target === 'android', stop)).toEqual(['emulator-5582 (dragon-smoke) still runs after adb emu kill']);
    expect(stopped).toEqual(['dragon-320', 'dragon-smoke']);
    expect(await early.releaseRest(() => undefined, () => true, stop)).toEqual([]);
    expect(stopped).toEqual(['dragon-320', 'dragon-smoke', 'iPad (A16)']);
    expect(await early.releaseRest(() => undefined, () => true, stop)).toEqual([]);
    expect(stopped).toHaveLength(3);
  });
});

describe('early boots and signals (review of #159)', () => {
  const ios = DEVICE_MATRIX.find((d) => d.target === 'ios') as IosDeviceSpec;
  const avd = DEVICE_MATRIX.find((d) => d.target === 'android') as AvdDeviceSpec;
  it('a failed early boot is tried once more when its run takes it; one that left its device running is not', async () => {
    let calls = 0;
    const h = { spec: ios, udid: 'U-1', startedHere: true };
    const early = new EarlyBoots([ios, avd], (s) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('the iPhone 17 simulator failed to boot twice'));
      if (s.target === 'android') return Promise.reject(new DeviceLeftRunning('emulator-5580 still runs'));
      return Promise.resolve(h as DeviceHandle);
    });
    const lines: string[] = [];
    await expect(early.take(ios, (l) => lines.push(l))).resolves.toEqual(h);
    expect(calls).toBe(3);
    expect(lines).toEqual([`${ios.name}: the early boot failed, so it boots again now: the iPhone 17 simulator failed to boot twice`]);
    await expect(early.take(avd)).rejects.toThrow(DeviceLeftRunning);
    expect(calls).toBe(3);
  });
  it('a signal stops every detached emulator this process started and has not stopped', async () => {
    const p = spawnDetached('sleep', ['60']);
    expect(p.alive()).toBe(true);
    expect(stopStartedNow()).toEqual(['an emulator process (SIGTERM)']);
    for (let i = 0; i < 100 && p.alive(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(p.alive()).toBe(false);
    // An exited one is forgotten, so a later signal stops nothing twice.
    expect(stopStartedNow()).toEqual([]);
  });
  it('one stop that throws on a signal does not leave the other devices up', async () => {
    const p = spawnDetached('sleep', ['60']);
    noteStartedSim('U-A', 'iPhone 17');
    noteStartedSim('U-B', 'iPad (A16)');
    const tried: string[] = [];
    const out = stopStartedNow((udid) => {
      tried.push(udid);
      if (udid === 'U-A') throw new Error('simctl timed out');
    });
    expect(tried).toEqual(['U-A', 'U-B']);
    expect(out).toEqual(['an emulator process (SIGTERM)', 'the iPhone 17 simulator: the stop FAILED: simctl timed out', 'the iPad (A16) simulator']);
    for (let i = 0; i < 100 && p.alive(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(p.alive()).toBe(false);
    expect(stopStartedNow(() => undefined)).toEqual([]);
  });
  it('parity:lanes stops the devices it started on SIGTERM and SIGINT, and prints every device failure when the host phase fails', () => {
    const src = readFileSync(repoPath('packages/parity/src/cli/lanes.ts'), 'utf8');
    expect(src).toContain("for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const)");
    expect(src).toContain('for (const d of stopStartedNow())');
    expect(src).toMatch(/if \(hostFailed !== null\) \{\n\s+for \(const r of settled\) if \(r\.status === 'rejected'\) console\.log/);
  });
});

describe('the device lease', () => {
  it('devices boot only under the lease: its holder must be this process or an ancestor', () => {
    const tree = new Map([[40, 30], [30, 20], [20, 1]]);
    const parentOf = (p: number): number | null => tree.get(p) ?? null;
    expect(isAncestor(20, 40, parentOf)).toBe(true);
    expect(isAncestor(40, 40, parentOf)).toBe(true);
    expect(isAncestor(99, 40, parentOf)).toBe(false);
    expect(isAncestor(5, 6, (p) => p)).toBe(false);
    // PR #42 finding 4149997421: a lease held by pid 1 (a container's entrypoint) covers its descendants.
    const container = new Map([[40, 30], [30, 1]]);
    expect(isAncestor(1, 40, (p) => container.get(p) ?? null)).toBe(true);
    expect(() => requireDeviceLease(1, 40, (p) => container.get(p) ?? null)).not.toThrow();
    expect(isAncestor(1, 40, (p) => (p === 1 ? 0 : (container.get(p) ?? null)))).toBe(true);
    expect(isAncestor(process.ppid, process.pid, parentPid)).toBe(true);
    expect(() => requireDeviceLease(20, 40, parentOf)).not.toThrow();
    expect(() => requireDeviceLease(null, 40, parentOf)).toThrow(/no device lease is held .*device-lease.sh/);
    expect(() => requireDeviceLease(99, 40, parentOf)).toThrow(/held by pid 99, not by this process or an ancestor: another device run/);
    const lock = tmp();
    expect(leaseHolder(lock)).toBeNull();
    writeFileSync(join(lock, 'pid'), 'x\n');
    expect(leaseHolder(lock)).toBeNull();
    writeFileSync(join(lock, 'pid'), '1234\n');
    expect(leaseHolder(lock)).toBe(1234);
  });
  it('a boot without the lease is refused before any memory is reserved', async () => {
    await expect(admitDevice({ target: 'ios', name: 'iPhone 17' }, { lease: () => requireDeviceLease(null) })).rejects.toThrow(/no device lease is held/);
    expect(heldBytes()).toBe(0);
  });
});

describe('the memory budget', () => {
  const mem = { total: 48 * GIB, available: 20 * GIB };
  const quiet = { lease: () => undefined, log: () => undefined, memory: () => mem };
  afterEach(() => {
    for (const d of DEVICE_MATRIX) releaseDeviceMemory(d.name);
    for (const n of ['x', 'y']) releaseDeviceMemory(n);
  });
  it('admits while the held bytes plus the request fit the smaller of total and available memory, less the reserve', () => {
    expect(admits(0, 4 * GIB, mem, 8 * GIB)).toBe(true);
    expect(admits(8 * GIB, 4 * GIB, mem, 8 * GIB)).toBe(true);
    expect(admits(11 * GIB, 3 * GIB, mem, 8 * GIB)).toBe(false);
    expect(admits(4 * GIB, 4 * GIB, { total: 10 * GIB, available: 40 * GIB }, 4 * GIB)).toBe(false);
  });
  // PR #42 finding 4149425879: a run never boots a device the budget does not admit, the first one included.
  it('the first device waits for the budget too, and one that can never be admitted fails naming the device, its need and the free memory', async () => {
    expect(admits(0, 4 * GIB, { total: 8 * GIB, available: 1 * GIB })).toBe(false);
    expect(admits(0, 4 * GIB, { total: 48 * GIB, available: 11 * GIB })).toBe(false);
    expect(admits(0, 4 * GIB, { total: 48 * GIB, available: 12 * GIB })).toBe(true);
    const starved = admitDevice({ target: 'android', name: 'dragon-480' }, { ...quiet, memory: () => ({ total: 48 * GIB, available: 3 * GIB }), waitMs: 20, pollMs: 5 });
    await expect(starved).rejects.toThrow(/dragon-480: no device memory within 0.02 s \(tooling fault\): needs 4.0 GiB; 3.0 GiB free of 48.0 GiB read, less the 8.0 GiB reserve, is a -5.0 GiB budget; no device held/);
    expect(heldBytes()).toBe(0);
    // Memory freed while it waits admits it.
    let available = 3 * GIB;
    const waiting = admitDevice({ target: 'ios', name: 'iPhone 17' }, { ...quiet, memory: () => ({ total: 48 * GIB, available }), pollMs: 5 });
    setTimeout(() => void (available = 20 * GIB), 30);
    await waiting;
    expect(heldBytes()).toBe(DEVICE_MEMORY.ios);
  });
  it('both targets asking at once never pass the budget, whatever order they ask in', async () => {
    const devices = DEVICE_MATRIX.map((d) => ({ target: d.target, name: d.name }));
    for (let seed = 0; seed < 20; seed++) {
      const order = devices.map((d, i) => ({ d, k: (i * 7919 + seed * 104729) % 97 })).sort((x, y) => x.k - y.k).map((x) => x.d);
      const admitted = await Promise.all(order.map((d) => admitDevice(d, { ...quiet, waitMs: 0, pollMs: 1 }).then(() => d.name, () => null)));
      const held = admitted.filter((n): n is string => n !== null);
      const bytes = DEVICE_MATRIX.filter((d) => held.includes(d.name)).reduce((n, d) => n + DEVICE_MEMORY[d.target], 0);
      expect(heldBytes()).toBe(bytes);
      expect(bytes).toBeLessThanOrEqual(mem.available - MEMORY_RESERVE);
      expect(held.length).toBeGreaterThan(1);
      expect(held.length).toBeLessThan(devices.length);
      for (const n of held) releaseDeviceMemory(n);
    }
  });
  it('a device waits until memory is given back, and a wait that finds none in time names the holders', async () => {
    await admitDevice({ target: 'android', name: 'x' }, { ...quiet, memory: () => ({ total: 48 * GIB, available: 14 * GIB }) });
    const waiting = admitDevice({ target: 'android', name: 'y' }, { ...quiet, memory: () => ({ total: 48 * GIB, available: 14 * GIB }), pollMs: 5 });
    setTimeout(() => releaseDeviceMemory('x'), 30);
    await waiting;
    expect(heldBytes()).toBe(4 * GIB);
    await expect(admitDevice({ target: 'ios', name: 'iPhone 17' }, { ...quiet, memory: () => ({ total: 48 * GIB, available: 12 * GIB }), waitMs: 20, pollMs: 5 })).rejects.toThrow(/no device memory within 0.02 s .*held by y/);
  });
  it('a failed boot gives its memory back; one that left the device running keeps it', async () => {
    const spec: IosDeviceSpec = { target: 'ios', name: 'iPhone 17' };
    await expect(withDeviceSlot(spec, () => Promise.reject(new Error('boot failed')), quiet)).rejects.toThrow('boot failed');
    expect(heldBytes()).toBe(0);
    await expect(withDeviceSlot(spec, () => Promise.reject(new DeviceLeftRunning('boot failed; and it still runs')), quiet)).rejects.toThrow('still runs');
    expect(heldBytes()).toBe(DEVICE_MEMORY.ios);
  });
  it('release gives memory back only once a device started here is confirmed stopped; a failed or thrown stop keeps it and is logged', async () => {
    const spec: IosDeviceSpec = { target: 'ios', name: 'iPhone 17' };
    const started = await withDeviceSlot(spec, () => Promise.resolve({ spec, udid: 'x', startedHere: true } satisfies DeviceHandle), quiet);
    const lines: string[] = [];
    expect(await release(started, (l) => lines.push(l), () => Promise.resolve('the iPhone 17 simulator is Booted after simctl shutdown'))).toMatch(/is Booted/);
    expect(lines.join('\n')).toMatch(/memory stays reserved until this process exits/);
    expect(heldBytes()).toBe(DEVICE_MEMORY.ios);
    expect(await release(started, () => undefined, () => Promise.reject(new Error('simctl hung')))).toMatch(/could not be stopped: simctl hung/);
    expect(heldBytes()).toBe(DEVICE_MEMORY.ios);
    expect(await release(started, () => undefined, () => Promise.resolve(null))).toBeNull();
    expect(heldBytes()).toBe(0);
    // A device this runner did not start stays running, so it keeps its memory; booting it again reserves nothing more.
    const found = await withDeviceSlot(spec, () => Promise.resolve({ spec, udid: 'x', startedHere: false } satisfies DeviceHandle), quiet);
    expect(await release(found, () => undefined, () => Promise.resolve(null))).toBeNull();
    expect(heldBytes()).toBe(DEVICE_MEMORY.ios);
    await withDeviceSlot(spec, () => Promise.resolve(found), quiet);
    expect(heldBytes()).toBe(DEVICE_MEMORY.ios);
  });
  // PR #42 findings 4149425883 and 4149425914: every cleanup stop of a failed boot runs, and a rejected one counts as not stopped.
  it('a failed boot runs every cleanup stop; a stop that rejects or fails keeps the device counted as running', async () => {
    const boom = new Error('bootstatus failed');
    await expect(failBoot(boom, [() => Promise.resolve(null)])).rejects.toBe(boom);
    await expect(failBoot(boom, [() => Promise.reject(new Error('simctl list crashed'))])).rejects.toSatisfy((e: unknown) => e instanceof DeviceLeftRunning && /bootstatus failed; and the stop failed: simctl list crashed/.test(e.message));
    let spawnedStopped = false;
    const stopSpawnedToo = async (): Promise<string | null> => {
      spawnedStopped = true;
      return null;
    };
    await expect(failBoot(boom, [() => Promise.resolve('emulator-5580 still runs after adb emu kill'), stopSpawnedToo])).rejects.toBeInstanceOf(DeviceLeftRunning);
    expect(spawnedStopped).toBe(true);
    let alive = true;
    expect(await stopSpawned({ alive: () => alive, kill: () => void (alive = false) }, 'dragon-320')).toBeNull();
    expect(await stopSpawned({ alive: () => true, kill: () => undefined }, 'dragon-480', 600)).toMatch(/dragon-480 emulator process still runs after SIGTERM/);
  });
  it('vm_stat free memory counts free, inactive and speculative pages; a missing count is null', () => {
    const text = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                                  100.\nPages active:  5.\nPages inactive:                               20.\nPages speculative:                             3.\n';
    expect(parseVmStat(text)).toBe(123 * 16384);
    expect(parseVmStat(text.replace('Pages inactive', 'Pages x'))).toBeNull();
  });
});

describe('parity:lanes, the one device run process', () => {
  it('checks each argument in place', () => {
    expect(lanesArgs([])).toEqual({ runHost: false, runDevice: false, only: null, requireAll: false, plant: null, jobs: null, prebuild: null });
    expect(lanesArgs(['--run-host', '--run-device', '--device-jobs', '3', '--target', 'ios', '--require-all'])).toMatchObject({ runHost: true, runDevice: true, jobs: 3, only: 'ios', requireAll: true });
    expect(lanesArgs(['--device-jobs', '2', '2'])).toEqual({ error: 'unknown argument "2"' });
    expect(lanesArgs(['--device-jobs'])).toEqual({ error: '--device-jobs needs a value' });
    expect(lanesArgs(['--device-jobs', '--run-host'])).toEqual({ error: '--device-jobs needs a value' });
    for (const bad of ['0', 'x', '-1', '100']) expect(lanesArgs(['--device-jobs', bad])).toMatchObject({ error: expect.stringMatching(/takes a whole number from 1 to 99/) });
    expect(lanesArgs(['--device-jobs', '2', '--device-jobs', '3'])).toEqual({ error: '--device-jobs is given twice' });
    expect(lanesArgs(['--target', 'web'])).toEqual({ error: '--target takes ios or android, not "web"' });
    expect(lanesArgs(['--own-exit'])).toEqual({ error: 'unknown argument "--own-exit"' });
  });
  it('a failed app build is reported and fails the run, and its target runs no devices', async () => {
    const lines: string[] = [];
    const failed = await prebuildApps(['ios', 'android'], (l) => lines.push(l), (t) => ['-e', t === 'android' ? 'console.log("no kotlinc"); process.exit(3)' : 'console.log("built")']);
    expect(failed).toEqual(['android']);
    expect(lines).toContain('[ios build] built');
    expect(lines.join('\n')).toMatch(/\[android build\] no kotlinc[\s\S]*\[android build\] FAILED \(exit 3\)/);
    expect(await prebuildApps(['ios'], () => undefined, () => ['-e', 'process.kill(process.pid, "SIGKILL")'])).toEqual(['ios']);
  });
  it('the CLI refuses a bad argument, and --run-device outside the device lease, before any work', () => {
    const cli = (args: readonly string[]) => spawnSync(process.execPath, ['--conditions=dragon-internal', repoPath('packages/parity/src/cli/lanes.ts'), ...args], { encoding: 'utf8' });
    const r = cli(['--device-jobs', '0']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--device-jobs takes a whole number/);
    expect(cli(['--run-hots']).stderr).toMatch(/unknown argument "--run-hots"/);
    if (leaseHolder() === null || !isAncestor(leaseHolder() as number, process.pid, parentPid)) {
      const d = cli(['--run-device', '--target', 'ios']);
      expect(d.status).toBe(2);
      expect(d.stderr).toMatch(/--run-device: .*device lease/);
    }
  });
});

describe('every boot path is admitted', () => {
  // A simulator or emulator started anywhere in the parity sources outside the budget (and so outside the lease check) would
  // overcommit memory beside the run's devices.
  const src = repoPath('packages/parity/src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));
  const boots = /'simctl', 'boot'|'-avd'/;
  it('each source that boots a device is admitted by the budget before its first boot', () => {
    const booting = files(src).filter((f) => boots.test(readFileSync(f, 'utf8')));
    expect(booting.map((f) => f.slice(src.length + 1)).sort()).toEqual(['cli/native-smoke.ts', 'device-run.ts']);
    for (const f of booting) {
      const text = readFileSync(f, 'utf8');
      const admitted = text.search(/admitDevice\(|withDeviceSlot\(/);
      expect(admitted, f).toBeGreaterThanOrEqual(0);
      expect(admitted, f).toBeLessThan(text.search(boots));
    }
  });
});

// PR #42 round 5: every child process of the device code runs through device-exec.ts, which throws on a failure unless the call
// names why its failure is an answer.
describe('the one child-process helper', () => {
  const sources = (): string[] => {
    const src = repoPath('packages/parity/src');
    return [...readdirSync(src).filter((f) => /^device-.*\.ts$/.test(f) && f !== 'device-exec.ts').map((f) => join(src, f)), join(src, 'cli', 'lanes.ts'), join(src, 'cli', 'device-one.ts')];
  };
  it('no device source starts a child process outside the helper, nor uses the non-throwing native-host run()', () => {
    const files = sources();
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/from 'node:child_process'|require\('node:child_process'\)|\b(spawnSync|execFileSync|execSync)\(/);
      expect(text, f).not.toMatch(/import \{[^}]*\brun\b[^}]*\} from '\.\.?\/(native-host|\.\.\/native-host)\.ts'/);
      // Every allowed failure says why.
      for (const m of text.matchAll(/allowFailure: ('[^']*'|[A-Za-z_]+)/g)) expect(m[1], f).not.toBe("''");
    }
  });
  it('a failure reaches the caller: a non-zero exit, a signal, a command that cannot start, a timeout', async () => {
    expect(exec('sh', ['-c', 'echo hi']).stdout).toBe('hi\n');
    expect(() => exec('sh', ['-c', 'echo boom >&2; exit 3'])).toThrow(ExecError);
    expect(() => exec('sh', ['-c', 'echo boom >&2; exit 3'])).toThrow(/sh -c echo boom >&2; exit 3 failed \(exit 3; tooling fault\): boom/);
    expect(() => exec('sh', ['-c', 'kill -9 $$'])).toThrow(/killed by SIGKILL/);
    expect(() => exec('/nonexistent/adb', ['devices'])).toThrow(/ENOENT/);
    expect(() => exec('sh', ['-c', 'sleep 5'], { timeoutMs: 100 })).toThrow(/ETIMEDOUT/);
    await expect(execAsync('sh', ['-c', 'exit 4'])).rejects.toThrow(/exit 4/);
    await expect(execAsync('/nonexistent/xcrun', [])).rejects.toThrow(/ENOENT/);
    await expect(spawnChild('sh', ['-c', 'exit 5']).done).rejects.toBeInstanceOf(ExecError);
    expect(() => execBytes('sh', ['-c', 'exit 6'])).toThrow(/exit 6/);
    expect(execBytes('sh', ['-c', 'printf ab']).bytes.toString('utf8')).toBe('ab');
  });
  it('a call that names why its failure is an answer gets the result to judge; an empty reason is refused', async () => {
    const r = exec('sh', ['-c', 'echo no >&2; exit 1'], { allowFailure: 'the test judges it' });
    expect(r).toMatchObject({ ok: false, status: 1, stderr: 'no\n' });
    expect(exec('/nonexistent/adb', [], { allowFailure: 'judged' })).toMatchObject({ ok: false, errorCode: 'ENOENT' });
    expect((await execAsync('sh', ['-c', 'exit 2'], { allowFailure: 'judged' })).status).toBe(2);
    expect(() => exec('sh', ['-c', 'exit 1'], { allowFailure: ' ' })).toThrow(/allowFailure needs a reason/);
  });
  // PR #42 finding 4150454065: a failed adb devices read is not an empty list, so a device whose read failed is not "stopped".
  it('a stop whose adb devices read fails reports the device as possibly running, not stopped', async () => {
    const dir = tmp();
    const adb = join(dir, 'adb');
    writeFileSync(adb, '#!/bin/sh\necho "adb: cannot connect to daemon" >&2\nexit 1\n');
    chmodSync(adb, 0o755);
    const spec = DEVICE_MATRIX.find((d) => d.target === 'android') as AvdDeviceSpec;
    const h = { spec, serial: `emulator-${spec.port}`, startedHere: true, tools: { adb } } as unknown as DeviceHandle;
    expect(await stopDevice(h)).toMatch(/still runs after adb emu kill: .*adb -s emulator-\d+ devices failed|adb devices failed \(exit 1/);
  });
});
