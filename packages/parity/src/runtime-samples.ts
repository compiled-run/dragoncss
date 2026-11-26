// REPL-r1 (notes/IMG-dynamic-src-spec.md "Parity fixtures"): a fixture img marked data-dragon-runtime-src is one Dragon layout, and
// Chrome renders it once per sample image: PNGs of five sizes, an SVG with only a viewBox, an SVG with no size, a src that never
// loads and, for an img whose src may be missing, no src. Every sample's boxes must equal Dragon's one layout. The PNGs are 8-bit
// sRGB with four flat quadrants, so a sample's screenshot also shows where Chrome draws the image. parity:runtime-capture commits
// each sample's capture under packages/parity/expected-runtime/<platform>/.
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { Page } from 'playwright';
import type { LayoutInput } from '@dragon/layout';
import { absoluteRects, layoutWithFaults, NO_ENGINE_FAULTS } from '@dragon/layout';
import type { FrontEndResult, RuntimeImageLayout, TreeNode } from 'dragon';
import type { WebCapture } from './capture.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { referenceShapedMeasurer } from './text-shaper-host.ts';

/** The four quadrant colours of a sample PNG: top-left, top-right, bottom-left, bottom-right. */
export const QUADRANTS: readonly (readonly [number, number, number])[] = [[220, 40, 40], [40, 160, 60], [40, 70, 220], [240, 200, 30]];

export type RuntimeSample = {
  readonly id: string;
  /** png and svg load from a data: URL; pending never answers; none leaves the img without a src; swap loads from, then sets url. */
  readonly kind: 'png' | 'svg' | 'pending' | 'none' | 'swap';
  /** The PNG's pixel size (0 for the others). */
  readonly width: number;
  readonly height: number;
  readonly url: string | null;
  /** swap only: the sample loaded first; url and the size are then the src it changes to. */
  readonly from?: RuntimeSample;
};

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = (CRC[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

/** The quadrant a pixel of a width x height sample lies in (0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right). */
export const quadrantOf = (x: number, y: number, width: number, height: number): number => (x * 2 >= width ? 1 : 0) + (y * 2 >= height ? 2 : 0);

/** An 8-bit RGB PNG (untagged, so sRGB) of four flat quadrants. */
export function quadrantPng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(QUADRANTS[quadrantOf(x, y, width, height)] as readonly number[], row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

const png = (width: number, height: number): RuntimeSample => ({ id: `png-${width}x${height}`, kind: 'png', width, height, url: `data:image/png;base64,${quadrantPng(width, height).toString('base64')}` });
const svg = (id: string, text: string): RuntimeSample => ({ id, kind: 'svg', width: 0, height: 0, url: `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}` });

/** The URL the pending sample requests, which the page's route never answers. */
export const PENDING_URL = 'https://dragon.test/runtime-pending.png';

export const RUNTIME_SAMPLES: readonly RuntimeSample[] = [
  png(400, 300), png(4000, 100), png(100, 4000), png(1, 1), png(3, 7),
  svg('svg-viewbox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#2846dc"/></svg>'),
  svg('svg-unsized', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#2846dc"/></svg>'),
  { id: 'pending', kind: 'pending', width: 0, height: 0, url: PENDING_URL },
];
export const NO_SRC_SAMPLE: RuntimeSample = { id: 'none', kind: 'none', width: 0, height: 0, url: null };

/** The fixture whose samples also change the src at run time: the old image stays while the new one is pending. */
export const SRC_CHANGE_FIXTURE = 'replaced-runtime-src-change';
const swap = (id: string, from: RuntimeSample, to: RuntimeSample): RuntimeSample => ({ ...to, id, kind: 'swap', from });
export const SWAP_SAMPLES: readonly RuntimeSample[] = [swap('swap-pending', png(400, 300), RUNTIME_SAMPLES[7] as RuntimeSample), swap('swap-loaded', png(400, 300), png(100, 4000))];

/** The samples of a fixture: every sample, no src when one of its runtime imgs may have none, and the src-change fixture's swaps. */
export function samplesOf(fixture: string, absent: boolean): readonly RuntimeSample[] {
  return [...RUNTIME_SAMPLES, ...(absent ? [NO_SRC_SAMPLE] : []), ...(fixture === SRC_CHANGE_FIXTURE ? SWAP_SAMPLES : [])];
}

/** The DPRs a sample is captured and compared at: the parity lanes' (1, and each device DPR). */
export const RUNTIME_DPRS: readonly number[] = [1, 2, 2.625, 3];

/** The runtimeSrc imgs of a tree input, read from the tree (the fixture reader's runtimeSrc), with whether each may have no src. */
export function runtimeImgs(input: FrontEndResult): { readonly id: string; readonly absent: boolean }[] {
  const out: { id: string; absent: boolean }[] = [];
  const walk = (n: TreeNode): void => {
    if (n.kind === 'element' && n.runtimeSrc !== undefined) out.push({ id: n.id, absent: n.runtimeSrc.absent });
    if (n.kind === 'element') n.children.forEach(walk);
    if (n.kind === 'branch') [...n.then, ...n.else].forEach(walk);
  };
  for (const c of input.tree?.components ?? []) c.root.forEach(walk);
  return out;
}

/**
 * The page script of a sample: every runtimeSrc img (by data-dragon-runtime-src) gets the sample's src, or keeps none, and the
 * capture waits until each one that loads has decoded. The pending src is routed to a request that is never answered.
 */
export function samplePrepare(sample: RuntimeSample): (page: Page) => Promise<void> {
  const loads = (s: RuntimeSample): boolean => s.url !== null && s.url !== PENDING_URL;
  const steps = [...(sample.from === undefined ? [] : [{ url: sample.from.url, wait: loads(sample.from) }]), { url: sample.url, wait: loads(sample) }];
  return async (page) => {
    if (sample.url === PENDING_URL) await page.route(PENDING_URL, () => undefined);
    for (const step of steps) {
      await page.evaluate(async (s: { url: string | null; wait: boolean }) => {
        const imgs = Array.from(document.querySelectorAll('img[data-dragon-runtime-src]')) as HTMLImageElement[];
        if (imgs.length === 0) throw new Error('no runtime img on the page');
        for (const img of imgs) if (s.url !== null) img.src = s.url;
        if (s.wait) await Promise.all(imgs.map((img) => img.decode()));
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      }, step);
    }
  };
}

/**
 * The build-time layout a parity compile proves a runtimeSrc img with: the fixture viewport at every lane DPR, through the
 * reference shaped measurer the lanes lay out with. plant rewrites each layout input first (a planted fault).
 */
export function fixtureRuntimeLayout(viewport: { readonly width: number; readonly height: number }, plant: ((input: LayoutInput) => LayoutInput) | null = null): RuntimeImageLayout {
  const layout = (input: LayoutInput) => {
    const r = layoutWithFaults(plant === null ? input : plant(input), referenceShapedMeasurer(), NO_ENGINE_FAULTS);
    return r.kind === 'ok' ? { kind: 'ok' as const, rects: absoluteRects(r.boxes) } : { kind: 'refused' as const, ...r.unsupported };
  };
  return { devices: RUNTIME_DPRS.map((dpr) => ({ ...viewport, dpr, layout })) };
}

export const runtimeCaptureDir = (platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-runtime/${platform}`);
export const runtimeCapturePath = (caseId: string, sample: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${runtimeCaptureDir(platform)}/${caseId}~${sample}@${dpr}.web.json`;
export const runtimePixelsPath = (caseId: string, sample: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${runtimeCaptureDir(platform)}/${caseId}~${sample}@${dpr}.png`;

export const committedRuntimeCapture = (caseId: string, sample: string, dpr: number): WebCapture => JSON.parse(readFileSync(runtimeCapturePath(caseId, sample, dpr), 'utf8')) as WebCapture;

/** The fixtures whose samples are also screenshotted, at each device DPR in the ltr environment: where the image and the outline are drawn. */
export const RUNTIME_PIXEL_FIXTURES: readonly string[] = ['replaced-runtime-fit', 'replaced-runtime-absent', 'replaced-runtime-src-change'];
