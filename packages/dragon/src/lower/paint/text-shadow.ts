// Text shadows on the native targets (TXT-FX, analysis/text-shadow.ts): one write on each inline formatting context's container
// box (the block container, anonymous or not, whose view holds the text views as flat children, T044 R3) listing, per shadowed text
// leaf, its shadows (css px at zoom 1, sRGB RGBA8 colours) in list order. After every text pass the device runs the translated
// paint-shadow.ts textShadowLayerOver over the line's Ahem code points, pens and baseline, and shows the layer in a view beneath the
// text view and its under and overline views (Chrome paints a fragment's shadows, then its decorations, then its text).
// analysis/text-shadow.ts checkTextShadows refuses what the device does not draw as Chrome does.
import type { InlineChild, LayoutBox } from '@dragon/layout';
import type { TextShadowValue } from '../../analysis/text-shadow.ts';
import type { PaintLowering } from './types.ts';

/** The shadows of one text leaf. */
export type TextShadowEntry = { readonly text: string; readonly shadows: readonly TextShadowValue[] };

export type TextShadowWrite = { readonly kind: 'text-shadow'; readonly entries: readonly TextShadowEntry[] };

const TEXT_SHADOW_PAINT = 'Dragon rasters each shadowed line with the translated paint-shadow.ts textShadowLayerOver (Blink 145 cc::DrawLooper shadows, Skia 2ab8add5 per-glyph BoxBlur and A8 colour blit, over the ancestors\' backgrounds) after every text pass, and shows it as a bitmap in a DragonShadowView beneath the text view and its under and overline views';

/** The text leaves of one inline formatting context, in tree order. */
function texts(box: LayoutBox): string[] {
  const out: string[] = [];
  const visit = (c: InlineChild): void => {
    if (c.kind === 'text') out.push(c.id);
    else if (c.kind === 'inline') for (const k of c.children) visit(k);
  };
  for (const c of box.children) if (c.kind !== 'box' && c.kind !== 'control' && c.kind !== 'replaced') visit(c);
  return out;
}

export const TEXT_SHADOW_LOWERING: PaintLowering<TextShadowWrite> = {
  name: 'text-shadow',
  vocabulary: {
    uikit: { 'text-shadow': { key: 'dragonTextShadow', technique: 'dragon-owned-paint', detail: `DragonShadowView [per shadowed text: its shadows as written, and whether its view sits beneath the text view]. ${TEXT_SHADOW_PAINT}` } },
    'android-views': { 'text-shadow': { key: 'dragonTextShadow', technique: 'dragon-owned-paint', detail: `DragonShadowView [per shadowed text: its shadows as written, and whether its view sits beneath the text view]. ${TEXT_SHADOW_PAINT}` } },
  },
  css: { 'text-shadow': ['text-shadow'] },
  lower: ({ box, textShadows }) => {
    if (box.kind !== 'box') return [];
    const entries: TextShadowEntry[] = [];
    for (const text of texts(box)) {
      const shadows = textShadows.get(text);
      if (shadows !== undefined && shadows.length > 0) entries.push({ text, shadows });
    }
    return entries.length === 0 ? [] : [{ kind: 'text-shadow', entries }];
  },
};
