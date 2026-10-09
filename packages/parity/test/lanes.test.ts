// parity:lanes (native-strategy.md 3.6; T009 P3 items 2, 3 and 9): both native targets have the same six lanes, case lists derived
// from the constants, imported tolerances, the same sample rules and dump faults and one projection; each planted lane fault is
// caught with its own message; lane states are honest; and the committed out/lanes.json matches the configuration.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { iosLayoutProjection, nativeLayoutProjection } from 'dragon';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX } from '../src/compare.ts';
import { atDpr, DPRS, EXTRA_DPRS, layoutCases, SHARED_DPRS } from '../src/dpr.ts';
import { declaredLayoutCaseCount, groupFixtures, MILESTONE_1_LAYOUT_CASES } from '../src/case-count.ts';
import type { HostRun, KotlinLookup, LaneFault } from '../src/lanes.ts';
import { checkLaneParity, DEVICE_NOT_RUN, judgeHost, LANE_FAULTS, LANE_FILES, lanesFile, lanesJsonText, laneSources, notPassed, parseNativeOutput, plantLaneFault, readLanesFile, runHostLane, staleLanes, toleranceLiterals } from '../src/lanes.ts';
import { HIT_LANE, scriptCases, STATE_LANE } from '../src/device-lanes.ts';
import { hitCases, hitRefusedCases } from '../src/hit-capture.ts';
import { INLINE_OUT, INLINE_REASON, STACKING_OUT, STACKING_REASON, TRANSFORM_REASON } from './hit-refusals.ts';
import { RADIUS_OUT, RADIUS_REASON } from './hit-refusals-radius.ts';
import { DUMP_FAULTS } from '../src/native-compare.ts';
import { repoPath } from '../src/paths.ts';
import { enforcedCompile } from '../src/pipeline.ts';
import { SAMPLE_RULES } from '../src/samples.ts';
import type { NativeTarget, TargetConfig } from '../src/targets.ts';
import { corpusSuites, declaredSuites, extendedManifest, hitCaseIds, LANES, layoutCaseIds, m1CaseIds, nativeTargets, p1Manifest } from '../src/targets.ts';

const targets = nativeTargets();
const sources = laneSources();
const ios = targets.find((t) => t.target === 'ios') as TargetConfig;
const android = targets.find((t) => t.target === 'android') as TargetConfig;
const lane = (t: TargetConfig, id: string) => t.lanes.find((l) => l.lane === id);
const ids = layoutCaseIds();
let hitCount: number | null = null;
/** The cases device-hit runs: hit-capture.ts hitCases, every layout case the hit lane does not refuse. */
const hitCaseCount = (): number => (hitCount ??= hitCases().length);
const stateCaseCount = (name: string): number => {
  const t = targets.find((x) => x.target === name);
  if (t === undefined) throw new Error(`no native target ${name}`);
  return scriptCases(t.target).length;
};

describe('native targets', () => {
  it('ios and android, each with the eight lanes in order', () => {
    expect(targets.map((t) => t.target)).toEqual(['ios', 'android']);
    // SELD-R1b appends device-states and device-hit after the six P5 lanes.
    expect(LANES).toEqual(['layout-vectors-host', 'layout-vectors-device', 'device-frames', 'device-applied', 'device-lines', 'device-pixels', 'device-states', 'device-hit']);
    for (const t of targets) expect(t.lanes.map((l) => l.lane)).toEqual([...LANES]);
  });
  it('case lists come from the constants: the declared top-level cases plus one set per DPR on both vectors lanes of both targets', () => {
    expect(ids).toEqual(layoutCases().flatMap((f) => f.cases.map((c) => c.id)));
    for (const t of targets) {
      for (const l of ['layout-vectors-host', 'layout-vectors-device']) {
        const v = lane(t, l);
        expect(v?.sets.map((s) => [s.dpr, s.role, s.extra, s.ids.length])).toEqual([[1, 'top-level', null, ids.length], ...DPRS.map((d) => [d, SHARED_DPRS.includes(d) ? 'shared' : 'extra', EXTRA_DPRS.find((e) => e.dpr === d)?.name ?? null, ids.length])]);
        expect(v?.sets.reduce((n, s) => n + s.ids.length, 0)).toBe(declaredLayoutCaseCount() * (1 + DPRS.length));
        expect(v?.corpora).toEqual(corpusSuites());
      }
    }
    expect(ids.length).toBe(declaredLayoutCaseCount());
    expect(declaredLayoutCaseCount(groupFixtures('milestone-1'))).toBe(MILESTONE_1_LAYOUT_CASES);
    expect(ids.length).toBeGreaterThanOrEqual(MILESTONE_1_LAYOUT_CASES);
    expect(lane(ios, 'layout-vectors-host')).toEqual(lane(android, 'layout-vectors-host'));
  });
  it('the corpus counts are derived from the manifests and agree with their declared case counts', () => {
    const suites = declaredSuites(lane(ios, 'layout-vectors-host') as NonNullable<ReturnType<typeof lane>>);
    const p1 = p1Manifest();
    const x = extendedManifest();
    expect(Object.fromEntries(suites.filter((s) => s.corpus === 'p1').map((s) => [s.suite, s.cases]))).toEqual(p1.cases);
    // Every suite in the lock is declared with the lock's count, including the V1 value-model suites (notes/T006).
    expect(Object.fromEntries(suites.filter((s) => s.corpus === 'extended').map((s) => [s.suite, s.cases]))).toEqual(x.cases);
    expect(suites.find((s) => s.suite === 'vectors')?.cases).toBe(m1CaseIds().length);
  });
  it('device lanes: the shared DPRs on both, 2.625 only on android and only through EXTRA_DPRS', () => {
    expect(ios.dprs).toEqual(SHARED_DPRS);
    expect(android.dprs).toEqual([...SHARED_DPRS, ...EXTRA_DPRS.filter((e) => e.platform === 'android').map((e) => e.dpr)]);
    for (const l of ['device-frames', 'device-applied', 'device-lines', 'device-pixels']) {
      const a = lane(ios, l);
      const b = lane(android, l);
      expect(a?.sets.map((s) => [s.dpr, s.ids.length])).toEqual(SHARED_DPRS.map((d) => [d, ids.length]));
      expect(b?.sets.filter((s) => s.role === 'shared')).toEqual(a?.sets);
      expect(b?.sets.filter((s) => s.role === 'extra').map((s) => [s.dpr, s.extra])).toEqual(EXTRA_DPRS.map((e) => [e.dpr, e.name]));
    }
    for (const f of LANE_FILES) {
      const text = readFileSync(repoPath(f), 'utf8');
      expect(text, f).not.toMatch(/\b2\.625\b|\b1044\b|\b783\b|\b261\b|\b258\b/);
    }
  });
  it('tolerances, sample rules and dump faults are the imported constants, the same objects on both targets', () => {
    for (const t of targets) {
      expect(t.tolerances).toEqual({ gateDevicePx: GATE_DEVICE_PX, channelDelta: GATE_CHANNEL_DELTA });
      expect(t.sampleRules).toBe(SAMPLE_RULES);
      expect(t.plantedFaults).toBe(DUMP_FAULTS);
    }
    const text = readFileSync(repoPath('packages/parity/src/targets.ts'), 'utf8');
    expect(text).toMatch(/import \{ GATE_CHANNEL_DELTA, GATE_DEVICE_PX \} from '\.\/compare\.ts';/);
    expect(text).toContain('tolerances: { gateDevicePx: GATE_DEVICE_PX, channelDelta: GATE_CHANNEL_DELTA },');
  });
  it('both targets bind the same nativeLayoutProjection', () => {
    expect(ios.projection).toBe(nativeLayoutProjection);
    expect(android.projection).toBe(nativeLayoutProjection);
    expect(ios.projection).toBe(android.projection);
  });
  // One test per fixture, so the corpus's compiles are spread over tests rather than held to one test's timeout.
  describe('iosLayoutProjection output deep-equals nativeLayoutProjection output for every case, at DPR 1 and every DPR', () => {
    it('the fixture tests below cover every case at DPR 1 and every DPR', () => {
      expect(layoutCases().reduce((n, f) => n + f.cases.length * (1 + DPRS.length), 0)).toBe(ids.length * (1 + DPRS.length));
    });
    it.each(layoutCases().map((f) => [f.spec.id, f] as const))('%s', (_id, f) => {
      for (const c of f.cases) {
        const comp = enforcedCompile(f.spec, c.environment.direction);
        for (const dpr of [1, ...DPRS]) {
          const env = atDpr(c.environment, dpr);
          const native = nativeLayoutProjection(comp, env, c.assignment);
          expect(native.kind, c.id).toBe('ready');
          expect(iosLayoutProjection(comp, env, c.assignment)).toEqual(native);
        }
      }
    });
  });
});

describe('lane parity check', () => {
  it('passes on the configuration, with no tolerance literal in lane code', () => {
    expect(toleranceLiterals(sources)).toEqual([]);
    expect(checkLaneParity(targets, sources)).toEqual([]);
  });
  it('the literal scan catches a numeric gate, a tolerance comparison and an absolute-difference comparison', () => {
    const scan = (text: string): string[] => toleranceLiterals([{ path: 'x.ts', text }]);
    expect(scan('const gate = 2;')).toHaveLength(1);
    expect(scan('  tolerances: { gateDevicePx: 2, channelDelta: GATE_CHANNEL_DELTA },')).toHaveLength(1);
    expect(scan('if (channelDelta <= 1) ok();')).toHaveLength(1);
    expect(scan('const pass = Math.abs(d) * dpr <= 1;')).toHaveLength(1);
    expect(scan('const pass = Math.abs(d) * dpr <= GATE_DEVICE_PX;')).toEqual([]);
  });
  const messages: Record<LaneFault, RegExp> = {
    'missing-lane': /^android lacks lane device-pixels \(missing lane\)$/,
    'dropped-case': /^android device-frames: drops 1 declared case\(s\) at DPR 2: /,
    'tolerance-literal-2': /^android tolerance gateDevicePx 2 is not the imported GATE_DEVICE_PX 1$/,
    'unnamed-extra-dpr': /^android device-frames: DPR 1\.5 is neither shared \(2, 3\) nor an extra named in EXTRA_DPRS \(unnamed extra DPR\)$/,
  };
  it.each([...LANE_FAULTS])('planted %s is caught with its own message', (fault) => {
    const planted = plantLaneFault(fault, targets, sources);
    const problems = checkLaneParity(planted.targets, planted.sources);
    expect(problems[0]).toMatch(messages[fault]);
    for (const other of LANE_FAULTS) if (other !== fault) expect(problems.some((p) => messages[other].test(p)), `${fault} vs ${other}`).toBe(false);
    if (fault === 'tolerance-literal-2') expect(problems).toContainEqual(expect.stringMatching(/^packages\/parity\/src\/targets\.ts:\d+: numeric tolerance literal: tolerances: \{ gateDevicePx: 2,/));
    expect(checkLaneParity(targets, sources)).toEqual([]);
  });
});

describe('lane states', () => {
  const notFound: KotlinLookup = { javaHomeEnv: null, javaHomeCommand: '/nonexistent/java_home', jdkHomes: [], kotlincs: [] };
  it('with the Kotlin lookup injected as not found, android layout-vectors-host is blocked (owner tooling), never pass, and --require-all fails', async () => {
    const run = await runHostLane(android, { kotlinLookup: notFound, requireNative: false });
    expect(run.state).toBe('blocked (owner tooling)');
    expect(run.suites.every((s) => s.total === null && s.pass === null)).toBe(true);
    const f = lanesFile(targets, [], new Map<NativeTarget, HostRun>([['android', run]]), null);
    const host = f.targets.find((t) => t.target === 'android')?.lanes.find((l) => l.lane === 'layout-vectors-host');
    expect(host?.state).toBe('blocked (owner tooling)');
    expect(notPassed(f)).toContainEqual(expect.stringMatching(/^android layout-vectors-host: blocked \(owner tooling\)/));
    expect(notPassed(f).length).toBe(2 * LANES.length);
  });
  it('with DRAGON_REQUIRE_NATIVE=1 (or requireNative), a missing Kotlin toolchain fails the host lane, naming it, instead of reading blocked', async () => {
    await expect(runHostLane(android, { kotlinLookup: notFound, requireNative: true })).rejects.toThrow(/^DRAGON_REQUIRE_NATIVE=1 and native:kotlin has no toolchain: no JDK 17\+ or kotlinc was found/);
    vi.stubEnv('DRAGON_REQUIRE_NATIVE', '1');
    try {
      await expect(runHostLane(android, { kotlinLookup: notFound })).rejects.toThrow(/native:kotlin has no toolchain/);
      vi.stubEnv('DRAGON_REQUIRE_NATIVE', undefined);
      expect((await runHostLane(android, { kotlinLookup: notFound })).state).toBe('blocked (owner tooling)');
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('device lanes are not run (never pass, never blocked) until P5', () => {
    const f = lanesFile(targets, [], new Map(), null);
    for (const t of f.targets) for (const l of t.lanes.filter((x) => x.where === 'device')) expect([l.state, l.reason]).toEqual(['not run', DEVICE_NOT_RUN]);
  });
  it('the host verdict: pass only with every declared count and both digests; a dropped suite line or a wrong digest fails', () => {
    const p1 = p1Manifest().digest;
    const x = extendedManifest().digest;
    const suites = declaredSuites(lane(ios, 'layout-vectors-host') as NonNullable<ReturnType<typeof lane>>);
    const label = (s: string): string => (s === 'engine' ? 'engine corpus' : s === 'library' ? 'library corpus' : s);
    const text = (drop: string | null, digest: string): string => [
      'native:swift: Swift version 6.4',
      ...suites.filter((s) => s.corpus === 'p1' && s.suite !== drop).map((s) => `${label(s.suite)} ${s.cases}/${s.cases}`),
      'extended corpus:',
      ...suites.filter((s) => s.corpus === 'extended' && s.suite !== drop).map((s) => `${s.suite} ${s.cases}/${s.cases}`),
      `native:swift: P1 corpus digest ${digest}; extended corpus digest ${x}; status pass`,
    ].join('\n');
    expect(judgeHost(ios, parseNativeOutput(text(null, p1)))).toMatchObject({ state: 'pass', reason: null, toolchain: 'Swift version 6.4' });
    expect(judgeHost(ios, parseNativeOutput(text('snap', p1)))).toMatchObject({ state: 'fail', reason: expect.stringContaining('extended/snap -/-, declared') });
    // Every declared suite is parsed and judged (the V1 suites and any later one): a dropped suite line fails the host lane.
    // PIN-DERIVE: the suites come from the manifest, not a list each new suite edits.
    expect(suites.filter((s) => s.corpus === 'extended').map((s) => s.suite)).toEqual(expect.arrayContaining(['snap-values', 'calc-goldens', 'engine-calc', 'units-calc']));
    for (const s of suites) {
      expect(judgeHost(ios, parseNativeOutput(text(s.suite, p1))), s.suite).toMatchObject({ state: 'fail', reason: expect.stringContaining(`${s.corpus}/${s.suite} -/-, declared`) });
    }
    // The ANIM-a2 rt suite is parsed and judged too: a dropped rt line fails the host lane.
    expect(judgeHost(ios, parseNativeOutput(text('rt', p1)))).toMatchObject({ state: 'fail', reason: expect.stringContaining('p1/rt -/-, declared') });
    expect(judgeHost(ios, parseNativeOutput(text(null, '0'.repeat(64))))).toMatchObject({ state: 'fail', reason: expect.stringContaining('P1 corpus digest') });
    expect(judgeHost(ios, parseNativeOutput('native:swift: generated files are stale'))).toMatchObject({ state: 'fail' });
  });
});

describe('committed out/lanes.json', () => {
  const f = readLanesFile();
  it('exists, matches the configuration, and is the deterministic rendering of itself', () => {
    expect(f).not.toBeNull();
    if (f === null) return;
    expect(staleLanes(f, targets)).toEqual([]);
    expect(readFileSync(repoPath('packages/parity/out/lanes.json'), 'utf8')).toBe(lanesJsonText(f));
    expect(f.parity).toEqual({ pass: true, problems: [] });
    expect(JSON.stringify(f)).not.toMatch(/Seconds|Ms"|timing/);
  });
  it('host lanes pass on both targets with both digests; every device lane is not run; the reference proof passes', () => {
    if (f === null) return;
    for (const t of f.targets) {
      const host = t.lanes.find((l) => l.lane === 'layout-vectors-host');
      expect(host?.state, t.target).toBe('pass');
      expect(host?.run?.digests).toEqual({ p1: p1Manifest().digest, extended: extendedManifest().digest });
      expect(host?.run?.suites.every((s) => s.total === s.declared && s.pass === s.declared)).toBe(true);
      expect(t.referenceProof?.map((r) => r.dpr)).toEqual(t.target === 'ios' ? SHARED_DPRS : [...SHARED_DPRS, ...EXTRA_DPRS.map((e) => e.dpr)]);
      for (const r of t.referenceProof ?? []) expect([r.valid, r.chrome, r.engine]).toEqual([r.cases, r.cases, r.cases]);
    }
    // P5: the committed file holds device run records (below); a file written from the committed host runs alone, with no
    // device run and nothing carried, still has every device lane not run.
    const hostOnly = new Map(f.targets.map((t) => {
      const l = t.lanes.find((x) => x.lane === 'layout-vectors-host');
      return [t.target, { state: l?.state ?? 'not run', reason: l?.reason ?? null, toolchain: l?.run?.toolchain ?? null, suites: l?.run?.suites ?? [], digests: l?.run?.digests ?? { p1: null, extended: null } } as HostRun] as const;
    }));
    const unrun = lanesFile(targets, [], hostOnly, null);
    for (const t of unrun.targets) for (const l of t.lanes.filter((x) => x.where === 'device')) expect(l.state).toBe('not run');
    expect(notPassed(unrun).length).toBe(2 * (LANES.length - 1));
  });
  it('device-hit runs exactly the hit cases: every layout case but those the hit lane refuses by name, the PNT2 transform cases (T146), the PNT1 stacking cases, the radius cases (PNT1) and the INL1a inline cases', () => {
    const refusals = hitRefusedCases();
    const refused = refusals.map((r) => r.id);
    expect(refused.length).toBeGreaterThan(0);
    // Exactly the union: every INL1a inline, PNT1 stacking and radius case is refused with its reason, and every other refusal is a
    // transform- case (PNT2) or PNT1's stacking-transform with the transform reason.
    expect(refused.filter((id) => RADIUS_OUT.includes(id)).sort()).toEqual([...RADIUS_OUT].sort());
    expect(refused.filter((id) => INLINE_OUT.includes(id)).sort()).toEqual([...INLINE_OUT].sort());
    expect(refused.filter((id) => STACKING_OUT.includes(id)).sort()).toEqual([...STACKING_OUT].sort());
    for (const r of refusals) {
      if (RADIUS_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(RADIUS_REASON);
      else if (INLINE_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(INLINE_REASON);
      else if (STACKING_OUT.includes(r.id)) expect(r.reason, r.id).toMatch(STACKING_REASON);
      else expect([r.id, r.reason], r.id).toEqual([expect.stringMatching(/^(transform-|stacking-transform)/), expect.stringMatching(TRANSFORM_REASON)]);
    }
    expect([...hitCases().map((n) => n.case.id), ...refused].sort()).toEqual([...ids].sort());
    expect(hitCaseCount()).toBe(ids.length - refused.length);
    // The declared device-hit sets hold exactly those cases (targets.ts hitCaseIds), in layout order, at every device DPR.
    expect(hitCaseIds()).toEqual(hitCases().map((n) => n.case.id));
    for (const t of nativeTargets()) {
      const lane = t.lanes.find((l) => l.lane === HIT_LANE);
      expect(lane?.sets.length, t.target).toBe(t.dprs.length);
      for (const set of lane?.sets ?? []) expect(set.ids, `${t.target} ${set.dpr}`).toEqual(hitCaseIds());
    }
  });
  it('every device lane ran (P5): per DPR the device, OS, both scales, a dump per case and the counts compared; vectors equal the host lane; every dump fault caught; capture trust on every device', () => {
    if (f === null) return;
    for (const t of f.targets) {
      const host = t.lanes.find((l) => l.lane === 'layout-vectors-host');
      const vectors = t.lanes.find((l) => l.lane === 'layout-vectors-device');
      expect(vectors?.state, `${t.target} layout-vectors-device`).toBe('pass');
      expect(vectors?.run?.digests).toEqual(host?.run?.digests);
      expect(vectors?.run?.suites).toEqual(host?.run?.suites);
      for (const l of t.lanes.filter((x) => x.where === 'device' && x.lane !== 'layout-vectors-device')) {
        // Only device-pixels may be committed failing (P6 fixes paint); frames, applied and lines must pass.
        if (l.lane === 'device-pixels') expect(['pass', 'fail'], `${t.target} ${l.lane}`).toContain(l.state);
        else expect(l.state, `${t.target} ${l.lane}`).toBe('pass');
        expect([...(l.device?.sets.map((s) => s.dpr) ?? [])].sort(), `${t.target} ${l.lane}`).toEqual(l.sets.map((s) => s.dpr).sort());
        // SELD-R1b: device-states runs the state script cases, every check; device-hit runs every hit case (the layout cases but
        // those the hit lane refuses by name, hit-capture.ts hitCases) and compares only hit points (b), the other counts exactly 0.
        const cases = l.lane === STATE_LANE ? stateCaseCount(t.target) : l.lane === HIT_LANE ? hitCaseCount() : ids.length;
        for (const s of l.device?.sets ?? []) {
          expect([s.device.profileScale, s.device.appScale, s.dumps], `${t.target} ${l.lane} ${s.dpr}`).toEqual([s.dpr, s.dpr, s.cases]);
          expect(s.cases, `${t.target} ${l.lane} ${s.dpr}`).toBe(cases);
          if (l.lane === HIT_LANE) expect([s.compared.a, s.compared.b > 0, s.compared.c, s.compared.d, s.compared.breaks], `${t.target} ${l.lane} ${s.dpr}`).toEqual([0, true, 0, 0, 0]);
          else expect(s.compared.a > 0 && s.compared.b > 0 && s.compared.c > 0 && s.compared.d > 0 && s.compared.breaks > 0, `${t.target} ${l.lane} ${s.dpr}`).toBe(true);
        }
        if (l.lane === 'device-pixels') {
          expect(l.device?.trust?.map((x) => [x.dpr, x.mismatches])).toEqual(l.device?.sets.map((s) => [s.dpr, 0]));
          for (const x of l.device?.trust ?? []) expect(x.points > 0 && x.cases > 0, `${t.target} capture trust on ${x.device} compared no points`).toBe(true);
        }
      }
      expect(t.dumpFaults?.map((r) => r.dpr).sort()).toEqual([...t.dprs].sort());
      for (const r of t.dumpFaults ?? []) {
        expect(r.rows.map((x) => x.fault)).toEqual([...DUMP_FAULTS]);
        for (const x of r.rows) expect([x.fault, x.applicable > 0, x.caught === x.applicable]).toEqual([x.fault, true, true]);
      }
    }
  });
});

describe('host suite lines (T125)', () => {
  const suites = declaredSuites(lane(ios, 'layout-vectors-host') as NonNullable<ReturnType<typeof lane>>);
  const label = (s: string): string => (s === 'engine' ? 'engine corpus' : s === 'library' ? 'library corpus' : s);
  const text = (extra: readonly string[]): string => [
    'native:swift: Swift version 6.4',
    ...suites.filter((s) => s.corpus === 'p1').map((s) => `${label(s.suite)} ${s.cases}/${s.cases}`),
    'extended corpus:',
    ...suites.filter((s) => s.corpus === 'extended').map((s) => `${s.suite} ${s.cases}/${s.cases}`),
    ...extra,
    `native:swift: P1 corpus digest ${p1Manifest().digest}; extended corpus digest ${extendedManifest().digest}; status pass`,
  ].join('\n');
  it('a suite line the manifest does not declare is parsed and fails judgeHost, whatever its name', () => {
    expect(judgeHost(ios, parseNativeOutput(text([])))).toMatchObject({ state: 'pass', reason: null });
    // PIN-DERIVE: made-up names, checked undeclared, so a package that declares a suite needs no edit here.
    for (const name of ['engine-other', 'new suite 2', 'x']) {
      expect(suites.map((s) => s.suite), name).not.toContain(name);
      const parsed = parseNativeOutput(text([`${name} 3000/3000`]));
      expect(parsed?.suites.some((s) => s.corpus === 'extended' && s.suite === name), name).toBe(true);
      expect(judgeHost(ios, parsed), name).toMatchObject({ state: 'fail', reason: expect.stringContaining(`extended/${name} is not a declared suite`) });
    }
  });
  // PR #42 finding 4150454066: any nonempty label is a suite label, the first count on the line its count.
  it('a suite line with any label is counted (capitals, dots, underscores, punctuation), with the first count on the line', () => {
    for (const name of ['Engine_Inline', 'snap.values', 'calc (v2)', 'α-suite']) {
      const parsed = parseNativeOutput(text([`${name} 7/9 (note 1/2)`]));
      expect(parsed?.suites.find((s) => s.suite === name), name).toMatchObject({ corpus: 'extended', pass: 7, total: 9 });
      expect(judgeHost(ios, parsed), name).toMatchObject({ state: 'fail', reason: expect.stringContaining(`extended/${name} is not a declared suite`) });
    }
  });
  it('master\'s native:swift and native:kotlin output (committed, test/native-output) parses to the same 13 suites, nothing else', () => {
    for (const f of ['swift', 'kotlin']) {
      const out = readFileSync(join(import.meta.dirname, 'native-output', `${f}.txt`), 'utf8');
      const parsed = parseNativeOutput(out);
      expect(parsed?.suites.map((s) => `${s.corpus}/${s.suite} ${s.pass}/${s.total}`), f).toHaveLength(13);
      // The suites that output printed: node packages/translate/src/cli/native.ts swift and kotlin, run on the merge of master 23c2b507.
      expect(parsed?.suites.map((s) => `${s.corpus}/${s.suite}`), f).toEqual(['p1/vectors', 'p1/units', 'p1/engine', 'p1/library', ...['vectors-m2', 'vectors-dpr', 'engine-dpr', 'units-m2', 'snap', 'snap-values', 'calc-goldens', 'engine-calc', 'units-calc'].map((x) => `extended/${x}`)]);
      // No line but a suite line holds a count, so no other line can newly match.
      expect(out.split('\n').filter((l) => / \d+\/\d+/.test(l)), f).toHaveLength(13);
    }
  });
  it('lines that are not suite counts are not parsed as suites', () => {
    const parsed = parseNativeOutput(text(['corpus digest 0123abcd', 'build 16.9 s, run 23.5 s', 'status pass', 'native:swift: Swift version 6.4']));
    expect(parsed?.suites.map((s) => `${s.corpus}/${s.suite}`)).toEqual(suites.map((s) => `${s.corpus}/${s.suite}`));
    expect(judgeHost(ios, parsed)).toMatchObject({ state: 'pass', reason: null });
  });
});
