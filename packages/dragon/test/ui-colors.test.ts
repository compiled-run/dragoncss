// caret-color and accent-color (css-ui-4 §6.2, §6.3): longhands appended after appearance, inherited, initial auto, auto | <color>,
// with no layout or paint aspect on any supported tag (none is editable or a form control). caret-color is uncaptured, as Chrome
// resolves its auto to color; web output writes both on every element of a case where either is not auto, so an auto inherits none.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { UI_COLORS_LONGHANDS } from '../src/css/properties/ui-colors.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { UNCAPTURED_LONGHANDS } from '../src/ua/uncaptured.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/ui.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(value: string, name: string) {
  const css = `.a { ${name}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { codes: diagnostics.map((d) => d.code), longhands: rules[0]?.declarations[0]?.longhands ?? [] };
}

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

function webCss(c: ReturnType<typeof compile>): string {
  const out = c.outputs.web;
  if (out.kind !== 'ready') throw new Error(out.kind);
  return (out.files[0] as { text: string }).text;
}

describe('caret-color and accent-color: registry and parse', () => {
  it('follow appearance, inherited, with no layout or paint aspect, unadmitted, initial auto', () => {
    expect([...UI_COLORS_LONGHANDS]).toEqual(['caret-color', 'accent-color']);
    expect(LONGHANDS.slice(LONGHANDS.indexOf('appearance') + 1, LONGHANDS.indexOf('appearance') + 3)).toEqual(['caret-color', 'accent-color']);
    for (const p of UI_COLORS_LONGHANDS) {
      expect(INHERITED.has(p), p).toBe(true);
      expect(PROPERTY_ASPECTS[p], p).toEqual({ layout: false, paint: false });
      expect(ANIMATION_KINDS[p], p).toBe(UNADMITTED);
      expect(grammar[p]?.initial, p).toBe('auto');
      expect(grammar[p]?.syntax, p).toBe('auto | <color>');
    }
    expect((UNCAPTURED_LONGHANDS as readonly string[]).includes('caret-color')).toBe(true);
    expect((UNCAPTURED_LONGHANDS as readonly string[]).includes('accent-color')).toBe(false);
  });

  it('accept auto and the colour subset, drop two values or a non-colour, and refuse colours outside the subset', () => {
    for (const name of UI_COLORS_LONGHANDS) {
      for (const v of ['auto', 'AUTO', 'red', 'currentcolor', 'transparent', '#abc', 'rgb(1 2 3 / 50%)', 'hsl(120 50% 50%)', 'inherit', 'var(--x)']) expect(parse(v, name).codes, `${name}: ${v}`).toEqual([]);
      for (const v of ['auto auto', 'red blue', 'red auto', 'none', '1px']) expect(parse(v, name).codes, `${name}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      for (const v of ['color-mix(in srgb, red, blue)', 'oklch(0.5 0.1 120)']) expect(parse(v, name).codes, `${name}: ${v}`).not.toEqual([]);
    }
  });
});

describe('caret-color and accent-color: compile', () => {
  it('compile on every target without a diagnostic of their own', () => {
    for (const v of ['auto', 'red', 'currentcolor', 'transparent']) {
      const c = compile(`.a { caret-color: ${v}; accent-color: ${v}; }`, NATIVE);
      expect(c.diagnostics.filter((d) => d.severity === 'error'), v).toEqual([]);
    }
  });

  it('writes both on every element only where one is not auto', () => {
    expect(webCss(compile('.a { caret-color: auto; accent-color: AUTO; }'))).not.toMatch(/caret-color|accent-color/);
    const some = webCss(compile('.a { caret-color: red; } .b { caret-color: auto; }'));
    expect(some.split('  caret-color: ').length - 1).toBe(some.split('  accent-color: ').length - 1);
    expect(some).toContain('  caret-color: rgb(255, 0, 0);');
    expect(some).toContain('  caret-color: auto;');
  });
});
