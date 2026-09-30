// css-text-4 §3: white-space sets white-space-collapse and text-wrap-mode (white-space-trim is not a Dragon longhand).
import { generate } from 'css-tree';
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

export const TEXT_SHORTHANDS = {
  'white-space': whiteSpace,
} as const satisfies { readonly [s: string]: ShorthandHandler };
