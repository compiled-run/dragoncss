// CQ: @container rules. Dragon resolves a query container's content-box width as a function of the viewport width, which holds
// for an inline-size container reached from the viewport through block boxes with px widths, margins and padding and no left or
// right border (Chrome rounds a border width to device pixels, so it would depend on the screen): clamp(vw - shift, lo, hi). A size query on that width is then a viewport-width condition, so @container rules ride the @media
// band machinery: each width a query compares with adds a viewport atom (project.ts), every band holds one truth value per query
// container, and each element's @container rules are decided per band by its own query container (css-conditional-5 §3.2: the
// nearest ancestor container, of the asked name if any; with none, the query is unknown and the rule does not apply).
//
// A band is resolved twice: without @container rules, to find each container and its width (no @container rule can change them,
// which the second pass checks), then with them.
import type { ContainerCondition, Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Band, Interval, MediaLength, MediaQueryList } from '../media/index.ts';
import { comparisonsOf, contains, evaluateMediaQueryList, featuresOfList, MEDIA_EPSILON, parseMediaQueryList, resolveLength } from '../media/index.ts';
import type { ResolveEnvironment, ResolvedValue } from './computed.ts';
import { pxOf } from './computed.ts';
import type { ScrollContainmentFaults } from '../faults/scroll-containment.ts';
import { SCROLL_CONTAINMENT_FAULTS } from '../faults/scroll-containment.ts';
import type { InteractionState } from './match.ts';
import type { LinkedElement } from './link.ts';
import type { ResolvedElement } from './resolve.ts';
import { resolveTree, valueToString } from './resolve.ts';

/** A query container's content-box width at viewport width vw: clamp(vw - shift, lo, hi); a constant when lo = hi. */
export type ContainerWidth = { readonly shift: number; readonly lo: number; readonly hi: number };

export const widthAt = (w: ContainerWidth, vw: number): number => Math.min(Math.max(vw - w.shift, w.lo), w.hi);

/** A query container of a resolved tree: its names, and its width or why Dragon cannot read it. */
export type QueryContainer = { readonly names: readonly string[]; readonly width: ContainerWidth | string };

/** Why a band cannot decide a @container rule, keyed by the rule's condition and the reason. */
export type ContainerRefusals = Map<string, { readonly condition: ContainerCondition; readonly reason: string }>;

/** The band a pass decides @container rules in: a viewport width inside it, and its width intervals. */
export type ContainerBand = { readonly rep: number; readonly intervals: readonly Interval[]; readonly refusals: ContainerRefusals };

const WHOLE_LINE: Interval = { lo: 0, loInclusive: true, hi: Infinity, hiInclusive: false, nominalLo: 0, nominalHi: Infinity };

/** The pass of a band (null: the sheet has no band); a viewport width inside its first interval stands for all of it. */
export function containerBand(b: Band | null, refusals: ContainerRefusals): ContainerBand {
  const intervals = b === null ? [WHOLE_LINE] : b.width;
  const i = intervals[0] as Interval;
  const rep = i.lo === i.hi ? i.lo : i.hi === Infinity ? i.lo + 1 : (i.lo + i.hi) / 2;
  return { rep, intervals, refusals };
}

/** Every distinct @container condition of the sheet, in source order. */
export function containerConditionsOf(rules: readonly Rule[]): ContainerCondition[] {
  const out: ContainerCondition[] = [];
  for (const r of rules) for (const c of r.container ?? []) if (!out.includes(c)) out.push(c);
  return out;
}

const keyword = (el: ResolvedElement, p: Parameters<ResolvedElement['props']['get']>[0]): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : valueToString(v);
};

/** A query container Dragon resolves: container-type: inline-size (analysis/scroll-containment.ts refuses the other types). */
export function isQueryContainer(el: ResolvedElement): boolean {
  return keyword(el, 'container-type') === 'inline-size';
}

function namesOf(el: ResolvedElement): string[] {
  const v = (el.props.get('container-name') as ResolvedValue).value;
  return v.kind === 'other' ? v.text.split(' ') : [];
}

const FLOW_DISPLAYS: ReadonlySet<string> = new Set(['block', 'flow-root', 'list-item']);
const FLOW_POSITIONS: ReadonlySet<string> = new Set(['static', 'relative']);
const UNSCROLLED: ReadonlySet<string> = new Set(['visible', 'hidden', 'clip']);

/**
 * The content-box width of the last box of chain (the root first) as a function of the viewport width, or why Dragon cannot read
 * it. css-sizing-3 and CSS 2 §10.3.3: a block-level box in flow with width: auto fills its containing block less its margins,
 * borders and padding; max-width then min-width clamp it, and it is never negative. A px width is a constant. A left or right
 * border is refused: Chrome rounds its width down to device pixels.
 */
export function containerWidth(chain: readonly ResolvedElement[], faults: ScrollContainmentFaults = SCROLL_CONTAINMENT_FAULTS): ContainerWidth | string {
  // The initial containing block is the viewport.
  let w: ContainerWidth = { shift: 0, lo: 0, hi: Infinity };
  for (const el of chain) {
    const tag = `<${el.element.tag}>`;
    const display = keyword(el, 'display');
    if (!FLOW_DISPLAYS.has(display)) return `${tag} has display: ${display}`;
    const position = keyword(el, 'position');
    if (!FLOW_POSITIONS.has(position)) return `${tag} has position: ${position}`;
    if (keyword(el, 'float') !== 'none') return `${tag} floats`;
    const overflow = keyword(el, 'overflow-x');
    if (!UNSCROLLED.has(overflow)) return `${tag} has overflow-x: ${overflow}, whose scrollbar Dragon does not model`;
    const px = (p: Parameters<ResolvedElement['props']['get']>[0], auto: string | null): number | string => {
      const v = (el.props.get(p) as ResolvedValue).value;
      if (auto !== null && v.kind === 'keyword' && v.value === auto) return 0;
      return pxOf(v) ?? `${tag} has ${p}: ${valueToString(v)}`;
    };
    // Chrome rounds a border width down to whole device pixels, so a container's width would depend on the pixel density.
    const border = (side: 'left' | 'right'): number | string => {
      if (['none', 'hidden'].includes(keyword(el, `border-${side}-style`))) return 0;
      const b = px(`border-${side}-width`, null);
      return b === 0 || typeof b === 'string' ? b : `${tag} has a ${side} border, which Chrome rounds to device pixels`;
    };
    const parts = [px('margin-left', 'auto'), px('margin-right', 'auto'), border('left'), border('right'), px('padding-left', null), px('padding-right', null)];
    const bad = parts.find((p) => typeof p === 'string');
    if (bad !== undefined) return bad as string;
    const [ml, mr, , , pl, pr] = parts as number[];
    const bp = (pl as number) + (pr as number);
    // box-sizing: border-box sizes the border box; the content box is what is left of it.
    const content = keyword(el, 'box-sizing') === 'border-box' ? bp : 0;
    const width = (el.props.get('width') as ResolvedValue).value;
    const maxV = (el.props.get('max-width') as ResolvedValue).value;
    const minV = (el.props.get('min-width') as ResolvedValue).value;
    const max = maxV.kind === 'keyword' && maxV.value === 'none' ? Infinity : pxOf(maxV);
    const min = minV.kind === 'keyword' && minV.value === 'auto' ? 0 : pxOf(minV);
    if (max === null) return `${tag} has max-width: ${valueToString(maxV)}`;
    if (min === null) return `${tag} has min-width: ${valueToString(minV)}`;
    const a = Math.max(min - content, 0);
    const b = Math.max(max - content, a);
    if (width.kind === 'keyword' && width.value === 'auto') {
      const d = faults.containerShiftDropped ? 0 : (ml as number) + (mr as number) + bp;
      const clamp = (x: number): number => Math.min(Math.max(x, a), b);
      w = { shift: w.shift + d, lo: clamp(w.lo - d), hi: clamp(w.hi - d) };
      continue;
    }
    const fixed = pxOf(width);
    if (fixed === null) return `${tag} has width: ${valueToString(width)}`;
    const c = Math.min(Math.max(fixed - content, a), b);
    w = { shift: 0, lo: c, hi: c };
  }
  return w;
}

/** The query containers of a resolved tree, by element. */
export function containersOf(root: ResolvedElement, faults: ScrollContainmentFaults = SCROLL_CONTAINMENT_FAULTS): Map<LinkedElement, QueryContainer> {
  const out = new Map<LinkedElement, QueryContainer>();
  const visit = (el: ResolvedElement, chain: ResolvedElement[]): void => {
    const here = [...chain, el];
    if (isQueryContainer(el)) out.set(el.element, { names: namesOf(el), width: containerWidth(here, faults) });
    for (const c of el.children) if (c.kind === 'element') visit(c, here);
  };
  visit(root, []);
  return out;
}

const matchesName = (c: QueryContainer, condition: ContainerCondition): boolean => condition.name === null || c.names.includes(condition.name);

/** The widths a condition compares the container's width with, in px. */
function queriedWidths(list: MediaQueryList): { readonly op: string; readonly at: number }[] {
  return featuresOfList(list).flatMap((f) => comparisonsOf(f).map(({ op, value }) => ({ op, at: resolveLength((value as { kind: 'length'; length: MediaLength }).length, 0) })));
}

/** The viewport widths at which a query on this container can change: each queried width the container's width reaches. */
function viewportThresholds(w: ContainerWidth, list: MediaQueryList): { readonly op: string; readonly vw: number }[] {
  if (w.lo === w.hi) return [];
  return queriedWidths(list).filter((q) => q.at >= w.lo && q.at <= w.hi).map((q) => ({ op: q.op, vw: q.at + w.shift }));
}

/**
 * The viewport atoms the @container rules add to the band partition: for each @media band's trees, each condition and each
 * container of its name whose width follows the viewport, each width it queries, moved by the container's shift, with the query's
 * comparison, where that viewport width lies in the @media band (elsewhere the container has another width).
 */
export function containerAtoms(groups: readonly { readonly band: Band | null; readonly trees: readonly ResolvedElement[] }[], conditions: readonly ContainerCondition[], faults: ScrollContainmentFaults = SCROLL_CONTAINMENT_FAULTS): MediaQueryList[] {
  const texts = new Set<string>();
  for (const g of groups) {
    const intervals = g.band === null ? [WHOLE_LINE] : g.band.width;
    for (const t of g.trees) {
      for (const c of containersOf(t, faults).values()) {
        if (typeof c.width === 'string') continue;
        for (const cond of conditions) {
          if (!matchesName(c, cond)) continue;
          for (const th of viewportThresholds(c.width, cond.list)) if (intervals.some((i) => i.lo <= th.vw && th.vw <= i.hi)) texts.add(`(width ${th.op} ${th.vw}px)`);
        }
      }
    }
  }
  return [...texts].map((t) => parseMediaQueryList(t));
}

/**
 * Whether a condition on this container holds alike across the band: at each end of its intervals and on both sides of each
 * viewport width where the query can change (the band partition holds no such width inside a band unless the container's width
 * differs from the one its atoms were made from).
 */
function uniformInBand(w: ContainerWidth, list: MediaQueryList, band: ContainerBand): boolean {
  const truth = (vw: number): boolean => {
    const r = evaluateMediaQueryList(list, { width: widthAt(w, vw), height: 0 });
    return r.kind === 'matches' && r.matches;
  };
  const near = viewportThresholds(w, list).flatMap((t) => [t.vw - MEDIA_EPSILON * 2, t.vw, t.vw + MEDIA_EPSILON * 2]);
  const at = truth(band.rep);
  return band.intervals.every((i) => {
    const ends = [i.lo, i.lo + MEDIA_EPSILON / 4, ...(i.hi === Infinity ? [i.lo + 1e6] : [i.hi - MEDIA_EPSILON / 4, i.hi])];
    return [...ends, ...near].filter((x) => contains(i, x)).every((x) => truth(x) === at);
  });
}

/**
 * Resolves a case in a band with its @container rules: once without them, to find the query containers, then with each rule
 * decided by the element's own container. A container whose width Dragon cannot read, or whose width can change inside the band,
 * refuses the rule; so does a @container rule that changes a container.
 */
export function resolveWithContainers(root: LinkedElement, rules: readonly Rule[], faults: CompilerFaults, env: ResolveEnvironment, band: ContainerBand, ix?: InteractionState): ResolvedElement {
  const base = resolveTree(root, rules, faults, env, ix);
  const found = containersOf(base, faults);
  const refuse = (condition: ContainerCondition, reason: string): false => {
    const key = `${condition.span.source.uri}|${condition.span.start}|${reason}`;
    if (!band.refusals.has(key)) band.refusals.set(key, { condition, reason });
    return false;
  };
  const holds = (condition: ContainerCondition, ancestors: readonly LinkedElement[], self: LinkedElement | null): boolean => {
    const candidates = faults.containerSelfQueried && self !== null ? [...ancestors, self] : ancestors;
    for (let k = candidates.length - 1; k >= 0; k--) {
      const c = found.get(candidates[k] as LinkedElement);
      if (c === undefined || !matchesName(c, condition)) continue;
      if (typeof c.width === 'string') return refuse(condition, `the width of its query container cannot be read: ${c.width}; Dragon reads a container's width only through block boxes in flow with px widths, margins and padding and no left or right border`);
      if (!uniformInBand(c.width, condition.list, band)) return refuse(condition, 'the width of its query container changes with an interaction state, which Dragon does not resolve');
      const r = evaluateMediaQueryList(condition.list, { width: widthAt(c.width, band.rep), height: 0 });
      return r.kind === 'matches' && r.matches;
    }
    // css-conditional-5 §3.2: with no query container the query is unknown, so the rule does not apply.
    return false;
  };
  const resolved = resolveTree(root, rules, faults, { ...env, container: (rule, ancestors, self) => (rule.container ?? []).every((c) => holds(c, ancestors, self)) }, ix);
  const after = containersOf(resolved, faults);
  const same = after.size === found.size && [...after].every(([el, c]) => JSON.stringify(found.get(el)) === JSON.stringify(c));
  if (!same) {
    const first = rules.find((r) => r.container !== undefined)?.container?.[0];
    if (first !== undefined) refuse(first, 'a @container rule changes the container-type, container-name or width of a query container, which Dragon does not resolve');
  }
  return resolved;
}
