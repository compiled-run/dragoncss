// @supports (css-conditional-3 §6, CASC): evaluated at build time, as Chrome 145 evaluates it, so a true condition's rules are
// plain rules and a false one's never apply. Dragon decides a <supports-decl> by parsing the declaration as in a style rule
// (stylesheet.ts declarationSupport): a declaration Chrome keeps is supported and one Chrome drops is not, and a declaration of a
// property Chrome 145 does not parse at all (measured, property-names.generated.ts) is not supported. Anything Dragon cannot
// decide (a property or value it refuses, selector(), font-tech(), font-format(), <general-enclosed>) refuses the whole at-rule.
// Only types come from at-rules.ts, so the two modules can import each other.
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ComponentValue } from '../../media/tokens.ts';
import { componentValues, isWhitespace, tokenize } from '../../media/tokens.ts';
import type { AtRuleContext, AtRuleOutcome } from '../at-rules.ts';
import { asciiLower } from '../escapes.ts';
import { CHROME_UNKNOWN_PROPERTIES } from '../property-names.generated.ts';
import { declarationSupport } from '../stylesheet.ts';

const CHROME_UNKNOWN: ReadonlySet<string> = new Set(CHROME_UNKNOWN_PROPERTIES);

/** A parsed supports condition; decl holds the declaration text as written inside its parentheses. */
export type SupportsCondition =
  | { readonly type: 'decl'; readonly text: string; readonly property: string }
  | { readonly type: 'not'; readonly operand: SupportsCondition }
  | { readonly type: 'and' | 'or'; readonly operands: readonly SupportsCondition[] };

/** Thrown inside the parser for a form Dragon does not evaluate; the message says which. */
class Undecided extends Error {}

const trim = (cvs: readonly ComponentValue[]): readonly ComponentValue[] => {
  let a = 0;
  let b = cvs.length;
  while (a < b && isWhitespace(cvs[a] as ComponentValue)) a++;
  while (b > a && isWhitespace(cvs[b - 1] as ComponentValue)) b--;
  return cvs.slice(a, b);
};

const identOf = (cv: ComponentValue | undefined): string | null => (cv !== undefined && cv.kind === 'token' && cv.token.type === 'ident' ? asciiLower(cv.token.value) : null);

/** css-conditional-3 §6.1: <supports-condition> over the component values of a prelude or a parenthesized block. */
function condition(src: string, input: readonly ComponentValue[]): SupportsCondition {
  const cvs = trim(input);
  if (cvs.length === 0) throw new Undecided('an empty condition');
  if (identOf(cvs[0]) === 'not') {
    if (cvs.length < 2 || !isWhitespace(cvs[1] as ComponentValue)) throw new Undecided('"not" not followed by white space');
    const rest = trim(cvs.slice(1));
    if (rest.length !== 1) throw new Undecided(`"${src.slice(cvs[0]?.start ?? 0, cvs[cvs.length - 1]?.end ?? 0)}" is not one condition after "not"`);
    return { type: 'not', operand: inParens(src, rest[0] as ComponentValue) };
  }
  const operands: SupportsCondition[] = [];
  let op: 'and' | 'or' | null = null;
  let i = 0;
  for (;;) {
    operands.push(inParens(src, cvs[i] as ComponentValue));
    i++;
    if (i === cvs.length) break;
    // An operator must stand between white space: "(a)and (b)" is not a condition.
    if (!isWhitespace(cvs[i] as ComponentValue)) throw new Undecided('an operator without white space before it');
    while (i < cvs.length && isWhitespace(cvs[i] as ComponentValue)) i++;
    const word = identOf(cvs[i]);
    if (word !== 'and' && word !== 'or') throw new Undecided(`"${src.slice(cvs[i]?.start ?? 0, cvs[i]?.end ?? 0)}" where "and" or "or" was expected`);
    // §6.1: "and" and "or" do not mix without parentheses.
    if (op !== null && op !== word) throw new Undecided('"and" and "or" mixed without parentheses');
    op = word;
    i++;
    if (i >= cvs.length || !isWhitespace(cvs[i] as ComponentValue)) throw new Undecided(`"${word}" not followed by white space`);
    while (i < cvs.length && isWhitespace(cvs[i] as ComponentValue)) i++;
    if (i === cvs.length) throw new Undecided(`nothing after "${word}"`);
  }
  return op === null ? (operands[0] as SupportsCondition) : { type: op, operands };
}

/** <supports-in-parens>: a parenthesized condition or a <supports-decl>; a function or other block is refused. */
function inParens(src: string, cv: ComponentValue): SupportsCondition {
  if (cv.kind === 'function') throw new Undecided(`${asciiLower(cv.name)}() is not evaluated`);
  if (cv.kind !== 'block' || cv.open !== '(') throw new Undecided(`"${src.slice(cv.start, cv.end)}" is not a parenthesized condition or declaration`);
  const inner = trim(cv.children);
  const first = inner[0];
  const second = trim(inner.slice(1))[0];
  // <supports-decl> = ( <declaration> ): a name, then a colon.
  if (first !== undefined && first.kind === 'token' && first.token.type === 'ident' && second !== undefined && second.kind === 'token' && second.token.type === 'colon') {
    return { type: 'decl', text: src.slice(first.start, (inner[inner.length - 1] as ComponentValue).end), property: first.token.value.startsWith('--') ? first.token.value : asciiLower(first.token.value) };
  }
  if (identOf(first) === 'not' || (first !== undefined && first.kind === 'block' && first.open === '(')) return condition(src, inner);
  throw new Undecided(`"${src.slice(cv.start, cv.end)}" is <general-enclosed>, which Dragon does not evaluate`);
}

/** Parses a @supports prelude; a string says why Dragon does not evaluate it. */
export function parseSupportsCondition(prelude: string): SupportsCondition | string {
  try {
    return condition(prelude, componentValues(tokenize(prelude), prelude.length));
  } catch (e) {
    if (e instanceof Undecided) return e.message;
    throw e;
  }
}

/** Evaluates a parsed condition as Chrome 145 does; a string says which declaration Dragon cannot decide, and why. */
export function evaluateSupports(c: SupportsCondition): boolean | string {
  switch (c.type) {
    case 'decl': {
      // A property Chrome 145 does not parse makes the declaration invalid whatever its value (measured: property-names.generated.ts).
      if (CHROME_UNKNOWN.has(c.property)) return false;
      const s = declarationSupport(c.text);
      return s === 'valid' ? true : s === 'invalid' ? false : `Dragon cannot tell whether Chrome keeps (${c.text}) (${s.refused})`;
    }
    case 'not': {
      const v = evaluateSupports(c.operand);
      return typeof v === 'string' ? v : !v;
    }
    case 'and':
    case 'or': {
      // A false operand settles "and" and a true one settles "or" whatever the undecided operands are, as Chrome's answer for
      // them can only be true or false; otherwise an undecided operand refuses the rule.
      const vs = c.operands.map(evaluateSupports);
      const settles = c.type === 'and' ? false : true;
      if (vs.includes(settles)) return settles;
      const undecided = vs.find((v) => typeof v === 'string');
      return undecided ?? !settles;
    }
  }
}

/** @supports with a block is decided here; the parse driver keeps a true one's rules and drops a false one's. A declaration, so
 * at-rules.ts can register it whichever module of the import cycle loads first. */
export function supportsAtRule(at: AtRuleContext): AtRuleOutcome {
  const prelude = at.prelude ?? '';
  const parsed = parseSupportsCondition(prelude);
  const value = typeof parsed === 'string' ? parsed : evaluateSupports(parsed);
  if (typeof value === 'boolean') return { kind: 'supports', holds: value, text: prelude.trim() };
  return {
    kind: 'refuse',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(at.span),
      message: `@supports ${prelude.trim()} in ${at.where} is not supported: ${value}; Dragon decides a condition built from not, and, or and (property: value) declarations it parses`,
    }),
  };
}
