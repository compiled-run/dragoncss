// The parse driver: parses one stylesheet use into rules with UTF-16 spans, validates values against the webref grammar, and
// expands shorthands into longhands. Selectors are parsed in selectors.ts, at-rules decided in at-rules.ts, tokens converted in
// values.ts and shorthands expanded by the registry in shorthands/ (see css/README.md).
import { generate, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import { handleAtRule } from './at-rules.ts';
import { webrefLexer } from './lexer.ts';
import type { Longhand, Shorthand } from './properties.ts';
import { isLonghand, isShorthand } from './properties.ts';
import type { Selector } from './selectors.ts';
import { parseSelectorList } from './selectors.ts';
import { shorthandHandler } from './shorthands/index.ts';
import type { CssValue } from './values.ts';
import { BASELINE_PROPERTIES, baselinePosition, COLOR_FIX, CSS_WIDE, familyValue, tokenValue, toValue } from './values.ts';
import { mathFunctionRefusal, normalizeUnit, unitRefusal } from './units.ts';

export type { CssValue } from './values.ts';
export { featureOf } from './values.ts';
export type { AttributeTest, Compound, Selector } from './selectors.ts';

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

/**
 * T005 rec 3: the rules inside an unsupported at-rule, parsed with its block unwrapped. They are analysed so their diagnostics can be
 * reported with the at-rule, and never resolved into outputs. diagnostics: what parsing the enclosed block itself reported.
 */
export type EnclosedRules = { readonly atRule: Diagnostic; readonly span: Span; readonly rules: readonly Rule[]; readonly diagnostics: readonly Diagnostic[] };

type ParseState = { order: number; readonly base: Span; readonly text: string; readonly use: SheetUse };

/** Where a node that is not a style rule or declaration sits: top level (or inside a top-level at-rule), or in a rule block. */
type Where = { readonly label: string; readonly selectors: readonly Selector[] | null | 'top' };

export function parseStylesheet(text: string, base: Span, use: SheetUse, orderStart: number, diagnostics: Diagnostic[], enclosed: EnclosedRules[] = []): Rule[] {
  const errors: { message: string; offset: number }[] = [];
  const ast = parse(text, { positions: true, parseValue: true, onParseError: (e) => errors.push({ message: e.message, offset: e.offset }) });
  for (const e of errors) {
    const at = { source: base.source, start: base.start + e.offset, end: base.start + e.offset };
    diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(at), message: `CSS parse error: ${e.message}` }));
  }
  const rules: Rule[] = [];
  const st: ParseState = { order: orderStart, base, text, use };
  for (const node of list(ast, 'children')) {
    if (node.type !== 'Rule') {
      refuseNode(node, st, { label: 'the stylesheet', selectors: 'top' }, diagnostics, enclosed);
      continue;
    }
    const rule = parseRule(node, st, diagnostics, enclosed);
    if (rule !== null) rules.push(rule);
  }
  return rules;
}

function parseRule(node: CssNode, st: ParseState, diagnostics: Diagnostic[], enclosed: EnclosedRules[]): Rule | null {
  const selectors = parseSelectorList(node['prelude'] as CssNode, st.base, st.use, diagnostics);
  const declarations: Declaration[] = [];
  for (const d of list(node['block'] as CssNode, 'children')) {
    if (d.type !== 'Declaration') {
      refuseNode(d, st, { label: 'a rule block', selectors }, diagnostics, enclosed);
      continue;
    }
    const parsed = parseDeclaration(d, st.base, st.text, st.order++, diagnostics);
    if (parsed !== null) declarations.push(parsed);
  }
  return selectors === null ? null : { sheet: st.use.id, owner: st.use.owner, selectors, declarations };
}

/** css-syntax-3 §5.4: an empty declaration (a lone ";") and the <!-- --> tokens produce no rule or declaration in the CSSOM. */
const EMPTY_RAW = /^[\s;]*$/;

// Every node that is not a style rule at the top level, or not a declaration in a rule block, is diagnosed: css-nesting-1 nested
// rules, nested and top-level at-rules, and anything the parser kept as raw text. Nothing is dropped silently.
function refuseNode(node: CssNode, st: ParseState, at: Where, diagnostics: Diagnostic[], enclosed: EnclosedRules[]): void {
  const { base, text } = st;
  const where = at.label;
  const span = spanOf(node, base);
  if (where === 'the stylesheet' && (node.type === 'CDO' || node.type === 'CDC')) return;
  if (node.type === 'Raw' && EMPTY_RAW.test(String(node['value']))) return;
  if (node.type === 'Atrule') {
    // at-rules.ts decides each at-rule; every one is refused today.
    const refusal = handleAtRule({ node, name: String(node['name']), where, span }).diagnostic;
    diagnostics.push(refusal);
    const block = node['block'] as CssNode | null | undefined;
    if (block === null || block === undefined) return;
    // T005 rec 3: the enclosed rules are parsed with the block unwrapped, for analysis only.
    const inner: Diagnostic[] = [];
    const rules: Rule[] = [];
    const label = `@${String(node['name'])}`;
    if (at.selectors === 'top') {
      for (const c of list(block, 'children')) {
        if (c.type === 'Rule') {
          const r = parseRule(c, st, inner, enclosed);
          if (r !== null) rules.push(r);
        } else if (c.type !== 'Declaration') refuseNode(c, st, { label, selectors: 'top' }, inner, enclosed);
      }
    } else {
      const declarations: Declaration[] = [];
      for (const c of list(block, 'children')) {
        if (c.type !== 'Declaration') {
          refuseNode(c, st, { label, selectors: at.selectors }, inner, enclosed);
          continue;
        }
        const parsed = parseDeclaration(c, base, text, st.order++, inner);
        if (parsed !== null) declarations.push(parsed);
      }
      if (at.selectors !== null) rules.push({ sheet: st.use.id, owner: st.use.owner, selectors: at.selectors, declarations });
    }
    enclosed.push({ atRule: refusal, span, rules, diagnostics: inner });
    return;
  }
  if (node.type === 'Rule') {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_NESTED_RULE', {
      origin: authored(span),
      message: `the nested rule "${text.slice(span.start - base.start, span.end - base.start).split('{')[0]?.trim()}" in ${where} is not supported (css-nesting-1)`,
    }));
    return;
  }
  diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(span), message: `CSS ${node.type} in ${where} is not a declaration or style rule` }));
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
  // css-align-3 §4.2: <baseline-position> is one keyword value, [ first | last ]? baseline.
  const baseline = !wide && BASELINE_PROPERTIES.has(property) ? baselinePosition(tokens) : null;
  const values: CssValue[] = baseline === null ? [] : [baseline];
  for (const t of baseline === null ? tokens : []) {
    const unitRefused = t.type === 'Dimension' ? unitRefusal(normalizeUnit(String(t['unit']))) : t.type === 'Function' ? mathFunctionRefusal(String(t['name'])) : null;
    if (unitRefused !== null) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${unitRefused.reason}`, manual: unitRefused.fix }));
      return null;
    }
    const v = wide ? toValue(t, property) : tokenValue(t, property);
    if (typeof v === 'string') {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${v}`, manual: COLOR_FIX }));
      return null;
    }
    values.push(v);
  }
  // A shorthand may refuse a grammar-valid value it cannot express (white-space-trim, shorthands/text.ts).
  const refusal = isShorthand(property) && !wide ? (shorthandHandler(property).refuse?.(tokens, base) ?? null) : null;
  if (refusal !== null) {
    diagnostics.push(refusal);
    return null;
  }
  const longhands = wide
    ? expandWide(property, values[0] as CssValue)
    : isLonghand(property)
      ? [{ property, value: property === 'font-family' ? familyValue(tokens) : (values[0] as CssValue), explicit: true }]
      : shorthandHandler(property).expand(values);
  if (isLonghand(property) && !wide && values.length !== 1 && property !== 'font-family') {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(valueSpan), message: `multi-token value "${text}" for ${property} is not supported in milestone 1`, manual: 'Use a single value.' }));
    return null;
  }
  return { property, text, span, valueSpan, longhands, order };
}

/** A CSS-wide keyword sets the longhand itself, or every longhand of the shorthand. */
function expandWide(property: string, value: CssValue): LonghandValue[] {
  const targets: readonly Longhand[] = isLonghand(property) ? [property] : shorthandHandler(property as Shorthand).longhands;
  return targets.map((p) => ({ property: p, value, explicit: true }));
}
