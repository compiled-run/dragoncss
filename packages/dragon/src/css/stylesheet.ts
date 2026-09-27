// Parses one stylesheet use into rules with UTF-16 spans, validates values against the webref grammar,
// and expands the milestone shorthands into longhands.
import { generate, parse } from 'css-tree';
import type { CssNode, List } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../types.ts';
import type { ColorSyntax, Rgba8 } from './color.ts';
import { parseColorNode } from './color.ts';
import { webrefLexer } from './lexer.ts';
import type { Longhand } from './properties.ts';
import { isLonghand, isShorthand, SIDES } from './properties.ts';

export type CssValue =
  | { readonly kind: 'keyword'; readonly value: string }
  | { readonly kind: 'length'; readonly value: number; readonly unit: string }
  | { readonly kind: 'percentage'; readonly value: number }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'family'; readonly value: string }
  /** A resolved legacy sRGB colour; transparent and currentcolor stay keywords. */
  | { readonly kind: 'color'; readonly value: Rgba8; readonly syntax: ColorSyntax }
  | { readonly kind: 'other'; readonly type: string; readonly text: string };

/** [ui-name] (value null) or [ui-name="value"]. */
export type AttributeTest = { readonly name: string; readonly value: string | null };
export type Compound = { readonly tag: string | null; readonly classes: readonly string[]; readonly attributes: readonly AttributeTest[] };
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

/** A class selector in this rule matches only class symbols with this owner and sheet (docs/api.md §3.1). */
export type Rule = {
  readonly sheet: string;
  readonly owner: string;
  readonly selectors: readonly Selector[];
  readonly declarations: readonly Declaration[];
};

/** One stylesheet use: its id, the owner its class symbols belong to, and whether it is component-scoped. */
export type SheetUse = { readonly id: string; readonly owner: string; readonly scope: 'component' | 'document' };

const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const LINE_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
const LINE_WIDTH_KEYWORDS = new Set(['thin', 'medium', 'thick', 'hairline']);
const NUMBER_PROPERTIES = new Set<string>(['flex-grow', 'flex-shrink', 'order', 'line-height']);
const WHITE_SPACE_TRIM = new Set(['none', 'discard-before', 'discard-after', 'discard-inner']);
const WHITE_SPACE_COLLAPSE = new Set(['collapse', 'discard', 'preserve', 'preserve-breaks', 'preserve-spaces', 'break-spaces']);
/** css-text-4 §3: the white-space keywords that set both longhands. */
const WHITE_SPACE_KEYWORDS: { readonly [k: string]: readonly [string, string] } = {
  normal: ['collapse', 'wrap'],
  pre: ['preserve', 'nowrap'],
  'pre-wrap': ['preserve', 'wrap'],
  'pre-line': ['preserve-breaks', 'wrap'],
};

function list(node: CssNode, key: string): CssNode[] {
  const v = node[key] as List<CssNode> | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
}

function spanOf(node: CssNode, base: Span): Span {
  const loc = node.loc;
  if (loc === null || loc === undefined) return base;
  return { source: base.source, start: base.start + loc.start.offset, end: base.start + loc.end.offset };
}

export function parseStylesheet(text: string, base: Span, use: SheetUse, orderStart: number, diagnostics: Diagnostic[]): Rule[] {
  const errors: { message: string; offset: number }[] = [];
  const ast = parse(text, { positions: true, parseValue: true, onParseError: (e) => errors.push({ message: e.message, offset: e.offset }) });
  for (const e of errors) {
    const at = { source: base.source, start: base.start + e.offset, end: base.start + e.offset };
    diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(at), message: `CSS parse error: ${e.message}` }));
  }
  const rules: Rule[] = [];
  let order = orderStart;
  for (const node of list(ast, 'children')) {
    if (node.type === 'Atrule') {
      const span = spanOf(node, base);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
        origin: authored(span),
        message: `@${String(node['name'])} is not supported in milestone 1`,
        edits: [{ span, replacement: '' }],
      }));
      continue;
    }
    if (node.type !== 'Rule') continue;
    const prelude = node['prelude'] as CssNode;
    const selectors = parseSelectorList(prelude, base, use, diagnostics);
    const declarations: Declaration[] = [];
    for (const d of list(node['block'] as CssNode, 'children')) {
      if (d.type !== 'Declaration') continue;
      const parsed = parseDeclaration(d, base, text, order++, diagnostics);
      if (parsed !== null) declarations.push(parsed);
    }
    if (selectors !== null) rules.push({ sheet: use.id, owner: use.owner, selectors, declarations });
  }
  return rules;
}

const SELECTOR_FIX = 'Use class compounds, optionally with a tag and [ui-*] or [ui-*="value"], joined by descendant or child combinators.';

// Selectors Level 4 §16 specificity: type, class and attribute compounds joined by descendant or child combinators. In a
// component-scoped sheet every compound needs a class, so it can only match elements carrying the owner's symbols.
function parseSelectorList(prelude: CssNode, base: Span, use: SheetUse, diagnostics: Diagnostic[]): Selector[] | null {
  const out: Selector[] = [];
  let ok = true;
  const refuse = (node: CssNode, message: string): void => {
    ok = false;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', { origin: authored(spanOf(node, base)), message, manual: SELECTOR_FIX }));
  };
  for (const sel of list(prelude, 'children')) {
    const compounds: { compound: { tag: string | null; classes: string[]; attributes: AttributeTest[] }; combinator: ' ' | '>' | null }[] = [];
    let current = { tag: null as string | null, classes: [] as string[], attributes: [] as AttributeTest[] };
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
      } else if (part.type === 'AttributeSelector') {
        const name = String((part['name'] as CssNode)['name']).toLowerCase();
        const matcher = part['matcher'] as string | null;
        const valueNode = part['value'] as CssNode | null;
        if (!/^ui-[a-z0-9-]+$/.test(name) || part['flags'] !== null || (matcher !== null && matcher !== '=')) {
          refuse(part, `attribute selector "${generate(part)}" is not supported: only [ui-*] and [ui-*="value"]`);
          continue;
        }
        const value = valueNode === null ? null : valueNode.type === 'String' ? String(valueNode['value']) : String(valueNode['name']);
        current.attributes.push({ name, value });
        classes++;
      } else if (part.type === 'Combinator' && (part['name'] === ' ' || part['name'] === '>')) {
        compounds.push({ compound: current, combinator: pending });
        pending = part['name'] as ' ' | '>';
        current = { tag: null, classes: [], attributes: [] };
      } else {
        refuse(part, `selector part "${generate(part)}" is not supported in milestone 1`);
      }
    }
    compounds.push({ compound: current, combinator: pending });
    if (use.scope === 'component' && compounds.some((c) => c.compound.classes.length === 0)) {
      refuse(sel, `every compound of "${generate(sel)}" needs a class in a component-scoped sheet, so it can only match the owner's elements`);
    }
    const rightToLeft = compounds.reverse().map((c, i, all) => ({
      compound: c.compound,
      combinator: i === 0 ? null : (all[i - 1] as { combinator: ' ' | '>' | null }).combinator,
    }));
    out.push({ parts: rightToLeft, specificity: [0, classes, types] });
  }
  return ok ? out : null;
}

function parseDeclaration(d: CssNode, base: Span, sheetText: string, order: number, diagnostics: Diagnostic[]): Declaration | null {
  const property = String(d['property']).toLowerCase();
  const span = spanOf(d, base);
  const valueNode = d['value'] as CssNode;
  const valueSpan = spanOf(valueNode, base);
  const text = generate(valueNode);
  if (d['important'] !== false) {
    const local = sheetText.slice(span.start - base.start, span.end - base.start);
    const bang = local.lastIndexOf('!');
    let from = bang;
    while (from > 0 && /\s/.test(local[from - 1] as string)) from--;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_IMPORTANT', {
      origin: authored(span),
      message: `!important on ${property} is not supported`,
      edits: [{ span: { source: span.source, start: span.start + from, end: span.end }, replacement: '' }],
    }));
    return null;
  }
  if (!isLonghand(property) && !isShorthand(property)) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_PROPERTY', {
      origin: authored(span),
      message: `${property} is not supported in milestone 1`,
      edits: [{ span, replacement: '' }],
    }));
    return null;
  }
  const tokens = list(valueNode, 'children').filter((n) => n.type !== 'WhiteSpace');
  const wide = tokens.length === 1 && tokens[0]?.type === 'Identifier' && CSS_WIDE.has(String(tokens[0]['name']).toLowerCase());
  if (!wide) {
    const match = webrefLexer().matchProperty(property, valueNode);
    if (match.error !== null) {
      diagnostics.push(diagnostic('DRAGON_CSS_INVALID_VALUE', {
        origin: authored(valueSpan),
        message: `"${text}" is not a valid value for ${property} (@webref/css grammar)`,
        manual: `Use a value that matches the ${property} grammar.`,
      }));
      return null;
    }
  }
  const values: CssValue[] = [];
  for (const t of tokens) {
    const v = wide ? toValue(t, property) : tokenValue(t, property);
    if (typeof v === 'string') {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${v}`, manual: COLOR_FIX }));
      return null;
    }
    values.push(v);
  }
  // css-text-4 §3: white-space-trim is not a Dragon longhand and Chrome does not implement it, so a white-space value that sets it
  // is refused rather than dropped.
  const trim = property === 'white-space' && !wide ? tokens.find((t) => t.type === 'Identifier' && WHITE_SPACE_TRIM.has(String(t['name']).toLowerCase())) : undefined;
  if (trim !== undefined) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(trim, base)),
      message: `white-space: ${generate(trim)} sets white-space-trim, which milestone 1 does not support`,
      manual: 'Use white-space: normal or nowrap.',
    }));
    return null;
  }
  const longhands = wide
    ? expandWide(property, values[0] as CssValue)
    : isLonghand(property)
      ? [{ property, value: property === 'font-family' ? familyValue(tokens) : (values[0] as CssValue), explicit: true }]
      : expandShorthand(property, values);
  if (isLonghand(property) && !wide && values.length !== 1 && property !== 'font-family') {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(valueSpan), message: `multi-token value "${text}" for ${property} is not supported in milestone 1`, manual: 'Use a single value.' }));
    return null;
  }
  return { property, text, span, valueSpan, longhands, order };
}

const COLOR_FIX = 'Use a named colour, a 3, 4, 6 or 8 digit hex colour, rgb(), rgba(), hsl(), hsla(), transparent or currentcolor.';

function isColorBearing(property: string): boolean {
  return property === 'color' || property === 'background-color' || property.startsWith('border') && (property.endsWith('-color') || !property.endsWith('-width') && !property.endsWith('-style'));
}

// css-color-4 §4: <color> tokens resolve to 8-bit channels here (color.ts); anything outside the subset is refused.
function tokenValue(node: CssNode, property: string): CssValue | string {
  if (!isColorBearing(property)) return toValue(node, property);
  if (node.type === 'Identifier') {
    const name = String(node['name']).toLowerCase();
    if (!property.endsWith('color') && (LINE_STYLES.has(name) || LINE_WIDTH_KEYWORDS.has(name))) return toValue(node, property);
  } else if (node.type !== 'Hash' && node.type !== 'Function') {
    return toValue(node, property);
  }
  const c = parseColorNode(node);
  if (!c.ok) return c.reason;
  return c.kind === 'keyword' ? { kind: 'keyword', value: c.keyword } : { kind: 'color', value: c.value, syntax: c.syntax };
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
  'white-space': ['white-space-collapse', 'text-wrap-mode'],
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

// css-box-4 §4, css-backgrounds-3 §3, css-flexbox-1 §7.1, css-align-3 §8.3, css-overflow-3 §3, css-text-4 §3: shorthand expansion.
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
  if (property === 'white-space') {
    const only = values[0] as CssValue;
    const pair = values.length === 1 && only.kind === 'keyword' ? WHITE_SPACE_KEYWORDS[only.value] : undefined;
    if (pair !== undefined) return [explicit('white-space-collapse', kw(pair[0])), explicit('text-wrap-mode', kw(pair[1]))];
    // <'white-space-collapse'> || <'text-wrap-mode'>: an omitted longhand takes its initial value.
    const collapse = values.find((v) => v.kind === 'keyword' && WHITE_SPACE_COLLAPSE.has(v.value));
    const wrap = values.find((v) => v.kind === 'keyword' && (v.value === 'wrap' || v.value === 'nowrap'));
    return [
      collapse === undefined ? implicit('white-space-collapse', kw('collapse')) : explicit('white-space-collapse', collapse),
      wrap === undefined ? implicit('text-wrap-mode', kw('wrap')) : explicit('text-wrap-mode', wrap),
    ];
  }
  throw new Error(`no expansion for shorthand ${property}`);
}

/** Feature key for the support profile: a keyword, or the value type with its unit. */
export function featureOf(property: Longhand, v: CssValue): string {
  switch (v.kind) {
    case 'keyword':
      return `${property}:${v.value}`;
    case 'length':
      return v.unit === 'px' ? `${property}:<length-px>` : `${property}:<length-${v.unit}>`;
    case 'percentage':
      return `${property}:<percentage>`;
    case 'number':
      return property === 'order' ? `${property}:<integer>` : `${property}:<number>`;
    case 'family':
      return `${property}:${v.value}`;
    case 'color':
      return `${property}:<${v.syntax}>`;
    case 'other':
      return `${property}:<${v.type}>`;
  }
}
