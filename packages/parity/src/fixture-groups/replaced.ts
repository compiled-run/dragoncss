// Fixture group replaced (REPL-a, T051): img and iframe as block-level boxes and flex items, sized as Chrome 145 sizes replaced
// elements (natural size, ratio, the 300x150 default object size, min and max, width and height presentational hints) in both
// directions, with object-fit and object-position as computed values and as drawn (the fit grid, inside the viewport). The
// images are 8-bit sRGB PNG data: URLs with four flat quadrants; iframes load nothing. The rejects name what REPL-a refuses.
// MEDIA-EL: videos as block-level boxes and flex items, sized by their H.264 data: streams (one with SPS frame cropping), letterboxed,
// covered and positioned, with the default object size for no src and for preload none; the rejects name what MEDIA-EL refuses.
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
  reject('reject-replaced-inline', 'DRAGON_UNSUPPORTED_VALUE', imgTag('reject-replaced-inline'), 'display: inline on <img> a makes it an inline-level replaced box'),
  reject('reject-replaced-remote', 'DRAGON_REMOTE_IMAGE', imgTag('reject-replaced-remote'), '<img> a: src https://example.com/a.png is a remote URL'),
  reject('reject-replaced-jpeg', 'DRAGON_UNSUPPORTED_IMAGE', imgTag('reject-replaced-jpeg'), '<img> a: JPEG decodes differ per platform'),
  reject('reject-replaced-abspos', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on <img> a is not supported on a replaced element'),
  reject('reject-replaced-position-calc', 'DRAGON_UNSUPPORTED_VALUE', 'right', 'object-position: right is unsupported'),
  reject('reject-replaced-no-src', 'DRAGON_UNSUPPORTED_IMAGE', imgTag('reject-replaced-no-src'), '<img> a has no src'),
  // A zero natural width or height: PNG IHDR and JPEG SOFn forbid it, so the image never decodes (Chrome draws no image) and the
  // engine's empty-natural-size path is reachable only from a hand-written layout input (replaced.test.ts pins it there).
  reject('reject-replaced-zero-size', 'DRAGON_UNSUPPORTED_IMAGE', imgTag('reject-replaced-zero-size'), '<img> a: the PNG does not parse: zero image size'),
  both('replaced-video'),
  reject('reject-video-remote', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-remote', 'video'), 'attribute src on a is not supported: its src https://example.com/a.mp4 is not a data: URL'),
  reject('reject-video-webm', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-webm', 'video'), 'attribute src on a is not supported: its src is a data: URL of type video/webm'),
  reject('reject-video-rotated', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-rotated', 'video'), 'attribute src on a is not supported: its src does not compile: its video track has a rotation'),
  reject('reject-video-controls', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-controls', 'video'), 'attribute controls on a is not supported'),
  reject('reject-video-poster', 'DRAGON_UNSUPPORTED_ATTRIBUTE', startTag('reject-video-poster', 'video'), 'attribute poster on a is not supported'),
];
