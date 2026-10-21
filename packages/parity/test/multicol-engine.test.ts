// The engine's multi-column layout (packages/layout/src/multicol.ts) against live Chrome 145: for each case a multi-column block of
// Ahem text, Chrome's block height and the box of every non-space character (a one-character Range) equal the engine's, from the
// block's content box, in ltr and rtl at DPR 1 and 2. The cases cover column-count, column-width, normal and px gaps, padding, line
// heights that are not whole px, a <br>, a word wider than its column, centred text, and contents that need the balancer to stretch
// for orphans and widows. The engine side builds its input by hand: the compiler does not lower multicol yet.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InlineChild, LayoutBox, LU, LayoutInput, LayoutRect, LayoutStyle, LineHeightValue, PlacedLine } from '@dragon/layout';
import { absoluteRects, inlineLeaves, layout, LU_PER_PX, measurerFor, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, REFERENCE_PLATFORM, zoomInput } from '@dragon/layout';
import { CHROME_VERSION, launchChrome, openPage } from '../src/chrome.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

const STYLE = {
  display: 'block', position: 'static', top: { kind: 'auto' }, right: { kind: 'auto' }, bottom: { kind: 'auto' }, left: { kind: 'auto' },
  overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box', width: { kind: 'auto' }, height: { kind: 'auto' },
  minWidth: { kind: 'auto' }, minHeight: { kind: 'auto' }, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 }, marginRight: { kind: 'px', value: 0 }, marginBottom: { kind: 'px', value: 0 }, marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 }, paddingRight: { kind: 'px', value: 0 }, paddingBottom: { kind: 'px', value: 0 }, paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 }, borderRightWidth: { kind: 'px', value: 0 }, borderBottomWidth: { kind: 'px', value: 0 }, borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: { kind: 'auto' }, order: 0, justifyContent: 'normal',
  alignItems: 'normal', alignSelf: 'auto', alignContent: 'normal', rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start', textOverflow: 'clip', textIndent: { kind: 'px', value: 0 }, lineClamp: 0, containLayout: false, containPaint: false, containSize: 'none', containIntrinsicWidth: { kind: 'none' }, containIntrinsicHeight: { kind: 'none' }, multicol: null,
  verticalAlign: { kind: 'keyword', value: 'baseline' }, aspectRatio: { kind: 'auto' }, grid: null, gridItem: null,
} as const satisfies LayoutStyle;

/** A case: the block's width, columns, gap, font, line height, padding (top right bottom left), text-align, and its text, '\n' a <br>. */
type Case = {
  readonly id: string;
  readonly width: number;
  readonly count: number;
  readonly columnWidth: number | null;
  readonly gap: number | null;
  readonly size: number;
  readonly lineHeight: LineHeightValue;
  readonly padding: readonly [number, number, number, number];
  readonly align: 'start' | 'center';
  readonly text: string;
};

/** Words of 1 to 5 Xs, from a fixed linear congruential sequence. */
function words(n: number, seed: number): string {
  let s = seed;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push('X'.repeat(1 + (Math.floor(s / 65536) % 5)));
  }
  return out.join(' ');
}

const base = { columnWidth: null, gap: null, size: 10, lineHeight: { kind: 'normal' }, padding: [0, 0, 0, 0], align: 'start' } as const;
const CASES: readonly Case[] = [
  { ...base, id: 'count3', width: 210, count: 3, text: 'XX XX XX XX XX XX XX' },
  { ...base, id: 'gap20', width: 300, count: 2, gap: 20, text: words(30, 1) },
  { ...base, id: 'gap0-lh15', width: 400, count: 4, gap: 0, size: 12, lineHeight: { kind: 'number', value: 1.5 }, text: words(40, 2) },
  { ...base, id: 'width80', width: 300, count: 0, columnWidth: 80, text: words(25, 3) },
  { ...base, id: 'width200-count2', width: 300, count: 2, columnWidth: 200, text: words(12, 4) },
  { ...base, id: 'padded', width: 250, count: 3, gap: 15, size: 16, lineHeight: { kind: 'px', value: 20 }, padding: [5, 7, 3, 9], text: words(20, 5) },
  { ...base, id: 'count5-long', width: 500, count: 5, text: words(90, 6) },
  { ...base, id: 'widows', width: 200, count: 2, text: 'XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX' },
  { ...base, id: 'one-line', width: 200, count: 3, text: 'XX' },
  { ...base, id: 'lh13', width: 320, count: 3, size: 13, lineHeight: { kind: 'number', value: 1.3 }, text: words(33, 7) },
  { ...base, id: 'wide-word', width: 100, count: 4, gap: 4, text: 'XXXXXXXXXXXX XX X XXX' },
  { ...base, id: 'br', width: 300, count: 3, text: 'XX XX\nXX XX XX\nX\nXXX XX X XX XXXX' },
  { ...base, id: 'stride', width: 333, count: 3, gap: 7, text: words(28, 8) },
  { ...base, id: 'center', width: 210, count: 2, align: 'center', text: words(15, 9) },
  { ...base, id: 'count1', width: 150, count: 1, text: words(10, 10) },
  { ...base, id: 'count7', width: 400, count: 7, gap: 3, text: words(16, 11) },
];

const DIRECTIONS = ['ltr', 'rtl'] as const;
const DPRS = [1, 2] as const;
const VIEWPORT = { width: 800, height: 600 };

function css(c: Case, direction: 'ltr' | 'rtl'): string {
  const lh = c.lineHeight.kind === 'normal' ? 'normal' : c.lineHeight.kind === 'number' ? String(c.lineHeight.value) : `${(c.lineHeight as { value: number }).value}px`;
  const cols = `column-count: ${c.count === 0 ? 'auto' : c.count}; column-width: ${c.columnWidth === null ? 'auto' : `${c.columnWidth}px`}; column-gap: ${c.gap === null ? 'normal' : `${c.gap}px`}`;
  return `width: ${c.width}px; ${cols}; font: ${c.size}px/${lh} Ahem; padding: ${c.padding.map((p) => `${p}px`).join(' ')}; text-align: ${c.align}; direction: ${direction}; margin-bottom: 20px`;
}

function page(direction: 'ltr' | 'rtl'): string {
  const blocks = CASES.map((c) => `<div id="${c.id}" style="${css(c, direction)}">${c.text.split('\n').join('<br>')}</div>`).join('');
  return `<!DOCTYPE html><html><head><style>body { margin: 0; }</style></head><body>${blocks}</body></html>`;
}

/** One character's box from the block's content box, in CSS px: left, top, width, height. */
type Glyph = readonly [number, number, number, number];
type Seen = { readonly height: number; readonly glyphs: readonly Glyph[] };

async function chrome(browser: Browser, dpr: number, direction: 'ltr' | 'rtl'): Promise<Record<string, Seen>> {
  const p = await openPage(browser, page(direction), { viewport: VIEWPORT, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ua-default' });
  try {
    if ((await p.evaluate('document.fonts.check("10px Ahem")')) !== true) throw new Error('Ahem is not loaded');
    // A string expression: this test project has no DOM types.
    return (await p.evaluate(`Object.fromEntries(${JSON.stringify(CASES.map((c) => [c.id, c.padding]))}.map(([id, pad]) => {
      const e = document.getElementById(id);
      const b = e.getBoundingClientRect();
      const left = b.left + pad[3];
      const top = b.top + pad[0];
      const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
      const glyphs = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        for (let i = 0; i < node.data.length; i++) {
          if (node.data[i] === ' ') continue;
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + 1);
          const q = r.getBoundingClientRect();
          glyphs.push([q.left - left, q.top - top, q.width, q.height]);
        }
      }
      return [id, { height: b.height, glyphs }];
    }))`)) as Record<string, Seen>;
  } finally {
    await p.context().close();
  }
}

const font = (size: number) => ({ family: 'Ahem', size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true }) as const;

function leaves(c: Case): InlineChild[] {
  const out: InlineChild[] = [];
  c.text.split('\n').forEach((t, i) => {
    if (i > 0) out.push({ kind: 'br', id: `${c.id}:br${i}`, font: font(c.size), lineHeight: c.lineHeight });
    out.push({ kind: 'text', id: `${c.id}:text${i}`, text: t, font: font(c.size), lineHeight: c.lineHeight, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', letterSpacing: { kind: 'px', value: 0 }, wordSpacing: { kind: 'px', value: 0 }, overflowWrap: 'normal', wordBreak: 'normal', smallCaps: false });
  });
  return out;
}

function engine(c: Case, dpr: number, direction: 'ltr' | 'rtl'): Seen {
  const [pt, pr, pb, pl] = c.padding;
  const px = (value: number) => ({ kind: 'px', value }) as const;
  const block: LayoutBox = {
    kind: 'box', id: c.id, boxType: 'element', marker: null, children: leaves(c), strut: { font: font(c.size), lineHeight: c.lineHeight },
    style: {
      ...STYLE, width: px(c.width), direction, textAlign: c.align, paddingTop: px(pt), paddingRight: px(pr), paddingBottom: px(pb), paddingLeft: px(pl),
      columnGap: c.gap === null ? { kind: 'normal' } : px(c.gap), multicol: { count: c.count, width: c.columnWidth === null ? { kind: 'auto' } : px(c.columnWidth) },
    },
  };
  const input: LayoutInput = {
    viewport: VIEWPORT, devicePixelRatio: dpr, viewportUnits: { small: VIEWPORT, large: VIEWPORT, dynamic: VIEWPORT }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16,
    root: { kind: 'box', id: 'root', boxType: 'element', style: STYLE, strut: null, marker: null, children: [block] },
  };
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(m.detail);
  const out = layout(input, m.measurer);
  if (out.kind !== 'ok') throw new Error(`${c.id}: ${JSON.stringify(out)}`);
  const zoomed = zoomInput(input, NO_ENGINE_FAULTS).root.children[0] as LayoutBox;
  const unit = LU_PER_PX * dpr;
  const rect = absoluteRects(out.boxes).get(c.id) as LayoutRect;
  const content = rect.width - (pl + pr) * unit;
  const ctx = { measurer: m.measurer, devicePixelRatio: 1, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
  const texts = inlineLeaves(zoomed).map((t) => t.text);
  const lines: PlacedLine[] = placeLines(ctx, zoomed, content as LU);
  const advance = c.size * unit;
  const glyphs: Glyph[] = [];
  // Document order: leaf by leaf, each piece's characters in order (Ahem: every character is one em wide).
  for (let li = 0; li < texts.length; li++) {
    for (const l of lines) {
      for (const p of l.pieces) {
        if (p.leaf !== li) continue;
        for (let k = p.start; k < p.visibleEnd; k++) {
          if ((texts[li] as string)[k] === ' ') continue;
          glyphs.push([(p.x + (k - p.start) * advance) / unit, p.top / unit, advance / unit, (p.ascent + p.descent) / unit]);
        }
      }
    }
  }
  return { height: rect.height / unit, glyphs };
}

let browsers: Map<number, Browser>;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browsers = new Map();
  for (const dpr of DPRS) {
    const b = await launchChrome(dpr);
    expect(b.version()).toBe(CHROME_VERSION);
    browsers.set(dpr, b);
  }
});

afterAll(async () => {
  for (const b of browsers.values()) await b.close();
});

describe('multi-column Ahem text: the engine equals live Chrome 145', () => {
  for (const dpr of DPRS) {
    for (const direction of DIRECTIONS) {
      it(`every case's height and every character's box, ${direction} at DPR ${dpr}`, async () => {
        const seen = await chrome(browsers.get(dpr) as Browser, dpr, direction);
        for (const c of CASES) expect(engine(c, dpr, direction), `${c.id} ${direction} ${dpr}`).toEqual(seen[c.id]);
      }, 120_000);
    }
  }

  it('the widows case needs the balancer to stretch: 25px columns would leave one widow, so they are 30px', () => {
    // Ten 40px words in 95px columns are five lines; three columns at 25px stretch by the 5px shortage.
    expect(engine(CASES.find((c) => c.id === 'widows') as Case, 1, 'ltr').height).toBe(30);
  });
});
