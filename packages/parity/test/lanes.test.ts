// parity:lanes (native-strategy.md 3.6; T009 P3 items 2, 3 and 9): both native targets have the same six lanes, case lists derived
// from the constants, imported tolerances, the same sample rules and dump faults and one projection; each planted lane fault is
// caught with its own message; lane states are honest; and the committed out/lanes.json matches the configuration.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iosLayoutProjection, nativeLayoutProjection, NO_FAULTS } from 'dragon';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX } from '../src/compare.ts';
import { atDpr, DPRS, EXTRA_DPRS, layoutCases, SHARED_DPRS } from '../src/dpr.ts';
import { declaredLayoutCaseCount, groupFixtures, MILESTONE_1_LAYOUT_CASES } from '../src/case-count.ts';
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
    // The V1 suites are parsed and judged too: a dropped V1 suite line fails the host lane.
    for (const v1 of ['snap-values', 'calc-goldens', 'engine-calc', 'units-calc', 'engine-inline']) {
      expect(judgeHost(ios, parseNativeOutput(text(v1, p1))), v1).toMatchObject({ state: 'fail', reason: expect.stringContaining(`extended/${v1} -/-, declared`) });
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
        for (const s of l.device?.sets ?? []) {
          expect([s.device.profileScale, s.device.appScale, s.dumps], `${t.target} ${l.lane} ${s.dpr}`).toEqual([s.dpr, s.dpr, s.cases]);
          expect(s.cases).toBe(ids.length);
          expect(s.compared.a > 0 && s.compared.b > 0 && s.compared.c > 0 && s.compared.d > 0 && s.compared.breaks > 0).toBe(true);
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
    // engine-inline is declared since INL1a, so the undeclared names are made up.
    for (const name of ['engine-other', 'new suite 2', 'x']) {
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
