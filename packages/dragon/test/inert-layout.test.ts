// vertical-align (css/properties/inline.ts), float and clear (css/properties/float.ts): non-inherited item longhands. vertical-align
// takes Chrome 145's grammar, and its lowering hands the engine the value only on an inline box, the one box that reads it (CSS2 §10.8.1).
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { initialValue, type ResolvedElement, type ResolvedValue } from '../src/analysis/resolve.ts';
import { INHERITED, LONGHANDS, PROPERTY_ROLE } from '../src/css/properties.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { CssValue } from '../src/css/values.ts';
import { NO_FAULTS } from '../src/faults.ts';
import { lowerStyle } from '../src/lower/ios-layout.ts';
import { referenceDataset } from '../src/ua/datasets.ts';

const SOURCE = { uri: 'dragon-source://test/vertical-align.css', revision: 'r1', hash: 'sha256:0' };

function declare(value: string): { values: CssValue[]; codes: string[] } {
  const css = `.a { vertical-align: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { values: (rules[0]?.declarations[0]?.longhands ?? []).map((l) => l.value), codes: diagnostics.map((d) => d.code) };
}

/** Values Chrome 145 parses, and some it drops (probed in Chrome: style.getPropertyValue is empty for a dropped value). */
const VALID = ['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom', '-webkit-baseline-middle', 'MIDDLE', '10px', '-10px', '1.5em', '50%', '0', 'calc(5% + 3px)', '2vw'];
const INVALID = ['5', 'first', 'central', 'center', 'first baseline', 'alphabetic', 'length', 'middle top', 'auto'];

/** An element whose every longhand is initial, with display and vertical-align set. */
function element(display: string, va: CssValue): ResolvedElement {
  const ua = referenceDataset();
  const value = (p: (typeof LONGHANDS)[number]): CssValue => (p === 'display' ? { kind: 'keyword', value: display } : p === 'vertical-align' ? va : initialValue(p, ua));
  return {
    kind: 'element',
    element: { kind: 'element', address: 'e', instance: 'doc', owner: 'App', tag: 'div', classes: [], attributes: new Map(), children: [], node: { kind: 'element', id: 'e', tag: 'div', classes: [], attributes: [], children: [], origin: { kind: 'unlocated', reason: 'test' } } },
    props: new Map(LONGHANDS.map((p) => [p, { value: value(p), origin: 'initial', span: null, declaration: null, declared: null, losing: [] } as ResolvedValue])),
    children: [],
  };
}

describe('float and clear', () => {
  it('are non-inherited item longhands whose initial value is none', () => {
    for (const p of ['float', 'clear'] as const) {
      expect(LONGHANDS, p).toContain(p);
      expect(INHERITED.has(p), p).toBe(false);
      expect(PROPERTY_ROLE[p], p).toBe('item');
      expect(initialValue(p, referenceDataset()), p).toEqual({ kind: 'keyword', value: 'none' });
    }
  });
});

describe('vertical-align', () => {
  it('is a non-inherited item longhand whose initial value is baseline', () => {
    expect(LONGHANDS).toContain('vertical-align');
    expect(INHERITED.has('vertical-align')).toBe(false);
    expect(PROPERTY_ROLE['vertical-align']).toBe('item');
    expect(initialValue('vertical-align', referenceDataset())).toEqual({ kind: 'keyword', value: 'baseline' });
  });
  it("accepts Chrome 145's values and the CSS-wide keywords", () => {
    for (const v of [...VALID, 'inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
      const { values, codes } = declare(v);
      expect(codes, v).toEqual([]);
      expect(values.length, v).toBe(1);
    }
    expect(declare('MIDDLE').values).toEqual([{ kind: 'keyword', value: 'middle' }]);
  });
  it('drops values Chrome 145 does not parse, as DRAGON_CSS_INVALID_VALUE', () => {
    for (const v of INVALID) expect(declare(v).codes, v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
  it('lowers to baseline on every box but an inline box, whatever it computes to', () => {
    for (const display of ['block', 'flex', 'grid']) {
      for (const va of [{ kind: 'keyword', value: 'middle' }, { kind: 'keyword', value: '-webkit-baseline-middle' }, { kind: 'length', value: 10, unit: 'px' }] as const) {
        expect(lowerStyle(element(display, va), NO_FAULTS, referenceDataset()).verticalAlign, `${display} ${JSON.stringify(va)}`).toEqual({ kind: 'keyword', value: 'baseline' });
      }
    }
  });
  it('lowers the value on an inline box, and refuses -webkit-baseline-middle there, which the engine has no mapping for', () => {
    const lower = (va: CssValue) => lowerStyle(element('inline', va), NO_FAULTS, referenceDataset()).verticalAlign;
    expect(lower({ kind: 'keyword', value: 'sub' })).toEqual({ kind: 'keyword', value: 'sub' });
    expect(lower({ kind: 'length', value: -4, unit: 'px' })).toEqual({ kind: 'px', value: -4 });
    expect(lower({ kind: 'percentage', value: 50 })).toEqual({ kind: 'percent', value: 50 });
    expect(() => lower({ kind: 'keyword', value: '-webkit-baseline-middle' })).toThrow(/vertical-align: -webkit-baseline-middle on e has no layout mapping/);
  });
});
