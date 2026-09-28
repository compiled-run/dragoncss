// The native lowered programs (docs/research/native-strategy.md 1.1 and 3.2; notes/T013-p3-review-p4-plan.md section 2 item 1):
// per case, one UIKit and one Android Views program, both from the one shared native layout tree (nativeLowered) and the same
// resolved paint values. A program holds generated node ids, kinds and parents, the typed engine input, every property write in
// backend vocabulary with its technique and the CSS longhands it realises, and the text runs. The emitters and the expected-dump
// projection read only the program; nothing downstream re-resolves CSS.
import type { LayoutBox, TextLeaf } from '@dragon/layout';
import type { ResolvedElement, ResolvedText, ResolvedValue } from '../analysis/resolve.ts';
import type { Rgba8 } from '../css/color.ts';
import { TRANSPARENT } from '../css/color.ts';
import type { CssValue } from '../css/stylesheet.ts';
import type { ColorLonghand, Longhand } from '../css/properties.ts';
import { COLOR_LONGHANDS, SIDES } from '../css/properties.ts';

export type NativeBackend = 'uikit' | 'android-views';
export const NATIVE_BACKENDS: readonly NativeBackend[] = ['uikit', 'android-views'];

/** Each backend's program format, versioned per backend. */
export const PROGRAM_VERSIONS: { readonly [B in NativeBackend]: string } = {
  uikit: 'dragon.uikit-program/1',
  'android-views': 'dragon.android-views-program/1',
};

/** The native target a backend serves. */
export const BACKEND_TARGET: { readonly [B in NativeBackend]: 'ios' | 'android' } = { uikit: 'ios', 'android-views': 'android' };

/**
 * native-property: a property the platform renders (backgroundColor, a text colour, a clip on a Dragon clip view).
 * dragon-owned-paint: pixels Dragon draws itself; never promoted from applied values alone (native-strategy.md 3.9 item 11).
 */
export type Technique = 'native-property' | 'dragon-owned-paint';

export type BorderStyleName = 'none' | 'hidden' | 'solid' | 'dotted' | 'dashed' | 'double';
export type Sides<T> = readonly [T, T, T, T];

/** What a write sets; values that depend on the device scale are computed there by the translated engine, and on the host by the TS engine. */
export type WriteKind =
  | { readonly kind: 'background-color'; readonly color: Rgba8 }
  /** Border widths as the engine resolves them at the device scale (box.ts resolveBorder of the zoomed style). */
  | { readonly kind: 'border-widths' }
  | { readonly kind: 'border-styles'; readonly styles: Sides<BorderStyleName> }
  | { readonly kind: 'border-colors'; readonly colors: Sides<Rgba8> }
  /** css-overflow-3 §3: overflow hidden clips descendants to the padding box, through a Dragon clip view inset by the border widths. */
  | { readonly kind: 'padding-box-clip' }
  | { readonly kind: 'font'; readonly family: 'Ahem'; readonly size: number }
  | { readonly kind: 'text-color'; readonly color: Rgba8 };

export type ProgramWrite = WriteKind & {
  /** The applied key in the backend's own vocabulary: what the emitter writes and what the dump reads back. */
  readonly key: string;
  readonly technique: Technique;
  /** How the write is realised on the backend. */
  readonly detail: string;
  /** The CSS longhands the write realises (T002 1.2 per-backend map). */
  readonly css: readonly Longhand[];
};

export type ProgramNode = {
  readonly id: string;
  readonly parent: string | null;
  readonly kind: 'element' | 'text' | 'anonymous';
  /** The native class the emitter creates and the dump reads back. */
  readonly native: string;
  /** Overflow hidden: children are hosted in a clip view over the padding box. */
  readonly clips: boolean;
  readonly text: string | null;
  readonly writes: readonly ProgramWrite[];
};

export type NativeProgram = {
  readonly version: string;
  readonly backend: NativeBackend;
  /** The shared engine input tree (nativeLayoutProjection's root); the viewport and ratio come from the environment and device. */
  readonly root: LayoutBox;
  readonly nodes: readonly ProgramNode[];
};

type Vocabulary = { readonly [K in WriteKind['kind']]: { readonly key: string; readonly technique: Technique; readonly detail: string } };

const BORDER_PAINT = 'Dragon draws each side as a band of its width: solid fills it; dashed draws dashes of 3 times the width with equal gaps; dotted draws square dots of the width with equal gaps; double draws two bands of a third of the width';

/** The backend vocabularies. Every kind maps to one key per backend, so both backends write the same longhands on every node. */
export const VOCABULARY: { readonly [B in NativeBackend]: Vocabulary } = {
  uikit: {
    'background-color': { key: 'backgroundColor', technique: 'native-property', detail: 'UIView.backgroundColor (sRGB), filling the border box' },
    'border-widths': { key: 'dragonBorder.widths', technique: 'dragon-owned-paint', detail: `DragonBoxView side widths in points (device px / scale). ${BORDER_PAINT}` },
    'border-styles': { key: 'dragonBorder.styles', technique: 'dragon-owned-paint', detail: `DragonBoxView side styles. ${BORDER_PAINT}` },
    'border-colors': { key: 'dragonBorder.colors', technique: 'dragon-owned-paint', detail: `DragonBoxView side colours (sRGB RGBA8). ${BORDER_PAINT}` },
    'padding-box-clip': { key: 'dragonClip.frame', technique: 'native-property', detail: 'a DragonClipView over the padding box with clipsToBounds = true hosts the children; frame in points relative to the node' },
    font: { key: 'font', technique: 'native-property', detail: 'the bundled Ahem registered with CTFontManagerRegisterFontsForURL(.process), UIFont point size = CSS px' },
    'text-color': { key: 'foregroundColor', technique: 'native-property', detail: 'DragonTextView fill colour (sRGB) for CTFontDrawGlyphs; Dragon places every glyph at the engine advances' },
  },
  'android-views': {
    'background-color': { key: 'background.color', technique: 'native-property', detail: 'View.background = ColorDrawable(ARGB), filling the border box' },
    'border-widths': { key: 'dragonBorder.widthsPx', technique: 'dragon-owned-paint', detail: `DragonBoxView side widths in whole device px. ${BORDER_PAINT}` },
    'border-styles': { key: 'dragonBorder.styles', technique: 'dragon-owned-paint', detail: `DragonBoxView side styles. ${BORDER_PAINT}` },
    'border-colors': { key: 'dragonBorder.colors', technique: 'dragon-owned-paint', detail: `DragonBoxView side colours (sRGB RGBA8). ${BORDER_PAINT}` },
    'padding-box-clip': { key: 'dragonClip.clipBounds', technique: 'native-property', detail: 'a DragonClipView over the padding box with View.clipBounds = its own bounds hosts the children; [left, top, right, bottom] in device px relative to the node' },
    font: { key: 'textPaint.typeface', technique: 'native-property', detail: 'the bundled Ahem built with Font.Builder and Typeface.CustomFallbackBuilder under the Dragon id dragon:Ahem; textSize = the engine zoomed font size in device px' },
    'text-color': { key: 'textPaint.color', technique: 'native-property', detail: 'TextPaint.color (ARGB) for Canvas.drawGlyphs; Dragon places every glyph at the engine advances' },
  },
};

/** The CSS longhands each write kind realises; the same on both backends by construction. */
export const WRITE_CSS: { readonly [K in WriteKind['kind']]: readonly Longhand[] } = {
  'background-color': ['background-color'],
  'border-widths': SIDES.map((s) => `border-${s}-width` as Longhand),
  'border-styles': SIDES.map((s) => `border-${s}-style` as Longhand),
  'border-colors': SIDES.map((s) => `border-${s}-color` as Longhand),
  'padding-box-clip': ['overflow-x', 'overflow-y'],
  font: ['font-family', 'font-size'],
  'text-color': ['color'],
};

export const NATIVE_CLASSES: { readonly [B in NativeBackend]: { readonly box: string; readonly text: string } } = {
  uikit: { box: 'DragonBoxView', text: 'DragonTextView' },
  'android-views': { box: 'dev.dragon.views.DragonBoxView', text: 'dev.dragon.views.DragonTextView' },
};

// ---------------------------------------------------------------- used paint values

export type ElementColors = { readonly [P in ColorLonghand]: Rgba8 };

/** The channels of a resolved colour value: a colour, or transparent (rgba(0, 0, 0, 0)); currentcolor on color resolves as inherit. */
export function colorChannels(v: CssValue, address: string): Rgba8 {
  if (v.kind === 'color') return v.value;
  if (v.kind === 'keyword' && v.value === 'transparent') return TRANSPARENT;
  throw new Error(`${address}: color did not resolve to channels`);
}

// css-color-4 §4.4 and §6.3: used colours per element; transparent is rgba(0, 0, 0, 0) and currentcolor is the element's color.
export function usedColors(el: ResolvedElement): ElementColors {
  const color = el.props.get('color');
  if (color === undefined) throw new Error(`${el.element.address}: color did not resolve`);
  const own = colorChannels(color.value, el.element.address);
  const out = {} as { [P in ColorLonghand]: Rgba8 };
  for (const p of COLOR_LONGHANDS) {
    const v = (el.props.get(p) as NonNullable<typeof color>).value;
    if (v.kind === 'color') out[p] = v.value;
    else if (v.kind === 'keyword' && v.value === 'transparent') out[p] = TRANSPARENT;
    else if (v.kind === 'keyword' && v.value === 'currentcolor') out[p] = own;
    else throw new Error(`${el.element.address}: ${p} did not resolve to a colour`);
  }
  return out;
}

const BORDER_STYLES: readonly BorderStyleName[] = ['none', 'hidden', 'solid', 'dotted', 'dashed', 'double'];

// ---------------------------------------------------------------- the shared paint lowering

/** One node's paint, resolved once and shared by both backends. */
type NodePaint = {
  readonly id: string;
  readonly parent: string | null;
  readonly kind: ProgramNode['kind'];
  readonly clips: boolean;
  readonly text: string | null;
  readonly writes: readonly WriteKind[];
};

export class ProgramError extends Error {}

function boxPaint(box: LayoutBox, el: ResolvedElement | null, parentColor: Rgba8): WriteKind[] {
  // An anonymous box takes the initial value of every non-inherited property (CSS2 §9.2.1.1): transparent, no border, and
  // currentcolor borders of its enclosing element's color.
  const colors = el === null ? null : usedColors(el);
  const style = (side: string): BorderStyleName => {
    if (el === null) return 'none';
    const v = (el.props.get(`border-${side}-style` as Longhand) as ResolvedValue).value;
    const k = v.kind === 'keyword' ? v.value : '';
    if (!(BORDER_STYLES as readonly string[]).includes(k)) throw new ProgramError(`${box.id}: border-${side}-style ${k} has no native paint technique`);
    return k as BorderStyleName;
  };
  const sideColor = (side: string): Rgba8 => (colors === null ? parentColor : colors[`border-${side}-color` as ColorLonghand]);
  return [
    { kind: 'background-color', color: colors === null ? TRANSPARENT : colors['background-color'] },
    { kind: 'border-widths' },
    { kind: 'border-styles', styles: SIDES.map(style) as unknown as Sides<BorderStyleName> },
    { kind: 'border-colors', colors: SIDES.map(sideColor) as unknown as Sides<Rgba8> },
    ...(box.style.overflowX === 'hidden' ? [{ kind: 'padding-box-clip' } as const] : []),
  ];
}

function sharedPaint(root: LayoutBox, resolved: ResolvedElement): NodePaint[] {
  const elements = new Map<string, ResolvedElement>();
  const texts = new Map<string, ResolvedText>();
  const walk = (el: ResolvedElement): void => {
    elements.set(el.element.address, el);
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
      else texts.set(c.node.address, c);
    }
  };
  walk(resolved);
  const out: NodePaint[] = [];
  const visit = (b: LayoutBox, parent: string | null, enclosingColor: Rgba8): void => {
    const el = b.boxType === 'anonymous' ? null : (elements.get(b.id) ?? null);
    if (b.boxType === 'element' && el === null) throw new ProgramError(`${b.id}: no resolved element for the layout box`);
    const own = el === null ? enclosingColor : usedColors(el).color;
    out.push({ id: b.id, parent, kind: b.boxType === 'anonymous' ? 'anonymous' : 'element', clips: b.style.overflowX === 'hidden', text: null, writes: boxPaint(b, el, enclosingColor) });
    for (const c of b.children) {
      if (c.kind === 'box') {
        visit(c, b.id, own);
        continue;
      }
      out.push(textPaint(c, b.id, texts));
    }
  };
  visit(root, null, TRANSPARENT);
  return out;
}

function textPaint(t: TextLeaf, parent: string, texts: ReadonlyMap<string, ResolvedText>): NodePaint {
  const r = texts.get(t.id);
  if (r === undefined) throw new ProgramError(`${t.id}: no resolved text for the text leaf`);
  const color = r.props.get('color');
  if (color === undefined) throw new ProgramError(`${t.id}: color did not resolve`);
  return { id: t.id, parent, kind: 'text', clips: false, text: t.text, writes: [{ kind: 'font', family: t.font.family, size: t.font.size }, { kind: 'text-color', color: colorChannels(color.value, t.id) }] };
}

function toBackend(backend: NativeBackend, root: LayoutBox, paint: readonly NodePaint[]): NativeProgram {
  const vocab = VOCABULARY[backend];
  const classes = NATIVE_CLASSES[backend];
  return {
    version: PROGRAM_VERSIONS[backend],
    backend,
    root,
    nodes: paint.map((n) => ({
      id: n.id,
      parent: n.parent,
      kind: n.kind,
      native: n.kind === 'text' ? classes.text : classes.box,
      clips: n.clips,
      text: n.text,
      writes: n.writes.map((w) => ({ ...w, ...vocab[w.kind], css: WRITE_CSS[w.kind] })),
    })),
  };
}

/** Both backends' programs of one case, from one shared layout tree and one paint lowering. */
export function lowerNativePrograms(root: LayoutBox, resolved: ResolvedElement): { readonly [B in NativeBackend]: NativeProgram } {
  const paint = sharedPaint(root, resolved);
  return { uikit: toBackend('uikit', root, paint), 'android-views': toBackend('android-views', root, paint) };
}
