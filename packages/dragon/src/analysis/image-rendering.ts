// css-images-3 §5.3 (css/properties/image-rendering.ts): image-rendering: pixelated draws an img nearest-neighbour on every target
// (the native image stage, emit/paint/image.ts), and auto and -webkit-optimize-contrast draw as auto everywhere. In Chrome 145
// pixelated also samples a url() background and a tiled gradient nearest, which no native target draws, so iOS and Android refuse
// pixelated on an element that paints an image layer: a background, mask or border image, a list marker image, or generated content
// with an image. The web output writes the value, so Chrome draws it as authored. The value is checked computed, so one that
// arrives through inheritance is refused where it paints.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isPixelated } from '../css/properties/image-rendering.ts';
import type { ScrollContainmentFaults } from '../faults/scroll-containment.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** The longhands whose computed value other than none paints an image layer of the element. */
const IMAGE_LAYER_LONGHANDS = ['background-image', 'mask-image', 'border-image-source', 'list-style-image'] as const;

/** The first longhand of the element that paints an image layer Chrome draws under image-rendering, or null. */
function imageLayerOf(el: ResolvedElement): string | null {
  for (const p of IMAGE_LAYER_LONGHANDS) {
    const v = el.props.get(p) as ResolvedValue | undefined;
    if (v !== undefined && !(v.value.kind === 'keyword' && v.value.value === 'none')) return p;
  }
  const content = el.props.get('content') as ResolvedValue | undefined;
  return content !== undefined && /url\(|image\(|image-set\(|gradient\(/i.test(valueToString(content.value)) ? 'content' : null;
}

/** Refuses image-rendering: pixelated on iOS and Android where the element paints an image layer; the planted fault accepts it. */
export function checkImageRendering(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  if (faults.imageRenderingAccepted) return;
  const v = el.props.get('image-rendering') as ResolvedValue;
  if (!isPixelated(v.value)) return;
  const layer = imageLayerOf(el);
  if (layer === null) return;
  const id = `image-rendering|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets.filter((x) => x === 'ios' || x === 'android')) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `image-rendering: pixelated on <${el.element.tag}> ${el.element.address} is unsupported with its ${layer}: Chrome samples that image layer nearest-neighbour, and Dragon draws only an img's image so`,
      manual: `Remove image-rendering: pixelated from ${el.element.address}, or set its ${layer} to none.`,
      basis: 'computed-value',
    }));
  }
}
