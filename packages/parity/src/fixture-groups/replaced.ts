// Fixture group replaced (REPL-a, T051): img and iframe as block-level boxes and flex items, sized as Chrome 145 sizes replaced
// elements (natural size, ratio, the 300x150 default object size, min and max, width and height presentational hints) in both
// directions, with object-fit and object-position as computed values and as drawn (the fit grid, inside the viewport). The
// images are 8-bit sRGB PNG data: URLs with four flat quadrants; iframes load nothing. The rejects name what REPL-a refuses.
// MEDIA-EL: videos without a stream (no src, or preload none) as block-level boxes and flex items at the default object size, with
// width and height hints, padding, a border and max-width; the rejects name what MEDIA-EL refuses. A video with a stream is refused
// on iOS and Android until a lane proves its first frame (videos/compile.ts), so no layout fixture holds one yet.
import { readFileSync } from 'node:fs';
import type { FixtureSpec } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { both, reject } from './define.ts';

/** The img start tag of a reject fixture: an image diagnostic points at the element's src, which the fixture tree spans as the tag. */
const imgTag = (id: string): string => startTag(id, 'img');

/** A reject fixture's start tag of one element: an attribute diagnostic points at the attribute, which the fixture tree spans as the tag. */
function startTag(id: string, tag: string): string {
  const m = new RegExp(`<${tag} [^>]*>`).exec(readFileSync(repoPath(`packages/parity/fixtures/${id}.html`), 'utf8'));
  if (m === null) throw new Error(`${id} has no ${tag}`);
  return m[0];
}

export const REPLACED: readonly FixtureSpec[] = [
  both('replaced-block'),
  both('replaced-flex-row'),
  both('replaced-flex-column'),
  both('replaced-intrinsic'),
  both('replaced-demo'),
  // Every object-fit with keyword and length object-positions, letterboxed so the destination edges sit inside the content boxes.
  both('replaced-fit'),
  // image-rendering: pixelated imgs upscaled whole and fractionally, contained, covered and rounded (nearest-neighbour texels), an
  // -webkit-optimize-contrast img Chrome draws as auto, and pixelated text and a bordered box, which paint no image layer.
  both('replaced-pixelated'),
  // GRID-items: imgs, iframes and videos as grid items, sized in their grid areas (normal is fit-content, stretch is explicit),
  // contributing to intrinsic tracks, and in the shapes Markless's shop and check-in apps write.
  both('grid-replaced-items'),
  both('grid-replaced-media'),
  both('grid-replaced-tracks'),
  both('grid-replaced-markless'),
  // RF-INL lays an inline img out on its block container's lines (inline-replaced); inside an inline box it stays unproven (INL2c).
  reject('reject-replaced-inline', 'DRAGON_UNPROVEN_CONTEXT', imgTag('reject-replaced-inline'), 'inline <img> a is an atomic inline inside the inline box <span> s'),
  reject('reject-replaced-remote', 'DRAGON_REMOTE_IMAGE', imgTag('reject-replaced-remote'), '<img> a: src https://example.com/a.png is a remote URL'),
  reject('reject-replaced-jpeg', 'DRAGON_UNSUPPORTED_IMAGE', imgTag('reject-replaced-jpeg'), '<img> a: JPEG decodes differ per platform'),
  reject('reject-replaced-abspos', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on <img> a is not supported on a replaced element'),
  reject('reject-replaced-position-calc', 'DRAGON_UNSUPPORTED_VALUE', 'right', 'object-position: right is unsupported'),
  reject('reject-replaced-no-src', 'DRAGON_UNSUPPORTED_IMAGE', imgTag('reject-replaced-no-src'), '<img> a has no src'),
  // A zero natural width or height: PNG IHDR and JPEG SOFn forbid it, so the image never decodes (Chrome draws no image) and the
  // engine's empty-natural-size path is reachable only from a hand-written layout input (replaced.test.ts pins it there).
  reject('reject-replaced-zero-size', 'DRAGON_UNSUPPORTED_IMAGE', imgTag('reject-replaced-zero-size'), '<img> a: the PNG does not parse: zero image size'),
  // REPL-r1: imgs whose src the app sets at run time (data-dragon-runtime-src), laid out once and compared with Chrome once per
  // sample image (runtime-samples.ts); the rejects are the shapes whose box would follow the image.
  both('replaced-runtime-sized'),
  both('replaced-runtime-ratio'),
  both('replaced-runtime-fit'),
  both('replaced-runtime-flex'),
  both('replaced-runtime-grid'),
  both('replaced-runtime-absent'),
  both('replaced-runtime-src-change'),
  reject('reject-runtime-src-auto-height', 'DRAGON_RUNTIME_IMAGE_SIZE', imgTag('reject-runtime-src-auto-height'), "<img> a has a src set at run time, and its used size reads the image's natural ratio, since its height is auto"),
  reject('reject-runtime-src-auto-ratio', 'DRAGON_RUNTIME_IMAGE_SIZE', imgTag('reject-runtime-src-auto-ratio'), "<img> a has a src set at run time, and its max-content contribution (a shrink-to-fit width, an intrinsic grid track or a flex container's intrinsic size measures it) reads the image's natural ratio, which comes before the width and height attributes' ratio"),
  reject('reject-runtime-src-flex-auto-min', 'DRAGON_RUNTIME_IMAGE_SIZE', imgTag('reject-runtime-src-flex-auto-min'), '<img> a has a src set at run time, and its content size as a flex item'),
  reject('reject-runtime-src-shrink-to-fit', 'DRAGON_RUNTIME_IMAGE_SIZE', imgTag('reject-runtime-src-shrink-to-fit'), '<img> a has a src set at run time, and its max-content contribution'),
  reject('reject-runtime-src-absent-alt', 'DRAGON_RUNTIME_IMAGE_SIZE', imgTag('reject-runtime-src-absent-alt'), '<img> a has a src set at run time that may be missing, and a missing src shows its alt text'),
  reject('reject-runtime-src-selector', 'DRAGON_RUNTIME_IMAGE_SIZE', imgTag('reject-runtime-src-selector'), 'a selector of the rule at'),
  both('replaced-video'),
  reject('reject-video-remote', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-remote', 'video'), 'attribute src on a is not supported: its src https://example.com/a.mp4 is not a data: URL'),
  reject('reject-video-webm', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-webm', 'video'), 'attribute src on a is not supported: its src is a data: URL of type video/webm'),
  reject('reject-video-rotated', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-rotated', 'video'), 'attribute src on a is not supported: its src does not compile: its video track has a rotation'),
  // Chrome 145 turns a stream by its movie matrix too: this 64x48 stream with a 90-degree mvhd lays out at 48x64.
  reject('reject-video-movie-rotated', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-movie-rotated', 'video'), 'attribute src on a is not supported: its src does not compile: its movie has a rotation'),
  reject('reject-video-controls', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-controls', 'video'), 'attribute controls on a is not supported'),
  reject('reject-video-poster', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-poster', 'video'), 'attribute poster on a is not supported'),
];
