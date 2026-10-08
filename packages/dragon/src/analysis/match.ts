// Selector matching over the linked tree (selectors are parsed in css/selectors.ts). Each case tree is fixed, so every
// structural match (siblings, :nth-*, :empty, :has()) is decided at build time; state-dependent children are already
// enumerated into one tree per reachable assignment by link.ts.
import type { AttributeTest, Compound, PseudoClass, RangePart, Selector, Specificity } from '../css/selectors.ts';
import { specificityOf } from '../css/selectors.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { LinkedElement, LinkedText } from './link.ts';

/**
 * The interaction state a match runs in (SELD-R2, analysis/interaction.ts): the element addresses that match :hover, :active,
 * :focus and :focus-visible. probe, when given, records every address an interaction pseudo-class is tested against.
 */
export type InteractionState = {
  readonly hover: ReadonlySet<string>;
  readonly active: ReadonlySet<string>;
  readonly focus: ReadonlySet<string>;
  readonly focusVisible: ReadonlySet<string>;
  readonly probe?: InteractionProbe;
};
export type InteractionProbe = { readonly hover: Set<string>; readonly active: Set<string>; readonly focus: Set<string>; readonly focusVisible: Set<string> };

/** No element hovered, pressed or focused: every match is the match without interaction states. */
export const NO_INTERACTION: InteractionState = { hover: new Set(), active: new Set(), focus: new Set(), focusVisible: new Set() };

/** An element with its ancestors: path[0] is the document element, the last entry the element itself. */
type Path = readonly LinkedElement[];

/**
 * The HTML document's <head>: the first element child of <html> in every web rendering, and absent from the logical tree. It is
 * modelled as an element with no class symbols, no attributes and unknown, non-empty contents.
 */
const HEAD: LinkedElement = { kind: 'element', address: ':head', node: null as never, instance: '', owner: '', tag: 'head', classes: [], attributes: new Map(), children: [] };

const last = (path: Path): LinkedElement => path[path.length - 1] as LinkedElement;
const isElement = (c: LinkedElement | LinkedText): c is LinkedElement => c.kind === 'element';

/** The element children of the path's parent, and the element's index among them (the root is the document's only element). */
function siblings(path: Path): { readonly list: readonly LinkedElement[]; readonly index: number } {
  const el = last(path);
  if (path.length === 1) return { list: [el], index: 0 };
  const parent = path[path.length - 2] as LinkedElement;
  const kids = parent.children.filter(isElement);
  const list = path.length === 2 && parent.tag === 'html' ? [HEAD, ...kids] : kids;
  return { list, index: list.indexOf(el) };
}

const withLast = (path: Path, el: LinkedElement): Path => [...path.slice(0, -1), el];

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const WHITE = /[ \t\n\r\f]/;

/**
 * HTML §4.16.2: attributes whose values compare ASCII case-insensitively in selectors on HTML elements, keyed by name whatever
 * the element. Blink 145.0.7632.6 HTMLDocument::IsCaseSensitiveAttribute (html_document.cc) holds the same 46 names, and
 * scripts/capture-selector-validity.ts observes each in Chrome (OBSERVED_ATTRIBUTE_CASE_INSENSITIVE).
 */
export const HTML_CASE_INSENSITIVE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color', 'compact',
  'declare', 'defer', 'dir', 'direction', 'disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang', 'language', 'link',
  'media', 'method', 'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev', 'rules', 'scope', 'scrolling',
  'selected', 'shape', 'target', 'text', 'type', 'valign', 'valuetype', 'vlink',
]);

/**
 * Selectors-4 §6.1-§6.3: case-sensitive unless the i flag is given or the name is in HTML's case-insensitive list. The planted
 * fault attributeCaseAlwaysSensitive ignores the list.
 */
function attributeMatches(el: LinkedElement, a: AttributeTest, faults: CompilerFaults): boolean {
  const actual = el.attributes.get(a.name);
  if (actual === undefined) return false;
  if (a.matcher === null || a.value === null) return true;
  const fold = a.caseInsensitive || (!faults.attributeCaseAlwaysSensitive && HTML_CASE_INSENSITIVE_ATTRIBUTES.has(a.name));
  const v = fold ? asciiLower(actual) : actual;
  const w = fold ? asciiLower(a.value) : a.value;
  switch (a.matcher) {
    case '=':
      return v === w;
    case '~=':
      return w !== '' && !WHITE.test(w) && v.split(/[ \t\n\r\f]+/).includes(w);
    case '|=':
      return v === w || v.startsWith(`${w}-`);
    case '^=':
      return w !== '' && v.startsWith(w);
    case '$=':
      return w !== '' && v.endsWith(w);
    case '*=':
      return w !== '' && v.includes(w);
  }
}

/**
 * Selectors-4 §14.2 reads :empty as allowing whitespace-only text; Chrome 145 (selector_checker.cc, kPseudoEmpty) counts any
 * non-empty text node, so Dragon follows Chrome. The planted fault emptyIgnoresWhitespace applies the spec reading.
 */
function isEmpty(el: LinkedElement, faults: CompilerFaults): boolean {
  if (el === HEAD) return false;
  return el.children.every((c) => c.kind === 'text' && (c.text === '' || (faults.emptyIgnoresWhitespace && !/[^ \t\n\r\f]/.test(c.text))));
}

/** Whether some n >= 0 gives a*n + b = index (1-based). */
const nthHolds = (a: number, b: number, index: number): boolean => (a === 0 ? index === b : (index - b) % a === 0 && (index - b) / a >= 0);

function pseudoMatches(path: Path, rule: Rule, p: PseudoClass, faults: CompilerFaults, ix: InteractionState): boolean {
  const el = last(path);
  switch (p.kind) {
    case 'root':
      return path.length === 1;
    case 'empty':
      return isEmpty(el, faults);
    case 'nth':
    case 'only': {
      const { list, index } = siblings(path);
      const of = p.kind === 'nth' ? p.of : null;
      const counted = (sib: LinkedElement): boolean =>
        (!p.ofType || sib.tag === el.tag) && (of === null || of.some((s) => complexMatches(rule, s, withLast(path, sib), faults, ix)));
      if (!counted(el)) return false;
      const before = list.slice(0, index).filter(counted).length;
      const after = list.slice(index + 1).filter(counted).length;
      if (p.kind === 'only') return before === 0 && after === 0;
      return nthHolds(p.a, p.b, (p.fromEnd ? after : before) + 1);
    }
    case 'is':
      return p.selectors.some((s) => complexMatches(rule, s, path, faults, ix));
    case 'not':
      return !p.selectors.some((s) => complexMatches(rule, s, path, faults, ix));
    case 'has':
      return p.selectors.some((s) => hasMatches(rule, s, path, faults, ix));
    case 'interaction': {
      const set = p.pseudo === 'focus-visible' ? 'focusVisible' : p.pseudo;
      ix.probe?.[set].add(el.address);
      return ix[set].has(el.address);
    }
  }
}

// A class selector matches only class symbols of the rule's own owner and sheet (docs/api.md §3.1); #id and [name] test the
// element's attributes (every element carrying the id matches, as in Chrome).
function compoundMatches(path: Path, rule: Rule, c: Compound, faults: CompilerFaults, ix: InteractionState): boolean {
  const el = last(path);
  if (c.tag !== null && c.tag !== el.tag) return false;
  if (!c.ids.every((id) => el.attributes.get('id') === id)) return false;
  const classes = faults.variantCollapse && c.classes.length >= 2 ? c.classes.slice(0, -1) : c.classes;
  if (!classes.every((k) => el.classes.some((s) => s.owner === rule.owner && s.sheet === rule.sheet && s.name === k))) return false;
  if (!c.attributes.every((a) => attributeMatches(el, a, faults))) return false;
  return c.pseudos.every((p) => pseudoMatches(path, rule, p, faults, ix));
}

/**
 * Selectors-4 §3.3: right-to-left matching from sel.parts[part] at path, with backtracking for descendant and subsequent-sibling
 * combinators. accept decides the element matched by the leftmost compound (the anchor test of a relative selector).
 */
function matchFrom(rule: Rule, sel: Selector, path: Path, part: number, faults: CompilerFaults, ix: InteractionState, accept: (leftmost: Path) => boolean): boolean {
  const p = sel.parts[part];
  if (p === undefined || !compoundMatches(path, rule, p.compound, faults, ix)) return false;
  const next = sel.parts[part + 1];
  if (next === undefined) return accept(path);
  switch (next.combinator) {
    case '>':
      return path.length > 1 && matchFrom(rule, sel, path.slice(0, -1), part + 1, faults, ix, accept);
    case ' ':
      for (let n = path.length - 1; n >= 1; n--) if (matchFrom(rule, sel, path.slice(0, n), part + 1, faults, ix, accept)) return true;
      return false;
    case '+':
    case '~': {
      const { list, index } = siblings(path);
      for (let i = index - 1; i >= 0 && (next.combinator === '~' || i === index - 1); i--) {
        if (matchFrom(rule, sel, withLast(path, list[i] as LinkedElement), part + 1, faults, ix, accept)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

function complexMatches(rule: Rule, sel: Selector, path: Path, faults: CompilerFaults, ix: InteractionState): boolean {
  return matchFrom(rule, sel, path, 0, faults, ix, () => true);
}

/** Every element below path, with its path, in tree order. */
function descendants(path: Path, out: Path[] = []): Path[] {
  for (const c of last(path).children) {
    if (!isElement(c)) continue;
    const p = [...path, c];
    out.push(p);
    descendants(p, out);
  }
  return out;
}

/** Selectors-4 §4.5: :has() matches when some element relative to the :has() element matches the relative selector. */
function hasMatches(rule: Rule, sel: Selector, anchorPath: Path, faults: CompilerFaults, ix: InteractionState): boolean {
  const anchor = last(anchorPath);
  const depth = anchorPath.length;
  const { list, index } = siblings(anchorPath);
  const following = list.slice(index + 1).filter((s) => s !== HEAD);
  const candidates: Path[] = sel.anchor === '+' || sel.anchor === '~'
    ? following.flatMap((s) => { const p = withLast(anchorPath, s); return [p, ...descendants(p)]; })
    : descendants(anchorPath);
  const accept = (leftmost: Path): boolean => {
    switch (sel.anchor) {
      case '>':
        return leftmost.length === depth + 1 && leftmost[depth - 1] === anchor;
      case '+':
      case '~': {
        if (leftmost.length !== depth || leftmost[depth - 2] !== anchorPath[depth - 2]) return false;
        const at = list.indexOf(last(leftmost));
        return sel.anchor === '+' ? at === index + 1 : at > index;
      }
      default:
        return leftmost.length > depth && leftmost[depth - 1] === anchor;
    }
  };
  return candidates.some((c) => matchFrom(rule, sel, c, 0, faults, ix, accept));
}

/**
 * Matches sel against chain[index] (chain holds the element's logical ancestors first). part must be 0: the subject.
 */
export function selectorMatches(rule: Rule, sel: Selector, chain: readonly LinkedElement[], index: number, part: number, faults: CompilerFaults, ix: InteractionState = NO_INTERACTION): boolean {
  if (index < 0 || chain[index] === undefined) return false;
  if (sel.dropped && !faults.invalidSelectorListKept) return false;
  // A range pseudo-element selector styles the part, never the element (cascade.ts runs it per part).
  if (sel.pseudoElement !== null) return false;
  return matchFrom(rule, sel, chain.slice(0, index + 1), part, faults, ix, () => true);
}

/** Matches a range pseudo-element selector against the range part rangePart of the input chain[chain.length - 1]. */
export function partSelectorMatches(rule: Rule, sel: Selector, chain: readonly LinkedElement[], rangePart: RangePart, faults: CompilerFaults, ix: InteractionState = NO_INTERACTION): boolean {
  if (chain.length === 0 || sel.pseudoElement !== rangePart) return false;
  if (sel.dropped && !faults.invalidSelectorListKept) return false;
  return matchFrom(rule, sel, chain, 0, faults, ix, () => true);
}

/**
 * The specificity the cascade uses: the parsed one, or a planted fault's: :is() with its first argument's instead of the largest,
 * or ids counted as classes.
 */
export function specificityFor(sel: Selector, faults: CompilerFaults): Specificity {
  return faults.isSpecificityFirstArgument || faults.idSpecificityAsClass ? specificityOf(sel, faults.isSpecificityFirstArgument, faults.idSpecificityAsClass) : sel.specificity;
}
