// T154 slice 2a (notes/T154-user-select-spec.md): the selection model (packages/layout/src/rt-select.ts) against Chrome 145. For
// each document Chrome clicks every point of a grid and reads the caret its selection collapses to, with that caret's rect, and
// drags from a few anchors to sampled points and reads Selection.toString; the model, built from the engine's layout of the same
// document compiled for native, must place every caret, rect and selected string where Chrome does.
import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { createProjectWith, nativePrograms, NO_FAULTS, programInput } from 'dragon';
import type { Caret, SelectTable } from '../../layout/src/rt-select.ts';
import { caretAtPx, caretRect, selectedText, selectionRefusal, selectionTableOf } from '../../layout/src/rt-select.ts';
import { launchChrome, openPage } from '../src/chrome.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';
import { ENVIRONMENT } from '../src/fixtures.ts';
import { referenceMeasurer } from '../src/native-host.ts';

const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; line-height: 20px; } div, p { width: 60px; margin: 0; }';

type Doc = { readonly id: string; readonly css: string; readonly body: string; readonly paragraphs: readonly string[] };

// Text holds no doubled spaces, so a DOM text offset is the leaf's offset after white-space phase I.
const DOCS: readonly Doc[] = [
  // Soft wraps with hanging spaces, a block nested after text (an anonymous wrapper), and a sibling.
  { id: 'nested', css: '', body: '<div data-dragon-id="a">AAAA AAAA AAAA<div data-dragon-id="b">BB BBBB</div></div><div data-dragon-id="d">DDDD</div>', paragraphs: [] },
  // Gaps: a margin between blocks, padding and a border above a block's line, padding below one, a leading and a trailing space.
  {
    id: 'gaps',
    css: '.a { margin-bottom: 30px; padding-bottom: 10px; } .b { padding-top: 25px; border-top: 5px solid; } .d { margin-top: 10px; }',
    body: '<div data-dragon-id="a" class="a">AAAA AAAA</div><div data-dragon-id="b" class="b">BBBB BB</div><div data-dragon-id="d" class="d"> DDDD DD </div>',
    paragraphs: [],
  },
  // Paragraphs add a second line break when left; a block with no text adds nothing.
  {
    id: 'paragraphs',
    css: '.e { height: 20px; }',
    body: '<p data-dragon-id="a">AAAA</p><div data-dragon-id="b">BBBB</div><div data-dragon-id="e" class="e"></div><p data-dragon-id="c">CC CC</p><div data-dragon-id="d">DDDD</div>',
    paragraphs: ['a', 'c'],
  },
  // Line metrics and offsets: a larger font with normal line height, centred and right-aligned lines, an indent, letter spacing.
  {
    id: 'metrics',
    css: '.a { font-size: 20px; line-height: normal; width: 100px; } .b { text-align: center; } .c { text-align: right; text-indent: 15px; } .d { letter-spacing: 3px; }',
    body: '<div data-dragon-id="a" class="a">AAA AA</div><div data-dragon-id="b" class="b">BB B</div><div data-dragon-id="c" class="c">CCCC CC</div><div data-dragon-id="d" class="d">DDD DD</div>',
    paragraphs: [],
  },
];

const htmlOf = (d: Doc): string => `<!DOCTYPE html><html data-dragon-id="html"><head><style>${BASE} ${d.css}</style></head><body data-dragon-id="body">${d.body}</body></html>`;

function tableOf(d: Doc): SelectTable {
  const project = createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } },
    { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport },
  );
  const compiled = project.compile(fixtureToInput(`select-${d.id}`, htmlOf(d)));
  const errors = compiled.diagnostics.filter((x) => x.severity === 'error');
  if (errors.length > 0) throw new Error(`${d.id} does not compile: ${errors.map((x) => x.message).join('; ')}`);
  const p = nativePrograms(compiled, []);
  if (p.kind !== 'ready') throw new Error(`${d.id}: no native programs: ${p.reason}`);
  const input = programInput(p.programs.uikit, ENVIRONMENT.viewport, 1);
  expect(selectionRefusal(input), d.id).toBeNull();
  return selectionTableOf(input, referenceMeasurer(), { body: 'body', paragraphs: d.paragraphs });
}

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

// No point sits on an Ahem glyph's midpoint: Chrome on a Linux host advances 10px Ahem a hair under 10px (FreeType's 16.16 x_scale),
// which moves every midpoint left of the reference platform's. A point on the midpoint picks the caret before the glyph; that was
// measured with whole-pixel advances (Chrome without --font-render-hinting=none), as darwin-arm64 has them.
const XS = [1, 4, 14, 16, 24, 26, 34, 44, 46, 49, 53, 61, 75, 99, 101, 140];

/** On a host whose Ahem advance is not exactly 10px (Linux), a caret's x may sit 1/64px left of the reference platform's. */
function sameCaret(got: Seen | null, want: Seen | null, inexact: boolean): boolean {
  if (got === null || want === null) return got === want;
  const dx = (want.rect[0] as number) - (got.rect[0] as number);
  return got.leaf === want.leaf && got.offset === want.offset && got.rect[1] === want.rect[1] && got.rect[2] === want.rect[2] && (dx === 0 || (inexact && dx === 1 / 64));
}

describe('selection model (T154 slice 2a): carets, caret rects and selected text against Chrome drags', () => {
  it('every document compiles for native and the model refuses none of it', () => {
    for (const d of DOCS) expect(tableOf(d).lines.length, d.id).toBeGreaterThan(0);
  });

  it('places every caret and selects every string where Chrome does', async () => {
    const browser = await launchChrome();
    const problems: string[] = [];
    let clicks = 0;
    let drags = 0;
    try {
      for (const d of DOCS) {
        const t = tableOf(d);
        const page = await openPage(browser, htmlOf(d), ENVIRONMENT);
        const inexact = (await page.evaluate(`(() => { const c = document.createElement('canvas').getContext('2d'); c.font = '10px Ahem'; return c.measureText('AAAAAAAAAA').width; })()`)) !== 100;
        const bottom = (t.blocks[0]?.bottom ?? 0) / 64;
        const ys: number[] = [];
        for (let y = 1; y < bottom + 15; y += 3) ys.push(y);
        // A click collapses the selection to the caret the point picks.
        for (const y of ys) {
          for (const x of XS) {
            const seen = await drag(page, x, y, x, y);
            clicks++;
            const want = modelCaret(t, caretAtPx(t, x, y));
            const got = seen === null || seen.focus === null ? null : leafOffset(t, seen.focus);
            if (!sameCaret(got, want, inexact)) problems.push(`${d.id} click ${x},${y}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
          }
        }
        // Drags from three anchors (the first line's start, a middle point, the end) to a sample of the grid, both directions.
        const anchors: [number, number][] = [[1, 1], [23, Math.floor(bottom / 2)], [140, bottom + 10]];
        for (const [ax, ay] of anchors) {
          for (let i = 0; i < ys.length; i += 2) {
            for (const x of [4, 16, 46, 140]) {
              const y = ys[i] as number;
              const seen = await drag(page, ax, ay, x, y);
              drags++;
              const a = caretAtPx(t, ax, ay);
              const f = caretAtPx(t, x, y);
              const want = a === null || f === null ? '' : selectedText(t, a, f);
              const got = seen === null ? '' : seen.text;
              if (got !== want) problems.push(`${d.id} drag ${ax},${ay} to ${x},${y}: Chrome selects ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
            }
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
