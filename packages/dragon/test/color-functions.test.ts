/// <reference path="../src/css/css-tree.d.ts" />
// COL4: color-mix(), relative colours and the absolute lab(), lch(), oklab(), oklch(), hwb() and color() colours, ported from Blink
// (css/color-space.ts), checked against Chrome 145's computed serialization and painted 8-bit colour of each probed input.
import { readFileSync } from 'node:fs';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import { parseColorValue, relativeColorGrammarText, serializeColor } from '../src/css/color.ts';

const first = (text: string): CssNode => (parse(text, { context: 'value' })['children'] as { toArray(): CssNode[] }).toArray()[0] as CssNode;

type Row = { readonly input: string; readonly computed: string; readonly rgba: readonly [number, number, number, number] | null };
const PROBE = JSON.parse(readFileSync(new URL('data/chrome-145-color-functions.json', import.meta.url), 'utf8')) as { readonly rows: readonly Row[] };

describe('colour functions (COL4)', () => {
  it.each(PROBE.rows.map((r) => [r.input, r] as const))('%s computes and paints as in Chrome 145', (_, row) => {
    const r = parseColorValue(first(row.input));
    if (row.rgba === null) {
      expect(row.computed).toBe('INVALID');
      expect(r.ok).toBe(false);
      return;
    }
    if (!r.ok || r.kind !== 'rgba') throw new Error(r.ok ? 'a keyword' : r.reason);
    expect(r.css ?? serializeColor(r.value)).toBe(row.computed);
    expect([r.value.r, r.value.g, r.value.b, r.value.alpha]).toEqual(row.rgba);
  });

  // Probed: Chrome blends a translucent colour outside sRGB before it clamps, so no 8-bit colour paints the same.
  it.each(['color(display-p3 1 0 0 / 0.5)', 'color-mix(in lab, #f80 40%, transparent)', 'lch(80 112.9 238.8 / 0.24)', 'lab(50% 100 59 / 0.5)'])('%s is refused', (input) => {
    const r = parseColorValue(first(input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('outside the sRGB gamut');
  });

  it('refuses currentcolor inside a colour function', () => {
    const r = parseColorValue(first('color-mix(in srgb, currentcolor, blue)'));
    expect(r.ok).toBe(false);
  });

  it('marks the colours Chrome animates in oklab', () => {
    const oklab = (text: string): boolean => {
      const r = parseColorValue(first(text));
      return r.ok && r.kind === 'rgba' && r.oklab === true;
    };
    expect(oklab('rgb(10 20 30)')).toBe(false);
    expect(oklab('hwb(200 10% 20%)')).toBe(false);
    expect(oklab('rgb(none 20 30)')).toBe(true);
    expect(oklab('color-mix(in srgb, red, blue)')).toBe(true);
    expect(oklab('lab(50 20 -30)')).toBe(true);
  });

  it('substitutes relative colours for the grammar check', () => {
    expect(relativeColorGrammarText(parse('rgb(from red r g b / 50%)', { context: 'value' }))).toBe('#000');
    expect(relativeColorGrammarText(parse('color-mix(in srgb, hsl(from red h s l), blue)', { context: 'value' }))).toBe('color-mix(in srgb , #000 , blue)');
    expect(relativeColorGrammarText(parse('red', { context: 'value' }))).toBeNull();
  });
});
