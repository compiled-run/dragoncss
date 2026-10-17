// TXT-FX (css-text-decor-4 §4): text-shadow. Every target takes a shadow list of px lengths and explicit colours; the web target
// leaves the drawing to Chrome. The native targets draw it with the translated paint-shadow.ts textShadowLayerOver in a view
// beneath the text view (lower/paint/text-shadow.ts), which is Chrome's drawing only where checkTextShadows finds nothing below:
// upright regular Ahem text (the glyph masks are Ahem's ink boxes; no synthetic bold or oblique) that cannot wrap (Chrome paints each line fragment's shadows and then its text,
// so a line's shadow covers the line above), with no decoration (Chrome shadows decorations too), visible, without ellipsis, outside
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
function paintsBox(el: ResolvedElement): boolean {
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

type Shadowed = { readonly text: ResolvedText; readonly parent: ResolvedElement; readonly order: number; readonly group: string | null };

/** The text leaves that draw each declared text-shadow list (declaring element first), and every box-painting element's tree order. */
function survey(root: ResolvedElement): { readonly declared: Map<ResolvedElement, Shadowed[]>; readonly painters: number[] } {
  const declared = new Map<ResolvedElement, Shadowed[]>();
  const painters: number[] = [];
  let order = 0;
  const walk = (el: ResolvedElement, owner: ResolvedElement | null, group: string | null): void => {
    if (keyword(el.props, 'display') === 'none') return;
    order++;
    if (el !== root && paintsBox(el)) painters.push(order);
    const v = el.props.get('text-shadow') as ResolvedValue;
    const own = v.origin === 'inherited' ? owner : shadowList(el).length === 0 ? null : el;
    if (own !== null && !declared.has(own)) declared.set(own, []);
    const g = group ?? groupOf(el);
    for (const c of el.children) {
      if (c.kind === 'element') walk(c, own, g);
      else {
        order++;
        if (own !== null) (declared.get(own) as Shadowed[]).push({ text: c, parent: el, order, group: g });
      }
    }
  };
  walk(root, null, null);
  return { declared, painters };
}

/** Why the native targets refuse a list on its texts, or null when they draw it as Chrome does. */
function nativeRefusal(texts: readonly Shadowed[], painters: readonly number[], decorated: ReadonlySet<string>, realFaceAt: (address: string) => boolean): string | null {
  for (const { text, parent, order, group } of texts) {
    const at = `text ${text.node.address}`;
    if (realFaceAt(text.node.address)) return `${at} is in a real face; the native shadow is drawn from Ahem's glyph boxes only`;
    if (!singleLine(text)) return `${at} may wrap onto several lines, and Chrome paints each line's shadow over the line above`;
    // Chrome draws Ahem past 600 in synthetic bold and at an italic or oblique slope in synthetic oblique; the native shadow
    // takes the upright regular glyph boxes.
    if (synthesisAllowedOf(parent.props).weight && weightOf(parent.props.get('font-weight') as ResolvedValue) >= 600) return `${at} is drawn in synthetic bold, which the native shadow does not embolden`;
    if (synthesizesOblique(parent.props)) return `${at} is drawn in synthetic oblique, which the native shadow does not shear`;
    if (decorated.has(text.node.address)) return `${at} is decorated, and Chrome shadows its decorations too`;
    if (keyword(parent.props, 'visibility') !== 'visible') return `${at} is not visible`;
    if (keyword(parent.props, 'text-overflow') !== 'clip') return `${at} may end in an ellipsis, which the native shadow does not draw`;
    if (group !== null) return `${at} is inside an element with ${group}, a compositing group in Chrome`;
    if (painters.some((p) => p > order)) return `a box after ${at} paints a background, border or box shadow, which Chrome paints beneath the text shadow and the native views paint over it`;
  }
  return null;
}

/** Refuses each text-shadow list that a target does not draw as Chrome does, once per target at its declaration. */
export function checkTextShadows(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, realFaceAt: (address: string) => boolean, faults: TxtFxFaults): void {
  if (faults.textShadowListAccepted) return;
  const { declared, painters } = survey(root);
  if (declared.size === 0) return;
  const decorated = new Set([...analyzeDecorations(root).applied].filter(([, l]) => l.length > 0).map(([a]) => a));
  for (const [el, texts] of declared) {
    const v = el.props.get('text-shadow') as ResolvedValue;
    const value = valueToString(v.value);
    const all = listRefusal(shadowList(el));
    const native = all === null ? nativeRefusal(texts, painters, decorated, realFaceAt) : null;
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
