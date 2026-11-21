// css-anchor-position-1 (W3C WD 2026-09-06) at build time: each anchored box's target anchor elements (§2.3), its position options
// (§6.1, try tactics executed as §6.5.2 says) and every anchor() (§3.2) and anchor-size() (§5.1) as the engine's physical data
// (input.ts AnchorStyle). The element tree is fixed, so every lookup is decided here; the engine only reads the anchor boxes' rects.
// A part of the spec this file does not lower is refused by name (AnchorLoweringError), never approximated.
import type { CssNode } from 'css-tree';
import { generate, parse } from 'css-tree';
import type { AnchorEdge, AnchorOption, AnchorSizeRef, AnchorStyle, AreaTrack, ControlBox, InsetValue, LayoutBox, LayoutStyle, PositionArea, ReplacedLeaf } from '@dragon/layout';
import { list } from '../css/ast.ts';
import { asciiLower } from '../css/escapes.ts';
import { ANCHOR_VALUE_TYPES } from '../css/properties/anchor-position.ts';
import type { Longhand } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import type { ResolvedElement, ResolvedValue } from '../analysis/resolve.ts';
import { valueToString } from '../analysis/resolve.ts';

export class AnchorLoweringError extends Error {
  readonly nodeId: string;
  readonly property: string;
  constructor(nodeId: string, property: string, message: string) {
    super(message);
    this.nodeId = nodeId;
    this.property = property;
  }
}

const INSETS = ['top', 'right', 'bottom', 'left'] as const;
const SIZES = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'] as const;
const MARGINS = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const;
type Inset = (typeof INSETS)[number];
type Size = (typeof SIZES)[number];

/** What an element says about anchors, read from its computed values before lowering. */
export type AnchorFacts = {
  readonly id: string;
  readonly names: readonly string[];
  /** anchor-scope: null for none, 'all', or the names. */
  readonly scope: 'all' | readonly string[] | null;
  readonly positionAnchor: string | 'auto' | null;
  readonly area: readonly string[] | null;
  readonly fallbacks: readonly (readonly string[])[];
  readonly order: string;
  readonly insets: { readonly [P in Inset]: CssValue };
  readonly sizes: { readonly [P in Size]: CssValue };
  readonly justifySelf: string;
  readonly alignSelf: string;
  /** Whether its computed visibility is visible (position-visibility: anchors-visible hides a box anchored to an invisible one). */
  readonly visible: boolean;
};

const valueOf = (el: ResolvedElement, p: Longhand): CssValue => (el.props.get(p) as ResolvedValue).value;
const isFunction = (v: CssValue, name: string): boolean => v.kind === 'other' && v.type === `${name}()`;
const keyword = (v: CssValue): string => (v.kind === 'keyword' ? v.value : valueToString(v));
const splitList = (text: string): string[][] => text.split(',').map((e) => e.trim().split(' ').filter((t) => t !== ''));

/** Whether an element's computed values use anchor positioning at all. */
export function usesAnchors(el: ResolvedElement): boolean {
  const k = (p: Longhand): string => keyword(valueOf(el, p));
  const abspos = k('position') === 'absolute' || k('position') === 'fixed';
  return k('anchor-name') !== 'none' || k('anchor-scope') !== 'none' || k('position-anchor') !== 'none' || k('position-area') !== 'none' || k('position-try-fallbacks') !== 'none'
    || k('position-try-order') !== 'normal' || (abspos && (k('justify-self') === 'anchor-center' || k('align-self') === 'anchor-center'))
    || INSETS.some((p) => isFunction(valueOf(el, p), 'anchor') || isFunction(valueOf(el, p), 'anchor-size'))
    || SIZES.some((p) => isFunction(valueOf(el, p), 'anchor-size')) || MARGINS.some((p) => isFunction(valueOf(el, p), 'anchor-size') || isFunction(valueOf(el, p), 'anchor'));
}

/** The facts the tree pass reads; a margin holding anchor-size() is refused (Dragon lowers it in sizes alone). */
export function anchorFactsOf(el: ResolvedElement): AnchorFacts {
  const id = el.element.address;
  for (const p of MARGINS) if (isFunction(valueOf(el, p), 'anchor-size') || isFunction(valueOf(el, p), 'anchor')) throw new AnchorLoweringError(id, p, `${p}: ${valueToString(valueOf(el, p))} on ${id}: anchor-size() in a margin is not lowered yet (css-anchor-position-1 §5.1)`);
  const names = (v: CssValue): readonly string[] => (v.kind === 'other' && v.type === ANCHOR_VALUE_TYPES.names ? v.text.split(', ') : []);
  const scopeValue = valueOf(el, 'anchor-scope');
  const pa = valueOf(el, 'position-anchor');
  const area = valueOf(el, 'position-area');
  const fallbacks = valueOf(el, 'position-try-fallbacks');
  return {
    id,
    names: names(valueOf(el, 'anchor-name')),
    scope: scopeValue.kind === 'keyword' ? (scopeValue.value === 'all' ? 'all' : null) : names(scopeValue),
    positionAnchor: pa.kind === 'keyword' ? (pa.value === 'auto' ? 'auto' : null) : pa.kind === 'other' && pa.type === ANCHOR_VALUE_TYPES.name ? pa.text : null,
    area: area.kind === 'other' && area.type === ANCHOR_VALUE_TYPES.area ? area.text.split(' ') : null,
    fallbacks: fallbacks.kind === 'other' && fallbacks.type === ANCHOR_VALUE_TYPES.fallbacks ? splitList(fallbacks.text) : [],
    order: keyword(valueOf(el, 'position-try-order')),
    insets: { top: valueOf(el, 'top'), right: valueOf(el, 'right'), bottom: valueOf(el, 'bottom'), left: valueOf(el, 'left') },
    sizes: { width: valueOf(el, 'width'), height: valueOf(el, 'height'), 'min-width': valueOf(el, 'min-width'), 'min-height': valueOf(el, 'min-height'), 'max-width': valueOf(el, 'max-width'), 'max-height': valueOf(el, 'max-height') },
    justifySelf: keyword(valueOf(el, 'justify-self')),
    alignSelf: keyword(valueOf(el, 'align-self')),
    visible: keyword(valueOf(el, 'visibility')) === 'visible',
  };
}

const AUTO: CssValue = { kind: 'keyword', value: 'auto' };

/**
 * The value the box's own style lowers in place of an anchor function or anchor-center: an inset or size holding one is auto there
 * (the anchored layout reads the function from its options), and anchor-center is normal self-alignment.
 */
export function anchorNeutralValue(p: Longhand, v: CssValue, abspos: boolean): CssValue {
  if ((INSETS as readonly string[]).includes(p) && (isFunction(v, 'anchor') || isFunction(v, 'anchor-size'))) return AUTO;
  if ((SIZES as readonly string[]).includes(p) && isFunction(v, 'anchor-size')) return p.startsWith('max-') ? { kind: 'keyword', value: 'none' } : AUTO;
  // Off an absolutely positioned box, anchor-center behaves as center (§4.2), which the box's own lowering reads.
  if (abspos && (p === 'align-self' || p === 'justify-self') && v.kind === 'keyword' && v.value === 'anchor-center') return AUTO;
  return v;
}

/** A box of the lowered tree with its place: the boxes are visited in tree order. */
/** A box of the tree, anchored or anchor: a block, flex or grid box, a form control or a replaced element. */
type BoxLike = LayoutBox | ControlBox | ReplacedLeaf;
type Node = { readonly box: BoxLike; readonly parent: Node | null; readonly order: number };

const isAbspos = (s: LayoutStyle): boolean => s.position === 'absolute' || s.position === 'fixed';

/** CSS2 §10.1 item 4, css-contain-2 §3.2, §3.4: the engine's containsAbsolute (box.ts), which the core may import as a type only. */
export const containsAbsolute = (s: LayoutStyle): boolean => s.position !== 'static' || s.containLayout || s.containPaint;

/** The box generating a box's containing block, or null for the initial containing block (CSS2 §10.1). */
function containingBlockOf(n: Node): Node | null {
  if (n.box.style.position === 'fixed') return null;
  let at = n.parent;
  if (n.box.style.position === 'absolute') while (at !== null && !containsAbsolute(at.box.style)) at = at.parent;
  return at;
}

const clipsOverflow = (s: LayoutStyle): boolean => s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.containPaint;

const isAncestor = (a: Node, of: Node): boolean => {
  for (let at = of.parent; at !== null; at = at.parent) if (at === a) return true;
  return false;
};
const isInclusiveAncestor = (a: Node, of: Node): boolean => a === of || isAncestor(a, of);

/** The lowered tree with style.anchor written on every anchored box. facts holds each element the tree pass reads (usesAnchors). */
export function lowerAnchors(root: LayoutBox, facts: ReadonlyMap<string, AnchorFacts>): LayoutBox {
  if (facts.size === 0) return root;
  const nodes: Node[] = [];
  const byId = new Map<string, Node>();
  const walk = (box: BoxLike, parent: Node | null): void => {
    const n: Node = { box, parent, order: nodes.length };
    nodes.push(n);
    byId.set(box.id, n);
    if (box.kind !== 'replaced') for (const c of box.children) if (c.kind === 'box' || c.kind === 'control' || c.kind === 'replaced') walk(c, n);
  };
  walk(root, null);
  const scopeOf = (n: Node, name: string): Node | null => {
    for (let at: Node | null = n; at !== null; at = at.parent) {
      const s = facts.get(at.box.id)?.scope ?? null;
      if (s === 'all' || (s !== null && s.includes(name))) return at;
    }
    return null;
  };
  const acceptable = (a: Node, q: Node): boolean => {
    if (a === q) return false;
    const ca = containingBlockOf(a);
    const cq = containingBlockOf(q);
    if (ca === cq) return !isAbspos(a.box.style) || a.order < q.order;
    return ca !== null && acceptable(ca, q);
  };
  /**
   * §2.3 target anchor element for a <dashed-ident>: Chrome 145 takes the last that qualifies in tree order, an ancestor or not
   * (WPT anchor-name-001, which Chrome passes), where the spec text prefers the nearest qualifying ancestor.
   */
  const target = (q: Node, name: string): Node | null => {
    // An element that names an anchor but is no box of the tree (an inline box) would be an anchor in Chrome.
    for (const [id, g] of facts) if (g.names.includes(name) && !byId.has(id)) throw new AnchorLoweringError(q.box.id, 'position-anchor', `${id}, which names the anchor ${name} that ${q.box.id} looks up, is an inline box, whose fragments' bounding rectangle Dragon does not lay out yet`);
    const queryScope = scopeOf(q, name);
    const ok = nodes.filter((a) => {
      if (!(facts.get(a.box.id)?.names.includes(name) ?? false)) return false;
      const scope = scopeOf(a, name);
      if (scope !== null && !isAncestor(scope, q)) return false;
      if (queryScope !== null && !isInclusiveAncestor(queryScope, a)) return false;
      return acceptable(a, q);
    });
    return ok.length === 0 ? null : (ok[ok.length - 1] as Node);
  };
  const styles = new Map<string, AnchorStyle>();
  for (const n of nodes) {
    const f = facts.get(n.box.id);
    if (f === undefined) continue;
    const s = n.box.style;
    const centered = isAbspos(s) && (f.justifySelf === 'anchor-center' || f.alignSelf === 'anchor-center');
    const anchoring = f.positionAnchor !== null || f.area !== null || f.fallbacks.length > 0 || centered
      || INSETS.some((p) => isFunction(f.insets[p], 'anchor') || isFunction(f.insets[p], 'anchor-size')) || SIZES.some((p) => isFunction(f.sizes[p], 'anchor-size'));
    if (!anchoring) continue;
    if (!isAbspos(s)) {
      const fn = INSETS.find((p) => isFunction(f.insets[p], 'anchor') || isFunction(f.insets[p], 'anchor-size')) ?? SIZES.find((p) => isFunction(f.sizes[p], 'anchor-size'));
      if (fn !== undefined) throw new AnchorLoweringError(f.id, fn, `${fn} on ${f.id}: an anchor function on a box that is not absolutely positioned takes its fallback (css-anchor-position-1 §3.2.1), which Dragon does not lower yet`);
      continue;
    }
    const cb = containingBlockOf(n);
    const rtl = (cb === null ? root.style.direction : cb.box.style.direction) === 'rtl';
    if (s.direction !== (rtl ? 'rtl' : 'ltr')) throw new AnchorLoweringError(f.id, 'direction', `the anchored ${f.id} has direction ${s.direction} in a ${rtl ? 'rtl' : 'ltr'} containing block, which Dragon does not lay out yet (Blink resolves its insets in its own writing direction)`);
    if (f.positionAnchor === 'auto') throw new AnchorLoweringError(f.id, 'position-anchor', `position-anchor: auto on ${f.id} uses an implicit anchor element (css-anchor-position-1 §2.4.1), which Dragon does not model yet`);
    const named = (name: string): string | null => {
      const t = target(n, name);
      if (t === null) return null;
      if (t.box.kind !== 'replaced' && t.box.style.display === 'inline') throw new AnchorLoweringError(f.id, 'anchor-name', `the anchor ${t.box.id} of ${f.id} is an inline box, whose fragments' bounding rectangle Dragon does not lay out yet`);
      return t.box.id;
    };
    const def = f.positionAnchor === null ? null : named(f.positionAnchor);
    if (def !== null) hiddenByAnchor(f.id, byId.get(def) as Node, cb, facts);
    const base = baseOption(f, s, def, named, rtl);
    const options: AnchorOption[] = [base];
    for (const entry of f.fallbacks) {
      if (entry.some((t) => t.startsWith('--'))) throw new AnchorLoweringError(f.id, 'position-try-fallbacks', `position-try-fallbacks: ${entry.join(' ')} on ${f.id} names an @position-try rule, which Dragon does not compile yet (css-anchor-position-1 §6.4)`);
      if (entry.every((t) => t.startsWith('flip-'))) options.push(entry.reduce((o, t) => flip(o, t, rtl), base));
      else options.push({ ...base, area: physicalArea(entry, rtl, f.id) });
    }
    const order = f.order === 'most-width' || f.order === 'most-inline-size' ? 'most-width' : f.order === 'most-height' || f.order === 'most-block-size' ? 'most-height' : 'normal';
    styles.set(f.id, { anchor: def, options, order });
  }
  if (styles.size === 0) return root;
  const rewrite = <B extends LayoutBox | ControlBox>(box: B): B => {
    const a = styles.get(box.id);
    const children = box.children.map((c) => (c.kind === 'box' || c.kind === 'control' ? rewrite(c) : c.kind === 'replaced' && styles.has(c.id) ? { ...c, style: { ...c.style, anchor: styles.get(c.id) as AnchorStyle } } : c));
    return { ...box, style: a === undefined ? box.style : { ...box.style, anchor: a }, children };
  };
  return rewrite(root);
}

/**
 * css-anchor-position-1 position-visibility: anchors-visible (the initial value) hides an anchored box whose default anchor is
 * invisible or clipped by a box between it and the anchored box's containing block, which needs the laid-out geometry, so either
 * is refused. Chrome 145 counts overflow other than visible on either axis and paint containment as clipping, not the containing
 * block's own clip or the viewport's.
 */
function hiddenByAnchor(id: string, anchor: Node, cb: Node | null, facts: ReadonlyMap<string, AnchorFacts>): void {
  const why = 'Chrome hides an anchored box whose default anchor is invisible or clipped out of view (position-visibility: anchors-visible, css-anchor-position-1), which Dragon does not model yet';
  if (facts.get(anchor.box.id)?.visible === false) throw new AnchorLoweringError(id, 'position-anchor', `the default anchor ${anchor.box.id} of ${id} is not visible: ${why}`);
  for (let at = anchor.parent; at !== null && at !== cb; at = at.parent)
    if (clipsOverflow(at.box.style)) throw new AnchorLoweringError(id, 'position-anchor', `the default anchor ${anchor.box.id} of ${id} is inside ${at.box.id}, which clips its overflow inside ${id}'s containing block: ${why}`);
}

/** The args of a function value, split at top-level commas. */
function functionArgs(v: CssValue): CssNode[][] {
  const text = v.kind === 'other' ? v.text : valueToString(v);
  const fn = list(parse(text, { context: 'value' }), 'children')[0];
  if (fn === undefined || fn.type !== 'Function') return [];
  const parts: CssNode[][] = [[]];
  for (const c of list(fn, 'children')) {
    if (c.type === 'Operator' && c['value'] === ',') parts.push([]);
    else if (c.type !== 'WhiteSpace') (parts[parts.length - 1] as CssNode[]).push(c);
  }
  return parts;
}

/** An anchor function's fallback: a px length, a percentage or 0, else refused. */
function fallbackOf(id: string, p: string, nodes: readonly CssNode[] | undefined): InsetValue | null {
  if (nodes === undefined) return null;
  const n = nodes[0];
  if (nodes.length === 1 && n !== undefined) {
    if (n.type === 'Dimension' && asciiLower(String(n['unit'])) === 'px') return { kind: 'px', value: Number(n['value']) };
    if (n.type === 'Percentage') return { kind: 'percent', value: Number(n['value']) };
    if (n.type === 'Number' && Number(n['value']) === 0) return { kind: 'px', value: 0 };
  }
  throw new AnchorLoweringError(id, p, `${p} on ${id}: an anchor function's fallback ${nodes.map((x) => generate(x)).join(' ')} is not px, % or 0, which Dragon does not lower yet`);
}

/** §3.2: an anchor() in an inset, as the anchor's id and a physical fraction along it; null when it is not resolvable (§3.2.1). */
function anchorEdge(id: string, p: Inset, v: CssValue, def: string | null, named: (name: string) => string | null, rtl: boolean): { readonly edge: AnchorEdge | null; readonly fallback: InsetValue | null } {
  const [spec, fb] = functionArgs(v);
  const fallback = fallbackOf(id, p, fb);
  const nameNode = (spec ?? []).find((t) => t.type === 'Identifier' && String(t['name']).startsWith('--'));
  const side = (spec ?? []).find((t) => t !== nameNode);
  const anchor = nameNode === undefined ? def : named(generate(nameNode));
  const vertical = p === 'top' || p === 'bottom';
  const end = p === 'bottom' || p === 'right';
  let fraction: number | null = null;
  if (side !== undefined && side.type === 'Percentage') {
    const pct = Number(side['value']) / 100;
    fraction = !vertical && rtl ? 1 - pct : pct;
  } else if (side !== undefined && side.type === 'Identifier') {
    const k = asciiLower(String(side['name']));
    const startFraction = !vertical && rtl ? 1 : 0;
    if (k === 'center') fraction = 0.5;
    else if (k === 'inside') fraction = end ? 1 : 0;
    else if (k === 'outside') fraction = end ? 0 : 1;
    else if (k === 'start' || k === 'self-start') fraction = startFraction;
    else if (k === 'end' || k === 'self-end') fraction = 1 - startFraction;
    else if (vertical && (k === 'top' || k === 'bottom')) fraction = k === 'top' ? 0 : 1;
    else if (!vertical && (k === 'left' || k === 'right')) fraction = k === 'left' ? 0 : 1;
  }
  if (anchor === null || fraction === null) return { edge: null, fallback };
  return { edge: { anchor, fraction }, fallback };
}

/** §5.1: an anchor-size() in a size, as the anchor's id and its physical axis; null when it is not resolvable (§5.1.1). */
function anchorSize(id: string, p: Size, v: CssValue, def: string | null, named: (name: string) => string | null): { readonly ref: AnchorSizeRef | null; readonly fallback: InsetValue | null } {
  const [spec, fb] = functionArgs(v);
  const fallback = fallbackOf(id, p, fb);
  const nameNode = (spec ?? []).find((t) => t.type === 'Identifier' && String(t['name']).startsWith('--'));
  const sizeNode = (spec ?? []).find((t) => t !== nameNode);
  const anchor = nameNode === undefined ? def : named(generate(nameNode));
  const k = sizeNode === undefined ? (p.endsWith('width') ? 'width' : 'height') : asciiLower(String(sizeNode['name']));
  const axis = k === 'width' || k === 'inline' || k === 'self-inline' ? 'width' : 'height';
  return { ref: anchor === null ? null : { anchor, axis }, fallback };
}

/** The base style's position option: the box's lowered lengths, with each anchor function as data (§6.1 fallback base styles). */
function baseOption(f: AnchorFacts, s: LayoutStyle, def: string | null, named: (name: string) => string | null, rtl: boolean): AnchorOption {
  const inset = (p: Inset): { readonly value: InsetValue; readonly edge: AnchorEdge | null } => {
    const v = f.insets[p];
    if (isFunction(v, 'anchor-size')) throw new AnchorLoweringError(f.id, p, `${p}: ${valueToString(v)} on ${f.id}: anchor-size() in an inset is not lowered yet (css-anchor-position-1 §5.1)`);
    if (!isFunction(v, 'anchor')) return { value: s[p], edge: null };
    const r = anchorEdge(f.id, p, v, def, named, rtl);
    return { value: r.edge === null && r.fallback !== null ? r.fallback : { kind: 'auto' }, edge: r.edge };
  };
  const size = (p: Size): { readonly ref: AnchorSizeRef | null; readonly fallback: InsetValue | null } => (isFunction(f.sizes[p], 'anchor-size') ? anchorSize(f.id, p, f.sizes[p], def, named) : { ref: null, fallback: null });
  const sizeRefused = (p: Size, r: { readonly ref: AnchorSizeRef | null; readonly fallback: InsetValue | null }): void => {
    if (r.ref === null && r.fallback !== null) throw new AnchorLoweringError(f.id, p, `${p} on ${f.id}: an unresolvable anchor-size() takes its fallback, which Dragon does not lower yet`);
  };
  const [top, right, bottom, left] = INSETS.map(inset) as [ReturnType<typeof inset>, ReturnType<typeof inset>, ReturnType<typeof inset>, ReturnType<typeof inset>];
  const [w, h, minW, minH, maxW, maxH] = SIZES.map(size) as ReturnType<typeof size>[];
  for (const [p, r] of [['width', w], ['height', h], ['min-width', minW], ['min-height', minH], ['max-width', maxW], ['max-height', maxH]] as const) sizeRefused(p, r as ReturnType<typeof size>);
  const selfAlign = (k: string, p: 'justify-self' | 'align-self'): 'normal' | 'anchor-center' => {
    if (k === 'anchor-center') return 'anchor-center';
    if (k === 'auto' || k === 'normal') return 'normal';
    throw new AnchorLoweringError(f.id, p, `${p}: ${k} on the anchored ${f.id}: Dragon lowers normal and anchor-center self-alignment on an anchored box`);
  };
  return {
    area: f.area === null ? null : physicalArea(f.area, rtl, f.id),
    top: top.value,
    right: right.value,
    bottom: bottom.value,
    left: left.value,
    topAnchor: top.edge,
    rightAnchor: right.edge,
    bottomAnchor: bottom.edge,
    leftAnchor: left.edge,
    marginTop: s.marginTop,
    marginRight: s.marginRight,
    marginBottom: s.marginBottom,
    marginLeft: s.marginLeft,
    width: s.width,
    height: s.height,
    minWidth: s.minWidth,
    minHeight: s.minHeight,
    maxWidth: s.maxWidth,
    maxHeight: s.maxHeight,
    widthAnchor: (w as ReturnType<typeof size>).ref,
    heightAnchor: (h as ReturnType<typeof size>).ref,
    minWidthAnchor: (minW as ReturnType<typeof size>).ref,
    minHeightAnchor: (minH as ReturnType<typeof size>).ref,
    maxWidthAnchor: (maxW as ReturnType<typeof size>).ref,
    maxHeightAnchor: (maxH as ReturnType<typeof size>).ref,
    justifySelf: selfAlign(f.justifySelf, 'justify-self'),
    alignSelf: selfAlign(f.alignSelf, 'align-self'),
  };
}

/** One <position-area> keyword: the axis it names (null when it is ambiguous) and the logical tracks it selects. */
type AreaKeyword = { readonly axis: 'x' | 'y' | null; readonly self: boolean; readonly first: 'start' | 'center' | 'end'; readonly last: 'start' | 'center' | 'end' };

function areaKeyword(k: string): AreaKeyword {
  if (k === 'center') return { axis: null, self: false, first: 'center', last: 'center' };
  if (k === 'span-all') return { axis: null, self: false, first: 'start', last: 'end' };
  const span = k.startsWith('span-');
  const body = span ? k.slice(5) : k;
  const physical: { readonly [k: string]: readonly ['x' | 'y', 'start' | 'end'] } = { top: ['y', 'start'], bottom: ['y', 'end'], left: ['x', 'start'], right: ['x', 'end'] };
  let axis: 'x' | 'y' | null = null;
  let side: 'start' | 'end';
  let self = false;
  const ph = physical[body];
  if (ph !== undefined) {
    axis = ph[0];
    side = ph[1];
  } else {
    const parts = body.split('-');
    side = parts[parts.length - 1] === 'end' ? 'end' : 'start';
    self = parts[0] === 'self';
    const named = self ? parts[1] : parts[0];
    axis = named === 'x' || named === 'inline' ? 'x' : named === 'y' || named === 'block' ? 'y' : null;
  }
  // A logical start or end in the inline axis follows the direction; flip-free here, resolved in physicalArea.
  return span ? (side === 'start' ? { axis, self, first: 'start', last: 'center' } : { axis, self, first: 'center', last: 'end' }) : { axis, self, first: side, last: side };
}

/** The tracks of one axis in physical order (top to bottom, left to right): an x-axis logical span in rtl runs right to left. */
function physicalTracks(k: AreaKeyword, axis: 'x' | 'y', physicalKeyword: boolean, rtl: boolean): readonly [AreaTrack, AreaTrack] {
  const mirror = (t: AreaTrack): AreaTrack => (t === 'start' ? 'end' : t === 'end' ? 'start' : 'center');
  if (axis === 'x' && rtl && !physicalKeyword) return [mirror(k.last), mirror(k.first)];
  return [k.first, k.last];
}

/** §3.1.2 with position_area.cc ToPhysical: a <position-area> in the containing block's direction (horizontal-tb). */
export function physicalArea(keywords: readonly string[], rtl: boolean, id: string): PositionArea {
  const isPhysical = (k: string): boolean => ['top', 'bottom', 'left', 'right', 'span-top', 'span-bottom', 'span-left', 'span-right'].includes(k);
  const ks = keywords.map(areaKeyword);
  let x: { k: AreaKeyword; physical: boolean } | null = null;
  let y: { k: AreaKeyword; physical: boolean } | null = null;
  const at = (i: number): { k: AreaKeyword; physical: boolean } => ({ k: ks[i] as AreaKeyword, physical: isPhysical(keywords[i] as string) });
  if (ks.length === 1) {
    const k = ks[0] as AreaKeyword;
    const all: AreaKeyword = { axis: null, self: false, first: 'start', last: 'end' };
    if (k.axis === 'x') { x = at(0); y = { k: all, physical: true }; }
    else if (k.axis === 'y') { y = at(0); x = { k: all, physical: true }; }
    else { y = at(0); x = at(0); }
  } else {
    const [a, b] = ks as [AreaKeyword, AreaKeyword];
    if (a.axis === 'x' || b.axis === 'y') { x = at(0); y = at(1); }
    else if (a.axis === 'y' || b.axis === 'x') { y = at(0); x = at(1); }
    else { y = at(0); x = at(1); }
  }
  if (x === null || y === null) throw new AnchorLoweringError(id, 'position-area', `position-area: ${keywords.join(' ')} on ${id} names one axis twice`);
  const [rowStart, rowEnd] = physicalTracks(y.k, 'y', y.physical, rtl);
  const [columnStart, columnEnd] = physicalTracks(x.k, 'x', x.physical, rtl);
  return { rowStart, rowEnd, columnStart, columnEnd };
}

/** §6.1 <try-tactic> on an option, physical: flip-block is flip-y and flip-inline flip-x in horizontal-tb; flip-start swaps the axes at the start corner. */
function flip(o: AnchorOption, tactic: string, rtl: boolean): AnchorOption {
  const mirror = (t: AreaTrack): AreaTrack => (t === 'start' ? 'end' : t === 'end' ? 'start' : 'center');
  const flipEdge = (e: AnchorEdge | null): AnchorEdge | null => (e === null ? null : { anchor: e.anchor, fraction: 1 - e.fraction });
  if (tactic === 'flip-block' || tactic === 'flip-y') {
    return {
      ...o,
      area: o.area === null ? null : { ...o.area, rowStart: mirror(o.area.rowEnd), rowEnd: mirror(o.area.rowStart) },
      top: o.bottom,
      bottom: o.top,
      topAnchor: flipEdge(o.bottomAnchor),
      bottomAnchor: flipEdge(o.topAnchor),
      marginTop: o.marginBottom,
      marginBottom: o.marginTop,
    };
  }
  if (tactic === 'flip-inline' || tactic === 'flip-x') {
    return {
      ...o,
      area: o.area === null ? null : { ...o.area, columnStart: mirror(o.area.columnEnd), columnEnd: mirror(o.area.columnStart) },
      left: o.right,
      right: o.left,
      leftAnchor: flipEdge(o.rightAnchor),
      rightAnchor: flipEdge(o.leftAnchor),
      marginLeft: o.marginRight,
      marginRight: o.marginLeft,
    };
  }
  // flip-start: block-start with inline-start and block-end with inline-end (top-left corner in ltr, top-right in rtl).
  const axisSwap = (e: AnchorEdge | null): AnchorEdge | null => (e === null || !rtl ? e : { anchor: e.anchor, fraction: 1 - e.fraction });
  const sizeSwap = (r: AnchorSizeRef | null): AnchorSizeRef | null => (r === null ? null : { anchor: r.anchor, axis: r.axis === 'width' ? 'height' : 'width' });
  const area = o.area === null ? null : rtl
    ? { rowStart: mirror(o.area.columnEnd), rowEnd: mirror(o.area.columnStart), columnStart: mirror(o.area.rowEnd), columnEnd: mirror(o.area.rowStart) }
    : { rowStart: o.area.columnStart, rowEnd: o.area.columnEnd, columnStart: o.area.rowStart, columnEnd: o.area.rowEnd };
  const start = rtl ? { inset: o.right, edge: o.rightAnchor, margin: o.marginRight } : { inset: o.left, edge: o.leftAnchor, margin: o.marginLeft };
  const end = rtl ? { inset: o.left, edge: o.leftAnchor, margin: o.marginLeft } : { inset: o.right, edge: o.rightAnchor, margin: o.marginRight };
  const inlineStart = { inset: o.top, edge: axisSwap(o.topAnchor), margin: o.marginTop };
  const inlineEnd = { inset: o.bottom, edge: axisSwap(o.bottomAnchor), margin: o.marginBottom };
  const blockStart = { inset: start.inset, edge: axisSwap(start.edge), margin: start.margin };
  const blockEnd = { inset: end.inset, edge: axisSwap(end.edge), margin: end.margin };
  const left = rtl ? inlineEnd : inlineStart;
  const right = rtl ? inlineStart : inlineEnd;
  if (o.width.kind !== 'auto' && o.width.kind !== 'px' && o.width.kind !== 'percent' && o.width.kind !== 'calc') throw new AnchorLoweringError('', 'width', `flip-start swaps width ${o.width.kind} into height, which takes no intrinsic size keyword`);
  if (o.minWidth.kind !== 'auto' && o.minWidth.kind !== 'px' && o.minWidth.kind !== 'percent' && o.minWidth.kind !== 'calc') throw new AnchorLoweringError('', 'min-width', `flip-start swaps min-width ${o.minWidth.kind} into min-height`);
  if (o.maxWidth.kind !== 'none' && o.maxWidth.kind !== 'px' && o.maxWidth.kind !== 'percent' && o.maxWidth.kind !== 'calc') throw new AnchorLoweringError('', 'max-width', `flip-start swaps max-width ${o.maxWidth.kind} into max-height`);
  if (o.height.kind === 'stretch' || o.minHeight.kind === 'stretch' || o.maxHeight.kind === 'stretch') throw new AnchorLoweringError('', 'height', 'flip-start swaps a stretch height into the width');
  return {
    ...o,
    area,
    top: blockStart.inset,
    bottom: blockEnd.inset,
    left: left.inset,
    right: right.inset,
    topAnchor: blockStart.edge,
    bottomAnchor: blockEnd.edge,
    leftAnchor: left.edge,
    rightAnchor: right.edge,
    marginTop: blockStart.margin,
    marginBottom: blockEnd.margin,
    marginLeft: left.margin,
    marginRight: right.margin,
    width: o.height,
    height: o.width,
    minWidth: o.minHeight,
    minHeight: o.minWidth,
    maxWidth: o.maxHeight,
    maxHeight: o.maxWidth,
    widthAnchor: sizeSwap(o.heightAnchor),
    heightAnchor: sizeSwap(o.widthAnchor),
    minWidthAnchor: sizeSwap(o.minHeightAnchor),
    minHeightAnchor: sizeSwap(o.minWidthAnchor),
    maxWidthAnchor: sizeSwap(o.maxHeightAnchor),
    maxHeightAnchor: sizeSwap(o.maxWidthAnchor),
    justifySelf: o.alignSelf,
    alignSelf: o.justifySelf,
  };
}
