// CI device lanes (device-ci.ts): the pinned iOS runtime, the host's Android image, the CI memory reserve, and the merge of
// per-device outcomes, which refuses a missing, repeated or foreign outcome instead of merging a subset.
import { describe, expect, it } from 'vitest';
import { ciOutcomeText, type CiOutcome, LOCAL_VECTORS, mergeCiOutcomes, OUTCOME_SCHEMA, parseCiOutcome, parseVectorsRecord, producerLabel, type VectorsRecord, vectorsRecordText, VECTORS_SCHEMA } from '../src/device-ci.ts';
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
const localOf = (evidence = stamp('a')): VectorsRecord => ({ schema: VECTORS_SCHEMA, target: 'android', device: LOCAL_VECTORS.device, evidence, producedOn: MAC, vectors: vectorsRun(LOCAL_VECTORS.device) });

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

describe('merging the device jobs with the Mac\'s vectors record (the hybrid)', () => {
  it('merges every matrix device in matrix order, whatever order the files came in, with android vectors from the Mac', () => {
    const runs = mergeCiOutcomes([...all()].reverse(), localOf(), () => stamp('a'));
    expect([...runs.keys()]).toEqual(['ios', 'android']);
    expect(runs.get('ios')!.blocked).toBe('iPhone 17 blocked; iPad (A16) blocked');
    expect(runs.get('android')!.blocked).toBe('dragon-320 blocked; dragon-smoke blocked; dragon-480 blocked');
    expect(runs.get('android')!.evidence).toEqual(stamp('a'));
    expect(runs.get('android')!.vectors).toEqual(vectorsRun('dragon-smoke'));
    expect(runs.get('android')!.producedOn).toEqual({ devices: { 'dragon-320': CI, 'dragon-smoke': CI, 'dragon-480': CI }, vectors: MAC });
    expect(runs.get('ios')!.producedOn).toEqual({ devices: { 'iPhone 17': CI, 'iPad (A16)': CI }, vectors: null });
  });
  it('fails loudly without either half: no local record, a missing device, a repeated one, another stamp, or CI android vectors', () => {
    expect(() => mergeCiOutcomes(all(), null, () => stamp('a'))).toThrow('android/dragon-smoke layout-vectors-device: no local record');
    const outs = all().filter((o) => o.device !== 'dragon-480');
    outs.push(outcomeOf('ios', 'iPhone 17'));
    outs[1] = outcomeOf('ios', 'iPad (A16)', stamp('d'));
    expect(() => mergeCiOutcomes(outs, localOf(), () => stamp('a'))).toThrow(/ios\/iPad \(A16\): evidence laneCode dddddddddddd is not this tree's aaaaaaaaaaaa\n {2}ios\/iPhone 17: two outcomes\n {2}android\/dragon-480: no outcome/);
    expect(() => mergeCiOutcomes(all(), localOf(stamp('e')), () => stamp('a'))).toThrow('android/dragon-smoke local vectors: evidence laneCode eeeeeeeeeeee is not this tree\'s aaaaaaaaaaaa');
    const ciVectors = all().map((o) => (o.device === 'dragon-smoke' ? { ...o, outcome: { ...o.outcome, vectors: vectorsRun('dragon-smoke') } } : o));
    expect(() => mergeCiOutcomes(ciVectors, localOf(), () => stamp('a'))).toThrow('android/dragon-smoke: the CI outcome holds an android vectors run; the hybrid runs that lane on the Mac only');
  });
  it('merges the CI half alone only when asked (the workflow\'s check), leaving android vectors not run', () => {
    const runs = mergeCiOutcomes(all(), 'ci-half', () => stamp('a'));
    expect(runs.get('android')!.vectors).toBeNull();
    expect(runs.get('android')!.producedOn!.vectors).toBeNull();
  });
  it('writes the hosts of every device lane into the lane records', () => {
    const targets = nativeTargets();
    const runs = mergeCiOutcomes(all(), localOf(), () => stamp('a'));
    const file = lanesFile(targets, checkLaneParity(targets, laneSources()), new Map(), null, runs, null);
    const android = file.targets.find((t) => t.target === 'android')!.lanes;
    expect(android.find((l) => l.lane === 'layout-vectors-device')!.producedOn).toEqual([MAC]);
    expect(android.find((l) => l.lane === 'layout-vectors-device')!.state).toBe('pass');
    expect(file.targets.find((t) => t.target === 'ios')!.lanes.find((l) => l.lane === 'layout-vectors-device')!.producedOn).toEqual([]);
  });
});

describe('the Mac\'s vectors record and host labels', () => {
  it('round-trips the record and refuses another device, a bad stamp, no host or a malformed run', () => {
    const v = localOf();
    expect(parseVectorsRecord(vectorsRecordText(v), 'v.json')).toEqual(v);
    const bad = (x: unknown, msg: string): void => expect(() => parseVectorsRecord(JSON.stringify(x), 'v.json')).toThrow(msg);
    bad({ ...v, device: 'dragon-320' }, 'is not android/dragon-smoke');
    bad({ ...v, schema: 'x' }, 'schema "x"');
    bad({ ...v, producedOn: '' }, 'producedOn is not a host label');
    bad({ ...v, evidence: { ...v.evidence, laneCode: 'x' } }, 'evidence is not a stamp');
    bad({ ...v, vectors: { ...v.vectors, device: 'dragon-480' } }, 'vectors is not the dragon-smoke vectors run');
    bad({ ...v, vectors: { ...v.vectors, digests: null } }, 'vectors is not the dragon-smoke vectors run');
  });
  it('names a GitHub Actions run by runner and URL, and anything else as this machine', () => {
    expect(producerLabel({ GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', ImageOS: 'ubuntu24', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9' })).toBe('GitHub Actions Linux X64 (ubuntu24) run https://github.com/o/r/actions/runs/9');
    expect(producerLabel({}, 'darwin', 'arm64')).toBe('local darwin-arm64');
  });
});
