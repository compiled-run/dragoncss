// A device's run split into parts across CI jobs (device-ci.ts one --parts, combine): the parts a device has, the part files, and
// the combined outcome, which must be the one a single run of every part writes, byte for byte, down to the merged lane records.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CaseDumpHashes, CiOutcome, PartOutcome } from '../src/device-ci.ts';
import { ciOutcomeText, combineParts, mergeCiOutcomes, OUTCOME_SCHEMA, PART_SCHEMA, parseCiOutcome, parseParts, parsePartOutcome, partOutcomeText, partsOf } from '../src/device-ci.ts';
import type { DeviceEvidence } from '../src/device-evidence.ts';
import type { DeviceOutcome, DevicePart, DeviceSet, LaneFailure } from '../src/device-lanes.ts';
import { deviceFailuresText, DEVICE_PARTS, runOneDevice } from '../src/device-lanes.ts';
import type { DeviceSpec } from '../src/device-run.ts';
import { DEVICE_MATRIX, launchLimitMs, VECTOR_DEVICES } from '../src/device-run.ts';
import { animSamples } from '../src/anim-samples.ts';
import { repoPath } from '../src/paths.ts';
import { nativeTargets } from '../src/targets.ts';

const stamp = (c: string): DeviceEvidence => ({ laneCode: c.repeat(64), referenceData: 'b'.repeat(64), app: 'c'.repeat(64) });
const CI = 'GitHub Actions Linux X64 (ubuntu24) run https://github.com/o/r/actions/runs/1';
const spec = (name: string): DeviceSpec => DEVICE_MATRIX.find((d) => d.name === name)!;

const set = (d: DeviceSpec, lane: LaneFailure['lane'], dpr: number, n: number): DeviceSet => ({
  dpr,
  device: { name: d.name, target: d.target, model: d.name, os: 'os', build: 'b', profileScale: dpr, appScale: dpr, windowPx: [10, 20], stagePx: [10, 18], rootOriginPx: [0, 2], textScale: 'L' },
  cases: n,
  dumps: n - 1,
  compared: { a: n, b: 2 * n, c: 3 * n, d: 4 * n, breaks: 5 },
  dumpsSha256: `${lane}-${d.name}`,
  failures: [{ lane, case: `c-${lane}`, dpr, node: null, kind: 'pixel', detail: `${lane} on ${d.name}` }],
  faults: [],
});
const vectorsRun = (device: string) => ({ device, state: 'pass' as const, reason: null, toolchain: 't', suites: [], digests: { p1: 'p', extended: 'x' } });
const hex = (c: string): string => c.repeat(64);

/** A device's whole run (every part in one job), as runOneDevice returns it, with the hashes device-ci.ts one reads beside it. */
function whole(d: DeviceSpec): { outcome: DeviceOutcome; dumps: CaseDumpHashes } {
  const dpr = d.target === 'ios' ? 3 : 2;
  const outcome: DeviceOutcome = {
    device: d.name,
    set: set(d, 'device-pixels', dpr, 9),
    states: set(d, 'device-states', dpr, 4),
    hits: set(d, 'device-hit', dpr, 7),
    anim: set(d, 'device-anim', dpr, 6),
    traces: set(d, 'device-traces', dpr, 2),
    trust: { device: d.name, dpr, rows: [{ case: 'trust', points: 3, mismatches: [] }] },
    vectors: VECTOR_DEVICES[d.target] === d.name ? vectorsRun(d.name) : null,
    blocked: null,
  };
  return { outcome, dumps: { dpr, set: { a: hex('1') }, states: { s: hex('2') }, hits: { a: hex('3') }, anim: { f: hex('4') } } };
}

/** The part file a job running `parts` of the device writes: runOneDevice leaves the other parts null, and the hashes read only its own directories. */
function partFile(d: DeviceSpec, parts: readonly DevicePart[], evidence = stamp('a')): PartOutcome {
  const w = whole(d);
  const has = (p: DevicePart): boolean => parts.includes(p);
  const o = w.outcome;
  const outcome: DeviceOutcome = { device: d.name, set: has('cases') ? o.set : null, states: has('cases') ? o.states! : null, hits: has('cases') ? o.hits! : null, anim: has('anim') ? o.anim! : null, traces: has('cases') ? o.traces! : null, trust: has('cases') ? o.trust : null, vectors: has('vectors') ? o.vectors : null, blocked: null };
  const dpr = outcome.set?.dpr ?? outcome.anim?.dpr ?? null;
  const dumps = dpr === null ? null : { dpr, set: has('cases') ? w.dumps.set : {}, states: has('cases') ? w.dumps.states : {}, hits: has('cases') ? w.dumps.hits : {}, anim: has('anim') ? w.dumps.anim : {} };
  return { schema: PART_SCHEMA, target: d.target, device: d.name, parts, evidence, producedOn: CI, outcome, dumps };
}

const wholeFile = (d: DeviceSpec): CiOutcome => ({ schema: OUTCOME_SCHEMA, target: d.target, device: d.name, evidence: stamp('a'), producedOn: CI, ...whole(d) });
/** Every part of every device in its own job. */
const split = (): PartOutcome[] => DEVICE_MATRIX.flatMap((d) => partsOf(d).map((p) => partFile(d, [p])));
/** The files, written and read back as the merge job reads them. */
const roundTrip = (fs: readonly PartOutcome[]): PartOutcome[] => fs.map((f, i) => parsePartOutcome(partOutcomeText(f), `p${i}.json`));

describe('the parts of a device\'s run', () => {
  it('are cases and anim on every device, and vectors on its target\'s vectors device only', () => {
    for (const d of DEVICE_MATRIX) expect(partsOf(d), d.name).toEqual(VECTOR_DEVICES[d.target] === d.name ? ['cases', 'anim', 'vectors'] : ['cases', 'anim']);
    expect(DEVICE_PARTS).toEqual(['cases', 'anim', 'vectors']);
  });
  it('are parsed from a --parts list in their own order, refusing an unknown part, a repeat, none, or vectors off the vectors device', () => {
    expect(parseParts(['anim', 'cases'], spec('iPad (A16)'))).toEqual(['cases', 'anim']);
    expect(parseParts(['vectors'], spec('dragon-smoke'))).toEqual(['vectors']);
    expect(() => parseParts(['vectors'], spec('dragon-320'))).toThrow('"vectors" is not a part of dragon-320 (cases, anim)');
    expect(() => parseParts(['cases', 'cases'], spec('dragon-320'))).toThrow('a part is named twice');
    expect(() => parseParts(['plant'], spec('iPhone 17'))).toThrow('"plant" is not a part of iPhone 17');
    expect(() => parseParts([''], spec('iPhone 17'))).toThrow('"" is not a part');
    expect(() => parseParts([], spec('iPhone 17'))).toThrow('no part');
  });
  it('run alone, are blocked by a failed boot as a whole run is, naming the boot', async () => {
    const t = nativeTargets().find((x) => x.target === 'android')!;
    for (const parts of [['vectors'], ['anim'], ['cases']] as const) {
      const o = await runOneDevice(t, spec('dragon-smoke'), null, '', () => [], true, () => undefined, { boot: () => Promise.reject(new Error('emulator-5582 did not settle (tooling fault)')), release: null }, new Set(parts));
      expect(o, parts.join()).toEqual({ device: 'dragon-smoke', set: null, trust: null, vectors: null, blocked: 'emulator-5582 did not settle (tooling fault)', blockedBy: ['boot'] });
    }
  });
});

describe('part files', () => {
  it('round-trip, and a whole outcome file is never read as a part (nor a part as a whole outcome)', () => {
    const f = partFile(spec('dragon-smoke'), ['anim']);
    expect(parsePartOutcome(partOutcomeText(f), 'p.json')).toEqual(f);
    expect(() => parsePartOutcome(ciOutcomeText(wholeFile(spec('dragon-smoke'))), 'w.json')).toThrow('w.json: schema "dragon.device-outcome/2", not dragon.device-part/1');
    expect(() => parseCiOutcome(partOutcomeText(f), 'p.json')).toThrow('p.json: schema "dragon.device-part/1", not dragon.device-outcome/2');
  });
  it('refuse a file whose outcome holds a part it does not name, or misses one it names, and malformed fields', () => {
    const f = partFile(spec('dragon-320'), ['cases']);
    const bad = (v: unknown, msg: string): void => expect(() => parsePartOutcome(JSON.stringify(v), 'p.json')).toThrow(msg);
    bad({ ...f, outcome: { ...f.outcome, anim: whole(spec('dragon-320')).outcome.anim } }, 'does not hold exactly the parts cases: anim present');
    bad({ ...f, outcome: { ...f.outcome, traces: null } }, 'traces missing');
    bad({ ...f, parts: ['anim', 'cases'] }, 'are not in the order cases, anim, vectors');
    bad({ ...f, parts: ['vectors'] }, '"vectors" is not a part of dragon-320');
    bad({ ...f, parts: 'cases' }, 'parts is not a list of part names');
    bad({ ...f, device: 'dragon-999' }, '"dragon-999" is not a android matrix device');
    bad({ ...f, evidence: { ...f.evidence, app: 'x' } }, 'evidence is not a stamp');
    bad({ ...f, dumps: undefined }, 'no dumps');
    bad({ ...f, outcome: { ...f.outcome, set: { ...f.outcome.set, device: { name: 'other' } } } }, 'set.device is not this device');
    expect(() => parsePartOutcome('{', 'p.json')).toThrow('p.json: not JSON');
    // A part without the batch set is not blocked for that: the anim part and the vectors part hold none.
    expect(parsePartOutcome(partOutcomeText(partFile(spec('dragon-smoke'), ['vectors'])), 'v.json').outcome.set).toBeNull();
  });
});

describe('combining the parts', () => {
  it('gives each device the outcome a single run of every part writes, byte for byte, in matrix order', () => {
    const combined = combineParts(roundTrip([...split()].reverse()));
    expect(combined.map((o) => o.device)).toEqual(DEVICE_MATRIX.map((d) => d.name));
    for (const [i, d] of DEVICE_MATRIX.entries()) expect(ciOutcomeText(combined[i]!), d.name).toBe(ciOutcomeText(wholeFile(d)));
    // The workflow's iOS split (cases and anim in one job, the iPhone's vectors in another) and a whole run as one part file.
    const ios = DEVICE_MATRIX.flatMap((d) => (d.target === 'ios' ? [partFile(d, ['cases', 'anim']), ...(VECTOR_DEVICES.ios === d.name ? [partFile(d, ['vectors'])] : [])] : [partFile(d, partsOf(d))]));
    expect(combineParts(roundTrip(ios)).map(ciOutcomeText)).toEqual(DEVICE_MATRIX.map((d) => ciOutcomeText(wholeFile(d))));
  });
  it('merges into the same lane runs and failure lists as the whole runs', () => {
    const fromParts = mergeCiOutcomes(combineParts(roundTrip(split())).map((o) => parseCiOutcome(ciOutcomeText(o), `${o.device}.json`)), () => stamp('a'));
    const fromWhole = mergeCiOutcomes(DEVICE_MATRIX.map((d) => parseCiOutcome(ciOutcomeText(wholeFile(d)), `${d.name}.json`)), () => stamp('a'));
    expect(fromParts).toEqual(fromWhole);
    for (const t of ['ios', 'android'] as const) expect(deviceFailuresText(fromParts.get(t)!)).toBe(deviceFailuresText(fromWhole.get(t)!));
  });
  it('refuses a missing, repeated or foreign-stamped part, or parts at two DPRs, naming each; nothing is combined from a subset', () => {
    const fs = split().filter((f) => !(f.device === 'dragon-480' && f.parts.includes('anim')));
    fs.push(partFile(spec('iPhone 17'), ['vectors']));
    fs[fs.findIndex((f) => f.device === 'dragon-320' && f.parts.includes('anim'))] = partFile(spec('dragon-320'), ['anim'], stamp('d'));
    expect(() => combineParts(fs)).toThrow(/ios\/iPhone 17 vectors: two outcomes\n {2}android\/dragon-320: the parts cases and anim have evidence laneCode aaaaaaaaaaaa and dddddddddddd\n {2}android\/dragon-480 anim: no outcome/);
    const anim = partFile(spec('dragon-smoke'), ['anim']);
    const atThree = { ...anim, outcome: { ...anim.outcome, anim: { ...anim.outcome.anim!, dpr: 3 } }, dumps: { ...anim.dumps!, dpr: 3 } };
    expect(() => combineParts([...split().filter((f) => !(f.device === 'dragon-smoke' && f.parts.includes('anim'))), atThree])).toThrow('android/dragon-smoke: the cases part ran at DPR 2, the anim part at 3');
  });
  it('blocks a device any part was blocked on, with each blocked part\'s reason, and keeps a part\'s missing hashes missing', () => {
    const fs = split().map((f) => (f.device === 'dragon-smoke' && f.parts.includes('vectors') ? { ...f, outcome: { device: f.device, set: null, trust: null, vectors: null, blocked: 'emulator did not settle', blockedBy: ['boot' as const] }, dumps: null } : f));
    const smoke = combineParts(fs).find((o) => o.device === 'dragon-smoke')!;
    expect(smoke.outcome).toEqual({ device: 'dragon-smoke', set: null, trust: null, vectors: null, blocked: 'emulator did not settle', blockedBy: ['boot'] });
    expect(smoke.dumps).toBeNull();
    expect(parseCiOutcome(ciOutcomeText(smoke), 's.json').outcome.blockedBy).toEqual(['boot']);
    const noHashes = split().map((f) => (f.device === 'iPad (A16)' && f.parts.includes('anim') ? { ...f, dumps: null } : f));
    expect(combineParts(noHashes).find((o) => o.device === 'iPad (A16)')!.dumps).toBeNull();
  });
});

describe('device-lanes.yml runs every part of every device exactly once', () => {
  const yml = readFileSync(repoPath('.github/workflows/device-lanes.yml'), 'utf8');
  const jobOf = (target: string, next: string): string => yml.slice(yml.indexOf(`\n  ${target}:\n`), yml.indexOf(`\n  ${next}:\n`));
  it('in its matrices, each job naming its parts on the Device run', () => {
    const seen: string[] = [];
    for (const [target, next] of [['ios', 'android'], ['android', 'merge']] as const) {
      const job = jobOf(target, next);
      const list = /include: \$\{\{ fromJSON\(inputs\.plant && '[^']*' \|\| '([^']*)'\) \}\}/.exec(job)?.[1];
      expect(list, target).toBeDefined();
      for (const row of JSON.parse(list!) as { device: string; parts: string }[]) {
        const d = DEVICE_MATRIX.find((x) => x.target === target && x.name === row.device);
        expect(d, `${target} ${row.device}`).toBeDefined();
        for (const p of parseParts(row.parts.split(','), d!)) seen.push(`${target}/${row.device} ${p}`);
      }
      expect(job, target).toContain(`device-ci.ts one ${target} "$DEVICE" "$RUNNER_TEMP/out/${target}-$slug.json" --parts "$PARTS"`);
      expect(job, target).toContain('PARTS: ${{ matrix.parts }}');
      expect(job, target).toContain(`name: outcome-${target}-\${{ strategy.job-index }}`);
    }
    expect([...seen].sort()).toEqual(DEVICE_MATRIX.flatMap((d) => partsOf(d).map((p) => `${d.target}/${d.name} ${p}`)).sort());
  });
  it('with a job limit above setup, build and boot plus the longest launch of any part, so a hung case is a launch verdict', () => {
    // The frame samples are the longest launch (the batch launch holds fewer cases); 20 minutes covers setup, build and boot.
    const longest = Math.max(...(['ios', 'android'] as const).map((t) => launchLimitMs(animSamples(t).reduce((n, xs) => n + xs.length, 0))));
    for (const [target, next] of [['ios', 'android'], ['android', 'merge']] as const) {
      const minutes = Number(/\n {4}timeout-minutes: (\d+)\n/.exec(jobOf(target, next))?.[1]);
      expect(minutes * 60_000, target).toBeGreaterThanOrEqual(20 * 60_000 + longest);
    }
  });
  it('and the merge job combines them before it uploads device-outcomes and merges', () => {
    const merge = yml.slice(yml.indexOf('\n  merge:\n'));
    const combine = merge.indexOf('device-ci.ts combine "$RUNNER_TEMP/parts" "$RUNNER_TEMP/outcomes"');
    expect(merge).toContain('path: ${{ runner.temp }}/parts\n');
    expect(combine).toBeGreaterThan(0);
    expect(combine).toBeLessThan(merge.indexOf('name: device-outcomes'));
    expect(combine).toBeLessThan(merge.indexOf('device-ci.ts merge'));
  });
});
