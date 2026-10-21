// text-box (css-inline-3 §5.3): normal | <'text-box-trim'> || <'text-box-edge'>, as Chrome 145 parses and expands it (Blink
// TextBox::ParseShorthand): normal sets none and auto; otherwise an omitted text-box-trim is trim-both and an omitted
// text-box-edge auto. The edge is read as properties/text-box.ts reads text-box-edge.
import type { CssValue } from '../values.ts';
import { kw } from '../values.ts';
import { consumeTextBoxEdge, TEXT_BOX_TRIMS, textBoxIdentifiers } from '../properties/text-box.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit } from './shared.ts';

/** The text-box-trim and text-box-edge a text-box value sets, or null when Chrome drops it. */
export function textBoxParts(names: readonly string[]): { readonly trim: string; readonly edge: string } | null {
  if (names.length === 1 && names[0] === 'normal') return { trim: 'none', edge: 'auto' };
  let trim: string | null = null;
  let edge: string | null = null;
  let at = 0;
  while (at < names.length && (trim === null || edge === null)) {
    const n = names[at] as string;
    if (trim === null && TEXT_BOX_TRIMS.has(n)) {
      trim = n;
      at += 1;
      continue;
    }
    const e: { readonly edge: string; readonly taken: number } | null = edge === null ? consumeTextBoxEdge(names, at) : null;
    if (e !== null) {
      edge = e.edge;
      at += e.taken;
      continue;
    }
    break;
  }
  if (at !== names.length || (trim === null && edge === null)) return null;
  return { trim: trim ?? 'trim-both', edge: edge ?? 'auto' };
}

export const TEXT_BOX_SHORTHANDS = {
  'text-box': {
    longhands: ['text-box-trim', 'text-box-edge'],
    expand: (values) => {
      const names = values.map((v: CssValue) => (v.kind === 'keyword' ? v.value : ''));
      const parts = textBoxParts(names);
      if (parts === null) throw new Error(`text-box: ${names.join(' ')} passed the grammar but Chrome 145 drops it`);
      // Blink adds both longhands as not implicit, the omitted ones too.
      return [explicit('text-box-trim', kw(parts.trim)), explicit('text-box-edge', kw(parts.edge))];
    },
  },
} as const satisfies { readonly [s: string]: ShorthandHandler };
