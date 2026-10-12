// P6a (notes/T008-p5-review.md): outputs.ios and outputs.android are ready only with a committed lanes record in which every lane
// of that target passes and none is stale; a native output's digest carries the backend's emitter and program versions and its
// support digest, while the web digest stays the compilation digest.
import { describe, expect, it } from 'vitest';
import { createProject } from '../src/index.ts';
import { createProjectWith, nativeDigest, nativeOutputState } from '../src/project.ts';
import { NO_FAULTS } from '../src/faults.ts';
import { NATIVE_LANES } from '../src/profiles/native-lanes.ts';
import { emitNativeSupport } from '../src/emit/native-support.ts';
import { div, inputFor } from './helpers.ts';

const DIGEST = 'a'.repeat(64);
const PASSING = { recorded: true, stale: [], notPassing: [] } as const;

describe('the native output state', () => {
  it('is ready, with the backend support files, only when a recorded lanes run has every lane passing and none stale', () => {
    for (const t of ['ios', 'android'] as const) {
      const s = nativeOutputState(t, DIGEST, PASSING);
      expect(s.kind).toBe('ready');
      if (s.kind === 'ready') {
        expect(s.digest).toBe(nativeDigest(DIGEST, t));
        expect(s.files).toEqual(emitNativeSupport(t === 'ios' ? 'uikit' : 'android-views'));
      }
    }
  });
  it('is analysis-only without a recorded lanes run', () => {
    const s = nativeOutputState('ios', DIGEST, { recorded: false, stale: [], notPassing: [] });
    expect(s).toMatchObject({ kind: 'analysis-only', digest: nativeDigest(DIGEST, 'ios') });
    if (s.kind === 'analysis-only') expect(s.reason).toMatch(/no committed lanes record proves it/);
  });
  it('is analysis-only when any lane of the target does not pass, naming it', () => {
    const s = nativeOutputState('android', DIGEST, { recorded: true, stale: [], notPassing: ['device-pixels fail (3 failures)'] });
    expect(s.kind).toBe('analysis-only');
    if (s.kind === 'analysis-only') expect(s.reason).toMatch(/these lanes do not pass: device-pixels fail \(3 failures\)/);
  });
  it('is analysis-only when the record is stale, even with every lane passing', () => {
    const s = nativeOutputState('ios', DIGEST, { recorded: true, stale: ['ios device-frames does not match the configured case list'], notPassing: [] });
    expect(s.kind).toBe('analysis-only');
    if (s.kind === 'analysis-only') expect(s.reason).toMatch(/stale \(ios device-frames does not match/);
  });
  it('follows the committed verdict in a compile: today device-pixels fails on both targets, so both stay analysis-only', () => {
    const c = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }).compile(inputFor('', (r) => [div(r, 'a', [])]));
    for (const t of ['ios', 'android'] as const) {
      const v = NATIVE_LANES[t];
      const ready = v.recorded && v.stale.length === 0 && v.notPassing.length === 0;
      expect(c.outputs[t].kind, t).toBe(ready ? 'ready' : 'analysis-only');
    }
    expect(NATIVE_LANES.ios.notPassing.length + NATIVE_LANES.ios.stale.length).toBeGreaterThan(0);
    expect(NATIVE_LANES.android.notPassing.length + NATIVE_LANES.android.stale.length).toBeGreaterThan(0);
  });
  it('is analysis-only, saying so, when no verdict is given; createProject gives the committed one and a given verdict decides', () => {
    expect(nativeOutputState('ios', DIGEST, null)).toMatchObject({ kind: 'analysis-only', digest: nativeDigest(DIGEST, 'ios'), reason: expect.stringMatching(/no committed lanes verdict was given/) });
    const config = { projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } } as const;
    const input = inputFor('', (r) => [div(r, 'a', [])]);
    const base = { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' } as const;
    // A passing verdict given to the compile makes both ready, so the absent verdict below is never read as passing.
    const passing = createProjectWith(config, { ...base, nativeLanes: { ios: PASSING, android: PASSING } }).compile(input);
    const none = createProjectWith(config, base).compile(input);
    const committed = createProjectWith(config, { ...base, nativeLanes: NATIVE_LANES }).compile(input);
    const pub = createProject(config).compile(input);
    for (const t of ['ios', 'android'] as const) {
      expect(passing.outputs[t].kind, t).toBe('ready');
      expect(none.outputs[t], t).toMatchObject({ kind: 'analysis-only', reason: expect.stringMatching(/no committed lanes verdict was given/) });
      expect(pub.outputs[t], t).toEqual(committed.outputs[t]);
    }
    expect(pub.digest).toBe(none.digest);
  });
});

describe('the native digest', () => {
  it('differs per backend and from the compilation digest; the web output keeps the compilation digest', () => {
    const ios = nativeDigest(DIGEST, 'ios');
    const android = nativeDigest(DIGEST, 'android');
    expect(ios).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([ios, android, DIGEST]).size).toBe(3);
    const c = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }).compile(inputFor('', (r) => [div(r, 'a', [])]));
    if (c.outputs.web.kind === 'ready' && c.outputs.ios.kind !== 'blocked') {
      expect(c.outputs.web.digest).toBe(c.digest);
      expect(c.outputs.ios.digest).toBe(nativeDigest(c.digest, 'ios'));
    } else throw new Error(`unexpected outputs ${c.outputs.web.kind} ${c.outputs.ios.kind}`);
  });
});
