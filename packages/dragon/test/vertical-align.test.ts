// INL2b (notes/T059J-inl2.md ruling 7): the vertical-align longhand. The grammar replaces webref's css-inline-3 shorthand with
// Chrome 145's CSS2 syntax (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, the one override), the longhand is registered in
// css/properties/inline.ts (not inherited, an item property, layout only), and the lowering writes every value the engine reads,
// refuses -webkit-baseline-middle, and with the planted fault verticalAlignDropped writes baseline.
import { describe, expect, it } from 'vitest';
import type { InlineBox, LayoutBox } from '@dragon/layout';
import { properties as grammar, syntaxOverrides } from '../src/css/grammar.generated.ts';
import { INHERITED, LONGHANDS, PROPERTY_ASPECTS, PROPERTY_ROLE } from '../src/css/properties.ts';
import { INLINE_LONGHANDS } from '../src/css/properties/inline.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/internal.ts';
import { div, inputFor, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;

/** The engine's verticalAlign of the inline box inside div a, lowered from `.s { vertical-align: <value> }`. */
function lowered(value: string, faults: CompilerFaults = NO_FAULTS): unknown {
  const css = `body { font-family: Ahem; font-size: 20px; } .s { vertical-align: ${value}; }`;
  const input = inputFor(css, (r) => [div(r, 'a', ['a'], [text(r, 't', 'Xx'), { ...div(r, 's', ['s'], [text(r, 'u', 'yy')]), tag: 'span' }])]);
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults, profiles: 'derive', direction: 'ltr' }).compile(input);
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') return `refused: ${c.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`;
  const a = p.input.root.children[0] as LayoutBox;
  const block = (a.children[0] as LayoutBox).children.find((k) => k.kind === 'inline') as InlineBox | undefined;
  return block?.style.verticalAlign;
}

describe('INL2b vertical-align registration and grammar', () => {
  it('pins the syntax override list and the CSS2 syntax Chrome 145 parses', () => {
    expect(syntaxOverrides).toEqual(['vertical-align']);
    expect(grammar['vertical-align']).toEqual({
      syntax: 'baseline | sub | super | text-top | text-bottom | middle | top | bottom | -webkit-baseline-middle | <length-percentage>',
      initial: 'baseline',
      inherited: 'no',
    });
  });
  it('is one longhand after the TXT2-a family: not inherited, an item property, layout only', () => {
    expect([...INLINE_LONGHANDS]).toEqual(['vertical-align']);
    expect(LONGHANDS.slice(-1)).toEqual(['vertical-align']);
    expect(INHERITED.has('vertical-align')).toBe(false);
    expect(PROPERTY_ROLE['vertical-align']).toBe('item');
    expect(PROPERTY_ASPECTS['vertical-align']).toEqual({ layout: true, paint: false });
  });
});

describe('INL2b vertical-align lowering', () => {
  it('lowers each keyword, a px length, an em length (computed to px), a percentage and a calculation', () => {
    for (const k of ['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom']) expect(lowered(k), k).toEqual({ kind: 'keyword', value: k });
    expect(lowered('5px')).toEqual({ kind: 'px', value: 5 });
    expect(lowered('-0.5em')).toEqual({ kind: 'px', value: -10 });
    expect(lowered('50%')).toEqual({ kind: 'percent', value: 50 });
    expect(lowered('calc(10% + 2px)')).toMatchObject({ kind: 'calc' });
  });
  it('refuses -webkit-baseline-middle, which Chrome parses and Dragon does not lay out', () => {
    expect(String(lowered('-webkit-baseline-middle'))).toMatch(/^refused: .*DRAGON_LOWERING_FAILED vertical-align: -webkit-baseline-middle on s has no layout mapping/);
  });
  it('planted fault verticalAlignDropped lowers every value as baseline', () => {
    expect(lowered('sub', { ...NO_FAULTS, verticalAlignDropped: true })).toEqual({ kind: 'keyword', value: 'baseline' });
    expect(lowered('5px', { ...NO_FAULTS, verticalAlignDropped: true })).toEqual({ kind: 'keyword', value: 'baseline' });
  });
});
