// Media query lengths: px, em and rem, and calc() over them. em and rem use the initial font size, never the root's.
import { asciiLower } from '../css/escapes.ts';
import { exactNumber } from './number.ts';
import type { NumberFormat } from './number.ts';
import type { ComponentValue, Token } from './tokens.ts';
import { isWhitespace } from './tokens.ts';

export type LengthUnit = 'em' | 'px' | 'rem';
/** Serialisation order of calc() sum terms: dimensions by unit name. */
const UNIT_ORDER: readonly LengthUnit[] = ['em', 'px', 'rem'];

/** The initial font size, in CSS px, that em and rem resolve against in a media query. */
export const INITIAL_FONT_SIZE = 16;

export type MediaLength = {
  /** The sum of the terms, by unit; a unit present with 0 is kept because Chrome serialises it. */
  readonly terms: Readonly<Partial<Record<LengthUnit, number>>>;
  /** Written with calc() (or a nested math function Chrome folds into calc). */
  readonly calc: boolean;
  /** Written as a unitless 0, which Chrome serialises as "0". */
  readonly unitless: boolean;
};

/** Every length unit Chrome accepts; Dragon evaluates only px, em and rem. */
const OTHER_LENGTH_UNITS = new Set([
  'cm', 'mm', 'q', 'in', 'pt', 'pc', 'ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric', 'lh', 'rlh',
  'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax', 'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax',
  'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax', 'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax',
]);

/** A value Chrome accepts but Dragon does not evaluate (another unit, a math function other than calc, a non-finite result). */
export class RefusedValue extends Error {}
/** A value Chrome rejects: the feature falls back to <general-enclosed>. */
export class InvalidValue extends Error {}

export function resolveLength(length: MediaLength, emBase: number): number {
  const t = length.terms;
  return (t.px ?? 0) + (t.em ?? 0) * emBase + (t.rem ?? 0) * emBase;
}

export function serialiseLength(length: MediaLength, fmt: NumberFormat = exactNumber): string {
  if (length.unitless) return '0';
  const units = UNIT_ORDER.filter((u) => length.terms[u] !== undefined);
  if (!length.calc) {
    const u = units[0] as LengthUnit;
    return `${fmt(length.terms[u] as number)}${u}`;
  }
  let s = '';
  units.forEach((u, k) => {
    const v = length.terms[u] as number;
    if (k === 0) s += `${fmt(v)}${u}`;
    else s += `${v < 0 ? ' - ' : ' + '}${fmt(Math.abs(v))}${u}`;
  });
  return `calc(${s})`;
}

type Calc = { readonly kind: 'number'; readonly n: number } | { readonly kind: 'length'; readonly terms: Partial<Record<LengthUnit, number>> };

function dimension(token: Token & { type: 'dimension' }): Calc {
  const unit = asciiLower(token.unit);
  if (unit === 'px' || unit === 'em' || unit === 'rem') return { kind: 'length', terms: { [unit]: token.value } };
  if (OTHER_LENGTH_UNITS.has(unit)) throw new RefusedValue(unit);
  throw new InvalidValue(unit);
}

function calcSum(cvs: readonly ComponentValue[]): Calc {
  // Split on + and - with whitespace on both sides; each part is a product.
  const parts: { sign: 1 | -1; cvs: ComponentValue[] }[] = [{ sign: 1, cvs: [] }];
  cvs.forEach((cv, k) => {
    const op = cv.kind === 'token' && cv.token.type === 'delim' && (cv.token.value === '+' || cv.token.value === '-') ? cv.token.value : null;
    const prev = cvs[k - 1];
    const next = cvs[k + 1];
    if (op !== null && prev !== undefined && next !== undefined && isWhitespace(prev) && isWhitespace(next)) parts.push({ sign: op === '+' ? 1 : -1, cvs: [] });
    else (parts[parts.length - 1] as { cvs: ComponentValue[] }).cvs.push(cv);
  });
  let acc: Calc | null = null;
  for (const part of parts) {
    const v = scale(calcProduct(part.cvs.filter((cv) => !isWhitespace(cv))), part.sign);
    if (acc === null) acc = v;
    else if (acc.kind === 'number' && v.kind === 'number') acc = { kind: 'number', n: acc.n + v.n };
    else if (acc.kind === 'length' && v.kind === 'length') {
      const terms: Partial<Record<LengthUnit, number>> = { ...acc.terms };
      for (const u of UNIT_ORDER) if (v.terms[u] !== undefined) terms[u] = (terms[u] ?? 0) + (v.terms[u] as number);
      acc = { kind: 'length', terms };
    } else throw new InvalidValue('calc type mismatch');
  }
  if (acc === null) throw new InvalidValue('empty calc');
  return acc;
}

function scale(v: Calc, k: number): Calc {
  if (v.kind === 'number') return { kind: 'number', n: v.n * k };
  const terms: Partial<Record<LengthUnit, number>> = {};
  for (const u of UNIT_ORDER) if (v.terms[u] !== undefined) terms[u] = (v.terms[u] as number) * k;
  return { kind: 'length', terms };
}

function calcProduct(cvs: readonly ComponentValue[]): Calc {
  if (cvs.length === 0) throw new InvalidValue('missing calc operand');
  let acc = calcValue(cvs[0] as ComponentValue);
  for (let k = 1; k < cvs.length; k += 2) {
    const op = cvs[k] as ComponentValue;
    const rhsCv = cvs[k + 1];
    if (op.kind !== 'token' || op.token.type !== 'delim' || (op.token.value !== '*' && op.token.value !== '/') || rhsCv === undefined) {
      throw new InvalidValue('calc operator');
    }
    const rhs = calcValue(rhsCv);
    if (op.token.value === '*') {
      if (acc.kind === 'number') acc = scale(rhs, acc.n);
      else if (rhs.kind === 'number') acc = scale(acc, rhs.n);
      else throw new InvalidValue('length * length');
    } else {
      if (rhs.kind !== 'number') throw new InvalidValue('division by a length');
      acc = scale(acc, 1 / rhs.n);
    }
  }
  return acc;
}

function calcValue(cv: ComponentValue): Calc {
  if (cv.kind === 'token') {
    const t = cv.token;
    if (t.type === 'number') return { kind: 'number', n: t.value };
    if (t.type === 'dimension') return dimension(t);
    if (t.type === 'ident') throw new RefusedValue(`calc keyword ${t.value}`);
    throw new InvalidValue(t.type);
  }
  if (cv.kind === 'block') {
    if (cv.open !== '(') throw new InvalidValue('block');
    return calcSum(cv.children);
  }
  const name = asciiLower(cv.name);
  if (name === 'calc') return calcSum(cv.children);
  if (MATH_FUNCTIONS.has(name)) throw new RefusedValue(name);
  throw new InvalidValue(name);
}

const MATH_FUNCTIONS = new Set(['min', 'max', 'clamp', 'round', 'mod', 'rem', 'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'sqrt', 'hypot', 'log', 'exp']);

/**
 * Parses one component value as a media length. A literal 0 is a length; calc() must resolve to a length.
 * Throws InvalidValue when Chrome rejects it and RefusedValue when Chrome accepts it but Dragon does not evaluate it.
 */
export function parseLength(cv: ComponentValue): MediaLength {
  if (cv.kind === 'token') {
    if (cv.token.type === 'number' && cv.token.value === 0) return { terms: { px: 0 }, calc: false, unitless: true };
    if (cv.token.type === 'dimension') {
      const d = dimension(cv.token);
      return { terms: (d as Calc & { kind: 'length' }).terms, calc: false, unitless: false };
    }
    throw new InvalidValue(cv.token.type);
  }
  if (cv.kind === 'function') {
    const name = asciiLower(cv.name);
    if (name !== 'calc') {
      if (MATH_FUNCTIONS.has(name)) throw new RefusedValue(name);
      throw new InvalidValue(name);
    }
    const v = calcSum(cv.children);
    if (v.kind !== 'length') throw new InvalidValue('calc is not a length');
    for (const u of UNIT_ORDER) {
      const x = v.terms[u];
      if (x !== undefined && !Number.isFinite(x)) throw new RefusedValue('non-finite calc');
    }
    return { terms: v.terms, calc: true, unitless: false };
  }
  throw new InvalidValue('block');
}
