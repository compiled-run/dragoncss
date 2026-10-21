// GEN-c outside list markers on the native targets (notes/T151-gen-spec.md R14): the engine lays out the marker box ("<li>::marker",
// a child of the list item after its content), native-program.ts gives it a box view, and this module's one write tells that view its
// symbol and the list item's used color. After every layout the device runs the translated paint-marker.ts markerSymbolPaint (Blink
// 145 PaintSymbol's snapped rect; a square filled, a disc as Skia's analytic AA oval) and draws the coverage in that colour.
// computed-checks.ts markerRefusal leaves outside disc and square symbols and outside text markers on iOS and Android. A text
// marker has no marker write: native-program.ts gives its box a text node, which the device draws as any Ahem text view.
import type { ListMarker } from '@dragon/layout';
import type { Rgba8 } from '../../css/color.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ListMarkerWrite = { readonly kind: 'list-marker'; readonly symbol: 'disc' | 'square'; readonly color: Rgba8 };

const MARKER_PAINT = 'Dragon draws the marker in the marker box view after every layout: the translated paint-marker.ts markerSymbolPaint gives Blink 145 PaintSymbol\'s pixel-snapped symbol rect from the engine\'s zoomed font metrics and its coverage (a square filled whole, a disc as Skia\'s analytic AA oval fill), drawn as a premultiplied bitmap of that coverage times the colour, unfiltered at device px';

/** The engine's id of a text marker's text fragment in its marker box (layout marker.ts markerTextId): its text node's id. */
export const markerTextId = (markerId: string): string => `${markerId}:text0`;

/** The marker write of a list item's marker node: its symbol and the item's used color (the marker inherits it). */
export function listMarkerWrite(m: ListMarker, color: Rgba8): ListMarkerWrite {
  if (m.kind !== 'symbol' || (m.symbol !== 'disc' && m.symbol !== 'square')) throw new ProgramError(`${m.id}: a ${m.symbol ?? 'text'} marker has no native paint (computed-checks.ts refuses it)`);
  return { kind: 'list-marker', symbol: m.symbol, color };
}

export const LIST_MARKER_LOWERING: PaintLowering<ListMarkerWrite> = {
  name: 'list-marker',
  vocabulary: {
    uikit: { 'list-marker': { key: 'dragonListMarker', technique: 'dragon-owned-paint', detail: `DragonBoxView [symbol, r, g, b, a] (sRGB RGBA8). ${MARKER_PAINT}` } },
    'android-views': { 'list-marker': { key: 'dragonListMarker', technique: 'dragon-owned-paint', detail: `DragonBoxView [symbol, r, g, b, a] (sRGB RGBA8). ${MARKER_PAINT}` } },
  },
  css: { 'list-marker': ['list-style-type', 'color'] },
  // The marker is no box of the layout tree: native-program.ts writes it on the marker node it adds after the list item's children.
  lower: () => [],
};
