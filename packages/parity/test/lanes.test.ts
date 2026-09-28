// parity:lanes (native-strategy.md 3.6; T009 P3 items 2, 3 and 9): both native targets have the same six lanes, case lists derived
// from the constants, imported tolerances, the same sample rules and dump faults and one projection; each planted lane fault is
// caught with its own message; lane states are honest; and the committed out/lanes.json matches the configuration.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iosLayoutProjection, nativeLayoutProjection, NO_FAULTS } from 'dragon';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX } from '../src/compare.ts';
import { atDpr, DPRS, EXTRA_DPRS, layoutCases, SHARED_DPRS } from '../src/dpr.ts';
import type { HostRun, KotlinLookup, LaneFault } from '../src/lanes.ts';
import { checkLaneParity, DEVICE_NOT_RUN, judgeHost, LANE_FAULTS, LANE_FILES, lanesFile, lanesJsonText, laneSources, notPassed, parseNativeOutput, plantLaneFault, readLanesFile, runHostLane, staleLanes, toleranceLiterals } from '../src/lanes.ts';
import { DUMP_FAULTS } from '../src/native-compare.ts';
import { repoPath } from '../src/paths.ts';
import { compileFixture } from '../src/pipeline.ts';
import { SAMPLE_RULES } from '../src/samples.ts';
import type { NativeTarget, TargetConfig } from '../src/targets.ts';
import { corpusSuites, declaredSuites, extendedManifest, LANES, layoutCaseIds, m1CaseIds, nativeTargets, p1Manifest } from '../src/targets.ts';

const targets = nativeTargets();
const sources = laneSources();
const ios = targets.find((t) => t.target === 'ios') as TargetConfig;
const android = targets.find((t) => t.target === 'android') as TargetConfig;
const lane = (t: TargetConfig, id: string) => t.lanes.find((l) => l.lane === id);
const ids = layoutCaseIds();

describe('native targets', () => {
  it('ios and android, each with the six lanes in order', () => {
    expect(targets.map((t) => t.target)).toEqual(['ios', 'android']);
    expect(LANES).toEqual(['layout-vectors-host', 'layout-vectors-device', 'device-frames', 'device-applied', 'device-lines', 'device-pixels']);
    for (const t of targets) expect(t.lanes.map((l) => l.lane)).toEqual([...LANES]);
  });
  it('case lists come from the constants: 271 top-level plus 813 DPR vectors = 1084 on both vectors lanes of both targets', () => {
    expect(ids).toEqual(layoutCases().flatMap((f) => f.cases.map((c) => c.id)));
    for (const t of targets) {
      for (const l of ['layout-vectors-host', 'layout-vectors-device']) {
        const v = lane(t, l);
        expect(v?.sets.map((s) => [s.dpr, s.role, s.extra, s.ids.length])).toEqual([[1, 'top-level', null, ids.length], ...DPRS.map((d) => [d, SHARED_DPRS.includes(d) ? 'shared' : 'extra', EXTRA_DPRS.find((e) => e.dpr === d)?.name ?? null, ids.length])]);
        expect(v?.sets.reduce((n, s) => n + s.ids.length, 0)).toBe(1084);
        expect(v?.corpora).toEqual(corpusSuites());
      }
    }
    expect(ids.length).toBe(271);
    expect(lane(ios, 'layout-vectors-host')).toEqual(lane(android, 'layout-vectors-host'));
  });
  it('the corpus counts are derived from the manifests and agree with their declared case counts', () => {
    const suites = declaredSuites(lane(ios, 'layout-vectors-host') as NonNullable<ReturnType<typeof lane>>);
    const p1 = p1Manifest();
    const x = extendedManifest();
    expect(Object.fromEntries(suites.filter((s) => s.corpus === 'p1').map((s) => [s.suite, s.cases]))).toEqual(p1.cases);
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
  it('iosLayoutProjection output deep-equals nativeLayoutProjection output for every case, at DPR 1 and every DPR', () => {
    let n = 0;
    for (const f of layoutCases()) {
      const compiled = new Map((['ltr', 'rtl'] as const).map((d) => [d, compileFixture(f.spec, NO_FAULTS, 'enforce', d).compiled]));
      for (const c of f.cases) {
        const comp = compiled.get(c.environment.direction);
        for (const dpr of [1, ...DPRS]) {
          const env = atDpr(c.environment, dpr);
          const native = nativeLayoutProjection(comp as object, env, c.assignment);
          expect(native.kind, c.id).toBe('ready');
          expect(iosLayoutProjection(comp as object, env, c.assignment)).toEqual(native);
          n++;
        }
      }
    }
    expect(n).toBe(ids.length * (1 + DPRS.length));
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
    const run = await runHostLane(android, { kotlinLookup: notFound });
    expect(run.state).toBe('blocked (owner tooling)');
    expect(run.suites.every((s) => s.total === null && s.pass === null)).toBe(true);
    const f = lanesFile(targets, [], new Map<NativeTarget, HostRun>([['android', run]]), null);
    const host = f.targets.find((t) => t.target === 'android')?.lanes.find((l) => l.lane === 'layout-vectors-host');
    expect(host?.state).toBe('blocked (owner tooling)');
    expect(notPassed(f)).toContainEqual(expect.stringMatching(/^android layout-vectors-host: blocked \(owner tooling\)/));
    expect(notPassed(f).length).toBe(2 * LANES.length);
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
      for (const l of t.lanes.filter((x) => x.where === 'device')) expect(l.state).toBe('not run');
      expect(t.referenceProof?.map((r) => r.dpr)).toEqual(t.target === 'ios' ? SHARED_DPRS : [...SHARED_DPRS, ...EXTRA_DPRS.map((e) => e.dpr)]);
      for (const r of t.referenceProof ?? []) expect([r.valid, r.chrome, r.engine]).toEqual([r.cases, r.cases, r.cases]);
    }
    expect(notPassed(f).length).toBe(2 * (LANES.length - 1));
  });
});
