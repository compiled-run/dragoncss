// Selector matching over the linked tree (selectors are parsed in css/selectors.ts). Each case tree is fixed, so every
// structural match (siblings, :nth-*, :empty, :has()) is decided at build time; state-dependent children are already
// enumerated into one tree per reachable assignment by link.ts.
import type { AttributeTest, Compound, PseudoClass, Selector, Specificity } from '../css/selectors.ts';
import { specificityOf } from '../css/selectors.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { LinkedElement, LinkedText } from './link.ts';

/** An element with its ancestors: path[0] is the document element, the last entry the element itself. */
type Path = readonly LinkedElement[];

/**
 * The HTML document's <head>: the first element child of <html> in every web rendering, and absent from the logical tree. It is
 * modelled as an element with no class symbols, no ui-* attributes and unknown, non-empty contents.
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

/** Selectors-4 §6.1-§6.3 (case-sensitive unless the i flag is given, since ui-* values are not in HTML's case-insensitive list). */
function attributeMatches(el: LinkedElement, a: AttributeTest): boolean {
  const actual = el.attributes.get(a.name);
  if (actual === undefined) return false;
  if (a.matcher === null || a.value === null) return true;
  const v = a.caseInsensitive ? asciiLower(actual) : actual;
  const w = a.caseInsensitive ? asciiLower(a.value) : a.value;
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

function pseudoMatches(path: Path, rule: Rule, p: PseudoClass, faults: CompilerFaults): boolean {
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
        (!p.ofType || sib.tag === el.tag) && (of === null || of.some((s) => complexMatches(rule, s, withLast(path, sib), faults)));
      if (!counted(el)) return false;
      const before = list.slice(0, index).filter(counted).length;
      const after = list.slice(index + 1).filter(counted).length;
      if (p.kind === 'only') return before === 0 && after === 0;
      return nthHolds(p.a, p.b, (p.fromEnd ? after : before) + 1);
    }
    case 'is':
      return p.selectors.some((s) => complexMatches(rule, s, path, faults));
    case 'not':
      return !p.selectors.some((s) => complexMatches(rule, s, path, faults));
    case 'has':
      return p.selectors.some((s) => hasMatches(rule, s, path, faults));
  }
}

// A class selector matches only class symbols of the rule's own owner and sheet (docs/api.md §3.1); [ui-*] tests the attribute.
function compoundMatches(path: Path, rule: Rule, c: Compound, faults: CompilerFaults): boolean {
  const el = last(path);
  if (c.tag !== null && c.tag !== el.tag) return false;
  const classes = faults.variantCollapse && c.classes.length >= 2 ? c.classes.slice(0, -1) : c.classes;
  if (!classes.every((k) => el.classes.some((s) => s.owner === rule.owner && s.sheet === rule.sheet && s.name === k))) return false;
  if (!c.attributes.every((a) => attributeMatches(el, a))) return false;
  return c.pseudos.every((p) => pseudoMatches(path, rule, p, faults));
}

/**
 * Selectors-4 §3.3: right-to-left matching from sel.parts[part] at path, with backtracking for descendant and subsequent-sibling
 * combinators. accept decides the element matched by the leftmost compound (the anchor test of a relative selector).
 */
function matchFrom(rule: Rule, sel: Selector, path: Path, part: number, faults: CompilerFaults, accept: (leftmost: Path) => boolean): boolean {
  const p = sel.parts[part];
  if (p === undefined || !compoundMatches(path, rule, p.compound, faults)) return false;
  const next = sel.parts[part + 1];
  if (next === undefined) return accept(path);
  switch (next.combinator) {
    case '>':
      return path.length > 1 && matchFrom(rule, sel, path.slice(0, -1), part + 1, faults, accept);
    case ' ':
      for (let n = path.length - 1; n >= 1; n--) if (matchFrom(rule, sel, path.slice(0, n), part + 1, faults, accept)) return true;
      return false;
    case '+':
    case '~': {
      const { list, index } = siblings(path);
      for (let i = index - 1; i >= 0 && (next.combinator === '~' || i === index - 1); i--) {
        if (matchFrom(rule, sel, withLast(path, list[i] as LinkedElement), part + 1, faults, accept)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

function complexMatches(rule: Rule, sel: Selector, path: Path, faults: CompilerFaults): boolean {
  return matchFrom(rule, sel, path, 0, faults, () => true);
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
function hasMatches(rule: Rule, sel: Selector, anchorPath: Path, faults: CompilerFaults): boolean {
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
  return candidates.some((c) => matchFrom(rule, sel, c, 0, faults, accept));
}

/**
 * Matches sel against chain[index] (chain holds the element's logical ancestors first). part must be 0: the subject.
 */
export function selectorMatches(rule: Rule, sel: Selector, chain: readonly LinkedElement[], index: number, part: number, faults: CompilerFaults): boolean {
  if (index < 0 || chain[index] === undefined) return false;
  return matchFrom(rule, sel, chain.slice(0, index + 1), part, faults, () => true);
}

/** The specificity the cascade uses: the parsed one, or the planted :is() fault's (its first argument's instead of the largest). */
export function specificityFor(sel: Selector, faults: CompilerFaults): Specificity {
  return faults.isSpecificityFirstArgument ? specificityOf(sel, true) : sel.specificity;
}
