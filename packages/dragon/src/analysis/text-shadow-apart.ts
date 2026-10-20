// TXT-FX: whether two texts' shadows may meet on the native targets. The device encodes each shadowed line's layer over the backdrop
// its container and ancestors paint (emit/paint/text-shadow.ts, paint-shadow.ts textShadowLayerOver), not over the other texts'
// shadows and glyphs, so a blurred or translucent shadow composites as Chrome does only where it meets nothing painted before it but
// that backdrop. Chrome paints texts in tree order (each text's shadows, then its glyphs), so where two texts meet the later one is
// drawn over the earlier: a later hard opaque shadow or opaque glyph covers whatever is beneath exactly, and a later blurred or
// translucent shadow (or a translucent glyph) composited over the earlier text's paint is not what Chrome draws.
// Without the layout (the device lays out at its own viewport), apartness is proven from the boxes alone: two texts in different
// block containers whose paths up to their nearest common ancestor stay in normal flow, under a block, flex or grid parent (or a
// block of inline-blocks) that keeps them apart by its children's margins and gaps, with each text's ink kept inside its container
// by an auto height and a width it fits, and no relatively positioned inline box moving it.
import type { Longhand } from '../css/properties.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** How far a text's ink and its shadows reach past the ink on one side, in css px, and whether each reach composites inexactly. */
export type Reach = { readonly v: number; readonly risky: boolean; readonly blurred: boolean };
type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * One text as the shadow check sees it: its block container, its reach on each side (its ink first), its paint order (tree order),
 * and why an inline box between it and its container may move it off its line (a relative offset), or null.
 */
export type InkText = {
  readonly text: ResolvedText;
  readonly container: ResolvedElement;
  readonly reach: Readonly<Record<Side, readonly Reach[]>>;
  readonly order: number;
  readonly moved: string | null;
  /**
   * Whether tree order is its paint order against every other text: no box on its path to the root is positioned, floated, a
   * z-indexed flex or grid item, or a flex or grid item among siblings with an order other than 0.
   */
  readonly treeOrdered: boolean;
};

/** A drawn shadow: css px offsets and blur, and its colour's alpha (null for currentcolor, which every target refuses). */
export type DrawnShadow = { readonly x: number; readonly y: number; readonly blur: number; readonly alpha: number | null };

const prop = (el: { readonly props: ReadonlyMap<Longhand, ResolvedValue> | ReadonlyMap<string, ResolvedValue> }, p: string): string => {
  const v = (el.props as ReadonlyMap<string, ResolvedValue>).get(p);
  if (v === undefined) throw new Error(`${p} did not resolve`);
  return valueToString(v.value);
};
const pxOf = (v: string): number | null => (/^-?[0-9.]+px$/.test(v) ? Number(v.slice(0, -2)) : null);
/** A px length, 0 for normal where it means no length, else null. */
const lengthOf = (v: string): number | null => (v === 'normal' ? 0 : pxOf(v));

/**
 * A text's reach on each side: its ink (0; inexact when its glyphs are translucent), then each drawn shadow (offset plus its blur's
 * 3 sigma, never inside the ink).
 */
export function reachOf(shadows: readonly DrawnShadow[], glyphAlpha: number): Readonly<Record<Side, readonly Reach[]>> {
  const ink: Reach = { v: 0, risky: glyphAlpha !== 255, blurred: false };
  const drawn = shadows.filter((s) => s.alpha !== 0);
  const side = (f: (s: DrawnShadow) => number): Reach[] => [ink, ...drawn.map((s) => ({ v: Math.max(0, f(s) + 1.5 * s.blur), risky: s.blur > 0 || s.alpha !== 255, blurred: s.blur > 0 }))];
  return { top: side((s) => -s.y), right: side((s) => s.x), bottom: side((s) => s.y), left: side((s) => -s.x) };
}

/** The parents of every element under root, by element. */
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

/** A margin's lower bound in px: auto adds free space (never less than 0 in block, flex or grid layout); null for anything else. */
const marginOf = (el: ResolvedElement, s: Side): number | null => {
  const v = prop(el, `margin-${s}`);
  return v === 'auto' ? 0 : pxOf(v);
};
const margins = (el: ResolvedElement): Record<Side, number> | null => {
  const m = { top: marginOf(el, 'top'), right: marginOf(el, 'right'), bottom: marginOf(el, 'bottom'), left: marginOf(el, 'left') };
  return Object.values(m).every((v) => v !== null && v >= 0) ? (m as Record<Side, number>) : null;
};
const padding = (el: ResolvedElement, s: Side): number => Math.max(0, pxOf(prop(el, `padding-${s}`)) ?? 0);
const border = (el: ResolvedElement, s: Side): number => {
  const style = prop(el, `border-${s}-style`);
  return style === 'none' || style === 'hidden' ? 0 : Math.max(0, pxOf(prop(el, `border-${s}-width`)) ?? 0);
};

/** Whether a box lays out in flow without painting a marker: block-level, an inline-block, or a list item without its marker. */
function inFlow(el: ResolvedElement): boolean {
  if (prop(el, 'position') !== 'static' || prop(el, 'float') !== 'none') return false;
  const display = prop(el, 'display');
  if (display === 'list-item') return prop(el, 'list-style-type') === 'none' && prop(el, 'list-style-image') === 'none';
  return ['block', 'flex', 'grid', 'flow-root', 'inline-block'].includes(display);
}

/** A grid track list each of whose tracks is at least its content (auto, fr, or minmax(auto, ...)), so no item overflows its area. */
const contentSizedTracks = (v: string): boolean => v === 'none' || v.split(/\s+(?![^(]*\))/).every((t) => /^(auto|[0-9.]+fr|minmax\(auto,\s*[^)]+\)|repeat\([0-9]+,\s*(auto|[0-9.]+fr)\))$/.test(t));

/** Code points of an Ahem text's longest unbreakable run, at most (the whole text when it does not wrap). */
function longestRun(t: ResolvedText): number {
  const runs = prop(t, 'text-wrap-mode') === 'nowrap' ? [t.text] : t.text.split(/[ \n\t]/);
  return Math.max(0, ...runs.map((r) => [...r].length));
}

/** Gaps on one axis: ab when a's box comes first (above or left of b's), ba when b's does; Infinity where that order cannot occur. */
type Gaps = { readonly ab: number; readonly ba: number };
type AxisGaps = { readonly v: Gaps | null; readonly h: Gaps | null };
type Inset = Readonly<Record<Side, number>> & { readonly vKnown: boolean; readonly hKnown: boolean };
type Kids = { readonly kids: readonly ResolvedElement[]; readonly index: ReadonlyMap<ResolvedElement, number>; readonly settled: boolean; readonly placed: boolean };
/** Why two texts may meet: across a measured gap (axis), or because nothing keeps them apart. */
type Meeting = { readonly axis: boolean; readonly cause: string };

/** The meeting check of one resolved tree, with every per-box, per-parent and per-pair fact computed once. */
export class MeetCheck {
  private readonly chains = new Map<ResolvedElement, readonly ResolvedElement[]>();
  private readonly kidsOf = new Map<ResolvedElement, Kids>();
  private readonly insets = new Map<string, Inset>();
  private readonly memo = new Map<string, Meeting | null>();

  private readonly parents: ReadonlyMap<ResolvedElement, ResolvedElement>;
  private readonly slack: number;
  private readonly blurSlack: number;
  private readonly minScale: number;

  constructor(parents: ReadonlyMap<ResolvedElement, ResolvedElement>, slack: number, blurSlack: number, minScale: number) {
    this.parents = parents;
    this.slack = slack;
    this.blurSlack = blurSlack;
    this.minScale = minScale;
  }

  /**
   * Why t and u may meet where the later-painted one's blurred or translucent shadow (or translucent glyph) lands on the earlier
   * one's paint, said from t's side, or null when every such pair is proven apart by the slack the wrap bound keeps.
   */
  refusal(t: InkText, u: InkText): string | null {
    const [first, second] = t.order < u.order ? [t, u] : [u, t];
    const key = `${first.order}|${second.order}`;
    if (!this.memo.has(key)) this.memo.set(key, this.compute(first, second));
    const m = this.memo.get(key) as Meeting | null;
    if (m === null) return null;
    const other = `text ${u.text.node.address}`;
    return m.axis ? `its shadows and ${other} may meet (${m.cause}), and the device encodes each shadow over the backdrop alone` : `${other} may meet it: ${m.cause}`;
  }

  private chainOf(el: ResolvedElement): readonly ResolvedElement[] {
    let c = this.chains.get(el);
    if (c === undefined) {
      const p = this.parents.get(el);
      c = [el, ...(p === undefined ? [] : this.chainOf(p))];
      this.chains.set(el, c);
    }
    return c;
  }

  /** A parent's rendered children and their order, whether each in-flow one has margins of 0 or more, and whether any is placed. */
  private kids(parent: ResolvedElement): Kids {
    let k = this.kidsOf.get(parent);
    if (k === undefined) {
      const kids = parent.children.filter((c): c is ResolvedElement => c.kind === 'element' && prop(c, 'display') !== 'none');
      k = {
        kids,
        index: new Map(kids.map((c, i) => [c, i])),
        settled: kids.every((c) => prop(c, 'position') !== 'static' || margins(c) !== null),
        placed: prop(parent, 'display') === 'grid' && kids.some((c) => ['grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end'].some((p) => prop(c, p) !== 'auto')),
      };
      this.kidsOf.set(parent, k);
    }
    return k;
  }

  /** The least css px between two in-flow children's border boxes on each axis (null where unknown). */
  private gapOf(parent: ResolvedElement, a: ResolvedElement, b: ResolvedElement): AxisGaps | null {
    const { index, settled, placed } = this.kids(parent);
    if (!settled || !inFlow(a) || !inFlow(b)) return null;
    const ma = margins(a);
    const mb = margins(b);
    if (ma === null || mb === null) return null;
    const display = prop(parent, 'display');
    const facing = (gapH: number, gapV: number): AxisGaps => ({
      h: { ab: ma.right + mb.left + gapH, ba: mb.right + ma.left + gapH },
      v: { ab: ma.bottom + mb.top + gapV, ba: mb.bottom + ma.top + gapV },
    });
    if (['block', 'flow-root', 'list-item', 'inline-block'].includes(display)) {
      const inline = (e: ResolvedElement): boolean => prop(e, 'display') === 'inline-block';
      // Inline-blocks on one line sit side by side, each line box holding their margin boxes; on two lines one is below the
      // other: both gaps must hold.
      if (inline(a) && inline(b)) return facing(0, 0);
      if (inline(a) || inline(b)) return null;
      // Block flow: the later box starts below the earlier one's margin, collapsed with any between at no less than either.
      const aFirst = (index.get(a) as number) < (index.get(b) as number);
      return { v: aFirst ? { ab: Math.max(ma.bottom, mb.top), ba: Infinity } : { ab: Infinity, ba: Math.max(mb.bottom, ma.top) }, h: null };
    }
    const rowGap = lengthOf(prop(parent, 'row-gap')) ?? 0;
    const columnGap = lengthOf(prop(parent, 'column-gap')) ?? 0;
    if (display === 'flex') {
      const row = ['row', 'row-reverse'].includes(prop(parent, 'flex-direction'));
      // Along a flex line two items are at least their facing margins apart, in whichever order the line holds them; across lines,
      // at least the margins between the lines (each line holds its items' margin boxes). When it wraps, items may share a line or
      // not: both gaps must hold.
      const g = facing(row ? columnGap : rowGap, row ? rowGap : columnGap);
      if (prop(parent, 'flex-wrap') !== 'nowrap') return g;
      return row ? { v: null, h: g.h } : { v: g.v, h: null };
    }
    if (display === 'grid') {
      // Auto-placed items take distinct cells of content-sized tracks: in one row they are the column gap apart, in one column the
      // row gap; either may hold, so both must.
      if (placed || !contentSizedTracks(prop(parent, 'grid-template-columns')) || !contentSizedTracks(prop(parent, 'grid-template-rows'))) return null;
      return facing(columnGap, rowGap);
    }
    return null;
  }

  /**
   * How far, in css px, a text's ink stays inside the border box of the ancestor `top` on each side: its lines' half leading and
   * the padding and border of every box from its container up to `top` vertically, with every height auto; across, the same and
   * the margins of the boxes below `top`, when its container fits the text (a px width at least its longest run in Ahem that no
   * flex line shrinks, or auto widths under a flex or grid item or an inline-block, which is never narrower than its content).
   */
  private insetOf(t: InkText, top: ResolvedElement): Inset {
    const key = `${t.order}|${top.element.address}`;
    const hit = this.insets.get(key);
    if (hit !== undefined) return hit;
    const chain: ResolvedElement[] = [];
    for (let e: ResolvedElement | undefined = t.container; e !== undefined; e = this.parents.get(e)) {
      chain.push(e);
      if (e === top) break;
    }
    const size = pxOf(prop(t.text, 'font-size'));
    const lh = prop(t.text, 'line-height');
    const lhPx = lh === 'normal' ? null : pxOf(lh) ?? (/^[0-9.]+$/.test(lh) && size !== null ? Number(lh) * size : null);
    // Chrome rounds Ahem's ascent and descent apart at normal, so its line may fall 1px short of the em box.
    const leading = size === null ? null : lh === 'normal' ? -1 : lhPx === null ? null : lhPx - size;
    // Every box on the way keeps its content inside: in flow, below top with margins of 0 or more, and none of its in-flow children
    // pulling back with a negative margin, which would end an auto height above the content.
    const flows = t.moved === null && chain.every((e) => inFlow(e) && this.kids(e).settled) && chain.slice(0, -1).every((e) => margins(e) !== null);
    const out = { top: 0, right: 0, bottom: 0, left: 0, vKnown: false, hKnown: false };
    // A flex item along its main axis may end up smaller than its content: shrunk or based below it, unless its min size is auto
    // (its content) with overflow visible, or it neither shrinks nor takes a basis.
    const shrinks = (e: ResolvedElement, axis: 'width' | 'height'): boolean => {
      const p = this.parents.get(e);
      if (p === undefined || prop(p, 'display') !== 'flex') return false;
      const column = prop(p, 'flex-direction').startsWith('column');
      if (column !== (axis === 'height')) return false;
      if (prop(e, `min-${axis}`) === 'auto' && prop(e, axis === 'width' ? 'overflow-x' : 'overflow-y') === 'visible') return false;
      return !(prop(e, 'flex-shrink') === '0' && prop(e, 'flex-basis') === 'auto');
    };
    if (flows && leading !== null && chain.every((e) => prop(e, 'height') === 'auto' && prop(e, 'max-height') === 'none' && !shrinks(e, 'height'))) {
      for (const s of ['top', 'bottom'] as const) out[s] = leading / 2 + chain.reduce((sum, e) => sum + padding(e, s) + border(e, s), 0);
      out.vKnown = true;
    }
    const textOnly = t.container.children.every((c) => c.kind === 'text');
    const em = size === null ? null : longestRun(t.text) * size;
    const letterSpacing = prop(t.text, 'letter-spacing');
    const fits = (e: ResolvedElement, k: number): boolean => {
      const w = pxOf(prop(e, 'width'));
      if (w === null || shrinks(e, 'width')) return false;
      const inner = prop(e, 'box-sizing') === 'border-box' ? w - padding(e, 'left') - padding(e, 'right') - border(e, 'left') - border(e, 'right') : w;
      if (k === 0) return textOnly && em !== null && letterSpacing === 'normal' && em <= inner;
      const child = chain[k - 1] as ResolvedElement;
      const cm = margins(child);
      const cw = pxOf(prop(child, 'width'));
      if (cm === null || cw === null) return false;
      const outer = cm.left + cm.right + (prop(child, 'box-sizing') === 'border-box' ? cw : cw + padding(child, 'left') + padding(child, 'right') + border(child, 'left') + border(child, 'right'));
      return outer <= inner;
    };
    const parentOfTop = this.parents.get(top);
    const item = parentOfTop !== undefined && ['flex', 'grid'].includes(prop(parentOfTop, 'display'));
    const shrinkWrapped = (item || prop(top, 'display') === 'inline-block') && chain.every((e) => prop(e, 'width') === 'auto') && prop(top, 'min-width') === 'auto' && prop(top, 'overflow-x') === 'visible';
    if (flows && (chain.every((e, k) => fits(e, k)) || shrinkWrapped)) {
      for (const s of ['left', 'right'] as const) out[s] = chain.reduce((sum, e) => sum + padding(e, s) + border(e, s), 0) + chain.slice(0, -1).reduce((sum, e) => sum + (margins(e)?.[s] ?? 0), 0);
      out.hKnown = true;
    }
    this.insets.set(key, out);
    return out;
  }

  /** first comes before second in tree order (and paints first, where both are treeOrdered). */
  private compute(first: InkText, second: InkText): Meeting | null {
    // Only the later text's inexact paint can land on the earlier text's; the earlier never paints over the later.
    // Where tree order may not be paint order (positioning, floats, z-index or order on a path), either may paint over the other.
    const ordered = first.treeOrdered && second.treeOrdered;
    const risky = (x: InkText): boolean => SIDES.some((s) => x.reach[s].some((r) => r.risky));
    if (!risky(second) && (ordered || !risky(first))) return null;
    const moved = first.moved ?? second.moved;
    if (moved !== null) return { axis: false, cause: moved };
    const ct = this.chainOf(first.container);
    const cu = this.chainOf(second.container);
    const inSecond = new Set(cu);
    const common = ct.find((e) => inSecond.has(e));
    if (common === undefined || common === first.container || common === second.container) return { axis: false, cause: 'they share a block container, or one lies inside the other\'s, so their glyphs and shadows may meet' };
    const a = ct[ct.indexOf(common) - 1] as ResolvedElement;
    const b = cu[cu.indexOf(common) - 1] as ResolvedElement;
    const gap = this.gapOf(common, a, b);
    if (gap === null || (gap.v === null && gap.h === null)) return { axis: false, cause: 'they are not kept apart by in-flow boxes with margins of 0 or more under a block, flex or grid parent' };
    const ia = this.insetOf(first, a);
    const ib = this.insetOf(second, b);
    const axis = (g: Gaps | null, known: boolean, near: Side, far: Side, name: string): string | null => {
      if (g === null) return null;
      if (!known) return `the ${name} extent of the texts' ink within their boxes is unknown`;
      // a's box first: first's far side faces second's near side; b's box first, the other way round.
      for (const [apart, early, late] of [[g.ab + ia[far] + ib[near], first.reach[far], second.reach[near]], [g.ba + ib[far] + ia[near], first.reach[near], second.reach[far]]] as const) {
        if (apart === Infinity) continue;
        for (const e of early) {
          for (const f of late) {
            if (!f.risky && (ordered || !e.risky)) continue;
            const need = (this.slack + (e.blurred ? this.blurSlack : 0) + (f.blurred ? this.blurSlack : 0)) / this.minScale;
            if (apart - e.v - f.v < need) return `their ${name} reaches, ${e.v}px and ${f.v}px, leave ${apart - e.v - f.v}px between them, under ${need}px`;
          }
        }
      }
      return null;
    };
    const why = axis(gap.v, ia.vKnown && ib.vKnown, 'top', 'bottom', 'vertical') ?? axis(gap.h, ia.hKnown && ib.hKnown, 'left', 'right', 'horizontal');
    return why === null ? null : { axis: true, cause: why };
  }
}
