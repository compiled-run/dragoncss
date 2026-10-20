// TXT-FX: whether two texts' shadows may meet on the native targets. The device encodes each shadowed line's layer over the backdrop
// its container and ancestors paint (emit/paint/text-shadow.ts, paint-shadow.ts textShadowLayerOver), not over the other texts'
// shadows and glyphs, so a blurred or translucent shadow composites as Chrome does only where it meets nothing but that backdrop: no
// other text's glyph ink and no other text's shadow. Where both are hard opaque shadows or ink, the later covers the earlier exactly.
// Without the layout (the device lays out at its own viewport), apartness is proven from the boxes alone: two texts in different
// block containers whose paths up to their nearest common ancestor stay in normal flow, under a block or flex parent that keeps
// them apart by its children's margins, with each text's ink kept inside its container by an auto height and a width it fits.
import type { Longhand } from '../css/properties.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** How far a text's ink and its shadows reach past the ink on one side, in css px, and whether each reach composites inexactly. */
export type Reach = { readonly v: number; readonly risky: boolean; readonly blurred: boolean };
type Side = 'top' | 'right' | 'bottom' | 'left';

/** One text as the shadow check sees it: its block container and its reach on each side (its ink first). */
export type InkText = { readonly text: ResolvedText; readonly container: ResolvedElement; readonly reach: Readonly<Record<Side, readonly Reach[]>> };

/** A drawn shadow: css px offsets and blur, and its colour's alpha (null for currentcolor, which every target refuses). */
export type DrawnShadow = { readonly x: number; readonly y: number; readonly blur: number; readonly alpha: number | null };

const prop = (el: { readonly props: ReadonlyMap<Longhand, ResolvedValue> | ReadonlyMap<string, ResolvedValue> }, p: string): string => {
  const v = (el.props as ReadonlyMap<string, ResolvedValue>).get(p);
  if (v === undefined) throw new Error(`${p} did not resolve`);
  return valueToString(v.value);
};
const pxOf = (v: string): number | null => (/^-?[0-9.]+px$/.test(v) ? Number(v.slice(0, -2)) : null);
/** A px length, 0 for normal or auto where those mean no length, else null. */
const lengthOf = (v: string): number | null => (v === 'normal' ? 0 : pxOf(v));

/** A text's reach on each side: its ink (0, exact), then each drawn shadow (offset plus its blur's 3 sigma, never inside the ink). */
export function reachOf(shadows: readonly DrawnShadow[]): Readonly<Record<Side, readonly Reach[]>> {
  const ink: Reach = { v: 0, risky: false, blurred: false };
  const drawn = shadows.filter((s) => s.alpha !== 0);
  const side = (f: (s: DrawnShadow) => number): Reach[] => [ink, ...drawn.map((s) => ({ v: Math.max(0, f(s) + 1.5 * s.blur), risky: s.blur > 0 || s.alpha !== 255, blurred: s.blur > 0 }))];
  return { top: side((s) => -s.y), right: side((s) => s.x), bottom: side((s) => s.y), left: side((s) => -s.x) };
}

/**
 * The parents of every element under root, by element. A text's container is the block container whose lines hold it.
 */
export function parentsOf(root: ResolvedElement): Map<ResolvedElement, ResolvedElement> {
  const out = new Map<ResolvedElement, ResolvedElement>();
  const walk = (el: ResolvedElement): void => {
    for (const c of el.children) {
      if (c.kind !== 'element') continue;
      out.set(c, el);
      walk(c);
    }
  };
  walk(root);
  return out;
}

const chainOf = (el: ResolvedElement, parents: ReadonlyMap<ResolvedElement, ResolvedElement>): ResolvedElement[] => {
  const out = [el];
  for (let p = parents.get(el); p !== undefined; p = parents.get(p)) out.push(p);
  return out;
};

const inFlow = (el: ResolvedElement): boolean => prop(el, 'position') === 'static' && prop(el, 'float') === 'none' && ['block', 'flex', 'flow-root'].includes(prop(el, 'display'));
const margins = (el: ResolvedElement): Record<Side, number> | null => {
  const m = { top: pxOf(prop(el, 'margin-top')), right: pxOf(prop(el, 'margin-right')), bottom: pxOf(prop(el, 'margin-bottom')), left: pxOf(prop(el, 'margin-left')) };
  return Object.values(m).every((v) => v !== null && v >= 0) ? (m as Record<Side, number>) : null;
};
const padding = (el: ResolvedElement, s: Side): number => Math.max(0, pxOf(prop(el, `padding-${s}`)) ?? 0);

/** Gaps on one axis: ab when a's box comes first (above or left of b's), ba when b's does; Infinity where that order cannot occur. */
type Gaps = { readonly ab: number; readonly ba: number };

/** The least css px between two of a block or flex parent's in-flow children's border boxes on each axis (null where unknown). */
function gapOf(parent: ResolvedElement, a: ResolvedElement, b: ResolvedElement): { readonly v: Gaps | null; readonly h: Gaps | null } | null {
  // Every child of the parent stays in flow with margins of 0 or more, so no box between the two pulls the later one back.
  const kids = parent.children.filter((c): c is ResolvedElement => c.kind === 'element' && prop(c, 'display') !== 'none');
  if (kids.some((k) => prop(k, 'position') === 'static' && margins(k) === null)) return null;
  const ma = margins(a);
  const mb = margins(b);
  if (ma === null || mb === null) return null;
  const display = prop(parent, 'display');
  if (display === 'block' || display === 'flow-root') {
    // Block flow: the later box starts below the earlier one's margin, collapsed with any between at no less than either.
    const aFirst = kids.indexOf(a) < kids.indexOf(b);
    return { v: aFirst ? { ab: Math.max(ma.bottom, mb.top), ba: Infinity } : { ab: Infinity, ba: Math.max(mb.bottom, ma.top) }, h: null };
  }
  if (display !== 'flex') return null;
  const row = ['row', 'row-reverse'].includes(prop(parent, 'flex-direction'));
  const wraps = prop(parent, 'flex-wrap') !== 'nowrap';
  const rowGap = lengthOf(prop(parent, 'row-gap')) ?? 0;
  const columnGap = lengthOf(prop(parent, 'column-gap')) ?? 0;
  // Along a flex line two items are at least their facing margins apart, in whichever order the line holds them; across lines, at
  // least the margins between the lines (each line holds its items' margin boxes).
  const h = { ab: ma.right + mb.left + (row ? columnGap : rowGap), ba: mb.right + ma.left + (row ? columnGap : rowGap) };
  const v = { ab: ma.bottom + mb.top + (row ? rowGap : columnGap), ba: mb.bottom + ma.top + (row ? rowGap : columnGap) };
  if (!wraps) return row ? { v: null, h } : { v, h: null };
  // Items may share a line or not: both gaps must hold.
  return { v, h };
}

/** Code points of an Ahem text's longest unbreakable run, at most (the whole text when it does not wrap). */
function longestRun(t: ResolvedText): number {
  const runs = prop(t, 'text-wrap-mode') === 'nowrap' ? [t.text] : t.text.split(/[ \n\t]/);
  return Math.max(0, ...runs.map((r) => [...r].length));
}

/**
 * How far, in css px, a text's ink stays inside the border box of the ancestor `top` on each axis (null where unknown): its lines'
 * half leading and the padding of every box from its container up to `top` vertically, with every height auto; across, the
 * padding and margins of the same boxes, when its container fits the text (a px width at least its longest run in Ahem, or an auto
 * width under a flex item that is never narrower than its content).
 */
function insetOf(t: InkText, top: ResolvedElement, parents: ReadonlyMap<ResolvedElement, ResolvedElement>): Readonly<Record<Side, number>> & { readonly vKnown: boolean; readonly hKnown: boolean } {
  const chain: ResolvedElement[] = [];
  for (let e: ResolvedElement | undefined = t.container; e !== undefined; e = parents.get(e)) {
    chain.push(e);
    if (e === top) break;
  }
  const size = pxOf(prop(t.text, 'font-size'));
  const lh = prop(t.text, 'line-height');
  const lhPx = lh === 'normal' ? null : pxOf(lh) ?? (/^[0-9.]+$/.test(lh) && size !== null ? Number(lh) * size : null);
  // Chrome rounds Ahem's ascent and descent apart at normal, so its line may fall 1px short of the em box.
  const leading = size === null ? null : lh === 'normal' ? -1 : lhPx === null ? null : lhPx - size;
  const flows = chain.every((e) => e === top || inFlow(e)) && inFlow(top);
  const out = { top: 0, right: 0, bottom: 0, left: 0, vKnown: false, hKnown: false };
  if (flows && leading !== null && chain.every((e) => prop(e, 'height') === 'auto' && prop(e, 'max-height') === 'none')) {
    for (const s of ['top', 'bottom'] as const) out[s] = leading / 2 + chain.reduce((sum, e) => sum + padding(e, s) + border(e, s), 0);
    out.vKnown = true;
  }
  const textOnly = t.container.children.every((c) => c.kind === 'text');
  const em = size === null ? null : longestRun(t.text) * size;
  const letterSpacing = prop(t.text, 'letter-spacing');
  const fits = (e: ResolvedElement, k: number): boolean => {
    const w = pxOf(prop(e, 'width'));
    if (w === null) return false;
    const inner = prop(e, 'box-sizing') === 'border-box' ? w - padding(e, 'left') - padding(e, 'right') - border(e, 'left') - border(e, 'right') : w;
    if (k === 0) return textOnly && em !== null && letterSpacing === 'normal' && em <= inner;
    const child = chain[k - 1] as ResolvedElement;
    const cm = margins(child);
    const cw = pxOf(prop(child, 'width'));
    if (cm === null || cw === null) return false;
    const outer = cm.left + cm.right + (prop(child, 'box-sizing') === 'border-box' ? cw : cw + padding(child, 'left') + padding(child, 'right') + border(child, 'left') + border(child, 'right'));
    return outer <= inner;
  };
  const parentOfTop = parents.get(top);
  const flexItem = parentOfTop !== undefined && prop(parentOfTop, 'display') === 'flex';
  const fitsAll = chain.every((e, k) => fits(e, k));
  const shrinkWrapped = flexItem && chain.every((e) => prop(e, 'width') === 'auto') && prop(top, 'min-width') === 'auto' && prop(top, 'overflow-x') === 'visible';
  if (flows && (fitsAll || shrinkWrapped)) {
    // Each box's padding and border, and the margins of each box below top (inside its parent, which fits its margin box).
    for (const s of ['left', 'right'] as const) out[s] = chain.reduce((sum, e) => sum + padding(e, s) + border(e, s), 0) + chain.slice(0, -1).reduce((sum, e) => sum + (margins(e)?.[s] ?? 0), 0);
    out.hKnown = true;
  }
  return out;
}

const border = (el: ResolvedElement, s: Side): number => {
  const style = prop(el, `border-${s}-style`);
  return style === 'none' || style === 'hidden' ? 0 : Math.max(0, pxOf(prop(el, `border-${s}-width`)) ?? 0);
};

/**
 * Why a text with a risky (blurred or translucent) shadow may meet another text's ink or shadows, or null when the two are proven
 * apart by at least the slack the wrap bound keeps (slack and blurSlack device px at scale minScale).
 */
export function meetRefusal(t: InkText, u: InkText, parents: ReadonlyMap<ResolvedElement, ResolvedElement>, slack: number, blurSlack: number, minScale: number): string | null {
  const risky = (x: InkText): boolean => x.reach.top.some((r) => r.risky);
  if (!risky(t) && !risky(u)) return null;
  const ct = chainOf(t.container, parents);
  const cu = chainOf(u.container, parents);
  const common = ct.find((e) => cu.includes(e));
  const at = `text ${u.text.node.address}`;
  if (common === undefined || common === t.container || common === u.container) return `${at} shares its block container or lies inside it, so their glyphs and shadows may meet`;
  const a = ct[ct.indexOf(common) - 1] as ResolvedElement;
  const b = cu[cu.indexOf(common) - 1] as ResolvedElement;
  const gap = gapOf(common, a, b);
  if (gap === null) return `${at} is not kept apart from it by in-flow boxes with margins of 0 or more under a block or flex parent`;
  const it = insetOf(t, a, parents);
  const iu = insetOf(u, b, parents);
  const axis = (g: Gaps | null, known: boolean, near: Side, far: Side, name: string): string | null => {
    if (g === null) return null;
    if (!known) return `the ${name} extent of the texts' ink within their boxes is unknown`;
    // a's box first: t's far side faces u's near side; b's box first, the other way round.
    for (const [apart, x, y] of [[g.ab + it[far] + iu[near], t.reach[far], u.reach[near]], [g.ba + iu[far] + it[near], u.reach[far], t.reach[near]]] as const) {
      if (apart === Infinity) continue;
      for (const e of x) {
        for (const f of y) {
          if (!e.risky && !f.risky) continue;
          const need = (slack + (e.blurred ? blurSlack : 0) + (f.blurred ? blurSlack : 0)) / minScale;
          if (apart - e.v - f.v < need) return `their ${name} reaches, ${e.v}px and ${f.v}px, leave ${apart - e.v - f.v}px between them, under ${need}px`;
        }
      }
    }
    return null;
  };
  if (gap.v === null && gap.h === null) return `${at} is not kept apart from it on either axis`;
  const why = axis(gap.v, it.vKnown && iu.vKnown, 'top', 'bottom', 'vertical') ?? axis(gap.h, it.hKnown && iu.hKnown, 'left', 'right', 'horizontal');
  return why === null ? null : `its shadows and ${at} may meet (${why}), and the device encodes each shadow over the backdrop alone`;
}
