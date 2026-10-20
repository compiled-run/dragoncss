// T137a (docs/research/native-strategy.md 3.9 item 13): the android profile follows the iOS rule, so every row it promotes must
// be one the android output accepts: the same used keys as iOS in every native case, no android-only refusal in any enforced
// compile, an unblocked android output for every proving case, and the Android Views emitter generating every proving case.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from 'dragon';
import { androidProfile, compiledFeatures, createProjectWith, emitAndroidViewsCases, interactionPartitionOf, iosProfile, MEDIA_CONTEXT, nativePrograms, NO_FAULTS } from 'dragon';
import { fixtureInput } from '../src/cases.ts';
import { fontMapOf, withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { emitCases, forcedNativeCases, NATIVE_CONFIG, nativeCases } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { ANIMATION_CONTEXT } from '../src/profile-rows.ts';
import { resizeCaseReport, resizeCases, resizeProgram } from '../src/resize-capture.ts';

const cases = nativeCases();
const byId = new Map(cases.map((n) => [n.case.id, n]));
// MQ-R1: media rows are proven by resize cases, not layout cases; the last test here checks those on android.
// Animation rows are proved by device-anim frame cases (deriveAnimationRows over the device records), not by layout cases.
// SELD-R2 PR 5: interaction rows are proved by forced device cases on each target's own device record (deriveInteractionRows), whose
// fixtures keep other interaction rules the gate refuses; the interaction test below checks them.
const isInteraction = (context: string): boolean => context.startsWith('interaction/');
const promoted = androidProfile.rows.filter((r) => r.status !== 'unsupported' && r.context !== MEDIA_CONTEXT && r.context !== ANIMATION_CONTEXT && !isInteraction(r.context));
const promotedInteraction = androidProfile.rows.filter((r) => r.status !== 'unsupported' && isInteraction(r.context));
const promotedMedia = androidProfile.rows.filter((r) => r.status !== 'unsupported' && r.context === MEDIA_CONTEXT);

/** The lane compile of native-host.ts nativeCompile, with the committed profiles enforced. */
function enforcedNative(spec: FixtureSpec, direction: 'ltr' | 'rtl') {
  if (spec.kind !== 'layout') throw new Error(`${spec.id} is not a layout fixture`);
  // TXT1a-2: a real-font fixture compiles with its font map and the map's vendored faces, as nativeCompile does.
  const fonts = fontMapOf(spec.id);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG }, ...(fonts === undefined ? {} : { fonts }) }, { faults: NO_FAULTS, profiles: 'enforce', direction, platform: REFERENCE_PLATFORM, rootFont: spec.rootFont, foldViewport: ENVIRONMENT.viewport });
  return project.compile(fonts === undefined ? fixtureInput(spec) : withFontMapAssets(fixtureInput(spec), fonts));
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
    // Animation rows follow each target's own device-anim record (deriveAnimationRows), so their proving cases may differ;
    // the features and statuses they claim may not.
    // Interaction rows follow each target's own device record too (deriveInteractionRows), and are checked on their own below.
    const layout = (rows: typeof iosProfile.rows) => rows.filter((r) => r.context !== ANIMATION_CONTEXT && !isInteraction(r.context));
    const claims = (rows: typeof iosProfile.rows) => rows.filter((r) => r.context === ANIMATION_CONTEXT).map((r) => `${r.feature} ${r.status}`);
    expect(layout(androidProfile.rows)).toEqual(layout(iosProfile.rows));
    expect(claims(androidProfile.rows)).toEqual(claims(iosProfile.rows));
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

  it('every case proving an android interaction row is a forced device case whose state programs are ready, which the gate accepts and the emitter generates', () => {
    const forced = new Map(forcedNativeCases().map((n) => [n.case.id, n]));
    const proving = [...new Set(promotedInteraction.flatMap((r) => r.proofs.flatMap((p) => p.cases)))];
    for (const id of proving) {
      const n = forced.get(id);
      if (n === undefined) throw new Error(`${id} proves an android interaction row and is not a forced device case`);
      expect(nativePrograms(n.compiled, n.case.assignment, n.case.interaction ?? null).kind, id).toBe('ready');
      const c = enforcedOf(n.spec, n.case.environment.direction);
      // The rows a case proves are ones the android gate accepts there: no android refusal names one of them.
      for (const r of promotedInteraction.filter((x) => x.proofs.some((p) => p.cases.includes(id)))) {
        expect(c.diagnostics.filter((x) => x.target === 'android' && x.message.includes(`${r.feature} in ${r.context}`)).map((x) => x.message), `${id} ${r.feature}`).toEqual([]);
      }
    }
    const emitted = emitCases('android').filter((e) => proving.includes(e.id));
    expect(emitted.map((e) => e.id).sort()).toEqual([...proving].sort());
    const text = emitAndroidViewsCases(emitted).map((f) => f.text).join('\n');
    for (const id of proving) expect(text.includes(`// case ${id}\n`), id).toBe(true);
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
});
