// T137a (docs/research/native-strategy.md 3.9 item 13): the android profile follows the iOS rule, so every row it promotes must
// be one the android output accepts: the same used keys as iOS in every native case, no android-only refusal in any enforced
// compile, an unblocked android output for every proving case, and the Android Views emitter generating every proving case.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from 'dragon';
import { androidProfile, compiledFeatures, createProjectWith, emitAndroidViewsCases, emitFrameScripts, interactionPartitionOf, iosProfile, MEDIA_CONTEXT, nativePrograms, NO_FAULTS } from 'dragon';
import { frameCaseEmits, frameRuns, sampleId } from '../src/anim-lanes.ts';
import { frameEmits } from '../src/anim-cases.ts';
import { ANIMATION_CONTEXT } from '../src/profile-rows.ts';
import { stateEmits } from '../src/state-cases.ts';
import { fixtureInput } from '../src/cases.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { emitCases, NATIVE_CONFIG, nativeCases } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { resizeCaseReport, resizeCases, resizeProgram } from '../src/resize-capture.ts';

const cases = nativeCases();
const byId = new Map(cases.map((n) => [n.case.id, n]));
// MQ-R1: media rows are proven by resize cases, and T065 animation rows by frame cases, not layout cases; the last two tests here
// check those on android.
const promoted = androidProfile.rows.filter((r) => r.status !== 'unsupported' && r.context !== MEDIA_CONTEXT && r.context !== ANIMATION_CONTEXT);
const promotedMedia = androidProfile.rows.filter((r) => r.status !== 'unsupported' && r.context === MEDIA_CONTEXT);
const promotedAnimation = androidProfile.rows.filter((r) => r.status !== 'unsupported' && r.context === ANIMATION_CONTEXT);

/** The lane compile of native-host.ts nativeCompile, with the committed profiles enforced. */
function enforcedNative(spec: FixtureSpec, direction: 'ltr' | 'rtl') {
  if (spec.kind !== 'layout') throw new Error(`${spec.id} is not a layout fixture`);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults: NO_FAULTS, profiles: 'enforce', direction, platform: REFERENCE_PLATFORM, rootFont: spec.rootFont, foldViewport: ENVIRONMENT.viewport });
  return project.compile(fixtureInput(spec));
}
const enforced = new Map<string, ReturnType<typeof enforcedNative>>();
function enforcedOf(spec: FixtureSpec, direction: 'ltr' | 'rtl'): ReturnType<typeof enforcedNative> {
  const key = `${spec.id} ${direction}`;
  let c = enforced.get(key);
  if (c === undefined) {
    c = enforcedNative(spec, direction);
    enforced.set(key, c);
  }
  return c;
}

/** A diagnostic of one target with the target's name taken out, so the two native targets' diagnostics compare. */
const neutral = (d: Diagnostic, target: 'ios' | 'android'): string =>
  JSON.stringify({ ...d, target: null, profile: d.profile === undefined || d.profile === null ? null : { ...d.profile, target: null } }).replace(new RegExp(`\\b${target}\\b`, 'g'), '<native>');

describe('the android profile follows the iOS rule', () => {
  it('holds exactly the iOS rows, statuses and proofs', () => {
    expect(androidProfile.target).toBe('android');
    expect(androidProfile.revision).toBe(iosProfile.revision);
    expect(androidProfile.rows).toEqual(iosProfile.rows);
    expect(promoted.length).toBeGreaterThan(0);
  });

  it('every native case uses the same keys on android as on ios', () => {
    for (const n of cases) {
      const ios = compiledFeatures(n.compiled, 'ios', n.case.assignment);
      expect(ios.length, n.case.id).toBeGreaterThan(0);
      expect(compiledFeatures(n.compiled, 'android', n.case.assignment), n.case.id).toEqual(ios);
    }
  });

  it('no enforced native compile has an android-targeted diagnostic that ios does not have', () => {
    const seen = new Set<string>();
    for (const n of cases) {
      const d = n.case.environment.direction;
      const key = `${n.spec.id} ${d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = enforcedOf(n.spec, d);
      const ios = new Set(c.diagnostics.filter((x) => x.target === 'ios').map((x) => neutral(x, 'ios')));
      const androidOnly = c.diagnostics.filter((x) => x.target === 'android' && !ios.has(neutral(x, 'android')));
      expect(androidOnly.map((x) => `${x.code} ${x.message}`), key).toEqual([]);
      if (c.outputs.ios.kind !== 'blocked') expect(c.outputs.android.kind, key).not.toBe('blocked');
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('every case proving a promoted row compiles for android unblocked, with ready programs, and the Android Views emitter generates it', () => {
    const proving = new Set(promoted.flatMap((r) => r.proofs.flatMap((p) => p.cases)));
    expect(proving.size).toBeGreaterThan(0);
    // A SELD-R2a forced case "<case>~ix<k>" is interaction state k of a native case: its programs in that state must be ready too.
    const forced = (id: string): { base: string; k: number } | null => {
      const m = /^(.*)~ix(\d+)(-rtl)?$/.exec(id);
      return m === null ? null : { base: `${m[1]}${m[3] ?? ''}`, k: Number(m[2]) };
    };
    for (const id of proving) {
      const f = forced(id);
      const n = byId.get(f === null ? id : f.base);
      if (n === undefined) throw new Error(`${id} proves an android row and is not a native case`);
      const c = enforcedOf(n.spec, n.case.environment.direction);
      expect(c.outputs.android.kind, id).not.toBe('blocked');
      expect(c.diagnostics.filter((x) => x.target === 'android' && x.severity === 'error').map((x) => `${x.code} ${x.message}`), id).toEqual([]);
      expect(nativePrograms(c, n.case.assignment).kind, id).toBe('ready');
      if (f !== null) {
        const state = interactionPartitionOf(c, n.case.assignment)?.states[f.k];
        if (state === undefined) throw new Error(`${id}: no interaction state ${f.k}`);
        expect(nativePrograms(c, n.case.assignment, state.key).kind, id).toBe('ready');
      }
    }
    const unforced = [...proving].filter((id) => forced(id) === null);
    const emitted = emitCases('android').filter((e) => proving.has(e.id));
    expect(emitted.map((e) => e.id).sort()).toEqual(unforced.sort());
    const files = emitAndroidViewsCases(emitted);
    const text = files.map((f) => f.text).join('\n');
    for (const id of unforced) expect(text.includes(`// case ${id}\n`), id).toBe(true);
  });

  it('every resize case proving a media row compiles for android unblocked, enforced, and runs its android-views band program on the resize lanes', () => {
    const proving = new Set(promotedMedia.flatMap((r) => r.proofs.flatMap((p) => p.cases)));
    expect(proving.size).toBeGreaterThan(0);
    for (const id of proving) {
      const rc = resizeCases().find((x) => x.id === id);
      if (rc === undefined) throw new Error(`${id} proves an android media row and is not a resize case`);
      const c = enforcedOf(rc.spec, rc.direction);
      expect(c.outputs.android.kind, id).not.toBe('blocked');
      expect(c.diagnostics.filter((x) => x.target === 'android' && x.severity === 'error').map((x) => `${x.code} ${x.message}`), id).toEqual([]);
      expect(resizeCaseReport(rc, [1]).failures.filter((f) => f.includes(' android-views ')), id).toEqual([]);
      expect(resizeProgram(rc, undefined, 'android-views').backend, id).toBe('android-views');
    }
  }, 600_000);

  it('every frame case proving an animation row compiles for android unblocked, enforced, with ready programs, and the android host runs its every sample on device-anim', () => {
    const proving = new Set(promotedAnimation.flatMap((r) => r.proofs.flatMap((p) => p.cases)));
    expect(proving.size).toBeGreaterThan(0);
    const runs = new Map(frameRuns('android-views').map((r) => [r.c.id, r]));
    const frames = new Map(frameCaseEmits('android', [...stateEmits('android'), ...frameEmits('android')]).map((f) => [f.id, f]));
    const text = emitFrameScripts('android-views', [...frames.values()]).map((f) => f.text).join('\n');
    for (const id of proving) {
      const r = runs.get(id);
      if (r === undefined) throw new Error(`${id} proves an android animation row and is not a frame case`);
      const c = enforcedOf(r.c.fixture.spec, r.c.direction);
      expect(c.outputs.android.kind, id).not.toBe('blocked');
      expect(c.diagnostics.filter((x) => x.target === 'android' && x.severity === 'error').map((x) => `${x.code} ${x.message}`), id).toEqual([]);
      expect(r.programs.length, id).toBeGreaterThan(0);
      expect(frames.get(id)?.samples.map((x) => x.id), id).toEqual(r.programs.map((_, k) => sampleId(id, k)));
      for (let k = 0; k < r.programs.length; k++) expect(text.includes(JSON.stringify(sampleId(id, k))), `${id} sample ${k}`).toBe(true);
    }
  }, 600_000);
});
