// T065 ANIM-b1: the transitions and CSS animations of every reachable case. The transition and animation longhands cascade
// apart from the milestone LONGHANDS (they are not inherited, and no fixture captures them per element), each element's
// transition list expands to longhands (`all` and shorthands, R8), its animation list resolves against the @keyframes rules
// (the last rule of a name wins, M13), and every refusal of the spec's §1 table that needs the reachable states is decided here:
// ANIM-p (R13), ANIM-o (R12), ANIM-cc, ANIM-t (R11) and ANIM-v. The support gate keys every used value as a feature in the
// `animation` context: a feature with no passing frame-lane row is refused per target, as every unproven value is.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { KeyframesRule } from '../css/at-rules/keyframes.ts';
import type { AnimationKind } from '../css/animation-kinds.ts';
import { admitted, animationKind } from '../css/animation-kinds.ts';
import type { Longhand } from '../css/properties.ts';
import { isLonghand, isShorthand, LONGHANDS } from '../css/properties.ts';
import type { AnimItem, AnimLonghand, AnimList, EasingValue } from '../css/properties/animation.ts';
import { ANIM_INITIAL, ANIM_LONGHANDS } from '../css/properties/animation.ts';
import { shorthandHandler } from '../css/shorthands/index.ts';
import type { CssValue, Declaration, Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { SupportProfile } from '../profiles/types.ts';
import { provenContexts } from '../profiles/types.ts';
import type { Diagnostic, Span } from '../types.ts';
import { beats } from './cascade.ts';
import type { ResolvedValue } from './computed.ts';
import type { LinkedElement } from './link.ts';
import { selectorMatches, specificityFor } from './match.ts';
import type { ResolvedElement } from './resolve.ts';

/** The most transition slots, and closure writes per frame, a program holds (R8, R9): a larger one is refused, never cut. */
export const MAX_TRANSITION_SLOTS = 256;
export const MAX_CLOSURE_WRITES = 1024;

/** An endpoint as the runtime interpolates it: px and % (a calc() keeps both), a legacy colour, a keyword, or an unresolved value. */
export type AnimValue =
  | { readonly kind: 'length'; readonly px: number; readonly percent: number; readonly calc: boolean }
  | { readonly kind: 'color'; readonly r: number; readonly g: number; readonly b: number; readonly alpha: number }
  | { readonly kind: 'keyword'; readonly value: string }
  | { readonly kind: 'env'; readonly text: string };

export type Timing = { readonly delay: number; readonly duration: number; readonly easing: EasingValue };

/** How one element's after-change style lists a property (rt-transition.ts TransitionListing). */
export type Listing = { readonly mode: 'listed' | 'unlisted' | 'initial' } & Timing;

export type AnimationEntry = {
  readonly name: string;
  readonly hasKeyframes: boolean;
  readonly paused: boolean;
  readonly delay: number;
  readonly duration: number;
  readonly iterations: number;
  readonly direction: string;
  readonly fill: string;
  readonly easing: EasingValue;
};

/** One element in one case: its transition listings per longhand (absent: the mode for every other longhand) and animations. */
export type ElementAnimation = {
  readonly address: string;
  readonly declared: boolean;
  readonly otherwise: 'unlisted' | 'initial';
  readonly listings: ReadonlyMap<Longhand, Listing>;
  readonly animations: readonly AnimationEntry[];
  /** The declarations that set its animation longhands, for diagnostics. */
  readonly declarations: readonly Declaration[];
};

export type AnimationCase = { readonly key: string; readonly elements: ReadonlyMap<string, ElementAnimation> };

export type AnimationAnalysis = {
  readonly cases: readonly AnimationCase[];
  /** The @keyframes rules by name, the last rule of a name (M13). */
  readonly keyframes: ReadonlyMap<string, KeyframesRule>;
  /** Every feature with each span that uses it, for the support gate. */
  readonly features: readonly { readonly feature: string; readonly span: Span }[];
};

type Winner = { readonly list: AnimList; readonly declaration: Declaration; readonly specificity: readonly [number, number, number] };

/** The animation longhands' cascade for one element: importance, specificity and order, as for the milestone longhands. */
function cascadeAnimations(rules: readonly Rule[], chain: readonly LinkedElement[], faults: CompilerFaults): Map<AnimLonghand, Winner> {
  const out = new Map<AnimLonghand, Winner>();
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!selectorMatches(rule, sel, chain, chain.length - 1, 0, faults)) continue;
      const specificity = specificityFor(sel, faults);
      for (const d of rule.declarations) {
        if (d.animation === undefined) continue;
        for (const [p, list] of d.animation.longhands) {
          const prev = out.get(p);
          const cand = { list, declaration: d, specificity };
          if (prev === undefined || beats(cand, prev)) out.set(p, cand);
        }
      }
    }
  }
  return out;
}

/** The computed lists: a winner's items, inherit from the parent, every other CSS-wide keyword the initial item. */
function computedLists(winners: ReadonlyMap<AnimLonghand, Winner>, parent: ReadonlyMap<AnimLonghand, readonly AnimItem[]> | null): Map<AnimLonghand, readonly AnimItem[]> {
  const out = new Map<AnimLonghand, readonly AnimItem[]>();
  for (const p of ANIM_LONGHANDS) {
    const w = winners.get(p);
    if (w === undefined || w.list.kind === 'wide') {
      const inherit = w !== undefined && w.list.kind === 'wide' && w.list.keyword === 'inherit' && parent !== null;
      out.set(p, inherit ? (parent.get(p) as readonly AnimItem[]) : [ANIM_INITIAL[p]]);
    } else out.set(p, w.list.items);
  }
  return out;
}

/** CSSTimingData::GetRepeated. */
const repeated = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;
const seconds = (i: AnimItem): number => (i.kind === 'time' ? i.seconds : 0);
const easingOf = (i: AnimItem): EasingValue => (i.kind === 'easing' ? i.easing : (ANIM_INITIAL['transition-timing-function'] as { easing: EasingValue }).easing);
const keywordOf = (i: AnimItem): string => (i.kind === 'keyword' ? i.value : i.kind === 'name' ? i.value : '');

/** The longhands a transition-property name stands for (R8: shorthands expand, `all` is every Dragon longhand). */
function longhandsNamed(name: string): readonly Longhand[] | null {
  if (name === 'all') return LONGHANDS;
  if (isLonghand(name)) return [name];
  if (isShorthand(name)) return shorthandHandler(name).longhands;
  return null;
}

/** Chrome 145's property names that Dragon does not model; a transition naming one of them does nothing here either. */
export type KnownProperty = (name: string) => boolean;

function elementAnimation(address: string, lists: ReadonlyMap<AnimLonghand, readonly AnimItem[]>, winners: ReadonlyMap<AnimLonghand, Winner>, keyframes: ReadonlyMap<string, KeyframesRule>): ElementAnimation {
  const list = (p: AnimLonghand): readonly AnimItem[] => lists.get(p) as readonly AnimItem[];
  const declared = [...winners.keys()].some((p) => p.startsWith('transition-'));
  const listings = new Map<Longhand, Listing>();
  const properties = list('transition-property');
  properties.forEach((item, i) => {
    const named = item.kind === 'keyword' && item.value === 'none' ? [] : longhandsNamed(keywordOf(item));
    if (named === null) return;
    const timing: Listing = { mode: 'listed', delay: seconds(repeated(list('transition-delay'), i)), duration: seconds(repeated(list('transition-duration'), i)), easing: easingOf(repeated(list('transition-timing-function'), i)) };
    // css_animations.cc 2611-2612: of repeated entries for one property, the last wins.
    for (const p of named) listings.set(p, timing);
  });
  const names = list('animation-name');
  const animations: AnimationEntry[] = names.map((item, i) => {
    const name = keywordOf(item);
    const count = repeated(list('animation-iteration-count'), i);
    const duration = repeated(list('animation-duration'), i);
    return {
      name,
      hasKeyframes: item.kind === 'name' && keyframes.has(name),
      paused: keywordOf(repeated(list('animation-play-state'), i)) === 'paused',
      delay: seconds(repeated(list('animation-delay'), i)),
      // animation-duration: auto is 0s on the document timeline (the only one ANIM-b1 admits).
      duration: seconds(duration),
      iterations: count.kind === 'keyword' ? Infinity : count.kind === 'number' ? count.value : 1,
      direction: keywordOf(repeated(list('animation-direction'), i)),
      fill: keywordOf(repeated(list('animation-fill-mode'), i)),
      easing: easingOf(repeated(list('animation-timing-function'), i)),
    };
  });
  return { address, declared, otherwise: declared ? 'unlisted' : 'initial', listings, animations, declarations: [...new Set([...winners.values()].map((w) => w.declaration))] };
}

/** One case's element animations, walking the resolved tree with the linked chain the selectors match against. */
function caseAnimations(key: string, root: ResolvedElement, rules: readonly Rule[], keyframes: ReadonlyMap<string, KeyframesRule>, faults: CompilerFaults): AnimationCase {
  const elements = new Map<string, ElementAnimation>();
  const walk = (el: ResolvedElement, chain: readonly LinkedElement[], parent: ReadonlyMap<AnimLonghand, readonly AnimItem[]> | null): void => {
    const here = [...chain, el.element];
    const winners = cascadeAnimations(rules, here, faults);
    const lists = computedLists(winners, parent);
    elements.set(el.element.address, elementAnimation(el.element.address, lists, winners, keyframes));
    for (const c of el.children) if (c.kind === 'element') walk(c, here, lists);
  };
  walk(root, [], null);
  return { key, elements };
}

// ---------------------------------------------------------------------------------------------------------------------
// Endpoints.

/** A longhand's computed value as the runtime interpolates it (R14: a viewport-relative or calc() value resolves on device). */
export function animValueOf(v: CssValue): AnimValue {
  if (v.kind === 'length' && v.unit === 'px') return { kind: 'length', px: v.value, percent: 0, calc: false };
  if (v.kind === 'percentage') return { kind: 'length', px: 0, percent: v.value, calc: false };
  if (v.kind === 'color') return { kind: 'color', r: v.value.r, g: v.value.g, b: v.value.b, alpha: v.value.alpha / 255 };
  if (v.kind === 'keyword') return { kind: 'keyword', value: v.value };
  if (v.kind === 'length') return { kind: 'env', text: `${v.value}${v.unit}` };
  return { kind: 'env', text: v.kind === 'other' ? v.text : JSON.stringify(v) };
}

const sameValue = (a: AnimValue, b: AnimValue): boolean => JSON.stringify(a) === JSON.stringify(b);
const valueAt = (el: ResolvedElement, p: Longhand): ResolvedValue => el.props.get(p) as ResolvedValue;

/** A keyframe value on one element: lengths in em and rem take the element's and the root's font size. */
export function keyframeValueOf(v: CssValue, fontSize: number, rootFontSize: number): AnimValue {
  if (v.kind === 'length' && v.unit === 'em') return { kind: 'length', px: v.value * fontSize, percent: 0, calc: false };
  if (v.kind === 'length' && v.unit === 'rem') return { kind: 'length', px: v.value * rootFontSize, percent: 0, calc: false };
  if (v.kind === 'keyword' && v.value === 'transparent') return { kind: 'color', r: 0, g: 0, b: 0, alpha: 0 };
  return animValueOf(v);
}

const pxOf = (v: CssValue): number => (v.kind === 'length' && v.unit === 'px' ? v.value : 16);

// ---------------------------------------------------------------------------------------------------------------------
// The analysis.

export type AnimationInput = {
  readonly cases: readonly { readonly key: string; readonly resolved: ResolvedElement | null }[];
  readonly rules: readonly Rule[];
  readonly keyframes: readonly KeyframesRule[];
  readonly faults: CompilerFaults;
  readonly knownProperty: KnownProperty;
};

const KIND_LABEL = (k: AnimationKind): string => (k.kind === 'length' ? `length (${k.range})` : k.kind);

/** Walks a resolved tree by address. */
function byAddress(root: ResolvedElement): Map<string, ResolvedElement> {
  const out = new Map<string, ResolvedElement>();
  const walk = (el: ResolvedElement): void => {
    out.set(el.element.address, el);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out;
}

/** The analysis of every case, with its refusals and warnings appended to diagnostics. */
export function analyzeAnimations(input: AnimationInput, diagnostics: Diagnostic[]): AnimationAnalysis {
  const keyframes = new Map<string, KeyframesRule>();
  for (const r of input.keyframes) keyframes.set(r.name, r);
  const cases = input.cases.flatMap((c) => (c.resolved === null ? [] : [caseAnimations(c.key, c.resolved, input.rules, keyframes, input.faults)]));
  const trees = input.cases.flatMap((c) => (c.resolved === null ? [] : [byAddress(c.resolved)]));
  const reported = new Set<string>();
  const once = (id: string, d: Diagnostic): void => {
    if (reported.has(id)) return;
    reported.add(id);
    diagnostics.push(d);
  };
  const features: { feature: string; span: Span }[] = [];
  const featureKeys = new Set<string>();
  const feature = (key: string, span: Span): void => {
    const id = `${key}|${span.source.uri}|${span.start}|${span.end}`;
    if (featureKeys.has(id)) return;
    featureKeys.add(id);
    features.push({ feature: key, span });
  };
  const spanFor = (ea: ElementAnimation, p: AnimLonghand): Span => {
    const d = ea.declarations.find((x) => x.animation?.longhands.has(p) === true) ?? ea.declarations[0];
    return (d as Declaration).valueSpan;
  };

  // Context-free, as checkValues is for the milestone longhands: every animation declaration of every rule, and every
  // @keyframes rule, keys its features; a keyframe property without a writer is refused wherever a keyframe sets it (R13).
  for (const rule of input.rules) {
    if (rule.selectors.every((sel) => sel.dropped)) continue;
    for (const d of rule.declarations) {
      for (const [p, list] of d.animation?.longhands ?? []) {
        if (list.kind === 'wide') feature(`${p}:${list.keyword}`, d.valueSpan);
        else for (const item of list.items) feature(`${p}:${featureType(item)}`, d.valueSpan);
      }
      const props = d.animation?.longhands.get('transition-property');
      for (const item of props !== undefined && props.kind === 'list' ? props.items : []) {
        if (item.kind !== 'name' || item.value.startsWith('--') || longhandsNamed(item.value) !== null || input.knownProperty(item.value)) continue;
        once(`noprop|${item.value}|${d.valueSpan.start}`, diagnostic('DRAGON_ANIMATION_NO_EFFECT', { origin: authored(d.valueSpan), message: `transition-property ${item.value} is not a CSS property, so the transition does nothing (as in Chrome)` }));
      }
    }
  }
  for (const rule of input.keyframes) {
    feature('at-rule:@keyframes', rule.preludeSpan);
    for (const b of rule.blocks) {
      for (const o of b.offsets) feature(`keyframe-selector:${o === 0 ? 'from' : o === 1 ? 'to' : '<percentage>'}`, rule.preludeSpan);
      for (const v of b.values) {
        const kind = animationKind(v.property);
        feature(`animatable:${v.property}`, v.span);
        if (!admitted(kind)) once(`kfp|${v.property}|${v.span.start}`, refuse(v.valueSpan, `${v.property} in @keyframes ${rule.name} cannot be animated yet: Dragon has no ${KIND_LABEL(kind)} animation writer (package ANIM-p)`));
      }
    }
  }

  // Per element and case: names without keyframes (M14), and R12, ANIM-cc and ANIM-v for the keyframes each animation uses.
  const animated = new Set<string>();
  const resolutions = new Map<string, { address: string; text: string }>();
  cases.forEach((c, ci) => {
    const tree = trees[ci] as Map<string, ResolvedElement>;
    const rootEl = [...tree.values()][0] as ResolvedElement;
    for (const ea of c.elements.values()) {
      const el = tree.get(ea.address) as ResolvedElement;
      for (const a of ea.animations) {
        if (a.name === 'none') continue;
        if (!a.hasKeyframes) {
          once(`noname|${a.name}|${ea.address}`, diagnostic('DRAGON_ANIMATION_NO_EFFECT', { origin: authored(spanFor(ea, 'animation-name')), message: `animation-name ${a.name} on ${ea.address} names no @keyframes rule, so it does nothing (as in Chrome)` }));
          continue;
        }
        const rule = keyframes.get(a.name) as KeyframesRule;
        for (const b of rule.blocks) {
          for (const v of b.values) {
            const kind = animationKind(v.property);
            animated.add(`${ea.address}|${v.property}`);
            if (!admitted(kind)) continue;
            const value = keyframeValueOf(v.value, pxOf(valueAt(el, 'font-size').value), pxOf(valueAt(rootEl, 'font-size').value));
            if (kind.kind === 'color' && value.kind === 'keyword' && value.value === 'currentcolor') once(`kfcc|${v.span.start}`, refuse(v.valueSpan, `${v.property}: currentcolor in @keyframes ${a.name} is unsupported: a keyframe pair between currentcolor and a colour is not built yet (package ANIM-cc)`));
            const id = `${a.name}|${v.span.start}|${v.property}`;
            const text = JSON.stringify(value);
            const prev = resolutions.get(id);
            if (prev === undefined) resolutions.set(id, { address: ea.address, text });
            else if (prev.text !== text) once(`kfv|${id}`, refuse(v.valueSpan, `${v.property}: ${v.text} is unsupported: one @keyframes resolves to different values on ${prev.address} and ${ea.address} (package ANIM-v)`));
          }
        }
      }
    }
  });

  // R13 (transitions), R12, ANIM-cc and R11 over every ordered pair of cases: a lane step may set several states at once (R4).
  for (let i = 0; i < cases.length; i++) {
    for (let j = 0; j < cases.length; j++) {
      if (i === j) continue;
      const a = cases[i] as AnimationCase;
      const b = cases[j] as AnimationCase;
      const ta = trees[i] as Map<string, ResolvedElement>;
      const tb = trees[j] as Map<string, ResolvedElement>;
      for (const [address, after] of b.elements) {
        const before = a.elements.get(address);
        const ea = ta.get(address);
        const eb = tb.get(address) as ResolvedElement;
        if (before === undefined || ea === undefined) continue;
        for (const [p, listing] of after.listings) {
          if (listing.delay + listing.duration <= 0) continue;
          const from = animValueOf(valueAt(ea, p).value);
          const to = animValueOf(valueAt(eb, p).value);
          if (sameValue(from, to)) continue;
          const kind = animationKind(p);
          if (kind.kind === 'discrete') continue;
          const span = spanFor(after, 'transition-property');
          animated.add(`${address}|${p}|transition`);
          feature(`animatable:${p}`, span);
          if (!admitted(kind)) {
            once(`tp|${p}|${span.start}`, refuse(span, `${p} cannot be animated yet: a transition on ${address} would start between two reachable states, and Dragon has no ${KIND_LABEL(kind)} animation writer (package ANIM-p)`));
            continue;
          }
          const cc = (v: AnimValue): boolean => v.kind === 'keyword' && v.value === 'currentcolor';
          if (cc(from) !== cc(to)) once(`tcc|${p}|${span.start}`, refuse(span, `${p} on ${address}: a transition between currentcolor and a colour is unsupported (package ANIM-cc)`));
          if (animated.has(`${address}|${p}`)) once(`to|${p}|${span.start}`, refuse(span, `${p} on ${address} is both transitioned and animated: Chrome blocks transitions on animated properties (package ANIM-o)`));
        }
        // R11: a kept finite animation whose timing changes between the two states.
        const occurrences = (list: readonly AnimationEntry[], k: number): number => list.slice(0, k).filter((x) => x.name === (list[k] as AnimationEntry).name).length;
        after.animations.forEach((n, k) => {
          if (!n.hasKeyframes) return;
          const nth = occurrences(after.animations, k);
          const o = before.animations.find((x, m) => x.name === n.name && x.hasKeyframes && occurrences(before.animations, m) === nth);
          if (o === undefined || (o.iterations === Infinity && n.iterations === Infinity)) return;
          if (o.duration === n.duration && o.delay === n.delay && o.iterations === n.iterations && o.direction === n.direction) return;
          const span = spanFor(after, 'animation-name');
          once(`t|${address}|${n.name}|${nth}`, refuse(span, `animation ${n.name} on ${address} changes its duration, delay, iteration count or direction between reachable states with a finite iteration count, whose finished state Chrome holds differently when seeking (package ANIM-t)`));
        });
      }
    }
  }
  // R8: the slot table per program.
  const slots = new Set([...animated].filter((k) => k.endsWith('|transition')));
  if (slots.size > MAX_TRANSITION_SLOTS) diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored((features[0] as { span: Span }).span), message: `the transitions of this document need ${slots.size} (element, property) slots, more than the ${MAX_TRANSITION_SLOTS} a program holds` }));
  return { cases, keyframes, features };
}

function refuse(span: Span, message: string): Diagnostic {
  return diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), message, manual: 'Remove the declaration, or animate a colour or length property between values of one kind.' });
}

/** The value type of one item, the support-profile feature it keys (T065 §4 support-profile rows). */
export function featureType(i: AnimItem): string {
  switch (i.kind) {
    case 'time':
      return '<time>';
    case 'easing':
      return i.easing.kind === 'cubic-bezier' && ['ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(i.easing.text) ? i.easing.text : i.easing.kind === 'steps' ? 'steps()' : i.easing.kind === 'cubic-bezier' ? 'cubic-bezier()' : i.easing.kind;
    case 'keyword':
      return i.value;
    case 'name':
      return '<custom-ident>';
    case 'number':
      return '<number>';
    case 'other':
      return '<other>';
  }
}

/**
 * The support gate: every used feature needs a supported row in the `animation` context on each target. Missing data means
 * unsupported, so until the frame lanes prove a feature (ANIM-b1 PR 3) every animation declaration is refused per target.
 */
export function gateAnimationFeatures(analysis: AnimationAnalysis, targets: readonly string[], profileOf: (t: string) => SupportProfile, diagnostics: Diagnostic[]): void {
  const bySpan = new Map<string, { span: Span; features: string[] }>();
  for (const { feature: f, span } of analysis.features) {
    const id = `${span.source.uri}|${span.start}|${span.end}`;
    const e = bySpan.get(id) ?? { span, features: [] };
    e.features.push(f);
    bySpan.set(id, e);
  }
  for (const t of targets) {
    const profile = profileOf(t);
    for (const { span, features } of bySpan.values()) {
      const missing = features.filter((f) => !provenContexts(profile, f).includes('animation'));
      if (missing.length === 0) continue;
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: authored(span),
        target: t,
        message: `${missing.join(', ')} has no passing frame-lane proof in the animation context (support profile ${profile.revision})`,
        manual: 'Remove the transition or animation until its frame lane proves it on this target.',
        profile: { target: t, profileRevision: profile.revision, feature: missing[0] as string, context: 'animation', status: 'unsupported' },
      }));
    }
  }
}
