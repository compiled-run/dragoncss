// MISC-PAINT (css-backgrounds-3 §4): the border image longhands are accepted at their initial values alone
// (css/properties/border-image.ts). No target draws a border image yet, so any other computed value is refused on every target
// where it applies (none is inherited), once per element. The values are checked computed, so one that arrives through var() or
// inherit is refused too. With every longhand initial, border-image-source is none and Chrome draws the border as border-style says.
// -webkit-border-image is refused even where it loses the cascade: Chrome's cascade applies the highest-priority one first, winning
// or not (StyleCascade::ApplyWideOverlapping), and its WebkitBorderImage::ApplyValue sets border-*-width from a fixed-length width
// part (MapNinePieceImage, cited in css/properties/border-image.ts) that a later border-image: none keeps. Any one that holds more than none or a CSS-wide
// keyword is refused, whatever its priority, so this over-refuses one that a higher-priority none outranks.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { BORDER_IMAGE_LONGHANDS, isInitialBorderImage } from '../css/properties/border-image.ts';
import type { BorderImageFaults } from '../faults/border-image.ts';
import type { Declaration } from '../css/stylesheet.ts';
import { CSS_WIDE } from '../css/values.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

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

/** Refuses the first of the element's border image longhands that is not initial; planted fault borderImageAccepted accepts them. */
export function checkBorderImage(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: BorderImageFaults): void {
  if (faults.borderImageAccepted) return;
  const p = BORDER_IMAGE_LONGHANDS.find((q) => !isInitialBorderImage(q, (el.props.get(q) as ResolvedValue).value));
  const webkit = p === undefined ? webkitBorderImageAt(el) : null;
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
  const v = el.props.get(p as (typeof BORDER_IMAGE_LONGHANDS)[number]) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon draws no border image yet (MISC-PAINT); only the initial value is accepted`,
      manual: `Remove the border image from ${el.element.address}, or set border-image: none.`,
      basis: 'computed-value',
    }));
  }
}
