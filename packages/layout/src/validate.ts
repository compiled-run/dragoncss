// Runtime validator for LayoutInput. The schema's inferred type must equal the declared input types exactly.
import type { LayoutBox, LayoutInput, LayoutStyle, TextLeaf } from './input.ts';

type NumberRule = { readonly t: 'number'; readonly min: number; readonly integer: boolean };
type StringRule = { readonly t: 'string' };
type LiteralRule<V extends string> = { readonly t: 'literal'; readonly values: readonly V[] };
type ObjectRule = { readonly t: 'object'; readonly fields: { readonly [k: string]: Rule } };
type TaggedRule = { readonly t: 'tagged'; readonly variants: { readonly [kind: string]: { readonly [k: string]: Rule } } };
type Rule = NumberRule | StringRule | LiteralRule<string> | ObjectRule | TaggedRule;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type Infer<R> = R extends NumberRule
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

const num = (minimum: number): NumberRule => ({ t: 'number', min: minimum, integer: false });
const anyNum: NumberRule = { t: 'number', min: -Infinity, integer: false };
const int: NumberRule = { t: 'number', min: -Infinity, integer: true };
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

const size = tagged({ ...px(0), ...percent(0), ...auto });
const maxSize = tagged({ ...px(0), ...percent(0), none: {} });
const margin = tagged({ px: { value: anyNum }, percent: { value: anyNum }, ...auto });
const padding = tagged({ ...px(0), ...percent(0) });
const border = tagged({ ...px(0) });
const gap = tagged({ ...px(0), ...percent(0), normal: {} });

const justify = lit(
  'normal', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly',
  'stretch', 'start', 'end', 'left', 'right',
);
const alignItemsValues = [
  'normal', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline', 'start', 'end', 'self-start', 'self-end',
] as const;

export const styleSchema = obj({
  display: lit('block', 'flex', 'none'),
  position: lit('static'),
  overflowX: lit('visible'),
  overflowY: lit('visible'),
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
  flexBasis: tagged({ ...px(0), ...percent(0), ...auto, content: {} }),
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
});

export const textLeafSchema = obj({
  kind: lit('text'),
  id: str,
  text: str,
  font: obj({ family: lit('Ahem'), size: num(0) }),
  lineHeight: tagged({ normal: {}, number: { value: num(0) }, px: { value: num(0) } }),
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
  | 'duplicate-id';

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

function checkRule(value: unknown, rule: Rule, path: string, errors: ValidationError[]): void {
  switch (rule.t) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ path, code: 'wrong-type', message: 'expected a finite number' });
      } else if (value < rule.min) {
        errors.push({ path, code: 'bad-value', message: `expected a number >= ${rule.min}` });
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

function checkNode(value: unknown, path: string, errors: ValidationError[], ids: Set<string>): void {
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
  checkFields(value, { id: str, style: styleSchema }, path, errors, ['kind', 'children']);
  if (!Object.prototype.hasOwnProperty.call(value, 'children')) {
    errors.push({ path: `${path}.children`, code: 'missing-key', message: 'missing required key "children"' });
    return;
  }
  const children = value['children'];
  if (!Array.isArray(children)) {
    errors.push({ path: `${path}.children`, code: 'wrong-type', message: 'expected an array' });
    return;
  }
  children.forEach((child: unknown, i: number) => checkNode(child, `${path}.children[${i}]`, errors, ids));
}

/** Rejects missing keys, extra keys, wrong tags, out-of-range numbers and duplicate ids. */
export function validateLayoutInput(json: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  if (!isRecord(json)) {
    return { ok: false, errors: [{ path: '$', code: 'wrong-type', message: 'expected an object' }] };
  }
  checkFields(json, { viewport: obj({ width: num(0), height: num(0) }) }, '$', errors, ['root']);
  if (!Object.prototype.hasOwnProperty.call(json, 'root')) {
    errors.push({ path: '$.root', code: 'missing-key', message: 'missing required key "root"' });
  } else {
    checkNode(json['root'], '$.root', errors, new Set());
    if (isRecord(json['root']) && json['root']['kind'] !== 'box') {
      errors.push({ path: '$.root.kind', code: 'bad-value', message: 'the root must be a box' });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, input: json as LayoutInput };
}

export type { LayoutBox };
