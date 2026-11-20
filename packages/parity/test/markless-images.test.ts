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
  // SVG files: width and height 60 by 40; width 90px with a 70 by 30 viewBox; height 50 with a 20 by 40 viewBox.
  'static/flag.svg': new Uint8Array(readFileSync(new URL('./markless-images/flag.svg', import.meta.url))),
  'static/wide.svg': new Uint8Array(readFileSync(new URL('./markless-images/wide.svg', import.meta.url))),
  'static/tall.svg': new Uint8Array(readFileSync(new URL('./markless-images/tall.svg', import.meta.url))),
  // SVG files with only a viewBox ratio, and with a width and no ratio.
  'static/ratio.svg': new Uint8Array(readFileSync(new URL('./markless-images/ratio.svg', import.meta.url))),
  'static/lone.svg': new Uint8Array(readFileSync(new URL('./markless-images/lone.svg', import.meta.url))),
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
      { kind: 'element', id: 'h7', element: 'img', parent: 'h0', attributes: { src: '/static/flag.svg', alt: 'Flag' } },
      { kind: 'element', id: 'h8', element: 'img', parent: 'h0', attributes: { src: '/static/wide.svg', alt: 'Wide' } },
      { kind: 'element', id: 'h9', element: 'img', parent: 'h0', attributes: { src: '/static/tall.svg', alt: 'Tall' } },
      { kind: 'element', id: 'h10', element: 'img', parent: 'h0', attributes: { src: '/static/tall.svg', alt: 'Wide tall', class: 'thumb' } },
    ],
    css: CSS,
    states: [],
    ...(images === undefined ? {} : { images }),
  });

const IMAGES = [
  { src: '/static/badge.png', file: 'static/badge.png' },
  { src: '/@markless-asset/lib/turned.jpg', file: 'lib/turned.jpg' },
  { src: '/static/strip.gif', file: 'static/strip.gif' },
  { src: '/static/flag.svg', file: 'static/flag.svg' },
  { src: '/static/wide.svg', file: 'static/wide.svg' },
  { src: '/static/tall.svg', file: 'static/tall.svg' },
];

describe('images on a styled Markless page', () => {
  it('sizes each <img> from its file as Chrome does (natural size, a CSS width with the ratio, EXIF orientation, a GIF, an SVG file), within 1 device px', async () => {
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
      // An SVG file's root width and height, or one of them with the viewBox ratio.
      expect(frames.get('h7'), t).toMatchObject({ width: 60 * dpr, height: 40 * dpr });
      expect(frames.get('h8')?.width, t).toBe(90 * dpr);
      expect(frames.get('h8')?.height, t).toBeCloseTo((90 * 30 / 70) * dpr, 0);
      expect(frames.get('h9'), t).toMatchObject({ width: 25 * dpr, height: 50 * dpr });
      expect(frames.get('h10'), t).toMatchObject({ width: 60 * dpr, height: 120 * dpr });
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

  it('refuses an SVG file with only a viewBox ratio, or one size and no ratio, which Dragon does not lay out', () => {
    const swapped = (file: string): string => input([...IMAGES.slice(0, 5), { src: '/static/tall.svg', file }]);
    expect(() => marklessStyleExport(swapped('static/ratio.svg'), 'gallery.json', read)).toThrow('a viewBox but no width or height, so the image has only a natural ratio');
    expect(() => marklessStyleExport(swapped('static/lone.svg'), 'gallery.json', read)).toThrow('one size and no viewBox');
  });

  it('refuses an <img> whose src no image entry reads, naming it', () => {
    expect(() => marklessStyleExport(input([IMAGES[0]!, IMAGES[2]!]), 'gallery.json', read)).toThrow('/@markless-asset/lib/turned.jpg');
  });
});
