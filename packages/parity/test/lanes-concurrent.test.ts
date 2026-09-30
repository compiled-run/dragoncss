// LANE-SPEED: one parity:lanes process runs both targets at once under the device lease; it boots and stops every device itself,
// admitted by one in-memory budget, while each device's work runs in its own process and the outcomes merge in matrix order.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceJob } from '../src/device-jobs.ts';
import { deviceJobs, lanesArgs, parseDeviceJob, parseHandle, parseOutcome, pool, prebuildApps } from '../src/device-jobs.ts';
import type { DeviceOutcome, DeviceSet } from '../src/device-lanes.ts';
import { mergeOutcomes } from '../src/device-lanes.ts';
import type { AvdDeviceSpec, DeviceHandle, IosDeviceSpec } from '../src/device-run.ts';
import { admitDevice, admits, DEVICE_MATRIX, DEVICE_MEMORY, DeviceLeftRunning, failBoot, heldBytes, isAncestor, leaseHolder, MEMORY_RESERVE, parentPid, parseVmStat, release, releaseDeviceMemory, requireDeviceLease, stopSpawned, withDeviceSlot } from '../src/device-run.ts';
import type { LanesFile } from '../src/lanes.ts';
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
    trust: { device, dpr: set.dpr, rows: [] },
    vectors: null,
    blocked: null,
    ...extra,
  });
  it('an outcome survives the JSON round trip; a malformed one or another device\'s is refused', () => {
    const o = outcome('iPhone 17');
    expect(parseOutcome(JSON.stringify(o), 'iPhone 17')).toEqual(o);
    expect(() => parseOutcome('{', 'iPhone 17')).toThrow(/wrote no outcome JSON/);
    expect(() => parseOutcome(JSON.stringify(o), 'iPad (A16)')).toThrow(/malformed device outcome: device "iPhone 17"; set.device is not this device; trust is not/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: { ...o.set, failures: 'none' } }), 'iPhone 17')).toThrow(/set.failures is not a failure list/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: null }), 'iPhone 17')).toThrow(/neither a set nor a blocked reason/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: { ...o.set, faults: [{ caught: 1 }] } }), 'iPhone 17')).toThrow(/set.faults is not a fault row list/);
    expect(() => parseOutcome(JSON.stringify({ ...o, set: { ...o.set, compared: { a: 1 } } }), 'iPhone 17')).toThrow(/set.compared is not the five check counts/);
    expect(() => parseOutcome(JSON.stringify({ ...o, trust: { ...o.trust, rows: [{ case: 'x', points: 'many', mismatches: [] }] } }), 'iPhone 17')).toThrow(/trust is not this device's trust rows/);
    expect(() => parseOutcome(JSON.stringify({ ...o, trust: null }), 'iPhone 17')).toThrow(/a set without its capture-trust rows/);
    expect(parseOutcome(JSON.stringify({ ...o, set: null, trust: null, blocked: 'did not boot' }), 'iPhone 17').blocked).toBe('did not boot');
  });
  it('a device job is checked before any device work', () => {
    const job: DeviceJob = { target: 'android', device: 'dragon-320', artifact: repoPath('package.json'), host: null, vectors: true };
    expect(parseDeviceJob(JSON.stringify(job))).toEqual(job);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, device: 'iPhone 17' }))).toThrow(/not a matrix device of the target/);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, artifact: '/nonexistent' }))).toThrow(/artifact is not an existing path/);
    expect(() => parseDeviceJob(JSON.stringify({ ...job, host: 3, vectors: 'yes' }))).toThrow(/host is neither null nor a host run; vectors is not a boolean/);
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

describe('the device lease', () => {
  it('devices boot only under the lease: its holder must be this process or an ancestor', () => {
    const tree = new Map([[40, 30], [30, 20], [20, 1]]);
    const parentOf = (p: number): number | null => tree.get(p) ?? null;
    expect(isAncestor(20, 40, parentOf)).toBe(true);
    expect(isAncestor(40, 40, parentOf)).toBe(true);
    expect(isAncestor(99, 40, parentOf)).toBe(false);
    expect(isAncestor(5, 6, (p) => p)).toBe(false);
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
