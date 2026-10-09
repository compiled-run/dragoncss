// ANIM-b1 3b (T065 R18): the device-anim lane on the host, with fake device dumps. Every frame sample is a case script that runs the
// frame script through its dump; a dump of the sample's own live program passes the applied and engine checks, a dump of the static
// end assignment (a device that does not animate) fails them mid-flight, and a missing one fails as missing. The host apps carry
// the samples as prefixes of one shared step table, and a native animation row needs every sample of its proving cases to pass.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emitStatePrograms, programAt } from 'dragon';
import { canonicalJsonText } from '../src/state-cases.ts';
import type { AnimSample } from '../src/anim-samples.ts';
import { allAnimCases, animEmits, animSampleId, animSampleIds, animSamples, animSamplesOf, scriptStepsOf } from '../src/anim-samples.ts';
import { frameScript, frameStateProgram } from '../src/anim-cases.ts';
import type { DeviceSet, LaneFailure } from '../src/device-lanes.ts';
import { ANIM_LANE, evaluateAnim } from '../src/device-lanes.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import type { DeviceRun } from '../src/lanes.ts';
import { lanesFile } from '../src/lanes.ts';
import { BACKEND_OF, relabelledReferenceDump } from '../src/native-host.ts';
import type { DeviceEvidence } from '../src/profile-rows.ts';
import { animDeviceBlocker, deriveAnimationRows } from '../src/profile-rows.ts';
import { nativeTargets } from '../src/targets.ts';

// Made in beforeAll: `vitest list` runs module scope but no hooks, so a module-scope folder would leak.
let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-anim-lanes-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

const DPR = 2;
const device = { name: 'fake', platform: 'ios', os: 'host', build: 'host', profileScale: DPR, appScale: DPR, windowPx: [0, 0], stagePx: [0, 0], rootOriginPx: [0, 0], textScale: 'none' } as unknown as DeviceRecord;
const samplesOf = (fixture: string): readonly AnimSample[] => {
  const xs = animSamples('ios').find((s) => s[0]?.case.fixture.id === fixture);
  if (xs === undefined) throw new Error(`no frame case of ${fixture}`);
  return xs;
};

/** A fake device dump of a sample, of the given program (the sample's own live program, or another). */
function write(at: string, s: AnimSample, program = s.program): void {
  const d = relabelledReferenceDump('ios', { id: s.id, fixture: s.case.fixture.id, direction: s.case.direction, compilerDigest: s.case.compiled.digest, viewport: s.case.viewport, program }, DPR);
  writeFileSync(join(at, `${s.id}@${DPR}.json`), JSON.stringify(d));
}

const kinds = (fs: readonly LaneFailure[], id: string): string[] => [...new Set(fs.filter((f) => f.case === id).map((f) => f.kind))].sort();

describe('the frame samples', () => {
  it('are one case script per dump of each frame script, named <case>~f<k>, each a prefix of the next, on both targets', () => {
    for (const target of ['ios', 'android'] as const) {
      const all = animSamples(target);
      expect(all.length).toBe(allAnimCases().length);
      all.forEach((xs, k) => {
        const c = allAnimCases()[k];
        if (c === undefined) throw new Error('no case');
        const steps = frameScript(c);
        expect(xs.map((s) => s.id)).toEqual(steps.filter((s) => s.kind === 'dump').map((_, i) => animSampleId(c.id, i)));
        xs.forEach((s, i) => {
          expect(s.steps[s.steps.length - 1]).toEqual({ kind: 'dump' });
          const next = xs[i + 1];
          if (next !== undefined) expect(next.steps.slice(0, s.steps.length)).toEqual(s.steps);
        });
        expect(xs[xs.length - 1]?.settle).toBe(true);
      });
      const ids = animSampleIds(target);
      expect(new Set(ids).size).toBe(ids.length);
      expect(animEmits(target).flatMap((e) => e.scripts.map((s) => s.id))).toEqual([...ids]);
    }
  });

  it('carry the backend\'s live program, and a still sample\'s is its assignment\'s static program (the settle rule)', () => {
    for (const target of ['ios', 'android'] as const) {
      for (const xs of animSamples(target)) {
        const c = xs[0]?.case;
        if (c === undefined) continue;
        const sp = frameStateProgram(c, BACKEND_OF[target]);
        for (const s of xs) if (s.still) expect(canonicalJsonText(s.program), s.id).toBe(canonicalJsonText(programAt(sp, s.assignment)));
      }
    }
    // A mid-flight sample of a running transition is not its assignment's static program.
    const moving = samplesOf('anim-color-all').filter((s) => !s.still);
    expect(moving.length).toBeGreaterThan(0);
  });

  it('refuses a state step that sets several states (the device raises one event per setter call)', () => {
    expect(() => scriptStepsOf('x', [{ kind: 'set', sets: [{ state: 'doc.a', value: true }, { state: 'doc.b', value: true }] }])).toThrow('a state step sets 2 states');
    expect(scriptStepsOf('x', [{ kind: 'set', sets: [{ state: 'doc.a', value: 1 }] }, { kind: 'advance', ms: 2 }, { kind: 'dump', at: 2, settle: false }])).toEqual([{ kind: 'set', state: 'doc.a', value: 1 }, { kind: 'advance', ms: 2 }, { kind: 'dump' }]);
  });

  it('are emitted as prefixes of one shared step table, Swift and Kotlin, with each sample\'s expected digests', () => {
    const c = allAnimCases().find((x) => x.fixture.id === 'anim-color-all');
    const e = animEmits('ios').find((x) => x.id === c?.id);
    if (c === undefined || e === undefined) throw new Error('no anim-color-all emit');
    const k = animEmits('ios').indexOf(e);
    const swift = emitStatePrograms('uikit', [e]).map((f) => f.text).join('\n');
    const kotlin = emitStatePrograms('android-views', [animEmits('android')[k] as (typeof e)]).map((f) => f.text).join('\n');
    expect(swift).toContain('private let dragonStates0Steps: [DragonScriptStep] = [');
    expect(kotlin).toContain('private val dragonStates0Steps: List<DragonScriptStep> = listOf(');
    e.scripts.forEach((sc, j) => {
      expect(swift).toContain(`let dragonStates0Script${j} = dragonStateScriptCase(id: "${sc.id}"`);
      expect(swift).toContain(`steps: Array(dragonStates0Steps.prefix(${sc.steps.length})))`);
      expect(kotlin).toContain(`dragonStates0Steps.take(${sc.steps.length}))`);
      for (const d of sc.expectedDigests) expect(swift).toContain(`"${d.sha256}"`);
    });
    // The state programs' own scripts (no animation tables) keep their literal step lists.
    const { anim: _tables, ...plain } = e;
    expect(emitStatePrograms('uikit', [plain]).map((f) => f.text).join('\n')).not.toContain('dragonStates0Steps');
  });
});

describe('device-anim on fake dumps', () => {
  const xs = samplesOf('anim-color-all');

  it('a dump of the sample\'s live program passes the applied and engine checks at every sample, under device-anim', () => {
    const at = join(dir, 'live');
    mkdirSync(at);
    for (const s of xs) write(at, s);
    const set = evaluateAnim('ios', DPR, at, device, [xs]);
    expect(set.cases).toBe(xs.length);
    expect(set.dumps).toBe(xs.length);
    expect(set.failures.every((f) => f.lane === ANIM_LANE)).toBe(true);
    for (const s of xs) for (const k of ['applied', 'expected-digest', 'frame-engine', 'native-class', 'dump-missing', 'frame-reference']) expect(kinds(set.failures, s.id), s.id).not.toContain(k);
  });

  it('a device that does not animate (the static end program at every sample) fails mid-flight; a missing dump fails as missing', () => {
    const at = join(dir, 'static');
    mkdirSync(at);
    const sp = frameStateProgram(xs[0]!.case, 'uikit');
    const [missing, ...rest] = xs;
    for (const s of rest) write(at, s, programAt(sp, s.assignment));
    const set = evaluateAnim('ios', DPR, at, device, [xs]);
    expect(kinds(set.failures, missing!.id)).toEqual(['dump-missing']);
    const moving = rest.filter((s) => !s.still);
    expect(moving.length).toBeGreaterThan(0);
    for (const s of moving) expect(kinds(set.failures, s.id).some((k) => k === 'applied' || k === 'expected-digest'), s.id).toBe(true);
    for (const s of rest.filter((x) => x.still)) for (const k of ['applied', 'expected-digest']) expect(kinds(set.failures, s.id), s.id).not.toContain(k);
  });

  it('a sample whose frame capture has no such sample fails with frame-reference, not as a pass', () => {
    const c = xs[0]!.case;
    const ghost: AnimSample = { ...xs[0]!, id: animSampleId(c.id, 9999), index: 9999 };
    const set = evaluateAnim('ios', DPR, join(dir, 'none'), device, [[ghost]]);
    expect(set.failures.map((f) => [f.lane, f.kind])).toEqual([[ANIM_LANE, 'frame-reference']]);
  });
});

describe('the device-anim lane record', () => {
  const t = nativeTargets().find((x) => x.target === 'ios');
  const n = animSampleIds('ios').length;
  const set = (dpr: number, failures: readonly LaneFailure[] = [], dumpCount = n): DeviceSet => ({ dpr, device: { ...device, name: `d${dpr}` } as DeviceRecord, cases: n, dumps: dumpCount, compared: { a: 0, b: 0, c: 0, d: 0, breaks: 0 }, dumpsSha256: '0', failures, faults: [] });
  const record = (anims: readonly DeviceSet[]) => {
    if (t === undefined) throw new Error('no ios target');
    const run: DeviceRun = { vectors: null, sets: [], states: [], hits: [], anims, trust: [], blocked: null, evidence: { laneCode: 'a', referenceData: 'b', app: 'c' } };
    return lanesFile([t], [], new Map(), null, new Map([['ios', run]])).targets[0]?.lanes.find((l) => l.lane === ANIM_LANE);
  };
  it('declares every frame sample at every device DPR', () => {
    expect(t?.lanes.find((l) => l.lane === ANIM_LANE)?.sets.map((s) => [s.dpr, s.ids.length])).toEqual([[2, n], [3, n]]);
  });
  it('passes with every sample dumped at every declared DPR and no failure; fails on a failure, a short set, or a DPR not run', () => {
    expect(record([set(2), set(3)])?.state).toBe('pass');
    const f: LaneFailure = { lane: ANIM_LANE, case: 'x', dpr: 2, node: null, kind: 'applied', detail: 'd' };
    expect(record([set(2, [f]), set(3)])?.state).toBe('fail');
    expect(record([set(2, [], n - 1), set(3)])?.reason).toContain(`DPR 2: ${n - 1}/${n} dumps`);
    expect(record([set(2)])?.reason).toContain('DPR 3 was not run');
  });
});

describe('native animation rows (R18)', () => {
  const c = allAnimCases()[0]!;
  const ids = animSamplesOf(c, 'uikit').map((s) => s.id);
  const passing = [{ id: c.id, features: ['transition-duration:<time>'], samples: { ios: ids } }];
  const ev = (cases: readonly string[], failing: readonly string[] = [], unavailable: string | null = null): DeviceEvidence => ({ target: 'ios', unavailable, lanes: [{ lane: ANIM_LANE, perCase: true, passed: failing.length === 0, cases: new Set(cases), failing: new Set(failing) }] });
  it('are exact through device-anim when every sample of a proving case passes at every DPR', () => {
    expect(animDeviceBlocker(ev(ids), ids)).toBeNull();
    expect(deriveAnimationRows('ios', passing, ev(ids))).toEqual([{ feature: 'transition-duration:<time>', context: 'animation', status: 'exact', proofs: [{ aspect: 'computed-value', lane: 'device-anim', valueSubset: '<time>', context: 'animation', cases: [c.id] }] }]);
  });
  it('are absent when a sample fails, was not run, the evidence is unavailable, or there is no evidence', () => {
    expect(animDeviceBlocker(ev(ids, [ids[1]!]), ids)).toBe(`${ids[1]} fails ios device-anim`);
    expect(animDeviceBlocker(ev(ids.slice(1)), ids)).toBe(`${ids[0]} is not run by ios device-anim at every DPR`);
    expect(animDeviceBlocker(ev(ids, [], 'lanes.json is stale'), ids)).toBe('lanes.json is stale');
    expect(animDeviceBlocker(ev(ids), [])).toBe('no frame samples');
    expect(deriveAnimationRows('ios', passing, ev(ids, [ids[0]!]))).toEqual([]);
    expect(deriveAnimationRows('ios', passing, null)).toEqual([]);
    expect(deriveAnimationRows('android', passing, { ...ev(ids), target: 'android' })).toEqual([]);
  });
});
