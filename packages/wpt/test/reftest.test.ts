import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, WptServer } from '../src/chrome.ts';
import { launchChrome, serveWpt } from '../src/chrome.ts';
import { lockedCommit, PACKAGE_DIR, pinnedWptDir } from '../src/paths.ts';
import type { Geometry, PagePaint, PaintElement, ReftestLayoutReport } from '../src/reftest.ts';
import { captureReftest, chromeGeometry, compareReftestLayout, dragonGeometry, judgeGeometry, judgeReftest, paintOrder, rasterize, reftestCandidate, reftestDragonSide, serializeReftestLayout } from '../src/reftest.ts';

const commit = lockedCommit();
const DATA = resolve(PACKAGE_DIR, 'test/data');
const PREFIX = 'css/dragon-test/';
/** Reads the synthetic pages at their served paths, and WPT files otherwise. */
const readWpt = (p: string): string | null => {
  try {
    return readFileSync(p.startsWith(PREFIX) ? join(DATA, p.slice(PREFIX.length)) : join(pinnedWptDir(), p), 'utf8');
  } catch {
    return null;
  }
};

const el = (p: number, tag: string, extra: Partial<PaintElement> = {}): PaintElement => ({
  p, tag, box: [0, 0, 0, 0], bg: null, bw: [0, 0, 0, 0], bc: null, display: 'block', position: 'static', float: false, clip: false, visible: true, ...extra,
});

describe('the box paint model', () => {
  it('paints block backgrounds, then floats, then atomic inlines, then positioned elements in tree order', () => {
    const els = [
      el(-1, 'html'),
      el(0, 'body'),
      el(1, 'div', { position: 'relative' }), // 2
      el(2, 'div'), // 3: inside the positioned one, painted with it
      el(1, 'div', { float: true }), // 4
      el(1, 'div'), // 5
      el(5, 'div', { display: 'inline-block' }), // 6
      el(3, 'div', { position: 'absolute' }), // 7: positioned inside positioned
    ];
    expect(paintOrder(els)).toEqual([0, 1, 5, 4, 6, 2, 3, 7]);
  });

  it('fills border boxes, borders and the canvas, snapped to pixels and clipped by overflow', () => {
    const page: PagePaint = { canvas: 0xffffff, canvasFrom: null, els: [
      el(-1, 'html', { box: [0, 0, 800, 600] }),
      el(0, 'div', { box: [10.4, 10.6, 20, 20], bg: 0x008000, bw: [2, 2, 2, 2], bc: 0x000000, clip: true }),
      el(1, 'div', { box: [20, 20, 100, 100], bg: 0xff0000 }),
    ] };
    const px = rasterize(page, chromeGeometry(page));
    const at = (x: number, y: number): number => px[y * 800 + x] as number;
    expect(at(9, 11)).toBe(0xffffff);
    expect(at(10, 11)).toBe(0x000000); // border, snapped from 10.4 / 10.6
    expect(at(13, 13)).toBe(0x008000);
    expect(at(25, 25)).toBe(0xff0000); // the child, inside the padding box
    expect(at(29, 29)).toBe(0x000000); // the parent's right border: the child paints later but is clipped to the padding box
    expect(at(40, 40)).toBe(0xffffff); // clipped
  });
});

describe('the static filter', () => {
  const page = (body: string, head = '<link rel="match" href="r.html">'): string => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
  const read = (files: Record<string, string>) => (p: string): string | null => files[p] ?? null;
  const reason = (src: string, files: Record<string, string> = { 'css/x/r.html': page('<div></div>', '') }): string => {
    const c = reftestCandidate('css/x/t.html', src, commit, read(files));
    return c.kind === 'excluded' ? c.missing : 'candidate';
  };

  it('keeps box-only pairs with one match reference and excludes the rest with a reason', () => {
    expect(reason(page('<div></div>'))).toBe('candidate');
    expect(reason(page('<p>Test passes if</p>'))).toBe('reftest-layout:text');
    expect(reason(page('<div></div>'), { 'css/x/r.html': page('<p>ref text</p>', '') })).toBe('reftest-layout:text');
    expect(reason(page('<img src="a.png">'))).toBe('reftest-layout:replaced');
    expect(reason(page('<script>1</script>'))).toBe('reftest-layout:script');
    expect(reason(page('<div></div>', '<link rel="mismatch" href="r.html">'))).toBe('reftest-layout:mismatch');
    expect(reason(page('<div></div>', '<link rel="match" href="r.html"><link rel="match" href="s.html">'))).toBe('reftest-layout:multiple-refs');
    expect(reason(page('<div></div>', '<link rel="match" href="r.html"><meta name="fuzzy" content="0-1;0-5">'))).toBe('reftest-layout:fuzzy');
    expect(reason(page('<div></div>', '<link rel="match" href="gone.html">'))).toBe('reftest-layout:ref-missing');
    expect(reason(page('<div></div>'), { 'css/x/r.html': page('', '<link rel="match" href="q.html">') })).toBe('reftest-layout:ref-chain');
  });
});

describe('reftest-layout in Chrome 145 (experimental, report-only)', () => {
  let browser: Browser;
  let server: WptServer;
  beforeAll(async () => {
    server = await serveWpt(pinnedWptDir(), { [`/${PREFIX}`]: DATA });
    browser = await launchChrome();
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });
  const side = (name: string) => {
    const path = `${PREFIX}reftest/${name}`;
    return { path, d: reftestDragonSide(path, readWpt(path) as string, commit, 'web', readWpt) };
  };

  it('an XHTML reftest with a helper sheet passes against Chrome\'s layout of the reference; PLANTED: a 1px shift fails', async () => {
    const { path, d } = side('boxes.xht');
    if (d.kind !== 'laid-out') throw new Error(d.kind === 'excluded' || d.kind === 'blocked' ? d.missing : '');
    expect(d.ref).toBe(`${PREFIX}reftest/boxes-ref.xht`);
    const c = await captureReftest(browser, server.origin, path, d.ref, commit);
    if ('refused' in c.result) throw new Error(c.result.refused);
    const verdict = judgeReftest(d.translation, d.laid, c.result, d.ref);
    expect(verdict).toMatchObject({ status: 'pass', differingPixels: 0 });
    expect(verdict.status === 'pass' ? verdict.geometry.match : -1).toBe(verdict.status === 'pass' ? verdict.geometry.total : 0);
    const dragon = dragonGeometry(d.translation, d.laid);
    const outer = c.result.test.els.findIndex((e) => e.bg === 0x008000);
    const shifted: Geometry = (i) => {
      const g = dragon(i);
      return g === null || i !== outer ? g : { ...g, box: { ...g.box, y: g.box.y + 1 } };
    };
    const planted = judgeGeometry(shifted, c.result, d.ref);
    expect(planted.status).toBe('fail');
    expect(planted.status === 'fail' ? planted.differingPixels : 0).toBe(200);
  });

  it('pages the model cannot draw, and reftests Chrome itself fails, are refused in the capture', async () => {
    const refused = async (name: string): Promise<unknown> => {
      const path = `${PREFIX}reftest/${name}`;
      const c = reftestCandidate(path, readWpt(path) as string, commit, readWpt);
      if (c.kind !== 'candidate') throw new Error(c.missing);
      return (await captureReftest(browser, server.origin, path, c.ref, commit)).result;
    };
    expect(await refused('outline.xht')).toEqual({ refused: 'reftest-layout:paint:outline' });
    expect(await refused('wrong.xht')).toEqual({ refused: 'reftest-layout:chrome-fails' });
  });
});

describe('the reftest-layout report', () => {
  it('serializes deterministically and compares report-only', () => {
    const r: ReftestLayoutReport = { wpt: 'w', target: 'web', profileRevision: 'r', kind: 'reftest-layout', excluded: { 'reftest-layout:text': 2 }, tests: {
      'b.xht': { status: 'not-runnable', missing: 'DRAGON_X' },
      'a.xht': { status: 'pass', ref: 'a-ref.xht', differingPixels: 0, geometry: { match: 3, total: 3 } },
    } };
    const text = serializeReftestLayout(r);
    expect(text.indexOf('"a.xht"')).toBeLessThan(text.indexOf('"b.xht"'));
    expect(serializeReftestLayout(JSON.parse(text) as ReftestLayoutReport)).toBe(text);
    expect(compareReftestLayout(r, r)).toEqual([]);
    expect(compareReftestLayout(r, { ...r, tests: { ...r.tests, 'a.xht': { status: 'fail', ref: 'a-ref.xht', differingPixels: 4, geometry: { match: 2, total: 3 } } } })).toEqual(['a.xht: pass (0 px, geometry 3/3) -> fail (4 px, geometry 2/3)']);
  });
});
