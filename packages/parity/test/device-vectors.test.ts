// layout-vectors-device (notes/T015-p4-review-p5-plan.md section 4 item 2), without a device: the device verdict passes only when
// every declared suite ran whole, both corpus digests are the manifests', and counts and digests equal the host lane's run.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceSuiteResult } from '../src/device-vectors.ts';
import { judgeDeviceVectors } from '../src/device-vectors.ts';
import type { HostRun } from '../src/lanes.ts';
import type { TargetConfig } from '../src/targets.ts';
import { declaredSuites, extendedManifest, nativeTargets, p1Manifest } from '../src/targets.ts';

const targets = nativeTargets();

describe.each(['ios', 'android'] as const)('the %s device vectors verdict', (name) => {
  const t = targets.find((x) => x.target === name) as TargetConfig;
  const lane = t.lanes.find((l) => l.lane === 'layout-vectors-device');
  if (lane === undefined) throw new Error('no layout-vectors-device lane');
  const declared = declaredSuites(lane);
  const whole: DeviceSuiteResult[] = declared.map((d) => ({ corpus: d.corpus, name: d.suite, total: d.cases, pass: d.cases, cause: null, mismatches: [] }));
  const digests = { p1: p1Manifest().digest, extended: extendedManifest().digest };
  const host: HostRun = { state: 'pass', reason: null, toolchain: 'host', suites: declared.map((d) => ({ corpus: d.corpus, suite: d.suite, declared: d.cases, total: d.cases, pass: d.cases })), digests };
  it('the device lane declares the host lane suites', () => {
    const h = t.lanes.find((l) => l.lane === 'layout-vectors-host');
    expect(h === undefined ? null : declaredSuites(h)).toEqual(declared);
  });
  it('passes with every suite whole and the host run equal', () => {
    expect(judgeDeviceVectors(t, whole, digests, host)).toMatchObject({ state: 'pass', reason: null });
  });
  it('fails on one mismatching line, a crashed suite, a missing suite, a wrong digest, or no host run', () => {
    const one = whole.map((s, i) => (i === 0 ? { ...s, pass: s.pass - 1, mismatches: [{ index: 3, expected: 'a', got: 'b' }] } : s));
    expect(judgeDeviceVectors(t, one, digests, host).reason).toMatch(/p1\/vectors \d+\/\d+, declared \d+/);
    const crash = whole.map((s, i) => (i === 1 ? { ...s, cause: 'crash: signal SIGSEGV' } : s));
    expect(judgeDeviceVectors(t, crash, digests, host).reason).toMatch(/crash: signal SIGSEGV/);
    expect(judgeDeviceVectors(t, whole.slice(1), digests, host).state).toBe('fail');
    expect(judgeDeviceVectors(t, whole, { ...digests, p1: '0'.repeat(64) }, host).reason).toMatch(/P1 corpus digest/);
    expect(judgeDeviceVectors(t, whole, digests, null).reason).toMatch(/no layout-vectors-host run/);
    expect(judgeDeviceVectors(t, whole, digests, { ...host, state: 'fail' }).state).toBe('fail');
  });
  it('declares the V1 value-model suites, and a suite the device reports that is not declared fails the lane', () => {
    for (const v1 of ['snap-values', 'calc-goldens', 'engine-calc', 'units-calc']) {
      expect(declared.find((d) => d.corpus === 'extended' && d.suite === v1)?.cases, v1).toBeGreaterThan(0);
    }
    // ANIM-a2: the rt suite is declared in the P1 corpus with one case per rt vector record, and a short rt run fails the lane.
    expect(declared.find((d) => d.corpus === 'p1' && d.suite === 'rt')?.cases).toBe(55362);
    const shortRt = whole.map((s) => (s.corpus === 'p1' && s.name === 'rt' ? { ...s, pass: s.pass - 1 } : s));
    expect(judgeDeviceVectors(t, shortRt, digests, host)).toMatchObject({ state: 'fail', reason: expect.stringContaining('p1/rt 55361/55362, declared 55362') });
    // SELD-R1b: the hit suite is declared with one case per layout vector at every DPR (the device-hit proof), at no fewer cases
    // than translate's p1-floor.json holds, and a short run fails.
    const hit = declared.find((d) => d.corpus === 'p1' && d.suite === 'hit')?.cases ?? 0;
    const p1Floor = JSON.parse(readFileSync(new URL('../../translate/test/p1-floor.json', import.meta.url), 'utf8')) as { p1: { counts: { hit: number } } };
    expect(hit).toBeGreaterThanOrEqual(p1Floor.p1.counts.hit);
    const shortHit = whole.map((s) => (s.corpus === 'p1' && s.name === 'hit' ? { ...s, pass: s.pass - 1 } : s));
    expect(judgeDeviceVectors(t, shortHit, digests, host)).toMatchObject({ state: 'fail', reason: expect.stringContaining(`p1/hit ${hit - 1}/${hit}, declared ${hit}`) });
    const extra: DeviceSuiteResult = { corpus: 'extended', name: 'undeclared-suite', total: 5, pass: 5, cause: null, mismatches: [] };
    expect(judgeDeviceVectors(t, [...whole, extra], digests, host)).toMatchObject({ state: 'fail', reason: expect.stringContaining('extended/undeclared-suite is not a declared suite') });
  });
});
