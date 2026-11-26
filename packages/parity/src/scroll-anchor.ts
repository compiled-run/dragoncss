// REPL-r2a ruling 2: where Chrome leaves the page's scroll offset when an img that follows its image changes height above or across
// the top of the viewport (Blink ScrollAnchor), against Dragon's two-case rule (layout runtimeImageScrollShift). Each case is
// captured by parity:scroll-anchor-capture after scrolling and before the load, into expected-scroll-anchor/<platform>.json.
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { quadrantPng } from './runtime-samples.ts';

export type ScrollAnchorCase = {
  readonly id: string;
  /** CSS px of plain block above the img. */
  readonly above: number;
  /** A PNG the img shows before the scroll ([width, height]), or null: it loads from no image (0 by 0). */
  readonly first: readonly [number, number] | null;
  readonly offset: number;
  /** The PNG it then loads. */
  readonly then: readonly [number, number];
};

export const SCROLL_ANCHOR_VIEWPORT = { width: 400, height: 300 } as const;
export const SCROLL_ANCHOR_DPRS: readonly number[] = [1, 3];

export const SCROLL_ANCHOR_CASES: readonly ScrollAnchorCase[] = [
  { id: 'below-at-0', above: 600, first: null, offset: 0, then: [400, 300] },
  { id: 'above', above: 600, first: null, offset: 700, then: [400, 300] },
  { id: 'above-swap', above: 600, first: [400, 300], offset: 1000, then: [100, 4000] },
  { id: 'crossing-swap', above: 600, first: [400, 300], offset: 700, then: [100, 4000] },
  { id: 'top-at-0', above: 0, first: null, offset: 0, then: [400, 300] },
  { id: 'top-above', above: 0, first: null, offset: 100, then: [400, 300] },
];

/** The case's page: a block, the img (100% wide, max-height 320px, as /checkins/[id]'s photo), then a tall block to scroll. */
export function scrollAnchorHtml(c: ScrollAnchorCase): string {
  return `<!DOCTYPE html><html><head><style>body { margin: 0; } .photo { display: block; width: 100%; max-height: 320px; } .above { height: ${c.above}px; } .below { height: 3000px; }</style></head><body><div class="above"></div><img class="photo" alt=""><div class="below"></div></body></html>`;
}

export const pngUrl = (size: readonly [number, number]): string => `data:image/png;base64,${quadrantPng(size[0], size[1]).toString('base64')}`;

/** Per case and DPR, in CSS px: the scroll offset before and after the load, the img's top in the page and its height before and after. */
export type ScrollAnchorCapture = { readonly chrome: string; readonly cases: readonly { readonly id: string; readonly dpr: number; readonly before: number; readonly after: number; readonly top: number; readonly was: number; readonly now: number }[] };

export const scrollAnchorPath = (platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-scroll-anchor/${platform}.json`);
