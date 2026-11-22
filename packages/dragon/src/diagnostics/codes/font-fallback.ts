// FONT-FALLBACK: a named family that is not provided is skipped, as Chrome skips a family it cannot load (owner ruling 2026-11-18).
import { diagnosticFeature, manual } from '../entry.ts';

export const FONT_FALLBACK = diagnosticFeature(
  [
    'DRAGON_FONT_FAMILY_NOT_PROVIDED',
  ],
  {
    DRAGON_FONT_FAMILY_NOT_PROVIDED: { severity: 'warning', message: 'This font family is not provided, so text falls back to the next family in the list.', why: 'The family is neither declared with @font-face nor in the font map. Dragon never uses a font installed on the machine, so every target skips it and draws with the next family in the list that resolves, as Chrome does with a family it cannot load. Chrome on a machine that has the family installed would still draw it; the web output keeps the list as written. A list in which no family resolves is DRAGON_FONT_UNMAPPED_FAMILY.', computedWhy: null, fix: manual('Provide the family or remove it', 'Declare the family with an @font-face rule whose src is a bundled font file, map it under fonts.families, or remove it from the list.') },
  },
);
