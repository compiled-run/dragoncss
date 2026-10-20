// css-images-3 §5.3 (css/properties/image-rendering.ts): image-rendering: pixelated draws an img nearest-neighbour on every target
// (the native image stage, emit/paint/image.ts), and auto and -webkit-optimize-contrast draw as auto everywhere. In Chrome 145
// pixelated also samples a url() background and a tiled gradient nearest, which no native target draws; iOS and Android refuse
// pixelated on an element that paints any image layer, every gradient included, since no case proves which ones draw unchanged: a
// background, mask or border image, a list marker image, or generated content with an image. The web output writes the value, so
// Chrome draws it as authored. The value is checked computed, so one that arrives through inheritance is refused where it paints.
// iOS draws an img nearest-neighbour into its box layer at its untransformed size, and Core Animation resamples a transformed layer
// with its linear filter, so the native targets also refuse pixelated on an img under a transform, set or animated, on it or an
// ancestor, as gradient.ts refuses a gradient there (refuseTransformed).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isPixelated } from '../css/properties/image-rendering.ts';
import type { ScrollContainmentFaults } from '../faults/scroll-containment.ts';
import type { Diagnostic } from '../types.ts';
import type { AnimationAnalysis } from './animations.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';
import { transformsSubtree } from './paint-values/gradient.ts';
import { elementWillChange } from './paint-values/transform.ts';

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

/** The properties whose value other than none transforms a subtree, as an animation names them. */
const TRANSFORM_KEYFRAMED = ['transform', 'translate', 'rotate', 'scale'];

/** Whether an element draws its subtree transformed: a transform or will-change: transform (an animated one: refuseAnimatedPixelated). */
function transforms(el: ResolvedElement): boolean {
  return transformsSubtree(el) || elementWillChange(el).includes('transform');
}

/** The refusal of a pixelated img under the transform or animation of `around` (the img's own address for its own). */
function refusePixelatedImg(img: ResolvedElement, around: string, native: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const id = `image-rendering-transformed|${img.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = img.props.get('image-rendering') as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : img.element.node.origin;
  const where = around === img.element.address ? 'its own transform or animation' : `the transform or animation of ${around}`;
  for (const t of native) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `image-rendering: pixelated on <img> ${img.element.address} is unsupported under ${where}: Chrome keeps the texel edges hard through the transform, and the native targets would resample the nearest-neighbour bitmap with a linear filter`,
      manual: `Remove image-rendering: pixelated from ${img.element.address}, or remove the transform from it and its ancestors.`,
      basis: 'computed-value',
    }));
  }
}

/** Calls f on each rendered pixelated img in el's subtree, el included, with the nearest transformed element at or above it, or null. */
function eachPixelatedImg(el: ResolvedElement, transformer: string | null, f: (img: ResolvedElement, around: string | null) => void): void {
  const display = el.props.get('display') as ResolvedValue | undefined;
  if (display !== undefined && display.value.kind === 'keyword' && display.value.value === 'none') return;
  const around = transforms(el) ? el.element.address : transformer;
  const v = el.props.get('image-rendering') as ResolvedValue | undefined;
  if (el.element.tag === 'img' && v !== undefined && isPixelated(v.value)) f(el, around);
  for (const c of el.children) if (c.kind === 'element') eachPixelatedImg(c, around, f);
}

/**
 * Refuses image-rendering: pixelated on iOS and Android on a rendered img that is transformed or inside a transformed element (a
 * transition is checked in the state it reaches): the native targets resample the nearest-neighbour bitmap through the layer's
 * transform, where Chrome keeps the texel edges hard. The planted fault accepts it.
 */
export function checkPixelatedTransformed(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  const native = targets.filter((x) => x === 'ios' || x === 'android');
  if (faults.imageRenderingAccepted || native.length === 0) return;
  eachPixelatedImg(root, null, (img, around) => {
    if (around !== null) refusePixelatedImg(img, around, native, diagnostics, reported);
  });
}

/**
 * As checkPixelatedTransformed, for an element whose @keyframes animate a transform: every pixelated img in its subtree is
 * refused on the native targets. roots are the resolved roots of the analysed cases, in the analysis's order.
 */
export function refuseAnimatedPixelated(analysis: AnimationAnalysis, roots: readonly ResolvedElement[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  if (faults.imageRenderingAccepted || nativeTargets.length === 0) return;
  analysis.cases.forEach((c, i) => {
    const byAddress = new Map<string, ResolvedElement>();
    const index = (el: ResolvedElement): void => {
      byAddress.set(el.element.address, el);
      for (const k of el.children) if (k.kind === 'element') index(k);
    };
    const root = roots[i];
    if (root !== undefined) index(root);
    // checkPixelatedTransformed already refuses an img under a set transform.
    const set = new Set<string>();
    if (root !== undefined) eachPixelatedImg(root, null, (img, around) => {
      if (around !== null) set.add(img.element.address);
    });
    for (const ea of c.elements.values()) {
      const el = byAddress.get(ea.address);
      if (el === undefined) continue;
      const keyframed = ea.animations.some((a) => a.name !== 'none' && a.hasKeyframes && (analysis.keyframes.get(a.name)?.blocks ?? []).some((b) => b.values.some((v) => TRANSFORM_KEYFRAMED.includes(v.property))));
      if (keyframed) eachPixelatedImg(el, ea.address, (img) => {
        if (!set.has(img.element.address)) refusePixelatedImg(img, ea.address, nativeTargets, diagnostics, reported);
      });
    }
  });
}
