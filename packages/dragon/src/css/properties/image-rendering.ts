// css-images-3 §5.3: image-rendering (initial auto), inherited (Chrome 145 css_properties.json5). It picks the scaling algorithm of
// an image drawn at another size than its own. Chrome 145 parses three keywords, in any ASCII case: auto, -webkit-optimize-contrast
// and pixelated; it drops every other value (crisp-edges, smooth, high-quality, optimizeSpeed, optimizeQuality), so Dragon drops
// them too (packages/parity/test/render-anchor-parse.test.ts pins the parse). Blink maps -webkit-optimize-contrast to low
// interpolation quality; the upscaled imgs, url() backgrounds and gradients probed in Chrome 145 drew pixel for pixel as auto, so
// every target accepts it as auto. pixelated samples an img nearest-neighbour, which the native image stage draws
// (emit/paint/image.ts); it can also change url() and gradient backgrounds, which no native target draws that way, so the native
// targets refuse it on an element that paints any image layer, and on an img under a transform (analysis/image-rendering.ts). The web output writes the value as computed.
import type { CssNode } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { kwInitial } from './initial-only.ts';

export const IMAGE_RENDERING_LONGHANDS = ['image-rendering'] as const;
export const IMAGE_RENDERING_SHORTHANDS = [] as const;
export const IMAGE_RENDERING_INHERITED: readonly (typeof IMAGE_RENDERING_LONGHANDS)[number][] = ['image-rendering'];
export const IMAGE_RENDERING_CONTAINER: readonly (typeof IMAGE_RENDERING_LONGHANDS)[number][] = [];
export const IMAGE_RENDERING_TEXT_ROLE: readonly (typeof IMAGE_RENDERING_LONGHANDS)[number][] = [];

export const IMAGE_RENDERING_ASPECTS: { readonly [P in (typeof IMAGE_RENDERING_LONGHANDS)[number]]: PropertyAspect } = { 'image-rendering': { layout: false, paint: true } };

export const IMAGE_RENDERING_INITIAL: { readonly [P in (typeof IMAGE_RENDERING_LONGHANDS)[number]]: CssValue } = { 'image-rendering': kwInitial('auto') };

/** The keywords Chrome 145 parses (css_properties.json5 image-rendering, keywords auto, -webkit-optimize-contrast, pixelated). */
export const IMAGE_RENDERING_KEYWORDS = ['auto', '-webkit-optimize-contrast', 'pixelated'] as const;
export type ImageRendering = (typeof IMAGE_RENDERING_KEYWORDS)[number];

/** Whether a computed image-rendering samples images nearest-neighbour (pixelated); auto and -webkit-optimize-contrast filter. */
export const isPixelated = (v: CssValue | undefined): boolean => v !== undefined && v.kind === 'keyword' && v.value === 'pixelated';

function parseImageRendering(tokens: readonly CssNode[]): ReturnType<InitialOnlyParser> {
  const t = tokens[0];
  const k = tokens.length === 1 && t !== undefined && t.type === 'Identifier' ? asciiLower(String(t['name'])) : null;
  if (k === null || !(IMAGE_RENDERING_KEYWORDS as readonly string[]).includes(k)) return { kind: 'invalid', reason: 'image-rendering takes auto, -webkit-optimize-contrast or pixelated (Chrome 145 drops any other value)' };
  return { kind: 'ok', longhands: [{ property: 'image-rendering', value: kwInitial(k), explicit: true }] };
}

export const IMAGE_RENDERING_VALUE_PARSERS: { readonly [P in (typeof IMAGE_RENDERING_LONGHANDS)[number]]: InitialOnlyParser } = {
  'image-rendering': parseImageRendering,
};
