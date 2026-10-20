// Text decorations on the native targets (TDEC-b, notes/T148J-tdec.md): one write on each inline formatting context's container box
// (the block container, anonymous or not, whose view holds the text views as flat children, T044 R3) listing, per decorated text
// leaf, its applied decorations from analysis/text-decoration.ts (outermost decorating box first): the lines, the used colour, the
// thickness and underline offset (auto, css px at zoom 1, or a percentage of the decorating box's font size) and the decorating
// font: an inline box of the same context names itself, a block decorating box takes the container's strut (the root inline box,
// text_decoration_info.cc). The device places the rects after every layout from the translated text-decoration.ts decorationRects
// over each line's engine geometry (the same inputs as the decoration capture, parity/src/decoration-capture.ts predictDecorations),
// an under or overline in a view beneath the text view and a line-through above it. analysis/computed-checks.ts checkDecorations
// refuses what the device does not draw: a style other than solid or double, a length other than auto, px or a percentage, and
// skip-ink auto on an overline, a double line, a real face, or thicker than the decoration capture proves (TDEC-d clips Ahem glyphs only).
import type { InlineChild, LayoutBox } from '@dragon/layout';
import type { Rgba8 } from '../../css/color.ts';
import type { DecorationLine } from '../../css/properties/text-decoration.ts';
import { TEXT_DECORATION_LONGHANDS } from '../../css/properties/text-decoration.ts';
import type { CssValue } from '../../css/values.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

/** A thickness or underline offset: auto, css px at zoom 1 (the device multiplies by its scale), or a percentage of the font size. */
export type DecorationLengthValue = { readonly kind: 'auto' } | { readonly kind: 'px'; readonly value: number } | { readonly kind: 'percent'; readonly value: number };

/** One applied decoration of one text leaf. */
export type TextDecorationEntry = {
  readonly text: string;
  /** The decorating inline box of the same formatting context, or null for a block decorating box (the container's strut font). */
  readonly box: string | null;
  readonly lines: readonly DecorationLine[];
  readonly color: Rgba8;
  readonly thickness: DecorationLengthValue;
  readonly underlineOffset: DecorationLengthValue;
  /** text-decoration-skip-ink is auto: the device clips an under or overline around the glyphs' ink (TDEC-d). */
  readonly skipInk: boolean;
  /** text-decoration-style: solid, or double (each line paints a second rect at SetLineData's double offset). */
  readonly style: 'solid' | 'double';
};

export type TextDecorationWrite = { readonly kind: 'text-decoration'; readonly entries: readonly TextDecorationEntry[] };

const DECORATION_PAINT = 'Dragon places solid and double decoration rects in DragonDecorationView views beside the text view, under and overlines beneath it and a line-through above it (text_fragment_painter.cc paint order), from the translated text-decoration.ts decorationRects over the engine lines at the device scale: whole device rows, and the ends of each row covered as Skia antifilldot8 covers them (columnAlpha)';

/** A computed thickness or offset as the device takes it; anything else never reaches a program (checkDecorations refuses it). */
export function decorationLengthOf(v: CssValue, what: string): DecorationLengthValue {
  if (v.kind === 'keyword' && v.value === 'auto') return { kind: 'auto' };
  if (v.kind === 'length' && v.unit === 'px' && Number.isFinite(v.value)) return { kind: 'px', value: v.value };
  if (v.kind === 'percentage' && Number.isFinite(v.value)) return { kind: 'percent', value: v.value };
  throw new ProgramError(`${what} is not auto, a px length or a percentage`);
}

/** The text leaves and inline box ids of one inline formatting context, in tree order. */
function inlineContent(box: LayoutBox): { readonly texts: string[]; readonly inlines: Set<string> } {
  const texts: string[] = [];
  const inlines = new Set<string>();
  const visit = (c: InlineChild): void => {
    if (c.kind === 'text') texts.push(c.id);
    else if (c.kind === 'inline') {
      inlines.add(c.id);
      for (const k of c.children) visit(k);
    }
  };
  for (const c of box.children) if (c.kind !== 'box' && c.kind !== 'control' && c.kind !== 'replaced') visit(c);
  return { texts, inlines };
}

export const TEXT_DECORATION_LOWERING: PaintLowering<TextDecorationWrite> = {
  name: 'text-decoration',
  vocabulary: {
    uikit: { 'text-decoration': { key: 'dragonTextDecoration', technique: 'dragon-owned-paint', detail: `DragonDecorationView [per decorated text: its decorations as written, and whether every rect view sits on its side of the text view]. ${DECORATION_PAINT}` } },
    'android-views': { 'text-decoration': { key: 'dragonTextDecoration', technique: 'dragon-owned-paint', detail: `DragonDecorationView [per decorated text: its decorations as written, and whether every rect view sits on its side of the text view]. ${DECORATION_PAINT}` } },
  },
  css: { 'text-decoration': [...TEXT_DECORATION_LONGHANDS] },
  lower: ({ box, decorations }) => {
    if (box.kind !== 'box') return [];
    const { texts, inlines } = inlineContent(box);
    const entries: TextDecorationEntry[] = [];
    for (const text of texts) {
      for (const d of decorations.get(text) ?? []) {
        // checkDecorations refuses every drawn style but solid and double.
        if (d.style !== 'solid' && d.style !== 'double') throw new ProgramError(`${text}: a ${d.style} decoration from ${d.box} reached the native program`);
        entries.push({
          text,
          box: inlines.has(d.box) ? d.box : null,
          lines: d.lines,
          color: d.color,
          thickness: decorationLengthOf(d.thickness, `${text}: the text-decoration-thickness of ${d.box}`),
          underlineOffset: decorationLengthOf(d.underlineOffset, `${text}: the text-underline-offset of ${d.box}`),
          skipInk: d.skipInk === 'auto',
          style: d.style,
        });
      }
    }
    return entries.length === 0 ? [] : [{ kind: 'text-decoration', entries }];
  },
};
