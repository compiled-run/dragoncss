// WM-P: the writing-mode probe corpus. Measures Chrome 145.0.7632.6 over Ahem-only cases in every writing mode Chrome accepts
// (horizontal-tb, vertical-rl, vertical-lr, sideways-rl, sideways-lr), ltr and rtl, at DPR 1, 2, 3 and 2.625, and writes
// docs/research/writing-mode-spike/probe/<family>.json. Per case it records the container and every labelled element's border
// boxes, computed and specified writing-mode styles, each text node's Range client rects, and on request per-character rects with
// the static position of an out-of-flow marker before each character (the line's block-start edge), and screenshot glyph grids.
// Run with: node --conditions=dragon-internal scripts/capture-writing-mode-probe.ts [--check]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<typeof openPage>>;

const ALL_MODES = ['horizontal-tb', 'vertical-rl', 'vertical-lr', 'sideways-rl', 'sideways-lr'] as const;
type Mode = (typeof ALL_MODES)[number];
const DPRS = [1, 2, 3, 2.625] as const;
const DIRS = ['ltr', 'rtl'] as const;
const OUT_DIR = 'docs/research/writing-mode-spike/probe';
const VIEWPORT = { width: 400, height: 300 } as const;

type Case = {
  readonly id: string;
  readonly note: string;
  /** Declarations appended to the container's style, after `writing-mode:<mode>`. */
  readonly style?: string;
  /** Inner HTML; `{wm}` is replaced by the environment's writing mode. */
  readonly html: string;
  /** Keep the container horizontal-tb; the environment's mode reaches the content only through `{wm}`. */
  readonly childWm?: boolean;
  /** Restrict the environment modes (default: every mode Chrome accepts). */
  readonly modes?: readonly Mode[];
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Record per-character rects and line block-start markers. */
  readonly chars?: boolean;
  /** Screenshot grids: n x n cell-center samples over the first character's Range rect of the labelled element's text. */
  readonly glyphs?: readonly { readonly label: string; readonly n: number }[];
};
type Family = { readonly id: string; readonly title: string; readonly cases: readonly Case[] };

const COMPUTED = [
  'display', 'position', 'writing-mode', 'direction', 'text-orientation', 'text-combine-upright', 'font-size', 'line-height',
  'vertical-align', 'width', 'height', 'inline-size', 'block-size',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
] as const;
const SPECIFIED = ['writing-mode', '-webkit-writing-mode', 'text-orientation', '-webkit-text-orientation', 'text-combine-upright', '-webkit-text-combine'] as const;

const bg = (c: string): string => `background:${c}`;
const box = (label: string, style: string, inner = ''): string => `<div data-p="${label}" style="${style}">${inner}</div>`;
const WORDS = (n: number): string => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26)).repeat(2)).join(' ');

// Family 1: block flow per mode.
const family1: Case[] = [
  { id: 'b1-fixed-children', note: 'three blocks with fixed width and height', style: 'width:200px;height:150px', html: box('a', `width:30px;height:40px;${bg('#f00')}`) + box('b', `width:20px;height:60px;${bg('#0f0')}`) + box('c', `width:10px;height:10px;${bg('#00f')}`) },
  { id: 'b1-auto-inline', note: 'blocks with auto inline size stretch to the container inline size', style: 'width:200px;height:150px', html: box('a', 'width:30px;height:30px') + box('b', 'writing-mode:inherit') + box('c', 'inline-size:auto;block-size:25px') },
  { id: 'b1-logical-sizes', note: 'inline-size and block-size map to the physical axes of the mode', style: 'width:200px;height:150px', html: box('a', 'inline-size:70px;block-size:20px') + box('b', 'inline-size:50%;block-size:10%') },
  { id: 'b1-margin-collapse', note: 'block-axis margins collapse between siblings; inline-axis margins do not', style: 'width:200px;height:150px', html: box('a', 'block-size:20px;margin-block:10px 15px;margin-inline:5px 7px') + box('b', 'block-size:20px;margin-block:25px 4px;margin-inline:3px 9px') + box('c', 'block-size:20px;margin-block:-6px 0') },
  { id: 'b1-physical-margins', note: 'physical margins on all four sides of a child', style: 'width:200px;height:150px', html: box('a', 'block-size:20px;margin:1px 2px 3px 4px') + box('b', 'block-size:20px;margin:5px 6px 7px 8px') },
  { id: 'b1-margin-auto', note: 'auto inline-axis margins centre a fixed inline size; auto block-axis margins are zero', style: 'width:200px;height:150px', html: box('a', 'inline-size:50px;block-size:20px;margin-inline:auto') + box('b', 'inline-size:50px;block-size:20px;margin-inline-start:auto') + box('c', 'inline-size:50px;block-size:20px;margin-block:auto') },
  { id: 'b1-padding-border', note: 'asymmetric container padding and border', style: 'width:200px;height:150px;padding:1px 2px 3px 4px;border-style:solid;border-width:5px 6px 7px 8px', html: box('a', 'block-size:20px') + box('b', 'block-size:10px;inline-size:40px') },
  { id: 'b1-percent', note: 'percent width, height, margin and padding against the container', style: 'width:200px;height:150px', html: box('a', 'width:25%;height:20%') + box('b', 'block-size:10px;margin-inline-start:10%;padding-block-start:5%') },
  { id: 'b1-auto-block-size', note: 'container auto block size: sum of child block sizes', style: 'inline-size:120px', html: box('a', 'block-size:20px;margin-block-end:5px') + box('b', 'block-size:13.5px') + box('c', 'block-size:7.25px;padding-block:1.5px') },
  { id: 'b1-min-max', note: 'min and max on both axes', style: 'width:200px;height:150px', html: box('a', 'inline-size:300px;max-inline-size:90px;block-size:5px;min-block-size:12px') + box('b', 'inline-size:10px;min-inline-size:40px;block-size:50px;max-block-size:18px') },
  { id: 'b1-text-paragraphs', note: 'two text paragraphs wrap at the container inline size', style: 'width:200px;height:80px', html: box('p1', '', WORDS(9)) + box('p2', 'margin-block-start:6px', WORDS(4)) },
  { id: 'b1-nested-mode', note: 'a vertical-lr child inside the container: parallel flow, own block direction', style: 'width:200px;height:150px', html: box('a', 'block-size:20px') + box('n', 'writing-mode:vertical-lr;block-size:40px', box('n1', 'block-size:10px') + box('n2', 'block-size:15px')) + box('b', 'block-size:20px') },
  { id: 'b1-nested-rl', note: 'a vertical-rl child inside the container', style: 'width:200px;height:150px', html: box('a', 'block-size:20px') + box('n', 'writing-mode:vertical-rl;block-size:40px', box('n1', 'block-size:10px') + box('n2', 'block-size:15px')) },
  { id: 'b1-overflow-bfc', note: 'overflow hidden child with fractional block size', style: 'width:200px;height:150px', html: box('a', 'block-size:10.3px;overflow:hidden', 'x') + box('b', 'block-size:10.3px') + box('c', 'block-size:10.3px') },
  { id: 'b1-empty-collapse-through', note: 'an empty child collapses its block-axis margins through', style: 'width:200px;height:150px', html: box('a', 'block-size:10px;margin-block-end:8px') + box('e', 'margin-block:12px 3px') + box('b', 'block-size:10px;margin-block-start:5px') },
  { id: 'b1-fractional', note: 'fractional sizes and margins', style: 'width:200.5px;height:150.25px', html: box('a', 'block-size:10.3px;margin-block:0.7px 1.3px;inline-size:33.3px') + box('b', 'block-size:7.7px;margin-inline-start:2.6px') + box('c', 'block-size:12.1px') },
  { id: 'b1-inline-block-children', note: 'inline-block children flow in lines along the inline axis', style: 'width:100px;height:60px;line-height:20px', html: ['a', 'b', 'c', 'd'].map((l, i) => `<span data-p="${l}" style="display:inline-block;inline-size:${20 + i * 5}px;block-size:${8 + i * 2}px;${bg('#0a0')}"></span>`).join('') },
];

// Family 2: orthogonal flows and the fallback inline size.
const LONG = WORDS(60);
const family2: Case[] = [
  { id: 'o2-parent-auto', note: 'orthogonal child in an auto-height parent: fallback is the ICB (viewport 400x300)', childWm: true, style: 'width:200px', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-parent-fixed', note: 'parent height 100px: fallback min(ICB, 100)', childWm: true, style: 'width:200px;height:100px', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-parent-max', note: 'parent max-height 70px: fallback min(ICB, 70)', childWm: true, style: 'width:200px;max-height:70px', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-parent-min', note: 'parent min-height 350px above the ICB height', childWm: true, style: 'width:200px;min-height:350px', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-parent-min-max', note: 'parent height 50, min-height 120', childWm: true, style: 'width:200px;height:50px;min-height:120px', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-border-box', note: 'border-box parent 100px with padding 7/9 and border 3/5: content-box fallback', childWm: true, style: 'width:200px;height:100px;box-sizing:border-box;padding:7px 0 9px;border-style:solid;border-width:3px 0 5px', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-border-box-pct-padding', note: 'border-box parent with percent padding: fallback falls back to the ICB', childWm: true, style: 'width:200px;height:100px;box-sizing:border-box;padding:5% 0', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-parent-pct-height', note: 'parent height 50% of an auto-height body behaves as auto: fallback the ICB', childWm: true, style: 'width:200px;height:50%', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-small-viewport', note: 'auto parent in a 250x180 viewport', childWm: true, viewport: { width: 250, height: 180 }, style: 'width:200px', html: box('o', 'writing-mode:{wm}', LONG) },
  { id: 'o2-child-fixed', note: 'orthogonal child with fixed height: no fallback', childWm: true, style: 'width:200px', html: box('o', 'writing-mode:{wm};height:55px', LONG) },
  { id: 'o2-child-short', note: 'orthogonal child whose content is shorter than the fallback', childWm: true, style: 'width:200px', html: box('o', 'writing-mode:{wm}', 'aa bb') + box('after', 'height:10px') },
  { id: 'o2-child-margins', note: 'orthogonal child with margins, padding and border', childWm: true, style: 'width:200px;height:120px', html: box('o', 'writing-mode:{wm};margin:3px 4px 5px 6px;padding:1px 2px;border:2px solid', WORDS(12)) + box('after', 'height:10px') },
  { id: 'o2-shrink-to-fit', note: 'orthogonal child in an inline-block: min/max contribution is its block size after layout', childWm: true, style: 'width:300px', html: `<span data-p="ib" style="display:inline-block;${bg('#eee')}">${box('o', 'writing-mode:{wm}', WORDS(20))}</span>` },
  { id: 'o2-shrink-fixed-height', note: 'orthogonal child with fixed height in an inline-block', childWm: true, style: 'width:300px', html: `<span data-p="ib" style="display:inline-block">${box('o', 'writing-mode:{wm};height:60px', WORDS(10))}</span>` },
  { id: 'o2-inline-orthogonal', note: 'an orthogonal inline becomes inline-block (StyleAdjuster)', childWm: true, style: 'width:200px;line-height:20px', html: `aa <span data-p="s" style="writing-mode:{wm}">bb cc</span> dd` },
  { id: 'o2-flex-item', note: 'orthogonal flex item in a row flex container of height 80', childWm: true, style: 'width:200px;height:80px;display:flex', html: box('o', 'writing-mode:{wm}', WORDS(12)) + box('b', 'width:20px') },
  { id: 'o2-flex-column-item', note: 'orthogonal flex item in a column flex container', childWm: true, style: 'width:200px;height:80px;display:flex;flex-direction:column', html: box('o', 'writing-mode:{wm}', WORDS(12)) + box('b', 'height:10px') },
  { id: 'o2-reverse-auto', note: 'horizontal child in the mode container with auto width: fallback is the ICB width', style: 'height:150px', html: box('h', 'writing-mode:horizontal-tb', LONG) },
  { id: 'o2-reverse-fixed', note: 'horizontal child in a 120px-wide mode container', style: 'width:120px;height:150px', html: box('h', 'writing-mode:horizontal-tb', LONG) },
  { id: 'o2-reverse-max', note: 'horizontal child in a mode container with max-width 90px', style: 'height:150px;max-width:90px', html: box('h', 'writing-mode:horizontal-tb', LONG) },
  { id: 'o2-container-auto-height', note: 'mode container with auto height inside the horizontal body: its own inline size is the fallback', style: '', html: LONG },
  { id: 'o2-container-auto-height-small', note: 'mode container with auto height in a 250x180 viewport', viewport: { width: 250, height: 180 }, style: '', html: LONG },
];

// Family 3: flex.
const FI = (l: string, w: number, h: number, extra = ''): string => box(l, `width:${w}px;height:${h}px;${extra}`);
const flexItems = FI('a', 20, 30) + FI('b', 30, 15) + FI('c', 10, 25);
const family3: Case[] = [
  ...(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'start', 'end', 'left', 'right'] as const).map((j): Case => ({
    id: `f3-justify-${j}`, note: `row, justify-content:${j}`, style: `width:200px;height:150px;display:flex;justify-content:${j}`, html: flexItems,
  })),
  ...(['flex-start', 'center', 'flex-end', 'stretch', 'baseline', 'start', 'end', 'self-start', 'self-end'] as const).map((a): Case => ({
    id: `f3-align-${a}`, note: `row, align-items:${a}, items with auto cross size and text`, style: `width:200px;height:150px;display:flex;align-items:${a}`,
    html: box('a', 'inline-size:20px', 'x') + box('b', 'inline-size:30px;font-size:20px', 'y') + box('c', 'inline-size:10px;padding-block-start:6px', 'z'),
  })),
  { id: 'f3-column', note: 'flex-direction column', style: 'width:200px;height:150px;display:flex;flex-direction:column', html: flexItems },
  { id: 'f3-row-reverse', note: 'flex-direction row-reverse', style: 'width:200px;height:150px;display:flex;flex-direction:row-reverse', html: flexItems },
  { id: 'f3-column-reverse', note: 'flex-direction column-reverse', style: 'width:200px;height:150px;display:flex;flex-direction:column-reverse', html: flexItems },
  { id: 'f3-wrap', note: 'wrap with gap', style: 'width:60px;height:60px;display:flex;flex-wrap:wrap;gap:3px 5px', html: ['a', 'b', 'c', 'd', 'e'].map((l) => box(l, 'inline-size:25px;block-size:12px')).join('') },
  { id: 'f3-wrap-reverse', note: 'wrap-reverse', style: 'width:60px;height:60px;display:flex;flex-wrap:wrap-reverse', html: ['a', 'b', 'c', 'd'].map((l) => box(l, 'inline-size:25px;block-size:12px')).join('') },
  { id: 'f3-grow-shrink', note: 'flex-grow and flex-shrink with fractional leftovers', style: 'width:200px;height:103px;display:flex', html: box('a', 'flex:1 1 0;block-size:10px') + box('b', 'flex:2 1 0;block-size:10px') + box('c', 'flex:0 3 50px;block-size:10px') },
  { id: 'f3-shrink', note: 'shrinking overflowing items', style: 'width:200px;height:100px;display:flex', html: box('a', 'flex:0 1 60px;block-size:10px') + box('b', 'flex:0 2 70px;block-size:10px') + box('c', 'flex:0 1 30px;block-size:10px') },
  { id: 'f3-text-items', note: 'items sized by Ahem text', style: 'width:200px;height:150px;display:flex', html: box('a', '', 'aa bb') + box('b', '', 'ccc') + box('c', 'flex:1', 'd') },
  { id: 'f3-orthogonal-item', note: 'a horizontal-tb item in the mode flex container', style: 'width:200px;height:150px;display:flex', html: box('a', 'writing-mode:horizontal-tb', 'aa bb cc') + FI('b', 20, 20) },
  { id: 'f3-margin-auto', note: 'auto margins on a flex item', style: 'width:200px;height:150px;display:flex', html: FI('a', 20, 20, 'margin-inline-start:auto') + FI('b', 20, 20, 'margin-block:auto') },
  { id: 'f3-align-self', note: 'align-self per item', style: 'width:200px;height:150px;display:flex;align-items:flex-start', html: FI('a', 20, 20, 'align-self:center') + FI('b', 20, 20, 'align-self:flex-end') + box('c', 'align-self:stretch;inline-size:10px') },
  { id: 'f3-inline-flex', note: 'inline-flex in text: its baseline', style: 'width:200px;height:150px;line-height:20px', html: `aa<span data-p="if" style="display:inline-flex">${box('i1', 'padding-block-start:4px', 'b')}${box('i2', 'font-size:20px', 'c')}</span>dd` },
];

// Family 4: abspos static positions.
const family4: Case[] = [
  { id: 'a4-block-static', note: 'block-level abspos after a block: static position at the next block-start', style: 'width:200px;height:150px;position:relative', html: box('a', 'block-size:20px') + box('p', 'position:absolute;inline-size:15px;block-size:10px') + box('b', 'block-size:30px') },
  { id: 'a4-one-inset', note: 'abspos with top:5px only; other axis static', style: 'width:200px;height:150px;position:relative', html: box('a', 'block-size:20px') + box('p', 'position:absolute;top:5px;width:15px;height:10px') },
  { id: 'a4-left-only', note: 'abspos with left:7px only', style: 'width:200px;height:150px;position:relative', html: box('a', 'block-size:20px') + box('p', 'position:absolute;left:7px;width:15px;height:10px') },
  { id: 'a4-right-bottom', note: 'abspos with right and bottom', style: 'width:200px;height:150px;position:relative', html: box('p', 'position:absolute;right:3px;bottom:4px;width:15px;height:10px') },
  { id: 'a4-logical-insets', note: 'inset-inline-start and inset-block-start', style: 'width:200px;height:150px;position:relative', html: box('p', 'position:absolute;inset-inline-start:6px;inset-block-start:9px;inline-size:15px;block-size:10px') },
  { id: 'a4-inline-static', note: 'inline-level abspos inside text: static position at the inline position on the line', style: 'width:200px;height:150px;position:relative;line-height:20px', html: `aa bb<span data-p="p" style="position:absolute;display:inline;width:5px;height:5px;${bg('#f00')}"></span>cc` },
  { id: 'a4-inline-static-wrap', note: 'inline-level abspos at a line wrap', style: 'width:60px;height:60px;position:relative;line-height:20px', html: `aa bb<span data-p="p" style="position:absolute;width:5px;height:5px"></span> cc dd` },
  { id: 'a4-shrink-to-fit', note: 'abspos with auto size shrinks to its text', style: 'width:200px;height:150px;position:relative', html: box('p', 'position:absolute;inset-block-start:0', 'aa bb cc') },
  { id: 'a4-stretch', note: 'abspos with all insets and auto size stretches', style: 'width:200px;height:150px;position:relative', html: box('p', 'position:absolute;inset:4px 5px 6px 7px') },
  { id: 'a4-margin-auto-centre', note: 'abspos with insets 0 and auto margins centres', style: 'width:200px;height:150px;position:relative', html: box('p', 'position:absolute;inset:0;margin:auto;width:30px;height:20px') },
  { id: 'a4-orthogonal', note: 'horizontal-tb abspos with auto insets in the mode container', style: 'width:200px;height:150px;position:relative', html: box('a', 'block-size:20px') + box('p', 'position:absolute;writing-mode:horizontal-tb', 'aa bb') },
  { id: 'a4-padding-container', note: 'static position inside a padded, bordered container', style: 'width:200px;height:150px;position:relative;padding:3px 4px 5px 6px;border:2px solid', html: box('a', 'block-size:10px') + box('p', 'position:absolute;width:10px;height:10px') },
  { id: 'a4-flex-static', note: 'abspos child of a centred flex container: static position is aligned', style: 'width:200px;height:150px;position:relative;display:flex;justify-content:center;align-items:center', html: box('p', 'position:absolute;width:20px;height:10px') + FI('a', 30, 30) },
  { id: 'a4-margins', note: 'abspos with margins and one inset', style: 'width:200px;height:150px;position:relative', html: box('p', 'position:absolute;inset-inline-end:0;margin:1px 2px 3px 4px;width:12px;height:14px') },
];

// Family 5: inline line boxes, Ahem rotated sideways.
const IB = 'display:inline-block';
const family5: Case[] = [
  { id: 'l5-wrap', note: 'Latin wraps at inline size 50', style: 'width:150px;height:50px', chars: true, html: 'aa bb cc dd ee' },
  { id: 'l5-line-height', note: 'line-height 1.5 over three lines', style: 'width:150px;height:50px;line-height:1.5', chars: true, html: 'aa bb cc dd ee' },
  { id: 'l5-line-height-px', note: 'line-height 17px', style: 'width:150px;height:50px;line-height:17px', chars: true, html: 'aa bb cc' },
  { id: 'l5-mixed-sizes', note: 'a 20px span in 10px text, lh normal', style: 'width:150px;height:120px', chars: true, html: 'Xx <span data-p="s" style="font-size:20px">Yy</span> zz' },
  { id: 'l5-fractional-size', note: 'font-size 13px and 17.5px spans', style: 'width:150px;height:120px', chars: true, html: 'ab <span data-p="s" style="font-size:13px">cd</span> <span data-p="t" style="font-size:17.5px">ef</span>' },
  ...(['start', 'center', 'end', 'justify', 'left', 'right'] as const).map((a): Case => ({ id: `l5-align-${a}`, note: `text-align:${a}`, style: `width:150px;height:50px;text-align:${a}`, chars: true, html: 'aa bb cc' })),
  { id: 'l5-indent', note: 'text-indent 7px', style: 'width:150px;height:50px;text-indent:7px', chars: true, html: 'aa bb cc' },
  { id: 'l5-br', note: '<br> between lines', style: 'width:150px;height:80px;line-height:15px', chars: true, html: 'ab<br data-p="br">cd<br data-p="br2"><br data-p="br3">ef' },
  { id: 'l5-decorated-span', note: 'span with margin, border, padding: inline-axis edges take space, block-axis ones do not', style: 'width:150px;height:80px;line-height:20px', chars: true, html: `a <span data-p="s" style="margin:0 3px;border:2px solid;padding:4px 5px">bb cc</span> d` },
  ...(['baseline', 'middle', 'top', 'bottom', 'text-top', 'text-bottom', 'sub', 'super', '5px'] as const).map((v): Case => ({
    id: `l5-va-${v}`, note: `vertical-align:${v} on a 15x25 inline-block in 20px text, lh 30px`, style: 'width:150px;height:120px;font-size:20px;line-height:30px', chars: true,
    html: `Xx<span data-p="ib" style="${IB};width:15px;height:25px;vertical-align:${v}"></span>zz`,
  })),
  { id: 'l5-baseline-marker', note: '0x0 inline-block markers give the dominant baseline position', style: 'width:150px;height:120px;font-size:20px;line-height:1', chars: true, html: `ab<i data-p="m1" style="${IB};width:0;height:0"></i><span style="font-size:10px">cd<i data-p="m2" style="${IB};width:0;height:0"></i></span>` },
  { id: 'l5-baseline-marker-sideways', note: 'the same markers with text-orientation:sideways (alphabetic baseline)', style: 'width:150px;height:120px;font-size:20px;line-height:1;text-orientation:sideways', chars: true, html: `ab<i data-p="m1" style="${IB};width:0;height:0"></i><span style="font-size:10px">cd<i data-p="m2" style="${IB};width:0;height:0"></i></span>` },
  { id: 'l5-ib-text', note: 'inline-block with two lines of text: its baseline', style: 'width:150px;height:120px;font-size:20px;line-height:1', chars: true, html: `a<span data-p="ib" style="${IB};font-size:10px;line-height:15px">b<br>c</span>d` },
  { id: 'l5-rtl-bidi', note: 'direction from the environment with an embedded bdo', style: 'width:150px;height:60px', chars: true, html: 'ab <bdo data-p="b" dir="rtl">cde</bdo> fg' },
];

// Family 6: text-orientation and text-combine-upright.
const TO = ['mixed', 'upright', 'sideways'] as const;
const SIZES = ['10px', '13px', '17.5px', '23.3px'] as const;
const family6: Case[] = [
  ...TO.flatMap((o): Case[] => [
    { id: `t6-${o}-latin`, note: `text-orientation:${o}, Latin`, style: `width:150px;height:120px;text-orientation:${o}`, chars: true, html: 'Abp É' },
    { id: `t6-${o}-cjk`, note: `text-orientation:${o}, CJK (Ahem covers 水火金一)`, style: `width:150px;height:120px;text-orientation:${o}`, chars: true, html: '水火 金一' },
    { id: `t6-${o}-mixed-run`, note: `text-orientation:${o}, Latin and CJK and upright-in-mixed symbols (§ © × ÷)`, style: `width:150px;height:120px;text-orientation:${o}`, chars: true, html: 'ab水c§d©×÷e' },
  ]),
  ...SIZES.map((s): Case => ({ id: `t6-upright-size-${s.replace('.', '_')}`, note: `upright Latin at ${s}: vertical advance round(ascent)+round(descent)`, style: `width:150px;height:200px;text-orientation:upright;font-size:${s}`, chars: true, html: 'abcd' })),
  ...SIZES.map((s): Case => ({ id: `t6-mixed-cjk-size-${s.replace('.', '_')}`, note: `mixed CJK at ${s}`, style: `width:150px;height:200px;font-size:${s}`, chars: true, html: '水火金一' })),
  { id: 't6-upright-lh', note: 'upright with line-height 1.5', style: 'width:150px;height:60px;text-orientation:upright;line-height:1.5', chars: true, html: 'ab cd ef gh' },
  { id: 't6-span-orientation', note: 'a sideways span in mixed text and an upright span', style: 'width:150px;height:120px', chars: true, html: 'ab<span data-p="s" style="text-orientation:sideways">cd</span>水<span data-p="u" style="text-orientation:upright">ef</span>' },
  ...(['12', '1', '123', '2024', 'ab'] as const).map((t): Case => ({
    id: `t6-combine-${t}`, note: `text-combine-upright:all on "${t}"`, style: 'width:150px;height:120px;line-height:20px', chars: true,
    html: `水<span data-p="c" style="text-combine-upright:all">${t}</span>火`,
  })),
  { id: 't6-combine-20px', note: 'combine "12" at 20px', style: 'width:150px;height:120px;font-size:20px', chars: true, html: `水<span data-p="c" style="text-combine-upright:all">12</span>火` },
  { id: 't6-combine-underline', note: 'combine "12" under an underline: desired width 1em, not 1.1em', style: 'width:150px;height:120px;text-decoration:underline', chars: true, html: `水<span data-p="c" style="text-combine-upright:all">12</span>火` },
  { id: 't6-combine-lh', note: 'combine "123" with line-height 30px', style: 'width:150px;height:120px;line-height:30px', chars: true, html: `水<span data-p="c" style="text-combine-upright:all">123</span>火` },
  { id: 't6-combine-digits', note: 'text-combine-upright:digits 2 (records whether Chrome parses it)', style: 'width:150px;height:120px', chars: true, html: `水<span data-p="c" style="text-combine-upright:digits 2">12</span>火` },
  { id: 't6-combine-wrap', note: 'combine inside wrapping text', style: 'width:150px;height:40px', chars: true, html: `ab <span data-p="c" style="text-combine-upright:all">12</span> cd ef` },
  { id: 't6-sideways-mode-orientation', note: 'text-orientation:upright has no effect in sideways modes (horizontal typographic mode)', style: 'width:150px;height:120px;text-orientation:upright', chars: true, html: 'ab水' },
];

// Family 7: screenshot glyph grids (40px Ahem: p fills the descent, É the ascent, 水 the whole em box).
const G = (label: string, n = 8): { label: string; n: number } => ({ label, n });
const family7: Case[] = [
  ...TO.map((o): Case => ({
    id: `g7-${o}`, note: `text-orientation:${o}: p, É and 水 at 40px`, style: `width:200px;height:200px;font-size:40px;line-height:60px;text-orientation:${o};color:#000;background:#fff`, chars: true,
    html: '<span data-p="p">p</span><span data-p="e">É</span><span data-p="w">水</span>', glyphs: [G('p'), G('e'), G('w')],
  })),
  {
    id: 'g7-combine', note: 'combine "12" at 40px: two digits squeezed into 1.1em', style: 'width:200px;height:200px;font-size:40px;line-height:60px;color:#000;background:#fff', chars: true,
    html: '<span data-p="c" style="text-combine-upright:all">12</span><span data-p="p">p</span>', glyphs: [G('c', 11), G('p')],
  },
  {
    id: 'g7-mixed-run', note: 'mixed run p水É at 40px: rotated, upright, rotated', style: 'width:200px;height:200px;font-size:40px;line-height:60px;color:#000;background:#fff', chars: true,
    html: '<span data-p="r">p水É</span>', glyphs: [G('r')],
  },
];

// Family 8: legacy and computed values.
const WM_VALUES = ['horizontal-tb', 'vertical-rl', 'vertical-lr', 'sideways-rl', 'sideways-lr', 'lr', 'lr-tb', 'rl', 'rl-tb', 'tb', 'tb-rl', 'initial', 'inherit', 'bogus'] as const;
const valueId = (v: string): string => v.replace(/ /g, '_');
const legacyCase = (prop: string, v: string): Case => ({
  id: `c8-${prop.replace(/^-/, '')}-${valueId(v)}`, note: `${prop}:${v} on a child of a horizontal-tb or vertical-rl container`, modes: ['horizontal-tb', 'vertical-rl'],
  style: 'width:200px;height:100px', html: box('t', `${prop}:${v}`, 'ab<br>cd'),
});
const family8: Case[] = [
  ...WM_VALUES.map((v) => legacyCase('writing-mode', v)),
  ...WM_VALUES.map((v) => legacyCase('-webkit-writing-mode', v)),
  ...(['mixed', 'upright', 'sideways', 'sideways-right', 'vertical-right', 'use-glyph-orientation', 'bogus'] as const).map((v) => legacyCase('text-orientation', v)),
  ...(['mixed', 'upright', 'sideways', 'sideways-right', 'vertical-right'] as const).map((v) => legacyCase('-webkit-text-orientation', v)),
  ...(['none', 'all', 'digits', 'digits 2', 'bogus'] as const).map((v) => legacyCase('text-combine-upright', v)),
  ...(['none', 'horizontal'] as const).map((v) => legacyCase('-webkit-text-combine', v)),
  { id: 'c8-table-row-group', note: 'writing-mode on a table row is replaced by the parent\'s (StyleAdjuster)', modes: ['horizontal-tb', 'vertical-rl'], style: 'width:200px;height:100px', html: `<table data-p="tb" style="border-spacing:0"><tbody data-p="tbody" style="writing-mode:vertical-lr"><tr data-p="tr" style="writing-mode:vertical-lr"><td data-p="td">ab</td></tr></tbody></table>` },
];

const FAMILIES: readonly Family[] = [
  { id: 'family1-block-flow', title: 'Block flow per mode', cases: family1 },
  { id: 'family2-orthogonal', title: 'Orthogonal flows and the fallback inline size', cases: family2 },
  { id: 'family3-flex', title: 'Flex', cases: family3 },
  { id: 'family4-abspos', title: 'Abspos static positions', cases: family4 },
  { id: 'family5-inline', title: 'Inline line boxes with Ahem rotated sideways', cases: family5 },
  { id: 'family6-orientation-combine', title: 'text-orientation and text-combine-upright', cases: family6 },
  { id: 'family7-glyphs', title: 'Screenshot samples of rotated and upright glyphs', cases: family7 },
  { id: 'family8-computed', title: 'Legacy and computed values', cases: family8 },
];

const docFor = (c: Case, mode: Mode): string => {
  const html = c.html.replaceAll('{wm}', mode);
  const wm = c.childWm ? 'horizontal-tb' : mode;
  return `<!DOCTYPE html><html><head><style>body{margin:0}#c{font-size:10px}</style></head><body><div id="c" style="writing-mode:${wm};${c.style ?? ''}">${html}</div></body></html>`;
};

type Rect = [number, number, number, number];
type Measured = {
  container: Rect;
  leaves: { owner: string; index: number; text: string; rects: Rect[] }[];
  chars: { owner: string; ch: string; rects: Rect[]; lineStart: [number, number] | null }[] | null;
  elements: Record<string, { tag: string; rects: Rect[]; bounding: Rect; computed: Record<string, string>; specified: Record<string, string> }>;
  errors: string[];
};

/** Runs in the page: measures #c. Kept self-contained because Playwright serializes it. */
function measure(arg: { computed: readonly string[]; specified: readonly string[]; chars: boolean }): Measured {
  const c = document.getElementById('c') as HTMLElement;
  const origin = c.getBoundingClientRect();
  const rect = (r: DOMRect): Rect => [r.left - origin.left, r.top - origin.top, r.width, r.height];
  const errors: string[] = [];
  const label = (n: Node): string => {
    for (let e: Node | null = n; e && e !== c; e = e.parentNode) if (e instanceof HTMLElement && e.dataset.p) return e.dataset.p;
    return 'root';
  };
  const texts: Text[] = [];
  const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) texts.push(n as Text);
  const leaves = texts.map((n) => {
    const r = document.createRange();
    r.selectNodeContents(n);
    const owner = label(n);
    return { owner, index: texts.filter((x) => label(x) === owner).indexOf(n), text: n.data, rects: Array.from(r.getClientRects()).map(rect) };
  });
  const elements: Measured['elements'] = {};
  const record = (e: HTMLElement, key: string, rects: Rect[]): void => {
    const cs = getComputedStyle(e);
    elements[key] = {
      tag: e.tagName.toLowerCase(),
      rects,
      bounding: rect(e.getBoundingClientRect()),
      computed: Object.fromEntries(arg.computed.map((p) => [p, cs.getPropertyValue(p)])),
      specified: Object.fromEntries(arg.specified.map((p) => [p, e.style.getPropertyValue(p)]).filter(([, v]) => v !== '')),
    };
  };
  for (const e of Array.from(c.querySelectorAll('[data-p]')) as HTMLElement[]) record(e, e.dataset.p!, Array.from(e.getClientRects()).map(rect));
  record(c, '#c', []);
  const charRects = (n: Text, i: number): DOMRect[] => {
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + 1);
    return Array.from(r.getClientRects());
  };
  const snapshot = (): string => JSON.stringify(texts.flatMap((n) => Array.from(n.data, (_, i) => charRects(n, i).map((r) => [r.left, r.top, r.width, r.height]))));
  let chars: Measured['chars'] = null;
  if (arg.chars) {
    const before = snapshot();
    const marker = document.createElement('i');
    marker.style.cssText = 'position:absolute;display:inline;width:0;height:0';
    chars = [];
    for (const n of texts) {
      for (let i = 0; i < n.data.length; i++) {
        const rects = charRects(n, i).map(rect);
        let lineStart: [number, number] | null = null;
        // Inside a text-combine-upright box a marker would join the combined text, so none is inserted there.
        if (rects.length > 0 && getComputedStyle(n.parentElement!).getPropertyValue('text-combine-upright') === 'none') {
          // The marker's static position is the line's block-start edge at the character's inline start.
          const tail = n.splitText(i);
          n.parentNode!.insertBefore(marker, tail);
          const m = marker.getBoundingClientRect();
          lineStart = [m.left - origin.left, m.top - origin.top];
          marker.remove();
          n.appendData(tail.data);
          tail.remove();
        }
        chars.push({ owner: label(n), ch: n.data[i]!, rects, lineStart });
      }
    }
    if (snapshot() !== before) errors.push('markers did not restore the layout');
  }
  return { container: rect(origin), leaves, chars, elements, errors };
}

/** Decodes an 8-bit non-interlaced RGB or RGBA PNG (Chrome's screenshot format). */
function decodePng(buf: Buffer): { width: number; height: number; channels: number; data: Uint8Array } {
  let p = 8;
  let width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error('PNG: expected 8-bit non-interlaced');
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 0;
      if (channels === 0) throw new Error(`PNG: color type ${body[9]}`);
    } else if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= channels ? out[y * stride + x - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const cc = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - cc, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - cc);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
      }
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return { width, height, channels, data: out };
}

/** Rows top to bottom of '#' (dark) and '.' (light) over the first character rect of each glyph label's text. */
async function glyphGrids(page: Page, c: Case, m: Measured, dpr: number): Promise<Record<string, { rect: Rect; rows: string[] }>> {
  const bb = await page.locator('#c').boundingBox();
  const png = decodePng(await page.screenshot({ fullPage: true }));
  const out: Record<string, { rect: Rect; rows: string[] }> = {};
  for (const g of c.glyphs ?? []) {
    const ch = m.chars?.find((x) => x.owner === g.label && x.rects.length > 0);
    if (!ch) throw new Error(`${c.id}: no rendered character under ${g.label}`);
    const r = ch.rects[0]!;
    const rows: string[] = [];
    for (let j = 0; j < g.n; j++) {
      let row = '';
      for (let i = 0; i < g.n; i++) {
        const x = Math.floor((bb!.x + r[0] + ((i + 0.5) * r[2]) / g.n) * dpr);
        const y = Math.floor((bb!.y + r[1] + ((j + 0.5) * r[3]) / g.n) * dpr);
        const k = (y * png.width + x) * png.channels;
        row += png.data[k]! + png.data[k + 1]! + png.data[k + 2]! < 384 ? '#' : '.';
      }
      rows.push(row);
    }
    out[g.label] = { rect: r, rows };
  }
  return out;
}

async function captureOne(browser: Browser, c: Case, mode: Mode, dir: 'ltr' | 'rtl', dpr: number): Promise<Record<string, unknown>> {
  const page = await openPage(browser, docFor(c, mode), { viewport: c.viewport ?? VIEWPORT, devicePixelRatio: dpr, direction: dir, rootFont: 'ahem' });
  try {
    const m = await page.evaluate(measure, { computed: [...COMPUTED], specified: [...SPECIFIED], chars: c.chars === true });
    if (m.errors.length > 0) throw new Error(`${c.id} ${mode} ${dir} dpr ${dpr}: ${m.errors.join('; ')}`);
    const entry: Record<string, unknown> = { container: m.container, leaves: m.leaves, elements: m.elements };
    if (m.chars) entry.chars = m.chars;
    if (c.glyphs) entry.glyphs = await glyphGrids(page, c, m, dpr);
    return entry;
  } finally {
    await page.context().close();
  }
}

type Elements = Record<string, { computed?: unknown; specified?: unknown }>;
/** Drops each element's computed and specified styles where they equal the DPR 1 entry's (kept where they differ). */
function withoutSameStyles(entry: Record<string, unknown>, first: Record<string, unknown>): Record<string, unknown> {
  const els = entry.elements as Elements;
  const ref = first.elements as Elements;
  const out: Elements = {};
  for (const [k, e] of Object.entries(els)) {
    const r = ref[k];
    const same = r !== undefined && JSON.stringify(r.computed) === JSON.stringify(e.computed) && JSON.stringify(r.specified) === JSON.stringify(e.specified);
    out[k] = same ? Object.fromEntries(Object.entries(e).filter(([p]) => p !== 'computed' && p !== 'specified')) : e;
  }
  return { ...entry, elements: out };
}

async function captureFamily(browsers: Map<number, Browser>, fam: Family, modes: readonly Mode[]): Promise<unknown> {
  const cases: Record<string, unknown> = {};
  for (const c of fam.cases) {
    const results: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const mode of (c.modes ?? modes).filter((x) => modes.includes(x))) {
      results[mode] = {};
      for (const dir of DIRS) {
        const byDpr = await Promise.all(DPRS.map((dpr) => captureOne(browsers.get(dpr)!, c, mode, dir, dpr)));
        const base = JSON.stringify(byDpr[0]);
        results[mode]![dir] = Object.fromEntries(DPRS.map((dpr, k) => [`dpr${dpr}`, k === 0 ? byDpr[0]! : JSON.stringify(byDpr[k]) === base ? '=dpr1' : withoutSameStyles(byDpr[k]!, byDpr[0]!)]));
      }
    }
    cases[c.id] = {
      note: c.note, style: c.style ?? '', html: c.html,
      ...(c.childWm ? { childWm: true } : {}), ...(c.viewport ? { viewport: c.viewport } : {}), ...(c.glyphs ? { glyphs: c.glyphs } : {}),
      results,
    };
  }
  return {
    chrome: CHROME_VERSION, playwright: PLAYWRIGHT_VERSION, family: fam.id, title: fam.title, font: 'Ahem', dprs: DPRS, directions: DIRS, modes,
    viewport: VIEWPORT,
    units: 'CSS px relative to the container border box; results[mode][dir][dprN]; "=dpr1" means identical to the DPR 1 entry; an element without computed and specified has the DPR 1 entry\'s',
    cases,
  };
}

/** Which writing-mode keywords Chrome parses, and which other values the corpus depends on. */
async function supportTable(browser: Browser): Promise<Record<string, boolean>> {
  const page = await openPage(browser, '<!DOCTYPE html><html><head></head><body></body></html>', { viewport: VIEWPORT, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ahem' });
  const pairs: [string, string][] = [
    ...ALL_MODES.map((m): [string, string] => ['writing-mode', m]),
    ...['lr', 'lr-tb', 'rl', 'rl-tb', 'tb', 'tb-rl'].map((m): [string, string] => ['writing-mode', m]),
    ...ALL_MODES.map((m): [string, string] => ['-webkit-writing-mode', m]),
    ['text-orientation', 'sideways'], ['text-orientation', 'sideways-right'], ['text-combine-upright', 'all'], ['text-combine-upright', 'digits 2'],
  ];
  const out = await page.evaluate((ps) => Object.fromEntries(ps.map(([p, v]) => [`${p}: ${v}`, CSS.supports(p, v)])), pairs);
  await page.context().close();
  return out;
}

/** JSON with one key per line, but arrays of numbers and strings kept on one line. */
const stringify = (v: unknown): string =>
  `${JSON.stringify(v, null, 1).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${inner.split(/,\s+/).join(',')}]`)}\n`;

const check = process.argv.includes('--check');
const browsers = new Map<number, Browser>();
let failed = false;
try {
  for (const dpr of DPRS) browsers.set(dpr, await launchChrome(dpr));
  const supports = await supportTable(browsers.get(1)!);
  const modes = ALL_MODES.filter((m) => supports[`writing-mode: ${m}`]);
  const dropped = ALL_MODES.filter((m) => !modes.includes(m));
  if (dropped.length > 0) console.log(`Chrome ${CHROME_VERSION} rejects ${dropped.join(', ')}: those modes are dropped`);
  if (!check) mkdirSync(repoPath(OUT_DIR), { recursive: true });
  const outputs: [string, string, number][] = [
    ['support.json', stringify({ chrome: CHROME_VERSION, playwright: PLAYWRIGHT_VERSION, cssSupports: supports, modes, dropped }), 0],
  ];
  for (const fam of FAMILIES) outputs.push([`${fam.id}.json`, stringify(await captureFamily(browsers, fam, modes)), fam.cases.length]);
  for (const [name, text, n] of outputs) {
    const file = repoPath(`${OUT_DIR}/${name}`);
    if (check) {
      const same = existsSync(file) && readFileSync(file, 'utf8') === text;
      console.log(`${same ? 'same' : 'DIFFERS'} ${OUT_DIR}/${name} (${n} cases)`);
      if (!same) failed = true;
    } else {
      writeFileSync(file, text);
      console.log(`wrote ${OUT_DIR}/${name} (${n} cases)`);
    }
  }
} finally {
  for (const b of browsers.values()) await b.close();
}
if (failed) {
  console.error('capture-writing-mode-probe --check: the committed corpus differs from a fresh capture');
  process.exit(1);
}
