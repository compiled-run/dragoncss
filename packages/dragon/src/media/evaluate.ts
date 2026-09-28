// Evaluates a parsed media query list over a viewport in CSS px, with MQ4's three-valued logic for <general-enclosed>.
import type { MediaFaults } from './faults.ts';
import { NO_MEDIA_FAULTS } from './faults.ts';
import { INITIAL_FONT_SIZE, resolveLength } from './length.ts';
import { featuresOfList } from './parse.ts';
import type { Comparison, MediaCondition, MediaFeature, MediaQuery, MediaQueryList, MediaValue } from './parse.ts';
import { serialiseFeature } from './parse.ts';

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

function compare(a: number, op: Comparison, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '=':
      return a === b;
  }
}

/** Decides one width or height feature; the other features are answered from the environment by evaluateFeature. */
export type FeatureOracle = (feature: MediaFeature) => boolean;

/** Evaluates one feature Dragon supports. Throws for a refused feature. */
export function evaluateFeature(f: MediaFeature, env: MediaEnvironment, faults: MediaFaults = NO_MEDIA_FAULTS): boolean {
  if (f.refused !== null) throw new Error(`media feature ${f.name} is refused`);
  const emBase = faults.emFromRoot ? (env.rootFontSize ?? INITIAL_FONT_SIZE) : INITIAL_FONT_SIZE;
  if (f.base === 'orientation') return f.form === 'boolean' || (f.value as MediaValue & { kind: 'ident' }).name === (env.height >= env.width ? 'portrait' : 'landscape');
  if (f.base === 'aspect-ratio') {
    // w/h against num/den, cross-multiplied so integer viewports compare exactly.
    if (f.form === 'boolean') return env.width !== 0;
    const lhs = (v: MediaValue): number => env.width * (v as MediaValue & { kind: 'ratio' }).den;
    const rhs = (v: MediaValue): number => env.height * (v as MediaValue & { kind: 'ratio' }).num;
    if (f.form === 'plain') {
      const v = f.value as MediaValue;
      return compare(lhs(v), f.prefix === 'min' ? '>=' : f.prefix === 'max' ? '<=' : '=', rhs(v));
    }
    return (f.left === null || compare(rhs(f.left.value), f.left.op, lhs(f.left.value))) && (f.right === null || compare(lhs(f.right.value), f.right.op, rhs(f.right.value)));
  }
  const actual = f.base === 'width' ? env.width : env.height;
  const px = (v: MediaValue): number => resolveLength((v as MediaValue & { kind: 'length' }).length, emBase);
  if (f.form === 'boolean') return actual !== 0;
  if (f.form === 'plain') {
    const v = px(f.value as MediaValue);
    if (f.prefix === 'min') return actual >= v;
    if (f.prefix === 'max') return faults.maxWidthExclusive ? actual < v : actual <= v;
    return actual === v;
  }
  return (f.left === null || compare(px(f.left.value), f.left.op, actual)) && (f.right === null || compare(actual, f.right.op, px(f.right.value)));
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
