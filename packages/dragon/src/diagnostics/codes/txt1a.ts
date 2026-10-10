// TXT1a: Latin text in real fonts.
import { diagnosticFeature, error, manual } from '../entry.ts';

export const TXT1A = diagnosticFeature(
  [
    'DRAGON_SYNTHETIC_FONT_STYLE',
  ],
  {
    DRAGON_SYNTHETIC_FONT_STYLE: error('This text would be drawn in a synthetic bold or oblique style.', 'Chrome synthesizes the style with a Skia paint effect when no bundled face has the weight or slope; native glyph drawing cannot reproduce those pixels yet (notes/T056-txt1a-spec.md R7).', manual('Bundle the face of that style', 'Add a face with the weight or style the text uses to the font map or an @font-face rule.')),
  },
);
