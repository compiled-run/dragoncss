// MISC-PAINT (css-backgrounds-3 §4 and §6): the border image every target draws. Every target accepts a border image whose source is
// none (Chrome paints the border as border-style says, whatever the other longhands hold: NinePieceImagePainter::Paint draws nothing
// without an image), and part 1's gradient border image: one linear-gradient() source to a side or at an angle on the measured 0.01deg
// grid, opaque sRGB stops at percentages, any slices (numbers or percentages, fill or not), widths of numbers, px or auto, no outset
// and any border-image-repeat, on a square block-level box with no background image that is neither transformed nor composited.
// The native targets rasterise it with the translated Chrome nine-piece port (paint-gradient.ts planBorderImage); the web output
// keeps it as written. A url() source, the other images and gradients, outsets and percentage widths are refused on every target
// by name; what only the native raster cannot draw exactly (a corner or off-grid angle, a translucent or currentcolor stop, a px
// stop position, stops that resolve to one offset, an inline, table, contents or list-item box, a rounded box, a background image
// under it, a colour clipped inside the border box, a box under an effective zoom other than 1, and repeat, round or space on a box
// whose tiles paint-values/border-image-tiling.ts cannot prove whole device px at every device scale) is refused on ios and android only.
// The values are checked computed, so one that arrives through var() or inherit is checked too.
// -webkit-border-image is read as Chrome applies it (webkit-border-image.ts): the border image it sets is checked as above, and the
// border widths it sets are the element's. One Dragon cannot read (a var() value, a width in a unit other than px), or two that
// set different widths, is refused on every target; a width it sets under one device px, which Chrome floors to 0 where a declared
// border width is at least one device px, is refused on ios and android.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { BORDER_IMAGE_LONGHANDS, isInitialBorderImage } from '../css/properties/border-image.ts';
import { borderImageRefusal } from './paint-values/border-image.ts';
import { NATIVE_DEVICE_DPRS } from './paint-values/gradient-phase.ts';
import { appliedWebkitWidths, webkitBorderImageDeclarations } from './webkit-border-image.ts';
import type { BorderImageFaults } from '../faults/border-image.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './computed.ts';

/**
 * Refuses a border image no target draws, at the longhand that holds the reason, once per element, and a -webkit-border-image
 * whose border widths Dragon cannot set as Chrome does; planted fault borderImageAccepted accepts them.
 */
export function checkBorderImage(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: BorderImageFaults): void {
  if (faults.borderImageAccepted) return;
  const p = BORDER_IMAGE_LONGHANDS.find((q) => !isInitialBorderImage(q, (el.props.get(q) as ResolvedValue).value));
  const webkit = webkitBorderImageDeclarations(el.props);
  if (p === undefined && webkit.length === 0) return;
  const id = `border-image|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const widths = appliedWebkitWidths(el.props);
  const at = webkit[0];
  if (at !== undefined) {
    const thin = typeof widths === 'string' ? [] : widths.filter((w): w is number => w !== null && w > 0);
    const on = typeof widths === 'string' ? targets : targets.filter((t) => (t === 'ios' || t === 'android') && thin.some((w) => NATIVE_DEVICE_DPRS[t].some((d) => w * d < 1)));
    for (const t of on) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: authored(at.valueSpan),
        target: t,
        message: `-webkit-border-image: ${at.text} on <${el.element.tag}> ${el.element.address} is unsupported: ${typeof widths === 'string' ? widths : 'it sets a border width under one device px, which Chrome floors to 0 where a declared border width is at least one device px'} (MISC-PAINT)`,
        manual: `Write border-image and border-width on ${el.element.address} in place of -webkit-border-image.`,
        basis: 'computed-value',
      }));
    }
    if (typeof widths === 'string') return;
  }
  const why = borderImageRefusal(el);
  if (why === null) return;
  const v = el.props.get(why.at) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  // A native refusal is what only the native raster cannot draw exactly; the web output keeps the value as written.
  for (const t of why.native ? targets.filter((x) => x !== 'web') : targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${why.at}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: ${why.reason} (MISC-PAINT)`,
      manual: why.manual,
      basis: 'computed-value',
    }));
  }
}
