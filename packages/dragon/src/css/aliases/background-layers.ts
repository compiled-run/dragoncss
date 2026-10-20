// The background-layers family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for (line 9740). BackgroundClip's
// parse ignores UseAliasParsing, so -webkit-background-clip parses as background-clip, text included. -webkit-background-origin and
// -webkit-background-size parse with legacy rules (UseAliasParsing), which legacyBackgroundValue rewrites into the standard value:
// the origin keywords border, padding and content are the border-box, padding-box and content-box boxes, and one size names both
// axes (probed in Chromium: -webkit-background-size: 10px computes 10px 10px, -webkit-background-origin: padding computes
// padding-box). A var() is parsed after substitution with the standard rules (probed: var(--x) with --x: 7px computes 7px), and a
// size list is serialized unlike its layers, so both are refused rather than modelled.
import type { CssNode, List } from 'css-tree';
import * as cssTree from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { BACKGROUND_LAYERS_LONGHANDS } from '../properties/background-layers.ts';

export const BACKGROUND_LAYERS_ALIASES = {
  '-webkit-background-clip': 'background-clip',
  '-webkit-background-origin': 'background-origin',
  '-webkit-background-size': 'background-size',
} as const satisfies { readonly [alias: string]: (typeof BACKGROUND_LAYERS_LONGHANDS)[number] };

const LEGACY_BOXES: Readonly<Record<string, string>> = { border: 'border-box', padding: 'padding-box', content: 'content-box' };
const SIZE_KEYWORDS: ReadonlySet<string> = new Set(['auto', 'cover', 'contain', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

// css-tree ships fromPlainObject (it turns a children array into its List) without declaring it.
const { fromPlainObject } = cssTree as unknown as { readonly fromPlainObject: (node: object) => CssNode };
const withChildren = (value: CssNode, children: readonly CssNode[]): CssNode => fromPlainObject({ ...value, children: [...children] });

/**
 * The standard value a legacy -webkit-background-size or -webkit-background-origin value stands for, the value itself when the two
 * parse alike, or a refusal; null for any other alias.
 */
export function legacyBackgroundValue(alias: string, value: CssNode, source: string): CssNode | { readonly refusal: string } | null {
  if (alias !== '-webkit-background-size' && alias !== '-webkit-background-origin') return null;
  if (/var\(|env\(|\\/i.test(source)) return { refusal: `Chrome parses ${alias} with legacy rules but a substituted value with the standard ones, and Dragon models only a value it reads at parse time` };
  const children = value['children'] === null || value['children'] === undefined ? [] : (value['children'] as List<CssNode>).toArray();
  if (alias === '-webkit-background-origin') {
    return withChildren(value, children.map((n) => {
      const box = n.type === 'Identifier' ? LEGACY_BOXES[asciiLower(String(n['name']))] : undefined;
      return box === undefined ? n : ({ ...n, name: box } as CssNode);
    }));
  }
  const tokens = children.filter((n) => n.type !== 'WhiteSpace');
  if (tokens.some((n) => n.type === 'Operator')) return { refusal: 'Chrome parses a -webkit-background-size list with legacy rules Dragon does not model; write one size' };
  const only = tokens[0];
  if (tokens.length !== 1 || only === undefined || (only.type === 'Identifier' && SIZE_KEYWORDS.has(asciiLower(String(only['name']))))) return value;
  return withChildren(value, [only, { type: 'WhiteSpace', value: ' ', loc: null } as CssNode, only]);
}
