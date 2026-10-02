// INL-U: the phrasing keys (br, strong, b, em, i, code, small, sub, sup, label) in tables of their own, and their computed
// font sizes under Ahem and monospace parents (elementKeyFontSizes).
import { describe, expect, it } from 'vitest';
import { LONGHANDS } from '../src/css/properties.ts';
import * as dark from '../src/ua/chrome-145.darwin-arm64.dark.generated.ts';
import * as light from '../src/ua/chrome-145.darwin-arm64.generated.ts';
import { phrasingDataFor, UNCAPTURED_LONGHANDS } from '../src/ua/datasets.ts';

const PHRASING = ['br', 'strong', 'b', 'em', 'i', 'code', 'small', 'sub', 'sup', 'label'] as const;
const FAMILIES = ['Ahem', 'monospace'];
const PX_PARENTS = [10, 16, 17.5, 23.3];
const PARENTS = ['10px', '16px', '17.5px', '23.3px', 'medium', '2em', 'larger'];
/** The medium keyword's size per family (Chrome's default and default fixed font sizes). */
const MEDIUM: Record<string, number> = { Ahem: 16, monospace: 13 };
/** Parents relative to the medium keyword, as a factor of it: Chrome keeps these keyword-relative. */
const KEYWORD_RELATIVE: Record<string, number> = { medium: 1, '2em': 2, larger: 1.2 };
/** Chrome's getComputedStyle serialization of a px length: six significant digits. */
const px = (n: number): string => `${Number(n.toPrecision(6))}px`;
/** The parent's own computed size under each elementKeyFontSizes parent. */
const parentSize = (family: string, parent: string): number => {
  const factor = KEYWORD_RELATIVE[parent];
  return factor === undefined ? Number.parseFloat(parent) : (MEDIUM[family] as number) * factor;
};

describe('phrasing keys (INL-U)', () => {
  // INL2b (T059J-INL2b-1): sub and sup are also captured tags, so the captured-tag tables list them too.
  it('are captured in tables of their own, light and dark; no other table lists them but sub and sup in the captured-tag tables', () => {
    for (const ds of [light, dark]) {
      for (const table of [ds.phrasingKeySpecs, ds.phrasingKeyComputed, ds.phrasingKeyLonghands, ds.phrasingKeyDeclared, ds.phrasingKeyContexts, ds.phrasingKeyTextFonts, ds.phrasingKeyUnmodelled, ds.phrasingKeyForced, ds.elementKeyFontSizes]) {
        expect(Object.keys(table)).toEqual([...PHRASING]);
      }
      for (const table of [ds.computed, ds.userAgentLonghands, ds.userAgentDeclared, ds.userAgentContexts, ds.userAgentTextFonts, ds.elementKeySpecs, ds.elementKeyComputed, ds.userAgentUnmodelled, ds.userAgentForced, ds.replacedKeySpecs]) {
        const captured = table === ds.computed || table === ds.userAgentLonghands || table === ds.userAgentDeclared || table === ds.userAgentContexts || table === ds.userAgentTextFonts || table === ds.userAgentUnmodelled || table === ds.userAgentForced;
        for (const k of PHRASING) expect(k in table, k).toBe(captured && (k === 'sub' || k === 'sup'));
      }
    }
    for (const k of PHRASING) expect(light.phrasingKeySpecs[k]).toEqual({ tag: k, attributes: {} });
  });
  it('cover every longhand, with the computed values Chrome gives each key under the medium root', () => {
    for (const k of PHRASING) {
      for (const p of LONGHANDS.filter((q) => !(UNCAPTURED_LONGHANDS as readonly string[]).includes(q))) expect(light.phrasingKeyComputed[k][p], `${k} ${p}`).toBeTypeOf('string');
      expect(light.phrasingKeyComputed[k].display, k).toBe('inline');
    }
    expect(light.phrasingKeyComputed.code['font-family']).toBe('monospace');
    expect(light.phrasingKeyComputed.code['font-size']).toBe('13px');
    for (const k of ['small', 'sub', 'sup'] as const) expect(light.phrasingKeyComputed[k]['font-size'], k).toBe('13.3333px');
  });
  it('pin the UA longhands, declared values, text fonts, unmodelled and forced properties, and contexts', () => {
    expect(light.phrasingKeyLonghands).toEqual({
      br: [], strong: [], b: [], em: [], i: [], code: ['font-family'], small: ['font-size'], sub: ['font-size', 'vertical-align'], sup: ['font-size', 'vertical-align'], label: [],
    });
    const both = (row: Record<string, string>) => ({ ltr: row, rtl: row });
    expect(light.phrasingKeyDeclared).toEqual({
      br: both({}), strong: both({}), b: both({}), em: both({}), i: both({}),
      code: both({ 'font-family': 'monospace' }),
      small: both({ 'font-size': 'smaller' }), sub: both({ 'font-size': 'smaller', 'vertical-align': 'sub' }), sup: both({ 'font-size': 'smaller', 'vertical-align': 'super' }),
      label: both({}),
    });
    expect(light.phrasingKeyTextFonts).toEqual({
      br: {}, strong: { 'font-weight': '700' }, b: { 'font-weight': '700' }, em: { 'font-style': 'italic' }, i: { 'font-style': 'italic' },
      code: {}, small: {}, sub: {}, sup: {}, label: {},
    });
    expect(light.phrasingKeyUnmodelled).toEqual({
      br: both({}), strong: both({}), b: both({}), em: both({}), i: both({}), code: both({}), small: both({}),
      // INL2b: vertical-align is now modelled (a longhand), so sub and sup have no unmodelled UA property left.
      sub: both({}), sup: both({}), label: both({ cursor: 'default' }),
    });
    for (const k of PHRASING) {
      expect(light.phrasingKeyForced[k], k).toEqual(both({}));
      expect(light.phrasingKeyContexts[k], k).toEqual([]);
    }
    for (const dirs of Object.values(light.phrasingKeyUnmodelled)) {
      for (const p of Object.keys(dirs.ltr)) expect((LONGHANDS as readonly string[]).includes(p), p).toBe(false);
    }
  });
  it('are the same in the dark dataset, which has no color on any phrasing key', () => {
    expect(dark.phrasingKeyDeclared).toEqual(light.phrasingKeyDeclared);
    expect(dark.phrasingKeyTextFonts).toEqual(light.phrasingKeyTextFonts);
    expect(dark.phrasingKeyUnmodelled).toEqual(light.phrasingKeyUnmodelled);
    expect(dark.phrasingKeyContexts).toEqual(light.phrasingKeyContexts);
    expect(dark.elementKeyFontSizes).toEqual(light.elementKeyFontSizes);
  });
});

describe('elementKeyFontSizes (INL-U)', () => {
  it('has every key under both families at 10, 16, 17.5 and 23.3px, the medium keyword, 2em and larger', () => {
    for (const k of PHRASING) {
      expect(Object.keys(light.elementKeyFontSizes[k]), k).toEqual(FAMILIES);
      for (const f of FAMILIES) expect(Object.keys(light.elementKeyFontSizes[k][f] ?? {}), `${k} ${f}`).toEqual(PARENTS);
    }
  });
  it('small, sub and sup are the parent size divided by 1.2 (smaller), from px and keyword-relative parents alike', () => {
    for (const k of ['small', 'sub', 'sup'] as const) {
      for (const f of FAMILIES) {
        for (const parent of PARENTS) expect(light.elementKeyFontSizes[k][f]?.[parent], `${k} ${f} ${parent}`).toBe(px(parentSize(f, parent) / 1.2));
      }
    }
    expect(light.elementKeyFontSizes.small.Ahem?.['23.3px']).toBe('19.4167px');
  });
  it('code keeps a px parent size, and takes 13px times the factor under a size relative to the medium keyword', () => {
    for (const f of FAMILIES) {
      for (const n of PX_PARENTS) expect(light.elementKeyFontSizes.code[f]?.[`${n}px`], `${f} ${n}`).toBe(px(n));
      for (const [parent, factor] of Object.entries(KEYWORD_RELATIVE)) expect(light.elementKeyFontSizes.code[f]?.[parent], `${f} ${parent}`).toBe(px(13 * factor));
    }
    expect(light.elementKeyFontSizes.code.Ahem?.medium).toBe('13px');
  });
  it('br, strong, b, em, i and label inherit the parent size', () => {
    for (const k of ['br', 'strong', 'b', 'em', 'i', 'label'] as const) {
      for (const f of FAMILIES) {
        for (const parent of PARENTS) expect(light.elementKeyFontSizes[k][f]?.[parent], `${k} ${f} ${parent}`).toBe(px(parentSize(f, parent)));
      }
    }
  });
});

describe('phrasingDataFor (INL-U)', () => {
  it('gives the light and dark phrasing tables on the capture platform and refuses elsewhere', () => {
    const l = phrasingDataFor('darwin-arm64');
    const d = phrasingDataFor('darwin-arm64', 'dark');
    expect(l.kind === 'ok' && l.data.elementKeyFontSizes).toBe(light.elementKeyFontSizes);
    expect(d.kind === 'ok' && d.data.colorScheme).toBe('dark');
    expect(phrasingDataFor('linux-x64')).toMatchObject({ kind: 'refused', code: 'no-ua-dataset', platform: 'linux-x64' });
  });
});
