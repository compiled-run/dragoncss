// One @font-face block: its descriptors parsed as Chrome 145 parses them (at_rule_descriptor_parser.cc and css_parsing_utils.cc
// at 145.0.7632.6), the rule dropped when Chrome creates no FontFace (FontFace::Create in font_face.cc), and the src Dragon uses
// resolved to bundled bytes or refused with a typed error.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { asciiLower, tokenize, TokenStream } from './css-tokens.ts';
import type { Token } from './css-tokens.ts';
import { NO_FONT_FAULTS } from './faults.ts';
import type { FontFaults } from './faults.ts';
import { capabilitiesOf } from './selection.ts';
import type { FontSelectionCapabilities, UnicodeRange } from './selection.ts';
import { readSfnt } from './sfnt.ts';
import type { SfntFont, SfntRefusal } from './sfnt.ts';
import { fenceVariableFace } from './variable-fence.ts';
import type { VariableFontRefusal } from './variable-fence.ts';

export type Angle = { readonly value: number; readonly unit: 'deg' | 'rad' | 'grad' | 'turn' };
export type WeightDescriptor = { readonly kind: 'normal' | 'bold' | 'auto' } | { readonly kind: 'numbers'; readonly values: readonly number[] };
export type StyleDescriptor =
  | { readonly kind: 'normal' | 'italic' | 'auto' | 'oblique' }
  | { readonly kind: 'oblique-angles'; readonly angles: readonly Angle[] };
export const STRETCH_KEYWORDS = [
  'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed', 'normal', 'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded',
] as const;
export type StretchKeyword = (typeof STRETCH_KEYWORDS)[number];
export type StretchDescriptor = { readonly kind: 'keyword'; readonly value: StretchKeyword | 'auto' } | { readonly kind: 'percentages'; readonly values: readonly number[] };
export type SrcEntry =
  | { readonly kind: 'url'; readonly url: string; readonly format: string | null; readonly tech: readonly string[] }
  | { readonly kind: 'local'; readonly name: string };
export type MetricOverride = 'normal' | number;
export type FontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional';

/** The declared values Chrome keeps for one rule: the last valid declaration of each descriptor. */
export type FontFaceDescriptors = {
  readonly family?: string;
  readonly src?: readonly SrcEntry[];
  readonly weight?: WeightDescriptor;
  readonly style?: StyleDescriptor;
  readonly stretch?: StretchDescriptor;
  readonly unicodeRange?: readonly UnicodeRange[];
  readonly display?: FontDisplay;
  readonly sizeAdjust?: number;
  readonly ascentOverride?: MetricOverride;
  readonly descentOverride?: MetricOverride;
  readonly lineGapOverride?: MetricOverride;
  readonly featureSettings?: string;
  readonly variationSettings?: string;
};

/** Every descriptor font-face.ts parses, by its CSS name. */
export const DESCRIPTOR_NAMES = [
  'font-family', 'src', 'font-weight', 'font-style', 'font-stretch', 'unicode-range', 'font-display', 'size-adjust',
  'ascent-override', 'descent-override', 'line-gap-override', 'font-feature-settings', 'font-variation-settings',
] as const;
export type DescriptorName = (typeof DESCRIPTOR_NAMES)[number];

/** What an @font-face block produced that is not a plain accepted value. Each is typed; nothing is ignored silently. */
export type FontFaceIssue =
  | { readonly kind: 'invalid-descriptor'; readonly descriptor: DescriptorName; readonly text: string }
  | { readonly kind: 'unknown-descriptor'; readonly descriptor: string }
  | { readonly kind: 'unsupported-descriptor'; readonly descriptor: string; readonly reason: string }
  | { readonly kind: 'unexpected-content'; readonly nodeType: string }
  | { readonly kind: 'descriptor-not-applied'; readonly descriptor: 'font-feature-settings' | 'font-variation-settings' }
  | { readonly kind: 'no-effect'; readonly descriptor: 'font-display'; readonly reason: string }
  | { readonly kind: 'rule-dropped'; readonly reason: 'missing-family' | 'missing-src' }
  | { readonly kind: 'remote-url'; readonly url: string }
  | { readonly kind: 'unresolved-asset'; readonly url: string }
  | { readonly kind: 'local-font'; readonly name: string }
  | { readonly kind: 'unreadable-font'; readonly url: string; readonly refusal: SfntRefusal }
  | { readonly kind: 'variable-font-refused'; readonly url: string; readonly refusal: VariableFontRefusal };

/** Issues that stop a build (the others are reported as warnings). */
export const FONT_FACE_ERRORS: ReadonlySet<FontFaceIssue['kind']> = new Set(['unsupported-descriptor', 'remote-url', 'unresolved-asset', 'local-font', 'unreadable-font', 'variable-font-refused']);

/** A relative src URL resolved through the snapshot: its asset id and bytes, or null when the snapshot has no asset for it. */
export type FontAssetResolver = (specifier: string) => { readonly id: string; readonly bytes: Uint8Array } | null;

/** The bytes a face renders from: a snapshot asset, or a data: URL decoded at build time. */
export type FaceSource = { readonly kind: 'asset'; readonly assetId: string; readonly url: string; readonly bytes: Uint8Array; readonly font: SfntFont }
  | { readonly kind: 'data'; readonly url: string; readonly bytes: Uint8Array; readonly font: SfntFont };

/** A FontFace as Chrome creates it: family, capabilities, unicode ranges and declaration order; source null when Dragon refused it. */
export type DeclaredFace = {
  readonly family: string;
  readonly descriptors: FontFaceDescriptors;
  readonly capabilities: FontSelectionCapabilities;
  readonly ranges: readonly UnicodeRange[];
  readonly order: number;
  readonly source: FaceSource | null;
};

export type FontFaceResult = { readonly face: DeclaredFace | null; readonly descriptors: FontFaceDescriptors; readonly issues: readonly FontFaceIssue[] };

const nodeList = (node: CssNode | null | undefined, key: string): CssNode[] => {
  const v = node?.[key] as { toArray(): CssNode[] } | null | undefined;
  return v === null || v === undefined ? [] : v.toArray();
};

/** Parses the @font-face at-rule node (the AtRuleContext node shape) with its declaration order among the document's faces. */
export function parseFontFace(node: CssNode, order: number, resolve: FontAssetResolver, faults: FontFaults = NO_FONT_FAULTS): FontFaceResult {
  const issues: FontFaceIssue[] = [];
  const d: { -readonly [K in keyof FontFaceDescriptors]: FontFaceDescriptors[K] } = {};
  for (const decl of nodeList(node['block'] as CssNode | null, 'children')) {
    if (decl.type !== 'Declaration') {
      issues.push({ kind: 'unexpected-content', nodeType: decl.type });
      continue;
    }
    const name = asciiLower(String(decl['property']));
    const text = generate(decl['value'] as CssNode);
    if (!(DESCRIPTOR_NAMES as readonly string[]).includes(name)) {
      issues.push({ kind: 'unknown-descriptor', descriptor: name });
      continue;
    }
    const descriptor = name as DescriptorName;
    // A declaration marked !important is invalid in a descriptor block (Chrome drops it; captured in parsing.json).
    const parsed = decl['important'] === false || decl['important'] === undefined ? parseDescriptor(descriptor, text) : invalid;
    if (parsed === invalid) {
      issues.push({ kind: 'invalid-descriptor', descriptor, text });
      continue;
    }
    if (parsed === unsupportedMath) {
      issues.push({ kind: 'unsupported-descriptor', descriptor, reason: 'math functions in @font-face descriptors are not supported yet' });
      continue;
    }
    assign(d, descriptor, parsed);
  }
  const descriptors: FontFaceDescriptors = d;
  if (d.featureSettings !== undefined) issues.push({ kind: 'descriptor-not-applied', descriptor: 'font-feature-settings' });
  if (d.variationSettings !== undefined) issues.push({ kind: 'descriptor-not-applied', descriptor: 'font-variation-settings' });
  if (d.display !== undefined) issues.push({ kind: 'no-effect', descriptor: 'font-display', reason: 'bundled faces are present at the first frame' });
  // FontFace::Create (font_face.cc): no FontFace without a valid font-family and a src list.
  if (d.family === undefined) return { face: null, descriptors, issues: [...issues, { kind: 'rule-dropped', reason: 'missing-family' }] };
  if (d.src === undefined) return { face: null, descriptors, issues: [...issues, { kind: 'rule-dropped', reason: 'missing-src' }] };
  const source = chooseSource(d.src, resolve, issues, faults);
  return {
    face: { family: d.family, descriptors, capabilities: capabilitiesOf(descriptors), ranges: d.unicodeRange ?? [{ start: 0, end: 0x10ffff }], order, source },
    descriptors,
    issues,
  };
}

function assign(d: { -readonly [K in keyof FontFaceDescriptors]: FontFaceDescriptors[K] }, name: DescriptorName, v: unknown): void {
  switch (name) {
    case 'font-family': d.family = v as string; break;
    case 'src': d.src = v as SrcEntry[]; break;
    case 'font-weight': d.weight = v as WeightDescriptor; break;
    case 'font-style': d.style = v as StyleDescriptor; break;
    case 'font-stretch': d.stretch = v as StretchDescriptor; break;
    case 'unicode-range': d.unicodeRange = v as UnicodeRange[]; break;
    case 'font-display': d.display = v as FontDisplay; break;
    case 'size-adjust': d.sizeAdjust = v as number; break;
    case 'ascent-override': d.ascentOverride = v as MetricOverride; break;
    case 'descent-override': d.descentOverride = v as MetricOverride; break;
    case 'line-gap-override': d.lineGapOverride = v as MetricOverride; break;
    case 'font-feature-settings': d.featureSettings = v as string; break;
    case 'font-variation-settings': d.variationSettings = v as string; break;
  }
}

const invalid = Symbol('invalid');
const unsupportedMath = Symbol('unsupported-math');
type Parsed = unknown;

const MATH_FUNCTIONS = new Set(['calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'sqrt', 'hypot', 'log', 'exp', 'abs', 'sign']);

/** AtRuleDescriptorParser::ParseFontFaceDescriptor (at_rule_descriptor_parser.cc). */
export function parseDescriptor(name: DescriptorName, text: string): Parsed | typeof invalid | typeof unsupportedMath {
  const tokens = tokenize(text, name === 'unicode-range');
  if (hasMath(tokens)) return unsupportedMath;
  const s = new TokenStream(tokens);
  s.consumeWhitespace();
  let v: Parsed | null;
  switch (name) {
    case 'font-family':
      // <family-name> excludes unquoted generic families and CSS-wide keywords.
      v = consumeGenericFamily(s) !== null ? null : consumeFamilyName(s);
      break;
    case 'src': v = consumeSrc(s); break;
    case 'unicode-range': v = consumeUnicodeRanges(s); break;
    case 'font-display': v = consumeIdent(s, ['auto', 'block', 'swap', 'fallback', 'optional']); break;
    case 'font-stretch': v = consumeFontStretch(s); break;
    case 'font-style': v = consumeFontStyle(s); break;
    case 'font-weight': v = consumeFontWeight(s); break;
    case 'ascent-override':
    case 'descent-override':
    case 'line-gap-override':
      v = consumeIdent(s, ['normal']) ?? consumePercent(s);
      break;
    case 'size-adjust': v = consumePercent(s); break;
    case 'font-feature-settings':
    case 'font-variation-settings':
      v = consumeSettings(s, name === 'font-feature-settings');
      break;
  }
  return v === null || !s.atEnd() ? invalid : v;
}

const hasMath = (tokens: readonly Token[]): boolean =>
  tokens.some((t) => (t.type === 'function' && (MATH_FUNCTIONS.has(asciiLower(t.value)) || hasMath(t.args))) || (t.type === 'block' && hasMath(t.args)));

function consumeIdent<T extends string>(s: TokenStream, names: readonly T[]): T | null {
  const t = s.peek();
  if (t?.type !== 'ident' || !(names as readonly string[]).includes(asciiLower(t.value))) return null;
  s.consumeIncludingWhitespace();
  return asciiLower(t.value) as T;
}

/** ConsumePercent with ValueRange::kNonNegative. */
function consumePercent(s: TokenStream): number | null {
  const t = s.peek();
  if (t?.type !== 'percentage' || t.value < 0) return null;
  s.consumeIncludingWhitespace();
  return t.value;
}

/** ConsumeGenericFamily: the keyword range kSerif..kMath of css_value_keywords.json5. */
export const GENERIC_FAMILY_KEYWORDS = ['serif', 'sans-serif', 'cursive', 'fantasy', 'monospace', 'system-ui', '-webkit-body', 'math'] as const;
export function consumeGenericFamily(s: TokenStream): string | null {
  return consumeIdent(s, GENERIC_FAMILY_KEYWORDS);
}

const CSS_WIDE = ['initial', 'inherit', 'unset', 'revert', 'revert-layer'];

/** ConsumeFamilyName and ConcatenateFamilyName: a string, or identifiers joined by single spaces (not a lone CSS-wide keyword or default). */
export function consumeFamilyName(s: TokenStream): string | null {
  const t = s.peek();
  if (t?.type === 'string') {
    s.consumeIncludingWhitespace();
    return t.value;
  }
  if (t?.type !== 'ident') return null;
  const parts: string[] = [];
  while (s.peek()?.type === 'ident') parts.push((s.consumeIncludingWhitespace() as { value: string }).value);
  if (parts.length === 1 && [...CSS_WIDE, 'default'].includes(asciiLower(parts[0] as string))) return null;
  return parts.join(' ');
}

function consumeUnicodeRanges(s: TokenStream): UnicodeRange[] | null {
  const out: UnicodeRange[] = [];
  do {
    const t = s.peek();
    if (t?.type !== 'unicode-range') return null;
    s.consumeIncludingWhitespace();
    if (t.start > t.end || t.end > 0x10ffff) return null;
    out.push({ start: t.start, end: t.end });
  } while (s.consumeCommaIncludingWhitespace());
  return out;
}

const ANGLE_UNITS = ['deg', 'rad', 'grad', 'turn'] as const;

/** ConsumeFontStyle in kCSSFontFaceRuleMode, with FontStyleObliqueZeroDegreeAsNormal (stable in 145). */
function consumeFontStyle(s: TokenStream): StyleDescriptor | null {
  const kw = consumeIdent(s, ['normal', 'italic', 'auto']);
  if (kw !== null) return { kind: kw };
  if (consumeIdent(s, ['oblique']) === null) return null;
  const start = consumeAngle(s);
  if (start === null) return { kind: 'oblique' };
  // IsAngleWithinLimits compares the number as written, whatever its unit.
  if (start.value < -90 || start.value > 90) return null;
  if (s.atEnd()) return start.value === 0 ? { kind: 'normal' } : { kind: 'oblique-angles', angles: [start] };
  const end = consumeAngle(s);
  if (end === null || end.value < -90 || end.value > 90) return null;
  if (start.value === 0 && end.value === 0) return { kind: 'normal' };
  return { kind: 'oblique-angles', angles: [start, end] };
}

/** ConsumeAngle: an angle dimension, or a unitless zero. */
function consumeAngle(s: TokenStream): Angle | null {
  const t = s.peek();
  if (t?.type === 'dimension' && (ANGLE_UNITS as readonly string[]).includes(asciiLower(t.unit))) {
    s.consumeIncludingWhitespace();
    return { value: t.value, unit: asciiLower(t.unit) as Angle['unit'] };
  }
  if (t?.type === 'number' && t.value === 0) {
    s.consumeIncludingWhitespace();
    return { value: 0, unit: 'deg' };
  }
  return null;
}

/** ConsumeFontStretch in kCSSFontFaceRuleMode. */
function consumeFontStretch(s: TokenStream): StretchDescriptor | null {
  const kw = consumeIdent(s, [...STRETCH_KEYWORDS, 'auto']);
  if (kw !== null) return { kind: 'keyword', value: kw };
  const start = consumePercent(s);
  if (start === null) return null;
  if (s.atEnd()) return { kind: 'percentages', values: [start] };
  const end = consumePercent(s);
  return end === null ? null : { kind: 'percentages', values: [start, end] };
}

/** ConsumeFontWeight in kCSSFontFaceRuleMode: normal, bold, auto, or one or two numbers in [1, 1000]. */
function consumeFontWeight(s: TokenStream): WeightDescriptor | null {
  const kw = consumeIdent(s, ['normal', 'bold', 'auto']);
  if (kw !== null) return { kind: kw };
  const number = (): number | null => {
    const t = s.peek();
    if (t?.type !== 'number' || t.value < 1 || t.value > 1000) return null;
    s.consumeIncludingWhitespace();
    return t.value;
  };
  const start = number();
  if (start === null) return null;
  if (s.atEnd()) return { kind: 'numbers', values: [start] };
  const end = number();
  return end === null ? null : { kind: 'numbers', values: [start, end] };
}

/** font-feature-settings and font-variation-settings are kept as text; they are reported as not applied. */
function consumeSettings(s: TokenStream, feature: boolean): string | null {
  if (consumeIdent(s, ['normal']) !== null) return 'normal';
  const parts: string[] = [];
  do {
    const tag = s.peek();
    if (tag?.type !== 'string' || [...tag.value].length !== 4 || /[^ -~]/.test(tag.value)) return null;
    s.consumeIncludingWhitespace();
    const v = s.peek();
    if (feature) {
      if (v?.type === 'number' && v.integer && v.value >= 0) {
        s.consumeIncludingWhitespace();
        parts.push(`"${tag.value}" ${v.value}`);
      } else {
        const onOff = consumeIdent(s, ['on', 'off']);
        parts.push(onOff === 'off' ? `"${tag.value}" 0` : `"${tag.value}"`);
      }
    } else {
      if (v?.type !== 'number') return null;
      s.consumeIncludingWhitespace();
      parts.push(`"${tag.value}" ${v.value}`);
    }
  } while (s.consumeCommaIncludingWhitespace());
  return parts.join(', ');
}

const SUPPORTED_FORMAT_KEYWORDS = new Set(['collection', 'opentype', 'truetype', 'woff', 'woff2']);
const FORMAT_KEYWORDS = new Set([...SUPPORTED_FORMAT_KEYWORDS, 'embedded-opentype', 'svg']);
const VARIATION_FORMATS = new Set(['woff-variations', 'truetype-variations', 'opentype-variations', 'woff2-variations']);
const TECH_KEYWORDS = new Set(['features-opentype', 'features-aat', 'features-graphite', 'color-colrv0', 'color-colrv1', 'color-svg', 'color-sbix', 'color-cbdt', 'variations', 'palettes', 'incremental']);
const SUPPORTED_TECH = new Set(['features-opentype', 'features-aat', 'color-colrv0', 'color-colrv1', 'color-sbix', 'color-cbdt', 'variations', 'palettes']);

/** ConsumeFontFaceSrc: each entry that does not parse, or names an unsupported format or tech, is dropped from the list. */
function consumeSrc(s: TokenStream): SrcEntry[] | null {
  const out: SrcEntry[] = [];
  s.consumeWhitespace();
  do {
    const t = s.peek();
    const entry = t?.type === 'function' && asciiLower(t.value) === 'local' ? consumeLocal(s) : consumeSrcUrl(s);
    s.consumeWhitespace();
    if (entry !== null && (s.atEnd() || s.peek()?.type === 'comma')) out.push(entry);
    else s.skipUntilComma();
  } while (s.consumeCommaIncludingWhitespace());
  return out.length > 0 ? out : null;
}

function consumeLocal(s: TokenStream): SrcEntry | null {
  const fn = s.consume() as { args: readonly Token[] };
  const inner = new TokenStream(fn.args);
  inner.consumeWhitespace();
  const t = inner.peek();
  if (t?.type === 'string') {
    inner.consumeIncludingWhitespace();
    return inner.atEnd() ? { kind: 'local', name: t.value } : null;
  }
  if (t?.type === 'ident') {
    const parts: string[] = [];
    while (inner.peek()?.type === 'ident') parts.push((inner.consumeIncludingWhitespace() as { value: string }).value);
    return inner.atEnd() && parts.length > 0 ? { kind: 'local', name: parts.join(' ') } : null;
  }
  return null;
}

function consumeSrcUrl(s: TokenStream): SrcEntry | null {
  const t = s.peek();
  let url: string;
  if (t?.type === 'url') url = t.value;
  else if (t?.type === 'function' && asciiLower(t.value) === 'url') {
    const inner = new TokenStream(t.args);
    inner.consumeWhitespace();
    const str = inner.consumeIncludingWhitespace();
    if (str?.type !== 'string' || !inner.atEnd()) return null;
    url = str.value;
  } else return null;
  s.consumeIncludingWhitespace();
  const next = s.peek();
  const fnIs = (tok: Token | undefined, name: string): tok is Token & { type: 'function' } => tok?.type === 'function' && asciiLower(tok.value) === name;
  if (!s.atEnd() && next?.type !== 'comma' && !fnIs(next, 'format') && !fnIs(next, 'tech')) return null;
  let format: string | null = null;
  const fmt = s.peek();
  if (fnIs(fmt, 'format')) {
    const inner = new TokenStream(fmt.args);
    inner.consumeWhitespace();
    const a = inner.peek();
    if (a?.type === 'ident') {
      if (!FORMAT_KEYWORDS.has(asciiLower(a.value))) return null;
      format = asciiLower(a.value);
    } else if (a?.type === 'string') format = a.value;
    else return null;
    inner.consume();
    const lower = asciiLower(format);
    if (!(SUPPORTED_FORMAT_KEYWORDS.has(lower) || VARIATION_FORMATS.has(lower))) return null;
    inner.consumeWhitespace();
    if (!inner.atEnd()) return null;
    s.consume();
    s.consumeWhitespace();
  }
  const tech: string[] = [];
  const tk = s.peek();
  if (fnIs(tk, 'tech')) {
    const inner = new TokenStream(tk.args);
    inner.consumeWhitespace();
    if (inner.atEnd()) return null;
    do {
      const a = inner.peek();
      if (a?.type !== 'ident' || !TECH_KEYWORDS.has(asciiLower(a.value))) return null;
      inner.consumeIncludingWhitespace();
      if (!inner.atEnd() && inner.peek()?.type !== 'comma') return null;
      if (!SUPPORTED_TECH.has(asciiLower(a.value))) return null;
      tech.push(asciiLower(a.value));
    } while (inner.consumeCommaIncludingWhitespace());
    s.consume();
    s.consumeWhitespace();
  }
  return { kind: 'url', url, format, tech };
}

/**
 * The src Dragon uses: the first entry of Chrome's parsed list, because Chrome falls through only when a load fails. When Dragon
 * cannot read it the result is a typed error; Dragon never skips ahead to a later src.
 */
function chooseSource(src: readonly SrcEntry[], resolve: FontAssetResolver, issues: FontFaceIssue[], faults: FontFaults): FaceSource | null {
  const candidates = faults.skipUnreadableSrc ? src : src.slice(0, 1);
  for (const entry of candidates) {
    const got = sourceOf(entry, resolve, faults);
    if ('refused' in got) {
      if (!faults.skipUnreadableSrc) issues.push(got.refused);
      continue;
    }
    return got.source;
  }
  return null;
}

function sourceOf(entry: SrcEntry, resolve: FontAssetResolver, faults: FontFaults): { source: FaceSource | null } | { refused: FontFaceIssue } {
  if (entry.kind === 'local') return { refused: { kind: 'local-font', name: entry.name } };
  const url = entry.url;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1];
  let bytes: Uint8Array;
  let base: { kind: 'asset'; assetId: string } | { kind: 'data' };
  if (scheme !== undefined && asciiLower(scheme) === 'data') {
    const decoded = decodeDataUrl(url);
    if (decoded === null) return { refused: { kind: 'unreadable-font', url, refusal: { kind: 'malformed', reason: 'the data: URL does not decode' } } };
    bytes = decoded;
    base = { kind: 'data' };
  } else if ((scheme !== undefined || url.startsWith('//')) && !faults.remoteUrlAccepted) {
    return { refused: { kind: 'remote-url', url } };
  } else {
    const asset = resolve(url);
    // Fault remoteUrlAccepted: a remote URL passes as if a later fetch would supply it.
    if (asset === null && scheme === undefined && !url.startsWith('//')) return { refused: { kind: 'unresolved-asset', url } };
    if (asset === null) return { source: null };
    bytes = asset.bytes;
    base = { kind: 'asset', assetId: asset.id };
  }
  const read = readSfnt(bytes);
  if (!read.ok) return { refused: { kind: 'unreadable-font', url, refusal: read.refusal } };
  const fenced = fenceVariableFace(bytes, read.font, faults);
  if (fenced !== null) return { refused: { kind: 'variable-font-refused', url, refusal: fenced } };
  return { source: base.kind === 'asset' ? { kind: 'asset', assetId: base.assetId, url, bytes, font: read.font } : { kind: 'data', url, bytes, font: read.font } };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes a data: URL (RFC 2397): base64 or percent-encoded. */
export function decodeDataUrl(url: string): Uint8Array | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const meta = asciiLower(url.slice(5, comma));
  const body = url.slice(comma + 1);
  if (meta.split(';').map((p) => p.trim()).includes('base64')) {
    const clean = body.replace(/[\t\n\f\r ]/g, '').replace(/=+$/, '');
    if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) return null;
    const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let bits = 0;
    let acc = 0;
    let o = 0;
    for (const c of clean) {
      acc = (acc << 6) | B64.indexOf(c);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 0xff;
      }
    }
    return out;
  }
  const bytes: number[] = [];
  const chars = [...body];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const pair = chars.slice(i + 1, i + 3).join('');
    if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(pair)) {
      bytes.push(parseInt(pair, 16));
      i += 2;
    } else bytes.push(...utf8(ch));
  }
  return new Uint8Array(bytes);
}

/** UTF-8 bytes of one code point, so the core needs no TextEncoder. */
function utf8(ch: string): number[] {
  const cp = ch.codePointAt(0) as number;
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
}
