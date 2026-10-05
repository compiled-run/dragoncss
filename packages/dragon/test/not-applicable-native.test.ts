// NA-NATIVE (owner ruling, notes/PM-2026-10-04.md): every entry of the not-applicable list compiles with no error on ios and android,
// changes nothing in the native programs or the emitted Swift and Kotlin, and is named by an info diagnostic per native target; web
// still refuses it exactly as before. Anything off the list stays refused on every target.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { querySupport } from '../src/index.ts';
import type { EmitCase, NativeProgram } from '../src/internal.ts';
import { createProjectWith, emitAndroidViewsCases, emitUikitCases, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { NOT_APPLICABLE_NATIVE } from '../src/profiles/not-applicable-native.ts';
import { div, expectCatalogued, inputFor } from './helpers.ts';

const BASE = '.a { width: 10px; height: 10px; background-color: red; }';
const NATIVE = { ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;

/** The CSS of each entry, appended to BASE; the reference document blanks it with spaces, so every offset stays the same. */
const CASES: Record<string, string> = {
  cursor: '.a { cursor: pointer; }',
  'scrollbar-color': '.a { scrollbar-color: red blue; }',
  '-webkit-scrollbar': '.a::-webkit-scrollbar { background-color: #eee; }',
  '-webkit-scrollbar-thumb': '.a::-webkit-scrollbar-thumb { background: rgba(155, 155, 155, 0.5); border-color: red; color: blue; }',
  '-webkit-scrollbar-track': '.a::-webkit-scrollbar-track { background-color: #333; }',
};

function compile(css: string, targets: object) {
  const input = inputFor(css, (r) => [div(r, 'a', ['a'])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(input);
}

function emitCase(p: NativeProgram): EmitCase {
  return { id: 'case-1', fixture: 'fixture-1', direction: 'ltr', compilerDigest: 'digest', viewport: { width: 400, height: 300 }, program: p, expectedDigests: [{ dpr: 2, sha256: 'x'.repeat(64) }] };
}

/** The native programs and the emitted Swift and Kotlin of a compiled result with both native targets checked. */
function nativeOutput(c: object): { programs: unknown; swift: string; kotlin: string } {
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return {
    programs: p.programs,
    swift: emitUikitCases([emitCase(p.programs.uikit)]).map((f) => `${f.path}\n${f.text}`).join('\n'),
    kotlin: emitAndroidViewsCases([emitCase(p.programs['android-views'])]).map((f) => `${f.path}\n${f.text}`).join('\n'),
  };
}

const errors = (ds: readonly Diagnostic[]): Diagnostic[] => ds.filter((d) => d.severity === 'error');

describe('the not-applicable list', () => {
  it('has a test document for exactly the listed entries, each with a reason', () => {
    expect(NOT_APPLICABLE_NATIVE.map((e) => e.name).sort()).toEqual(Object.keys(CASES).sort());
    for (const e of NOT_APPLICABLE_NATIVE) expect(e.reason.length, e.name).toBeGreaterThan(20);
  });

  for (const [name, extra] of Object.entries(CASES)) {
    describe(name, () => {
      const css = `${BASE}\n${extra}`;
      const without = `${BASE}\n${' '.repeat(extra.length)}`;
      const start = css.indexOf(extra);

      it('compiles with no error on ios and android, and an info diagnostic per native target names it', () => {
        const c = compile(css, NATIVE);
        expectCatalogued(c.diagnostics);
        expect(errors(c.diagnostics)).toEqual([]);
        expect(c.targets).toEqual({ ios: 'checked', android: 'checked' });
        const infos = c.diagnostics.filter((d) => d.code === 'DRAGON_NOT_APPLICABLE_NATIVE');
        expect(infos.map((d) => d.target).sort()).toEqual(['android', 'ios']);
        for (const d of infos) {
          expect(d.severity).toBe('info');
          expect(d.message).toContain(name);
          if (d.origin.kind !== 'authored') throw new Error('unlocated');
          expect(d.origin.span.start).toBeGreaterThanOrEqual(start);
          expect(d.origin.span.end).toBeLessThanOrEqual(start + extra.length);
        }
      });

      it('leaves the native programs and the emitted Swift and Kotlin byte-identical to the document without it', () => {
        const ref = compile(without, NATIVE);
        expect(ref.diagnostics).toEqual([]);
        const a = nativeOutput(compile(css, NATIVE));
        const b = nativeOutput(ref);
        expect(a.swift).toBe(b.swift);
        expect(a.kotlin).toBe(b.kotlin);
        expect(JSON.stringify(a.programs)).toBe(JSON.stringify(b.programs));
      });

      it('is still refused on web, with the same diagnostics as a web-only project, scoped to web', () => {
        const webOnly = compile(css, { web: {} });
        expect(webOnly.targets).toEqual({ web: 'blocked' });
        const refusals = errors(webOnly.diagnostics);
        expect(refusals.length).toBeGreaterThan(0);
        for (const d of refusals) expect(d.target).toBeNull();
        expect(webOnly.diagnostics.some((d) => d.code === 'DRAGON_NOT_APPLICABLE_NATIVE')).toBe(false);
        const mixed = compile(css, { web: {}, ...NATIVE });
        expectCatalogued(mixed.diagnostics);
        expect(mixed.targets).toEqual({ web: 'blocked', ios: 'checked', android: 'checked' });
        const webErrors = errors(mixed.diagnostics);
        for (const d of webErrors) expect(d.target).toBe('web');
        expect(webErrors).toEqual(refusals.map((d) => ({ ...d, target: 'web' })));
        expect(compile(without, { web: {}, ...NATIVE }).targets).toEqual({ web: 'checked', ios: 'checked', android: 'checked' });
      });
    });
  }
});

describe('off the list, a declaration or rule is still refused on every target', () => {
  const OFF: Record<string, string> = {
    'scrollbar-width (hides scroll indicators)': '.a { scrollbar-width: none; }',
    '-webkit-appearance (changes form controls)': '.a { -webkit-appearance: none; }',
    'color-scheme (changes the UA colours)': '.a { color-scheme: dark; }',
    '::-webkit-slider-thumb (decides how a range paints)': '.a::-webkit-slider-thumb { width: 16px; }',
    '::-webkit-scrollbar-corner (not listed)': '.a::-webkit-scrollbar-corner { background: red; }',
    'a scrollbar rule hiding it with display': '.a::-webkit-scrollbar { display: none; }',
    'a scrollbar rule hiding it with a zero width': '.a::-webkit-scrollbar { width: 0; }',
    'a scrollbar rule hiding it with visibility (a refused declaration)': '.a::-webkit-scrollbar { visibility: hidden; }',
    'a scrollbar rule hiding it with a zero max-width': '.a::-webkit-scrollbar { max-width: 0; }',
    'a scrollbar rule hiding it with a zero inline-size': '.a::-webkit-scrollbar { inline-size: 0; }',
    'a scrollbar rule hiding it inside a nested @media': '.a::-webkit-scrollbar { @media (min-width: 1px) { display: none; } }',
    'a scrollbar rule setting a size, even a positive one (off the allowlist)': '.a::-webkit-scrollbar { width: 5px; }',
    'a scrollbar rule with a colour that needs resolving': '.a::-webkit-scrollbar { background-color: var(--c, red); }',
    'a scrollbar rule with a CSS-wide colour': '.a::-webkit-scrollbar { background-color: inherit; }',
    'a transparent scrollbar track': '.a::-webkit-scrollbar-track { background: transparent; }',
    'a scrollbar thumb with an alpha-0 colour': '.a::-webkit-scrollbar-thumb { background-color: rgba(0, 0, 0, 0); }',
    'a scrollbar thumb with a transparent border colour': '.a::-webkit-scrollbar-thumb { background-color: red; border-color: transparent; }',
    'a scrollbar thumb with a refused declaration (border-radius)': '.a::-webkit-scrollbar-thumb { background-color: red; border-radius: 20px; }',
    'scrollbar-color with a transparent track': '.a { scrollbar-color: red transparent; }',
    'scrollbar-color transparent transparent': '.a { scrollbar-color: transparent transparent; }',
    'scrollbar-color with an alpha-0 thumb': '.a { scrollbar-color: rgba(0, 0, 0, 0) red; }',
    'scrollbar-color with a colour that needs resolving': '.a { scrollbar-color: var(--c) red; }',
    'a selector list that also styles a real element': '.a, .a::-webkit-scrollbar { width: 5px; }',
    'a scrollbar pseudo-element followed by a pseudo-class': '.a::-webkit-scrollbar:hover { width: 5px; }',
  };
  for (const [what, extra] of Object.entries(OFF)) {
    it(what, () => {
      const c = compile(`${BASE}\n${extra}`, { web: {}, ...NATIVE });
      expectCatalogued(c.diagnostics);
      expect(c.targets).toEqual({ web: 'blocked', ios: 'blocked', android: 'blocked' });
      expect(errors(c.diagnostics).some((d) => d.target === null)).toBe(true);
      expect(c.diagnostics.some((d) => d.code === 'DRAGON_NOT_APPLICABLE_NATIVE')).toBe(false);
    });
  }

  it('will-change: transform stays refused on every target (a transform makes a containing block and stacking context)', () => {
    const c = compile(`${BASE}\n.a { will-change: transform; }`, { web: {}, ...NATIVE });
    expect(c.targets).toEqual({ web: 'blocked', ios: 'blocked', android: 'blocked' });
    expect(c.diagnostics.some((d) => d.code === 'DRAGON_NOT_APPLICABLE_NATIVE')).toBe(false);
  });
});

describe('a nested at-rule in a scrollbar rule', () => {
  it('keeps the rule refused everywhere, and its at-rule refusal keeps its related entries in a mixed project', () => {
    const css = `${BASE}\n.a::-webkit-scrollbar { @media (min-width: 1px) { zoom: 2; } }`;
    const atRule = (targets: object) => compile(css, targets).diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_NESTED_RULE' || d.code === 'DRAGON_UNSUPPORTED_AT_RULE');
    const webOnly = atRule({ web: {} });
    const mixed = atRule({ web: {}, ...NATIVE });
    expect(webOnly).toBeDefined();
    expect(mixed).toEqual(webOnly);
    expect(compile(css, { web: {}, ...NATIVE }).targets).toEqual({ web: 'blocked', ios: 'blocked', android: 'blocked' });
  });
});

describe('querySupport', () => {
  it('a resolved query of cursor on a native target answers not-applicable, like a possibilities query', () => {
    const c = compile(`${BASE}\n.a { cursor: pointer; }`, { web: {}, ...NATIVE });
    for (const target of ['ios', 'android'] as const) {
      expect(querySupport({ kind: 'resolved', result: c, target, node: 'a', instance: 'doc', assignment: [], property: 'cursor' })).toEqual({ kind: 'not-applicable', declaration: 'cursor', reason: expect.stringContaining(`cursor has no effect on ${target}`) });
    }
    expect(querySupport({ kind: 'resolved', result: c, target: 'web', node: 'a', instance: 'doc', assignment: [], property: 'cursor' }).kind).toBe('blocked');
  });

  it('answers not-applicable for a listed property on ios and android, never as supported, and keeps refusing it on web', () => {
    for (const target of [{ kind: 'ios', minimum: '15.0' }, { kind: 'android', minSdk: 31 }] as const) {
      const a = querySupport({ kind: 'possibilities', target, css: 'cursor: pointer' });
      expect(a).toEqual({ kind: 'not-applicable', declaration: 'cursor: pointer', reason: expect.stringContaining(`cursor has no effect on ${target.kind}`) });
      expect(querySupport({ kind: 'possibilities', target, css: 'scrollbar-width: none' }).kind).toBe('invalid-query');
    }
    expect(querySupport({ kind: 'possibilities', target: { kind: 'web' }, css: 'cursor: pointer' }).kind).toBe('invalid-query');
    // Only a query of exactly the one listed declaration is answered; another declaration beside it keeps the query invalid.
    expect(querySupport({ kind: 'possibilities', target: { kind: 'ios', minimum: '15.0' }, css: 'cursor: pointer; width: 1px' }).kind).toBe('invalid-query');
  });
});
