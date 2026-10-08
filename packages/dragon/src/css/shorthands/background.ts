// css-backgrounds-3 §3.10 and §3.6: the background shorthand, expanded into every layer longhand and background-color as
// Chrome 145 expands it, the background-position shorthand, and the comma-separated values of the eight layer longhands
// (the parse driver's hook for them, since each holds one item per layer). Each item is checked against what Dragon draws
// (analysis/paint-values/gradient.ts); a refusal names the node it is refused at.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { LayerRefusal } from '../../analysis/paint-values/gradient.ts';
import { checkLayerItem, commaItems } from '../../analysis/paint-values/gradient.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import type { Longhand } from '../properties.ts';
import type { BackgroundLayerLonghand } from '../properties/background-layers.ts';
import { BACKGROUND_LAYERS_LONGHANDS } from '../properties/background-layers.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import { COLOR_FIX, kw, tokenValue } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit } from './shared.ts';
import { asciiLower } from '../escapes.ts';

const IMAGE_FUNCTIONS = new Set([
  'url', 'src', 'image', 'image-set', '-webkit-image-set', 'cross-fade', '-webkit-cross-fade', 'element', 'paint',
  'linear-gradient', 'repeating-linear-gradient', 'radial-gradient', 'repeating-radial-gradient', 'conic-gradient', 'repeating-conic-gradient',
]);
const POSITION_KEYWORDS = new Set(['left', 'center', 'right', 'top', 'bottom', 'x-start', 'x-end', 'y-start', 'y-end', 'block-start', 'block-end', 'inline-start', 'inline-end']);
const REPEAT_KEYWORDS = new Set(['repeat-x', 'repeat-y', 'repeat-block', 'repeat-inline', 'repeat', 'space', 'round', 'no-repeat']);
const ATTACHMENT_KEYWORDS = new Set(['scroll', 'fixed', 'local']);
const BOX_KEYWORDS = new Set(['content-box', 'padding-box', 'border-box', 'border-area', 'text']);
const SIZE_KEYWORDS = new Set(['auto', 'cover', 'contain']);
const VERTICAL = new Set(['top', 'bottom']);
const HORIZONTAL = new Set(['left', 'right']);

const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? asciiLower(String(n['name'])) : null);
const isOperator = (n: CssNode, v: string): boolean => n.type === 'Operator' && n['value'] === v;
const isLengthPercentage = (n: CssNode): boolean => n.type === 'Percentage' || n.type === 'Dimension' || n.type === 'Number';

/** Chrome 145's initial item of each layer longhand, as the shorthand fills an omitted component. */
export const LAYER_INITIAL: { readonly [P in BackgroundLayerLonghand]: string } = {
  'background-image': 'none',
  'background-position-x': '0%',
  'background-position-y': '0%',
  'background-size': 'auto',
  'background-repeat': 'repeat',
  'background-attachment': 'scroll',
  'background-origin': 'padding-box',
  'background-clip': 'border-box',
};

const textOf = (tokens: readonly CssNode[]): string => tokens.map((t) => generate(t)).join(' ');

/**
 * A layer longhand's value from its items' texts: one single-token item keeps its natural kind (keyword, percentage, px
 * length, or a gradient function), anything else is an 'other' value: type 'list' for several layers (as a captured list
 * parses), the longhand's own name for one multi-token item.
 */
export function layerValue(property: BackgroundLayerLonghand, items: readonly (readonly CssNode[])[]): CssValue {
  const only = items.length === 1 ? items[0] : undefined;
  const t = only !== undefined && only.length === 1 ? only[0] : undefined;
  if (t !== undefined) {
    if (t.type === 'Identifier') return kw(asciiLower(String(t['name'])));
    if (t.type === 'Percentage') return { kind: 'percentage', value: Number(t['value']) };
    if (t.type === 'Number' && Number(t['value']) === 0) return { kind: 'length', value: 0, unit: 'px' };
    if (t.type === 'Dimension' && asciiLower(String(t['unit'])) === 'px') return { kind: 'length', value: Number(t['value']), unit: 'px' };
    if (t.type === 'Function') return { kind: 'other', type: `${asciiLower(String(t['name']))}()`, text: generate(t) };
  }
  const text = items.map(textOf).join(', ');
  return { kind: 'other', type: items.length > 1 ? 'list' : property.slice('background-'.length), text };
}

/** A located refusal of a background value. */
function refusal(property: string, r: LayerRefusal, fallback: readonly CssNode[], base: Span, sheetText: string): Diagnostic {
  const nodes = r.node === null ? fallback : [r.node];
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const at = first === undefined || last === undefined ? base : { source: base.source, start: spanOf(first, base).start, end: spanOf(last, base).end };
  const shown = sheetText.slice(at.start - base.start, at.end - base.start);
  return diagnostic('DRAGON_UNSUPPORTED_VALUE', {
    origin: authored(at),
    message: `${property}: "${shown}" is unsupported: ${r.reason}`,
    manual: 'Use linear or radial gradients with px and percentage geometry, and background sizes, positions and repeats that draw one tile.',
  });
}

/**
 * The parse driver's hook for a layer longhand (stylesheet.ts parseValue): a comma-separated list of items, each checked,
 * as one longhand value. tokens are the grammar-valid value's top-level tokens without white space.
 */
export function layerLonghandValue(property: BackgroundLayerLonghand, tokens: readonly CssNode[], base: Span, sheetText: string): ParsedValue {
  const items = commaItems(tokens);
  for (const item of items) {
    const r = checkLayerItem(property, item);
    if (r !== null) return { kind: 'refused', diagnostic: refusal(property, r, item, base, sheetText) };
  }
  return { kind: 'ok', longhands: [{ property, value: layerValue(property, items), explicit: true }] };
}

/** A <bg-position>'s tokens split into the background-position-x and -y items (css-backgrounds-3 §3.6). */
function splitPosition(tokens: readonly CssNode[]): { readonly x: CssNode[]; readonly y: CssNode[] } {
  if (tokens.length === 1) {
    const k = ident(tokens[0]);
    if (k !== null && VERTICAL.has(k)) return { x: [center()], y: [tokens[0] as CssNode] };
    if (k === 'center') return { x: [tokens[0] as CssNode], y: [center()] };
    return { x: [tokens[0] as CssNode], y: [center()] };
  }
  if (tokens.length === 2) {
    const [a, b] = tokens as [CssNode, CssNode];
    const ka = ident(a);
    const kb = ident(b);
    const swapped = (ka !== null && VERTICAL.has(ka)) || (kb !== null && HORIZONTAL.has(kb));
    return swapped ? { x: [b], y: [a] } : { x: [a], y: [b] };
  }
  // Three or four values: keywords, each optionally followed by its offset.
  const x: CssNode[] = [];
  const y: CssNode[] = [];
  let pending: CssNode[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const k = ident(pending[0]);
    if (k !== null && HORIZONTAL.has(k)) x.push(...pending);
    else if (k !== null && VERTICAL.has(k)) y.push(...pending);
    else if (x.length === 0) x.push(...pending);
    else y.push(...pending);
    pending = [];
  };
  for (const t of tokens) {
    if (ident(t) !== null) flush();
    pending.push(t);
  }
  flush();
  return { x, y };
}

/** A center keyword node, for the axis a one-value position leaves at its default. */
function center(): CssNode {
  return { type: 'Identifier', name: 'center', loc: null } as unknown as CssNode;
}

/** One layer of the background shorthand, split into its components; color only on the final layer. */
type ShorthandLayer = {
  readonly image: CssNode[];
  readonly position: CssNode[];
  readonly size: CssNode[];
  readonly repeat: CssNode[];
  readonly attachment: CssNode[];
  readonly boxes: CssNode[];
  readonly color: CssNode | null;
  readonly all: readonly CssNode[];
};

function splitLayer(tokens: readonly CssNode[]): ShorthandLayer {
  const layer = { image: [] as CssNode[], position: [] as CssNode[], size: [] as CssNode[], repeat: [] as CssNode[], attachment: [] as CssNode[], boxes: [] as CssNode[], color: null as CssNode | null, all: tokens };
  let inSize = false;
  for (const t of tokens) {
    const k = ident(t);
    if (isOperator(t, '/')) {
      inSize = true;
      continue;
    }
    if (inSize && (isLengthPercentage(t) || (k !== null && SIZE_KEYWORDS.has(k)))) {
      layer.size.push(t);
      continue;
    }
    inSize = false;
    if (k === 'none' || t.type === 'Url' || (t.type === 'Function' && IMAGE_FUNCTIONS.has(asciiLower(String(t['name']))))) layer.image.push(t);
    else if (isLengthPercentage(t) || (k !== null && POSITION_KEYWORDS.has(k))) layer.position.push(t);
    else if (k !== null && REPEAT_KEYWORDS.has(k)) layer.repeat.push(t);
    else if (k !== null && ATTACHMENT_KEYWORDS.has(k)) layer.attachment.push(t);
    else if (k !== null && BOX_KEYWORDS.has(k)) layer.boxes.push(t);
    else layer.color = t;
  }
  return layer;
}

/** A layer's item tokens for each layer longhand; an omitted component is null (the initial item). */
function layerItems(l: ShorthandLayer): { readonly [P in BackgroundLayerLonghand]: CssNode[] | null } {
  const pos = l.position.length === 0 ? null : splitPosition(l.position);
  const [origin, clip] = l.boxes.length === 0 ? [null, null] : l.boxes.length === 1 ? [l.boxes[0] as CssNode, l.boxes[0] as CssNode] : [l.boxes[0] as CssNode, l.boxes[1] as CssNode];
  return {
    'background-image': l.image.length === 0 ? null : l.image,
    'background-position-x': pos === null ? null : pos.x,
    'background-position-y': pos === null ? null : pos.y,
    'background-size': l.size.length === 0 ? null : l.size,
    'background-repeat': l.repeat.length === 0 ? null : l.repeat,
    'background-attachment': l.attachment.length === 0 ? null : l.attachment,
    'background-origin': origin === null ? null : [origin],
    'background-clip': clip === null ? null : [clip],
  };
}

/** The initial item of a layer longhand as tokens. */
function initialItem(p: BackgroundLayerLonghand): CssNode[] {
  const text = LAYER_INITIAL[p];
  if (text.endsWith('%')) return [{ type: 'Percentage', value: text.slice(0, -1), loc: null } as unknown as CssNode];
  return [{ type: 'Identifier', name: text, loc: null } as unknown as CssNode];
}

function refuseBackground(tokens: readonly CssNode[], base: Span, sheetText: string): Diagnostic | null {
  const layers = commaItems(tokens).map(splitLayer);
  for (const [i, l] of layers.entries()) {
    if (l.color !== null && i < layers.length - 1) return refusal('background', { node: l.color, reason: 'only the final layer takes a colour' }, l.all, base, sheetText);
    const items = layerItems(l);
    for (const p of BACKGROUND_LAYERS_LONGHANDS) {
      const item = items[p];
      if (item === null) continue;
      const r = checkLayerItem(p, item);
      if (r !== null) return refusal('background', r, item, base, sheetText);
    }
  }
  const color = (layers[layers.length - 1] as ShorthandLayer).color;
  if (color !== null) {
    const v = tokenValue(color, 'background-color');
    const at = spanOf(color, base);
    if (typeof v === 'string') return diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(at), message: `background: ${sheetText.slice(at.start - base.start, at.end - base.start)} is unsupported: ${v}`, manual: COLOR_FIX });
  }
  return null;
}

const BACKGROUND_LONGHANDS: readonly Longhand[] = [...BACKGROUND_LAYERS_LONGHANDS, 'background-color'];

const background: ShorthandHandler = {
  longhands: BACKGROUND_LONGHANDS,
  refuse: refuseBackground,
  // refuse has accepted the value: every layer's components are drawn and the colour is in the subset.
  expand: (_values, tokens) => {
    const layers = commaItems(tokens).map(splitLayer);
    const perLayer = layers.map(layerItems);
    const out: LonghandValue[] = [];
    for (const p of BACKGROUND_LAYERS_LONGHANDS) {
      const items = perLayer.map((l) => l[p]);
      const value = layerValue(p, items.map((it) => it ?? initialItem(p)));
      out.push(items.every((it) => it === null) ? implicit(p, value) : explicit(p, value));
    }
    const color = (layers[layers.length - 1] as ShorthandLayer).color;
    if (color === null) out.push(implicit('background-color', kw('transparent')));
    else {
      const v = tokenValue(color, 'background-color');
      if (typeof v === 'string') throw new Error(`background colour ${v} reached expansion`);
      out.push(explicit('background-color', v));
    }
    return out;
  },
};

function refusePosition(tokens: readonly CssNode[], base: Span, sheetText: string): Diagnostic | null {
  for (const item of commaItems(tokens)) {
    const { x, y } = splitPosition(item);
    const rx = checkLayerItem('background-position-x', x);
    if (rx !== null) return refusal('background-position', rx, item, base, sheetText);
    const ry = checkLayerItem('background-position-y', y);
    if (ry !== null) return refusal('background-position', ry, item, base, sheetText);
  }
  return null;
}

const backgroundPosition: ShorthandHandler = {
  longhands: ['background-position-x', 'background-position-y'],
  refuse: refusePosition,
  expand: (_values, tokens) => {
    const items = commaItems(tokens).map(splitPosition);
    return [explicit('background-position-x', layerValue('background-position-x', items.map((i) => i.x))), explicit('background-position-y', layerValue('background-position-y', items.map((i) => i.y)))];
  },
};

export const BACKGROUND_SHORTHANDS = {
  background,
  'background-position': backgroundPosition,
} as const satisfies { readonly [s: string]: ShorthandHandler };
