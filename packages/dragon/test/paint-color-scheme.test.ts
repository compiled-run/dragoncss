// PNT1 color-scheme (css-color-adjust-1 §2): parsing and Chrome 145's serialization (idents in order, only last, light and dark
// lowercase, custom idents as written), inheritance, the used scheme Chrome computes under a light preference, the dark-root
// refusal, and the guard that no captured UA colour depends on the scheme (so a dark element needs no dark UA table yet).
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { COLOR_LONGHANDS } from '../src/css/properties.ts';
import { colorSchemeOf, usedColorSchemeOf } from '../src/css/properties/effects.ts';
import { darkDatasetFor, REFERENCE_PLATFORM, uaDatasetFor } from '../src/ua/datasets.ts';
import type { CapturedTag } from '../src/ua/datasets.ts';
import { div, expectCatalogued, explainOne, inputFor } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/cs.css', revision: 'r1', hash: 'sha256:0' };

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[] } {
  const css = `.a { color-scheme: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics };
}

const compile = (css: string) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; color: rgb(1, 2, 3); } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]));

describe('color-scheme: parse and computed values (Chrome 145 getComputedStyle)', () => {
  // [value, Chrome 145's computed string] (probed with the pinned Chrome)
  const cases: [string, string][] = [
    ['normal', 'normal'], ['light', 'light'], ['dark', 'dark'], ['light dark', 'light dark'], ['dark light', 'dark light'],
    ['only light', 'light only'], ['light only', 'light only'], ['dark only', 'dark only'], ['only dark light', 'dark light only'],
    ['foo', 'foo'], ['light foo', 'light foo'], ['light light', 'light light'], ['LIGHT', 'light'], ['Dark Light', 'dark light'],
    ['FOO', 'FOO'], ['Foo light', 'Foo light'], ['dark Only', 'dark only'], ['ONLY dark', 'dark only'], ['none', 'none'], ['light none', 'light none'],
  ];
  for (const [value, want] of cases) {
    it(`color-scheme: ${value} computes to ${want}`, () => {
      const c = compile(`.a { height: 5px; color-scheme: ${value}; }`);
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(explainOne(c, 'ios', 'a', 'color-scheme').value).toBe(want);
    });
  }
  it('only alone, only twice, normal in a list, default, a comma and a string are invalid, as in Chrome', () => {
    for (const v of ['only', 'normal only', 'only only light', 'light only only', 'only normal', 'normal light', 'default', 'light default', 'light, dark', '"dark"']) {
      const { declaration, diagnostics } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });
  it('a custom ident holding an escaped space is refused on the token (the list text is space-separated)', () => {
    const { declaration, diagnostics } = declare('light x\\ dark');
    expect(declaration).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    expectCatalogued(diagnostics);
  });
  it('is inherited', () => {
    const c = compile('.a { height: 5px; color-scheme: dark only; }');
    expect(explainOne(c, 'ios', 'b', 'color-scheme')).toMatchObject({ value: 'dark only', cascade: 'inherited' });
    expect(explainOne(c, 'ios', 'html', 'color-scheme').value).toBe('normal');
  });
});

describe('color-scheme: the used scheme and its refusals', () => {
  it('is dark exactly when the list holds dark and no light, under the light preference Chrome captures with (probed with CanvasText)', () => {
    const want: [string, 'light' | 'dark'][] = [['normal', 'light'], ['light', 'light'], ['dark', 'dark'], ['light dark', 'light'], ['dark light', 'light'], ['dark only', 'dark'], ['foo', 'light'], ['foo dark', 'dark'], ['light only', 'light']];
    for (const [v, scheme] of want) {
      const s = v === 'normal' ? colorSchemeOf({ kind: 'keyword', value: 'normal' }) : colorSchemeOf({ kind: 'other', type: 'color-scheme-list', text: v });
      expect(usedColorSchemeOf(s, false), v).toBe(scheme);
    }
    expect(usedColorSchemeOf(colorSchemeOf({ kind: 'other', type: 'color-scheme-list', text: 'light dark' }), true)).toBe('dark');
  });
  it('a dark root is refused on every target, located at the declaration; a dark body with an explicit colour compiles', () => {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor('html { color-scheme: dark; } body { margin: 0; color: red; }', (r) => [div(r, 'a', [])]));
    const errs = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errs.map((d) => d.target).sort()).toEqual(['ios', 'web']);
    expect(errs[0]?.message).toMatch(/^the root html has a dark used color scheme/);
    expectCatalogued(errs);
    const ok = compile('body { color-scheme: dark; }');
    expect(ok.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
  it('a dark element whose color is initial (CanvasText in dark) is refused', () => {
    const c = compile('.a { height: 5px; color-scheme: dark; color: initial; }');
    const errs = c.diagnostics.filter((d) => d.severity === 'error');
    expect(errs.map((d) => d.target).sort()).toEqual(['ios', 'web']);
    expect(errs[0]?.message).toMatch(/a has a dark used color scheme and an initial color/);
  });
  it('no captured UA colour of a supported tag differs between the light and the dark dataset except by the inherited root colour', () => {
    const light = uaDatasetFor(REFERENCE_PLATFORM);
    const dark = darkDatasetFor(REFERENCE_PLATFORM);
    if (light.kind !== 'ok' || dark.kind !== 'ok') throw new Error('no reference datasets');
    for (const tag of Object.keys(light.dataset.userAgentDeclared) as CapturedTag[]) {
      for (const dir of ['ltr', 'rtl'] as const) {
        for (const p of [...COLOR_LONGHANDS, 'outline-color']) {
          expect(dark.dataset.userAgentDeclared[tag][dir][p], `${tag} ${dir} ${p}`).toBe(light.dataset.userAgentDeclared[tag][dir][p]);
        }
      }
    }
  });
});
