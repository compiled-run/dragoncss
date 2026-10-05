// CI device lanes (device-ci.ts): the pinned iOS runtime, the host's Android image, the CI memory reserve, and the merge of
// per-device outcomes, which refuses a missing, repeated or foreign outcome instead of merging a subset.
import { describe, expect, it } from 'vitest';
import { ciOutcomeText, type CiOutcome, mergeCiOutcomes, OUTCOME_SCHEMA, parseCiOutcome, producerLabel } from '../src/device-ci.ts';
import { lanesFile, laneSources, checkLaneParity } from '../src/lanes.ts';
import { nativeTargets } from '../src/targets.ts';
import type { DeviceEvidence } from '../src/device-evidence.ts';
import { androidImage, DEVICE_MATRIX, IOS_RUNTIME, memoryReserve, MEMORY_RESERVE, pickIosRuntime, type SimRuntime } from '../src/device-run.ts';

const GIB = 1024 ** 3;
const rt = (version: string, build: string, isAvailable = true): SimRuntime => ({ identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace('.', '-')}`, version, buildversion: build, isAvailable, name: `iOS ${version}` });

describe('pinned iOS runtime', () => {
  it('picks the pinned build even when a newer runtime is installed', () => {
    expect(IOS_RUNTIME).toEqual({ version: '26.5', build: '23F77' });
    expect(pickIosRuntime([rt('27.0', '24A100'), rt('26.5', '23F77'), rt('26.4', '23E244')])).toEqual({ identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5', version: '26.5', build: '23F77' });
  });
  it('refuses a host without it, naming what is installed, and a runtime whose version is not the pin', () => {
    expect(() => pickIosRuntime([rt('27.0', '24A100'), rt('26.5', '23F77', false)])).toThrow('the pinned iOS 26.5 (23F77) simulator runtime is not installed; available: 27.0 (24A100) (tooling fault)');
    expect(() => pickIosRuntime([rt('26.6', '23F77')])).toThrow('reports version 26.6, not the pinned 26.5');
  });
});

describe('the host Android image', () => {
  it('is arm64-v8a on Apple Silicon and x86_64 on an x86-64 host, the same android-36 line', () => {
    expect(androidImage('arm64')).toBe('system-images;android-36;default;arm64-v8a');
    expect(androidImage('x64')).toBe('system-images;android-36;default;x86_64');
    expect(() => androidImage('ia32')).toThrow('no android-36 system image for the host architecture ia32');
  });
});

describe('the device memory reserve', () => {
  it('is MEMORY_RESERVE unless DRAGON_DEVICE_RESERVE_GIB names a whole number of GiB from 0 to 64', () => {
    expect(memoryReserve({})).toBe(MEMORY_RESERVE);
    expect(memoryReserve({ DRAGON_DEVICE_RESERVE_GIB: '0' })).toBe(0);
    expect(memoryReserve({ DRAGON_DEVICE_RESERVE_GIB: '2' })).toBe(2 * GIB);
    for (const bad of ['', 'x', '-1', '1.5', '65', '100']) expect(() => memoryReserve({ DRAGON_DEVICE_RESERVE_GIB: bad })).toThrow('DRAGON_DEVICE_RESERVE_GIB must be a whole number');
  });
});

const stamp = (c: string): DeviceEvidence => ({ laneCode: c.repeat(64), referenceData: 'b'.repeat(64), app: 'c'.repeat(64) });
const CI = 'GitHub Actions Linux X64 (ubuntu24) run https://github.com/o/r/actions/runs/1';
const MAC = 'local darwin-arm64';
const outcomeOf = (target: 'ios' | 'android', device: string, evidence = stamp('a')): CiOutcome => ({ schema: OUTCOME_SCHEMA, target, device, evidence, producedOn: CI, outcome: { device, set: null, trust: null, vectors: null, blocked: `${device} blocked` } });
const all = (): CiOutcome[] => DEVICE_MATRIX.map((d) => outcomeOf(d.target, d.name));
const vectorsRun = (device: string) => ({ device, state: 'pass' as const, reason: null, toolchain: 'kotlinc', suites: [], digests: { p1: 'p', extended: 'x' } });
const withVectors = (o: CiOutcome, producedOn = o.producedOn): CiOutcome => ({ ...o, producedOn, outcome: { ...o.outcome, vectors: vectorsRun(o.device) } });

describe('device outcome files', () => {
  it('round-trips a device outcome and refuses a malformed one', () => {
    const o = outcomeOf('ios', 'iPhone 17');
    expect(parseCiOutcome(ciOutcomeText(o), 'f.json')).toEqual(o);
    const bad = (v: unknown, msg: string): void => expect(() => parseCiOutcome(JSON.stringify(v), 'f.json')).toThrow(msg);
    expect(() => parseCiOutcome('{', 'f.json')).toThrow('f.json: not JSON');
    bad({ ...o, schema: 'x' }, 'schema "x", not dragon.device-outcome/2');
    bad({ ...o, target: 'web' }, 'target "web" is not ios or android');
    bad({ ...o, device: 'dragon-smoke' }, '"dragon-smoke" is not a ios matrix device');
    bad({ ...o, evidence: { ...o.evidence, app: 'zz' } }, 'evidence is not a stamp of three sha256 digests');
    bad({ ...o, outcome: { ...o.outcome, device: 'iPad (A16)' } }, 'iPhone 17: malformed device outcome');
    bad({ ...o, outcome: { ...o.outcome, blocked: null } }, 'neither a set nor a blocked reason');
    bad({ ...o, producedOn: 3 }, 'producedOn is not a host label');
  });
});

describe('merging the device jobs', () => {
  it('merges every matrix device in matrix order, whatever order the files came in, with each lane\'s hosts', () => {
    const outs = all().map((o) => (o.device === 'dragon-smoke' || o.device === 'iPhone 17' ? withVectors(o) : o));
    const runs = mergeCiOutcomes([...outs].reverse(), () => stamp('a'));
    expect([...runs.keys()]).toEqual(['ios', 'android']);
    expect(runs.get('ios')!.blocked).toBe('iPhone 17 blocked; iPad (A16) blocked');
    expect(runs.get('android')!.blocked).toBe('dragon-320 blocked; dragon-smoke blocked; dragon-480 blocked');
    expect(runs.get('android')!.evidence).toEqual(stamp('a'));
    expect(runs.get('android')!.vectors).toEqual(vectorsRun('dragon-smoke'));
    expect(runs.get('android')!.producedOn).toEqual({ devices: { 'dragon-320': CI, 'dragon-smoke': CI, 'dragon-480': CI }, vectors: CI });
  });
  it('fails loudly on a missing device, a repeated one, or another stamp, naming each; nothing is merged from a subset', () => {
    const outs = all().filter((o) => o.device !== 'dragon-480');
    outs.push(outcomeOf('ios', 'iPhone 17'));
    outs[1] = outcomeOf('ios', 'iPad (A16)', stamp('d'));
    expect(() => mergeCiOutcomes(outs, () => stamp('a'))).toThrow(/ios\/iPad \(A16\): evidence laneCode dddddddddddd is not this tree's aaaaaaaaaaaa\n {2}ios\/iPhone 17: two outcomes\n {2}android\/dragon-480: no outcome/);
  });
  it('writes the hosts of every device lane into the lane records', () => {
    const targets = nativeTargets();
    const outs = all().map((o) => (o.device === 'dragon-smoke' ? withVectors(o, MAC) : o));
    const file = lanesFile(targets, checkLaneParity(targets, laneSources()), new Map(), null, mergeCiOutcomes(outs, () => stamp('a')), null);
    const android = file.targets.find((t) => t.target === 'android')!.lanes;
    expect(android.find((l) => l.lane === 'layout-vectors-device')!.producedOn).toEqual([MAC]);
    expect(android.find((l) => l.lane === 'layout-vectors-device')!.state).toBe('pass');
    expect(file.targets.find((t) => t.target === 'ios')!.lanes.find((l) => l.lane === 'layout-vectors-device')!.producedOn).toEqual([]);
  });
});

describe('host labels', () => {
  it('names a GitHub Actions run by runner and URL, and anything else as this machine', () => {
    expect(producerLabel({ GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', ImageOS: 'ubuntu24', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9' })).toBe('GitHub Actions Linux X64 (ubuntu24) run https://github.com/o/r/actions/runs/9');
    expect(producerLabel({}, 'darwin', 'arm64')).toBe('local darwin-arm64');
  });
});
