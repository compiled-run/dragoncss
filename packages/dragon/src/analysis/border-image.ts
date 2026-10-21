// MISC-PAINT (css-backgrounds-3 §4 and §6): the border image every target draws. Every target accepts a border image whose source is
// none (Chrome paints the border as border-style says, whatever the other longhands hold: NinePieceImagePainter::Paint draws nothing
// without an image), and part 1's gradient border image: one linear-gradient() source to a side or at an angle on the measured 0.01deg
// grid, opaque sRGB stops at percentages, any slices (numbers or percentages, fill or not), widths of numbers, px or auto, no outset
// and border-image-repeat stretch, on a square block-level box with no background image that is neither transformed nor composited.
// The native targets rasterise it with the translated Chrome nine-piece port (paint-gradient.ts planBorderImage); the web output
// keeps it as written. Everything else is refused on every target by name: a url() source, the other images and gradients, a
// translucent or currentcolor stop, a px stop position, outsets, percentage widths, repeat, round and space (MISC-PAINT part 2).
// The values are checked computed, so one that arrives through var() or inherit is checked too.
// -webkit-border-image is refused even where it loses the cascade: Chrome's cascade applies the highest-priority one first, winning
// or not (StyleCascade::ApplyWideOverlapping), and its WebkitBorderImage::ApplyValue sets border-*-width from a fixed-length width
// part (MapNinePieceImage, cited in css/properties/border-image.ts) that a later border-image: none keeps. Any one that holds more than none or a CSS-wide
// keyword is refused, whatever its priority, so this over-refuses one that a higher-priority none outranks.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { BORDER_IMAGE_LONGHANDS, isInitialBorderImage } from '../css/properties/border-image.ts';
import { borderImageRefusal } from './paint-values/border-image.ts';
import type { BorderImageFaults } from '../faults/border-image.ts';
import type { Declaration } from '../css/stylesheet.ts';
import { CSS_WIDE } from '../css/values.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './computed.ts';

/** Whether a -webkit-border-image declaration sets the initial border image and no border width: none or a CSS-wide keyword. */
function isNoneWebkitBorderImage(d: Declaration): boolean {
  if (d.pending !== undefined) return false;
  const source = d.longhands.find((l) => l.property === 'border-image-source');
  return source !== undefined && source.value.kind === 'keyword' && (source.value.value === 'none' || CSS_WIDE.has(source.value.value));
}

/** The element's matched -webkit-border-image declaration, winning or losing, that may set the border widths; null when none. */
function webkitBorderImageAt(el: ResolvedElement): Declaration | null {
  const v = el.props.get('border-image-source') as ResolvedValue;
  const all = [...(v.declaration === null ? [] : [v.declaration]), ...v.losing];
  return all.find((d) => d.property === '-webkit-border-image' && !isNoneWebkitBorderImage(d)) ?? null;
}

/**
 * Refuses a border image no target draws, at the longhand that holds the reason, once per element, and any -webkit-border-image
 * other than none; planted fault borderImageAccepted accepts them.
 */
export function checkBorderImage(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: BorderImageFaults): void {
  if (faults.borderImageAccepted) return;
  const p = BORDER_IMAGE_LONGHANDS.find((q) => !isInitialBorderImage(q, (el.props.get(q) as ResolvedValue).value));
  const webkit = webkitBorderImageAt(el);
  if (p === undefined && webkit === null) return;
  const id = `border-image|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  if (webkit !== null) {
    const source = webkit.longhands.find((l) => l.property === 'border-image-source');
    const written = source === undefined ? webkit.text : valueToString(source.value);
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: authored(webkit.valueSpan),
        target: t,
        message: `-webkit-border-image: ${written} on <${el.element.tag}> ${el.element.address} is unsupported: Chrome sets the border widths from it even where it loses the cascade, and Dragon draws no border image yet (MISC-PAINT); only none is accepted`,
        manual: `Remove -webkit-border-image from ${el.element.address}, or set it to none.`,
        basis: 'computed-value',
      }));
    }
    return;
  }
  const why = borderImageRefusal(el);
  if (why === null) return;
  const v = el.props.get(why.at) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${why.at}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: ${why.reason} (MISC-PAINT)`,
      manual: why.manual,
      basis: 'computed-value',
    }));
  }
}
