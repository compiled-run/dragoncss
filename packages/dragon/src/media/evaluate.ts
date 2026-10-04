// Evaluates a parsed media query list over a viewport in CSS px, with MQ4's three-valued logic for <general-enclosed> and
// Chrome 145's comparisons (notes/T067 R2).
import type { MediaFaults } from './faults.ts';
import { NO_MEDIA_FAULTS } from './faults.ts';
import { INITIAL_FONT_SIZE, resolveLength } from './length.ts';
import { featuresOfList } from './parse.ts';
import type { Comparison, MediaCondition, MediaFeature, MediaQuery, MediaQueryList, MediaValue } from './parse.ts';
import { serialiseFeature } from './parse.ts';
import { wholePx } from './viewport.ts';

export type MediaEnvironment = {
  readonly width: number;
  readonly height: number;
  /** The document's root font size. Media queries ignore it; only the emFromRoot fault reads it. */
  readonly rootFontSize?: number;
};

export type MediaRefusal = { readonly feature: string; readonly reason: 'environment' | 'value' };

export type MediaResult = { readonly kind: 'matches'; readonly matches: boolean } | { readonly kind: 'refused'; readonly refusals: readonly MediaRefusal[] };

type Kleene = boolean | 'unknown';

const not = (v: Kleene): Kleene => (v === 'unknown' ? v : !v);
const and = (vs: readonly Kleene[]): Kleene => (vs.includes(false) ? false : vs.includes('unknown') ? 'unknown' : true);
const or = (vs: readonly Kleene[]): Kleene => (vs.includes(true) ? true : vs.includes('unknown') ? 'unknown' : false);

/** Chrome's slack on <=, >= and = media comparisons: one LayoutUnit (media_query_evaluator.cc CompareDoubleValue, M2). */
export const MEDIA_EPSILON = 1 / 64;

/** The operator with its sides swapped: `v op feature` is `feature reversed(op) v`. */
export const REVERSED: Readonly<Record<Comparison, Comparison>> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };

/**
 * Chrome's comparison of a feature value with a query value (R2): <=, >= and = allow 1/64 of slack, < and > are exact, and a
 * negative query value is true only for > and >= (css-mediaqueries-4 "false in the negative range").
 */
export function compareMedia(actual: number, op: Comparison, query: number, faults: MediaFaults = NO_MEDIA_FAULTS): boolean {
  if (query < 0) return op === '>' || op === '>=';
  const eps = faults.mediaCompareExact ? 0 : MEDIA_EPSILON;
  switch (op) {
    case '<':
      return actual < query;
    case '<=':
      return actual <= query + eps;
    case '>':
      return actual > query;
    case '>=':
      return actual >= query - eps;
    case '=':
      return Math.abs(actual - query) <= eps;
  }
}

/** The operator of a plain (min-/max-/exact) feature. */
export const plainOp = (prefix: MediaFeature['prefix']): Comparison => (prefix === 'min' ? '>=' : prefix === 'max' ? '<=' : '=');

/** The comparisons a plain or range feature makes, each as `feature op value`; the feature holds when all of them do. */
export function comparisonsOf(f: MediaFeature, faults: MediaFaults = NO_MEDIA_FAULTS): { readonly op: Comparison; readonly value: MediaValue }[] {
  if (f.form === 'boolean') return [];
  if (f.form === 'plain') {
    const exclusive = f.prefix === 'max' && faults.maxWidthExclusive && (f.base === 'width' || f.base === 'height');
    return [{ op: exclusive ? '<' : plainOp(f.prefix), value: f.value as MediaValue }];
  }
  return [...(f.left === null ? [] : [{ op: REVERSED[f.left.op], value: f.left.value }]), ...(f.right === null ? [] : [{ op: f.right.op, value: f.right.value }])];
}

/** Decides one feature, as a band's truth assignment does. */
export type FeatureOracle = (feature: MediaFeature) => boolean;

/** The whole CSS px orientation and aspect-ratio compare: Chrome reads the media size into an int (truncation, M3). */
export function ratioSize(env: MediaEnvironment, untruncated: boolean): { readonly width: number; readonly height: number } {
  return untruncated ? env : { width: wholePx(env.width), height: wholePx(env.height) };
}

/** Evaluates one feature Dragon supports. Throws for a refused feature. */
export function evaluateFeature(f: MediaFeature, env: MediaEnvironment, faults: MediaFaults = NO_MEDIA_FAULTS): boolean {
  if (f.refused !== null) throw new Error(`media feature ${f.name} is refused`);
  const emBase = faults.emFromRoot ? (env.rootFontSize ?? INITIAL_FONT_SIZE) : INITIAL_FONT_SIZE;
  if (f.base === 'orientation') {
    // A square viewport is portrait; the boolean form is true for any size.
    if (f.form === 'boolean') return true;
    const { width, height } = ratioSize(env, faults.orientationUntruncated);
    return (f.value as MediaValue & { kind: 'ident' }).name === (width > height ? 'landscape' : 'portrait');
  }
  if (f.base === 'aspect-ratio') {
    // w/h against num/den, cross-multiplied as Chrome does (w * den against h * num); the boolean form is always true.
    if (f.form === 'boolean') return true;
    const { width, height } = ratioSize(env, faults.aspectRatioUntruncated);
    return comparisonsOf(f, faults).every(({ op, value }) => {
      const r = value as MediaValue & { kind: 'ratio' };
      return compareMedia(width * r.den, op, height * r.num, faults);
    });
  }
  const actual = f.base === 'width' ? env.width : env.height;
  const px = (v: MediaValue): number => resolveLength((v as MediaValue & { kind: 'length' }).length, emBase);
  if (f.form === 'boolean') return actual !== 0;
  return comparisonsOf(f, faults).every(({ op, value }) => compareMedia(actual, op, px(value), faults));
}

function evalCondition(c: MediaCondition, decide: (f: MediaFeature) => boolean, faults: MediaFaults): Kleene {
  switch (c.type) {
    case 'feature':
      return decide(c);
    case 'general-enclosed':
      return faults.unknownAsTrue ? true : 'unknown';
    case 'parens':
      return evalCondition(c.condition, decide, faults);
    case 'not':
      return not(evalCondition(c.operand, decide, faults));
    case 'and':
      return and(c.operands.map((o) => evalCondition(o, decide, faults)));
    case 'or':
      return or(c.operands.map((o) => evalCondition(o, decide, faults)));
  }
}

function evalQuery(q: MediaQuery, decide: (f: MediaFeature) => boolean, faults: MediaFaults): boolean {
  if (!q.valid) return false;
  const type = q.mediaType === null || q.mediaType === 'all' || q.mediaType === 'screen';
  const cond: Kleene = q.condition === null ? true : evalCondition(q.condition, decide, faults);
  if (q.modifier === 'not') return (faults.notBindsTighterThanAnd ? and([!type, cond]) : not(and([type, cond]))) === true;
  return and([type, cond]) === true;
}

export function refusalsOf(list: MediaQueryList): MediaRefusal[] {
  return featuresOfList(list).flatMap((f) => (f.refused === null ? [] : [{ feature: serialiseFeature(f), reason: f.refused }]));
}

function run(list: MediaQueryList, decide: (f: MediaFeature) => boolean, faults: MediaFaults): MediaResult {
  const refusals = refusalsOf(list);
  if (refusals.length > 0) return { kind: 'refused', refusals };
  if (list.queries.length === 0) return { kind: 'matches', matches: true };
  return { kind: 'matches', matches: list.queries.some((q) => evalQuery(q, decide, faults)) };
}

/** Evaluates a media query list on a screen of the given viewport. A list that uses a refused feature is refused whole. */
export function evaluateMediaQueryList(list: MediaQueryList, env: MediaEnvironment, faults: MediaFaults = NO_MEDIA_FAULTS): MediaResult {
  return run(list, (f) => evaluateFeature(f, env, faults), faults);
}

/** Evaluates a media query list with every feature decided by the oracle (a band's truth assignment). */
export function evaluateWithOracle(list: MediaQueryList, oracle: FeatureOracle, faults: MediaFaults = NO_MEDIA_FAULTS): MediaResult {
  return run(list, oracle, faults);
}
