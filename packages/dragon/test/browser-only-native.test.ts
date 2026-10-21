// BROWSER-ONLY (owner ruling 2026-10-21): every entry of the browser-only list is a DRAGON_BROWSER_ONLY_NATIVE error on ios and
// android, and web keeps its own refusal. Initial values and the UA sheet's root name still compile everywhere.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { BROWSER_ONLY_NATIVE } from '../src/profiles/browser-only-native.ts';
import { div, expectCatalogued, inputFor } from './helpers.ts';

const BASE = '.a { width: 10px; height: 10px; background-color: red; }';
const ALL = { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;

const CASES: Record<string, string> = {
  'view-transition-name': '.a { view-transition-name: hero; }',
  'view-transition-class': '.a { view-transition-class: card; }',
  'view-transition-group': '.a { view-transition-group: contain; }',
  '@view-transition': '@view-transition { navigation: auto; }',
};

function compile(css: string, targets: object) {
  const input = inputFor(`${BASE}\n${css}`, (r) => [div(r, 'a', ['a'])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' }).compile(input);
}

const errorsOn = (ds: readonly Diagnostic[], t: string): Diagnostic[] => ds.filter((d) => d.severity === 'error' && (d.target === t || d.target === null));

describe('the browser-only list', () => {
  it('has a test document for exactly the listed entries, each with a reason', () => {
    expect(BROWSER_ONLY_NATIVE.map((e) => e.name)).toEqual(Object.keys(CASES));
    for (const e of BROWSER_ONLY_NATIVE) expect(e.reason, e.name).toMatch(/browser-only/);
  });

  for (const [name, css] of Object.entries(CASES)) {
    it(`${name}: a browser-only error on ios and android, web's own refusal on web`, () => {
      const c = compile(css, ALL);
      expectCatalogued(c.diagnostics);
      for (const t of ['ios', 'android']) {
        const errors = errorsOn(c.diagnostics, t);
        expect(errors.map((d) => d.code), t).toEqual(['DRAGON_BROWSER_ONLY_NATIVE']);
        expect(errors[0]?.message).toContain(`cannot build for ${t}: view transitions are browser-only`);
        expect(errors[0]?.origin.kind).toBe('authored');
      }
      const web = [...new Set(errorsOn(c.diagnostics, 'web').map((d) => d.code))];
      expect(web).toEqual([name.startsWith('@') ? 'DRAGON_UNSUPPORTED_AT_RULE' : 'DRAGON_UNSUPPORTED_VALUE']);
    });

    it(`${name}: native alone still fails the build`, () => {
      const c = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 } });
      expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.target}`).sort()).toEqual(['DRAGON_BROWSER_ONLY_NATIVE android', 'DRAGON_BROWSER_ONLY_NATIVE ios']);
    });
  }

  it('the initial values compile on every target', () => {
    const c = compile('.a { view-transition-name: none; view-transition-class: none; view-transition-group: normal; }', ALL);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('reports each declaration once on a native target, though both the value check and the analysis find it', () => {
    const css = '.a { view-transition-name: hero; view-transition-class: card; }';
    const c = compile(css, { ios: { minimum: '15.0' } });
    const found = c.diagnostics.filter((d) => d.code === 'DRAGON_BROWSER_ONLY_NATIVE');
    const text = `${BASE}\n${css}`;
    expect(found.map((d) => (d.origin.kind === 'authored' ? text.slice(d.origin.span.start, d.origin.span.end) : null)).sort()).toEqual(['card', 'hero']);
  });

  it('a value that arrives through var() is a browser-only error too', () => {
    const c = compile('.a { --n: hero; view-transition-name: var(--n); }', { ios: { minimum: '15.0' } });
    const errors = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((d) => d.code === 'DRAGON_BROWSER_ONLY_NATIVE'), errors.map((d) => `${d.code} ${d.message}`).join('\n')).toBe(true);
  });
});
