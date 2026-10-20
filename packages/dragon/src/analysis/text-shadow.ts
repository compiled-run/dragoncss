// TXT-FX (css-text-decor-4 §4): text-shadow. Every target takes a shadow list of px lengths and explicit colours; the web target
// leaves the drawing to Chrome. The native targets draw it with the translated paint-shadow.ts textShadowLayerOver in a view
// beneath the text view (lower/paint/text-shadow.ts), which is Chrome's drawing only where checkTextShadows finds nothing below:
// upright regular Ahem text (the glyph masks are Ahem's ink boxes; no synthetic bold or oblique) that cannot wrap (Chrome paints
// each line fragment's shadows and then its text, so a line's shadow covers the line above), with no decoration (Chrome shadows
// decorations too), visible, without ellipsis (on the block container: text-overflow is not inherited) or line clamp, within the work bound
// (textShadowWork), outside
// a compositing group, and with no box after it in tree order painting a background, border or box shadow (Chrome paints a
// stacking context's text shadows over all of its block backgrounds; the native views of later boxes are above the text's).
// Planted fault textShadowListAccepted accepts every list on every target.
import type { Rgba8 } from '../css/color.ts';
import { opacityOf } from '../css/properties/effects.ts';
import { synthesisAllowedOf, synthesizesOblique, weightOf } from './computed.ts';
import type { Shadow } from '../css/properties/shadow.ts';
import { shadowsOf } from '../css/properties/shadow.ts';
import type { Longhand } from '../css/properties.ts';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { TxtFxFaults } from '../faults/txt-fx.ts';
import type { Diagnostic } from '../types.ts';
import { elementTransform, elementWillChange } from './paint-values/transform.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';
import { lineClampOf } from './line-clamp.ts';
import { analyzeDecorations } from './text-decoration.ts';

/** One text shadow as the native targets draw it: css px lengths at zoom 1 and an sRGB RGBA8 colour. */
export type TextShadowValue = { readonly x: number; readonly y: number; readonly blur: number; readonly color: Rgba8 };

const NATIVE = ['ios', 'android'];

const keyword = (props: ReadonlyMap<Longhand, ResolvedValue> | ReadonlyMap<string, ResolvedValue>, p: string): string => {
  const v = (props as ReadonlyMap<string, ResolvedValue>).get(p);
  if (v === undefined) throw new Error(`${p} did not resolve`);
  return valueToString(v.value);
};

/** The shadows of an element's computed text-shadow (empty for none). */
function shadowList(el: ResolvedElement): readonly Shadow[] {
  const v = el.props.get('text-shadow') as ResolvedValue | undefined;
  if (v === undefined) throw new Error(`${el.element.address}: text-shadow did not resolve`);
  const shadows = shadowsOf(v.value);
  if (shadows === null) throw new Error(`${el.element.address}: text-shadow is not a shadow list (${v.value.kind})`);
  return shadows;
}

/** Why a shadow list is refused on every target, or null: a length other than px, or currentcolor (resolved against each text's color). */
function listRefusal(shadows: readonly Shadow[]): string | null {
  for (const s of shadows) {
    for (const l of [s.x, s.y, s.blur]) if (l.unit !== 'px') return `the length ${l.value}${l.unit} is not in px`;
    if (s.color === 'currentcolor') return 'a shadow without a colour takes currentcolor, which each text resolves against its own color';
  }
  return null;
}

/**
 * The native work bound (TXT-FX): the device rasters a shadowed line's layer and each glyph's blurred mask in memory, so iOS and
 * Android refuse a list with a blur over TEXT_SHADOW_MAX_BLUR_PX or more than TEXT_SHADOW_MAX_SHADOWS shadows, a line whose layer
 * and glyph masks would pass TEXT_SHADOW_MAX_DEVICE_PX pixels at the largest device scale (textShadowWork), and the lists after the
 * document's total passes TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX.
 */
export const TEXT_SHADOW_MAX_BLUR_PX = 16;
export const TEXT_SHADOW_MAX_SHADOWS = 4;
export const TEXT_SHADOW_MAX_DEVICE_PX = 800_000;
export const TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX = 3_000_000;
/** The largest device scale a native target runs at (an Android density reaches 4). */
const MAX_DEVICE_SCALE = 4;

/**
 * An upper estimate, in device px at MAX_DEVICE_SCALE, of the pixels the device rasters for a line of n Ahem glyphs of a css size
 * (each at most size + letterSpacing wide, and each of its spaces wordSpacing wider): the layer (the line's box grown by the span of the shadows' offsets and the largest blur
 * margin, 3 sigma + 2, unrounded) plus every shadow's glyph masks.
 */
export function textShadowWork(
  n: number,
  spaces: number,
  size: number,
  letterSpacing: number,
  wordSpacing: number,
  shadows: readonly { readonly x: number; readonly y: number; readonly blur: number }[]): number {
  if (shadows.length === 0) return 0;
  const s = MAX_DEVICE_SCALE;
  const margin = (blur: number): number => (3 * blur * s) / 2 + 2;
  const m = Math.max(...shadows.map((x) => margin(x.blur)));
  const span = (v: readonly number[]): number => (Math.max(...v) - Math.min(...v)) * s;
  const dx = span(shadows.map((x) => x.x));
  const dy = span(shadows.map((x) => x.y));
  const advance = (size + Math.max(0, letterSpacing)) * s;
  const width = n * advance + spaces * Math.max(0, wordSpacing) * s;
  const layer = (width + 2 * m + dx + 2) * (size * s + 2 * m + dy + 2);
  const masks = shadows.reduce((sum, x) => sum + n * (size * s + 2 * margin(x.blur) + 2) ** 2, 0);
  return layer + masks;
}

/** The word-separator characters word-spacing widens (css-text-3 § word-spacing). */
const WORD_SEPARATORS = new Set([' ', '\u00a0', '\u1361', '\u{10100}', '\u{10101}', '\u{1039f}', '\u{1091f}']);

/** A px length keyword's number, or null for any other value. */
const pxOf = (v: string): number | null => (/^-?[0-9.]+px$/.test(v) ? Number(v.slice(0, -2)) : v === 'normal' ? 0 : null);

/** The native work of a list on one text (textShadowWork), or why the native targets refuse it for its work. */
function workOf(shadows: readonly Shadow[], text: ResolvedText): number | string {
  const at = `text ${text.node.address}`;
  if (shadows.length > TEXT_SHADOW_MAX_SHADOWS) return `${shadows.length} shadows are more than the ${TEXT_SHADOW_MAX_SHADOWS} the native shadow draws`;
  const big = shadows.find((x) => x.blur.value > TEXT_SHADOW_MAX_BLUR_PX);
  if (big !== undefined) return `a blur of ${big.blur.value}px is over the ${TEXT_SHADOW_MAX_BLUR_PX}px the native shadow draws`;
  const size = pxOf(keyword(text.props, 'font-size'));
  const spacing = pxOf(keyword(text.props, 'letter-spacing'));
  const wordSpacing = pxOf(keyword(text.props, 'word-spacing'));
  if (size === null || spacing === null || wordSpacing === null) return `${at} has a font size, letter spacing or word spacing that is not in px`;
  const cps = [...text.text];
  const spaces = cps.filter((c) => WORD_SEPARATORS.has(c)).length;
  const work = textShadowWork(cps.length, spaces, size, spacing, wordSpacing, shadows.map((x) => ({ x: x.x.value, y: x.y.value, blur: x.blur.value })));
  if (work > TEXT_SHADOW_MAX_DEVICE_PX) return `${at} would raster about ${work} device px of shadow, over the ${TEXT_SHADOW_MAX_DEVICE_PX} the native shadow draws`;
  return work;
}

/** The native drawing of an accepted list. */
export function textShadowValues(shadows: readonly Shadow[], address: string): TextShadowValue[] {
  return shadows.map((s) => {
    if (s.color === 'currentcolor' || s.x.unit !== 'px' || s.y.unit !== 'px' || s.blur.unit !== 'px') throw new Error(`${address}: a text shadow the checks refuse reached the native program`);
    return { x: s.x.value, y: s.y.value, blur: s.blur.value, color: s.color };
  });
}

/** Whether a text can only ever take one line: no wrapping, or nothing to wrap at (ASCII letters and digits, no break-anywhere rule). */
function singleLine(t: ResolvedText): boolean {
  if (keyword(t.props, 'white-space-collapse') !== 'collapse' && /[\n\r]/.test(t.text)) return false;
  if (keyword(t.props, 'text-wrap-mode') === 'nowrap') return true;
  return /^[A-Za-z0-9]*$/.test(t.text) && keyword(t.props, 'overflow-wrap') === 'normal' && ['normal', 'keep-all'].includes(keyword(t.props, 'word-break'));
}

/** Whether an element paints a background, a border or a box shadow (the paints Chrome puts beneath every text shadow of its stacking context). */
export function paintsBox(el: ResolvedElement): boolean {
  const bg = el.props.get('background-color') as ResolvedValue;
  if (!(bg.value.kind === 'keyword' && bg.value.value === 'transparent') && !(bg.value.kind === 'color' && bg.value.value.alpha === 0)) return true;
  if (keyword(el.props, 'background-image') !== 'none' || keyword(el.props, 'box-shadow') !== 'none') return true;
  return ['top', 'right', 'bottom', 'left'].some((s) => !['none', 'hidden'].includes(keyword(el.props, `border-${s}-style`)) && keyword(el.props, `border-${s}-width`) !== '0px');
}

/** Why an element makes a compositing group in Chrome, or null. */
function groupOf(el: ResolvedElement): string | null {
  if (elementTransform(el).length > 0) return 'a transform';
  const w = elementWillChange(el).find((f) => f === 'transform' || f === 'opacity');
  if (w !== undefined) return `will-change: ${w}`;
  const o = opacityOf((el.props.get('opacity') as ResolvedValue).value);
  return o !== null && o < 1 ? `opacity: ${o}` : null;
}

/** container: the block container whose inline formatting context holds the text (the parent, or the parent's nearest non-inline ancestor). */
type Shadowed = { readonly text: ResolvedText; readonly parent: ResolvedElement; readonly container: ResolvedElement; readonly clamped: boolean; readonly order: number; readonly group: string | null };

/** The text leaves that draw each declared text-shadow list (declaring element first), and every box-painting element's tree order. */
function survey(root: ResolvedElement): { readonly declared: Map<ResolvedElement, Shadowed[]>; readonly painters: number[] } {
  const declared = new Map<ResolvedElement, Shadowed[]>();
  const painters: number[] = [];
  let order = 0;
  const walk = (el: ResolvedElement, owner: ResolvedElement | null, group: string | null, outer: ResolvedElement, clampedAbove: boolean): void => {
    if (keyword(el.props, 'display') === 'none') return;
    // A line-clamp container clamps (and may end in an ellipsis) its own inline content and its child blocks', at any depth here.
    const clamped = clampedAbove || lineClampOf(el) !== 0;
    // text-overflow is not inherited: it is the block container's, through any depth of inline boxes.
    const container = keyword(el.props, 'display') === 'inline' ? outer : el;
    order++;
    if (el !== root && paintsBox(el)) painters.push(order);
    const v = el.props.get('text-shadow') as ResolvedValue;
    const own = v.origin === 'inherited' ? owner : shadowList(el).length === 0 ? null : el;
    if (own !== null && !declared.has(own)) declared.set(own, []);
    const g = group ?? groupOf(el);
    for (const c of el.children) {
      if (c.kind === 'element') walk(c, own, g, container, clamped);
      else {
        order++;
        if (own !== null) (declared.get(own) as Shadowed[]).push({ text: c, parent: el, container, clamped, order, group: g });
      }
    }
  };
  walk(root, null, null, root, false);
  return { declared, painters };
}

/** Why the native targets refuse a list on its texts, or null when they draw it as Chrome does. */
function nativeRefusal(shadows: readonly Shadow[], texts: readonly Shadowed[], painters: readonly number[], decorated: ReadonlySet<string>, realFaceAt: (address: string) => boolean, budget: { used: number }): string | null {
  let pending = 0;
  for (const { text, parent, container, clamped, order, group } of texts) {
    const at = `text ${text.node.address}`;
    if (realFaceAt(text.node.address)) return `${at} is in a real face; the native shadow is drawn from Ahem's glyph boxes only`;
    if (!singleLine(text)) return `${at} may wrap onto several lines, and Chrome paints each line's shadow over the line above`;
    // Chrome draws Ahem past 600 in synthetic bold and at an italic or oblique slope in synthetic oblique; the native shadow
    // takes the upright regular glyph boxes.
    if (synthesisAllowedOf(parent.props).weight && weightOf(parent.props.get('font-weight') as ResolvedValue) >= 600) return `${at} is drawn in synthetic bold, which the native shadow does not embolden`;
    if (synthesizesOblique(parent.props)) return `${at} is drawn in synthetic oblique, which the native shadow does not shear`;
    if (decorated.has(text.node.address)) return `${at} is decorated, and Chrome shadows its decorations too`;
    if (keyword(parent.props, 'visibility') !== 'visible') return `${at} is not visible`;
    if (keyword(container.props, 'text-overflow') !== 'clip') return `${at} may end in an ellipsis, which the native shadow does not draw`;
    if (clamped) return `${at} is inside a -webkit-line-clamp container, whose clamp may end its line in an ellipsis the native shadow does not draw`;
    if (group !== null) return `${at} is inside an element with ${group}, a compositing group in Chrome`;
    const work = workOf(shadows, text);
    if (typeof work === 'string') return work;
    if (budget.used + pending + work > TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX) return `the document's text shadows would raster over the ${TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX} device px the native targets draw`;
    pending += work;
    if (painters.some((p) => p > order)) return `a box after ${at} paints a background, border or box shadow, which Chrome paints beneath the text shadow and the native views paint over it`;
  }
  budget.used += pending;
  return null;
}

/** Refuses each text-shadow list that a target does not draw as Chrome does, once per target at its declaration. */
export function checkTextShadows(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, realFaceAt: (address: string) => boolean, faults: TxtFxFaults): void {
  if (faults.textShadowListAccepted) return;
  const { declared, painters } = survey(root);
  if (declared.size === 0) return;
  // The native work of the lists accepted so far, in declaration order (the document budget).
  const budget = { used: 0 };
  const decorated = new Set([...analyzeDecorations(root).applied].filter(([, l]) => l.length > 0).map(([a]) => a));
  for (const [el, texts] of declared) {
    const v = el.props.get('text-shadow') as ResolvedValue;
    const value = valueToString(v.value);
    const all = listRefusal(shadowList(el));
    const native = all === null ? nativeRefusal(shadowList(el), texts, painters, decorated, realFaceAt, budget) : null;
    const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
    for (const t of targets) {
      const why = all ?? (NATIVE.includes(t) ? native : null);
      if (why === null) continue;
      const id = `${t}|text-shadow|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `text-shadow: ${value} on <${el.element.tag}> ${el.element.address} is unsupported on ${t}: ${why}`,
        manual: all !== null ? 'Write each shadow with px lengths and a colour.' : `Remove the text-shadow from ${el.element.address}, or build for web.`,
        basis: 'computed-value',
      }));
    }
  }
}

/** The text leaves the native targets shadow, by text address, with their element's computed list (a list every target refuses has none). */
export function nativeTextShadows(root: ResolvedElement): ReadonlyMap<string, readonly TextShadowValue[]> {
  const out = new Map<string, readonly TextShadowValue[]>();
  const walk = (el: ResolvedElement): void => {
    if (keyword(el.props, 'display') === 'none') return;
    const shadows = shadowList(el);
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
      else if (shadows.length > 0 && listRefusal(shadows) === null) out.set(c.node.address, textShadowValues(shadows, c.node.address));
    }
  };
  walk(root);
  return out;
}
