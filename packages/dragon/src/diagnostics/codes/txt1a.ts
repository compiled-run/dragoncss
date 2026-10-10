// TXT1a: Latin text in real fonts.
import { diagnosticFeature, error, manual } from '../entry.ts';

export const TXT1A = diagnosticFeature(
  [
    'DRAGON_SYNTHETIC_FONT_STYLE',
  ],
  {
    DRAGON_SYNTHETIC_FONT_STYLE: error('This text would be drawn in a synthetic bold or oblique style.', 'Chrome synthesizes the style with a Skia paint effect when the matched face is below weight 600 for a request of 600 or more, or below slope 14 for a slope of 14 or more; native glyph drawing cannot reproduce those pixels yet (TXT-W3). Where the face file has the bold or italic trait Chrome suppresses the synthesis, which Dragon does not model, so that is refused too.', manual('Bundle the face of that style', 'Add a face with the weight or style the text uses to the font map or an @font-face rule.')),
  },
);
