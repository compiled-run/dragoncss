// T154 slice 2a (notes/T154-user-select-spec.md): the selection model (packages/layout/src/rt-select.ts) against Chrome 145. For
// each document Chrome clicks every point of a grid and reads the caret its selection collapses to, with that caret's rect, and
// drags from a few anchors to sampled points and reads Selection.toString and the focus, and screenshots the highlight it paints; the
// model, built from the engine's layout of the same document compiled for native, must place every caret, rect, selected string and
// highlighted pixel where Chrome does.
import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import type { Caret, SelectTable } from '../../layout/src/rt-select.ts';
import { anchorAt, caretRect, focusAt, highlightRects, pxToLu, selectedText } from '../../layout/src/rt-select.ts';
import { decodePng } from '../src/pixel-reference.ts';
import { launchChrome, openPage } from '../src/chrome.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { SELECT_DOCS, selectCase, selectHtml, selectPoints } from '../src/select-cases.ts';

/** A caret as the test compares it: the leaf (its element and text-node index) and offset, and its rect in px. */
type Seen = { readonly leaf: string; readonly offset: number; readonly rect: readonly number[] };

function modelCaret(t: SelectTable, c: Caret | null): Seen | null {
  if (c === null) return null;
  // A caret in a block with no text compares as Chrome's is read: the next text node's start.
  let at = c;
  if (t.nodes[c.node]?.kind === 'element') {
    const next = t.nodes.findIndex((n, i) => i > c.node && n.kind === 'text');
    if (next < 0) return null;
    at = { node: next, offset: 0 };
  }
  const node = t.nodes[at.node];
  if (node === undefined) throw new Error(`no node ${at.node}`);
  const r = caretRect(t, at);
  return { leaf: node.id, offset: at.offset, rect: [r.x / 64, r.y / 64, r.height / 64] };
}

// In the page: a selection end as a text position (an element position is the next text node's start), named as the leaf the
// compiler names it, <element>:text<k> for the parent's k-th text child, with its collapsed range's rect.
const READ = `(() => {
  const canon = (n, o) => {
    if (n.nodeType !== 3) {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const r = document.createRange(); r.setStart(n, o);
      let t = w.nextNode();
      while (t !== null && r.comparePoint(t, 0) < 0) t = w.nextNode();
      if (t === null) return null;
      n = t; o = 0;
    }
    const p = n.parentNode;
    const k = [...p.childNodes].filter((c) => c.nodeType === 3).indexOf(n);
    const r = document.createRange(); r.setStart(n, o);
    const q = r.getBoundingClientRect();
    return { leaf: p.getAttribute('data-dragon-id') + ':text' + k, offset: o, rect: [q.x, q.y, q.height], data: n.data };
  };
  const s = getSelection();
  if (s.rangeCount === 0) return null;
  return { anchor: canon(s.anchorNode, s.anchorOffset), focus: canon(s.focusNode, s.focusOffset), text: s.toString() };
})()`;

type Read = { readonly anchor: Seen | null; readonly focus: (Seen & { readonly data: string }) | null; readonly text: string } | null;

/**
 * A DOM text offset as the leaf's offset: the leaf's text is the DOM text after white-space phase I, which drops the spaces a block
 * starts and ends with, so a DOM offset counts the leaf's code points before it.
 */
function leafOffset(t: SelectTable, seen: Seen & { readonly data: string }): Seen {
  const leaf = t.nodes.find((l) => l.kind === 'text' && l.id === seen.leaf);
  if (leaf === undefined) return { leaf: seen.leaf, offset: seen.offset, rect: seen.rect };
  let k = 0;
  let i = 0;
  for (const ch of seen.data) {
    if (i >= seen.offset) break;
    if (leaf.text[k] === ch) k++;
    else if (ch !== ' ') throw new Error(`${leaf.id}: the DOM text ${JSON.stringify(seen.data)} is not ${JSON.stringify(leaf.text)} with spaces dropped`);
    i++;
  }
  return { leaf: seen.leaf, offset: k, rect: seen.rect };
}

// The highlight is painted pure blue, glyphs and all, so a selected pixel is told from text and canvas by colour alone.
const HIGHLIGHT_STYLE = '::selection { background: rgb(0, 0, 255); color: rgb(0, 0, 255); }';

/** The pixels (CSS px at DPR 1) Chrome paints with the highlight colour, as "y:x0-x1" runs. */
function paintedRuns(png: Uint8Array): string[] {
  const img = decodePng(png);
  const out: string[] = [];
  for (let y = 0; y < img.height; y++) {
    let start = -1;
    for (let x = 0; x <= img.width; x++) {
      const i = (y * img.width + x) * 4;
      const blue = x < img.width && (img.data[i] as number) < 64 && (img.data[i + 1] as number) < 64 && (img.data[i + 2] as number) > 192;
      if (blue && start < 0) start = x;
      if (!blue && start >= 0) {
        out.push(`${y}:${start}-${x}`);
        start = -1;
      }
    }
  }
  return out;
}

/** The pixels whose centres the model's highlight rects cover, as the same runs. */
function modelRuns(t: SelectTable, a: Caret, f: Caret, width: number, height: number): string[] {
  const rects = highlightRects(t, a, f);
  const out: string[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const cx = (x + 0.5) * 64;
      const cy = (y + 0.5) * 64;
      const on = x < width && rects.some((r) => cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        out.push(`${y}:${start}-${x}`);
        start = -1;
      }
    }
  }
  return out;
}

async function drag(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<Read> {
  await page.mouse.click(395, 295);
  await page.evaluate('getSelection().removeAllRanges()');
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  if (x1 !== x0 || y1 !== y0) {
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2);
    await page.mouse.move(x1, y1);
  }
  await page.mouse.up();
  return (await page.evaluate(READ)) as Read;
}

/** On a host whose Ahem advance is not exactly 10px (Linux), a caret's x may sit 1/64px left of the reference platform's. */
function sameCaret(got: Seen | null, want: Seen | null, inexact: boolean): boolean {
  if (got === null || want === null) return got === want;
  const dx = (want.rect[0] as number) - (got.rect[0] as number);
  return got.leaf === want.leaf && got.offset === want.offset && got.rect[1] === want.rect[1] && got.rect[2] === want.rect[2] && (dx === 0 || (inexact && dx === 1 / 64));
}

describe('selection model (T154 slices 2a, 2b): carets, caret rects, selected text and highlight against Chrome drags', () => {
  it('every document compiles for native and the model refuses none of it', () => {
    for (const d of SELECT_DOCS) expect(selectCase(d).table.lines.length, d.id).toBeGreaterThan(0);
  });

  it('refuses text whose visibility is hidden, floats, and lines that overflow a fixed height, which Chrome hits differently', () => {
    const hidden = { id: 'hidden', css: '.h { visibility: hidden; }', body: '<div data-dragon-id="a">AAAA</div><div data-dragon-id="b" class="h">BBBB</div><div data-dragon-id="c">CCCC</div>', paragraphs: [] };
    expect(() => selectCase(hidden)).toThrow(/b has visibility hidden or collapse/);
    const overflow = { id: 'overflow', css: '.a { height: 20px; } .b { margin-top: 30px; }', body: '<div data-dragon-id="a" class="a">AAAA AAAA</div><div data-dragon-id="b" class="b">BBBB</div>', paragraphs: [] };
    expect(() => selectCase(overflow)).toThrow(/a's content overflows its border box/);
    const float = { id: 'float', css: '.f { float: left; width: 20px; }', body: '<div data-dragon-id="f" class="f">FF</div><div data-dragon-id="a">AAAA AAAA</div>', paragraphs: [] };
    expect(() => selectCase(float)).toThrow(/float/);
  });

  it('places every caret and selects every string where Chrome does', async () => {
    const browser = await launchChrome();
    const problems: string[] = [];
    let clicks = 0;
    let drags = 0;
    try {
      for (const d of SELECT_DOCS) {
        const t = selectCase(d).table;
        const page = await openPage(browser, selectHtml(d).replace('</style>', `${HIGHLIGHT_STYLE}</style>`), ENVIRONMENT);
        const clip = { x: 0, y: 0, width: 160, height: Math.ceil((t.blocks[0]?.bottom ?? 0) / 64) + 10 };
        const inexact = (await page.evaluate(`(() => { const c = document.createElement('canvas').getContext('2d'); c.font = '10px Ahem'; return c.measureText('AAAAAAAAAA').width; })()`)) !== 100;
        const points = selectPoints(t);
        // A click collapses the selection to the caret the point picks.
        for (const [x, y] of points.clicks) {
          const seen = await drag(page, x, y, x, y);
          clicks++;
          const want = modelCaret(t, anchorAt(t, pxToLu(x), pxToLu(y)));
          const got = seen === null || seen.focus === null ? null : leafOffset(t, seen.focus);
          if (!sameCaret(got, want, inexact)) problems.push(`${d.id} click ${x},${y}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
        }
        for (const [ax, ay, x, y] of points.drags) {
          const seen = await drag(page, ax, ay, x, y);
          drags++;
          const a = anchorAt(t, pxToLu(ax), pxToLu(ay));
          const f = focusAt(t, pxToLu(x), pxToLu(y));
          const want = a === null || f === null ? '' : selectedText(t, a, f);
          const got = seen === null ? '' : seen.text;
          if (got !== want) problems.push(`${d.id} drag ${ax},${ay} to ${x},${y}: Chrome selects ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
          const focus = seen === null || seen.focus === null ? null : leafOffset(t, seen.focus);
          const wantFocus = a === null ? null : modelCaret(t, f);
          if (!sameCaret(focus, wantFocus, inexact)) problems.push(`${d.id} drag ${ax},${ay} to ${x},${y}: Chrome's focus ${JSON.stringify(focus)}, model ${JSON.stringify(wantFocus)}`);
          // The highlight Chrome paints, pixel for pixel, against the model's rects.
          const painted = paintedRuns(await page.screenshot({ clip }));
          const modelled = a === null || f === null ? [] : modelRuns(t, a, f, clip.width, clip.height);
          if (painted.join(' ') !== modelled.join(' ')) {
            const only = (xs: string[], ys: string[]) => xs.filter((r) => !ys.includes(r)).slice(0, 6).join(' ');
            problems.push(`${d.id} drag ${ax},${ay} to ${x},${y}: Chrome paints ${only(painted, modelled)} the model does not; the model ${only(modelled, painted)}`);
          }
        }
        await page.context().close();
      }
    } finally {
      await browser.close();
    }
    expect(problems.length === 0 ? [] : [`${problems.length} mismatches`, ...problems.slice(0, 40)]).toEqual([]);
    expect(clicks).toBeGreaterThan(500);
    expect(drags).toBeGreaterThan(200);
  }, 900_000);
});
