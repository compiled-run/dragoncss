// css-images-3 §5.3: image-rendering (initial auto), inherited (Chrome 145 css_properties.json5). It picks the scaling algorithm of
// an image drawn at another size than its own: background images, list-style images and replaced content. Dragon scales every image
// as auto does, the value its image cases are proven at, and has no pixelated, crisp-edges or optimize-contrast drawing yet, so it
// accepts the initial value alone and refuses every other value (analysis/scroll-containment.ts). Rows are proven by the computed value, as no layout
// lane reads it.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial } from './initial-only.ts';

export const IMAGE_RENDERING_LONGHANDS = ['image-rendering'] as const;
export const IMAGE_RENDERING_SHORTHANDS = [] as const;
export const IMAGE_RENDERING_INHERITED: readonly (typeof IMAGE_RENDERING_LONGHANDS)[number][] = ['image-rendering'];
export const IMAGE_RENDERING_CONTAINER: readonly (typeof IMAGE_RENDERING_LONGHANDS)[number][] = [];
export const IMAGE_RENDERING_TEXT_ROLE: readonly (typeof IMAGE_RENDERING_LONGHANDS)[number][] = [];

export const IMAGE_RENDERING_ASPECTS: { readonly [P in (typeof IMAGE_RENDERING_LONGHANDS)[number]]: PropertyAspect } = { 'image-rendering': { layout: false, paint: true } };

/** The initial value, the only one Dragon accepts. */
export const IMAGE_RENDERING_INITIAL: { readonly [P in (typeof IMAGE_RENDERING_LONGHANDS)[number]]: CssValue } = { 'image-rendering': kwInitial('auto') };

export const IMAGE_RENDERING_VALUE_PARSERS: { readonly [P in (typeof IMAGE_RENDERING_LONGHANDS)[number]]: InitialOnlyParser } = {
  'image-rendering': initialOnlyLonghand('image-rendering', IMAGE_RENDERING_INITIAL['image-rendering']),
};
