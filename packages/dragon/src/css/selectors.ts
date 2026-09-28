// Selector parsing: the selector list of a style rule into right-to-left compounds with their specificity. Matching lives in
// analysis/match.ts.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import { PSEUDO_CLASS_VALID, PSEUDO_ELEMENT_VALID } from './selector-validity.generated.ts';
import type { SheetUse } from './stylesheet.ts';

/** Selectors-4 §6 attribute operators; null tests presence only. */
export type AttributeMatcher = '=' | '~=' | '|=' | '^=' | '$=' | '*=';
/** [name], [name op "value"] and [name op "value" i]; name is ASCII-lowercased (HTML documents). */
export type AttributeTest = { readonly name: string; readonly value: string | null; readonly matcher: AttributeMatcher | null; readonly caseInsensitive: boolean };
export type Combinator = ' ' | '>' | '+' | '~';

/**
 * The structural pseudo-classes (Selectors-4 §4, §14). nth covers :first-, :last-, :nth-, :nth-last- -child and -of-type
 * (a and b of An+B; of: the "of S" filter); only covers :only-child and :only-of-type.
 */
export type PseudoClass =
  | { readonly kind: 'root' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'nth'; readonly a: number; readonly b: number; readonly fromEnd: boolean; readonly ofType: boolean; readonly of: readonly Selector[] | null }
  | { readonly kind: 'only'; readonly ofType: boolean }
  | { readonly kind: 'is'; readonly where: boolean; readonly selectors: readonly Selector[] }
  | { readonly kind: 'not'; readonly selectors: readonly Selector[] }
  | { readonly kind: 'has'; readonly selectors: readonly Selector[] };

export type Compound = {
  readonly tag: string | null;
  /** #id selectors: each matches the element's id attribute, case-sensitively (no-quirks documents). */
  readonly ids: readonly string[];
  readonly classes: readonly string[];
  readonly attributes: readonly AttributeTest[];
  readonly pseudos: readonly PseudoClass[];
};
export type Specificity = readonly [number, number, number];
/**
 * Right-to-left: parts[0] is the subject; each later part is joined to the previous by its combinator. anchor: in a :has()
 * argument, the combinator joining the leftmost compound to the :has() element (Selectors-4 §3.4 relative selectors); else null.
 */
export type Selector = {
  readonly parts: readonly { readonly compound: Compound; readonly combinator: Combinator | null }[];
  readonly specificity: Specificity;
  readonly anchor: Combinator | null;
  /**
   * The rule's selector list holds a selector Chrome 145 does not parse, so Chrome drops the whole rule: this selector never
   * matches (the planted fault invalidSelectorListKept keeps it).
   */
  readonly dropped: boolean;
};

const SELECTOR_FIX =
  'Use type, class, id, attribute and structural pseudo-class selectors (:root, :empty, :first-child, :nth-child(), :is(), :where(), :not(), :has() and the like), joined by descendant, child or sibling combinators.';
const INTERACTIVE = new Set(['hover', 'focus', 'active', 'focus-visible', 'focus-within', 'target', 'visited', 'link', 'any-link', 'checked', 'disabled', 'enabled']);
const COMBINATORS: ReadonlySet<string> = new Set([' ', '>', '+', '~']);
const ZERO: Specificity = [0, 0, 0];

const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const greater = (a: Specificity, b: Specificity): boolean => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);

/**
 * Selectors-4 §17: the most specific complex selector of an :is(), :not(), :has() or "of S" argument. firstArgumentOfIs is the
 * planted fault: :is() takes its first argument's specificity instead.
 */
function maxSpecificity(selectors: readonly Selector[], firstArgumentOfIs: boolean, idAsClass: boolean): Specificity {
  let best = ZERO;
  for (const s of selectors) {
    const sp = specificityOf(s, firstArgumentOfIs, idAsClass);
    if (greater(sp, best)) best = sp;
  }
  return best;
}

/**
 * Selectors-4 §17 specificity of a complex selector; firstArgumentOfIs applies the planted fault (see maxSpecificity), idAsClass
 * the planted fault idSpecificityAsClass (an id counts in the class column).
 */
export function specificityOf(sel: Selector, firstArgumentOfIs = false, idAsClass = false): Specificity {
  let total = ZERO;
  for (const { compound: c } of sel.parts) {
    const ids = c.ids.length;
    total = add(total, [idAsClass ? 0 : ids, c.classes.length + c.attributes.length + (idAsClass ? ids : 0), c.tag === null ? 0 : 1]);
    for (const p of c.pseudos) {
      if (p.kind === 'is' && p.where) continue;
      if (p.kind === 'is') total = add(total, firstArgumentOfIs ? (p.selectors[0] === undefined ? ZERO : specificityOf(p.selectors[0], true, idAsClass)) : maxSpecificity(p.selectors, false, idAsClass));
      else if (p.kind === 'not' || p.kind === 'has') total = add(total, maxSpecificity(p.selectors, firstArgumentOfIs, idAsClass));
      else total = add(total, add([0, 1, 0], p.kind === 'nth' && p.of !== null ? maxSpecificity(p.of, firstArgumentOfIs, idAsClass) : ZERO));
    }
  }
  return total;
}

type Refuse = (node: CssNode, message: string, manual?: string) => void;
/** forgiving: inside an :is() or :where() argument list; drop: records a selector Chrome 145 does not parse. */
type Context = { readonly insideHas: boolean; readonly forgiving: boolean; readonly drop: (node: CssNode, text: string) => void };

/**
 * A selector Chrome 145 does not parse (selector-validity.generated.ts). Outside :is() and :where() Chrome drops the whole rule,
 * and so does Dragon; inside them Chrome drops only that argument (a forgiving list), which Dragon refuses rather than models.
 */
function chromeInvalid(node: CssNode, text: string, ctx: Context, refuse: Refuse): void {
  if (ctx.forgiving) refuse(node, `${text} is invalid in Chrome 145, which drops only that argument of the forgiving :is() or :where() list; Dragon does not model forgiving lists`, 'Remove the invalid selector from the :is() or :where() argument.');
  else ctx.drop(node, text);
}

/** The package that owns the rendering of a pseudo-element Chrome 145 parses. */
function pseudoElementOwner(name: string): string {
  if (name === '-webkit-slider-thumb' || name === '-webkit-slider-runnable-track') return 'the form-control package FORM-a';
  if (name.startsWith('-webkit-scrollbar')) return 'the scrollbar package OVFL-s';
  return 'a later package';
}

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** css-syntax-3 An+B from css-tree's Nth node: AnPlusB, or the identifiers odd and even. */
function anPlusB(nth: CssNode): { a: number; b: number } | null {
  if (nth.type === 'Identifier') {
    const name = asciiLower(String(nth['name']));
    return name === 'odd' ? { a: 2, b: 1 } : name === 'even' ? { a: 2, b: 0 } : null;
  }
  if (nth.type !== 'AnPlusB') return null;
  const a = nth['a'] === null ? 0 : Number(nth['a']);
  const b = nth['b'] === null ? 0 : Number(nth['b']);
  return Number.isInteger(a) && Number.isInteger(b) ? { a, b } : null;
}

const NTH: Record<string, { fromEnd: boolean; ofType: boolean }> = {
  'nth-child': { fromEnd: false, ofType: false },
  'nth-last-child': { fromEnd: true, ofType: false },
  'nth-of-type': { fromEnd: false, ofType: true },
  'nth-last-of-type': { fromEnd: true, ofType: true },
};
const FIXED_NTH: Record<string, PseudoClass> = {
  'first-child': { kind: 'nth', a: 0, b: 1, fromEnd: false, ofType: false, of: null },
  'last-child': { kind: 'nth', a: 0, b: 1, fromEnd: true, ofType: false, of: null },
  'first-of-type': { kind: 'nth', a: 0, b: 1, fromEnd: false, ofType: true, of: null },
  'last-of-type': { kind: 'nth', a: 0, b: 1, fromEnd: true, ofType: true, of: null },
  'only-child': { kind: 'only', ofType: false },
  'only-of-type': { kind: 'only', ofType: true },
  root: { kind: 'root' },
  empty: { kind: 'empty' },
};

function parsePseudoClass(part: CssNode, ctx: Context, refuse: Refuse): PseudoClass | null {
  const name = asciiLower(String(part['name']));
  const args = part['children'] === null ? null : list(part, 'children');
  const text = generate(part);
  if (args === null && PSEUDO_CLASS_VALID[name]?.valid === false) {
    chromeInvalid(part, text, ctx, refuse);
    return null;
  }
  if (INTERACTIVE.has(name)) {
    refuse(part, `${text} depends on user interaction or document state, which a later package models as runtime state`, 'Model the state as a component state and select it with a class or a [ui-*] attribute.');
    return null;
  }
  const fixed = FIXED_NTH[name];
  if (fixed !== undefined && args === null) return fixed;
  const nth = NTH[name];
  if (nth !== undefined && args !== null && args.length === 1 && (args[0] as CssNode).type === 'Nth') {
    const node = args[0] as CssNode;
    const ab = anPlusB(node['nth'] as CssNode);
    if (ab === null) {
      refuse(part, `${text} has an An+B Dragon cannot read`);
      return null;
    }
    const ofNode = node['selector'] as CssNode | null;
    if (ofNode !== null && nth.ofType) {
      refuse(part, `${text} is invalid: only :nth-child() and :nth-last-child() take "of S" (Selectors-4 §14.4)`);
      return null;
    }
    const of = ofNode === null ? null : parseList(ofNode, null, ctx, refuse);
    if (of === undefined) return null;
    return { kind: 'nth', a: ab.a, b: ab.b, fromEnd: nth.fromEnd, ofType: nth.ofType, of };
  }
  if ((name === 'is' || name === 'where' || name === 'matches' || name === 'not' || name === 'has') && args !== null) {
    if (name === 'matches') {
      refuse(part, `${text} is not supported: use :is()`);
      return null;
    }
    if (name === 'has' && ctx.insideHas) {
      refuse(part, `${text} is invalid inside :has() (Selectors-4 §4.5), and Chrome drops the rule`, 'Move the inner :has() out of the :has() argument.');
      return null;
    }
    const argList = args[0];
    if (args.length === 0 && (name === 'is' || name === 'where')) return { kind: 'is', where: name === 'where', selectors: [] };
    if (args.length !== 1 || argList === undefined || argList.type !== 'SelectorList' || list(argList, 'children').length === 0) {
      refuse(part, `${text} needs a selector list argument`);
      return null;
    }
    const forgiving = name === 'is' || name === 'where' ? true : ctx.forgiving;
    const inner = parseList(argList, name === 'has' ? ' ' : null, { ...ctx, insideHas: ctx.insideHas || name === 'has', forgiving }, refuse);
    if (inner === undefined) return null;
    if (name === 'has') return { kind: 'has', selectors: inner };
    if (name === 'not') return { kind: 'not', selectors: inner };
    return { kind: 'is', where: name === 'where', selectors: inner };
  }
  refuse(part, `${text} is not supported`);
  return null;
}

/** A selector list; relative: the default anchor of a :has() argument (its selectors may start with a combinator). undefined: refused. */
function parseList(node: CssNode, relative: Combinator | null, ctx: Context, refuse: Refuse): Selector[] | undefined {
  const out: Selector[] = [];
  let ok = true;
  for (const sel of list(node, 'children')) {
    const s = parseComplex(sel, relative, ctx, refuse);
    if (s === null) ok = false;
    else out.push(s);
  }
  return ok ? out : undefined;
}

function parseComplex(sel: CssNode, relative: Combinator | null, ctx: Context, refuse: Refuse): Selector | null {
  if (sel.type !== 'Selector') {
    refuse(sel, `selector "${generate(sel)}" is not supported`);
    return null;
  }
  type Mutable = { tag: string | null; ids: string[]; classes: string[]; attributes: AttributeTest[]; pseudos: PseudoClass[] };
  const compounds: { compound: Mutable; combinator: Combinator | null }[] = [];
  const fresh = (): Mutable => ({ tag: null, ids: [], classes: [], attributes: [], pseudos: [] });
  let current = fresh();
  let started = false;
  let pending: Combinator | null = null;
  let anchor: Combinator | null = relative;
  let ok = true;
  for (const part of list(sel, 'children')) {
    if (part.type === 'Combinator') {
      const name = String(part['name']);
      if (!COMBINATORS.has(name)) {
        ok = false;
        refuse(part, `combinator "${name}" is not supported`);
        continue;
      }
      if (!started) {
        if (relative === null) {
          ok = false;
          refuse(part, `selector "${generate(sel)}" starts with a combinator outside :has()`);
        } else anchor = name as Combinator;
        continue;
      }
      compounds.push({ compound: current, combinator: pending });
      pending = name as Combinator;
      current = fresh();
      continue;
    }
    started = true;
    if (part.type === 'TypeSelector') {
      const name = String(part['name']);
      if (name.includes('|')) {
        ok = false;
        refuse(part, `namespaced selector "${name}" is not supported`);
      } else if (name !== '*') current.tag = asciiLower(name);
    } else if (part.type === 'ClassSelector') {
      current.classes.push(String(part['name']));
    } else if (part.type === 'IdSelector') {
      current.ids.push(String(part['name']));
    } else if (part.type === 'AttributeSelector') {
      const test = parseAttribute(part, refuse);
      if (test === null) ok = false;
      else current.attributes.push(test);
    } else if (part.type === 'PseudoClassSelector') {
      const p = parsePseudoClass(part, ctx, refuse);
      if (p === null) ok = false;
      else current.pseudos.push(p);
    } else if (part.type === 'PseudoElementSelector') {
      ok = false;
      const name = asciiLower(String(part['name']));
      if (part['children'] === null && PSEUDO_ELEMENT_VALID[name]?.valid === false) chromeInvalid(part, generate(part), ctx, refuse);
      else refuse(part, `pseudo-element ${generate(part)} is not supported: pseudo-elements generate boxes Dragon does not build yet (${pseudoElementOwner(name)})`, 'Style a real element instead of the pseudo-element.');
    } else {
      ok = false;
      refuse(part, `selector part "${generate(part)}" is not supported`);
    }
  }
  if (!ok) return null;
  compounds.push({ compound: current, combinator: pending });
  const parts = compounds.reverse().map((c, i, all) => ({
    compound: c.compound as Compound,
    combinator: i === 0 ? null : (all[i - 1] as { combinator: Combinator | null }).combinator,
  }));
  const partial: Selector = { parts, specificity: ZERO, anchor: relative === null ? null : anchor, dropped: false };
  return { ...partial, specificity: specificityOf(partial) };
}

function parseAttribute(part: CssNode, refuse: Refuse): AttributeTest | null {
  const nameNode = part['name'] as CssNode;
  const raw = String(nameNode['name']);
  const name = asciiLower(raw);
  const matcher = part['matcher'] as AttributeMatcher | null;
  const valueNode = part['value'] as CssNode | null;
  const flags = part['flags'] === null ? null : asciiLower(String(part['flags']));
  if (raw.includes('|')) {
    refuse(part, `attribute selector "${generate(part)}" is not supported: namespaced attribute names are not`);
    return null;
  }
  if (flags === 's') {
    refuse(part, `attribute selector "${generate(part)}" is invalid in Chrome 145, which does not implement the s flag and drops the rule`, 'Remove the s flag; attribute values outside HTML\'s case-insensitive list already compare case-sensitively.');
    return null;
  }
  if (flags !== null && flags !== 'i') {
    refuse(part, `attribute selector "${generate(part)}" has an unknown flag`);
    return null;
  }
  const value = valueNode === null ? null : valueNode.type === 'String' ? String(valueNode['value']) : String(valueNode['name']);
  return { name, value, matcher, caseInsensitive: flags === 'i' };
}

/** Whether the subject compound can only match elements carrying one of the owner's class symbols. */
function subjectNeedsClass(sel: Selector): boolean {
  const subject = (sel.parts[0] as { compound: Compound }).compound;
  return subject.classes.length > 0 || subject.pseudos.some((p) => p.kind === 'is' && p.selectors.length > 0 && p.selectors.every(subjectNeedsClass));
}

// Selectors-4: type, universal, class, id, attribute and structural pseudo-class compounds, joined by descendant, child and
// sibling combinators, matched at build time on the fixed element tree (docs/decisions.md "Selectors and scrollbars"). In a
// component-scoped sheet the subject compound needs a class, so the rule can only style elements carrying the owner's symbols.
// A list holding a selector Chrome 145 does not parse is dropped whole, as Chrome drops the rule: its selectors never match.
export function parseSelectorList(prelude: CssNode, base: Span, use: SheetUse, diagnostics: Diagnostic[]): Selector[] | null {
  const out: Selector[] = [];
  const refusals: Diagnostic[] = [];
  const drops: { node: CssNode; text: string }[] = [];
  let ok = true;
  const refuse: Refuse = (node, message, manual = SELECTOR_FIX) => {
    ok = false;
    refusals.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', { origin: authored(spanOf(node, base)), message, manual }));
  };
  const ctx: Context = { insideHas: false, forgiving: false, drop: (node, text) => drops.push({ node, text }) };
  for (const sel of list(prelude, 'children')) {
    const s = parseComplex(sel, null, ctx, refuse);
    if (s === null) continue;
    if (use.scope === 'component' && !subjectNeedsClass(s)) {
      refuse(sel, `the subject compound of "${generate(sel)}" needs a class in a component-scoped sheet, so it can only style the owner's elements`);
      continue;
    }
    out.push(s);
  }
  const first = drops[0];
  if (first !== undefined) {
    diagnostics.push(diagnostic('DRAGON_SELECTOR_DROPPED', {
      origin: authored(spanOf(first.node, base)),
      message: `the rule "${generate(prelude)}" is dropped: Chrome 145 does not parse ${first.text}, so it drops the whole rule, and Dragon drops it too`,
    }));
    return out.map((s) => ({ ...s, dropped: true }));
  }
  diagnostics.push(...refusals);
  return ok ? out : null;
}
