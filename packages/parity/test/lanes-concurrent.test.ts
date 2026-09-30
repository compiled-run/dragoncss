// LANE-SPEED: two parity:lanes runs of different targets at once each re-read out/lanes.json under a lock and replace only their
// own records; devices of a target run in their own processes and merge in matrix order; parity:devices fails when any step or the
// merged file fails.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceEvidence } from '../src/device-evidence.ts';
import type { DeviceJob } from '../src/device-jobs.ts';
import { deviceJobs, devicesExit, isAncestor, leased, leaseHolder, parentPid, parseDeviceJob, parseOutcome, pool } from '../src/device-jobs.ts';
import { parseVmStat } from '../src/device-slots.ts';
import type { DeviceOutcome, DeviceSet } from '../src/device-lanes.ts';
import { mergeOutcomes } from '../src/device-lanes.ts';
import { DEVICE_MATRIX } from '../src/device-run.ts';
import { ownerState, withFileLock } from '../src/file-lock.ts';
import type { DeviceRun, HostRun, LanesFile } from '../src/lanes.ts';
import { lanesFile, ownFailures, readLanesFile, updateLanesFile, writeLanesFile } from '../src/lanes.ts';
import { repoPath } from '../src/paths.ts';
import type { NativeTarget } from '../src/targets.ts';
import { nativeTargets } from '../src/targets.ts';

const targets = nativeTargets();
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

const hostRun = (reason: string): HostRun => ({ state: 'fail', reason, toolchain: null, suites: [], digests: { p1: null, extended: null } });
const deviceRunOf = (target: NativeTarget, marker: string): DeviceRun => {
  const t = targets.find((x) => x.target === target);
  const lane = committed.targets.find((x) => x.target === target)?.lanes.find((l) => l.lane === 'device-frames');
  const base = lane?.device?.sets[0];
  if (t === undefined || base === undefined) throw new Error(`no committed ${target} device set`);
  const set = (dpr: number): DeviceSet => ({ dpr, device: { ...base.device, name: `${marker}@${dpr}` }, cases: base.cases, dumps: base.cases, compared: base.compared, dumpsSha256: marker, failures: [], faults: [] });
  return { vectors: null, sets: t.dprs.map(set), trust: [], blocked: null, evidence: deviceEvidence(target) };
};
const hostReason = (f: LanesFile, target: NativeTarget): string | null => f.targets.find((t) => t.target === target)?.lanes.find((l) => l.lane === 'layout-vectors-host')?.reason ?? null;
const deviceSha = (f: LanesFile, target: NativeTarget): string | null => f.targets.find((t) => t.target === target)?.lanes.find((l) => l.lane === 'device-frames')?.device?.sets[0]?.dumpsSha256 ?? null;

describe('two parity:lanes writers of different targets', () => {
  it('interleaved: each started from the same file; the later write keeps the records the earlier one replaced', () => {
    const path = join(tmp(), 'lanes.json');
    writeLanesFile(committed, path);
    // Both runs start (and read) before either writes, as two --target runs at once do.
    const startA = readLanesFile(path);
    const startB = readLanesFile(path);
    const ios = { host: new Map([['ios', hostRun('run A')]] as const), device: new Map([['ios', deviceRunOf('ios', 'A')]] as const) };
    const android = { host: new Map([['android', hostRun('run B')]] as const), device: new Map([['android', deviceRunOf('android', 'B')]] as const) };
    // The old write (the file read at the start, rewritten whole) puts back the other target's stale record.
    writeLanesFile(lanesFile(targets, [], android.host, null, android.device, startB), path);
    writeLanesFile(lanesFile(targets, [], ios.host, null, ios.device, startA), path);
    expect(hostReason(readLanesFile(path) as LanesFile, 'android')).not.toBe('run B');
    // The locked write re-reads the file as it stands and replaces only its own records.
    writeLanesFile(committed, path);
    updateLanesFile((onDisk) => lanesFile(targets, [], android.host, null, android.device, onDisk), path);
    const f = updateLanesFile((onDisk) => lanesFile(targets, [], ios.host, null, ios.device, onDisk), path);
    expect(readLanesFile(path)).toEqual(f);
    for (const g of [f, updateLanesFile((onDisk) => lanesFile(targets, [], new Map(), null, new Map(), onDisk), path)]) {
      expect(hostReason(g, 'ios')).toBe('run A');
      expect(hostReason(g, 'android')).toBe('run B');
      expect(deviceSha(g, 'ios')).toBe('A');
      expect(deviceSha(g, 'android')).toBe('B');
    }
  });
  it('in either order the merged file is the one sequential runs of the two targets make', () => {
    const results = (['ios-first', 'android-first'] as const).map((order) => {
      const path = join(tmp(), 'lanes.json');
      writeLanesFile(committed, path);
      const runs = (['ios', 'android'] as const).map((t) => (onDisk: LanesFile | null) => lanesFile(targets, [], new Map([[t, hostRun(`run ${t}`)]]), null, new Map([[t, deviceRunOf(t, t)]]), onDisk));
      for (const r of order === 'ios-first' ? runs : [...runs].reverse()) updateLanesFile(r, path);
      return readFileSync(path, 'utf8');
    });
    expect(results[0]).toBe(results[1]);
  });
  it('two processes updating one file under the lock lose no update', async () => {
    const dir = tmp();
    const path = join(dir, 'counter.json');
    writeFileSync(path, '0');
    const n = 25;
    const child = `
      import { readFileSync, writeFileSync } from 'node:fs';
      import { withFileLock } from ${JSON.stringify(repoPath('packages/parity/src/file-lock.ts'))};
      const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      for (let i = 0; i < ${n}; i++) withFileLock(${JSON.stringify(path)}, () => { const v = Number(readFileSync(${JSON.stringify(path)}, 'utf8')); wait(2); writeFileSync(${JSON.stringify(path)}, String(v + 1)); });
    `;
    const run = (): Promise<number | null> => new Promise((resolve) => spawn(process.execPath, ['--input-type=module', '-e', child], { stdio: 'inherit' }).once('close', resolve));
    expect(await Promise.all([run(), run()])).toEqual([0, 0]);
    expect(Number(readFileSync(path, 'utf8'))).toBe(2 * n);
  });
  it('a lock whose holder died is taken over; a live holder times out; a released or half-made lock is not dead', () => {
    const dir = tmp();
    const path = join(dir, 'lanes.json');
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    mkdirSync(`${path}.lock`);
    writeFileSync(`${path}.lock/pid`, dead);
    expect(ownerState(`${path}.lock`)).toBe('dead');
    expect(withFileLock(path, () => 6)).toBe(6);
    mkdirSync(`${path}.lock`);
    writeFileSync(`${path}.lock/pid`, String(process.pid));
    expect(() => withFileLock(path, () => 1, { timeoutMs: 300, pollMs: 50 })).toThrow(/timed out after 0.3 s waiting for the lock/);
    writeFileSync(`${path}.lock/pid`, '');
    expect(ownerState(`${path}.lock`)).toBe('alive');
    rmSync(`${path}.lock`, { recursive: true });
    expect(ownerState(`${path}.lock`)).toBe('gone');
    expect(withFileLock(path, () => 7)).toBe(7);
    expect(() => withFileLock(path, () => { throw new Error('inside'); })).toThrow('inside');
    // The lock is released after a throw.
    expect(withFileLock(path, () => 8)).toBe(8);
    // A takeover lock left by a process that died while taking over is an error naming it.
    mkdirSync(`${path}.lock`);
    writeFileSync(`${path}.lock/pid`, dead);
    mkdirSync(`${path}.lock.takeover`);
    const old = new Date(Date.now() - 120_000);
    utimesSync(`${path}.lock.takeover`, old, old);
    expect(() => withFileLock(path, () => 1)).toThrow(/takeover lock .*lanes.json.lock.takeover is 1\d\d s old/);
  });
  it('three processes meeting a dead holder\'s lock at once: one takes it over, and no update is lost', async () => {
    const dir = tmp();
    const path = join(dir, 'counter.json');
    writeFileSync(path, '0');
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
    mkdirSync(`${path}.lock`);
    writeFileSync(`${path}.lock/pid`, dead);
    const n = 20;
    const child = `
      import { readFileSync, writeFileSync } from 'node:fs';
      import { withFileLock } from ${JSON.stringify(repoPath('packages/parity/src/file-lock.ts'))};
      for (let i = 0; i < ${n}; i++) withFileLock(${JSON.stringify(path)}, () => writeFileSync(${JSON.stringify(path)}, String(Number(readFileSync(${JSON.stringify(path)}, 'utf8')) + 1)));
    `;
    const run = (): Promise<number | null> => new Promise((resolve) => spawn(process.execPath, ['--input-type=module', '-e', child], { stdio: 'inherit' }).once('close', resolve));
    expect(await Promise.all([run(), run(), run()])).toEqual([0, 0, 0]);
    expect(Number(readFileSync(path, 'utf8'))).toBe(3 * n);
  });
});

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
  it('the number of device processes at once is capped by the matrix and the request (memory is the slots\' job)', () => {
    const log = (): void => undefined;
    const android = DEVICE_MATRIX.filter((d) => d.target === 'android').length;
    expect(deviceJobs('android', null, log)).toBe(android);
    expect(deviceJobs('android', 99, log)).toBe(android);
    expect(deviceJobs('android', 1, log)).toBe(1);
    expect(deviceJobs('ios', 2, log)).toBe(2);
  });
  it('vm_stat free memory counts free, inactive and speculative pages; a missing count is null', () => {
    const text = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                                  100.\nPages active:  5.\nPages inactive:                               20.\nPages speculative:                             3.\n';
    expect(parseVmStat(text)).toBe(123 * 16384);
    expect(parseVmStat(text.replace('Pages inactive', 'Pages x'))).toBeNull();
  });
  it('parity:devices runs a device step under its platform lease, or directly without the script, and fails on any failed step', () => {
    expect(leased('ios', 'node', ['a'], '/tmp/device-lease.sh')).toMatchObject({ cmd: '/tmp/device-lease.sh', args: ['node', 'a'], env: { DRAGON_LEASE: 'ios' } });
    expect(leased('android', 'node', ['a'], null)).toMatchObject({ cmd: 'node', args: ['a'] });
    expect(devicesExit([{ code: 0 }, { code: 0 }], 0)).toBe(0);
    expect(devicesExit([{ code: 0 }, { code: 1 }], 0)).toBe(1);
    expect(devicesExit([{ code: 0 }, { code: null }], 0)).toBe(1);
    expect(devicesExit([{ code: 0 }], 1)).toBe(1);
  });
  it('parity:devices run inside the device lease sees the holder among its ancestors, so its steps do not wait on it', () => {
    const tree = new Map([[40, 30], [30, 20], [20, 1]]);
    const parentOf = (p: number): number | null => tree.get(p) ?? null;
    expect(isAncestor(20, 40, parentOf)).toBe(true);
    expect(isAncestor(40, 40, parentOf)).toBe(true);
    expect(isAncestor(99, 40, parentOf)).toBe(false);
    expect(isAncestor(5, 6, (p) => p)).toBe(false);
    expect(isAncestor(process.ppid, process.pid, parentPid)).toBe(true);
    const lock = tmp();
    expect(leaseHolder(lock)).toBeNull();
    writeFileSync(join(lock, 'pid'), 'x\n');
    expect(leaseHolder(lock)).toBeNull();
    writeFileSync(join(lock, 'pid'), '1234\n');
    expect(leaseHolder(lock)).toBe(1234);
  });
  it('--own-exit answers for the lanes the run produced: a host run does not fail on a device lane it carried, a device run does', () => {
    const f = lanesFile(targets, [], new Map([['ios', hostRun('host broke')]]), null);
    const failed = f.targets.map((t) => ({ ...t, lanes: t.lanes.map((l) => (l.where === 'device' ? { ...l, state: 'fail' as const } : { ...l, state: 'pass' as const })) }));
    const file: LanesFile = { ...f, targets: failed };
    expect(ownFailures(file, 'ios', new Set(['host']))).toEqual([]);
    const device = ownFailures(file, 'ios', new Set(['device']));
    expect(device.length).toBe(file.targets.find((t) => t.target === 'ios')?.lanes.filter((l) => l.where === 'device').length);
    expect(device.length).toBeGreaterThan(0);
    expect(ownFailures(f, 'ios', new Set(['host'])).map((l) => l.reason)).toContain('host broke');
    expect(ownFailures(f, 'android', new Set(['host', 'device']))).toEqual([]);
  });
  it('the CLIs refuse --own-exit without --target, a bad --device-jobs and an unknown parity:devices argument', () => {
    const cli = (file: string, args: readonly string[]) => spawnSync(process.execPath, ['--conditions=dragon-internal', repoPath(`packages/parity/src/cli/${file}`), ...args], { encoding: 'utf8' });
    expect(cli('lanes.ts', ['--own-exit']).stderr).toMatch(/--own-exit needs --target/);
    for (const bad of ['0', 'x', '-1']) {
      const r = cli('lanes.ts', ['--device-jobs', bad]);
      expect(r.status, bad).toBe(2);
      expect(r.stderr).toMatch(/--device-jobs takes a whole number/);
    }
    const r = cli('devices.ts', ['--run-host']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown argument "--run-host"/);
    const j = cli('devices.ts', ['--device-jobs']);
    expect(j.status).toBe(2);
    expect(j.stderr).toMatch(/--device-jobs takes a whole number/);
  });
});
