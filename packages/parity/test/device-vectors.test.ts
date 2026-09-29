// layout-vectors-device (notes/T015-p4-review-p5-plan.md section 4 item 2), without a device: the device verdict passes only when
// every declared suite ran whole, both corpus digests are the manifests', and counts and digests equal the host lane's run.
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
});
