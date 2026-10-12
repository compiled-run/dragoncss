// css-env-1 env(): the four safe-area insets, wherever a length is accepted. Chrome substitutes env() before it parses the value
// (CSSVariableParser and StyleEnvironmentVariables at 145.0.7632.6), so a declaration that holds one is valid at parse time and the
// inset arrives as a px length. Chrome always defines the four safe-area-inset names (0 until the platform reports insets), so their
// fallback is never used. Every other name is refused: Dragon does not substitute fallbacks or read any other environment variable.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import { list } from './ast.ts';
import { asciiLower, decodeName } from './escapes.ts';

export type SafeAreaSide = 'top' | 'right' | 'bottom' | 'left';

/** css-env-1 §3: the safe-area inset names; names are case-sensitive, so SAFE-AREA-INSET-TOP is an unknown name. */
export const SAFE_AREA_NAMES: ReadonlyMap<string, SafeAreaSide> = new Map([
  ['safe-area-inset-top', 'top'],
  ['safe-area-inset-right', 'right'],
  ['safe-area-inset-bottom', 'bottom'],
  ['safe-area-inset-left', 'left'],
]);

/** The functions env() may sit inside: the math functions whose leaves Dragon lowers (css/math.ts). */
const ENV_HOSTS: ReadonlySet<string> = new Set(['calc', 'min', 'max', 'clamp']);

export const ENV_FIX = 'Write env(safe-area-inset-top), env(safe-area-inset-right), env(safe-area-inset-bottom) or env(safe-area-inset-left), alone or inside calc(), min(), max() or clamp().';

/** One env() call: its safe-area side, or why Dragon refuses it. */
export type EnvCall = { readonly ok: true; readonly side: SafeAreaSide } | { readonly ok: false; readonly reason: string };

/** Why a name other than the four insets is refused. */
function nameRefusal(name: string, hasFallback: boolean): string {
  if (name.startsWith('safe-area-max-inset-')) return `env(${name}) follows the browser's collapsing toolbars, which a native root view does not have, so it is not supported`;
  if (name.startsWith('keyboard-inset-')) return `env(${name}) reads the on-screen keyboard, which is not supported yet (package KBD)`;
  if (SAFE_AREA_NAMES.has(asciiLower(name))) return `env() names are case-sensitive, so env(${name}) is not a safe-area inset${hasFallback ? ' and Chrome uses its fallback' : ''}; Dragon does not substitute fallbacks`;
  return `env(${name}) is not a safe-area inset${hasFallback ? ', so Chrome uses its fallback, which Dragon does not substitute' : ', and Chrome 145 does not define it'}`;
}

/** An env() Function node: its name and an optional comma and fallback, which a safe-area name never uses. */
export function envCall(node: CssNode): EnvCall {
  const args = list(node, 'children').filter((n) => n.type !== 'WhiteSpace');
  const head = args[0];
  if (head === undefined || head.type !== 'Identifier') return { ok: false, reason: `${generate(node)} does not start with an environment variable name` };
  const name = decodeName(String(head['name']));
  const rest = args.slice(1);
  if (rest.length > 0 && !(rest[0]?.type === 'Operator' && rest[0]['value'] === ',')) return { ok: false, reason: `${generate(node)} indexes an environment variable, which Dragon does not support` };
  const side = SAFE_AREA_NAMES.get(name);
  if (side === undefined) return { ok: false, reason: nameRefusal(name, rest.length > 0) };
  return { ok: true, side };
}

const isEnv = (n: CssNode): boolean => n.type === 'Function' && asciiLower(String(n['name'])) === 'env';

/**
 * Every env() call of a value's top-level tokens, checked: each is a safe-area inset, alone or inside calc(), min(), max() or clamp()
 * (at any depth of them). Returns the first refused call and why, or null.
 */
export function checkEnvCalls(tokens: readonly CssNode[]): { readonly node: CssNode; readonly reason: string } | null {
  const visit = (n: CssNode, inMath: boolean, top: boolean): { readonly node: CssNode; readonly reason: string } | null => {
    if (isEnv(n)) {
      if (!top && !inMath) return { node: n, reason: 'env() is supported only as a length, or inside calc(), min(), max() or clamp()' };
      const call = envCall(n);
      return call.ok ? null : { node: n, reason: call.reason };
    }
    const kids = list(n, 'children');
    if (kids.length === 0) return null;
    const math = n.type === 'Function' && ENV_HOSTS.has(asciiLower(String(n['name'])));
    // A parenthesised group inside a math function is still part of the calculation.
    const stays = math || (inMath && n.type === 'Parentheses');
    for (const k of kids) {
      const hit = visit(k, stays, false);
      if (hit !== null) return hit;
    }
    return null;
  };
  for (const t of tokens) {
    const hit = visit(t, false, true);
    if (hit !== null) return hit;
  }
  return null;
}

/** The first env() call of the tokens, at any depth, or null. */
export function firstEnv(tokens: readonly CssNode[]): CssNode | null {
  const visit = (n: CssNode): CssNode | null => {
    if (isEnv(n)) return n;
    for (const k of list(n, 'children')) {
      const hit = visit(k);
      if (hit !== null) return hit;
    }
    return null;
  };
  for (const t of tokens) {
    const hit = visit(t);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The value text the property grammar is matched against: each top-level env() replaced by 0px, the length every safe-area inset
 * substitutes (Chrome matches the grammar after substitution; an inset is never negative, so 0px has the same validity).
 */
export function grammarText(tokens: readonly CssNode[]): string {
  return tokens.map((t) => (isEnv(t) ? '0px' : generate(t))).join(' ');
}

/** Every env() call in a value's text replaced by 0px: planted fault envResolvedToZero, a compiler that resolves insets at build time. */
export function envAsZero(text: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = text.slice(i).search(/env\(/i);
    if (at < 0) return out + text.slice(i);
    out += `${text.slice(i, i + at)}0px`;
    let depth = 0;
    let j = i + at + 3;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) break;
    }
    i = j + 1;
  }
}

/**
 * Why a value's env() call that holds var() is refused, checked on the source text before var() substitution, or null. Chrome reads
 * env()'s name as written: a var() name makes the declaration invalid (dropped at parse time; in a custom property, invalid at
 * computed-value time), and a var() in a safe-area name's fallback is never used. Dragon substitutes var() before it reads env(),
 * so it refuses both rather than resolve a name Chrome never sees.
 */
export function envVarRefusal(source: string): string | null {
  const re = /(^|[^A-Za-z0-9_\\-])env\(/gi;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    const open = m.index + m[0].length;
    let depth = 1;
    let j = open;
    for (; j < source.length && depth > 0; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') depth--;
    }
    const args = source.slice(open, depth === 0 ? j - 1 : j);
    if (!/var\(/i.test(args)) continue;
    const call = `env(${args})`;
    if (/^[ \t\n\r\f]*var\(/i.test(args)) return `${call} names its variable with var(), and Chrome takes only a literal name, so it drops the declaration (or, in a custom property, makes it invalid at computed-value time)`;
    const name = /^[ \t\n\r\f]*([A-Za-z0-9_-]+)/.exec(args)?.[1] ?? '';
    return SAFE_AREA_NAMES.has(name)
      ? `${call} holds var() in its fallback; Chrome never uses a safe-area name's fallback and renders the inset, but Dragon does not substitute var() inside env()`
      : `${call} holds var() in its fallback, and Dragon does not substitute env() fallbacks`;
  }
  return null;
}
