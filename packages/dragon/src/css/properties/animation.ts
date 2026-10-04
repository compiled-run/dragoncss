// The transition and animation properties (css-transitions-1 and 2, css-animations-1 and 2) as Chrome 145 parses them
// (T065 §1): every longhand is a comma list, and the transition and animation shorthands assign each token to the first
// longhand, in Blink's parsing order, that accepts it and has no value yet in that item (CSSParsingUtils
// ConsumeAnimationShorthand). They are not milestone LONGHANDS: analysis/animations.ts runs their cascade, so the computed
// longhands every fixture captures and the web output every class carries stay as they are.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../../types.ts';
import { list, spanOf } from '../ast.ts';
import { asciiLower, decodeName } from '../escapes.ts';
import { CSS_WIDE } from '../values.ts';

// The transition and animation longhands stay out of LONGHANDS (T065 option B, C5), so these lists are not named *_LONGHANDS: the
// registry seam (seams.test.ts) spreads every family *_LONGHANDS list into LONGHANDS.
export const TRANSITION_LIST_PROPERTIES = ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior'] as const;

export const ANIMATION_LIST_PROPERTIES = [
  'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction',
  'animation-fill-mode', 'animation-play-state', 'animation-timeline', 'animation-range-start', 'animation-range-end', 'animation-composition',
] as const;

export type AnimLonghand = (typeof TRANSITION_LIST_PROPERTIES)[number] | (typeof ANIMATION_LIST_PROPERTIES)[number];

export const ANIM_LIST_PROPERTIES: readonly AnimLonghand[] = [...TRANSITION_LIST_PROPERTIES, ...ANIMATION_LIST_PROPERTIES];

/** The shorthands, each with its longhands; the animation shorthand resets timeline, range and composition to initial. */
export const ANIM_SHORTHANDS: { readonly [name: string]: readonly AnimLonghand[] } = {
  transition: TRANSITION_LIST_PROPERTIES,
  animation: ANIMATION_LIST_PROPERTIES,
  'animation-range': ['animation-range-start', 'animation-range-end'],
};

export function isAnimationProperty(name: string): boolean {
  return (ANIM_LIST_PROPERTIES as readonly string[]).includes(name) || Object.hasOwn(ANIM_SHORTHANDS, name);
}

export function isAnimLonghand(name: string): name is AnimLonghand {
  return (ANIM_LIST_PROPERTIES as readonly string[]).includes(name);
}

export type StepPosition = 'jump-start' | 'jump-end' | 'jump-none' | 'jump-both' | 'start' | 'end';

/** A timing function, as the rt's EasingSpec plus Chrome's computed serialization; `linear()` keeps only its text (refused). */
export type EasingValue = {
  readonly kind: 'linear' | 'cubic-bezier' | 'steps' | 'linear()';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly steps: number;
  readonly position: StepPosition;
  readonly text: string;
};

/** One item of a list: a time (seconds, as Chrome computes ms / 1000), an easing, a keyword, a name or a number. */
export type AnimItem =
  | { readonly kind: 'time'; readonly seconds: number }
  | { readonly kind: 'easing'; readonly easing: EasingValue }
  | { readonly kind: 'keyword'; readonly value: string }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'other'; readonly text: string };

/** A longhand's declared value: its comma list, or a CSS-wide keyword. */
export type AnimList = { readonly kind: 'list'; readonly items: readonly AnimItem[] } | { readonly kind: 'wide'; readonly keyword: string };

/** What an animation declaration sets: one value per longhand. */
export type AnimationDeclValue = { readonly longhands: ReadonlyMap<AnimLonghand, AnimList> };

const keywordItem = (value: string): AnimItem => ({ kind: 'keyword', value });

/** The initial value of each longhand, one item. */
export const ANIM_INITIAL: { readonly [P in AnimLonghand]: AnimItem } = {
  'transition-property': keywordItem('all'),
  'transition-duration': { kind: 'time', seconds: 0 },
  'transition-timing-function': { kind: 'easing', easing: keywordEasing('ease') as EasingValue },
  'transition-delay': { kind: 'time', seconds: 0 },
  'transition-behavior': keywordItem('normal'),
  'animation-name': keywordItem('none'),
  'animation-duration': keywordItem('auto'),
  'animation-timing-function': { kind: 'easing', easing: keywordEasing('ease') as EasingValue },
  'animation-delay': { kind: 'time', seconds: 0 },
  'animation-iteration-count': { kind: 'number', value: 1 },
  'animation-direction': keywordItem('normal'),
  'animation-fill-mode': keywordItem('none'),
  'animation-play-state': keywordItem('running'),
  'animation-timeline': keywordItem('auto'),
  'animation-range-start': keywordItem('normal'),
  'animation-range-end': keywordItem('normal'),
  'animation-composition': keywordItem('replace'),
};

function bezier(x1: number, y1: number, x2: number, y2: number, text: string): EasingValue {
  return { kind: 'cubic-bezier', x1, y1, x2, y2, steps: 0, position: 'end', text };
}

function stepsValue(n: number, position: StepPosition): EasingValue {
  const shown = position === 'end' || position === 'jump-end' ? `steps(${n})` : `steps(${n}, ${position})`;
  return { kind: 'steps', x1: 0, y1: 0, x2: 0, y2: 0, steps: n, position, text: shown };
}

/** The easing keywords, as Chrome computes them (step-start and step-end are steps(1, start) and steps(1)). */
export function keywordEasing(name: string): EasingValue | null {
  switch (name) {
    case 'linear':
      return { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 0, steps: 0, position: 'end', text: 'linear' };
    case 'ease':
      return bezier(0.25, 0.1, 0.25, 1, 'ease');
    case 'ease-in':
      return bezier(0.42, 0, 1, 1, 'ease-in');
    case 'ease-out':
      return bezier(0, 0, 0.58, 1, 'ease-out');
    case 'ease-in-out':
      return bezier(0.42, 0, 0.58, 1, 'ease-in-out');
    case 'step-start':
      return stepsValue(1, 'start');
    case 'step-end':
      return stepsValue(1, 'end');
    default:
      return null;
  }
}

const tokensOf = (n: CssNode): CssNode[] => list(n, 'children').filter((c) => c.type !== 'WhiteSpace');
const isComma = (n: CssNode): boolean => n.type === 'Operator' && String(n['value']) === ',';
const identOf = (n: CssNode): string | null => (n.type === 'Identifier' ? decodeName(String(n['name'])) : null);

/** A plain number token's value; math functions are not numbers here (refused by the caller). */
function numberOf(n: CssNode | undefined): number | null {
  if (n === undefined || n.type !== 'Number') return null;
  const v = Number(n['value']);
  return Number.isFinite(v) ? v : null;
}

/** css-values-4 <integer>: a number token written without a fraction or exponent. */
function integerOf(n: CssNode | undefined): number | null {
  if (n === undefined || n.type !== 'Number' || !/^[+-]?\d+$/.test(String(n['value']))) return null;
  return Number(n['value']);
}

/** A <time>: seconds as Chrome stores them (s, or ms / 1000). */
function timeOf(n: CssNode, nonNegative: boolean): AnimItem | null {
  if (n.type !== 'Dimension') return null;
  const unit = asciiLower(String(n['unit']));
  const v = Number(n['value']);
  if (!Number.isFinite(v) || (unit !== 's' && unit !== 'ms')) return null;
  if (nonNegative && v < 0) return null;
  return { kind: 'time', seconds: unit === 's' ? v : v / 1000 };
}

/** The arguments of a function, split at commas; null when a part is not exactly one token. */
function argsOf(fn: CssNode): CssNode[] | null {
  const ts = tokensOf(fn);
  const out: CssNode[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i] as CssNode;
    if (i % 2 === 1) {
      if (!isComma(t)) return null;
      continue;
    }
    if (isComma(t)) return null;
    out.push(t);
  }
  return ts.length % 2 === 1 || ts.length === 0 ? out : null;
}

const STEP_POSITIONS: readonly StepPosition[] = ['jump-start', 'jump-end', 'jump-none', 'jump-both', 'start', 'end'];

/** css-easing-1 <easing-function>, as Chrome 145 accepts it. */
function easingOf(n: CssNode): EasingValue | null {
  const id = identOf(n);
  if (id !== null) return keywordEasing(asciiLower(id));
  if (n.type !== 'Function') return null;
  const name = asciiLower(String(n['name']));
  if (name === 'linear') return { kind: 'linear()', x1: 0, y1: 0, x2: 0, y2: 0, steps: 0, position: 'end', text: generate(n) };
  const args = argsOf(n);
  if (args === null) return null;
  if (name === 'cubic-bezier') {
    const v = args.map(numberOf);
    if (v.length !== 4 || v.some((x) => x === null)) return null;
    const [x1, y1, x2, y2] = v as number[];
    if ((x1 as number) < 0 || (x1 as number) > 1 || (x2 as number) < 0 || (x2 as number) > 1) return null;
    return bezier(x1 as number, y1 as number, x2 as number, y2 as number, `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`);
  }
  if (name === 'steps') {
    if (args.length < 1 || args.length > 2) return null;
    const count = integerOf(args[0]);
    const posName = args.length === 2 ? identOf(args[1] as CssNode) : 'end';
    const position = posName === null ? undefined : STEP_POSITIONS.find((p) => p === asciiLower(posName));
    if (count === null || position === undefined || count < 1 || (position === 'jump-none' && count < 2)) return null;
    return stepsValue(count, position);
  }
  return null;
}

const DIRECTIONS = ['normal', 'reverse', 'alternate', 'alternate-reverse'];
const FILL_MODES = ['none', 'forwards', 'backwards', 'both'];
const PLAY_STATES = ['running', 'paused'];
const COMPOSITIONS = ['replace', 'add', 'accumulate'];
const RANGE_NAMES = ['cover', 'contain', 'entry', 'exit', 'entry-crossing', 'exit-crossing', 'scroll', 'view'];

function keywordIn(n: CssNode, set: readonly string[]): AnimItem | null {
  const id = identOf(n);
  if (id === null) return null;
  const k = asciiLower(id);
  return set.includes(k) ? keywordItem(k) : null;
}

/** A <custom-ident>: not a CSS-wide keyword or "default" (css-values-4 §4.2). */
function customIdent(n: CssNode): string | null {
  const id = identOf(n);
  if (id === null) return null;
  const k = asciiLower(id);
  return CSS_WIDE.has(k) || k === 'default' ? null : id;
}

/** One item of a longhand, from all of its tokens; null when Chrome rejects it. */
function itemOf(p: AnimLonghand, ts: readonly CssNode[]): AnimItem | null {
  if (p === 'animation-range-start' || p === 'animation-range-end') return rangeItem(ts);
  if (ts.length !== 1) return null;
  const t = ts[0] as CssNode;
  switch (p) {
    case 'transition-property': {
      const id = identOf(t);
      if (id === null) return null;
      const k = asciiLower(id);
      if (k === 'none' || k === 'all') return keywordItem(k);
      const name = customIdent(t);
      return name === null ? null : { kind: 'name', value: name.startsWith('--') ? name : asciiLower(name) };
    }
    case 'transition-duration':
      return timeOf(t, true);
    case 'animation-duration':
      return keywordIn(t, ['auto']) ?? timeOf(t, true);
    case 'transition-delay':
    case 'animation-delay':
      return timeOf(t, false);
    case 'transition-timing-function':
    case 'animation-timing-function': {
      const e = easingOf(t);
      return e === null ? null : { kind: 'easing', easing: e };
    }
    case 'transition-behavior':
      return keywordIn(t, ['normal', 'allow-discrete']);
    case 'animation-name': {
      if (t.type === 'String') return { kind: 'name', value: String(t['value']) };
      const id = identOf(t);
      if (id !== null && asciiLower(id) === 'none') return keywordItem('none');
      const name = customIdent(t);
      return name === null ? null : { kind: 'name', value: name };
    }
    case 'animation-iteration-count': {
      const k = keywordIn(t, ['infinite']);
      if (k !== null) return k;
      const n = numberOf(t);
      return n === null || n < 0 ? null : { kind: 'number', value: n };
    }
    case 'animation-direction':
      return keywordIn(t, DIRECTIONS);
    case 'animation-fill-mode':
      return keywordIn(t, FILL_MODES);
    case 'animation-play-state':
      return keywordIn(t, PLAY_STATES);
    case 'animation-composition':
      return keywordIn(t, COMPOSITIONS);
    case 'animation-timeline': {
      const k = keywordIn(t, ['auto', 'none']);
      if (k !== null) return k;
      const id = identOf(t);
      if (id !== null && id.startsWith('--')) return { kind: 'other', text: id };
      if (t.type === 'Function' && ['scroll', 'view'].includes(asciiLower(String(t['name'])))) return { kind: 'other', text: generate(t) };
      return null;
    }
  }
}

/** animation-range-start and -end: normal, a length-percentage, or a range name with an optional length-percentage. */
function rangeItem(ts: readonly CssNode[]): AnimItem | null {
  const lp = (n: CssNode | undefined): boolean => n !== undefined && (n.type === 'Percentage' || n.type === 'Dimension' || (n.type === 'Number' && Number(n['value']) === 0));
  if (ts.length === 1 && keywordIn(ts[0] as CssNode, ['normal']) !== null) return keywordItem('normal');
  if (ts.length === 1 && lp(ts[0])) return { kind: 'other', text: generate(ts[0] as CssNode) };
  const name = ts[0] === undefined ? null : keywordIn(ts[0], RANGE_NAMES);
  if (name === null || ts.length > 2 || (ts.length === 2 && !lp(ts[1]))) return null;
  return { kind: 'other', text: ts.map((t) => generate(t)).join(' ') };
}

/** Splits a value's tokens at top-level commas; null when a part is empty. */
function commaParts(ts: readonly CssNode[]): CssNode[][] | null {
  const parts: CssNode[][] = [[]];
  for (const t of ts) {
    if (isComma(t)) parts.push([]);
    else (parts[parts.length - 1] as CssNode[]).push(t);
  }
  return parts.some((p) => p.length === 0) ? null : parts;
}

/** Blink's parsing order for each shorthand: a token goes to the first of these with no value yet in its item. */
const SHORTHAND_ORDER: { readonly [name: string]: readonly AnimLonghand[] } = {
  transition: ['transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior', 'transition-property'],
  animation: ['animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state', 'animation-name'],
};

export type AnimParse = { readonly kind: 'ok'; readonly value: AnimationDeclValue } | { readonly kind: 'invalid' };

/** Parses the value of an animation property as Chrome 145 does; 'invalid' is a value Chrome drops. */
export function parseAnimationValue(property: string, valueNode: CssNode): AnimParse {
  const ts = tokensOf(valueNode);
  const longhands = new Map<AnimLonghand, AnimList>();
  const targets = isAnimLonghand(property) ? [property] : (ANIM_SHORTHANDS[property] as readonly AnimLonghand[]);
  const only = ts[0];
  if (ts.length === 1 && only !== undefined && only.type === 'Identifier' && CSS_WIDE.has(asciiLower(identOf(only) as string))) {
    for (const p of targets) longhands.set(p, { kind: 'wide', keyword: asciiLower(identOf(only) as string) });
    return { kind: 'ok', value: { longhands } };
  }
  const parts = commaParts(ts);
  if (parts === null) return { kind: 'invalid' };
  if (isAnimLonghand(property)) {
    const items = parts.map((part) => itemOf(property, part));
    if (items.some((i) => i === null)) return { kind: 'invalid' };
    if (property === 'transition-property' && items.length > 1 && items.some((i) => i?.kind === 'keyword' && i.value === 'none')) return { kind: 'invalid' };
    longhands.set(property, { kind: 'list', items: items as AnimItem[] });
    return { kind: 'ok', value: { longhands } };
  }
  if (property === 'animation-range') {
    if (parts.length !== 1) return { kind: 'invalid' };
    // css-animations-2: <'animation-range-start'> <'animation-range-end'>?, where a lone name sets both ends to that name.
    const part = parts[0] as CssNode[];
    for (let cut = part.length; cut >= 1; cut--) {
      const start = rangeItem(part.slice(0, cut));
      const rest = part.slice(cut);
      const end = rest.length === 0 ? (start !== null && start.kind === 'other' && part.length === 1 && keywordIn(part[0] as CssNode, RANGE_NAMES) !== null ? start : keywordItem('normal')) : rangeItem(rest);
      if (start !== null && end !== null) {
        longhands.set('animation-range-start', { kind: 'list', items: [start] });
        longhands.set('animation-range-end', { kind: 'list', items: [end] });
        return { kind: 'ok', value: { longhands } };
      }
    }
    return { kind: 'invalid' };
  }
  const order = SHORTHAND_ORDER[property] as readonly AnimLonghand[];
  const lists = new Map<AnimLonghand, AnimItem[]>(targets.map((p) => [p, []]));
  for (const part of parts) {
    const found = new Map<AnimLonghand, AnimItem>();
    for (const t of part) {
      const p = order.find((q) => !found.has(q) && itemOf(q, [t]) !== null);
      if (p === undefined) return { kind: 'invalid' };
      found.set(p, itemOf(p, [t]) as AnimItem);
    }
    for (const p of targets) (lists.get(p) as AnimItem[]).push(found.get(p) ?? ANIM_INITIAL[p]);
  }
  const props = lists.get('transition-property');
  if (props !== undefined && props.length > 1 && props.some((i) => i.kind === 'keyword' && i.value === 'none')) return { kind: 'invalid' };
  for (const p of targets) {
    const items = lists.get(p) as AnimItem[];
    // The animation shorthand resets the longhands it does not parse to one initial item.
    longhands.set(p, { kind: 'list', items: order.includes(p) ? items : [ANIM_INITIAL[p]] });
  }
  return { kind: 'ok', value: { longhands } };
}

/** The refusal of a value Chrome accepts and ANIM-b1 does not build (T065 §1 table), or null. */
export function animationRefusal(property: string, value: AnimationDeclValue, span: Span): Diagnostic | null {
  const refuse = (detail: string, pkg: string): Diagnostic => diagnostic('DRAGON_UNSUPPORTED_VALUE', {
    origin: authored(span),
    message: `${property}: ${detail} (package ${pkg})`,
    manual: 'Remove the value, or use one ANIM-b1 builds.',
  });
  for (const [p, v] of value.longhands) {
    if (v.kind !== 'list') continue;
    for (const item of v.items) {
      if (item.kind === 'easing' && item.easing.kind === 'linear()') return refuse(`${item.easing.text} is unsupported: linear() easing is not built yet`, 'ANIM-L');
      if (p === 'transition-behavior' && item.kind === 'keyword' && item.value === 'allow-discrete') return refuse('allow-discrete is unsupported: discrete transitions are not built yet', 'ANIM-d');
      if (p === 'animation-composition' && !(item.kind === 'keyword' && item.value === 'replace')) return refuse(`${item.kind === 'keyword' ? item.value : 'this value'} is unsupported: only animation-composition: replace is built`, 'ANIM-c');
      if (p === 'animation-timeline' && !(item.kind === 'keyword' && item.value === 'auto')) return refuse(`${item.kind === 'keyword' ? item.value : item.kind === 'other' ? item.text : 'this value'} is unsupported: scroll and view timelines are not built yet`, 'ANIM-S');
      if ((p === 'animation-range-start' || p === 'animation-range-end') && !(item.kind === 'keyword' && item.value === 'normal')) return refuse(`${item.kind === 'other' ? item.text : 'this value'} is unsupported: scroll and view timelines are not built yet`, 'ANIM-S');
    }
  }
  return null;
}

/** The spans of math functions in a value: Chrome accepts calc() times and numbers, which ANIM-b1 does not resolve. */
export function mathTokens(valueNode: CssNode, base: Span): Span[] {
  return tokensOf(valueNode).filter((t) => t.type === 'Function' && ['calc', 'min', 'max', 'clamp'].includes(asciiLower(String(t['name'])))).map((t) => spanOf(t, base));
}

/**
 * A declaration of an animation property, parsed apart from the milestone longhands: its longhands list is empty and
 * `animation` holds what it sets. A value holding var() or a math function is refused (Chrome accepts both).
 */
export function parseAnimationDeclaration(property: string, valueNode: CssNode, at: { readonly span: Span; readonly valueSpan: Span; readonly text: string; readonly source: string; readonly base: Span }, diagnostics: Diagnostic[]): AnimationDeclValue | null {
  if (/var\(|\\/i.test(at.source)) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(at.valueSpan),
      message: `${property}: ${at.source.trim()} is unsupported: ANIM-b1 does not substitute var() in transition and animation values (package ANIM-v)`,
      manual: `Write the ${property} value without var().`,
    }));
    return null;
  }
  const math = mathTokens(valueNode, at.base);
  if (math.length > 0) {
    const first = math[0] as Span;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(first),
      message: `${property}: ${at.source.slice(first.start - at.valueSpan.start, first.end - at.valueSpan.start)} is unsupported: ANIM-b1 does not resolve math functions in transition and animation values (package ANIM-k)`,
      manual: 'Write the time or number as a plain value.',
    }));
    return null;
  }
  const parsed = parseAnimationValue(property, valueNode);
  if (parsed.kind === 'invalid') {
    diagnostics.push(diagnostic('DRAGON_CSS_INVALID_VALUE', {
      origin: authored(at.valueSpan),
      message: `"${at.text}" is not a valid value for ${property} (Chrome 145 drops the declaration)`,
      manual: `Use a value that matches the ${property} grammar.`,
    }));
    return null;
  }
  const refusal = animationRefusal(property, parsed.value, at.valueSpan);
  if (refusal !== null) {
    diagnostics.push(refusal);
    return null;
  }
  return parsed.value;
}
