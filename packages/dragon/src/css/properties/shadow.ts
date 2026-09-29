// box-shadow (css-backgrounds-3 §7.1): none, or a comma list of shadows, each a colour, two offsets, an optional non-negative
// blur and an optional spread, and an optional inset, in any order of the three groups. Chrome 145 computes each length to px
// (em and rem included), each colour to rgb()/rgba() (currentcolor to the element's color), and serializes a shadow as
// "<color> <x> <y> <blur> <spread>" with " inset" last, shadows joined by ", ".
import { generate, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { list, spanOf } from '../ast.ts';
import type { Rgba8 } from '../color.ts';
import { parseColorNode, serializeColor } from '../color.ts';
import type { PropertyAspect } from '../properties.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import { normalizeUnit, unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';
import { COLOR_FIX } from '../values.ts';

export const SHADOW_LONGHANDS = ['box-shadow'] as const;
export const SHADOW_SHORTHANDS = [] as const;
export const SHADOW_INHERITED: readonly (typeof SHADOW_LONGHANDS)[number][] = [];
export const SHADOW_CONTAINER: readonly (typeof SHADOW_LONGHANDS)[number][] = [];
export const SHADOW_TEXT_ROLE: readonly (typeof SHADOW_LONGHANDS)[number][] = [];

export const SHADOW_ASPECTS: { readonly [P in (typeof SHADOW_LONGHANDS)[number]]: PropertyAspect } = {
  'box-shadow': { layout: false, paint: true },
};

/** The CssValue type of a shadow list; its text is the list in Chrome's computed order, lengths in their authored units. */
export const SHADOW_LIST = 'shadow-list';

/** A length of a shadow: its value and lowercased unit. */
export type ShadowLength = { readonly value: number; readonly unit: string };

/** One shadow: its colour (channels, or currentcolor until computed), the four lengths and whether it is inset. */
export type Shadow = {
  readonly color: Rgba8 | 'currentcolor';
  readonly x: ShadowLength;
  readonly y: ShadowLength;
  readonly blur: ShadowLength;
  readonly spread: ShadowLength;
  readonly inset: boolean;
};

const SHADOW_FIX = 'Write each shadow length as px, em, rem or an absolute length.';
const ZERO: ShadowLength = { value: 0, unit: 'px' };

/** A number in CSS text, without exponent notation (JavaScript writes 1e-7 and 1e+21 with one). */
function numberText(n: number): string {
  const s = String(n === 0 ? 0 : n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m === null) return s;
  const sign = m[1] as string;
  const frac = m[3] === undefined ? '' : m[3];
  const digits = `${m[2] as string}${frac}`;
  const exp = Number(m[4]);
  return exp < 0 ? `${sign}0.${'0'.repeat(-exp - 1)}${digits}` : `${sign}${digits}${'0'.repeat(exp - frac.length)}`;
}

const lengthText = (l: ShadowLength): string => `${numberText(l.value)}${l.unit}`;

/** The text of a shadow list in Chrome's computed order. */
export function shadowListText(shadows: readonly Shadow[]): string {
  return shadows.map((s) => `${s.color === 'currentcolor' ? 'currentcolor' : serializeColor(s.color)} ${lengthText(s.x)} ${lengthText(s.y)} ${lengthText(s.blur)} ${lengthText(s.spread)}${s.inset ? ' inset' : ''}`).join(', ');
}

/** The CssValue of a shadow list (none for an empty list). */
export function shadowValue(shadows: readonly Shadow[]): CssValue {
  return shadows.length === 0 ? { kind: 'keyword', value: 'none' } : { kind: 'other', type: SHADOW_LIST, text: shadowListText(shadows) };
}

type Read = { readonly ok: Shadow[] } | { readonly refused: ParsedValue } | { readonly invalid: string };

/** One shadow length token: a length in a unit with a build-time px value, or 0. */
function lengthToken(t: CssNode, refuse: (t: CssNode, m: string, manual?: string) => Read): ShadowLength | Read | null {
  if (t.type === 'Number') return Number(t['value']) === 0 ? ZERO : { invalid: 'a shadow length other than 0 needs a unit' };
  if (t.type === 'Function' && !isColorFunction(t)) return refuse(t, `box-shadow: ${generate(t)} is unsupported: a calculation in a shadow is not supported (PNT1 takes lengths)`);
  if (t.type !== 'Dimension') return null;
  const unit = normalizeUnit(String(t['unit']));
  const c = unitEntry(unit)?.conversion;
  if (c === undefined) return { invalid: `${unit} is not a length unit` };
  if (c.kind === 'refused') return refuse(t, `box-shadow: ${generate(t)} is unsupported: ${c.reason}`);
  if (c.kind === 'viewport') return refuse(t, `box-shadow: ${generate(t)} is unsupported: a shadow length in a viewport unit would need the device viewport on the native side (PNT1 takes px, em, rem and absolute lengths)`);
  return { value: Number(t['value']), unit };
}

const COLOR_FUNCTIONS: ReadonlySet<string> = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark']);
const isColorFunction = (t: CssNode): boolean => t.type === 'Function' && COLOR_FUNCTIONS.has(String(t['name']).toLowerCase());
const isLength = (x: ShadowLength | Read | null): x is ShadowLength => x !== null && 'value' in x && 'unit' in x;

/** Reads a shadow list from tokens (css-backgrounds-3 §7.1 with Chrome's rules: a negative blur is invalid). */
export function readShadows(tokens: readonly CssNode[], base: Span): Read {
  const refuse = (t: CssNode, message: string, manual: string = SHADOW_FIX): Read => ({ refused: { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message, manual }) } });
  if (tokens.length === 1 && tokens[0]?.type === 'Identifier' && String(tokens[0]['name']).toLowerCase() === 'none') return { ok: [] };
  const items: CssNode[][] = [[]];
  for (const t of tokens) {
    if (t.type === 'Operator' && t['value'] === ',') items.push([]);
    else (items[items.length - 1] as CssNode[]).push(t);
  }
  const out: Shadow[] = [];
  for (const item of items) {
    let color: Rgba8 | 'currentcolor' | null = null;
    let inset = false;
    const lengths: ShadowLength[] = [];
    let lengthsDone = false;
    for (const t of item) {
      if (t.type === 'Identifier' && String(t['name']).toLowerCase() === 'inset') {
        if (inset) return { invalid: 'inset appears twice in one shadow' };
        inset = true;
        if (lengths.length > 0) lengthsDone = true;
        continue;
      }
      const len = lengthToken(t, refuse);
      if (len !== null && !isLength(len)) return len;
      if (isLength(len)) {
        if (lengthsDone) return { invalid: 'the lengths of a shadow must be together' };
        lengths.push(len);
        continue;
      }
      // none is a whole value, never part of a shadow (Chrome drops "1px 1px, none").
      if (t.type === 'Identifier' && String(t['name']).toLowerCase() === 'none') return { invalid: 'none is not a shadow in a list' };
      const c = parseColorNode(t);
      if (!c.ok) return refuse(t, `box-shadow: ${generate(t)} is unsupported: ${c.reason}`, COLOR_FIX);
      if (color !== null) return { invalid: 'a shadow has at most one colour' };
      color = c.kind === 'keyword' ? (c.keyword === 'currentcolor' ? 'currentcolor' : { r: 0, g: 0, b: 0, alpha: 0 }) : c.value;
      if (lengths.length > 0) lengthsDone = true;
    }
    if (lengths.length < 2 || lengths.length > 4) return { invalid: 'a shadow has two to four lengths' };
    const [x, y, blur = ZERO, spread = ZERO] = lengths as [ShadowLength, ShadowLength, ShadowLength?, ShadowLength?];
    if (blur.value < 0) return { invalid: 'a shadow blur may not be negative' };
    out.push({ color: color ?? 'currentcolor', x, y, blur, spread, inset });
  }
  return { ok: out };
}

/** The shadows of a box-shadow value (none, or a shadow list); null for any other value. */
export function shadowsOf(v: CssValue): readonly Shadow[] | null {
  if (v.kind === 'keyword' && v.value === 'none') return [];
  if (v.kind !== 'other' || v.type !== SHADOW_LIST) return null;
  const node = parse(v.text, { context: 'value' });
  const r = readShadows(list(node, 'children').filter((n) => n.type !== 'WhiteSpace'), { source: { uri: 'dragon-internal:shadow', revision: '0', hash: 'sha256:0' }, start: 0, end: v.text.length });
  if (!('ok' in r)) throw new Error(`box-shadow ${JSON.stringify(v.text)} does not read back as a shadow list`);
  return r.ok;
}

/** css-backgrounds-3 §7.1: the box-shadow parser (the paint value hook, css/paint-parsers.ts). */
export function parseBoxShadow(tokens: readonly CssNode[], base: Span): ParsedValue {
  const r = readShadows(tokens, base);
  if ('refused' in r) return r.refused;
  if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
  const longhands: LonghandValue[] = [{ property: 'box-shadow', value: shadowValue(r.ok), explicit: true }];
  return { kind: 'ok', longhands };
}

