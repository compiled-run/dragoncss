// TXT1-C: font maps, @font-face sources and descriptors.
import { diagnosticFeature, error, manual } from '../entry.ts';

export const TXT1C = diagnosticFeature(
  [
    'DRAGON_FONT_MAP_INVALID',
    'DRAGON_FONT_UNMAPPED_FAMILY',
    'DRAGON_FONT_REMOTE_URL',
    'DRAGON_FONT_LOCAL',
    'DRAGON_FONT_UNRESOLVED_ASSET',
    'DRAGON_FONT_UNREADABLE',
    'DRAGON_FONT_UNSUPPORTED_DESCRIPTOR',
    'DRAGON_FONT_DESCRIPTOR_NOT_APPLIED',
    'DRAGON_FONT_VARIABLE_REFUSED',
  ],
  {
    DRAGON_FONT_MAP_INVALID: error('The font map is invalid.', 'The font map decides which bundled bytes every generic and named family renders from; an entry Dragon cannot read would leave a family to the machine\'s fonts.', manual('Fix the font map', 'Write fonts as { generics: { <generic>: { mode: "pinned", family, faces: [{ src, weight?, style?, stretch?, unicodeRange? }] } | { mode: "platform" } }, families?: { ... } } (docs/api.md, Fonts).')),
    DRAGON_FONT_UNMAPPED_FAMILY: error('This font family is neither declared nor mapped.', 'Dragon never silently uses a font installed on the machine: every family in a font-family list must be declared with @font-face, or pinned or left to the platform in the font map.', manual('Declare or map the family', 'Declare the family with an @font-face rule whose src is a bundled font file, or add it to the font map: pin a generic such as sans-serif to bundled faces (the recommended "Dragon Sans", docs/api.md), or map the family under fonts.families.')),
    DRAGON_FONT_REMOTE_URL: error('This font source is a remote URL.', 'Fonts are bundled: a remote font could change or fail to load, so the output would not be reproducible.', manual('Bundle the font file', 'Add the font file to the project and point src at it with a relative URL, or use a data: URL.')),
    DRAGON_FONT_LOCAL: error('This font source is a local() font.', 'A local() font is whatever the machine has installed, so the output would differ between machines.', manual('Bundle the font file', 'Replace local() with a url() to a bundled font file.')),
    DRAGON_FONT_UNRESOLVED_ASSET: error('This font source is not in the snapshot.', 'Every font Dragon renders is read from the source snapshot, so a src the front end did not resolve to an asset has no bytes.', manual('Supply the font file', 'Make the front end resolve the src URL to a snapshot asset, or use a data: URL.')),
    DRAGON_FONT_UNREADABLE: error('This font file cannot be read.', 'Dragon reads each bundled font\'s tables to match faces and compute metrics; a file it cannot parse has no faces or metrics.', manual('Use a TrueType or OpenType font', 'Point src at an uncompressed TrueType (.ttf) or OpenType (.otf) file.')),
    DRAGON_FONT_UNSUPPORTED_DESCRIPTOR: error('This @font-face descriptor value is not supported.', 'Dragon applies each accepted descriptor on every target; a value it cannot evaluate would make the targets disagree.', manual('Use a plain descriptor value', 'Write the descriptor without math functions, for example font-weight: 400 700.')),
    DRAGON_FONT_DESCRIPTOR_NOT_APPLIED: { severity: 'warning', message: 'This @font-face descriptor is not applied by Dragon.', why: 'The web output keeps the descriptor, so Chrome applies it, but Dragon\'s own text measurement does not model it yet.', computedWhy: null, fix: manual('Remove the descriptor or accept the difference', 'Remove the descriptor, or keep it knowing that native text ignores it.') },
    DRAGON_FONT_VARIABLE_REFUSED: error('This variable font or instance is not validated.', 'Dragon\'s advances for a variable font are proven only for the validated fonts and axis ranges (docs/decisions.md, "Variable fonts are fenced").', manual('Use a static face or a validated instance', 'Use static font files, or a validated variable font at a validated instance.')),
  },
);
