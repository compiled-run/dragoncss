// The parse driver: parses one stylesheet use into rules with UTF-16 spans, validates values against the webref grammar, and
// expands shorthands into longhands. Selectors are parsed in selectors.ts, at-rules decided in at-rules.ts, tokens converted in
// values.ts and shorthands expanded by the registry in shorthands/ (see css/README.md).
import { generate, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import { handleAtRule } from './at-rules.ts';
import type { AtRuleContext } from './at-rules.ts';
import { asciiLower, canonicalizeEscapes, decodeName, preprocessInput, trimValue } from './escapes.ts';
import { GRID_VALUE_PROPERTIES, parseGridValue } from './grid-values.ts';
import { webrefLexer } from './lexer.ts';
import type { Longhand, Shorthand } from './properties.ts';
import { isLonghand, isShorthand } from './properties.ts';
import type { Selector } from './selectors.ts';
import { parseSelectorList } from './selectors.ts';
import { shorthandHandler } from './shorthands/index.ts';
import type { CssValue } from './values.ts';
import { BASELINE_PROPERTIES, baselinePosition, COLOR_FIX, CSS_WIDE, familyValue, tokenValue, toValue } from './values.ts';
import { mathFunctionRefusal, normalizeUnit, unitRefusal } from './units.ts';
import type { CustomValue, PendingSubstitution } from './variables.ts';
import { hasVar, MAX_NESTING, nestingDepth, parseVarParts } from './variables.ts';

export type { CssValue } from './values.ts';
export { featureOf } from './values.ts';
export type { AttributeTest, Compound, Selector } from './selectors.ts';

export type LonghandValue = {
  readonly property: Longhand;
  readonly value: CssValue;
  /** False when a shorthand filled this longhand with its initial value. */
  readonly explicit: boolean;
  /** Set when a flow-relative property maps to this longhand only on elements of this direction (analysis/logical.ts). */
  readonly direction?: 'ltr' | 'rtl';
};

export type Declaration = {
  readonly property: string;
  readonly text: string;
  readonly span: Span;
  readonly valueSpan: Span;
  readonly longhands: readonly LonghandValue[];
  readonly order: number;
  /** css-cascade-5 §6.4: present and true on an !important declaration. */
  readonly important?: true;
  /** A custom property declaration (css-variables-1 §2); its longhands are empty. */
  readonly custom?: CustomValue;
  /** A declaration whose value holds var(); its longhands are empty until substitution (css-variables-1 §3.1). */
  readonly pending?: PendingSubstitution;
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

type ParseState = { order: number; readonly base: Span; readonly text: string; readonly use: SheetUse; readonly fontFaces: AtRuleContext[] };

/** Where a node that is not a style rule or declaration sits: top level (or inside a top-level at-rule), or in a rule block. */
type Where = { readonly label: string; readonly selectors: readonly Selector[] | null | 'top' };

/** fontFaces: collects the accepted @font-face rules, in document order, for the fonts module. */
export function parseStylesheet(authoredText: string, base: Span, use: SheetUse, orderStart: number, diagnostics: Diagnostic[], enclosed: EnclosedRules[] = [], fontFaces: AtRuleContext[] = []): Rule[] {
  const text = preprocessInput(authoredText);
  // Chrome 145 reads a literal U+0000 as U+FFFD inside a name but not where it would start a hash or follow a leading "-" (probed),
  // so Dragon reports it rather than guess which reading applies.
  const nul = authoredText.indexOf('\u0000');
  if (nul >= 0) {
    const at = { source: base.source, start: base.start + nul, end: base.start + nul + 1 };
    diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(at), message: 'the stylesheet holds a U+0000 code point, which Chrome 145 reads differently by position', manual: 'Remove the U+0000, or write the escape \\FFFD for U+FFFD.' }));
  }
  const errors: { message: string; offset: number }[] = [];
  const ast = parse(text, { positions: true, parseValue: true, onParseError: (e) => errors.push({ message: e.message, offset: e.offset }) });
  // Only a backslash spells an escape once the input is preprocessed.
  if (text.includes('\\')) canonicalizeEscapes(ast);
  for (const e of errors) {
    const at = { source: base.source, start: base.start + e.offset, end: base.start + e.offset };
    diagnostics.push(diagnostic('DRAGON_CSS_PARSE', { origin: authored(at), message: `CSS parse error: ${e.message}` }));
  }
  const rules: Rule[] = [];
  const st: ParseState = { order: orderStart, base, text, use, fontFaces };
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
  const before = diagnostics.length;
  const selectors = parseSelectorList(node['prelude'] as CssNode, st.base, st.use, diagnostics);
  // Chrome never parses the block of a rule it drops, so neither do its diagnostics count.
  const dropped = diagnostics.slice(before).some((d) => d.code === 'DRAGON_SELECTOR_DROPPED');
  const blockDiagnostics = dropped ? [] : diagnostics;
  const declarations: Declaration[] = [];
  for (const d of list(node['block'] as CssNode, 'children')) {
    if (d.type !== 'Declaration') {
      refuseNode(d, st, { label: 'a rule block', selectors }, blockDiagnostics, dropped ? [] : enclosed);
      continue;
    }
    const parsed = parseDeclaration(d, st.base, st.text, st.order++, blockDiagnostics);
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
    // at-rules.ts decides each at-rule; an accepted @font-face goes to the fonts collector, every other one is refused.
    const outcome = handleAtRule({ node, name: String(node['name']), where, span });
    if (outcome.kind === 'font-face') {
      st.fontFaces.push(outcome.context);
      return;
    }
    const refusal = outcome.diagnostic;
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
  // css-syntax-3 §4.3.7: a property name is the identifier's value, so \63 olor is color and --\61 is --a.
  const written = decodeName(String(d['property']));
  // css-variables-1 §2: custom property names are case-sensitive.
  const property = written.startsWith('--') ? written : asciiLower(written);
  const span = spanOf(d, base);
  const valueNode = d['value'] as CssNode;
  const valueSpan = spanOf(valueNode, base);
  const text = generate(valueNode);
  const priority = d['important'];
  // css-syntax-3 §5.4.6: "!important" (ASCII case-insensitive) is the only priority; any other "!name" drops the declaration.
  if (priority !== false && priority !== true && asciiLower(decodeName(String(priority))) !== 'important') {
    diagnostics.push(diagnostic('DRAGON_CSS_INVALID_VALUE', {
      origin: authored(span),
      message: `"!${String(priority)}" on ${property} is not a valid priority; only !important is (css-syntax-3 §5.4.6)`,
      manual: 'Remove the priority or write !important.',
    }));
    return null;
  }
  const important = priority === false ? {} : { important: true as const };
  if (property.startsWith('--')) return parseCustomDeclaration(property, valueNode, span, valueSpan, order, important, diagnostics);
  if (!isLonghand(property) && !isShorthand(property)) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_PROPERTY', {
      origin: authored(span),
      message: `${property} is not supported in milestone 1`,
      edits: [{ span, replacement: '' }],
    }));
    return null;
  }
  // css-variables-1 §3.1: a value holding var() is valid at parse time; it is parsed against the grammar after substitution.
  const source = sheetText.slice(valueSpan.start - base.start, valueSpan.end - base.start);
  // An escape may spell var( or url( (css-syntax-3 §4.3.7), so a value with one is split too.
  const mentionsVar = /var\(|\\/i.test(source);
  if (mentionsVar && nestingDepth(source) > MAX_NESTING) {
    diagnostics.push(tooDeep(property, valueSpan));
    return null;
  }
  const parts = mentionsVar ? parseVarParts(source) : null;
  if (mentionsVar && parts === null) {
    diagnostics.push(invalidVar(property, text, valueSpan));
    return null;
  }
  if (parts !== null && hasVar(parts)) {
    const longhands: readonly Longhand[] = isLonghand(property) ? [property] : shorthandHandler(property).longhands;
    const sides = directionSides(property);
    // The source text, since serializing the parsed value would add white space between adjacent var() references.
    return { property, text: source.trim(), span, valueSpan, longhands: [], order, ...important, pending: { parts, longhands, ...(sides === null ? {} : { sides }) } };
  }
  const tokens = list(valueNode, 'children').filter((n) => n.type !== 'WhiteSpace');
  const parsed = parseValue(property, valueNode, tokens, base, sheetText);
  switch (parsed.kind) {
    case 'invalid':
      diagnostics.push(diagnostic('DRAGON_CSS_INVALID_VALUE', {
        origin: authored(valueSpan),
        message: parsed.reason === undefined ? `"${text}" is not a valid value for ${property} (@webref/css grammar)` : `"${text}" is not a valid value for ${property}: ${parsed.reason}`,
        manual: `Use a value that matches the ${property} grammar.`,
      }));
      return null;
    case 'token':
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(parsed.token, base)), message: `${property}: ${generate(parsed.token)} is unsupported: ${parsed.reason}`, manual: COLOR_FIX }));
      return null;
    case 'refused':
      diagnostics.push(parsed.diagnostic);
      return null;
    case 'multi':
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(valueSpan), message: `multi-token value "${text}" for ${property} is not supported in milestone 1`, manual: 'Use a single value.' }));
      return null;
    case 'ok':
      return { property, text, span, valueSpan, longhands: parsed.longhands, order, ...important };
  }
}

/** css-logical-1 §3: the physical longhands a flow-relative property sets in each direction, or null when it maps the same in both. */
function directionSides(property: string): { ltr: Longhand[]; rtl: Longhand[] } | null {
  const mapped = expandWide(property, { kind: 'keyword', value: 'unset' });
  if (!mapped.some((lh) => lh.direction !== undefined)) return null;
  const side = (dir: 'ltr' | 'rtl'): Longhand[] => [...new Set(mapped.filter((lh) => lh.direction === undefined || lh.direction === dir).map((lh) => lh.property))];
  return { ltr: side('ltr'), rtl: side('rtl') };
}

/** A malformed var(). */
const invalidVar = (property: string, text: string, valueSpan: Span): Diagnostic => diagnostic('DRAGON_CSS_INVALID_VALUE', {
  origin: authored(valueSpan),
  message: `"${text}" is not a valid value for ${property}: it holds a malformed var() (css-variables-1 §3: var( <custom-property-name> [, <fallback>]? )), an unmatched ")", "]" or "}", or a bad url()`,
  manual: 'Write var(--name) or var(--name, fallback), and balance every bracket.',
});

const tooDeep = (property: string, valueSpan: Span): Diagnostic => diagnostic('DRAGON_UNSUPPORTED_VALUE', {
  origin: authored(valueSpan),
  message: `the value of ${property} nests brackets more than ${MAX_NESTING} deep, which is not supported`,
  manual: 'Nest var() fallbacks and brackets less deeply.',
});

/** css-variables-1 §2: a custom property takes any value; a lone CSS-wide keyword is that keyword, not a token sequence. */
function parseCustomDeclaration(name: string, valueNode: CssNode, span: Span, valueSpan: Span, order: number, important: { important?: true }, diagnostics: Diagnostic[]): Declaration | null {
  // css-variables-1 §2: "--" alone is reserved, so it is not a custom property name.
  if (name === '--') {
    diagnostics.push(diagnostic('DRAGON_CSS_INVALID_VALUE', { origin: authored(span), message: 'the property name "--" is reserved and is not a custom property (css-variables-1 §2)', manual: 'Give the custom property a name after "--".' }));
    return null;
  }
  const written = String(valueNode.type === 'Raw' ? valueNode['value'] : generate(valueNode));
  // css-syntax-3 §5.4.6: leading and trailing white space tokens are not part of the value.
  const text = trimValue(written);
  // Comments are not tokens, so "inherit /**/" is still the keyword.
  const bare = asciiLower(decodeName(text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g, '')));
  const wide = CSS_WIDE.has(bare) ? bare : null;
  if (nestingDepth(text) > MAX_NESTING) {
    diagnostics.push(tooDeep(name, valueSpan));
    return null;
  }
  // A newline ending a string is trimmed from the text but still makes it a bad string, so validity is judged on what was written.
  const parts = wide === null && parseVarParts(written) !== null ? parseVarParts(text) : wide === null ? null : [];
  if (parts === null) {
    diagnostics.push(invalidVar(name, text, valueSpan));
    return null;
  }
  return { property: name, text, span, valueSpan, longhands: [], order, ...important, custom: { name, wide, parts } };
}

/** How a value parses for a longhand or shorthand; the parse driver and var() substitution report the failures differently. */
export type ParsedValue =
  | { readonly kind: 'ok'; readonly longhands: readonly LonghandValue[] }
  /** reason: why a grammar-valid value is invalid (a rule Chrome's parser applies beyond the grammar); absent for a grammar mismatch. */
  | { readonly kind: 'invalid'; readonly reason?: string }
  | { readonly kind: 'token'; readonly token: CssNode; readonly reason: string }
  | { readonly kind: 'refused'; readonly diagnostic: Diagnostic }
  | { readonly kind: 'multi' };

/** Grammar validation, token conversion and shorthand expansion of one value; base locates a shorthand refusal in sheetText. */
export function parseValue(property: Longhand | Shorthand, valueNode: CssNode, tokens: readonly CssNode[], base: Span, sheetText: string): ParsedValue {
  const wide = tokens.length === 1 && tokens[0]?.type === 'Identifier' && CSS_WIDE.has(asciiLower(String(tokens[0]['name'])));
  if (!wide) {
    const match = webrefLexer().matchProperty(property, valueNode);
    if (match.error !== null) return { kind: 'invalid' };
  }
  // css-grid-2 and justify-*: multi-token values, with the checks Chrome makes beyond the grammar (grid-values.ts).
  if (!wide && GRID_VALUE_PROPERTIES.has(property)) return parseGridValue(property, tokens, base);
  // css-align-3 §4.2: <baseline-position> is one keyword value, [ first | last ]? baseline.
  const baseline = !wide && BASELINE_PROPERTIES.has(property) ? baselinePosition(tokens) : null;
  const values: CssValue[] = baseline === null ? [] : [baseline];
  for (const t of baseline === null ? tokens : []) {
    const unitRefused = t.type === 'Dimension' ? unitRefusal(normalizeUnit(String(t['unit']))) : t.type === 'Function' ? mathFunctionRefusal(String(t['name'])) : null;
    if (unitRefused !== null) {
      return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${unitRefused.reason}`, manual: unitRefused.fix }) };
    }
    const v = wide ? toValue(t, property) : tokenValue(t, property);
    if (typeof v === 'string') return { kind: 'token', token: t, reason: v };
    values.push(v);
  }
  // A shorthand may refuse a grammar-valid value it cannot express (white-space-trim, shorthands/text.ts).
  const refusal = isShorthand(property) && !wide ? (shorthandHandler(property).refuse?.(tokens, base, sheetText) ?? null) : null;
  if (refusal !== null) return { kind: 'refused', diagnostic: refusal };
  const longhands = wide
    ? expandWide(property, values[0] as CssValue)
    : isLonghand(property)
      ? [{ property, value: property === 'font-family' ? familyValue(tokens) : (values[0] as CssValue), explicit: true }]
      : shorthandHandler(property).expand(values, tokens);
  if (isLonghand(property) && !wide && values.length !== 1 && property !== 'font-family') return { kind: 'multi' };
  return { kind: 'ok', longhands };
}

/**
 * css-variables-1 §3.1: parses a value after var() substitution. A parse error or a grammar mismatch is 'invalid' (invalid at
 * computed-value time); the other failures are values the grammar accepts and Dragon cannot express.
 */
export function parseSubstitutedValue(property: Longhand | Shorthand, text: string, base: Span): ParsedValue {
  // Substitution can nest brackets past MAX_NESTING, which the css-tree parser would recurse through.
  if (nestingDepth(text) > MAX_NESTING) return { kind: 'refused', diagnostic: tooDeep(property, base) };
  let failed = false;
  const node = parse(text, { context: 'value', positions: true, onParseError: () => { failed = true; } });
  if (failed) return { kind: 'invalid' };
  if (text.includes('\\')) canonicalizeEscapes(node);
  const tokens = list(node, 'children').filter((n) => n.type !== 'WhiteSpace');
  if (tokens.length === 0) return { kind: 'invalid' };
  return parseValue(property, node, tokens, base, text);
}

/** A CSS-wide keyword sets the longhand itself, or every longhand of the shorthand. */
function expandWide(property: string, value: CssValue): LonghandValue[] {
  const wide = isShorthand(property) ? shorthandHandler(property).expandWide : undefined;
  if (wide !== undefined) return wide(value);
  const targets: readonly Longhand[] = isLonghand(property) ? [property] : shorthandHandler(property as Shorthand).longhands;
  return targets.map((p) => ({ property: p, value, explicit: true }));
}
