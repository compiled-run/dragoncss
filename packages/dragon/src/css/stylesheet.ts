// Parses one stylesheet use into rules with UTF-16 spans, validates values against the webref grammar,
// and expands the milestone shorthands into longhands.
import { generate, parse } from 'css-tree';
import type { CssNode, List } from 'css-tree';
import type { Diagnostic, Span } from '../types.ts';
import { webrefLexer } from './lexer.ts';
import type { Longhand } from './properties.ts';
import { isLonghand, isShorthand, SIDES } from './properties.ts';

export type CssValue =
  | { readonly kind: 'keyword'; readonly value: string }
  | { readonly kind: 'length'; readonly value: number; readonly unit: string }
  | { readonly kind: 'percentage'; readonly value: number }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'family'; readonly value: string }
  | { readonly kind: 'other'; readonly type: string; readonly text: string };

export type Compound = { readonly tag: string | null; readonly classes: readonly string[] };
/** Right-to-left: parts[0] is the subject; each later part is joined to the previous by its combinator. */
export type Selector = {
  readonly parts: readonly { readonly compound: Compound; readonly combinator: ' ' | '>' | null }[];
  readonly specificity: readonly [number, number, number];
};

export type LonghandValue = {
  readonly property: Longhand;
  readonly value: CssValue;
  /** False when a shorthand filled this longhand with its initial value. */
  readonly explicit: boolean;
};

export type Declaration = {
  readonly property: string;
  readonly text: string;
  readonly span: Span;
  readonly valueSpan: Span;
  readonly longhands: readonly LonghandValue[];
  readonly order: number;
};

export type Rule = { readonly selectors: readonly Selector[]; readonly declarations: readonly Declaration[] };

const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const LINE_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
const LINE_WIDTH_KEYWORDS = new Set(['thin', 'medium', 'thick', 'hairline']);
const NUMBER_PROPERTIES = new Set<string>(['flex-grow', 'flex-shrink', 'order', 'line-height']);

function list(node: CssNode, key: string): CssNode[] {
  const v = node[key] as List<CssNode> | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
}

function spanOf(node: CssNode, base: Span): Span {
  const loc = node.loc;
  if (loc === null || loc === undefined) return base;
  return { source: base.source, start: base.start + loc.start.offset, end: base.start + loc.end.offset };
}

export function parseStylesheet(text: string, base: Span, orderStart: number, diagnostics: Diagnostic[]): Rule[] {
  const errors: { message: string; offset: number }[] = [];
  const ast = parse(text, { positions: true, parseValue: true, onParseError: (e) => errors.push({ message: e.message, offset: e.offset }) });
  for (const e of errors) {
    diagnostics.push(diag('DRAGON_CSS_PARSE', `CSS parse error: ${e.message}`, { source: base.source, start: base.start + e.offset, end: base.start + e.offset }, 'Fix the CSS syntax at this location.'));
  }
  const rules: Rule[] = [];
  let order = orderStart;
  for (const node of list(ast, 'children')) {
    if (node.type === 'Atrule') {
      diagnostics.push(diag('DRAGON_UNSUPPORTED_AT_RULE', `@${String(node['name'])} is not supported in milestone 1`, spanOf(node, base), 'Remove the at-rule.'));
      continue;
    }
    if (node.type !== 'Rule') continue;
    const prelude = node['prelude'] as CssNode;
    const selectors = parseSelectorList(prelude, base, diagnostics);
    const declarations: Declaration[] = [];
    for (const d of list(node['block'] as CssNode, 'children')) {
      if (d.type !== 'Declaration') continue;
      const parsed = parseDeclaration(d, base, order++, diagnostics);
      if (parsed !== null) declarations.push(parsed);
    }
    if (selectors !== null) rules.push({ selectors, declarations });
  }
  return rules;
}

// Selectors Level 4 §16 specificity, for the S1 subset: type and class compounds joined by descendant or child combinators.
function parseSelectorList(prelude: CssNode, base: Span, diagnostics: Diagnostic[]): Selector[] | null {
  const out: Selector[] = [];
  let ok = true;
  for (const sel of list(prelude, 'children')) {
    const compounds: { compound: { tag: string | null; classes: string[] }; combinator: ' ' | '>' | null }[] = [];
    let current = { tag: null as string | null, classes: [] as string[] };
    let pending: ' ' | '>' | null = null;
    let types = 0;
    let classes = 0;
    for (const part of list(sel, 'children')) {
      if (part.type === 'TypeSelector' && part['name'] !== '*') {
        current.tag = String(part['name']).toLowerCase();
        types++;
      } else if (part.type === 'ClassSelector') {
        current.classes.push(String(part['name']));
        classes++;
      } else if (part.type === 'Combinator' && (part['name'] === ' ' || part['name'] === '>')) {
        compounds.push({ compound: current, combinator: pending });
        pending = part['name'] as ' ' | '>';
        current = { tag: null, classes: [] };
      } else {
        ok = false;
        diagnostics.push(diag('DRAGON_UNSUPPORTED_SELECTOR', `selector part "${generate(part)}" is not supported in milestone 1`, spanOf(part, base), 'Use type and class selectors, optionally joined by descendant or child combinators.'));
      }
    }
    compounds.push({ compound: current, combinator: pending });
    const rightToLeft = compounds.reverse().map((c, i, all) => ({
      compound: c.compound,
      combinator: i === 0 ? null : (all[i - 1] as { combinator: ' ' | '>' | null }).combinator,
    }));
    out.push({ parts: rightToLeft, specificity: [0, classes, types] });
  }
  return ok ? out : null;
}

function parseDeclaration(d: CssNode, base: Span, order: number, diagnostics: Diagnostic[]): Declaration | null {
  const property = String(d['property']).toLowerCase();
  const span = spanOf(d, base);
  const valueNode = d['value'] as CssNode;
  const valueSpan = spanOf(valueNode, base);
  const text = generate(valueNode);
  if (d['important'] !== false) {
    diagnostics.push(diag('DRAGON_UNSUPPORTED_IMPORTANT', `!important on ${property} is not supported`, span, 'Remove !important; order and specificity decide.'));
    return null;
  }
  if (!isLonghand(property) && !isShorthand(property)) {
    diagnostics.push(diag('DRAGON_UNSUPPORTED_PROPERTY', `${property} is not supported in milestone 1`, span, 'Remove the declaration.'));
    return null;
  }
  const tokens = list(valueNode, 'children').filter((n) => n.type !== 'WhiteSpace');
  const wide = tokens.length === 1 && tokens[0]?.type === 'Identifier' && CSS_WIDE.has(String(tokens[0]['name']).toLowerCase());
  if (!wide) {
    const match = webrefLexer().matchProperty(property, valueNode);
    if (match.error !== null) {
      diagnostics.push(diag('DRAGON_CSS_INVALID_VALUE', `"${text}" is not a valid value for ${property} (@webref/css grammar)`, valueSpan, `Use a value that matches the ${property} grammar.`));
      return null;
    }
  }
  const values = tokens.map((t) => toValue(t, property));
  const longhands = wide
    ? expandWide(property, values[0] as CssValue)
    : isLonghand(property)
      ? [{ property, value: property === 'font-family' ? familyValue(tokens) : (values[0] as CssValue), explicit: true }]
      : expandShorthand(property, values);
  if (isLonghand(property) && !wide && values.length !== 1 && property !== 'font-family') {
    diagnostics.push(diag('DRAGON_UNSUPPORTED_VALUE', `multi-token value "${text}" for ${property} is not supported in milestone 1`, valueSpan, 'Use a single value.'));
    return null;
  }
  return { property, text, span, valueSpan, longhands, order };
}

function toValue(node: CssNode, property: string): CssValue {
  switch (node.type) {
    case 'Identifier':
      return { kind: 'keyword', value: String(node['name']).toLowerCase() };
    case 'Dimension':
      return { kind: 'length', value: Number(node['value']), unit: String(node['unit']).toLowerCase() };
    case 'Percentage':
      return { kind: 'percentage', value: Number(node['value']) };
    case 'Number': {
      const n = Number(node['value']);
      if (!NUMBER_PROPERTIES.has(property) && property !== 'flex' && n === 0) return { kind: 'length', value: 0, unit: 'px' };
      return { kind: 'number', value: n };
    }
    case 'String':
      return { kind: 'family', value: String(node['value']) };
    case 'Hash':
      return { kind: 'other', type: 'color', text: generate(node) };
    case 'Function':
      return { kind: 'other', type: `${String(node['name']).toLowerCase()}()`, text: generate(node) };
    default:
      return { kind: 'other', type: node.type, text: generate(node) };
  }
}

function familyValue(tokens: CssNode[]): CssValue {
  const text = tokens.map((t) => (t.type === 'String' ? JSON.stringify(t['value']) : generate(t))).join(' ');
  if (tokens.length === 1 && (tokens[0]?.type === 'Identifier' || tokens[0]?.type === 'String')) {
    const t = tokens[0];
    return { kind: 'family', value: String(t.type === 'Identifier' ? t['name'] : t['value']) };
  }
  return { kind: 'other', type: 'family-list', text };
}

const SHORTHAND_LONGHANDS: { readonly [s: string]: readonly Longhand[] } = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
};

function borderLonghands(property: string): Longhand[] {
  const sides = property === 'border' ? SIDES : [property.slice('border-'.length) as (typeof SIDES)[number]];
  const out: Longhand[] = [];
  for (const side of sides) out.push(`border-${side}-width` as Longhand, `border-${side}-style` as Longhand, `border-${side}-color` as Longhand);
  return out;
}

function expandWide(property: string, value: CssValue): LonghandValue[] {
  const targets: readonly Longhand[] = isLonghand(property)
    ? [property]
    : property.startsWith('border') && SHORTHAND_LONGHANDS[property] === undefined
      ? borderLonghands(property)
      : (SHORTHAND_LONGHANDS[property] as readonly Longhand[]);
  return targets.map((p) => ({ property: p, value, explicit: true }));
}

const kw = (value: string): CssValue => ({ kind: 'keyword', value });

// css-box-4 §4, css-backgrounds-3 §3, css-flexbox-1 §7.1, css-align-3 §8.3, css-overflow-3 §3: shorthand expansion.
function expandShorthand(property: string, values: CssValue[]): LonghandValue[] {
  const explicit = (p: Longhand, value: CssValue): LonghandValue => ({ property: p, value, explicit: true });
  const implicit = (p: Longhand, value: CssValue): LonghandValue => ({ property: p, value, explicit: false });
  if (property === 'margin' || property === 'padding' || property === 'border-width' || property === 'border-style' || property === 'border-color') {
    const [t, r = t, b = t, l = r] = values as [CssValue, CssValue?, CssValue?, CssValue?];
    const names = SHORTHAND_LONGHANDS[property] as readonly Longhand[];
    return [t, r, b, l].map((v, i) => explicit(names[i] as Longhand, v as CssValue));
  }
  if (property === 'border' || property.startsWith('border-')) {
    let width: CssValue | null = null;
    let style: CssValue | null = null;
    let color: CssValue | null = null;
    for (const v of values) {
      if (v.kind === 'length' || (v.kind === 'keyword' && LINE_WIDTH_KEYWORDS.has(v.value))) width = v;
      else if (v.kind === 'keyword' && LINE_STYLES.has(v.value)) style = v;
      else color = v;
    }
    const names = borderLonghands(property);
    const out: LonghandValue[] = [];
    for (let i = 0; i < names.length; i += 3) {
      out.push(width === null ? implicit(names[i] as Longhand, kw('medium')) : explicit(names[i] as Longhand, width));
      out.push(style === null ? implicit(names[i + 1] as Longhand, kw('none')) : explicit(names[i + 1] as Longhand, style));
      out.push(color === null ? implicit(names[i + 2] as Longhand, kw('currentcolor')) : explicit(names[i + 2] as Longhand, color));
    }
    return out;
  }
  if (property === 'flex') {
    const only = values[0] as CssValue;
    if (values.length === 1 && only.kind === 'keyword' && only.value === 'none') {
      return [explicit('flex-grow', { kind: 'number', value: 0 }), explicit('flex-shrink', { kind: 'number', value: 0 }), explicit('flex-basis', kw('auto'))];
    }
    if (values.length === 1 && only.kind === 'keyword' && only.value === 'auto') {
      return [explicit('flex-grow', { kind: 'number', value: 1 }), explicit('flex-shrink', { kind: 'number', value: 1 }), explicit('flex-basis', kw('auto'))];
    }
    const numbers = values.filter((v) => v.kind === 'number');
    // A third unitless number can only be a zero flex-basis (css-flexbox-1 §7.2).
    const basis = numbers.length === 3 ? ({ kind: 'length', value: 0, unit: 'px' } as const) : values.find((v) => v.kind !== 'number');
    return [
      explicit('flex-grow', numbers[0] === undefined ? { kind: 'number', value: 1 } : numbers[0]),
      explicit('flex-shrink', numbers[1] === undefined ? { kind: 'number', value: 1 } : numbers[1]),
      explicit('flex-basis', basis === undefined ? { kind: 'percentage', value: 0 } : basis),
    ];
  }
  if (property === 'flex-flow') {
    const direction = values.find((v) => v.kind === 'keyword' && v.value.includes('row') || v.kind === 'keyword' && v.value.includes('column'));
    const wrap = values.find((v) => v.kind === 'keyword' && v.value.includes('wrap'));
    return [
      direction === undefined ? implicit('flex-direction', kw('row')) : explicit('flex-direction', direction),
      wrap === undefined ? implicit('flex-wrap', kw('nowrap')) : explicit('flex-wrap', wrap),
    ];
  }
  if (property === 'gap' || property === 'overflow') {
    const [first, second = first] = values as [CssValue, CssValue?];
    const names = SHORTHAND_LONGHANDS[property] as readonly Longhand[];
    return [explicit(names[0] as Longhand, first), explicit(names[1] as Longhand, second as CssValue)];
  }
  throw new Error(`no expansion for shorthand ${property}`);
}

export function diag(code: Diagnostic['code'], message: string, span: Span | null, fix: string | null, targets: Diagnostic['targets'] = []): Diagnostic {
  return { code, severity: 'error', message, span, targets, fix };
}

/** Feature key for the support profile: a keyword, or the value type with its unit. */
export function featureOf(property: Longhand, v: CssValue): string {
  switch (v.kind) {
    case 'keyword':
      return `${property}:${v.value}`;
    case 'length':
      return v.unit === 'px' ? `${property}:<length>` : `${property}:<length ${v.unit}>`;
    case 'percentage':
      return `${property}:<percentage>`;
    case 'number':
      return property === 'order' ? `${property}:<integer>` : `${property}:<number>`;
    case 'family':
      return `${property}:${v.value}`;
    case 'other':
      return `${property}:<${v.type}>`;
  }
}
