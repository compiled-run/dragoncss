// css-variables-1: custom properties and var() substitution, fully resolved at build time over the known element tree. Custom
// properties cascade (cascade.ts) and inherit like any inherited property; var() references in them are substituted on the element
// that declares them, so children inherit the substituted value. As in Chrome, references resolve lazily, a fallback is resolved
// only when it is used, and every var() of a value is resolved even after one fails, so cycles are found the same way.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { Longhand, Shorthand } from '../css/properties.ts';
import type { Declaration, LonghandValue } from '../css/stylesheet.ts';
import { parseSubstitutedValue } from '../css/stylesheet.ts';
import type { VarPart } from '../css/variables.ts';
import type { Candidate } from './cascade.ts';

/** css-variables-1 §2: an element's computed custom properties by name; an absent name holds the guaranteed-invalid value. */
export type CustomProperties = ReadonlyMap<string, string>;

/**
 * The var() substitution of one declaration on one element. text: the value after substitution, null when a reference had no
 * value and no fallback. invalid: the declaration is invalid at computed-value time (no text, or text that does not match the
 * grammar). refusal: why Dragon cannot express a value the grammar accepts, or null.
 */
export type Substitution = { readonly source: Declaration; readonly text: string | null; readonly invalid: boolean; readonly refusal: string | null };

/** What substitution reads on one element: its custom properties, and each declaration substituted so far. */
export type VarScope = { readonly customs: CustomProperties; readonly memo: Map<Declaration, SubstitutedDeclaration> };

/** A declaration as its longhands compute after substitution on one element (explicit flags as a literal value would set them). */
export type SubstitutedDeclaration = { readonly declaration: Declaration; readonly substitution: Substitution };

// Comments separate the substituted tokens from their neighbours without adding white space (css-variables-1 §3: substitution
// is of tokens, so "var(--a)var(--b)" with 1 and px is two tokens, never "1px").
const SEPARATOR = '/**/';

// css-variables-1 §3.3: a longer value is invalid at computed-value time (Blink's kMaxVariableBytes, which counts fewer separators).
export const MAX_SUBSTITUTED_LENGTH = 2 * 1024 * 1024;

/**
 * Substitutes every var() in parts; null when any reference had neither a value nor a usable fallback, or the result is too long.
 * lookup is a generator so computeCustoms can resolve a reference without recursing (it yields the names it needs resolved).
 */
function* substituteSteps(parts: readonly VarPart[], lookup: (name: string) => Generator<string, string | null, void>): Generator<string, string | null, void> {
  let out = '';
  // The limit counts the authored text only, never the separators this substitution adds.
  let length = 0;
  let ok = true;
  for (const p of parts) {
    if (p.kind === 'text') {
      if (ok) {
        out += p.text;
        length += p.text.length;
      }
    } else {
      const value = yield* lookup(p.name);
      const used = value !== null ? value : p.fallback === null ? null : yield* substituteSteps(p.fallback, lookup);
      if (used === null) ok = false;
      else if (ok) {
        out += `${SEPARATOR}${used}${SEPARATOR}`;
        length += used.split(SEPARATOR).join('').length;
      }
    }
    if (length > MAX_SUBSTITUTED_LENGTH) {
      ok = false;
      out = '';
    }
  }
  return ok ? out : null;
}

/** substituteSteps with values that are already known. */
function substitute(parts: readonly VarPart[], values: CustomProperties): string | null {
  const r = substituteSteps(parts, function* (name) { return values.get(name) ?? null; }).next();
  if (r.done !== true) throw new Error('substitution with known values asked to resolve a name');
  return r.value;
}

/**
 * css-variables-1 §2.2-§2.3: the computed custom properties of an element from its winning custom declarations and its parent's.
 * initial gives the guaranteed-invalid value; inherit, unset, revert and revert-layer give the parent's value (a custom property
 * is inherited and has no user-agent or layered declarations). A property in a dependency cycle, or whose substitution fails, is
 * invalid at computed-value time and computes to the guaranteed-invalid value.
 */
export function computeCustoms(winners: ReadonlyMap<string, Declaration>, inherited: CustomProperties): CustomProperties {
  const out = new Map(inherited);
  const state = new Map<string, 'resolving' | 'done'>();
  const stack: string[] = [];
  const cyclic = new Set<string>();
  // A referenced name is resolved in a new frame on this heap stack, not the call stack, so a long chain cannot overflow it.
  function* resolve(name: string): Generator<string, void, void> {
    const custom = winners.get(name)?.custom;
    if (custom === undefined || custom.wide !== null || state.get(name) === 'done') return;
    if (state.get(name) === 'resolving') {
      for (const n of stack.slice(stack.indexOf(name))) cyclic.add(n);
      return;
    }
    state.set(name, 'resolving');
    stack.push(name);
    const text = yield* substituteSteps(custom.parts, function* (ref) {
      yield ref;
      return state.get(ref) === 'resolving' || cyclic.has(ref) ? null : (out.get(ref) ?? null);
    });
    stack.pop();
    state.set(name, 'done');
    if (text === null || cyclic.has(name)) out.delete(name);
    else out.set(name, text);
  }
  const run = (name: string): void => {
    const frames = [resolve(name)];
    while (frames.length > 0) {
      const step = (frames[frames.length - 1] as Generator<string, void, void>).next();
      if (step.done === true) frames.pop();
      else frames.push(resolve(step.value));
    }
  };
  for (const [name, d] of winners) if (d.custom?.wide === 'initial') out.delete(name);
  for (const name of winners.keys()) run(name);
  return out;
}

const unset = (property: Longhand): LonghandValue => ({ property, value: { kind: 'keyword', value: 'unset' }, explicit: true });

/** A token of the substituted text as written. */
function tokenText(token: CssNode, text: string): string {
  const loc = token.loc;
  return loc === undefined || loc === null ? generate(token) : readable(text.slice(loc.start.offset, loc.end.offset));
}

/** The value text as an author would read it, without the substitution separators. */
const readable = (text: string): string => text.split(SEPARATOR).join('').trim();

/**
 * css-variables-1 §3.1: a declaration holding var(), substituted with the element's custom properties and parsed against the
 * grammar of its property. An invalid result is invalid at computed-value time: every longhand it sets behaves as unset, as for
 * a shorthand in Chrome. A grammar-valid result Dragon cannot express is refused (Substitution.refusal), and resolves as unset
 * only so the case completes.
 */
export function substituteDeclaration(d: Declaration, customs: CustomProperties): SubstitutedDeclaration {
  const pending = d.pending as NonNullable<Declaration['pending']>;
  const text = substitute(pending.parts, customs);
  const make = (longhands: readonly LonghandValue[], refusal: string | null, isInvalid = false): SubstitutedDeclaration => ({
    declaration: { property: d.property, text: d.text, span: d.span, valueSpan: d.valueSpan, longhands, order: d.order, ...(d.important === true ? { important: true as const } : {}) },
    substitution: { source: d, text, invalid: isInvalid, refusal },
  });
  const invalid = pending.longhands.map(unset);
  if (text === null) return make(invalid, null, true);
  const parsed = parseSubstitutedValue(d.property as Longhand | Shorthand, text, d.valueSpan);
  const shown = `${d.alias ?? d.property}: ${d.text} substitutes to "${readable(text)}"`;
  switch (parsed.kind) {
    case 'ok':
      // css-logical-1 §3: a declaration narrowed to one direction keeps that direction's mapping (analysis/logical.ts).
      return make(pending.direction === undefined ? parsed.longhands : parsed.longhands.filter((lh) => lh.direction === undefined || lh.direction === pending.direction), null);
    case 'invalid':
      return make(invalid, null, true);
    case 'token':
      return make(invalid, `${shown}, and ${tokenText(parsed.token, text)} is unsupported: ${parsed.reason}`);
    case 'refused':
      return make(invalid, `${shown}: ${parsed.diagnostic.message}`);
    case 'multi':
      return make(invalid, `${shown}, a multi-token value, which is not supported for ${d.property} in milestone 1`);
  }
}

/** The var() hook's work: a winner whose declaration holds var() takes its substituted longhand; any other winner is returned as is. */
export function substituteWinner(winner: Candidate, property: Longhand, scope: VarScope): Candidate {
  const d = winner.declaration;
  if (d.pending === undefined) return winner;
  let sub = scope.memo.get(d);
  if (sub === undefined) {
    sub = substituteDeclaration(d, scope.customs);
    scope.memo.set(d, sub);
  }
  const lh = sub.declaration.longhands.find((l) => l.property === property);
  if (lh === undefined) throw new Error(`${d.property} substituted without ${property}`);
  return { ...winner, declaration: sub.declaration, value: lh.value, substitution: sub.substitution };
}
