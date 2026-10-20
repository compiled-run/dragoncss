/// <reference path="../src/css/css-tree.d.ts" />
// COL4: color-mix(), relative colours and the absolute lab(), lch(), oklab(), oklch(), hwb() and color() colours, ported from Blink
// (css/color-space.ts), checked against Chrome 145's computed serialization and painted 8-bit colour of each probed input.
import { readFileSync } from 'node:fs';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import { computedColorMatches, parseColorValue, parseComputedColor, relativeColorGrammarText, serializeColor } from '../src/css/color.ts';

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

  // Probed on Chrome 145: these compute and paint as below.
  it.each([
    ['color(display-p3-linear 0.2 0.5 0.1)', 'color(display-p3-linear 0.2 0.5 0.1)', [102, 190, 73, 255]],
    ['color(display-p3-linear 0.01 0.02 0.03)', 'color(display-p3-linear 0.01 0.02 0.03)', [21, 39, 49, 255]],
    ['color(from rgb(10 200 30) display-p3-linear r calc(g / 2) b)', 'color(display-p3-linear 0.10512 0.279231 0.0536779)', [73, 146, 52, 255]],
    ['color-mix(in display-p3-linear, red, blue)', 'color(display-p3-linear 0.411271 0.0165849 0.463734)', [188, 0, 188, 255]],
  ] as const)('takes display-p3-linear, which Chrome 145 parses: %s', (input, computed, rgba) => {
    const r = parseColorValue(first(input));
    if (!r.ok || r.kind !== 'rgba') throw new Error(r.ok ? 'a keyword' : r.reason);
    expect([r.css, [r.value.r, r.value.g, r.value.b, r.value.alpha]]).toEqual([computed, rgba]);
  });

  // Chrome computes calc(1 / 0) in a relative channel to color(srgb 1.33444e+36 0 0) and calc(g / 0) to calc(NaN).
  it.each(['rgb(from red calc(1 / 0) g b)', 'color(from red srgb r calc(g / 0) b)', 'oklch(from red l c calc(h / 0))'])('refuses %s, an infinite or NaN channel', (input) => {
    const r = parseColorValue(first(input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('infinite or NaN');
  });

  it('writes web output at nine significant digits, which Chrome reparses to the same colour and paints the same bytes', () => {
    // Probed on Chrome 145: the six-digit computed text paints (127, 108, 119); the nine-digit text paints the authored (127, 109, 120).
    const r = parseColorValue(first('color-mix(in srgb, rgb(183 4 212) 50%, rgb(71 213 27))'));
    if (!r.ok || r.kind !== 'rgba') throw new Error(r.ok ? 'a keyword' : r.reason);
    expect([r.css, r.web, r.value]).toEqual(['color(srgb 0.498039 0.42549 0.468627)', 'color(srgb 0.498039246 0.425490201 0.468627453)', { r: 127, g: 109, b: 120, alpha: 255 }]);
  });

  it('marks the hsl() and hwb() colours whose sRGB channels fall between 8-bit steps, which Chrome animates in float', () => {
    const fractional = (text: string): boolean => {
      const r = parseColorValue(first(text));
      return r.ok && r.kind === 'rgba' && r.fractional === true;
    };
    expect(fractional('hwb(10 20% 30%)')).toBe(true);
    expect(fractional('hsl(120 100% 25%)')).toBe(true);
    expect(fractional('hsl(0 100% 50%)')).toBe(false);
    expect(fractional('hwb(0 0% 0%)')).toBe(false);
    expect(fractional('rgb(10 20 30)')).toBe(false);
  });

  it('reads Chrome\'s computed colour function text back to the colour it paints, one step off only at a .5 step of 255', () => {
    expect(parseComputedColor('color(srgb 0.3 0 0.7)')).toEqual({ r: 77, g: 0, b: 179, alpha: 255 });
    expect(parseComputedColor('lab(52.1491 -9.43703 56.0256 / 0.5)')).toEqual({ r: 128, g: 128, b: 0, alpha: 128 });
    // Not its own computed serialization.
    expect(parseComputedColor('color(srgb 0.30 0 0.7)')).toBeNull();
    // Green is 191.5: the text reparses to 191 where Chrome paints 192.
    expect(computedColorMatches('color(srgb 0.5 0.75098 0.5)', { r: 128, g: 192, b: 128, alpha: 255 })).toBe(true);
    expect(computedColorMatches('color(srgb 0.5 0.75098 0.5)', { r: 128, g: 189, b: 128, alpha: 255 })).toBe(false);
    // A channel off a half step must match exactly, so the colour-only plant (red one step up) is still seen.
    expect(computedColorMatches('color(srgb 0.2 0.4 0.6)', { r: 51, g: 102, b: 153, alpha: 255 })).toBe(true);
    expect(computedColorMatches('color(srgb 0.2 0.4 0.6)', { r: 52, g: 102, b: 153, alpha: 255 })).toBe(false);
    expect(computedColorMatches('rgb(1, 2, 3)', { r: 1, g: 2, b: 3, alpha: 255 })).toBe(true);
    expect(computedColorMatches('rgb(1, 2, 3)', { r: 2, g: 2, b: 3, alpha: 255 })).toBe(false);
  });

  it('substitutes relative colours for the grammar check', () => {
    expect(relativeColorGrammarText(parse('rgb(from red r g b / 50%)', { context: 'value' }))).toBe('#000');
    expect(relativeColorGrammarText(parse('color-mix(in srgb, hsl(from red h s l), blue)', { context: 'value' }))).toBe('color-mix(in srgb , #000 , blue)');
    expect(relativeColorGrammarText(parse('red', { context: 'value' }))).toBeNull();
  });
});
