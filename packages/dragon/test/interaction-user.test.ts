// SELD-R2 §1 (lanes/paint/seld-r2-pr5-design.md): a ready native output of a document with interaction states ships one more file,
// Dragon/<Name>Interaction.swift or kotlin/dev/dragon/app/<Name>Interaction.kt, whose tables are the lane emit's; it fails closed.
import { describe, expect, it } from 'vitest';
import type { FrontEndResult } from '../src/internal.ts';
import { COMMITTED_PROFILES, createProjectWith, documentInteractionEmit, emitInteractionPrograms, emitInteractionUserFile, emitNativeSupport, INTERACTION_FAULT_FIELDS, InteractionEmitError, interactionUserName, NO_FAULTS } from '../src/internal.ts';
import { interactionContext, interactionRowFeature } from '../src/analysis/interaction.ts';
import type { ProfileRow } from '../src/profiles/types.ts';
import type { SupportProfiles } from '../src/project.ts';
import { nativeOutputState } from '../src/project.ts';
import { div, inputFor } from './helpers.ts';

const TARGETS = { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const PASSING = { recorded: true, stale: [], notPassing: [] } as const;
const BODY = 'body { font-family: Ahem; font-size: 10px; } .f { display: block; width: 10px; height: 10px; } ';
const FOCUS = '.f:focus { width: 80px; } .f:focus-visible { height: 7px; }';
const row = (p: 'focus' | 'focus-visible'): ProfileRow => ({ feature: interactionRowFeature(p), context: interactionContext('forced-only'), status: 'exact', proofs: [] });
const PROFILES: Required<SupportProfiles> = {
  web: COMMITTED_PROFILES.web,
  ios: { ...COMMITTED_PROFILES.ios, rows: [...COMMITTED_PROFILES.ios.rows, row('focus'), row('focus-visible')] },
  android: { ...COMMITTED_PROFILES.android, rows: [...COMMITTED_PROFILES.android.rows, row('focus'), row('focus-visible')] },
};
const doc = (css: string, id = 'doc'): FrontEndResult => {
  const input = inputFor(`${BODY}${css}`, (r) => [div(r, 'f', ['f'])]);
  // The document id is also the owner of its classes, so every "doc" value is renamed.
  return JSON.parse(JSON.stringify(input), (_k, v: unknown) => (v === 'doc' ? id : v)) as FrontEndResult;
};
const compile = (input: FrontEndResult, opts: { lanes?: boolean; verdict?: boolean } = {}) =>
  createProjectWith({ projectId: 'test', targets: TARGETS }, {
    faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles: PROFILES,
    ...(opts.verdict === false ? {} : { nativeLanes: { ios: PASSING, android: PASSING } }),
    ...(opts.lanes === true ? { interactionLanes: true } : {}),
  }).compile(input);
const BACKEND = { ios: 'uikit', android: 'android-views' } as const;
const PATH = { ios: (n: string) => `Dragon/${n}Interaction.swift`, android: (n: string) => `kotlin/dev/dragon/app/${n}Interaction.kt` } as const;

/** The shared declarations of a generated interaction source: from its "// interaction program" line to its last table line. */
function decls(text: string): string {
  const at = text.indexOf('// interaction program ');
  const end = text.search(/\n(private let \S+Faults: |private fun \S+Faults\(\)|\/\/\/ The interaction runtime of |\/\*\* The interaction runtime of )/);
  if (at < 0 || end < 0) throw new Error('not an interaction program source');
  return text.slice(at, end);
}

describe('SELD-R2 §1: the user-app interaction file', () => {
  it('names the document in the generated casing, and refuses an id that gives no type name', () => {
    expect(interactionUserName('doc')).toBe('Doc');
    expect(interactionUserName('music-player')).toBe('MusicPlayer');
    expect(interactionUserName('a_b.c d2')).toBe('ABCD2');
    for (const bad of ['', '-', '2fa', 'é']) expect(() => interactionUserName(bad), bad).toThrow(InteractionEmitError);
  });

  it('a ready output ships the support files and the file, whose tables are the lane emit\'s byte for byte', () => {
    const c = compile(doc(FOCUS));
    for (const t of ['ios', 'android'] as const) {
      const o = c.outputs[t];
      if (o.kind !== 'ready') throw new Error(`${t}: ${o.kind}`);
      const support = emitNativeSupport(BACKEND[t]);
      expect(o.files.slice(0, support.length), t).toEqual(support);
      expect(o.files.slice(support.length).map((f) => f.path), t).toEqual([PATH[t]('Doc')]);
      const user = o.files[support.length]?.text as string;
      const e = documentInteractionEmit(c, t);
      if (e === null) throw new Error(`${t}: no interaction program`);
      expect(user, t).toBe(emitInteractionUserFile(BACKEND[t], e, 'doc').text);
      // The lane emit of the same program (a fixture viewport and no scripts) writes the same declarations under its own prefix.
      const lane = emitInteractionPrograms(BACKEND[t], [{ ...e, fixture: 'doc', direction: 'ltr', compilerDigest: c.digest, viewport: { width: 320, height: 240 }, scripts: [] }]);
      expect(decls(user).replaceAll('dragonDoc', 'dragonInteractions0'), t).toBe(decls(lane[0]?.text as string));
      expect(decls(user).length, t).toBeGreaterThan(1000);
      // No script, case table or planted fault reaches a user app; the viewport is the caller's.
      expect(user, t).not.toMatch(/Script|CaseTable|DragonInteractionStep|Viewport\(\d/);
      expect(user, t).toContain(`InteractionFaults(${INTERACTION_FAULT_FIELDS.map(() => 'false').join(', ')})`);
    }
    const swift = (c.outputs.ios.kind === 'ready' ? c.outputs.ios.files.at(-1)?.text : '') ?? '';
    const kotlin = (c.outputs.android.kind === 'ready' ? c.outputs.android.files.at(-1)?.text : '') ?? '';
    expect(swift).toContain('public enum DragonDoc {\n  /// A fresh interaction runtime at the initial app assignment, laid out in a width x height CSS px viewport.\n  public static func makeMachine(width: Double, height: Double) -> DragonInteractionMachine {');
    expect(swift).toContain('DragonInteractionMount(machine: DragonDoc.makeMachine(width: Double(stage.bounds.width), height: Double(stage.bounds.height)), stage: stage, measurer: bridge.measurer');
    expect(swift).toMatch(/variants: \[\{ dragonDocInput0\(\$0, width, height\) \}/);
    expect(kotlin).toContain('package dev.dragon.app\n');
    expect(kotlin).toContain('object DragonDoc {');
    expect(kotlin).toContain('fun makeMachine(width: Double, height: Double): DragonInteractionMachine =');
    expect(kotlin).toMatch(/listOf<\(Double\) -> LayoutInput>\(\{ dpr: Double -> dragonDocInput0\(dpr, width, height\) \}/);
  });

  it('a document without interaction states ships the support files only', () => {
    const c = compile(doc(''));
    for (const t of ['ios', 'android'] as const) {
      expect(documentInteractionEmit(c, t), t).toBeNull();
      expect(c.outputs[t], t).toMatchObject({ kind: 'ready', files: emitNativeSupport(BACKEND[t]) });
    }
  });

  it('fails closed to analysis-only, naming why: an id with no type name, or a name the support files use', () => {
    for (const [id, why] of [['2fa', /gives no Swift or Kotlin type name/], ['interaction-machine', /names DragonInteractionMachine, but the (uikit|android-views) support files already use DragonInteractionMachine/]] as const) {
      const c = compile(doc(FOCUS, id));
      for (const t of ['ios', 'android'] as const) {
        const o = c.outputs[t];
        expect(o.kind, `${id} ${t}`).toBe('analysis-only');
        if (o.kind === 'analysis-only') {
          expect(o.reason, `${id} ${t}`).toMatch(/its interaction program could not be emitted for a user app: /);
          expect(o.reason, `${id} ${t}`).toMatch(why);
        }
      }
    }
  });

  it('fails closed for a document whose native output also switches @media bands or runs transitions', () => {
    const banded = compile(doc(`${FOCUS} @media (min-width: 500px) { .f { height: 20px; } }`));
    const animated = compile(doc(`${FOCUS} .f { transition: width 1s; }`));
    for (const [c, why] of [[banded, /switches \d+ @media bands at run time/], [animated, /has transitions or animations/]] as const) {
      for (const t of ['ios', 'android'] as const) {
        const o = c.outputs[t];
        expect(o.kind, t).toBe('analysis-only');
        if (o.kind === 'analysis-only') expect(o.reason, t).toMatch(why);
        expect(() => documentInteractionEmit(c, t), t).toThrow(why);
      }
    }
  });

  it('reads the interaction file only for a ready output, and rethrows any error that is not an emit error', () => {
    let calls = 0;
    const files = () => {
      calls++;
      return [];
    };
    expect(nativeOutputState('ios', 'a'.repeat(64), null, files).kind).toBe('analysis-only');
    expect(nativeOutputState('ios', 'a'.repeat(64), { recorded: true, stale: [], notPassing: ['x'] }, files).kind).toBe('analysis-only');
    expect(calls).toBe(0);
    expect(nativeOutputState('ios', 'a'.repeat(64), PASSING, files).kind).toBe('ready');
    expect(calls).toBe(1);
    expect(() => nativeOutputState('ios', 'a'.repeat(64), PASSING, () => {
      throw new TypeError('a bug');
    })).toThrow(TypeError);
    expect(nativeOutputState('android', 'a'.repeat(64), PASSING, () => {
      throw new InteractionEmitError('no tables');
    })).toMatchObject({ kind: 'analysis-only', reason: expect.stringMatching(/could not be emitted for a user app: no tables\.$/) });
  });

  it('a compile without a lanes verdict stays analysis-only and never builds the file', () => {
    const c = compile(doc(FOCUS), { verdict: false });
    for (const t of ['ios', 'android'] as const) expect(c.outputs[t], t).toMatchObject({ kind: 'analysis-only', reason: expect.stringMatching(/no committed lanes verdict was given/) });
  });
});
