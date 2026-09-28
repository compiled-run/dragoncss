// css-backgrounds-3 §3.10: the background shorthand. It sets every background longhand; Dragon models only background-color, so a
// value compiles only when every other longhand it sets keeps its initial value. The value has already matched the webref grammar.
import type { CssNode } from 'css-tree';

/**
 * The background longhands besides background-color, in Chrome 145's expansion order, with their initial values as Chrome 145
 * serializes them in getComputedStyle (css-backgrounds-3 §3.1-§3.9). The parity lane compares every one of them.
 */
export const BACKGROUND_RESET_LONGHANDS = {
  'background-image': 'none',
  'background-position-x': '0%',
  'background-position-y': '0%',
  'background-size': 'auto',
  'background-repeat': 'repeat',
  'background-attachment': 'scroll',
  'background-origin': 'padding-box',
  'background-clip': 'border-box',
} as const;

export type BackgroundResetLonghand = keyof typeof BACKGROUND_RESET_LONGHANDS;

export type BackgroundLayer =
  /** color: the <'background-color'> token of the final layer, or null when the value omits it (the initial transparent). */
  | { readonly ok: true; readonly color: CssNode | null }
  /** nodes: the tokens that set the named longhands to non-initial values; layers: the layer count when it is more than one. */
  | { readonly ok: false; readonly longhands: readonly BackgroundResetLonghand[]; readonly nodes: readonly CssNode[]; readonly layers: number };

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

const ident = (n: CssNode): string | null => (n.type === 'Identifier' ? String(n['name']).toLowerCase() : null);
const isOperator = (n: CssNode, v: string): boolean => n.type === 'Operator' && n['value'] === v;
const isLengthPercentage = (n: CssNode): boolean => n.type === 'Percentage' || n.type === 'Dimension' || n.type === 'Number';
const isZeroPercent = (n: CssNode): boolean => n.type === 'Percentage' && Number(n['value']) === 0;

/**
 * Whether each axis of a <bg-position> computes to the initial 0%: only left, top and 0% (alone or as the offset of left or
 * top) do. Any single value leaves the other axis at center (50%); a length, even 0, computes to px, not 0%.
 */
function positionAxes(tokens: readonly CssNode[]): { x: boolean; y: boolean } {
  const origin = (n: CssNode | undefined, start: string): boolean => n !== undefined && (ident(n) === start || isZeroPercent(n));
  if (tokens.length === 1) {
    const k = ident(tokens[0] as CssNode);
    if (k !== null && VERTICAL.has(k)) return { x: false, y: k === 'top' };
    return { x: origin(tokens[0], 'left'), y: false };
  }
  if (tokens.length === 2) {
    const [a, b] = tokens as [CssNode, CssNode];
    const ka = ident(a);
    const kb = ident(b);
    const swapped = ka !== null && kb !== null && (VERTICAL.has(ka) || HORIZONTAL.has(kb));
    return swapped ? { x: origin(b, 'left'), y: origin(a, 'top') } : { x: origin(a, 'left'), y: origin(b, 'top') };
  }
  // Three or four values: keywords, each optionally followed by its offset.
  let x = false;
  let y = false;
  for (let i = 0; i < tokens.length; i++) {
    const k = ident(tokens[i] as CssNode);
    if (k === null) continue;
    const next = tokens[i + 1];
    const offset = next !== undefined && isLengthPercentage(next) ? next : null;
    const initial = offset === null || isZeroPercent(offset);
    if (k === 'left') x = initial;
    if (k === 'top') y = initial;
  }
  return { x, y };
}

const layerCount = (tokens: readonly CssNode[]): number => 1 + tokens.filter((t) => isOperator(t, ',')).length;

/** Splits a single-layer <final-bg-layer> into its components and checks that every one but the colour is initial. */
export function backgroundLayer(tokens: readonly CssNode[]): BackgroundLayer {
  const layers = layerCount(tokens);
  if (layers > 1) {
    const listed = Object.keys(BACKGROUND_RESET_LONGHANDS) as BackgroundResetLonghand[];
    return { ok: false, longhands: listed, nodes: tokens, layers };
  }
  let color: CssNode | null = null;
  const image: CssNode[] = [];
  const position: CssNode[] = [];
  const size: CssNode[] = [];
  const repeat: CssNode[] = [];
  const attachment: CssNode[] = [];
  const boxes: CssNode[] = [];
  let slash: CssNode | null = null;
  let inSize = false;
  for (const t of tokens) {
    const k = ident(t);
    if (isOperator(t, '/')) {
      slash = t;
      inSize = true;
      continue;
    }
    if (inSize && (isLengthPercentage(t) || (k !== null && SIZE_KEYWORDS.has(k)))) {
      size.push(t);
      continue;
    }
    inSize = false;
    if (k === 'none' || t.type === 'Url' || (t.type === 'Function' && IMAGE_FUNCTIONS.has(String(t['name']).toLowerCase()))) image.push(t);
    else if (isLengthPercentage(t) || (k !== null && POSITION_KEYWORDS.has(k))) position.push(t);
    else if (k !== null && REPEAT_KEYWORDS.has(k)) repeat.push(t);
    else if (k !== null && ATTACHMENT_KEYWORDS.has(k)) attachment.push(t);
    else if (k !== null && BOX_KEYWORDS.has(k)) boxes.push(t);
    else color = t;
  }
  const bad: { longhands: BackgroundResetLonghand[]; nodes: CssNode[] }[] = [];
  if (image.length > 0 && ident(image[0] as CssNode) !== 'none') bad.push({ longhands: ['background-image'], nodes: image });
  if (position.length > 0) {
    const axes = positionAxes(position);
    const longhands: BackgroundResetLonghand[] = [];
    if (!axes.x) longhands.push('background-position-x');
    if (!axes.y) longhands.push('background-position-y');
    if (longhands.length > 0) bad.push({ longhands, nodes: position });
  }
  if (size.length > 0 && !size.every((t) => ident(t) === 'auto')) bad.push({ longhands: ['background-size'], nodes: slash === null ? size : [slash, ...size] });
  if (repeat.length > 0 && !repeat.every((t) => ident(t) === 'repeat')) bad.push({ longhands: ['background-repeat'], nodes: repeat });
  if (attachment.length > 0 && ident(attachment[0] as CssNode) !== 'scroll') bad.push({ longhands: ['background-attachment'], nodes: attachment });
  // One box sets both background-origin and background-clip; two set them in order.
  if (boxes.length > 0) {
    const origin = ident(boxes[0] as CssNode);
    const clip = ident((boxes.length === 1 ? boxes[0] : boxes[1]) as CssNode);
    const longhands: BackgroundResetLonghand[] = [];
    if (origin !== BACKGROUND_RESET_LONGHANDS['background-origin']) longhands.push('background-origin');
    if (clip !== BACKGROUND_RESET_LONGHANDS['background-clip']) longhands.push('background-clip');
    if (longhands.length > 0) bad.push({ longhands, nodes: boxes });
  }
  const first = bad[0];
  if (first === undefined) return { ok: true, color };
  return { ok: false, longhands: first.longhands, nodes: first.nodes, layers: 1 };
}
