// Fixture group bg-image (BG2-u part 1, notes/T074-bg2-spec.md R10): background-image url() on web, in both directions. The images
// are 8-bit sRGB PNG data: URLs with four flat quadrants (24x16 and 16x16); each box draws one url() layer at size auto over a
// colour or none, repeating on both axes, one or neither, at px, % and keyword positions, with content-box and border-box origins,
// a padding-box clip and a longhand split over two rules. Native refuses every url() layer until part 2, so the lanes compile
// the case on native as a lane-only case (project.ts): it proves web rows only, and the device pixel lanes skip each url() box
// (paint-samples/gradient.ts). The rejects cover what no target draws yet: a remote URL, cover, a layer list and space; the
// native refusal and the source rules (mapped srcs, a linked stylesheet, var(), whose profile check names no feature the lanes
// could run lane-only) are proven in packages/dragon/test/background-url.test.ts.
import { readFileSync } from 'node:fs';
import type { FixtureSpec } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { both, reject } from './define.ts';

/** The value of a reject fixture's background-image declaration, which a layer refusal points at. */
const imageValue = (id: string): string => {
  const m = /background-image: (.*); }/.exec(readFileSync(repoPath(`packages/parity/fixtures/${id}.html`), 'utf8'));
  if (m === null) throw new Error(`${id} declares no background-image`);
  return m[1] as string;
};

export const BG_IMAGE: readonly FixtureSpec[] = [
  both('bg-image-web'),
  reject('reject-bg-image-remote', 'DRAGON_REMOTE_IMAGE', 'url(https://example.com/a.png)', 'background-image on u: url() https://example.com/a.png is a remote URL'),
  reject('reject-bg-image-cover', 'DRAGON_UNSUPPORTED_VALUE', 'cover', 'background-size on u: a url() image is drawn at its natural size only'),
  reject('reject-bg-image-layers', 'DRAGON_UNSUPPORTED_VALUE', imageValue('reject-bg-image-layers'), 'background-image on u: a url() image is drawn only as the one layer of its box'),
  reject('reject-bg-image-space', 'DRAGON_UNSUPPORTED_VALUE', 'space', 'background-repeat on u: background-repeat: space on a url() image'),
];
