// Value computation: parsing captured and initial values, initial and user-agent values, the computed-value fixups, the var()
// substitution hook (its work is in variables.ts), and value serialization.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { Registrations } from '../css/at-rules/property.ts';
import { parseColorNode, serializeColor } from '../css/color.ts';
import { absolutizeGridText, GRID_TRACK_LONGHANDS } from '../css/grid-values.ts';
import { properties as grammar } from '../css/grammar.generated.ts';
import type { Longhand } from '../css/properties.ts';
import { COLOR_LONGHANDS, INHERITED } from '../css/properties.ts';
import type { CssValue, Declaration } from '../css/stylesheet.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx, normalizeUnit } from '../css/units.ts';
import { positionOffsetText, positionValue, ratioValue, REFUSED_MATH_PREFIX } from '../css/values.ts';
import type { GenBFaults } from '../faults/gen-b.ts';
import type { TxtFsFaults } from '../faults/txt-fs.ts';
import { TXT_FS_FAULTS } from '../faults/txt-fs.ts';
import type { UaDataset, UaKey } from '../ua/datasets.ts';
import { textFontsOf, uaRows } from '../ua/datasets.ts';
import type { SynthesisAllowed, TextFontValue } from '../fonts/weight.ts';
import { computeFontStyle, computeTextFont, fontStyleCssValue, INITIAL_TEXT_FONT } from '../fonts/weight.ts';
import type { Span } from '../types.ts';
import type { Candidate } from './cascade.ts';
import type { LinkedElement } from './link.ts';
import type { Substitution, VarScope } from './variables.ts';
import { substituteWinner } from './variables.ts';
import { computePaintValues } from './paint-values/index.ts';

/** environment: the root's direction and font, seeded from the reference environment (docs/api.md §7), never from an author declaration. */
/** presentational-hint: an HTML attribute mapped to a property (HTML §15.4.5), below author rules (css-cascade-5 §6.1). */
export type Origin = 'author' | 'presentational-hint' | 'inherited' | 'user-agent' | 'initial' | 'environment';

/**
 * The environment facts resolution reads: the document's base direction and root font, given to the root element, and the Chrome
 * UA dataset of the reference platform. rootFont 'ahem' is the parity fixture environment (docs/api.md §10.1); 'ua-default'
 * leaves the root font-family at the dataset's value.
 */
/** registered: the document's @property registrations (css/at-rules/property.ts); none when absent. */
export type ResolveEnvironment = { readonly direction: 'ltr' | 'rtl'; readonly rootFont: RootFont; readonly ua: UaDataset; readonly registered?: Registrations };

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
  /** The author declaration that won the cascade and that a forced UA value then overrode (ELB-2 userAgentForced); it heads losing. */
  readonly forcedOver?: Declaration;
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
  const ratio = property === 'aspect-ratio' ? ratioValue(children) : property === 'object-position' ? positionValue(children) : null;
  const isColor = (COLOR_LONGHANDS as readonly string[]).includes(property) || property === 'fill' || property === 'stroke';
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
export function userAgentValue(tag: UaKey, property: Longhand, ua: UaDataset): CssValue | null {
  const rows = uaRows(ua, tag);
  if (!rows.longhands.includes(property)) return null;
  const own = rows.computed[property];
  if (own === undefined) throw new Error(`no captured value for ${tag} ${property}`);
  return parseValueText(property, own);
}

/**
 * css-cascade-5 §6.3: the declared UA value of a longhand for the element's computed direction (a logical UA declaration maps to a
 * physical side, css-logical-1 §4), with "<n>em" resolved against the parent font size for font-size and the element's own
 * computed font size otherwise (css-values-4 §6.1.1). A font size that is not a length (a value the profiles refuse) leaves the
 * value in em. Null when no UA rule sets it.
 */
export function declaredUserAgentValue(tag: UaKey, property: Longhand, ua: UaDataset, direction: 'ltr' | 'rtl', ownFontSize: CssValue, parentFontSize: CssValue): CssValue | null {
  const text = uaRows(ua, tag).declared[direction][property];
  if (text === undefined) return null;
  const em = /^(-?[0-9.]+)em$/.exec(text);
  if (em === null) return parseValueText(property, text);
  const factor = Number(em[1]);
  const base = property === 'font-size' ? parentFontSize : ownFontSize;
  return base.kind === 'length' ? { kind: 'length', value: factor * base.value, unit: base.unit } : { kind: 'length', value: factor, unit: 'em' };
}

/** Origin of every longhand on an element with no author rules, as the resolver decides it; pinned by ua.test.ts. */
export function defaultOrigin(tag: UaKey, property: Longhand, isRoot: boolean, ua: UaDataset, rootFont: RootFont): Origin {
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

/**
 * css-content-3 §2: on an element, content: none computes to normal (Blink stores it and treats it as normal, display_style.h
 * ContentBehavesAsNormal; probe family1 on-element). The list-style shorthand's none sets list-style-type too (css-lists-3 §3.4),
 * which the planted listStyleNoneSetsImageOnly undoes.
 */
export function computeLists(props: Map<Longhand, ResolvedValue>, faults: GenBFaults): void {
  const content = props.get('content') as ResolvedValue;
  if (!faults.contentNoneOnElementKept && content.value.kind === 'keyword' && content.value.value === 'none') props.set('content', { ...content, value: { kind: 'keyword', value: 'normal' } });
  const type = props.get('list-style-type') as ResolvedValue;
  if (faults.listStyleNoneSetsImageOnly && type.origin === 'author' && type.declaration?.property === 'list-style' && type.value.kind === 'keyword' && type.value.value === 'none') {
    props.set('list-style-type', { ...type, value: { kind: 'keyword', value: 'disc' } });
  }
}

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
 * css-fonts-4 §2.5 <absolute-size> as Chrome 145 computes it at its default medium size of 16px: Chrome's own table (a Chrome
 * observation, checked by the text-font-size-values fixture), not the spec's scaling factors (which give 9.6, 12, 14.2...). The size
 * does not depend on the parent. Chrome uses another row for the generic monospace alone, which Dragon's web output never names: a
 * pinned monospace is written as its bundled family.
 */
const ABSOLUTE_SIZE_PX: { readonly [k: string]: number } = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
/** The plant absoluteSizeSpecTable: css-fonts-4 §2.5's scaling factors (3/5, 3/4, 8/9, 1, 6/5, 3/2, 2, 3) of 16px. */
const SPEC_ABSOLUTE_SIZE_PX: { readonly [k: string]: number } = { 'xx-small': 9.6, 'x-small': 12, small: 128 / 9, medium: 16, large: 19.2, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };

/**
 * css-values-4 §6: every length an author declared in a registered unit other than px computes to px. font-size goes first: its
 * em is the parent's computed font-size and its rem the root's, the initial font-size on the root itself (§6.1.1); Blink keeps
 * the result as a float (FontDescription); the compiler keeps double, since rounding lives in the engine and css/color.ts
 * only (ua.test.ts), and the engine stores font sizes as float32 on entry. Every other length then resolves em against the
 * element's own computed font-size and rem against the root's (rootFontSize null: this element is the root). Inherited values
 * are already px. rem uses text scale 1 (docs/decisions.md, Text scale).
 */
export function computeLengths(props: Map<Longhand, ResolvedValue>, parentFontSize: number | null, rootFontSize: number | null, faults: TxtFsFaults = TXT_FS_FAULTS): void {
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
  const kw = fs.value.kind === 'keyword' ? (faults.absoluteSizeSpecTable ? SPEC_ABSOLUTE_SIZE_PX : ABSOLUTE_SIZE_PX)[fs.value.value] : undefined;
  if (kw !== undefined) props.set('font-size', { ...fs, value: { kind: 'length', value: kw, unit: CANONICAL_LENGTH_UNIT } });
  // style_builder_converter.cc ConvertFontSize (928-974): a percentage is that share of the parent's computed size.
  const of = faults.fontSizePercentOfRoot ? (rootFontSize ?? parentFontSize) : parentFontSize;
  if (fs.value.kind === 'percentage' && of !== null) {
    props.set('font-size', { ...fs, value: { kind: 'length', value: (fs.value.value * of) / 100, unit: CANONICAL_LENGTH_UNIT } });
  }
  toPx('font-size', parentFontSize, rootFontSize ?? parentFontSize);
  const own = pxOf((props.get('font-size') as ResolvedValue).value);
  for (const p of props.keys()) if (p !== 'font-size') toPx(p, own, rootFontSize ?? own);
  computePaintValues(props, { em: own, rem: rootFontSize ?? own });
}

/** Inherited lengths whose value may be a calculation: their em and rem compute at the declaring element (css-values-4 §6). */
const INHERITED_MATH_LENGTHS: readonly Longhand[] = ['text-underline-offset', 'text-indent'];
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

/**
 * css-text-3 §8.2 as Chrome 145 computes letter-spacing (longhands_custom.cc LetterSpacing::CSSValueFromComputedStyleInternal): a
 * zero length computes to normal. Planted fault zeroNotNormal keeps the zero length.
 */
export function computeLetterSpacing(props: Map<Longhand, ResolvedValue>, zeroNotNormal: boolean): void {
  const v = props.get('letter-spacing') as ResolvedValue;
  if (zeroNotNormal || (v.value.kind !== 'length' && v.value.kind !== 'number') || v.value.value !== 0) return;
  props.set('letter-spacing', { ...v, value: { kind: 'keyword', value: 'normal' } });
}

/**
 * css-text-3 §8.1 as Chrome 145 computes word-spacing (longhands_custom.cc WordSpacing::CSSValueFromComputedStyleInternal): a fixed
 * length, normal (0) included, computes to px. Planted fault wordNormalNotZero keeps normal.
 */
export function computeWordSpacing(props: Map<Longhand, ResolvedValue>, wordNormalNotZero: boolean): void {
  const v = props.get('word-spacing') as ResolvedValue;
  if (wordNormalNotZero) return;
  if (v.value.kind === 'keyword' && v.value.value === 'normal') props.set('word-spacing', { ...v, value: { kind: 'length', value: 0, unit: 'px' } });
  else if (v.value.kind === 'number' && v.value.value === 0) props.set('word-spacing', { ...v, value: { kind: 'length', value: 0, unit: 'px' } });
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
export function computeFontStyleLonghands(tag: string, props: Map<Longhand, ResolvedValue>, defaulted: ReadonlySet<Longhand>, parent: ReadonlyMap<Longhand, ResolvedValue> | null, ua: UaDataset, reverted: ReadonlySet<Longhand>): void {
  const none = { span: null, declaration: null, declared: null, losing: [] } as const;
  const row = textFontsOf(ua, tag);
  for (const p of ['font-weight', 'font-style'] as const) {
    const text = row[p];
    // A reverted longhand keeps its author declaration (its profile row and losing list); only the value is the UA's.
    if (defaulted.has(p) && text !== undefined) props.set(p, { ...(reverted.has(p) ? (props.get(p) as ResolvedValue) : none), value: parseValueText(p, text), origin: 'user-agent' });
  }
  const w = props.get('font-weight') as ResolvedValue;
  const st = props.get('font-style') as ResolvedValue;
  const specified = (v: ResolvedValue): CssValue | null => (v.origin === 'inherited' && parent !== null ? null : v.value);
  const parentFont = parent === null ? INITIAL_TEXT_FONT : textFontOfProps(parent);
  // A calculation Dragon refuses keeps its refused value, which no profile row supports, so every target refuses the declaration.
  const known = (v: ResolvedValue): CssValue | null => (isRefusedMath(v.value) ? null : specified(v));
  const font = computeTextFont({ weight: known(w), style: known(st) }, parentFont);
  if (font === null) throw new Error(`font-weight ${valueToString(w.value)} or font-style ${valueToString(st.value)} has no computed value`);
  if (!isRefusedMath(w.value)) props.set('font-weight', { ...w, value: { kind: 'number', value: font.weight } });
  if (!isRefusedMath(st.value)) props.set('font-style', { ...st, value: fontStyleCssValue(font.style) });
}

/** Whether Chrome may synthesize bold and oblique for an element (font-synthesis-weight and -style). */
export function synthesisAllowedOf(props: ReadonlyMap<Longhand, ResolvedValue>): SynthesisAllowed {
  const on = (p: Longhand): boolean => valueToString((props.get(p) as ResolvedValue).value) !== 'none';
  return { weight: on('font-synthesis-weight'), style: on('font-synthesis-style') };
}

export const isRefusedMath = (v: CssValue): boolean => v.kind === 'other' && v.type.startsWith(REFUSED_MATH_PREFIX);

/** The computed text font of resolved properties; a refused calculation counts as the initial value, since its declaration is refused. */
export function textFontOfProps(props: ReadonlyMap<Longhand, ResolvedValue>): TextFontValue {
  const v = (props.get('font-style') as ResolvedValue).value;
  const style = isRefusedMath(v) ? INITIAL_TEXT_FONT.style : computeFontStyle(v);
  if (style === null) throw new Error('font-style is not computed');
  return { weight: weightOf(props.get('font-weight') as ResolvedValue), style };
}

/**
 * Whether Chrome draws an element's text over a face without a slope range (Ahem's one regular face) in synthetic oblique:
 * font-synthesis-style allows it and the computed slope is 14deg or more (css_segmented_font_face.cc, fonts/weight.ts synthesisOf).
 */
export function synthesizesOblique(props: ReadonlyMap<Longhand, ResolvedValue>): boolean {
  const style = textFontOfProps(props).style;
  const slope = style.kind === 'italic' ? 14 : style.kind === 'oblique' ? style.degrees : 0;
  return synthesisAllowedOf(props).style && slope >= 14;
}

/**
 * The shear Chrome draws a synthetic oblique with, in x per unit of height above the baseline: Skia's SkFont::setSkewX(-1/4) in
 * y-down glyph space (font_platform_data_mac.mm CreateSkFont, line 256), the same at every angle.
 */
export const SYNTHETIC_OBLIQUE_SHEAR = 0.25;

/** A computed font-weight's number; a refused calculation counts as the initial weight, since its declaration is refused. */
export function weightOf(v: ResolvedValue): number {
  if (isRefusedMath(v.value)) return INITIAL_TEXT_FONT.weight;
  if (v.value.kind !== 'number') throw new Error(`font-weight ${valueToString(v.value)} is not computed`);
  return v.value.value;
}

/**
 * Whether Chrome draws an element's text over a face below weight 600 (Ahem's one regular face) in synthetic bold: font-synthesis-weight
 * allows it and the computed weight is 600 or more (fonts/weight.ts synthesisOf, kBoldThreshold).
 */
export function synthesizesBold(props: ReadonlyMap<Longhand, ResolvedValue>, from = 600): boolean {
  return synthesisAllowedOf(props).weight && textFontOfProps(props).weight >= from;
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
    case 'position':
      return `${positionOffsetText(v.x)} ${positionOffsetText(v.y)}`;
    case 'other':
      return v.text;
  }
}
