// Runtime validator for LayoutInput. The schema's inferred type must equal the declared input types exactly.
import type { CalcExpr, LayoutBox, LayoutInput, LayoutStyle, TextLeaf } from './input.ts';

type NumberRule = { readonly t: 'number'; readonly min: number; readonly exclusiveMin: boolean; readonly integer: boolean };
type StringRule = { readonly t: 'string' };
type LiteralRule<V extends string> = { readonly t: 'literal'; readonly values: readonly V[] };
type ObjectRule = { readonly t: 'object'; readonly fields: { readonly [k: string]: Rule } };
type TaggedRule = { readonly t: 'tagged'; readonly variants: { readonly [kind: string]: { readonly [k: string]: Rule } } };
/**
 * The recursive CalcExpr tree, which Infer cannot derive: it is checked by hand (checkCalc). fontSize marks a specified font size
 * expression, whose root may be a font-percent or font-calc node and must be a length.
 */
type CalcRule = { readonly t: 'calc'; readonly fontSize: boolean };
type BooleanRule = { readonly t: 'boolean' };
type Rule = NumberRule | StringRule | LiteralRule<string> | ObjectRule | TaggedRule | CalcRule | BooleanRule;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type Infer<R> = R extends CalcRule
  ? CalcExpr
  : R extends BooleanRule
  ? boolean
  : R extends NumberRule
  ? number
  : R extends StringRule
    ? string
    : R extends LiteralRule<infer V>
      ? V
      : R extends { readonly t: 'object'; readonly fields: infer F }
        ? { readonly [K in keyof F]: Infer<F[K]> }
        : R extends { readonly t: 'tagged'; readonly variants: infer V }
          ? { [K in keyof V]: Simplify<{ readonly kind: K } & { readonly [P in keyof V[K]]: Infer<V[K][P]> }> }[keyof V]
          : never;

const num = (minimum: number): NumberRule => ({ t: 'number', min: minimum, exclusiveMin: false, integer: false });
const positive: NumberRule = { t: 'number', min: 0, exclusiveMin: true, integer: false };
const anyNum: NumberRule = { t: 'number', min: -Infinity, exclusiveMin: false, integer: false };
const int: NumberRule = { t: 'number', min: -Infinity, exclusiveMin: false, integer: true };
const str: StringRule = { t: 'string' };
function lit<const V extends string>(...values: V[]): LiteralRule<V> {
  return { t: 'literal', values };
}
function obj<const F extends { readonly [k: string]: Rule }>(fields: F): { readonly t: 'object'; readonly fields: F } {
  return { t: 'object', fields };
}
function tagged<const V extends { readonly [kind: string]: { readonly [k: string]: Rule } }>(
  variants: V,
): { readonly t: 'tagged'; readonly variants: V } {
  return { t: 'tagged', variants };
}

const px = (minimum: number) => ({ px: { value: num(minimum) } }) as const;
const percent = (minimum: number) => ({ percent: { value: num(minimum) } }) as const;
const auto = { auto: {} } as const;

const calcExpr: CalcRule = { t: 'calc', fontSize: false };
const fontSizeExpr: CalcRule = { t: 'calc', fontSize: true };
const bool: BooleanRule = { t: 'boolean' };
const calc = { calc: { expr: calcExpr, range: lit('all', 'non-negative') } } as const;

const size = tagged({ ...px(0), ...percent(0), ...auto, ...calc });
const maxSize = tagged({ ...px(0), ...percent(0), none: {}, ...calc });
const margin = tagged({ px: { value: anyNum }, percent: { value: anyNum }, ...auto, ...calc });
const inset = tagged({ px: { value: anyNum }, percent: { value: anyNum }, ...auto, ...calc });
const padding = tagged({ ...px(0), ...percent(0), ...calc });
// R5: an initial line width is typed in device px by the compiler (Chrome stores it unzoomed); only the four border widths take it.
const border = tagged({ ...px(0), 'device-px': { value: num(0) }, ...calc });
const gap = tagged({ ...px(0), ...percent(0), normal: {}, ...calc });
// A layout ratio is two raw LayoutUnit values, positive integers (StyleAspectRatio::GetLayoutRatio).
const rawRatio = { width: { t: 'number', min: 1, exclusiveMin: false, integer: true }, height: { t: 'number', min: 1, exclusiveMin: false, integer: true } } as const;
const aspectRatio = tagged({ ...auto, ratio: rawRatio, 'auto-ratio': rawRatio });

const justify = lit(
  'normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly',
  'stretch', 'start', 'end', 'left', 'right',
);
const alignItemsValues = [
  'normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end',
] as const;

export const styleSchema = obj({
  display: lit('block', 'flex'),
  position: lit('static', 'relative', 'absolute'),
  top: inset,
  right: inset,
  bottom: inset,
  left: inset,
  overflowX: lit('visible', 'hidden'),
  overflowY: lit('visible', 'hidden'),
  direction: lit('ltr', 'rtl'),
  boxSizing: lit('content-box', 'border-box'),
  width: size,
  height: size,
  minWidth: size,
  minHeight: size,
  maxWidth: maxSize,
  maxHeight: maxSize,
  marginTop: margin,
  marginRight: margin,
  marginBottom: margin,
  marginLeft: margin,
  paddingTop: padding,
  paddingRight: padding,
  paddingBottom: padding,
  paddingLeft: padding,
  borderTopWidth: border,
  borderRightWidth: border,
  borderBottomWidth: border,
  borderLeftWidth: border,
  flexDirection: lit('row', 'row-reverse', 'column', 'column-reverse'),
  flexWrap: lit('nowrap', 'wrap', 'wrap-reverse'),
  flexGrow: num(0),
  flexShrink: num(0),
  flexBasis: tagged({ ...px(0), ...percent(0), ...auto, content: {}, ...calc }),
  order: int,
  justifyContent: justify,
  alignItems: lit(...alignItemsValues),
  alignSelf: lit('auto', ...alignItemsValues),
  alignContent: lit(
    'normal', 'stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly',
    'baseline', 'start', 'end',
  ),
  rowGap: gap,
  columnGap: gap,
  textAlign: lit('start', 'end', 'left', 'right', 'center', 'justify'),
  aspectRatio,
});

/** css-fonts-4 §2: a font with its specified size expression (input.ts FontSpec). */
export const fontSpecSchema = obj({ family: lit('Ahem'), size: num(0), specifiedSize: fontSizeExpr, absoluteSize: bool });

/** CSS2 §10.8.1: line-height is non-negative; a percentage is of the font size, and a calculation, clamped to 0, may hold one. */
export const lineHeightSchema = tagged({ normal: {}, number: { value: num(0) }, px: { value: num(0) }, percent: { value: num(0) }, calc: { expr: calcExpr, range: lit('non-negative') } });

export const textLeafSchema = obj({
  kind: lit('text'),
  id: str,
  text: str,
  font: fontSpecSchema,
  lineHeight: lineHeightSchema,
  whiteSpaceCollapse: lit('collapse'),
  textWrapMode: lit('wrap', 'nowrap'),
});

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type SchemaMatchesStyle = Assert<Equal<Infer<typeof styleSchema>, LayoutStyle>>;
export type SchemaMatchesText = Assert<Equal<Infer<typeof textLeafSchema>, TextLeaf>>;

export type ValidationErrorCode =
  | 'missing-key'
  | 'extra-key'
  | 'wrong-type'
  | 'unknown-tag'
  | 'bad-value'
  | 'duplicate-id'
  | 'mixed-children'
  | 'text-in-flex'
  | 'uncollapsed-text'
  | 'anonymous-shape';

export type ValidationError = { readonly path: string; readonly code: ValidationErrorCode; readonly message: string };

export type ValidationResult =
  | { readonly ok: true; readonly input: LayoutInput }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkFields(
  value: Record<string, unknown>,
  fields: { readonly [k: string]: Rule },
  path: string,
  errors: ValidationError[],
  allowed: readonly string[],
): void {
  for (const key of Object.keys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push({ path: `${path}.${key}`, code: 'missing-key', message: `missing required key "${key}"` });
      continue;
    }
    const rule = fields[key];
    if (rule !== undefined) checkRule(value[key], rule, `${path}.${key}`, errors);
  }
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key) && !allowed.includes(key)) {
      errors.push({ path: `${path}.${key}`, code: 'extra-key', message: `unexpected key "${key}"` });
    }
  }
}

const CALC_FIELDS: { readonly [kind: string]: readonly string[] } = {
  px: ['value'],
  percent: ['value'],
  number: ['value'],
  viewport: ['value', 'axis', 'size'],
  em: ['value', 'fontSize'],
  rem: ['value'],
  'font-metric': ['value', 'metric', 'font'],
  lh: ['value', 'font', 'lineHeight'],
  env: ['value', 'side'],
  'font-percent': ['value', 'parent'],
  'font-calc': ['expr', 'parent'],
  sum: ['terms'],
  product: ['terms'],
  invert: ['term'],
  min: ['terms'],
  max: ['terms'],
  clamp: ['min', 'value', 'max'],
  'pixels-and-percent': ['pixels', 'percent', 'explicitPixels', 'explicitPercent'],
};

// css-values-4 §10: a calculation tree. Every number is finite, operator lists are non-empty, and every key is present. A
// font-percent or font-calc node stands only at the root of a specified font size (fontSize), and nowhere else.
function checkCalc(value: unknown, path: string, errors: ValidationError[], fontSize: boolean): void {
  if (!isRecord(value)) {
    errors.push({ path, code: 'wrong-type', message: 'expected a calculation node' });
    return;
  }
  const kind = value['kind'];
  const fields = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(CALC_FIELDS, kind) ? CALC_FIELDS[kind] : undefined;
  if (fields === undefined) {
    errors.push({ path: `${path}.kind`, code: 'unknown-tag', message: `expected kind ${Object.keys(CALC_FIELDS).join(' | ')}` });
    return;
  }
  if (!fontSize && (kind === 'font-percent' || kind === 'font-calc')) {
    errors.push({ path: `${path}.kind`, code: 'bad-value', message: `a ${kind} node stands only at the root of a specified font size` });
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'kind' && !fields.includes(key)) errors.push({ path: `${path}.${key}`, code: 'extra-key', message: `unexpected key "${key}"` });
  }
  for (const key of fields) {
    const at = `${path}.${key}`;
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push({ path: at, code: 'missing-key', message: `missing required key "${key}"` });
      continue;
    }
    const v = value[key];
    if (key === 'axis') checkRule(v, lit('width', 'height', 'min', 'max'), at, errors);
    else if (key === 'size') checkRule(v, lit('small', 'large', 'dynamic'), at, errors);
    else if (key === 'metric') checkRule(v, lit('ex', 'ch', 'cap'), at, errors);
    else if (key === 'side') checkRule(v, lit('top', 'right', 'bottom', 'left'), at, errors);
    else if (key === 'font') checkRule(v, fontSpecSchema, at, errors);
    else if (key === 'lineHeight') checkRule(v, lineHeightSchema, at, errors);
    else if (key === 'explicitPixels' || key === 'explicitPercent') {
      if (typeof v !== 'boolean') errors.push({ path: at, code: 'wrong-type', message: 'expected a boolean' });
    } else if (key === 'terms') {
      if (!Array.isArray(v) || v.length === 0) errors.push({ path: at, code: 'wrong-type', message: 'expected a non-empty array of calculation nodes' });
      else v.forEach((t: unknown, i: number) => checkCalc(t, `${at}[${i}]`, errors, false));
    } else if (key === 'fontSize' || key === 'parent') checkCalc(v, at, errors, true);
    else if (key === 'term' || key === 'min' || key === 'max' || key === 'expr' || (key === 'value' && kind === 'clamp')) checkCalc(v, at, errors, false);
    // css-fonts-4 §2.5: a negative font-size percentage is invalid.
    else checkRule(v, kind === 'font-percent' ? num(0) : anyNum, at, errors);
  }
}

type CalcCategory = 'number' | 'length' | 'percent' | 'length-percent';

/** Joins the categories of a sum or comparison's operands; null when a number meets a length or percentage. */
function joinCategories(cs: readonly CalcCategory[]): CalcCategory | null {
  const first = cs[0] as CalcCategory;
  let out: CalcCategory = first;
  for (const c of cs) {
    if ((c === 'number') !== (first === 'number')) return null;
    if (c !== out) out = 'length-percent';
  }
  return out;
}

// css-values-4 §10.9 type checking of a well-formed tree: sums and comparisons do not mix numbers with lengths, a product has at
// most one factor that is not a number, only a number is inverted, and an em leaf's font size is a length without a percentage.
function calcCategory(e: CalcExpr, path: string, errors: ValidationError[]): CalcCategory | null {
  const bad = (message: string): null => {
    errors.push({ path, code: 'bad-value', message });
    return null;
  };
  switch (e.kind) {
    case 'px':
    case 'viewport':
    case 'rem':
    case 'font-metric':
    case 'lh':
    case 'env':
      return 'length';
    case 'font-percent':
      return calcCategory(e.parent, `${path}.parent`, errors) === 'length' ? 'length' : bad('a parent font size must be a length without a percentage');
    case 'font-calc': {
      const parent = calcCategory(e.parent, `${path}.parent`, errors);
      const own = calcCategory(e.expr, `${path}.expr`, errors);
      if (parent !== 'length') return bad('a parent font size must be a length without a percentage');
      return own === 'percent' || own === 'length-percent' ? 'length' : bad('a font-calc holds a percentage of the parent font size');
    }
    case 'percent':
      return 'percent';
    case 'number':
      return 'number';
    case 'pixels-and-percent':
      return e.explicitPercent ? (e.explicitPixels ? 'length-percent' : 'percent') : 'length';
    case 'em':
      return calcCategory(e.fontSize, `${path}.fontSize`, errors) === 'length' ? 'length' : bad('an em font size must be a length without a percentage');
    case 'invert':
      return calcCategory(e.term, `${path}.term`, errors) === 'number' ? 'number' : bad('only a number can be inverted');
    case 'product': {
      const cs = e.terms.map((t, i) => calcCategory(t, `${path}.terms[${i}]`, errors));
      if (cs.includes(null)) return null;
      const dims = cs.filter((c) => c !== 'number') as CalcCategory[];
      if (dims.length > 1) return bad('a product may have only one factor that is not a number');
      return dims.length === 0 ? 'number' : (dims[0] as CalcCategory);
    }
    case 'sum':
    case 'min':
    case 'max':
    case 'clamp': {
      const operands = e.kind === 'clamp' ? [e.min, e.value, e.max] : e.terms;
      const cs = operands.map((t, i) => calcCategory(t, `${path}.${e.kind === 'clamp' ? ['min', 'value', 'max'][i] : `terms[${i}]`}`, errors));
      if (cs.includes(null)) return null;
      const joined = joinCategories(cs as CalcCategory[]);
      return joined === null ? bad(`a ${e.kind} may not mix numbers with lengths or percentages`) : joined;
    }
  }
}

function checkRule(value: unknown, rule: Rule, path: string, errors: ValidationError[]): void {
  switch (rule.t) {
    case 'calc': {
      const before = errors.length;
      checkCalc(value, path, errors, rule.fontSize);
      if (errors.length !== before) return;
      const category = calcCategory(value as CalcExpr, path, errors);
      if (category === 'number') errors.push({ path, code: 'bad-value', message: 'a length calculation must not resolve to a number' });
      else if (rule.fontSize && category !== null && category !== 'length') errors.push({ path, code: 'bad-value', message: 'a specified font size holds a percentage only in a font-percent or font-calc node' });
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') errors.push({ path, code: 'wrong-type', message: 'expected a boolean' });
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ path, code: 'wrong-type', message: 'expected a finite number' });
      } else if (value < rule.min || (rule.exclusiveMin && value === rule.min)) {
        errors.push({ path, code: 'bad-value', message: `expected a number ${rule.exclusiveMin ? '>' : '>='} ${rule.min}` });
      } else if (rule.integer && !Number.isInteger(value)) {
        errors.push({ path, code: 'bad-value', message: 'expected an integer' });
      }
      return;
    case 'string':
      if (typeof value !== 'string') errors.push({ path, code: 'wrong-type', message: 'expected a string' });
      return;
    case 'literal':
      if (typeof value !== 'string' || !rule.values.includes(value)) {
        errors.push({ path, code: 'bad-value', message: `expected one of ${rule.values.join(', ')}` });
      }
      return;
    case 'object':
      if (!isRecord(value)) {
        errors.push({ path, code: 'wrong-type', message: 'expected an object' });
        return;
      }
      checkFields(value, rule.fields, path, errors, []);
      return;
    case 'tagged': {
      if (!isRecord(value)) {
        errors.push({ path, code: 'wrong-type', message: 'expected a tagged object' });
        return;
      }
      const kind = value['kind'];
      const variant = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(rule.variants, kind)
        ? rule.variants[kind]
        : undefined;
      if (variant === undefined) {
        errors.push({
          path: `${path}.kind`,
          code: 'unknown-tag',
          message: `expected kind ${Object.keys(rule.variants).join(' | ')}`,
        });
        return;
      }
      checkFields(value, variant, path, errors, ['kind']);
      return;
    }
  }
}

function checkNode(value: unknown, path: string, errors: ValidationError[], ids: Set<string>, parentId: string | null): void {
  if (!isRecord(value)) {
    errors.push({ path, code: 'wrong-type', message: 'expected a box or text object' });
    return;
  }
  const id = value['id'];
  if (typeof id === 'string') {
    if (ids.has(id)) errors.push({ path: `${path}.id`, code: 'duplicate-id', message: `duplicate id "${id}"` });
    ids.add(id);
  }
  if (value['kind'] === 'text') {
    checkRule(value, textLeafSchema, path, errors);
    return;
  }
  if (value['kind'] !== 'box') {
    errors.push({ path: `${path}.kind`, code: 'unknown-tag', message: 'expected kind box | text' });
    return;
  }
  checkFields(value, { id: str, boxType: lit('element', 'anonymous'), style: styleSchema }, path, errors, ['kind', 'children']);
  if (!Object.prototype.hasOwnProperty.call(value, 'children')) {
    errors.push({ path: `${path}.children`, code: 'missing-key', message: 'missing required key "children"' });
    return;
  }
  const children = value['children'];
  if (!Array.isArray(children)) {
    errors.push({ path: `${path}.children`, code: 'wrong-type', message: 'expected an array' });
    return;
  }
  children.forEach((child: unknown, i: number) => checkNode(child, `${path}.children[${i}]`, errors, ids, typeof id === 'string' ? id : null));
  checkInlineContent(value, children, path, errors);
  const style = value['style'];
  if (isRecord(style) && style['overflowX'] !== style['overflowY']) {
    errors.push({ path: `${path}.style.overflowY`, code: 'bad-value', message: 'overflowX and overflowY must be equal: css-overflow-3 §3.1 computes visible beside hidden to auto' });
  }
  if (value['boxType'] === 'anonymous') checkAnonymous(value, children, path, errors, parentId);
  if (isRecord(style)) checkRatioBlockLengths(style, path, errors);
}

/** A length that holds a percentage: a percentage, or a calculation with one. */
function holdsPercent(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (v['kind'] === 'percent') return true;
  return v['kind'] === 'calc' && exprHoldsPercent(v['expr']);
}

/**
 * calc.ts calcHasPercent over an expression not yet known to be well formed: a percentage leaf, a pixels-and-percent leaf with an
 * explicit percentage, or either inside invert, clamp and the term lists; font-size calculations hold no basis percentage.
 */
function exprHoldsPercent(e: unknown): boolean {
  if (!isRecord(e)) return false;
  switch (e['kind']) {
    case 'percent':
      return true;
    case 'pixels-and-percent':
      return e['explicitPercent'] === true;
    case 'invert':
      return exprHoldsPercent(e['term']);
    case 'clamp':
      return exprHoldsPercent(e['min']) || exprHoldsPercent(e['value']) || exprHoldsPercent(e['max']);
    case 'sum':
    case 'product':
    case 'min':
    case 'max':
      return Array.isArray(e['terms']) && e['terms'].some(exprHoldsPercent);
    default:
      return false;
  }
}

// css-sizing-4 §5.1: a ratio transfers the block size before layout knows its percentage basis in every context, so Dragon
// refuses a percentage height, min-height or max-height beside an aspect-ratio (the compiler reports it).
function checkRatioBlockLengths(style: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  const ratio = style['aspectRatio'];
  if (!isRecord(ratio) || ratio['kind'] === 'auto') return;
  // The parts are raw LayoutUnits (int), which keeps units.ts mulDiv exact.
  for (const part of ['width', 'height']) {
    const v = ratio[part];
    if (typeof v === 'number' && v > 2147483647) errors.push({ path: `${path}.style.aspectRatio.${part}`, code: 'bad-value', message: 'a layout ratio part is a raw LayoutUnit, at most 2147483647' });
  }
  for (const key of ['height', 'minHeight', 'maxHeight']) {
    if (holdsPercent(style[key])) errors.push({ path: `${path}.style.${key}`, code: 'bad-value', message: `a percentage ${key} beside an aspect-ratio is not supported` });
  }
}

/** CSS2 §9.2.1.1 and css-flexbox-1 §4: the initial value of every non-inherited LayoutStyle field an anonymous box must carry. */
const ANONYMOUS_INITIAL: { readonly [K in Exclude<keyof LayoutStyle, 'direction' | 'textAlign'>]: LayoutStyle[K] } = {
  display: 'block',
  position: 'static',
  top: { kind: 'auto' },
  right: { kind: 'auto' },
  bottom: { kind: 'auto' },
  left: { kind: 'auto' },
  overflowX: 'visible',
  overflowY: 'visible',
  boxSizing: 'content-box',
  width: { kind: 'auto' },
  height: { kind: 'auto' },
  minWidth: { kind: 'auto' },
  minHeight: { kind: 'auto' },
  maxWidth: { kind: 'none' },
  maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 },
  marginRight: { kind: 'px', value: 0 },
  marginBottom: { kind: 'px', value: 0 },
  marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 },
  paddingRight: { kind: 'px', value: 0 },
  paddingBottom: { kind: 'px', value: 0 },
  paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 },
  borderRightWidth: { kind: 'px', value: 0 },
  borderBottomWidth: { kind: 'px', value: 0 },
  borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row',
  flexWrap: 'nowrap',
  flexGrow: 0,
  flexShrink: 1,
  flexBasis: { kind: 'auto' },
  order: 0,
  justifyContent: 'normal',
  alignItems: 'normal',
  alignSelf: 'auto',
  alignContent: 'normal',
  rowGap: { kind: 'normal' },
  columnGap: { kind: 'normal' },
  aspectRatio: { kind: 'auto' },
};

// CSS2 §9.2.1.1 and css-flexbox-1 §4: an anonymous box wraps a run of text only. It holds at least one text leaf and no box, its
// id is "<parent id>:anon<k>", and it inherits direction and text-align while every other field is its initial value.
function checkAnonymous(box: Record<string, unknown>, children: readonly unknown[], path: string, errors: ValidationError[], parentId: string | null): void {
  const bad = (message: string): void => {
    errors.push({ path, code: 'anonymous-shape', message });
  };
  if (children.length === 0 || !children.every((c) => isRecord(c) && c['kind'] === 'text')) bad('an anonymous box holds one or more text leaves and no boxes');
  const id = box['id'];
  if (parentId === null || typeof id !== 'string' || !new RegExp(`^${escapeRegExp(parentId)}:anon\\d+$`).test(id)) bad('an anonymous box id is "<parent id>:anon<k>"');
  const style = box['style'];
  if (!isRecord(style)) return;
  for (const [key, initial] of Object.entries(ANONYMOUS_INITIAL)) {
    if (JSON.stringify(style[key]) !== JSON.stringify(initial)) bad(`an anonymous box takes the initial ${key} (${JSON.stringify(initial)}), not ${JSON.stringify(style[key])}`);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const UNCOLLAPSED = /[\t\n\r\f]| {2}/;

// CSS2 §9.2.1.1, css-flexbox-1 §4 and css-text-3 §4.1.1: the compiler wraps text beside boxes, and text in a flex container, in
// anonymous boxes, and applies white-space phase I collapsing; the engine never does either.
function checkInlineContent(box: Record<string, unknown>, children: readonly unknown[], path: string, errors: ValidationError[]): void {
  const texts = children.filter((c): c is Record<string, unknown> => isRecord(c) && c['kind'] === 'text');
  if (texts.length === 0) return;
  if (texts.length !== children.length) {
    errors.push({ path: `${path}.children`, code: 'mixed-children', message: 'a box has either text children or box children; wrap the text in anonymous boxes' });
  }
  const style = box['style'];
  if (isRecord(style) && style['display'] === 'flex') {
    errors.push({ path: `${path}.children`, code: 'text-in-flex', message: 'text directly in a flex container must be wrapped in an anonymous flex item' });
  }
  const strings = texts.map((t) => t['text']).filter((t): t is string => typeof t === 'string');
  if (strings.length !== texts.length || !texts.every((t) => t['whiteSpaceCollapse'] === 'collapse')) return;
  const joined = strings.join('');
  if (strings.some((t) => t === '') || UNCOLLAPSED.test(joined) || joined.startsWith(' ') || joined.endsWith(' ')) {
    errors.push({ path: `${path}.children`, code: 'uncollapsed-text', message: 'white-space-collapse: collapse text must arrive collapsed: no empty runs, tabs, segment breaks, doubled spaces or edge spaces' });
  }
}

/** Rejects missing keys, extra keys, wrong tags, out-of-range numbers and duplicate ids. */
export function validateLayoutInput(json: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isRecord(json)) {
    return { ok: false, errors: [{ path: '$', code: 'wrong-type', message: 'expected an object' }] };
  }
  const viewport = obj({ width: num(0), height: num(0) });
  checkFields(
    json,
    {
      viewport,
      devicePixelRatio: positive,
      viewportUnits: obj({ small: viewport, large: viewport, dynamic: viewport }),
      safeArea: obj({ top: num(0), right: num(0), bottom: num(0), left: num(0) }),
      rootFontSize: num(0),
    },
    '$',
    errors,
    ['root'],
  );
  if (!Object.prototype.hasOwnProperty.call(json, 'root')) {
    errors.push({ path: '$.root', code: 'missing-key', message: 'missing required key "root"' });
  } else {
    checkNode(json['root'], '$.root', errors, new Set(), null);
    const root = json['root'];
    if (isRecord(root) && root['kind'] !== 'box') {
      errors.push({ path: '$.root.kind', code: 'bad-value', message: 'the root must be a box' });
    }
    // CSS2 §10.1: the root box is laid out in the initial containing block; the engine places it in flow.
    if (isRecord(root) && isRecord(root['style']) && root['style']['position'] === 'absolute') {
      errors.push({ path: '$.root.style.position', code: 'bad-value', message: 'the root box cannot be absolutely positioned' });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, input: json as LayoutInput };
}

export type { LayoutBox };
