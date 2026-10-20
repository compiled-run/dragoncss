// BG2-t on the native targets: a no-repeat gradient layer away from the start edge of its axis (right, bottom, a percentage, an
// offset from the far edge). paint-gradient.ts layerPlacement draws such a tile directly, one tile at a whole device px, only when
// its offset from the clip box is positive (CalculateRepeatAndPosition's no-repeat branch); at an offset of zero or less the tile
// starts outside the box, its phase is the unsnapped offset, and the snapped dest outgrows the tile wherever a box edge is not a
// whole device px (planBackground: singleTile false, modelled false; the device throws). That depends on the laid-out box, so the
// compiler accepts a layer only when it proves the offset positive for every box the program can lay out, at every device scale.
import type { LengthPct } from '@dragon/layout';
import type { Longhand } from '../../css/properties.ts';
import type { CssValue } from '../../css/values.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Bg2PhaseFaults } from '../../faults/bg2-phase.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import type { BoxItem, ElementLayer } from './gradient.ts';
import { BG2_TILING, boxWidths, paintsGradient, resolvedLayers } from './gradient.ts';

/** The device scales each native target's device lanes run at (parity targets.ts deviceDprs checks it holds the same). */
export const NATIVE_DEVICE_DPRS: { readonly ios: readonly number[]; readonly android: readonly number[] } = { ios: [2, 3], android: [2, 3, 2.625] };

/** How far past zero, in CSS px, the proven offset must be: it absorbs the LU rounding of padding, percentages and the tile. */
const MARGIN = 1 / 8;

type Axis = 'x' | 'y';
/** Physical sides per axis, as indexes into top, right, bottom, left: [start, end]. */
const SIDES: { readonly [A in Axis]: readonly [number, number] } = { x: [3, 1], y: [0, 2] };
const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;
const SIZE: { readonly [A in Axis]: { readonly size: Longhand; readonly min: Longhand; readonly max: Longhand } } = {
  x: { size: 'width' as Longhand, min: 'min-width' as Longhand, max: 'max-width' as Longhand },
  y: { size: 'height' as Longhand, min: 'min-height' as Longhand, max: 'max-height' as Longhand },
};

const valueOf = (el: ResolvedElement, p: string): CssValue | null => el.props.get(p as Longhand)?.value ?? null;
const keyword = (el: ResolvedElement, p: string): string | null => {
  const v = valueOf(el, p);
  return v !== null && v.kind === 'keyword' ? v.value : null;
};
/** A px length (a percentage of 0 is 0), or null. */
const px = (el: ResolvedElement, p: string): number | null => {
  const v = valueOf(el, p);
  if (v !== null && v.kind === 'length' && v.unit === 'px') return v.value;
  if (v !== null && v.kind === 'percentage' && v.value === 0) return 0;
  return null;
};
/** A border side's width in CSS px (0 when its style is none or hidden), or null when it is not a px length. */
const border = (el: ResolvedElement, side: number): number | null => {
  const s = SIDE_NAMES[side] as string;
  const style = keyword(el, `border-${s}-style`);
  if (style === 'none' || style === 'hidden') return 0;
  return px(el, `border-${s}-width`);
};
const padding = (el: ResolvedElement, side: number): number | null => px(el, `padding-${SIDE_NAMES[side] as string}`);
const sum = (xs: readonly (number | null)[]): number | null => (xs.some((x) => x === null) ? null : (xs as number[]).reduce((a, b) => a + b, 0));

/** The displays whose box takes width and height as written. */
const SIZED_DISPLAYS: ReadonlySet<string> = new Set(['block', 'flow-root', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'list-item']);
/** The displays a percentage size of an in-flow child resolves against the content box of. */
const PERCENT_PARENTS: ReadonlySet<string> = new Set(['block', 'flow-root', 'inline-block', 'flex', 'inline-flex', 'list-item']);
const outOfFlow = (el: ResolvedElement): boolean => ['absolute', 'fixed'].includes(keyword(el, 'position') ?? '');
const horizontal = (el: ResolvedElement): boolean => (keyword(el, 'writing-mode') ?? 'horizontal-tb') === 'horizontal-tb';
const isFlex = (el: ResolvedElement): boolean => ['flex', 'inline-flex'].includes(keyword(el, 'display') ?? '');
const mainAxis = (flex: ResolvedElement): Axis | null => {
  const d = keyword(flex, 'flex-direction');
  return d === 'row' || d === 'row-reverse' ? 'x' : d === 'column' || d === 'column-reverse' ? 'y' : null;
};

/** The width or height a box writes, before any flex shrinking: [fixed px, fraction of the containing block's content size]. */
function specified(el: ResolvedElement, axis: Axis): readonly [number, number] | null {
  const v = valueOf(el, SIZE[axis].size);
  let fixed: number;
  let frac = 0;
  if (v !== null && v.kind === 'length' && v.unit === 'px') fixed = v.value;
  else if (v !== null && v.kind === 'percentage' && axis === 'x' && !outOfFlow(el)) {
    fixed = 0;
    frac = v.value / 100;
  } else return null;
  // A max-* other than none caps the size: only a px cap is known; a min-* only grows it, and is ignored for a lower bound.
  const max = valueOf(el, SIZE[axis].max);
  if (max !== null && !(max.kind === 'keyword' && max.value === 'none')) {
    if (max.kind !== 'length' || max.unit !== 'px') return null;
    if (frac !== 0) return null;
    fixed = Math.min(fixed, max.value);
  }
  return [fixed, frac];
}

/** The box-sizing box's extras on an axis (padding and borders for content-box sizing, nothing for border-box), or null. */
function sizingExtras(el: ResolvedElement, axis: Axis): number | null {
  if (keyword(el, 'box-sizing') === 'border-box') return 0;
  const [s, e] = SIDES[axis];
  return sum([padding(el, s), padding(el, e), border(el, s), border(el, e)]);
}

/** The content-box size of a box on an axis, at least, in CSS px, or null when no program fact bounds it. */
function contentLower(el: ResolvedElement, axis: Axis, ancestors: readonly ResolvedElement[]): number | null {
  const used = usedLower(el, axis, ancestors);
  if (used === null) return null;
  if (keyword(el, 'box-sizing') !== 'border-box') return used;
  const [s, e] = SIDES[axis];
  const less = sum([padding(el, s), padding(el, e), border(el, s), border(el, e)]);
  return less === null ? null : Math.max(0, used - less);
}

/**
 * The used width or height of a box in its box-sizing box, at least, in CSS px, or null. A px size holds unless a flex container
 * shrinks it on its main axis; a percentage width resolves against the parent's content box. Shrinking is ruled out when the
 * item's flex-shrink is 0, when a wrapping container's line fits the item alone, or when every item of a single-line container
 * fits together; any other case is unknown.
 */
function usedLower(el: ResolvedElement, axis: Axis, ancestors: readonly ResolvedElement[]): number | null {
  const display = keyword(el, 'display') ?? '';
  if (!SIZED_DISPLAYS.has(display) || !horizontal(el)) return null;
  const spec = specified(el, axis);
  if (spec === null) return null;
  const parent = ancestors[ancestors.length - 1] ?? null;
  // A display: contents parent hands the box to the grandparent's formatting context, which this does not follow.
  if (parent !== null && keyword(parent, 'display') === 'contents') return null;
  const [fixed, frac] = spec;
  let base = 0;
  if (frac !== 0) {
    if (parent === null || !PERCENT_PARENTS.has(keyword(parent, 'display') ?? '') || !horizontal(parent)) return null;
    const c = contentLower(parent, axis, ancestors.slice(0, -1));
    if (c === null) return null;
    base = c;
  }
  const used = fixed + frac * base;
  if (parent === null || outOfFlow(el) || !isFlex(parent) || mainAxis(parent) !== axis) return used;
  // A flex item on its container's main axis: no shrinking unless proven.
  const shrink = valueOf(el, 'flex-shrink');
  if (shrink !== null && shrink.kind === 'number' && shrink.value === 0 && keyword(el, 'flex-basis') === 'auto') return used;
  if (keyword(el, 'flex-basis') !== 'auto' || !horizontal(parent)) return null;
  const line = contentLower(parent, axis, ancestors.slice(0, -1));
  if (line === null) return null;
  const wraps = (keyword(parent, 'flex-wrap') ?? 'nowrap') !== 'nowrap';
  const items = wraps ? [el] : parent.children.filter((c): c is ResolvedElement => c.kind === 'element' && !outOfFlow(c) && keyword(c, 'display') !== 'none');
  if (!wraps && parent.children.some((c) => c.kind === 'text')) return null;
  let fixedSum = 0;
  let fracSum = 0;
  for (const item of items) {
    const outer = outerHypothetical(item, axis);
    if (outer === null) return null;
    fixedSum += outer[0];
    fracSum += outer[1];
  }
  if (!wraps && items.length > 1) {
    const gap = valueOf(parent, axis === 'x' ? 'column-gap' : 'row-gap');
    const g = gap !== null && gap.kind === 'keyword' && gap.value === 'normal' ? 0 : px(parent, axis === 'x' ? 'column-gap' : 'row-gap');
    if (g === null) return null;
    fixedSum += g * (items.length - 1);
  }
  // The items fit a line of any size from `line` up: line * (1 - fractions) >= the fixed parts.
  return fracSum <= 1 && line * (1 - fracSum) >= fixedSum ? used : null;
}

/** An item's outer hypothetical main size, at most: [fixed px, fraction of the container's content size], or null. */
function outerHypothetical(item: ResolvedElement, axis: Axis): readonly [number, number] | null {
  if (keyword(item, 'flex-basis') !== 'auto') return null;
  const v = valueOf(item, SIZE[axis].size);
  let fixed: number;
  let frac = 0;
  if (v !== null && v.kind === 'length' && v.unit === 'px') fixed = v.value;
  else if (v !== null && v.kind === 'percentage' && axis === 'x') {
    fixed = 0;
    frac = v.value / 100;
  } else return null;
  // A min-* raises the hypothetical size: only a px one, or auto (a content-based minimum, never above the specified size).
  const min = valueOf(item, SIZE[axis].min);
  if (min !== null && !(min.kind === 'keyword' && min.value === 'auto')) {
    if (min.kind !== 'length' || min.unit !== 'px') return null;
    if (frac !== 0 && min.value > 0) return null;
    fixed = Math.max(fixed, min.value);
  }
  const extras = sizingExtras(item, axis);
  if (extras === null) return null;
  const [s, e] = SIDES[axis];
  const margins = [s, e].map((side) => {
    const m = valueOf(item, `margin-${SIDE_NAMES[side] as string}`);
    if (m !== null && m.kind === 'keyword' && m.value === 'auto') return 0;
    return px(item, `margin-${SIDE_NAMES[side] as string}`);
  });
  const m = sum(margins);
  if (m === null) return null;
  return [fixed + extras + m, frac];
}

/** How many borders and paddings a box keyword holds inside the border box at one side: [borders, paddings]. */
const OUTSET: { readonly [B in BoxItem]: readonly [number, number] } = { 'border-box': [0, 0], 'padding-box': [1, 0], 'content-box': [1, 1] };

/**
 * A border side's used width in CSS px at any device scale of 1 and up: from 0 (Chrome floors it to whole device px, and an
 * initial medium is 3 device px at every scale) to the written width, or 1 device px (at most 1 CSS px) for a thinner one.
 */
const borderUpper = (b: number): number => (b > 0 ? Math.max(b, 1) : 0);

/** The least value of c * B over the used widths B of a border written b: 0 for c >= 0, else c times the largest. */
const borderTerm = (c: number, b: number): number => (c >= 0 ? 0 : c * borderUpper(b));
/** c * P for a padding written p, or null when it is unknown and counts. */
const paddingTerm = (c: number, p: number | null): number | null => (c === 0 ? 0 : p === null ? null : c * p);

/** Whether a position is the start edge: 0 from the left or top, or 100% from the right or bottom. */
const atStart = (v: LengthPct): boolean => ((v.unit === 'percent' || v.unit === 'px') && v.value === 0) || (v.unit === 'end-percent' && v.value === 100);

/**
 * The least offset of a no-repeat tile from its clip box on an axis, in CSS px over every box the program lays out and every device
 * scale of 1 and up, or null when no program fact bounds it. Positive means layerPlacement takes the one-tile branch.
 */
export function phaseOffsetLower(el: ResolvedElement, layer: ElementLayer, axis: Axis, ancestors: readonly ResolvedElement[]): number | null {
  const g = layer.geometry;
  const pos = axis === 'x' ? g.positionX : g.positionY;
  const [start, end] = SIDES[axis];
  const bs = border(el, start);
  const be = border(el, end);
  if (bs === null || be === null) return null;
  const ps = padding(el, start);
  const pe = padding(el, end);
  const [bo, po] = OUTSET[g.origin];
  // ComputeDestRectAdjustments: the clip box; a border-box clip drops each border side that obscures the background.
  const [bd, pd] = g.clip === 'border-box' ? [boxWidths(el).obscures[start] === true ? 1 : 0, 0] : OUTSET[g.clip];
  // The origin box's start offset from the clip box's: (bo - bd) borders and (po - pd) paddings.
  const pad = paddingTerm(po - pd, ps);
  if (pad === null) return null;
  const boxOffset = borderTerm(bo - bd, bs) + pad;
  if (pos.unit === 'px') return boxOffset + pos.value;
  // The positioning area: the origin box's extent, from the used size of the box-sizing box.
  const used = usedLower(el, axis, ancestors);
  if (used === null) return null;
  const sign = keyword(el, 'box-sizing') === 'border-box' ? -1 : 1;
  const c = (k: number): number => (sign === 1 ? 1 - k : -k);
  const padStart = paddingTerm(c(po), ps);
  const padEnd = paddingTerm(c(po), pe);
  if (padStart === null || padEnd === null) return null;
  const area = Math.max(0, used + borderTerm(c(bo), bs) + borderTerm(c(bo), be) + padStart + padEnd);
  // The free space (area - tile), at least. A percentage or auto tile is a share of the snapped area, at most 2 device px
  // (2 CSS px) larger than the area.
  const size = axis === 'x' ? g.sizeX : g.sizeY;
  let free: number;
  if (g.sizeKind === 'length' && size.unit === 'px') free = area - size.value;
  else if (g.sizeKind === 'length' && size.unit === 'percent' && size.value <= 100) free = area * (1 - size.value / 100) - (2 * size.value) / 100;
  else free = -2;
  let offset: number;
  if (pos.unit === 'percent') offset = pos.value >= 0 ? (pos.value / 100) * free : Number.NEGATIVE_INFINITY;
  else if (pos.unit === 'end-percent') offset = pos.value <= 100 ? (1 - pos.value / 100) * free : Number.NEGATIVE_INFINITY;
  else offset = free - pos.value;
  return boxOffset + offset;
}

/**
 * The first of a target's device scales at which a box laid out at whole CSS px can have an edge off the device px grid, so a tile
 * that starts outside it is unmodelled (gradient-phase.test.ts finds such a box through planBackground), or null: at a whole scale
 * only a fractional layout does it.
 */
const fractionalScale = (dprs: readonly number[]): number | null => dprs.find((d) => !Number.isInteger(d)) ?? null;

const describePosition = (v: LengthPct): string => (v.unit === 'percent' ? `${v.value}%` : v.unit === 'px' ? `${v.value}px` : `${v.unit === 'end-percent' ? `${v.value}%` : `${v.value}px`} from the far edge`);

/**
 * BG2-t on the native targets: every no-repeat axis of a gradient layer away from the start edge must sit at an offset proven
 * positive (phaseOffsetLower), or the layer is refused at that axis's background-position longhand on ios and android, naming the
 * target's device scale at which a box at whole CSS px can leave it unmodelled (fractionalScale).
 */
export function checkGradientPhase(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: Bg2PhaseFaults): void {
  const native = targets.filter((t): t is 'ios' | 'android' => t === 'ios' || t === 'android');
  if (native.length === 0 || faults.gradientPhaseUnchecked) return;
  const walk = (el: ResolvedElement, ancestors: readonly ResolvedElement[]): void => {
    if (keyword(el, 'display') === 'none') return;
    if (el.element.tag !== 'html' && el.element.tag !== 'body' && keyword(el, 'display') !== 'inline' && paintsGradient(el)) check(el, ancestors);
    for (const c of el.children) if (c.kind === 'element') walk(c, [...ancestors, el]);
  };
  const check = (el: ResolvedElement, ancestors: readonly ResolvedElement[]): void => {
    const layers = resolvedLayers(el);
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i] as ElementLayer;
      if (layer.image.kind !== 'gradient') continue;
      for (const axis of ['x', 'y'] as const) {
        if ((axis === 'x' ? layer.geometry.repeatX : layer.geometry.repeatY) !== 'no-repeat') continue;
        const pos = axis === 'x' ? layer.geometry.positionX : layer.geometry.positionY;
        if (atStart(pos)) continue;
        const lower = phaseOffsetLower(el, layer, axis, ancestors);
        if (lower !== null && lower >= MARGIN) continue;
        const property = `background-position-${axis}`;
        const at = (el.props.get(property as Longhand) ?? el.props.get('background-image' as Longhand)) as ResolvedValue;
        const origin = at.declaration === null ? el.element.node.origin : authored(at.declaration.valueSpan);
        const kind = layer.image.gradient.radial ? 'radial' : 'linear';
        const long = axis === 'x' ? 'wider' : 'taller';
        for (const t of native) {
          const id = `${t}|background-layers-phase|${el.element.address}`;
          if (reported.has(id)) continue;
          reported.add(id);
          const dpr = fractionalScale(NATIVE_DEVICE_DPRS[t]);
          const where = dpr === null ? `at a box edge that is not a whole device px (at DPR ${NATIVE_DEVICE_DPRS[t].join(' and ')} a box at whole CSS px stays modelled)` : `at DPR ${dpr}, where a box at whole CSS px has edges off the device px grid`;
          const message = `${property} on ${el.element.address}: layer ${i + 1} (a ${kind} gradient) sits at ${describePosition(pos)} with no-repeat, and Dragon cannot prove the box ${long} than its tile, so the tile may start outside the box at a phase that is not a whole device px, which the native background plan does not model ${where} (${BG2_TILING})`;
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual: `Place the layer at the ${axis === 'x' ? 'left' : 'top'} edge or a px offset from it, or give the box a px ${axis === 'x' ? 'width' : 'height'} larger than the tile.`, basis: 'computed-value' }));
        }
        return;
      }
    }
  };
  walk(root, []);
}
