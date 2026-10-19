// TABLE (CSS2 §17): border-collapse, border-spacing over its two -webkit- longhands, caption-side, empty-cells and table-layout,
// appended after the mask family, with no layout or paint aspect. Each applies only to table boxes, which Dragon refuses, so every
// value Chrome 145 parses compiles on every target, and a negative spacing or an unknown keyword is invalid.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { properties as grammar } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS } from '../src/css/properties.ts';
import { MASK_LONGHANDS } from '../src/css/properties/mask.ts';
import { TABLE_LONGHANDS } from '../src/css/properties/table.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE } from '../src/css/animation-kinds/kinds.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Targets } from '../src/types.ts';
import { div, explainOne, inputFor, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/tb.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };

function parse(declaration: string): Diagnostic[] {
  const css = `.a { ${declaration}; }`;
  const diagnostics: Diagnostic[] = [];
  parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return diagnostics;
}

function compile(css: string, profiles: 'derive' | 'enforce' = 'derive') {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);
  return createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles, direction: 'ltr' }).compile(input);
}

const errors = (c: ReturnType<typeof compile>): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

describe('table properties: registry and parse', () => {
  it('follow the mask family, inherited but for table-layout, with no layout or paint aspect', () => {
    expect([...TABLE_LONGHANDS]).toEqual(['border-collapse', '-webkit-border-horizontal-spacing', '-webkit-border-vertical-spacing', 'caption-side', 'empty-cells', 'table-layout']);
    expect(LONGHANDS[LONGHANDS.indexOf('border-collapse') - 1]).toBe(MASK_LONGHANDS[MASK_LONGHANDS.length - 1]);
    for (const p of TABLE_LONGHANDS) {
      expect(INHERITED.has(p), p).toBe(p !== 'table-layout');
      expect(PROPERTY_ASPECTS[p], p).toEqual({ layout: false, paint: false });
    }
    for (const p of ['border-collapse', 'caption-side', 'empty-cells', 'table-layout'] as const) expect(ANIMATION_KINDS[p], p).toBe(DISCRETE);
    expect(grammar['-webkit-border-horizontal-spacing']?.initial).toBe('0');
  });

  it('parses the keywords and non-negative lengths Chrome 145 parses, in any case, and the CSS-wide keywords; the rest is invalid', () => {
    for (const d of ['border-collapse: collapse', 'border-collapse: SEPARATE', 'border-spacing: 0', 'border-spacing: 4px', 'border-spacing: 1em 2rem', 'border-spacing: calc(1px + 1em)',
      '-webkit-border-horizontal-spacing: 3px', '-webkit-border-vertical-spacing: 0', 'caption-side: bottom', 'caption-side: Top', 'empty-cells: hide', 'table-layout: fixed',
      'border-spacing: inherit', 'table-layout: unset', 'border-collapse: initial']) expect(parse(d), d).toEqual([]);
    for (const d of ['border-collapse: red', 'border-spacing: -1px', 'border-spacing: 1px 2px 3px', 'border-spacing: 10%', 'caption-side: left', 'empty-cells: none', 'table-layout: 1px']) {
      expect(parse(d).map((x) => x.code), d).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    }
  });
});

describe('table properties: computed values', () => {
  for (const [css, prop, a, b] of [
    ['.a { border-collapse: collapse; }', 'border-collapse', 'collapse', 'collapse'],
    ['.a { border-spacing: 4px; }', '-webkit-border-horizontal-spacing', '4px', '4px'],
    ['.a { border-spacing: 1px 2em; }', '-webkit-border-vertical-spacing', '40px', '40px'],
    ['.a { table-layout: fixed; }', 'table-layout', 'fixed', 'auto'],
    ['.a { table-layout: fixed; } .b { table-layout: inherit; }', 'table-layout', 'fixed', 'fixed'],
    ['.a { caption-side: bottom; } .b { caption-side: initial; }', 'caption-side', 'bottom', 'top'],
    ['.a { --e: hide; empty-cells: var(--e); }', 'empty-cells', 'hide', 'hide'],
  ] as const) {
    it(`${css} computes ${prop} ${a} and ${b}, and compiles on every target`, () => {
      const c = compile(`body { font-size: 20px; } ${css}`);
      expect(errors(c)).toEqual([]);
      expect(explainOne(c, 'web', 'a', prop).value).toBe(a);
      expect(explainOne(c, 'web', 'b', prop).value).toBe(b);
      expect(c.outputs.ios.kind).not.toBe('blocked');
      expect(c.outputs.android.kind).not.toBe('blocked');
    });
  }

  it('a table box is still refused on every target by the support profiles, so no box Dragon builds reads these properties', () => {
    for (const d of ['table', 'inline-table', 'table-cell', 'table-caption', 'table-row']) {
      const c = compile(`.a { display: ${d}; }`, 'enforce');
      expect(errors(c).filter((x) => x.message.startsWith(`display: ${d} is unsupported`)).map((x) => x.target).sort(), d).toEqual(['android', 'ios', 'web']);
    }
  });
});
