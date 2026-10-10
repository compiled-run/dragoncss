// CI device lanes (device-ci.ts): the pinned iOS runtime, the host's Android image, the CI memory reserve, and the merge of
// per-device outcomes, which refuses a missing, repeated or foreign outcome instead of merging a subset.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockedExit, TOOLING_EXIT, VERDICT_EXIT } from '../src/device-ci.ts';
import { afterRelease, BLOCK_REASONS, type BlockReason, runOneDevice } from '../src/device-lanes.ts';
import { MatrixMismatch } from '../src/device-run.ts';
import { caseDumpHashes, ciOutcomeText, type CiOutcome, compareWithCommitted, comparisonText, diffCaseHashes, mergeCiOutcomes, OUTCOME_SCHEMA, parseCaseHashes, parseCiOutcome, producerLabel, rawDumpHash } from '../src/device-ci.ts';
import { allRunFailures } from '../src/device-lanes.ts';
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

describe('a blocked device\'s exit: the tooling\'s (4) or a verdict (1), by an explicit reason', () => {
  it('maps every block reason to its exit code, and a mix or a block without reasons to a verdict', () => {
    const want: Record<BlockReason, number> = { boot: TOOLING_EXIT, stop: TOOLING_EXIT, 'install-transient': TOOLING_EXIT, 'matrix-mismatch': VERDICT_EXIT, 'device-record': VERDICT_EXIT };
    expect(Object.keys(BLOCK_REASONS).sort()).toEqual(Object.keys(want).sort());
    for (const [r, code] of Object.entries(want)) expect(blockedExit([r as BlockReason]), r).toBe(code);
    expect(blockedExit(['boot', 'stop'])).toBe(TOOLING_EXIT);
    // A tree defect is a verdict even when the stop failed too.
    expect(blockedExit(['device-record', 'stop'])).toBe(VERDICT_EXIT);
    expect(blockedExit([])).toBe(VERDICT_EXIT);
    expect(blockedExit(undefined)).toBe(VERDICT_EXIT);
  });
  it('a failed boot is the tooling\'s, a booted device that is not the matrix device the tree\'s; a failed stop adds its reason', async () => {
    const t = nativeTargets().find((x) => x.target === 'android')!;
    const spec = DEVICE_MATRIX.find((d) => d.name === 'dragon-480')!;
    const run = (e: Error) => runOneDevice(t, spec, null, 'app.apk', () => [], false, () => undefined, { boot: () => Promise.reject(e), release: null });
    expect((await run(new Error('emulator-5584 did not settle on the home screen within 300 s (tooling fault)'))).blockedBy).toEqual(['boot']);
    expect((await run(new MatrixMismatch('emulator-5584 booted but is not the matrix device: hw.lcd.density 420, not 480'))).blockedBy).toEqual(['matrix-mismatch']);
    const fit = { device: 'dragon-480', set: null, trust: null, vectors: null, blocked: 'device fit', blockedBy: ['device-record'] as BlockReason[] };
    expect(afterRelease(fit, 'still runs').blockedBy).toEqual(['device-record', 'stop']);
    expect(blockedExit(afterRelease(fit, 'still runs').blockedBy)).toBe(VERDICT_EXIT);
  });
  it('an outcome\'s reasons are checked: known reasons, present only on a blocked outcome', () => {
    const o = outcomeOf('ios', 'iPhone 17');
    expect(parseCiOutcome(ciOutcomeText({ ...o, outcome: { ...o.outcome, blockedBy: ['boot'] } }), 'f.json').outcome.blockedBy).toEqual(['boot']);
    const bad = (blockedBy: unknown, blocked: string | null = o.outcome.blocked): void => expect(() => parseCiOutcome(JSON.stringify({ ...o, outcome: { ...o.outcome, blocked, blockedBy } }), 'f.json')).toThrow('blockedBy is not the block reasons of a blocked outcome');
    bad(['flaky']);
    bad('boot');
    bad([]);
    bad(['__proto__']);
  });
});

describe('per-case dump hashes (raw equality across hosts)', () => {
  const dump = (model: string, x: number, ms: number): string => JSON.stringify({ case: 'c', device: { platform: 'android', os: 'Android 16', model, abi: model.includes('arm') ? 'arm64-v8a' : 'x86_64' }, nodes: [{ id: 'a', frame: [x, 0, 10, 10] }], timing: { ms } });
  it('ignores the device header and the timing, and nothing else', () => {
    expect(rawDumpHash(dump('emu arm', 1, 5))).toBe(rawDumpHash(dump('emu x86', 1, 9)));
    expect(rawDumpHash(dump('emu arm', 1, 5))).not.toBe(rawDumpHash(dump('emu arm', 2, 5)));
    // Text that is not a dump object is hashed as it is, never equal to a dump's hash.
    expect(rawDumpHash('{trunc')).toMatch(/^[0-9a-f]{64}$/);
    expect(rawDumpHash('[1]')).not.toBe(rawDumpHash('{"0":1}'));
  });
  it('hashes each case of a device run\'s set, states, hit and frame sample records at its DPR, and diffs two hosts case by case', () => {
    const root = mkdtempSync(join(tmpdir(), 'dragon-hashes-'));
    try {
      const lanes = join(root, 'lanes');
      mkdirSync(join(lanes, 'dragon-320'), { recursive: true });
      mkdirSync(join(lanes, 'dragon-320-states'), { recursive: true });
      writeFileSync(join(lanes, 'dragon-320', 'a@2.json'), dump('emu arm', 1, 5));
      writeFileSync(join(lanes, 'dragon-320', 'b@2.json'), dump('emu arm', 3, 5));
      writeFileSync(join(lanes, 'dragon-320', 'a@3.json'), dump('emu arm', 9, 5));
      writeFileSync(join(lanes, 'dragon-320', 'a@2.hit'), '0,0;1,1');
      writeFileSync(join(lanes, 'dragon-320-states', 's@2.json'), dump('emu arm', 4, 5));
      mkdirSync(join(lanes, 'dragon-320-anim'), { recursive: true });
      writeFileSync(join(lanes, 'dragon-320-anim', 'f@400x300~f0@2.json'), dump('emu arm', 6, 5));
      const h = caseDumpHashes('android', 'dragon-320', 2, root);
      expect(h).not.toBeNull();
      expect(Object.keys(h!.set)).toEqual(['a', 'b']);
      expect(Object.keys(h!.states)).toEqual(['s']);
      expect(Object.keys(h!.hits)).toEqual(['a']);
      expect(Object.keys(h!.anim)).toEqual(['f@400x300~f0']);
      expect(caseDumpHashes('android', 'dragon-320', null, root)).toBeNull();
      writeFileSync(join(lanes, 'dragon-320-states', '__proto__@2.json'), dump('emu arm', 4, 5));
      expect(() => caseDumpHashes('android', 'dragon-320', 2, root)).toThrow('"__proto__" is not a case id');
      rmSync(join(lanes, 'dragon-320-states', '__proto__@2.json'));
      expect(caseDumpHashes('android', 'dragon-480', 2, root)).toEqual({ dpr: 2, set: {}, states: {}, hits: {}, anim: {} });
      writeFileSync(join(lanes, 'dragon-320', 'b@2.json'), dump('emu x86', 3, 7));
      expect(diffCaseHashes(h!, caseDumpHashes('android', 'dragon-320', 2, root)!)).toEqual({ set: [], states: [], hits: [], anim: [] });
      writeFileSync(join(lanes, 'dragon-320', 'b@2.json'), dump('emu x86', 4, 7));
      rmSync(join(lanes, 'dragon-320-states', 's@2.json'));
      writeFileSync(join(lanes, 'dragon-320-anim', 'f@400x300~f0@2.json'), dump('emu arm', 7, 5));
      expect(diffCaseHashes(h!, caseDumpHashes('android', 'dragon-320', 2, root)!)).toEqual({ set: ['b'], states: ['s'], hits: [], anim: ['f@400x300~f0'] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('round-trips an outcome with its hashes, reads one without (older), and refuses malformed hashes', () => {
    const o = outcomeOf('ios', 'iPhone 17');
    const dumps = { dpr: 3, set: { a: 'a'.repeat(64) }, states: {}, hits: { a: 'b'.repeat(64) }, anim: { 'f@400x300~f0': 'c'.repeat(64) } };
    expect(parseCiOutcome(ciOutcomeText({ ...o, dumps }), 'f.json')).toEqual({ ...o, dumps });
    expect(parseCiOutcome(ciOutcomeText({ ...o, dumps: null }), 'f.json')).toEqual({ ...o, dumps: null });
    expect(parseCiOutcome(ciOutcomeText(o), 'f.json')).toEqual(o);
    const proto = JSON.parse(`{"dpr":3,"set":{"__proto__":"${'a'.repeat(64)}"},"states":{},"hits":{},"anim":{}}`) as unknown;
    for (const bad of [{ ...dumps, dpr: '3' }, { ...dumps, set: { a: 'zz' } }, { ...dumps, hits: [] }, { ...dumps, anim: [] }, { dpr: 3, set: {}, states: {}, hits: {} }, 'x', proto, { ...dumps, states: { constructor: 'a'.repeat(64) } }]) {
      expect(() => parseCaseHashes(bad, 'f.json')).toThrow('f.json: dumps is not a DPR and per-case sha256 maps of set, states, hits and anim');
      expect(() => parseCiOutcome(JSON.stringify({ ...o, dumps: bad }), 'f.json')).toThrow('dumps is not');
    }
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

describe('the merge job on a landing tree whose device lanes are "not run" (#132 review)', () => {
  it('merges, and only reports the difference from the tree\'s own records unless judging a run for review', () => {
    const targets = nativeTargets();
    const problems = checkLaneParity(targets, laneSources());
    // The landing tree after its regen: every device lane "not run", no failures listed.
    const notRun = lanesFile(targets, problems, new Map(), null);
    for (const t of notRun.targets) for (const l of t.lanes.filter((x) => x.where === 'device')) expect(l.state, `${t.target} ${l.lane}`).toBe('not run');
    // The workflow's merge step: every device's outcome, merged on top of that file.
    const runs = mergeCiOutcomes(all(), () => stamp('a'));
    const merged = lanesFile(targets, problems, new Map(), null, runs, notRun);
    const failures = (t: string): ReturnType<typeof allRunFailures> => allRunFailures(runs.get(t as 'ios' | 'android')!);
    const c = compareWithCommitted({ lanes: notRun, failures: () => [] }, { lanes: merged, failures });
    expect(c.same).toBe(false);
    expect(c.rows.find((r) => r.target === 'android' && r.lane === 'device-frames')).toMatchObject({ committed: expect.stringMatching(/^not run/), same: false });
    expect(comparisonText(c)).toContain('Some device lanes differ from the committed records.');
    // The same records compare equal, so a review run of an unchanged tree passes its --judge.
    expect(compareWithCommitted({ lanes: merged, failures }, { lanes: merged, failures }).same).toBe(true);
  });
});
