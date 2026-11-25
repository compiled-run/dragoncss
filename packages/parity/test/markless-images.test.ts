// Images on a styled Markless page: each `<img src>` that is a file of the app is carried as `images` and read by the caller, so
// Dragon sizes the <img> from the file's natural size (EXIF orientation applied, as Chrome applies it) and every box matches Chrome.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareMarklessExport } from '../src/markless-style-compare.ts';
import { marklessImageFiles, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';

const FILES: Record<string, Uint8Array> = {
  // A PNG 96 by 48.
  'static/badge.png': new Uint8Array(readFileSync(new URL('./markless-images/badge.png', import.meta.url))),
  // A JPEG stored 200 by 120 with EXIF orientation 6: Chrome draws it turned, 120 by 200.
  'lib/turned.jpg': new Uint8Array(readFileSync(new URL('./markless-images/turned.jpg', import.meta.url))),
  // A GIF87a whose logical screen is 30 by 10 (made with sips from a PNG).
  'static/strip.gif': new Uint8Array(readFileSync(new URL('./markless-images/strip.gif', import.meta.url))),
};
const read = (file: string): Uint8Array => {
  const bytes = FILES[file];
  if (bytes === undefined) throw new Error(`no file ${file}`);
  return bytes;
};

const CSS = `.page { padding: 16px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.half { width: 50%; }
.thumb { width: 60px; }
`;

const input = (images?: readonly { src: string; file: string }[]): string =>
  JSON.stringify({
    version: 'markless.native-style-input/0',
    component: 'Gallery',
    nodes: [
      { kind: 'element', id: 'h0', element: 'main', parent: null, attributes: { class: 'page' } },
      { kind: 'element', id: 'h1', element: 'img', parent: 'h0', attributes: { src: '/static/badge.png', alt: 'Badge' } },
      { kind: 'element', id: 'h2', element: 'img', parent: 'h0', attributes: { src: '/static/badge.png', alt: 'Wide badge', class: 'half' } },
      { kind: 'element', id: 'h3', element: 'img', parent: 'h0', attributes: { src: '/@markless-asset/lib/turned.jpg', alt: 'Turned photo' } },
      { kind: 'element', id: 'h4', element: 'img', parent: 'h0', attributes: { src: '/@markless-asset/lib/turned.jpg', alt: 'Small photo', class: 'thumb' } },
      { kind: 'element', id: 'h5', element: 'img', parent: 'h0', attributes: { src: '/static/strip.gif', alt: 'Strip' } },
      { kind: 'element', id: 'h6', element: 'img', parent: 'h0', attributes: { src: '/static/strip.gif', alt: 'Wide strip', class: 'thumb' } },
    ],
    css: CSS,
    states: [],
    ...(images === undefined ? {} : { images }),
  });

const IMAGES = [
  { src: '/static/badge.png', file: 'static/badge.png' },
  { src: '/@markless-asset/lib/turned.jpg', file: 'lib/turned.jpg' },
  { src: '/static/strip.gif', file: 'static/strip.gif' },
];

describe('images on a styled Markless page', () => {
  it('lays out an interaction state of a banded page with host-drawn images (the host draws them in every program)', () => {
    // An @media rule makes the compile banded, and :active an interaction state: its program is lowered with the host images too.
    const banded = JSON.parse(input(IMAGES)) as { css: string };
    banded.css += '@media (min-width: 700px) { .page { padding: 24px; } }\n.thumb:active { opacity: 0.5; }\n';
    const { exported } = marklessStyleExport(JSON.stringify(banded), 'gallery.json', read);
    for (const t of ['ios', 'android'] as const) expect(exported.targets[t], t).toBeDefined();
  });
  it('sizes each <img> from its file as Chrome does (natural size, a CSS width with the ratio, EXIF orientation, a GIF), within 1 device px', async () => {
    const text = input(IMAGES);
    const { exported } = marklessStyleExport(text, 'gallery.json', read);
    for (const t of ['ios', 'android'] as const) {
      // Frames are in device px.
      const { dpr } = exported.targets[t]!;
      const frames = new Map(exported.targets[t]!.assignments[0]!.nodes.map((n) => [n.id, n.frame]));
      expect(frames.get('h1'), t).toMatchObject({ width: 96 * dpr, height: 48 * dpr });
      expect(frames.get('h3'), t).toMatchObject({ width: 120 * dpr, height: 200 * dpr });
      expect(frames.get('h4'), t).toMatchObject({ width: 60 * dpr, height: 100 * dpr });
      // A GIF, which Dragon's own paint does not decode, is laid out from its logical screen for the host to draw.
      expect(frames.get('h5'), t).toMatchObject({ width: 30 * dpr, height: 10 * dpr });
      expect(frames.get('h6'), t).toMatchObject({ width: 60 * dpr, height: 20 * dpr });
    }
    const parsed = parseMarklessStyleInput(text);
    const report = await compareMarklessExport(parsed, exported, undefined, 'light', [], null, null, marklessImageFiles(parsed, read));
    expect(report.rows.filter((r) => !r.pass)).toEqual([]);
    expect(report.compared).toBeGreaterThan(0);
  });

  it('refuses an image entry that is not { src, file } of a relative path, one listed twice, and an input that names files with no reader', () => {
    const bad = (images: unknown): string => JSON.stringify({ ...JSON.parse(input()), images });
    expect(() => parseMarklessStyleInput(bad([{ src: '/a.png' }]))).toThrow('an image is { src, file }');
    expect(() => parseMarklessStyleInput(bad([{ src: '/a.png', file: '/abs/a.png' }]))).toThrow('is not a path relative to the input file');
    expect(() => parseMarklessStyleInput(bad([{ src: '/a.png', file: 'a.png' }, { src: '/a.png', file: 'b.png' }]))).toThrow('/a.png is listed twice');
    expect(() => marklessStyleExport(input(IMAGES), 'gallery.json')).toThrow('the input names font or image files, and no reader for them was given');
  });

  it('refuses an object-fit other than fill, which the host does not draw, naming the img', () => {
    const covered = input(IMAGES).replace('.thumb { width: 60px; }', '.thumb { width: 60px; height: 60px; object-fit: cover; }');
    expect(covered).not.toBe(input(IMAGES));
    expect(() => marklessStyleExport(covered, 'gallery.json', read)).toThrow('object-fit: cover; the host draws the picture filling its box (object-fit: fill)');
  });

  it('refuses an <img> whose src no image entry reads, naming it', () => {
    expect(() => marklessStyleExport(input([IMAGES[0]!, IMAGES[2]!]), 'gallery.json', read)).toThrow('/@markless-asset/lib/turned.jpg');
  });
});
