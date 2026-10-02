// css-text-4 §3: white-space sets white-space-collapse and text-wrap-mode (white-space-trim is not a Dragon longhand). css-fonts-4
// §2.8 and §7.1: the font and font-synthesis shorthands, as Chrome 145 parses and expands them (TXT-W2).
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { FontFaults } from '../../fonts/faults.ts';
import { NO_FONT_FAULTS } from '../../fonts/faults.ts';
import type { Longhand } from '../properties.ts';
import type { LonghandValue } from '../stylesheet.ts';
import { familyValue, pairValue, toValue } from '../values.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { spanOf } from '../ast.ts';
import type { CssValue } from '../values.ts';
import { kw } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit } from './shared.ts';
import { asciiLower } from '../escapes.ts';

const WHITE_SPACE_TRIM: ReadonlySet<string> = new Set(['none', 'discard-before', 'discard-after', 'discard-inner']);
const WHITE_SPACE_COLLAPSE: ReadonlySet<string> = new Set(['collapse', 'discard', 'preserve', 'preserve-breaks', 'preserve-spaces', 'break-spaces']);
/** css-text-4 §3: the white-space keywords that set both longhands. */
const WHITE_SPACE_KEYWORDS: { readonly [k: string]: readonly [string, string] } = {
  normal: ['collapse', 'wrap'],
  pre: ['preserve', 'nowrap'],
  'pre-wrap': ['preserve', 'wrap'],
  'pre-line': ['preserve-breaks', 'wrap'],
};

const whiteSpace: ShorthandHandler = {
  longhands: ['white-space-collapse', 'text-wrap-mode'],
  // white-space-trim is not a Dragon longhand and Chrome does not implement it, so a white-space value that sets it is refused
  // rather than dropped.
  refuse: (tokens, base) => {
    const trim = tokens.find((t) => t.type === 'Identifier' && WHITE_SPACE_TRIM.has(asciiLower(String(t['name']))));
    if (trim === undefined) return null;
    return diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(trim, base)),
      message: `white-space: ${generate(trim)} sets white-space-trim, which milestone 1 does not support`,
      manual: 'Use white-space: normal or nowrap.',
    });
  },
  expand: (values) => {
    const only = values[0] as CssValue;
    const pair = values.length === 1 && only.kind === 'keyword' ? WHITE_SPACE_KEYWORDS[only.value] : undefined;
    if (pair !== undefined) return [explicit('white-space-collapse', kw(pair[0])), explicit('text-wrap-mode', kw(pair[1]))];
    // <'white-space-collapse'> || <'text-wrap-mode'>: an omitted longhand takes its initial value.
    const collapse = values.find((v) => v.kind === 'keyword' && WHITE_SPACE_COLLAPSE.has(v.value));
    const wrap = values.find((v) => v.kind === 'keyword' && (v.value === 'wrap' || v.value === 'nowrap'));
    return [
      collapse === undefined ? implicit('white-space-collapse', kw('collapse')) : explicit('white-space-collapse', collapse),
      wrap === undefined ? implicit('text-wrap-mode', kw('wrap')) : explicit('text-wrap-mode', wrap),
    ];
  },
};

const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? asciiLower(String(n['name'])) : null);

/** css-fonts-4 <system-family-name> and Chrome's -webkit- system fonts: their faces are the platform's, which no target draws. */
const SYSTEM_FONTS: ReadonlySet<string> = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']);
const STRETCH: ReadonlySet<string> = new Set(['ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed', 'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded']);
const WEIGHT_KEYWORDS: ReadonlySet<string> = new Set(['bold', 'bolder', 'lighter']);

/** The parts of a grammar-valid, non-system font value: each prefix token by role, the size, the line height and the family tokens. */
type FontParts = {
  readonly style: readonly CssNode[];
  readonly weight: CssNode | null;
  readonly variant: CssNode | null;
  readonly stretch: CssNode | null;
  readonly size: CssNode;
  readonly lineHeight: CssNode | null;
  readonly family: readonly CssNode[];
};

/** Splits a value the webref grammar matched: [style || variant || weight || stretch]? size [/ line-height]? family. */
function fontParts(tokens: readonly CssNode[]): FontParts | null {
  let i = 0;
  const style: CssNode[] = [];
  let weight: CssNode | null = null;
  let variant: CssNode | null = null;
  let stretch: CssNode | null = null;
  for (; i < tokens.length; i++) {
    const t = tokens[i] as CssNode;
    const k = ident(t);
    if (k === 'normal') continue;
    if (k === 'italic' || k === 'left' || k === 'right') style.push(t);
    else if (k === 'oblique') {
      style.push(t);
      if (tokens[i + 1]?.type === 'Dimension' && /^(deg|grad|rad|turn)$/i.test(String(tokens[i + 1]?.['unit']))) style.push(tokens[++i] as CssNode);
    } else if (k === 'small-caps') variant = t;
    else if (k !== null && STRETCH.has(k)) stretch = t;
    else if ((k !== null && WEIGHT_KEYWORDS.has(k)) || (t.type === 'Number' && Number(t['value']) !== 0)) weight = t;
    else break;
  }
  const size = tokens[i];
  if (size === undefined) return null;
  i++;
  let lineHeight: CssNode | null = null;
  if (tokens[i]?.type === 'Operator' && tokens[i]?.['value'] === '/') {
    lineHeight = tokens[i + 1] ?? null;
    i += 2;
  }
  return { style, weight, variant, stretch, size, lineHeight, family: tokens.slice(i) };
}

/** The font longhands Dragon models, which a CSS-wide keyword sets (Chrome 145 also sets the FONT_RESET_LONGHANDS). */
const FONT_LONGHANDS: readonly Longhand[] = ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'];
const SYNTHESIS_LONGHANDS: readonly Longhand[] = ['font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps'];

/**
 * css-fonts-4 §2.8 as Chrome 145 expands it: font sets font-style, font-weight, font-size, line-height (normal when no "/") and
 * font-family, and resets the FONT_RESET_LONGHANDS Dragon does not model, so small-caps, a non-normal stretch and the system fonts
 * are refused; it does not set font-synthesis. Chrome's parse rules beyond the grammar hold (font-style left and right, the
 * oblique angle range). The faults are the planted ones of fonts/faults.ts.
 */
export function fontShorthand(faults: FontFaults = NO_FONT_FAULTS): ShorthandHandler {
  return {
    longhands: faults.inheritNotAllLonghands ? FONT_LONGHANDS.filter((p) => p !== 'line-height') : FONT_LONGHANDS,
    refuse: (tokens, base) => {
      const refuse = (t: CssNode, message: string, code: 'DRAGON_UNSUPPORTED_VALUE' | 'DRAGON_CSS_INVALID_VALUE' = 'DRAGON_UNSUPPORTED_VALUE', manual = 'Write the font shorthand with only a style, a weight, a size, a line height and a family.') =>
        diagnostic(code, { origin: authored(spanOf(t, base)), message, manual });
      const only = tokens.length === 1 ? ident(tokens[0]) : null;
      if (only !== null && (SYSTEM_FONTS.has(only) || only.startsWith('-webkit-'))) return refuse(tokens[0] as CssNode, `font: ${only} is a system font, whose face, size and weight are the platform's, which no target reproduces`, 'DRAGON_UNSUPPORTED_VALUE', 'Write the font shorthand with a size and a family, or set font-size and font-family.');
      const parts = fontParts(tokens);
      // The grammar requires a size; a value without one is refused here rather than reaching the expansion.
      if (parts === null) return refuse(tokens[tokens.length - 1] as CssNode, 'the font shorthand needs a font-size before the family', 'DRAGON_CSS_INVALID_VALUE');
      const side = parts.style.find((t) => ident(t) === 'left' || ident(t) === 'right');
      if (side !== undefined) return refuse(side, `Chrome 145 does not parse font-style: ${ident(side) as string} in the font shorthand`, 'DRAGON_CSS_INVALID_VALUE');
      if (parts.style.length === 2) {
        const v = pairValue('font-style', parts.style);
        if (v !== null && 'invalid' in v) return refuse(parts.style[1] as CssNode, `font: ${v.invalid}`, 'DRAGON_CSS_INVALID_VALUE');
        if (v !== null && 'refused' in v) return refuse(parts.style[1] as CssNode, `font: ${v.refused}`);
      }
      if (parts.variant !== null) return refuse(parts.variant, 'font: small-caps sets font-variant-caps, which Dragon does not model', 'DRAGON_UNSUPPORTED_VALUE', 'Leave small-caps out of the font shorthand.');
      if (parts.stretch !== null) return refuse(parts.stretch, `font: ${generate(parts.stretch)} sets font-stretch, which Dragon does not model`, 'DRAGON_UNSUPPORTED_VALUE', 'Leave the width keyword out of the font shorthand.');
      return null;
    },
    expand: (_values, tokens) => {
      const parts = fontParts(tokens);
      if (parts === null) throw new Error('a font value without a size reached the expansion');
      const style = parts.style.length === 0 ? null : parts.style.length === 1 ? toValue(parts.style[0] as CssNode, 'font-style') : pairValue('font-style', parts.style);
      const out: LonghandValue[] = [
        style === null || !('kind' in style) ? implicit('font-style', kw('normal')) : explicit('font-style', style),
        parts.weight === null ? implicit('font-weight', kw('normal')) : explicit('font-weight', parts.weight.type === 'Number' ? { kind: 'number', value: Number(parts.weight['value']) } : toValue(parts.weight, 'font-weight')),
        explicit('font-size', toValue(parts.size, 'font-size')),
      ];
      if (parts.lineHeight !== null) out.push(explicit('line-height', toValue(parts.lineHeight, 'line-height')));
      else if (!faults.lineHeightNotReset) out.push(implicit('line-height', kw('normal')));
      out.push(explicit('font-family', familyValue(parts.family)));
      if (faults.synthesisResetByShorthand) out.push(...SYNTHESIS_LONGHANDS.map((p) => implicit(p, kw('auto'))));
      return out;
    },
  };
}

/** css-fonts-4 §7.1 as Chrome 145 parses it: none, or weight || style || small-caps (position is not a Chrome value). */
const fontSynthesis: ShorthandHandler = {
  longhands: SYNTHESIS_LONGHANDS,
  refuse: (tokens, base) => {
    const position = tokens.find((t) => ident(t) === 'position');
    if (position === undefined) return null;
    return diagnostic('DRAGON_CSS_INVALID_VALUE', { origin: authored(spanOf(position, base)), message: 'Chrome 145 does not parse font-synthesis: position', manual: 'Write font-synthesis: none, or any of weight, style and small-caps.' });
  },
  expand: (_values, tokens) => {
    const on = new Set(tokens.map(ident));
    return [
      explicit('font-synthesis-weight', kw(on.has('weight') ? 'auto' : 'none')),
      explicit('font-synthesis-style', kw(on.has('style') ? 'auto' : 'none')),
      explicit('font-synthesis-small-caps', kw(on.has('small-caps') ? 'auto' : 'none')),
    ];
  },
};

export const TEXT_SHORTHANDS = {
  'white-space': whiteSpace,
  font: fontShorthand(),
  'font-synthesis': fontSynthesis,
} as const satisfies { readonly [s: string]: ShorthandHandler };
