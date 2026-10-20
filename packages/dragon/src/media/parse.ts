// Media Queries 4 parser and serialiser. An invalid query becomes `not all`, and an unparseable ( ... ) or function is
// <general-enclosed>, kept as authored text, as Chrome 145 does.
import { generate } from 'css-tree';
import { asciiLower } from '../css/escapes.ts';
import type { CssNode } from 'css-tree';
import { DEVICE_KEYWORDS, EVALUATED_FEATURES, isEnvironmentFeature, RANGE_FEATURES, splitFeatureName } from './features.ts';
import type { MediaFaults } from './faults.ts';
import { NO_MEDIA_FAULTS } from './faults.ts';
import { InvalidValue, parseLength, RefusedValue, serialiseLength } from './length.ts';
import type { MediaLength } from './length.ts';
import { exactNumber } from './number.ts';
import type { NumberFormat } from './number.ts';
import { componentValues, isWhitespace, tokenize } from './tokens.ts';
import type { ComponentValue } from './tokens.ts';

export type MediaValue =
  | { readonly kind: 'length'; readonly length: MediaLength }
  | { readonly kind: 'ratio'; readonly num: number; readonly den: number }
  | { readonly kind: 'ident'; readonly name: string }
  /** MQ-R2: a <resolution> as authored (dppx, x, dpi or dpcm), and -webkit-device-pixel-ratio's <number>. */
  | { readonly kind: 'resolution'; readonly value: number; readonly unit: ResolutionUnit }
  | { readonly kind: 'number'; readonly value: number }
  /** A value Dragon does not evaluate: a ratio, or the authored component values. */
  | { readonly kind: 'raw'; readonly ratio: { readonly num: number; readonly den: number } | null; readonly values: readonly ComponentValue[] };

export type Comparison = '<' | '<=' | '>' | '>=' | '=';

export type ResolutionUnit = 'dppx' | 'x' | 'dpi' | 'dpcm';
const RESOLUTION_UNITS: readonly string[] = ['dppx', 'x', 'dpi', 'dpcm'];
const FLOAT_MAX = 3.4028234663852886e38;

export type MediaFeature = {
  readonly type: 'feature';
  /** The authored name, lowercased, prefix included. */
  readonly name: string;
  readonly prefix: 'min' | 'max' | null;
  readonly base: string;
  readonly form: 'boolean' | 'plain' | 'range';
  readonly value: MediaValue | null;
  /** Range form `<value> <op> <name>`. */
  readonly left: { readonly value: MediaValue; readonly op: Comparison } | null;
  /** Range form `<name> <op> <value>`. */
  readonly right: { readonly op: Comparison; readonly value: MediaValue } | null;
  /** Why Dragon refuses to evaluate it (until MQ-R), or null. */
  readonly refused: 'environment' | 'value' | null;
};

export type MediaInParens =
  | MediaFeature
  | { readonly type: 'parens'; readonly condition: MediaCondition }
  | { readonly type: 'general-enclosed'; readonly text: string };

export type MediaCondition =
  | MediaInParens
  | { readonly type: 'not'; readonly operand: MediaCondition }
  | { readonly type: 'and' | 'or'; readonly operands: readonly MediaCondition[] };

export type MediaQuery =
  | { readonly valid: true; readonly modifier: 'not' | 'only' | null; readonly mediaType: string | null; readonly condition: MediaCondition | null }
  | { readonly valid: false };

export type MediaQueryList = { readonly queries: readonly MediaQuery[] };

const RESERVED_TYPES = new Set(['only', 'not', 'and', 'or', 'layer']);

type Item = ComponentValue | { readonly kind: 'op'; readonly op: Comparison };

const identOf = (cv: ComponentValue | undefined): string | null =>
  cv !== undefined && cv.kind === 'token' && cv.token.type === 'ident' ? asciiLower(cv.token.value) : null;

const trimmed = (cvs: readonly ComponentValue[]): ComponentValue[] => cvs.filter((cv) => !isWhitespace(cv));

class Parser {
  private readonly src: string;
  private readonly faults: MediaFaults;
  constructor(src: string, faults: MediaFaults) {
    this.src = src;
    this.faults = faults;
  }

  list(): MediaQueryList {
    const cvs = componentValues(tokenize(this.src), this.src.length);
    if (trimmed(cvs).length === 0) return { queries: [] };
    const segments: ComponentValue[][] = [[]];
    for (const cv of cvs) {
      if (cv.kind === 'token' && cv.token.type === 'comma') segments.push([]);
      else (segments[segments.length - 1] as ComponentValue[]).push(cv);
    }
    return { queries: segments.map((s) => this.query(trimmed(s))) };
  }

  private query(cvs: readonly ComponentValue[]): MediaQuery {
    if (cvs.length === 0) return { valid: false };
    const condition = this.condition(cvs, true);
    if (condition !== null) return { valid: true, modifier: null, mediaType: null, condition };
    const first = identOf(cvs[0]);
    if (first === null) return { valid: false };
    let k = 0;
    let modifier: 'not' | 'only' | null = null;
    if ((first === 'not' || first === 'only') && identOf(cvs[1]) !== null) {
      modifier = first;
      k = 1;
    }
    const type = identOf(cvs[k]);
    if (type === null || RESERVED_TYPES.has(type)) return { valid: false };
    if (k + 1 === cvs.length) return { valid: true, modifier, mediaType: type, condition: null };
    if (identOf(cvs[k + 1]) !== 'and') return { valid: false };
    const rest = this.condition(cvs.slice(k + 2), false);
    if (rest === null) return { valid: false };
    return { valid: true, modifier, mediaType: type, condition: rest };
  }

  private condition(cvs: readonly ComponentValue[], allowOr: boolean): MediaCondition | null {
    if (cvs.length === 0) return null;
    if (identOf(cvs[0]) === 'not') {
      const operand = cvs[1] === undefined ? null : this.inParens(cvs[1]);
      if (operand === null) return null;
      const node: MediaCondition = { type: 'not', operand };
      if (cvs.length === 2) return node;
      return this.faults.notBindsTighterThanAnd ? this.chain(node, cvs.slice(2), allowOr) : null;
    }
    const first = this.inParens(cvs[0] as ComponentValue);
    if (first === null) return null;
    return this.chain(first, cvs.slice(1), allowOr);
  }

  private chain(first: MediaCondition, rest: readonly ComponentValue[], allowOr: boolean): MediaCondition | null {
    if (rest.length === 0) return first;
    const kw = identOf(rest[0]);
    if (kw !== 'and' && !(kw === 'or' && allowOr)) return null;
    const operands: MediaCondition[] = [first];
    for (let k = 0; k < rest.length; k += 2) {
      if (identOf(rest[k]) !== kw || rest[k + 1] === undefined) return null;
      const operand = this.inParens(rest[k + 1] as ComponentValue);
      if (operand === null) return null;
      operands.push(operand);
    }
    return { type: kw, operands };
  }

  private inParens(cv: ComponentValue): MediaInParens | null {
    if (cv.kind === 'function') return { type: 'general-enclosed', text: this.src.slice(cv.start, cv.end) };
    if (cv.kind !== 'block' || cv.open !== '(') return null;
    const inner = trimmed(cv.children);
    const condition = this.condition(inner, true);
    if (condition !== null) return { type: 'parens', condition };
    return this.feature(cv.children) ?? { type: 'general-enclosed', text: this.src.slice(cv.start, cv.end) };
  }

  private feature(children: readonly ComponentValue[]): MediaFeature | null {
    const items: Item[] = [];
    for (const cv of children) {
      if (isWhitespace(cv)) continue;
      if (cv.kind === 'token' && cv.token.type === 'delim' && '<>='.includes(cv.token.value)) {
        const prev = items[items.length - 1];
        const prevCv = children[children.indexOf(cv) - 1];
        const adjacent = prevCv !== undefined && prevCv.kind === 'token' && prevCv.token.type === 'delim' && prevCv.end === cv.start;
        if (cv.token.value === '=' && prev !== undefined && prev.kind === 'op' && (prev.op === '<' || prev.op === '>') && adjacent) {
          items[items.length - 1] = { kind: 'op', op: `${prev.op}=` };
        } else items.push({ kind: 'op', op: cv.token.value as Comparison });
        continue;
      }
      items.push(cv);
    }
    const nameAt = (item: Item | undefined): string | null => (item === undefined || item.kind === 'op' ? null : identOf(item));
    if (items.length === 1) {
      const name = nameAt(items[0]);
      return name === null ? null : this.makeFeature(name, 'boolean', null, null, null);
    }
    const second = items[1];
    if (nameAt(items[0]) !== null && second !== undefined && second.kind === 'token' && second.token.type === 'colon') {
      return this.makeFeature(nameAt(items[0]) as string, 'plain', items.slice(2), null, null);
    }
    const segments: Item[][] = [[]];
    const ops: Comparison[] = [];
    for (const item of items) {
      if (item.kind === 'op') {
        ops.push(item.op);
        segments.push([]);
      } else (segments[segments.length - 1] as Item[]).push(item);
    }
    if (segments.some((s) => s.length === 0)) return null;
    const single = (s: Item[] | undefined): string | null => (s !== undefined && s.length === 1 ? nameAt(s[0]) : null);
    if (ops.length === 1) {
      const leftName = single(segments[0]);
      if (leftName !== null && isFeatureName(leftName)) {
        return this.makeFeature(leftName, 'range', null, null, { op: ops[0] as Comparison, items: segments[1] as Item[] });
      }
      const rightName = single(segments[1]);
      if (rightName === null) return null;
      return this.makeFeature(rightName, 'range', null, { op: ops[0] as Comparison, items: segments[0] as Item[] }, null);
    }
    if (ops.length === 2) {
      const name = single(segments[1]);
      const [a, b] = ops as [Comparison, Comparison];
      const lt = (o: Comparison): boolean => o === '<' || o === '<=';
      const gt = (o: Comparison): boolean => o === '>' || o === '>=';
      if (name === null || !((lt(a) && lt(b)) || (gt(a) && gt(b)))) return null;
      return this.makeFeature(name, 'range', null, { op: a, items: segments[0] as Item[] }, { op: b, items: segments[2] as Item[] });
    }
    return null;
  }

  private makeFeature(
    name: string,
    form: MediaFeature['form'],
    plain: Item[] | null,
    left: { op: Comparison; items: Item[] } | null,
    right: { op: Comparison; items: Item[] } | null,
  ): MediaFeature | null {
    const { prefix, base } = splitFeatureName(name);
    const environment = isEnvironmentFeature(base);
    if (!environment && !isEvaluated(base)) return null;
    if (prefix !== null && (form !== 'plain' || (!environment && !RANGE_FEATURES.has(base)))) return null;
    // Blink 145 accepts a discrete feature in a range context and ignores the operator; MQ4 makes it invalid. Dragon refuses it.
    const discreteRange = form === 'range' && !environment && !RANGE_FEATURES.has(base);
    let refused: MediaFeature['refused'] = environment ? 'environment' : discreteRange ? 'value' : null;
    const value = (items: Item[]): MediaValue | null => {
      if (environment) return rawValue(base, items);
      if (discreteRange) {
        try {
          parseValue(base, items);
        } catch {
          return null;
        }
        return rawValue(base, items);
      }
      try {
        return parseValue(base, items);
      } catch (e) {
        if (e instanceof RefusedValue) {
          refused = 'value';
          return rawValue(base, items);
        }
        if (e instanceof InvalidValue) return null;
        throw e;
      }
    };
    const plainValue = plain === null ? null : value(plain);
    const leftValue = left === null ? null : value(left.items);
    const rightValue = right === null ? null : value(right.items);
    if ((plain !== null && plainValue === null) || (left !== null && leftValue === null) || (right !== null && rightValue === null)) return null;
    return {
      type: 'feature',
      name,
      prefix,
      base,
      form,
      value: plainValue,
      left: left === null ? null : { value: leftValue as MediaValue, op: left.op },
      right: right === null ? null : { op: right.op, value: rightValue as MediaValue },
      refused,
    };
  }
}

const isEvaluated = (base: string): boolean => EVALUATED_FEATURES.has(base);
const isFeatureName = (name: string): boolean => {
  const { base } = splitFeatureName(name);
  return isEvaluated(base) || isEnvironmentFeature(base);
};

function asCvs(items: readonly Item[]): ComponentValue[] {
  if (items.some((i) => i.kind === 'op')) throw new InvalidValue('comparison in a value');
  return items as ComponentValue[];
}

function parseValue(base: string, items: readonly Item[]): MediaValue {
  const cvs = asCvs(items);
  if (base === 'width' || base === 'height') {
    if (cvs.length !== 1) throw new InvalidValue('one length');
    return { kind: 'length', length: parseLength(cvs[0] as ComponentValue) };
  }
  if (base === 'aspect-ratio') {
    const ratio = parseRatio(cvs);
    if (ratio === null) throw new InvalidValue('ratio');
    if (ratio.num === 0 && ratio.den === 0) throw new RefusedValue('degenerate ratio');
    return { kind: 'ratio', ...ratio };
  }
  if (base === 'resolution' || base === '-webkit-device-pixel-ratio') {
    // Chrome 145 (measured): a negative <resolution> or one without a unit is invalid; -webkit-device-pixel-ratio takes any
    // <number> and no unit. calc() is not evaluated.
    const cv = cvs[0];
    if (cvs.length !== 1 || cv === undefined) throw new InvalidValue('one resolution');
    if (cv.kind === 'function') {
      if (asciiLower(cv.name) === 'calc') throw new RefusedValue('calc');
      throw new InvalidValue(cv.name);
    }
    if (cv.kind !== 'token') throw new InvalidValue('block');
    if (base === '-webkit-device-pixel-ratio') {
      if (cv.token.type !== 'number') throw new InvalidValue('number');
      return { kind: 'number', value: cv.token.value };
    }
    if (cv.token.type !== 'dimension' || cv.token.value < 0) throw new InvalidValue('resolution');
    const unit = asciiLower(cv.token.unit);
    if (!RESOLUTION_UNITS.includes(unit)) throw new InvalidValue(unit);
    // Chrome keeps a <resolution> within the float range (1e40dppx serialises as 3.40282e+38dppx).
    return { kind: 'resolution', value: Math.min(cv.token.value, FLOAT_MAX), unit: unit as ResolutionUnit };
  }
  if (cvs.length === 1) {
    const name = identOf(cvs[0]);
    const allowed = base === 'orientation' ? ['portrait', 'landscape'] : (DEVICE_KEYWORDS[base] ?? []);
    if (name !== null && allowed.includes(name)) return { kind: 'ident', name };
  }
  throw new InvalidValue(base);
}

function parseRatio(cvs: readonly ComponentValue[]): { num: number; den: number } | null {
  const num = (cv: ComponentValue | undefined): number | null =>
    cv !== undefined && cv.kind === 'token' && cv.token.type === 'number' && cv.token.value >= 0 ? cv.token.value : null;
  const a = num(cvs[0]);
  if (a === null) return null;
  if (cvs.length === 1) return { num: a, den: 1 };
  const slash = cvs[1];
  const b = num(cvs[2]);
  if (cvs.length !== 3 || slash === undefined || slash.kind !== 'token' || slash.token.type !== 'delim' || slash.token.value !== '/' || b === null) return null;
  return { num: a, den: b };
}

/** A value Dragon does not evaluate: a ratio for a ratio feature or for number/number, else the component values. */
function rawValue(base: string, items: readonly Item[]): MediaValue {
  const cvs = asCvs(items);
  const ratio = parseRatio(cvs);
  const isRatio = ratio !== null && (cvs.length === 3 || base.endsWith('aspect-ratio'));
  return { kind: 'raw', ratio: isRatio ? ratio : null, values: cvs };
}

function rawCv(cv: ComponentValue, fmt: NumberFormat): string {
  const inner = (cvs: readonly ComponentValue[]): string => cvs.filter((c) => !isWhitespace(c)).map((c) => rawCv(c, fmt)).join(' ');
  if (cv.kind === 'block') return `(${inner(cv.children)})`;
  if (cv.kind === 'function') return `${asciiLower(cv.name)}(${inner(cv.children)})`;
  const t = cv.token;
  if (t.type === 'number') return fmt(t.value);
  if (t.type === 'dimension') return `${fmt(t.value)}${asciiLower(t.unit)}`;
  if (t.type === 'percentage') return `${fmt(t.value)}%`;
  if (t.type === 'ident') return asciiLower(t.value);
  if (t.type === 'delim') return t.value;
  return '';
}

/** Parses a media query list from its text. */
export function parseMediaQueryList(text: string, faults: MediaFaults = NO_MEDIA_FAULTS): MediaQueryList {
  return new Parser(text, faults).list();
}

/** Parses the prelude of an @media rule as css-tree gives it: a Raw node keeps the authored text; other nodes are generated. */
export function parseMediaPrelude(prelude: CssNode, faults: MediaFaults = NO_MEDIA_FAULTS): MediaQueryList {
  const text = prelude.type === 'Raw' && typeof prelude['value'] === 'string' ? prelude['value'] : generate(prelude);
  return parseMediaQueryList(text, faults);
}

export function serialiseValue(v: MediaValue, fmt: NumberFormat = exactNumber): string {
  switch (v.kind) {
    case 'length':
      return serialiseLength(v.length, fmt);
    case 'ratio':
      return `${fmt(v.num)} / ${fmt(v.den)}`;
    case 'ident':
      return v.name;
    case 'resolution':
      return `${fmt(v.value)}${v.unit}`;
    case 'number':
      return fmt(v.value);
    case 'raw':
      return v.ratio !== null ? `${fmt(v.ratio.num)} / ${fmt(v.ratio.den)}` : v.values.map((c) => rawCv(c, fmt)).join(' ');
  }
}

export function serialiseFeature(f: MediaFeature, fmt: NumberFormat = exactNumber): string {
  if (f.form === 'boolean') return `(${f.name})`;
  if (f.form === 'plain') return `(${f.name}: ${serialiseValue(f.value as MediaValue, fmt)})`;
  const left = f.left === null ? '' : `${serialiseValue(f.left.value, fmt)} ${f.left.op} `;
  const right = f.right === null ? '' : ` ${f.right.op} ${serialiseValue(f.right.value, fmt)}`;
  return `(${left}${f.name}${right})`;
}

export function serialiseCondition(c: MediaCondition, fmt: NumberFormat = exactNumber): string {
  switch (c.type) {
    case 'feature':
      return serialiseFeature(c, fmt);
    case 'general-enclosed':
      return c.text;
    case 'parens':
      return `(${serialiseCondition(c.condition, fmt)})`;
    case 'not':
      return `not ${serialiseCondition(c.operand, fmt)}`;
    case 'and':
    case 'or':
      return c.operands.map((o) => serialiseCondition(o, fmt)).join(` ${c.type} `);
  }
}

export function serialiseMediaQuery(q: MediaQuery, fmt: NumberFormat = exactNumber): string {
  if (!q.valid) return 'not all';
  if (q.mediaType === null) return q.condition === null ? '' : serialiseCondition(q.condition, fmt);
  const cond = q.condition === null ? '' : serialiseCondition(q.condition, fmt);
  if (q.modifier === null && q.mediaType === 'all' && cond !== '') return cond;
  const head = q.modifier === null ? q.mediaType : `${q.modifier} ${q.mediaType}`;
  return cond === '' ? head : `${head} and ${cond}`;
}

/** Chrome's mediaText, with numbers written by fmt: exact by default, so the text evaluates as the authored query does. */
export function serialiseMediaQueryList(list: MediaQueryList, fmt: NumberFormat = exactNumber): string {
  return list.queries.map((q) => serialiseMediaQuery(q, fmt)).join(', ');
}

/** Every feature in a condition, in source order. */
export function featuresOf(c: MediaCondition): MediaFeature[] {
  switch (c.type) {
    case 'feature':
      return [c];
    case 'general-enclosed':
      return [];
    case 'parens':
      return featuresOf(c.condition);
    case 'not':
      return featuresOf(c.operand);
    case 'and':
    case 'or':
      return c.operands.flatMap(featuresOf);
  }
}

export function featuresOfList(list: MediaQueryList): MediaFeature[] {
  return list.queries.flatMap((q) => (q.valid && q.condition !== null ? featuresOf(q.condition) : []));
}
