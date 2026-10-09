// Value computation: parsing captured and initial values, initial and user-agent values, the computed-value fixups, the var()
// substitution hook (its work is in variables.ts), and value serialization.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { parseColorNode, serializeColor } from '../css/color.ts';
import { absolutizeGridText, GRID_TRACK_LONGHANDS } from '../css/grid-values.ts';
import { properties as grammar } from '../css/grammar.generated.ts';
import type { Longhand } from '../css/properties.ts';
import { COLOR_LONGHANDS, INHERITED } from '../css/properties.ts';
import type { CssValue, Declaration } from '../css/stylesheet.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx, normalizeUnit } from '../css/units.ts';
import { ratioValue, REFUSED_MATH_PREFIX } from '../css/values.ts';
import type { CapturedTag, UaDataset } from '../ua/datasets.ts';
import { textFontsOf } from '../ua/datasets.ts';
import type { SynthesisAllowed, TextFontValue } from '../fonts/weight.ts';
import { computeFontStyle, computeTextFont, fontStyleCssValue, INITIAL_TEXT_FONT } from '../fonts/weight.ts';
import type { Span } from '../types.ts';
import type { Candidate } from './cascade.ts';
import type { LinkedElement } from './link.ts';
import type { Substitution, VarScope } from './variables.ts';
import { substituteWinner } from './variables.ts';
import { computePaintValues } from './paint-values/index.ts';

/** environment: the root's direction and font, seeded from the reference environment (docs/api.md §7), never from an author declaration. */
export type Origin = 'author' | 'inherited' | 'user-agent' | 'initial' | 'environment';

/**
 * The environment facts resolution reads: the document's base direction and root font, given to the root element, and the Chrome
 * UA dataset of the reference platform. rootFont 'ahem' is the parity fixture environment (docs/api.md §10.1); 'ua-default'
 * leaves the root font-family at the dataset's value.
 */
export type ResolveEnvironment = { readonly direction: 'ltr' | 'rtl'; readonly rootFont: RootFont; readonly ua: UaDataset };

export type RootFont = 'ahem' | 'ua-default';

export type ResolvedValue = {
  readonly value: CssValue;
  readonly origin: Origin;
  readonly span: Span | null;
  /** The winning declaration and the value it declared (possibly a CSS-wide keyword); null when no author rule matched. */
  readonly declaration: Declaration | null;
  readonly declared: CssValue | null;
  /** Author declarations that matched this element for this longhand and lost the cascade. */
  readonly losing: readonly Declaration[];
  /** Present when the winning declaration held var(); declaration is then as substituted (analysis/variables.ts). */
  readonly substitution?: Substitution;
};

const valueCache = new Map<string, CssValue>();

/** Parses a single captured or initial value string ("8px", "auto", "0") into a CssValue. */
export function parseValueText(property: Longhand, text: string): CssValue {
  const key = `${property}\u0000${text}`;
  const hit = valueCache.get(key);
  if (hit !== undefined) return hit;
  const node = parse(text, { context: 'value' });
  const children = (node['children'] as { toArray(): CssNode[] }).toArray().filter((n) => n.type !== 'WhiteSpace');
  let v: CssValue;
  const only = children[0];
  const ratio = property === 'aspect-ratio' ? ratioValue(children) : null;
  const isColor = (COLOR_LONGHANDS as readonly string[]).includes(property);
  const color = isColor && only !== undefined && children.length === 1 ? parseColorNode(only) : null;
  if (ratio !== null && ratio !== 'invalid' && !('token' in ratio)) v = ratio;
  else if (color !== null && color.ok) v = color.kind === 'keyword' ? { kind: 'keyword', value: color.keyword } : { kind: 'color', value: color.value, syntax: color.syntax };
  else if (children.length !== 1 || only === undefined) v = { kind: 'other', type: 'list', text };
  else if (only.type === 'Identifier') v = property === 'font-family' ? { kind: 'family', value: String(only['name']) } : { kind: 'keyword', value: String(only['name']).toLowerCase() };
  else if (only.type === 'Dimension') v = { kind: 'length', value: Number(only['value']), unit: normalizeUnit(String(only['unit'])) };
  else if (only.type === 'Percentage') v = { kind: 'percentage', value: Number(only['value']) };
  else if (only.type === 'Number') {
    const n = Number(only['value']);
    v = n === 0 && !['flex-grow', 'flex-shrink', 'order', 'line-height', 'font-weight'].includes(property) ? { kind: 'length', value: 0, unit: CANONICAL_LENGTH_UNIT } : { kind: 'number', value: n };
  } else v = { kind: 'other', type: only.type, text };
  valueCache.set(key, v);
  return v;
}

// css-cascade-5 §7.1: initial values come from the pinned @webref/css grammar. color (CanvasText, css-color-4 §6.2) and
// font-family (UA-dependent, css-fonts-4 §2.1) have environment-dependent initial values, taken from Chrome's captured root.
export function initialValue(property: Longhand, ua: UaDataset): CssValue {
  if (property === 'color' || property === 'font-family') return parseValueText(property, ua.computed.html[property] as string);
  const g = grammar[property];
  if (g === undefined) throw new Error(`no webref entry for ${property}`);
  return parseValueText(property, g.initial);
}

/**
 * Whether a resolved longhand holds its initial value by provenance: no declaration set it (or initial / unset chose the initial
 * value), or a shorthand filled it because the author omitted it (LonghandValue.explicit false). An authored keyword equal to the
 * initial value is not initial by provenance. The layout lowering needs this for R5 (initial line widths, notes/T010-p2-triage.md).
 */
export function isInitialByProvenance(v: ResolvedValue, property: Longhand): boolean {
  if (v.origin === 'initial') return true;
  if (v.origin !== 'author' || v.declaration === null) return false;
  return v.declaration.longhands.some((l) => l.property === property && !l.explicit);
}

// css-cascade-5 §6.3 (user-agent origin): the captured table pins, per tag, the longhands a Chrome UA rule sets.
export function userAgentValue(tag: CapturedTag, property: Longhand, ua: UaDataset): CssValue | null {
  if (!ua.userAgentLonghands[tag].includes(property)) return null;
  const own = ua.computed[tag][property];
  if (own === undefined) throw new Error(`no captured value for ${tag} ${property}`);
  return parseValueText(property, own);
}

/**
 * css-cascade-5 §6.3: the declared UA value of a longhand for the element's computed direction (a logical UA declaration maps to a
 * physical side, css-logical-1 §4), with "<n>em" resolved against the parent font size for font-size and the element's own
 * computed font size otherwise (css-values-4 §6.1.1). A font size that is not a length (a value the profiles refuse) leaves the
 * value in em. Null when no UA rule sets it.
 */
export function declaredUserAgentValue(tag: CapturedTag, property: Longhand, ua: UaDataset, direction: 'ltr' | 'rtl', ownFontSize: CssValue, parentFontSize: CssValue): CssValue | null {
  const text = ua.userAgentDeclared[tag][direction][property];
  if (text === undefined) return null;
  const em = /^(-?[0-9.]+)em$/.exec(text);
  if (em === null) return parseValueText(property, text);
  const factor = Number(em[1]);
  const base = property === 'font-size' ? parentFontSize : ownFontSize;
  return base.kind === 'length' ? { kind: 'length', value: factor * base.value, unit: base.unit } : { kind: 'length', value: factor, unit: 'em' };
}

/** Origin of every longhand on an element with no author rules, as the resolver decides it; pinned by ua.test.ts. */
export function defaultOrigin(tag: CapturedTag, property: Longhand, isRoot: boolean, ua: UaDataset, rootFont: RootFont): Origin {
  if (userAgentValue(tag, property, ua) !== null) return 'user-agent';
  if (isRoot && (property === 'direction' || (property === 'font-family' && rootFont === 'ahem'))) return 'environment';
  return INHERITED.has(property) && !isRoot ? 'inherited' : 'initial';
}

/**
 * The var() substitution hook (css-variables-1 §3): the winner a winning candidate computes from once var() references are
 * substituted with the element's custom properties (analysis/variables.ts). It runs on each author winner before CSS-wide keywords
 * are applied; a winner without var() is returned as is.
 */
export type SubstitutionHook = (winner: Candidate, property: Longhand, el: LinkedElement, scope: VarScope) => Candidate;

export const substituteVariables: SubstitutionHook = (winner, property, _el, scope) => substituteWinner(winner, property, scope);

// css-overflow-3 §3.1: when one axis is neither visible nor clip, visible computes to auto and clip to hidden on the other axis.
export function computeOverflowPair(props: Map<Longhand, ResolvedValue>): void {
  const x = props.get('overflow-x') as ResolvedValue;
  const y = props.get('overflow-y') as ResolvedValue;
  const kw = (v: ResolvedValue): string => (v.value.kind === 'keyword' ? v.value.value : '');
  const plain = (k: string): boolean => k === 'visible' || k === 'clip';
  if (plain(kw(x)) && plain(kw(y))) return;
  const fix = (v: ResolvedValue): ResolvedValue => {
    const k = kw(v);
    if (k === 'visible') return { ...v, value: { kind: 'keyword', value: 'auto' } };
    if (k === 'clip') return { ...v, value: { kind: 'keyword', value: 'hidden' } };
    return v;
  };
  props.set('overflow-x', fix(x));
  props.set('overflow-y', fix(y));
}

/** The px value of a computed px length, or null for any other value. */
export function pxOf(v: CssValue): number | null {
  return v.kind === 'length' && v.unit === CANONICAL_LENGTH_UNIT ? v.value : null;
}

/**
 * css-values-4 §6: every length an author declared in a registered unit other than px computes to px. font-size goes first: its
 * em is the parent's computed font-size and its rem the root's, the initial font-size on the root itself (§6.1.1); Blink keeps
 * the result as a float (FontDescription); the compiler keeps double, since rounding lives in the engine and css/color.ts
 * only (ua.test.ts), and the engine stores font sizes as float32 on entry. Every other length then resolves em against the
 * element's own computed font-size and rem against the root's (rootFontSize null: this element is the root). Inherited values
 * are already px. rem uses text scale 1 (docs/decisions.md, Text scale).
 */
export function computeLengths(props: Map<Longhand, ResolvedValue>, parentFontSize: number | null, rootFontSize: number | null): void {
  const toPx = (p: Longhand, em: number | null, rem: number | null): void => {
    const v = props.get(p) as ResolvedValue;
    if (v.value.kind !== 'length' || v.value.unit === CANONICAL_LENGTH_UNIT) return;
    const needs = v.value.unit === 'em' ? em : v.value.unit === 'rem' ? rem : 0;
    if (needs === null) return;
    const px = lengthToPx(v.value.value, v.value.unit, { em: em ?? 0, rem: rem ?? 0 });
    if (px === null) return;
    props.set(p, { ...v, value: { kind: 'length', value: px, unit: CANONICAL_LENGTH_UNIT } });
  };
  // css-fonts-4 §2.5 <relative-size>, as Blink computes it (FontDescription::SmallerSize and LargerSize): the parent's computed size
  // divided or multiplied by 1.2, not the next keyword of the table.
  const fs = props.get('font-size') as ResolvedValue;
  if (fs.value.kind === 'keyword' && (fs.value.value === 'smaller' || fs.value.value === 'larger') && parentFontSize !== null) {
    props.set('font-size', { ...fs, value: { kind: 'length', value: fs.value.value === 'smaller' ? parentFontSize / 1.2 : parentFontSize * 1.2, unit: CANONICAL_LENGTH_UNIT } });
  }
  toPx('font-size', parentFontSize, rootFontSize ?? parentFontSize);
  const own = pxOf((props.get('font-size') as ResolvedValue).value);
  for (const p of props.keys()) if (p !== 'font-size') toPx(p, own, rootFontSize ?? own);
  computePaintValues(props, { em: own, rem: rootFontSize ?? own });
}

/** Inherited lengths whose value may be a calculation: their em and rem compute at the declaring element (css-values-4 §6). */
const INHERITED_MATH_LENGTHS: readonly Longhand[] = ['text-underline-offset'];
const EM_IN_MATH = /(^|[\s(*/+,-])((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(r?em)(?![\w-])/gi;

/**
 * css-values-4 §6: an em or rem inside a calculation in an inherited length computes to px at the element that declares it, so a
 * descendant inherits the absolute length (calc(0.5em + 1px) under a 20px font is 11px on every descendant, whatever its own size).
 */
export function computeInheritedMathLengths(props: Map<Longhand, ResolvedValue>, em: number | null, rem: number | null): void {
  if (em === null || rem === null) return;
  for (const p of INHERITED_MATH_LENGTHS) {
    const v = props.get(p) as ResolvedValue;
    if (v.origin === 'inherited' || v.value.kind !== 'other' || v.value.type.startsWith(REFUSED_MATH_PREFIX)) continue;
    const text = v.value.text.replace(EM_IN_MATH, (all, before: string, n: string, unit: string) => {
      const px = lengthToPx(Number(n), unit.toLowerCase(), { em, rem });
      return px === null || !Number.isFinite(px) || /e/i.test(String(px)) ? all : `${before}${String(px)}${CANONICAL_LENGTH_UNIT}`;
    });
    if (text !== v.value.text) props.set(p, { ...v, value: { ...v.value, text } });
  }
}

/** css-values-4 §6: the lengths inside track-list values compute to px, as computeLengths does for single lengths. */
export function computeGridLengths(props: Map<Longhand, ResolvedValue>, em: number | null, rem: number | null): void {
  if (em === null || rem === null) return;
  for (const p of GRID_TRACK_LONGHANDS) {
    const v = props.get(p) as ResolvedValue;
    if (v.value.kind !== 'other') continue;
    props.set(p, { ...v, value: { ...v.value, text: absolutizeGridText(v.value.text, { em, rem }) } });
  }
}

/**
 * css-align-3 §6.2: justify-items legacy (alone) computes to the parent's value when that is legacy with a position, and to
 * normal otherwise.
 */
export function computeJustifyItems(props: Map<Longhand, ResolvedValue>, parent: ReadonlyMap<Longhand, ResolvedValue> | null): void {
  const v = props.get('justify-items') as ResolvedValue;
  if (v.value.kind !== 'keyword' || v.value.value !== 'legacy') return;
  const inherited = parent === null ? null : (parent.get('justify-items') as ResolvedValue).value;
  const legacy = inherited !== null && inherited.kind === 'keyword' && inherited.value.startsWith('legacy ');
  props.set('justify-items', { ...v, value: legacy ? inherited : { kind: 'keyword', value: 'normal' } });
}

/**
 * css-fonts-4 §2.2, §2.3 as Blink computes them (fonts/weight.ts): a font-weight or font-style no author declaration set takes the
 * tag's specified html.css value (userAgentTextFonts: bold, bolder, italic) or else its parent's; then font-weight computes to a
 * number (bolder and lighter against the parent's computed weight) and font-style to normal, italic or oblique <n>deg.
 */
export function computeFontStyleLonghands(tag: string, props: Map<Longhand, ResolvedValue>, defaulted: ReadonlySet<Longhand>, parent: ReadonlyMap<Longhand, ResolvedValue> | null, ua: UaDataset): void {
  const none = { span: null, declaration: null, declared: null, losing: [] } as const;
  const row = textFontsOf(ua, tag);
  for (const p of ['font-weight', 'font-style'] as const) {
    const text = row[p];
    if (defaulted.has(p) && text !== undefined) props.set(p, { value: parseValueText(p, text), origin: 'user-agent', ...none });
  }
  const w = props.get('font-weight') as ResolvedValue;
  const st = props.get('font-style') as ResolvedValue;
  const specified = (v: ResolvedValue): CssValue | null => (v.origin === 'inherited' && parent !== null ? null : v.value);
  const font = computeTextFont({ weight: specified(w), style: specified(st) }, parent === null ? INITIAL_TEXT_FONT : textFontOfProps(parent));
  if (font === null) throw new Error(`font-weight ${valueToString(w.value)} or font-style ${valueToString(st.value)} has no computed value`);
  props.set('font-weight', { ...w, value: { kind: 'number', value: font.weight } });
  props.set('font-style', { ...st, value: fontStyleCssValue(font.style) });
}

/** Whether Chrome may synthesize bold and oblique for an element (font-synthesis-weight and -style). */
export function synthesisAllowedOf(props: ReadonlyMap<Longhand, ResolvedValue>): SynthesisAllowed {
  const on = (p: Longhand): boolean => valueToString((props.get(p) as ResolvedValue).value) !== 'none';
  return { weight: on('font-synthesis-weight'), style: on('font-synthesis-style') };
}

/** The computed text font of resolved properties. */
export function textFontOfProps(props: ReadonlyMap<Longhand, ResolvedValue>): TextFontValue {
  const style = computeFontStyle((props.get('font-style') as ResolvedValue).value);
  if (style === null) throw new Error('font-style is not computed');
  return { weight: weightOf(props.get('font-weight') as ResolvedValue), style };
}

/** A computed font-weight's number. */
export function weightOf(v: ResolvedValue): number {
  if (v.value.kind !== 'number') throw new Error(`font-weight ${valueToString(v.value)} is not computed`);
  return v.value.value;
}

// css-display-3 §2.7: the root element's display is blockified (Chrome reports block for html even under display: initial).
export function blockifyRoot(v: ResolvedValue): ResolvedValue {
  return v.value.kind === 'keyword' && v.value.value === 'inline' ? { ...v, value: { kind: 'keyword', value: 'block' } } : v;
}

export function valueToString(v: CssValue): string {
  switch (v.kind) {
    case 'keyword':
    case 'family':
      return v.value;
    case 'length':
      return `${v.value}${v.unit}`;
    case 'percentage':
      return `${v.value}%`;
    case 'number':
      return String(v.value);
    case 'color':
      return serializeColor(v.value);
    case 'ratio':
      return `${v.auto ? 'auto ' : ''}${v.width} / ${v.height}`;
    case 'other':
      return v.text;
  }
}
