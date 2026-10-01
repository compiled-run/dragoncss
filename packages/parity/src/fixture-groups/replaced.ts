// Fixture group replaced (REPL-a, T051): img and iframe as block-level boxes and flex items, sized as Chrome 145 sizes replaced
// elements (natural size, ratio, the 300x150 default object size, min and max, width and height presentational hints) in both
// directions, with object-fit and object-position as computed values and as drawn (the fit grid, inside the viewport). The
// images are 8-bit sRGB PNG data: URLs with four flat quadrants; iframes load nothing. The rejects name what REPL-a refuses.
import { readFileSync } from 'node:fs';
import type { FixtureSpec } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { both, reject } from './define.ts';

/** The img start tag of a reject fixture: an image diagnostic points at the element's src, which the fixture tree spans as the tag. */
const imgTag = (id: string): string => {
  const m = /<img [^>]*>/.exec(readFileSync(repoPath(`packages/parity/fixtures/${id}.html`), 'utf8'));
  if (m === null) throw new Error(`${id} has no img`);
  return m[0];
};

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
];
