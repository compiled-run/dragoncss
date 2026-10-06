// The native lowered programs (docs/research/native-strategy.md 1.1 and 3.2; notes/T013-p3-review-p4-plan.md section 2 item 1):
// per case, one UIKit and one Android Views program, both from the one shared native layout tree (nativeLowered) and the same
// resolved paint values. A program holds generated node ids, kinds and parents, the typed engine input, every property write in
// backend vocabulary with its technique and the CSS longhands it realises, and the text runs. The emitters and the expected-dump
// projection read only the program; nothing downstream re-resolves CSS.
import type { FontSpec, InlineChild, LayoutBox, LayoutNode, TextLeaf } from '@dragon/layout';
import { rootFontSizeOf } from './ios-layout.ts';
import type { AnimationAnalysis } from '../analysis/animations.ts';
import type { ResolvedElement, ResolvedText } from '../analysis/resolve.ts';
import { canonicalJson } from '../digest.ts';
import type { Rgba8 } from '../css/color.ts';
import { TRANSPARENT } from '../css/color.ts';
import type { Longhand } from '../css/properties.ts';
import { colorChannels, usedColors } from './paint/colors.ts';
import { borderWrites } from './paint/border.ts';
import { clipsChildren } from './paint/clip.ts';
import type { PaintWrite } from './paint/registry.ts';
import { lowerBoxPaint, paintVocabulary, paintWriteCss } from './paint/registry.ts';
import type { NativeBackend, Technique, VocabularyEntry } from './paint/types.ts';
import { ProgramError } from './paint/types.ts';

export type { NativeBackend, Technique } from './paint/types.ts';
export { ProgramError } from './paint/types.ts';
export type { BorderStyleName, Sides } from './paint/border.ts';
export type { ElementColors } from './paint/colors.ts';
export { colorChannels, usedColors } from './paint/colors.ts';

export const NATIVE_BACKENDS: readonly NativeBackend[] = ['uikit', 'android-views'];

/** Each backend's program format, versioned per backend. */
export const PROGRAM_VERSIONS: { readonly [B in NativeBackend]: string } = {
  uikit: 'dragon.uikit-program/1',
  'android-views': 'dragon.android-views-program/1',
};

/** The native target a backend serves. */
export const BACKEND_TARGET: { readonly [B in NativeBackend]: 'ios' | 'android' } = { uikit: 'ios', 'android-views': 'android' };

/** What a write sets; values that depend on the device scale are computed there by the translated engine, and on the host by the TS engine. */
export type WriteKind =
  /** The paint writes: background, border and clip, and every paint module's (lower/paint/registry.ts). */
  | PaintWrite
  /** A text run's font: the device takes the size from the engine's resolved input at its environment (layout.ts zoomInput). */
  | { readonly kind: 'font'; readonly font: FontSpec }
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
  /** The node whose view hosts this one; the DOM parent for every node until a paint module re-hosts it (PNT1). Readback stays in DOM terms. */
  readonly host: string | null;
  readonly kind: 'element' | 'text' | 'anonymous';
  /** The native class the emitter creates and the dump reads back. */
  readonly native: string;
  /** Overflow hidden: children are hosted in a clip view over the padding box. */
  readonly clips: boolean;
  readonly text: string | null;
  readonly writes: readonly ProgramWrite[];
  /** Program facts per paint module (paint order, radii, transforms), for the runtime helpers; never projected into dumps or code. */
  readonly facts: Readonly<Record<string, unknown>>;
};

export type NativeProgram = {
  readonly version: string;
  readonly backend: NativeBackend;
  /** The shared engine input tree (nativeLayoutProjection's root); the viewport and ratio come from the environment and device. */
  readonly root: LayoutBox;
  /** The engine input's rootFontSize at text scale 1 (ios-layout.ts rootFontSizeOf). */
  readonly rootFontSize: number;
  readonly nodes: readonly ProgramNode[];
};

type Vocabulary = { readonly [K in WriteKind['kind']]: VocabularyEntry };

/** The backend vocabularies. Every kind maps to one key per backend, so both backends write the same longhands on every node. */
export const VOCABULARY: { readonly [B in NativeBackend]: Vocabulary } = {
  uikit: {
    ...paintVocabulary('uikit'),
    font: { key: 'font', technique: 'native-property', detail: 'the bundled Ahem registered with CTFontManagerRegisterFontsForURL(.process), UIFont point size = CSS px' },
    'text-color': { key: 'foregroundColor', technique: 'native-property', detail: 'DragonTextView fill colour (sRGB) for CTFontDrawGlyphs; Dragon places every glyph at the engine advances' },
  },
  'android-views': {
    ...paintVocabulary('android-views'),
    font: { key: 'textPaint.typeface', technique: 'native-property', detail: 'the bundled Ahem built with Font.Builder and Typeface.CustomFallbackBuilder under the Dragon id dragon:Ahem; textSize = the engine zoomed font size in device px' },
    'text-color': { key: 'textPaint.color', technique: 'native-property', detail: 'TextPaint.color (ARGB) for Canvas.drawGlyphs; Dragon places every glyph at the engine advances' },
  },
};

/** The CSS longhands each write kind realises; the same on both backends by construction. */
export const WRITE_CSS: { readonly [K in WriteKind['kind']]: readonly Longhand[] } = {
  ...paintWriteCss(),
  font: ['font-family', 'font-size'],
  'text-color': ['color'],
};

export const NATIVE_CLASSES: { readonly [B in NativeBackend]: { readonly box: string; readonly text: string } } = {
  uikit: { box: 'DragonBoxView', text: 'DragonTextView' },
  'android-views': { box: 'dev.dragon.views.DragonBoxView', text: 'dev.dragon.views.DragonTextView' },
};

// ---------------------------------------------------------------- the shared paint lowering

/** One node's paint, resolved once and shared by both backends. */
type NodePaint = {
  readonly id: string;
  readonly parent: string | null;
  readonly kind: ProgramNode['kind'];
  readonly clips: boolean;
  readonly text: string | null;
  readonly writes: readonly WriteKind[];
  readonly facts: Readonly<Record<string, unknown>>;
};

function sharedPaint(root: LayoutBox, resolved: ResolvedElement, images: ReadonlyMap<string, Uint8Array>, movingTransforms: ReadonlySet<string>): NodePaint[] {
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
  const visit = (b: LayoutNode, parent: string | null, enclosingColor: Rgba8, ancestorMoves: boolean): void => {
    const anonymous = b.kind === 'box' && b.boxType === 'anonymous';
    const el = anonymous ? null : (elements.get(b.id) ?? null);
    if (!anonymous && el === null) throw new ProgramError(`${b.id}: no resolved element for the layout box`);
    const own = el === null ? enclosingColor : usedColors(el).color;
    const facts: Record<string, unknown> = {};
    const transformMoves = ancestorMoves || (el !== null && movingTransforms.has(el.element.address));
    const writes = lowerBoxPaint({ box: b, el, parentColor: enclosingColor, facts, images, transformMoves });
    out.push({ id: b.id, parent, kind: anonymous ? 'anonymous' : 'element', clips: clipsChildren(b), text: null, writes, facts });
    // A replaced leaf has no children; Phase A paints only its box (background and border), Phase B its content.
    if (b.kind === 'replaced') return;
    for (const c of b.children) {
      if (c.kind === 'box' || c.kind === 'replaced') {
        visit(c, b.id, own, transformMoves);
        continue;
      }
      inline(c, b.id);
    }
  };
  // T044 R3: the text views, inline box views and <br> views of an inline formatting context are all flat children of its block
  // container's view, in tree order. Inline boxes are unpainted (their decorations are INL1b) and a <br> draws nothing.
  const inline = (c: InlineChild, container: string): void => {
    if (c.kind === 'text') {
      out.push(textPaint(c, container, texts));
      return;
    }
    // The dump schema (native-dump.ts) knows element, text and anonymous nodes: an inline box and a <br> are element nodes. Its view
    // is a box view, which reads back its background and borders, so it gets their writes: transparent and zero wide, as the
    // compiler refuses a painted inline box on native (computed-checks.ts checkInline) and the engine a bordered one (inline.ts).
    const el = elements.get(c.id);
    if (el === undefined) throw new ProgramError(`${c.id}: no resolved element for the inline box`);
    const writes: PaintWrite[] = [{ kind: 'background-color', color: usedColors(el)['background-color'] }, ...borderWrites(c.id, el, TRANSPARENT)];
    out.push({ id: c.id, parent: container, kind: 'element', clips: false, text: null, writes, facts: {} });
    if (c.kind === 'inline') for (const k of c.children) inline(k, container);
  };
  visit(root, null, TRANSPARENT, false);
  return out;
}

function textPaint(t: TextLeaf, parent: string, texts: ReadonlyMap<string, ResolvedText>): NodePaint {
  const r = texts.get(t.id);
  if (r === undefined) throw new ProgramError(`${t.id}: no resolved text for the text leaf`);
  const color = r.props.get('color');
  if (color === undefined) throw new ProgramError(`${t.id}: color did not resolve`);
  return { id: t.id, parent, kind: 'text', clips: false, text: t.text, writes: [{ kind: 'font', font: t.font }, { kind: 'text-color', color: colorChannels(color.value, t.id) }], facts: {} };
}

function toBackend(backend: NativeBackend, root: LayoutBox, rootFontSize: number, paint: readonly NodePaint[]): NativeProgram {
  const vocab = VOCABULARY[backend];
  const classes = NATIVE_CLASSES[backend];
  return {
    version: PROGRAM_VERSIONS[backend],
    backend,
    root,
    rootFontSize,
    nodes: paint.map((n) => ({
      id: n.id,
      parent: n.parent,
      host: n.parent,
      kind: n.kind,
      native: n.kind === 'text' ? classes.text : classes.box,
      clips: n.clips,
      text: n.text,
      writes: n.writes.map((w) => ({ ...w, ...vocab[w.kind], css: WRITE_CSS[w.kind] })),
      facts: n.facts,
    })),
  };
}

/**
 * The elements whose transform moves at run time: a transform transition is listed for it, one of its keyframe animations sets
 * transform, or its computed transform differs between two reachable cases (a state change). Conservative: any case counts.
 */
export function movingTransforms(cases: readonly (ResolvedElement | null)[], animation: AnimationAnalysis | null): ReadonlySet<string> {
  const out = new Set<string>();
  const seen = new Map<string, string>();
  const walk = (el: ResolvedElement): void => {
    const v = el.props.get('transform');
    const text = v === undefined ? '' : canonicalJson(v.value);
    const was = seen.get(el.element.address);
    if (was === undefined) seen.set(el.element.address, text);
    else if (was !== text) out.add(el.element.address);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  for (const r of cases) if (r !== null) walk(r);
  for (const c of animation?.cases ?? []) {
    for (const [address, e] of c.elements) {
      if (e.listings.get('transform')?.mode === 'listed') out.add(address);
      for (const a of e.animations) {
        const rule = animation?.keyframes.get(a.name);
        if (rule !== undefined && rule.blocks.some((b) => b.values.some((d) => d.property === 'transform'))) out.add(address);
      }
    }
  }
  return out;
}

/** Both backends' programs of one case, from one shared layout tree and one paint lowering. */
export function lowerNativePrograms(root: LayoutBox, resolved: ResolvedElement, images: ReadonlyMap<string, Uint8Array>, moving: ReadonlySet<string> = new Set()): { readonly [B in NativeBackend]: NativeProgram } {
  const paint = sharedPaint(root, resolved, images, moving);
  const rootFontSize = rootFontSizeOf(resolved);
  return { uikit: toBackend('uikit', root, rootFontSize, paint), 'android-views': toBackend('android-views', root, rootFontSize, paint) };
}
