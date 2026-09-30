import { describe, expect, it } from 'vitest';
import { decodePng } from '../src/pixel-reference.ts';
import type { GalleryCaseRef, GalleryPage } from '../src/gallery.ts';
import { captureColumn, captureEach, captureInBatches, cropImage, encodePng, featureLabels, galleryExitCode, galleryHtml, newCapture, parseGalleryArgs, relativeUrl, selectGalleryCases } from '../src/gallery.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';

const ref = (id: string, fixture: string, group: string, isInitial: boolean, direction: 'ltr' | 'rtl' = 'ltr'): GalleryCaseRef => ({ id, fixture, group, isInitial, direction });

describe('native gallery', () => {
  it('parses --cases and refuses anything else', () => {
    expect(parseGalleryArgs([])).toEqual({ cases: null });
    expect(parseGalleryArgs(['--', '--cases', 'a, b#1'])).toEqual({ cases: ['a', 'b#1'] });
    expect(() => parseGalleryArgs(['--cases'])).toThrow(/comma-separated/);
    expect(() => parseGalleryArgs(['--cases', '--x'])).toThrow(/comma-separated/);
    expect(() => parseGalleryArgs(['--cases', 'a,,b'])).toThrow(/empty case id/);
    expect(() => parseGalleryArgs(['--cases', 'a', '--cases', 'b'])).toThrow(/twice/);
    expect(() => parseGalleryArgs(['--case', 'a'])).toThrow(/unknown argument/);
  });

  it('selects one initial left-to-right case per fixture, showcase first, or exactly the named cases', () => {
    const all = [
      ref('t#0-rtl', 't', 'm', true, 'rtl'), ref('t#0', 't', 'm', false), ref('t#1', 't', 'm', true), ref('t#1-rtl', 't', 'm', false, 'rtl'),
      ref('h', 'h', 'm', true), ref('h-rtl', 'h', 'm', true, 'rtl'),
      ref('r', 'r', 'm', true, 'rtl'),
      ref('s', 's', 'showcase', true),
    ];
    expect(selectGalleryCases(all, null).map((c) => c.id)).toEqual(['s', 't#1', 'h', 'r']);
    expect(selectGalleryCases(all, ['h-rtl', 't#0']).map((c) => c.id)).toEqual(['h-rtl', 't#0']);
    expect(() => selectGalleryCases(all, ['h', 'nope', 'reject-x'])).toThrow(/2 id\(s\) that are not layout cases: nope, reject-x/);
    expect(() => selectGalleryCases(all, ['h', 'h'])).toThrow(/h more than once/);
  });

  it('registers the showcase fixture in the showcase group', () => {
    const g = FIXTURE_GROUPS.find((x) => x.id === 'showcase');
    expect(g?.fixtures.map((f) => [f.id, f.kind])).toEqual([['showcase-player-card', 'layout']]);
  });

  it('labels a case with its distinct features', () => {
    expect(featureLabels(['display:flex@block', 'display:flex@flex-item', 'border-top-color:<color>@block'])).toEqual(['border-top-color:<color>', 'display:flex']);
    expect(() => featureLabels(['display:flex'])).toThrow(/no @context/);
  });

  it('crops inside the image only and round-trips its PNG', () => {
    const data = new Uint8Array(4 * 3 * 4).map((_, i) => i);
    const img = { width: 4, height: 3, data };
    const c = cropImage(img, 1, 1, 2, 2);
    expect([...c.data]).toEqual([...data.subarray(20, 28), ...data.subarray(36, 44)]);
    expect(decodePng(encodePng(c))).toEqual({ width: 2, height: 2, data: c.data });
    expect(decodePng(encodePng(img))).toEqual(img);
    expect(() => cropImage(img, 3, 0, 2, 1)).toThrow(/not inside/);
    expect(() => cropImage(img, 0, 0, 0, 1)).toThrow(/not inside/);
    expect(() => cropImage(img, 0.5, 0, 1, 1)).toThrow(/not inside/);
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(15) })).toThrow(/needs 16/);
  });

  it('writes escaped rows, encoded image paths and the Ahem note', () => {
    const page: GalleryPage = {
      generated: 'now',
      viewport: { width: 400, height: 300 },
      columns: [{ title: 'Chrome', detail: 'DPR 3' }, { title: 'iOS', detail: '' }],
      rows: [{ id: 'tree-x#1', features: ['color:<color>'], cells: [{ kind: 'image', src: 'img/chrome/tree-x#1.png' }, { kind: 'missing', reason: 'boot <failed>' }] }],
      problems: ['a & b'],
    };
    const html = galleryHtml(page);
    expect(html).toContain('src="img/chrome/tree-x%231.png"');
    expect(html).toContain('boot &lt;failed&gt;');
    expect(html).toContain('<span>color:&lt;color&gt;</span>');
    expect(html).toContain('<li>a &amp; b</li>');
    expect(html).toMatch(/Text is set in Ahem/);
    expect(relativeUrl('img/ios/a b#1.png')).toBe('img/ios/a%20b%231.png');
    expect(() => galleryHtml({ ...page, rows: [{ ...page.rows[0]!, cells: [] }] })).toThrow(/0 cells, 2 columns/);
  });

  it('records a failed capture as a missing cell and a problem, and takes the rest', async () => {
    const cap = newCapture();
    await captureEach(cap, ['a', 'b', 'c'], 'Chrome', async (id) => {
      if (id === 'b') throw new Error('Page.captureScreenshot failed');
      return `img/chrome/${id}.png`;
    });
    expect([...cap.cells]).toEqual([
      ['a', { kind: 'image', src: 'img/chrome/a.png' }],
      ['b', { kind: 'missing', reason: 'Chrome: b: Page.captureScreenshot failed' }],
      ['c', { kind: 'image', src: 'img/chrome/c.png' }],
    ]);
    expect(cap.problems).toEqual(['Chrome: b: Page.captureScreenshot failed']);
  });

  it('runs every batch when one fails, records batch problems, and cleans up after each batch', async () => {
    const cap = newCapture();
    const cleaned: number[] = [];
    const taken: string[] = [];
    await captureInBatches(cap, ['a', 'b', 'c', 'd', 'e'], 2, 'dev', async (_batch, index) => {
      if (index === 0) throw new Error('app crashed');
      return index === 1 ? 'the app ran at scale 2' : null;
    }, async (id) => {
      taken.push(id);
      if (id === 'd') throw new Error('no screenshot');
      return `img/ios/${id}.png`;
    }, (index) => {
      cleaned.push(index);
      if (index === 2) throw new Error('rm failed');
    });
    expect(taken).toEqual(['c', 'd', 'e']);
    expect(cleaned).toEqual([0, 1, 2]);
    expect([...cap.cells].map(([id, c]) => [id, c.kind])).toEqual([['a', 'missing'], ['b', 'missing'], ['c', 'image'], ['d', 'missing'], ['e', 'image']]);
    expect(cap.cells.get('a')).toEqual({ kind: 'missing', reason: 'dev: cases 1-2: app crashed' });
    expect(cap.problems).toEqual([
      'dev: 2 case(s) not taken (cases 1-2: app crashed)',
      'dev: cases 3-4: the app ran at scale 2',
      'dev: d: no screenshot',
      'dev: cleanup after cases 5-5: rm failed',
    ]);
    await expect(captureInBatches(newCapture(), ['a'], 0, 'dev', async () => null, async () => '', () => undefined)).rejects.toThrow(/not a positive integer/);
  });

  it('fills a column that fails part way with missing cells, always closes it, and records a failed close', async () => {
    let closed = 0;
    const cap = await captureColumn(['a', 'b', 'c'], 'iPhone 17', async (c) => {
      c.cells.set('a', { kind: 'image', src: 'img/ios/a.png' });
      throw new Error('boot failed');
    }, async () => {
      closed++;
      throw new Error('shutdown failed');
    });
    expect(closed).toBe(1);
    expect([...cap.cells.values()].map((c) => c.kind)).toEqual(['image', 'missing', 'missing']);
    expect(cap.cells.get('b')).toEqual({ kind: 'missing', reason: 'iPhone 17: boot failed' });
    expect(cap.problems).toEqual(['iPhone 17: 2 case(s) not taken (boot failed)', 'iPhone 17: cleanup: shutdown failed']);

    const quiet = await captureColumn(['a', 'b'], 'Chrome', async (c) => void c.cells.set('a', { kind: 'image', src: 'x' }), async () => undefined);
    expect(quiet.cells.get('b')).toEqual({ kind: 'missing', reason: 'Chrome: no screenshot taken' });
    expect(quiet.problems).toEqual(['Chrome: 1 case(s) not taken (no screenshot taken)']);

    const clean = await captureColumn(['a'], 'Chrome', async (c) => void c.cells.set('a', { kind: 'image', src: 'x' }), async () => undefined);
    expect(clean.problems).toEqual([]);
  });

  it('exits 0 only when every cell is an image and nothing went wrong', () => {
    const image = { kind: 'image', src: 'x' } as const;
    const row = (cells: GalleryPage['rows'][number]['cells']) => ({ id: 'r', features: [], cells });
    expect(galleryExitCode([row([image, image])], [])).toBe(0);
    expect(galleryExitCode([row([image, { kind: 'missing', reason: 'no' }])], [])).toBe(1);
    expect(galleryExitCode([row([image])], ['dev: cleanup: failed'])).toBe(1);
    expect(galleryExitCode([row([])], [])).toBe(1);
  });
});
