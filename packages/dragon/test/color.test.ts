/// <reference path="../src/css/css-tree.d.ts" />
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { describe, expect, it } from 'vitest';
import { parseColorNode, parseComputedColor, serializeAlpha, serializeColor, TRANSPARENT } from '../src/css/color.ts';

const first = (text: string): CssNode => (parse(text, { context: 'value' })['children'] as { toArray(): CssNode[] }).toArray()[0] as CssNode;

function resolve(text: string): string {
  const r = parseColorNode(first(text));
  if (!r.ok) throw new Error(r.reason);
  return r.kind === 'keyword' ? (r.keyword === 'transparent' ? serializeColor(TRANSPARENT) : r.keyword) : serializeColor(r.value);
}

// Chrome 145.0.7632.6 getComputedStyle(color) for each input (Playwright 1.58.2 probe, notes/T026-slice-2.md).
// The hsl() rows at hues 2, 6, 10, 14 and 18 sit exactly on a .5 channel boundary and pin Blink's float path.
const CHROME: readonly (readonly [string, string])[] = [
  ["hsl(2 100% 50%)", "rgb(255, 9, 0)"],
  ["hsl(10 100% 50%)", "rgb(255, 42, 0)"],
  ["hsl(6 50% 50%)", "rgb(191, 77, 64)"],
  ["hsl(14 50% 50%)", "rgb(191, 93, 64)"],
  ["hsl(18 100% 50%)", "rgb(255, 77, 0)"],
  ["hsl(130 100% 50%)", "rgb(0, 255, 43)"],
  ["hsl(-30 100% 50%)", "rgb(255, 0, 128)"],
  ["hsl(0.5turn 100% 50%)", "rgb(0, 255, 255)"],
  ["hsl(1rad 40% 60%)", "rgb(194, 190, 112)"],
  ["hsl(100grad 30% 70%)", "rgb(179, 201, 156)"],
  ["hsla(300, 100%, 25%, 0.5)", "rgba(128, 0, 128, 0.5)"],
  ["hsl(210 20 97.3)", "rgb(247, 248, 249)"],
  ["hsl(none 50% 50%)", "rgb(191, 64, 64)"],
  ["rgb(10.4, 20.6, 30.5)", "rgb(10, 21, 31)"],
  ["rgb(10.5 20.49 255.9 / 0.333)", "rgba(11, 20, 255, 0.333)"],
  ["rgb(30% 50.5% 99.9%)", "rgb(77, 129, 255)"],
  ["rgb(300 -5 20)", "rgb(255, 0, 20)"],
  ["rgb(none 2 3)", "rgb(0, 2, 3)"],
  ["rgba(1, 2, 3, 0.3)", "rgba(1, 2, 3, 0.3)"],
  ["rgba(1, 2, 3, 0.998)", "rgba(1, 2, 3, 0.996)"],
  ["rgba(1, 2, 3, 0.001)", "rgba(1, 2, 3, 0)"],
  ["rgb(1 2 3 / 12.5%)", "rgba(1, 2, 3, 0.125)"],
  ["rgb(1 2 3 / 1.5)", "rgb(1, 2, 3)"],
  ["#abc", "rgb(170, 187, 204)"],
  ["#abcd", "rgba(170, 187, 204, 0.867)"],
  ["#a1b2c3", "rgb(161, 178, 195)"],
  ["#a1b2c37f", "rgba(161, 178, 195, 0.498)"],
  ["rebeccapurple", "rgb(102, 51, 153)"],
  ["RED", "rgb(255, 0, 0)"],
  ["transparent", "rgba(0, 0, 0, 0)"],
];

describe('colour resolution matches Chrome 145 channel for channel', () => {
  for (const [input, chrome] of CHROME) {
    it(`${input} -> ${chrome}`, () => {
      expect(resolve(input)).toBe(chrome);
      const back = parseComputedColor(chrome);
      expect(back === null ? null : serializeColor(back)).toBe(chrome);
    });
  }
  it('serializes alpha as CSSOM does: two decimals when they round-trip to the byte, else three', () => {
    expect([0, 77, 85, 127, 128, 221, 254].map(serializeAlpha)).toEqual(['0', '0.3', '0.333', '0.498', '0.5', '0.867', '0.996']);
  });
  it('refuses colours outside the milestone subset with a reason', () => {
    for (const v of ['lab(50% 40 59)', 'Canvas', 'color-mix(in srgb, red, blue)', 'oklch(0.5 0.1 20)', 'hwb(1 2% 3%)']) {
      const r = parseColorNode(first(v));
      expect(r.ok, v).toBe(false);
    }
  });
});
