// INL-P: the inline probe corpus. Measures Chrome 145.0.7632.6 inline formatting over Ahem-only cases at DPR 1, 2, 3 and 2.625,
// in ltr and rtl, and writes docs/research/inline-spike/probe/<family>.json. Per case it records line boxes (top and height from
// an inline-level abspos marker, whose static position is the line top; the baseline from a 0x0 inline-block marker, kept only
// when inserting it moves nothing), per-leaf Range client rects, getClientRects/getBoundingClientRect of every labelled element
// (inline boxes, <br>, atomics), computed styles and, for paint-order cases, sampled screenshot pixels.
// Run with: node --conditions=dragon-internal scripts/capture-inline-probe.ts [--check]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';

type Sample = { readonly name: string; readonly x: number; readonly y: number };
type Case = {
  readonly id: string;
  readonly note: string;
  readonly width: number;
  /** Declarations appended to the container's style (font-size defaults to 10px, line-height to normal). */
  readonly style?: string;
  readonly html: string;
  /**
   * Pixels read from a screenshot, in CSS px relative to the container's border box (paint order). x is measured from
   * the inline-start edge: in rtl it is mirrored to (border-box width - x), where the content sits. Every point targets
   * painted content, so a sample reading the white page background is a capture error.
   */
  readonly samples?: readonly Sample[];
};
type Family = { readonly id: string; readonly title: string; readonly cases: readonly Case[] };

const DPRS = [1, 2, 3, 2.625] as const;
const DIRS = ['ltr', 'rtl'] as const;
const OUT_DIR = 'docs/research/inline-spike/probe';
const COMPUTED = [
  'display', 'font-family', 'font-size', 'line-height', 'vertical-align', 'white-space', 'overflow-x',
  'margin-left', 'margin-right', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'border-left-width', 'border-right-width', 'border-top-width', 'border-bottom-width', 'width', 'height',
] as const;

const bg = (c: string): string => `background:${c}`;

// Family 1: mixed sizes and line-heights per line.
const family1: Case[] = [
  { id: 'f1-number', note: 'root 10px lh 1.5, span 20px inherits the number', width: 200, style: 'line-height:1.5', html: 'Xx <span data-p="s">Yy</span> zz<br>ab', },
  { id: 'f1-number-span20', note: 'root 10px lh 1.5, 20px span', width: 200, style: 'line-height:1.5', html: 'Xx <span data-p="s" style="font-size:20px">Yy</span> zz<br>ab' },
  { id: 'f1-px', note: 'root lh 12px inherited as px by a 20px span', width: 200, style: 'line-height:12px', html: 'Xx <span data-p="s" style="font-size:20px">Yy</span> zz<br>ab' },
  { id: 'f1-normal', note: 'line-height normal, 20px span', width: 200, html: 'Xx <span data-p="s" style="font-size:20px">Yy</span> zz<br>ab' },
  { id: 'f1-strut-larger', note: 'root 20px lh 40px, 10px span: the strut dominates', width: 200, style: 'font-size:20px;line-height:40px', html: 'Xx <span data-p="s" style="font-size:10px">Yy</span> zz<br>ab' },
  { id: 'f1-strut-smaller', note: 'root 10px lh 10px, 30px span lh 30px: the content dominates', width: 200, style: 'line-height:10px', html: 'Xx <span data-p="s" style="font-size:30px;line-height:30px">Yy</span> zz<br>ab' },
  { id: 'f1-span-lh-smaller', note: '30px span with line-height 5px inside root lh 20px', width: 200, style: 'line-height:20px', html: 'Xx <span data-p="s" style="font-size:30px;line-height:5px">Yy</span> zz' },
  { id: 'f1-negative-leading', note: 'line-height 0.5 wrapping over three lines', width: 40, style: 'font-size:20px;line-height:0.5', html: 'aa bb cc' },
  { id: 'f1-odd-leading', note: 'root 10px lh 15px (odd leading 5)', width: 200, style: 'line-height:15px', html: 'Xx <span data-p="s" style="font-size:13px">Yy</span><br>ab' },
  { id: 'f1-fractional', note: 'root 17.5px lh 1.3, 23.3px span', width: 300, style: 'font-size:17.5px;line-height:1.3', html: 'Xx <span data-p="s" style="font-size:23.3px">Yy</span> zz<br>ab' },
  { id: 'f1-fractional-px', note: 'root 16px lh 23.3px, 10px span lh 7.7px', width: 300, style: 'font-size:16px;line-height:23.3px', html: 'Xx <span data-p="s" style="font-size:10px;line-height:7.7px">Yy</span> zz' },
  { id: 'f1-nested', note: 'span 20px containing span 13px lh 3', width: 300, style: 'line-height:1.2', html: 'a <span data-p="o" style="font-size:20px">b <span data-p="i" style="font-size:13px;line-height:3">c</span> d</span> e' },
  { id: 'f1-empty-box', note: 'an empty 30px span lh 30px on a line with text', width: 200, style: 'line-height:12px', html: 'a <span data-p="e" style="font-size:30px;line-height:30px"></span> b<br>c' },
  { id: 'f1-empty-box-only', note: 'an empty 30px span alone on the first line', width: 200, style: 'line-height:12px', html: '<span data-p="e" style="font-size:30px;line-height:30px"></span><br>c' },
  { id: 'f1-empty-root', note: 'no inline content: an empty span only', width: 200, style: 'line-height:12px', html: '<span data-p="e" style="font-size:30px"></span>' },
  { id: 'f1-wrap-mixed', note: 'wrapping text where only the second line carries a 20px span', width: 60, style: 'line-height:1.2', html: 'aa bb <span data-p="s" style="font-size:20px">cc</span> dd' },
];

// Family 2: <br>.
const family2: Case[] = [
  { id: 'f2-leading', note: 'a leading <br>', width: 200, style: 'line-height:15px', html: '<br data-p="br">ab' },
  { id: 'f2-trailing', note: 'a trailing <br> makes no extra line', width: 200, style: 'line-height:15px', html: 'ab<br data-p="br">' },
  { id: 'f2-trailing-two', note: 'two trailing <br>', width: 200, style: 'line-height:15px', html: 'ab<br data-p="b1"><br data-p="b2">' },
  { id: 'f2-consecutive', note: 'three consecutive <br> between text', width: 200, style: 'line-height:15px', html: 'ab<br data-p="b1"><br data-p="b2"><br data-p="b3">cd' },
  { id: 'f2-only', note: 'a block holding only one <br>', width: 200, style: 'line-height:15px', html: '<br data-p="br">' },
  { id: 'f2-in-span', note: '<br> inside a span splits it over two lines', width: 200, style: 'line-height:15px', html: 'a<span data-p="s">b<br data-p="br">c</span>d' },
  { id: 'f2-big-font', note: '<br> with font-size 30px on a line of 10px text', width: 200, style: 'line-height:normal', html: 'ab<br data-p="br" style="font-size:30px">cd' },
  { id: 'f2-big-font-only', note: 'a br-only line whose <br> has font-size 30px', width: 200, style: 'line-height:normal', html: 'ab<br data-p="b1"><br data-p="b2" style="font-size:30px">cd' },
  { id: 'f2-big-lh', note: '<br> with line-height 40px', width: 200, style: 'line-height:15px', html: 'ab<br data-p="b1"><br data-p="b2" style="line-height:40px">cd' },
  { id: 'f2-in-big-span', note: 'br-only line inside a 30px span', width: 200, style: 'line-height:normal', html: 'ab<span data-p="s" style="font-size:30px"><br data-p="b1"><br data-p="b2"></span>cd' },
  { id: 'f2-after-space', note: 'spaces around <br> collapse', width: 200, style: 'line-height:15px', html: 'ab   <br data-p="br">   cd' },
];

// Family 3: break opportunities. Width 50px holds five 10px glyphs; each probe is seven glyphs.
const PUNCT = ['-', '?', '!', '|', '/', '(', ')', ',', '.', ';', ':', '%', '$', '+', '"', '{', '}', '[', ']'] as const;
const punctId = (p: string): string => `u${p.codePointAt(0)!.toString(16).padStart(4, '0')}`;
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const family3: Case[] = [
  ...PUNCT.flatMap((p): Case[] => [
    { id: `f3-${punctId(p)}-alpha`, note: `aaa${p}bbb in 50px`, width: 50, html: escapeHtml(`aaa${p}bbb`) },
    { id: `f3-${punctId(p)}-digit`, note: `aaa${p}123 in 50px`, width: 50, html: escapeHtml(`aaa${p}123`) },
    { id: `f3-${punctId(p)}-lead`, note: `a ${p}bbbb in 50px (after a space)`, width: 50, html: escapeHtml(`a ${p}bbbb`) },
  ]),
  { id: 'f3-digit-hyphen', note: '123-456 in 50px', width: 50, html: '123-456' },
  { id: 'f3-zwsp', note: 'aaa U+200B bbb in 50px', width: 50, html: 'aaa​bbb' },
  { id: 'f3-box-boundary', note: 'aaa<span>bbb</span>: a box boundary is not an opportunity', width: 50, html: 'aaa<span data-p="s">bbb</span>' },
  { id: 'f3-box-space-inside', note: 'aaa<span> bbb</span>', width: 50, html: 'aaa<span data-p="s"> bbb</span>' },
  { id: 'f3-box-space-before-close', note: 'aa<span>bb </span>cc', width: 50, html: 'aa<span data-p="s">bb </span>cc' },
  { id: 'f3-trailing-space-close', note: 'the hanging space sits inside the closing span', width: 30, html: '<span data-p="s">aaa </span>bbb' },
  { id: 'f3-trailing-spaces-close', note: 'three hanging spaces inside a bordered span', width: 30, style: 'white-space:pre-wrap', html: '<span data-p="s" style="border-right:2px solid">aaa   </span>bbb' },
  { id: 'f3-box-hyphen', note: 'aaa<span>-</span>bbb', width: 50, html: 'aaa<span data-p="s">-</span>bbb' },
  { id: 'f3-mixed-fit', note: 'the fit uses per-item widths across fonts', width: 60, html: 'aa <span data-p="s" style="font-size:15px">bb</span> cc' },
  { id: 'f3-exact-fit', note: 'aaaaa bbbbb in exactly 50px', width: 50, html: 'aaaaa bbbbb' },
  { id: 'f3-overflow-word', note: 'a word wider than the line', width: 30, html: 'aaaaaa bb' },
  { id: 'f3-nowrap-span', note: 'a nowrap span in wrapping text', width: 50, html: 'aa <span data-p="s" style="white-space:nowrap">bb cc</span> dd' },
];

// Family 4: inline box margins, borders and padding.
const DECO = 'margin:0 3px;border:2px solid #000;padding:4px 5px';
const family4: Case[] = [
  { id: 'f4-single', note: 'one decorated span on one line', width: 200, style: 'line-height:20px', html: `a <span data-p="s" style="${DECO};${bg('#0f0')}">bb</span> c` },
  { id: 'f4-slice', note: 'a decorated span sliced over three lines', width: 60, style: 'line-height:20px', html: `a <span data-p="s" style="${DECO};${bg('#0f0')}">bb cc dd</span> e` },
  { id: 'f4-edge-width', note: 'inline-end decoration pushes the next word to the next line', width: 60, style: 'line-height:20px', html: `aa <span data-p="s" style="padding-right:15px">bb</span> cc` },
  { id: 'f4-start-width', note: 'inline-start margin, border, padding take inline space', width: 60, style: 'line-height:20px', html: `aa <span data-p="s" style="margin-left:4px;border-left:3px solid;padding-left:6px">bb</span> cc` },
  { id: 'f4-wider', note: 'a decorated span wider than the line', width: 30, style: 'line-height:20px', html: `<span data-p="s" style="${DECO}">aaaa</span>` },
  { id: 'f4-nested', note: 'nested decorated spans sliced over lines', width: 70, style: 'line-height:20px', html: `a <span data-p="o" style="padding:0 4px;border:1px solid">b <span data-p="i" style="padding:0 6px;border:2px solid">cc dd</span> e</span> f` },
  { id: 'f4-vertical-only', note: 'block-axis padding and border do not change line height', width: 200, style: 'line-height:12px', html: `a <span data-p="s" style="padding:20px 0;border-top:9px solid;border-bottom:9px solid">bb</span> c<br>d` },
  { id: 'f4-empty', note: 'an empty decorated span', width: 200, style: 'line-height:20px', html: `a<span data-p="s" style="${DECO}"></span>b` },
  {
    id: 'f4-overlap', note: 'padding-bottom of a line-1 span overlaps a line-2 span; which background paints on top', width: 60,
    style: 'line-height:20px',
    html: `<span data-p="a" style="padding-bottom:15px;${bg('rgb(0,0,255)')}">aaa</span> <span data-p="b" style="padding-top:15px;${bg('rgb(255,0,0)')};color:rgb(0,255,0)">bbb</span>`,
    samples: [
      { name: 'overlap-a-over-b', x: 5, y: 22 },
      { name: 'line2-glyph', x: 5, y: 26 },
      { name: 'line1-glyph', x: 5, y: 10 },
      { name: 'line1-under-glyph', x: 5, y: 17 },
    ],
  },
  {
    id: 'f4-overlap-same', note: 'one span sliced over two lines with padding overlapping its own next fragment', width: 40,
    style: 'line-height:20px;color:rgb(0,255,0)',
    html: `<span data-p="s" style="padding:12px 0;${bg('rgb(0,0,255)')};border-bottom:3px solid rgb(255,0,0)">aa bb</span>`,
    samples: [
      { name: 'line1-bottom-border-on-line2-glyph', x: 5, y: 26 },
      { name: 'line2-top-padding', x: 5, y: 18 },
      { name: 'line1-glyph', x: 5, y: 10 },
    ],
  },
];

// Family 5: atomic inlines and vertical-align.
const VA = ['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom', '5px', '-5px', '50%', '-50%'] as const;
const vaId = (v: string): string => v.replace('%', 'pct').replace('-', 'm');
const IB = 'display:inline-block';
const family5: Case[] = [
  { id: 'f5-ib-text', note: 'inline-block with two lines of text: baseline is the last line', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="ib" style="${IB};font-size:10px;line-height:15px">b<br>c</span>d` },
  { id: 'f5-ib-empty', note: 'empty 20x30 inline-block: bottom margin edge on the baseline', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="ib" style="${IB};width:20px;height:30px;margin-bottom:4px"></span>d` },
  { id: 'f5-ib-overflow', note: 'inline-block with text and overflow hidden: bottom margin edge', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="ib" style="${IB};overflow:hidden;font-size:10px;margin-bottom:3px">b<br>c</span>d` },
  { id: 'f5-ib-block-child', note: 'inline-block whose last line box is inside a block child with padding', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="ib" style="${IB};font-size:10px;padding-bottom:6px"><span data-p="blk" style="display:block;padding-bottom:5px">b</span></span>d` },
  { id: 'f5-if-row', note: 'inline-flex row: baseline from the first item', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="if" style="display:inline-flex;font-size:10px;line-height:15px"><span data-p="i1" style="padding-top:7px">b</span><span data-p="i2">c<br>e</span></span>d` },
  { id: 'f5-if-column', note: 'inline-flex column: baseline from the first item', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="if" style="display:inline-flex;flex-direction:column;font-size:10px"><span data-p="i1">b</span><span data-p="i2">c</span></span>d` },
  { id: 'f5-if-empty', note: 'empty inline-flex 20x30: synthesized baseline', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="if" style="display:inline-flex;width:20px;height:30px;margin-bottom:4px"></span>d` },
  { id: 'f5-if-align-baseline', note: 'inline-flex with align-items:baseline', width: 200, style: 'font-size:20px;line-height:1', html: `a<span data-p="if" style="display:inline-flex;align-items:baseline;font-size:10px"><span data-p="i1" style="padding-top:9px">b</span><span data-p="i2" style="font-size:20px">c</span></span>d` },
  ...VA.map((v): Case => ({
    id: `f5-va-span-${vaId(v)}`, note: `vertical-align:${v} on a 10px span in 20px text, lh 30px`, width: 300, style: 'font-size:20px;line-height:30px',
    html: `Xx<span data-p="s" style="font-size:10px;vertical-align:${v}">yy<i data-p="bl" style="${IB};width:0;height:0"></i></span>zz`,
  })),
  ...VA.map((v): Case => ({
    id: `f5-va-ib-${vaId(v)}`, note: `vertical-align:${v} on a 15x25 inline-block in 20px text, lh 30px`, width: 300, style: 'font-size:20px;line-height:30px',
    html: `Xx<span data-p="ib" style="${IB};width:15px;height:25px;vertical-align:${v}"></span>zz`,
  })),
  { id: 'f5-sub-nested', note: 'sub on a smaller span containing super on a smaller span', width: 300, style: 'font-size:20px;line-height:1', html: `X<span data-p="a" style="vertical-align:sub;font-size:smaller">y<span data-p="b" style="vertical-align:super;font-size:smaller">z</span></span>w` },
  { id: 'f5-super-nested', note: 'super on 10px span containing sub on 7px span', width: 300, style: 'font-size:20px;line-height:1', html: `X<span data-p="a" style="vertical-align:super;font-size:10px">y<span data-p="b" style="vertical-align:sub;font-size:7px">z</span></span>w` },
  { id: 'f5-tags-sub-sup', note: '<sub> and <sup> with the UA sheet', width: 300, style: 'font-size:20px;line-height:1', html: `X<sub data-p="sub">y</sub>w<sup data-p="sup">z</sup>` },
  { id: 'f5-top-tall', note: 'vertical-align top with a 60px inline-block, two lines', width: 60, style: 'font-size:10px;line-height:15px', html: `aa <span data-p="ib" style="${IB};width:10px;height:60px;vertical-align:top"></span> bb cc dd` },
  { id: 'f5-bottom-tall', note: 'vertical-align bottom with a 60px inline-block', width: 200, style: 'font-size:10px;line-height:15px', html: `aa <span data-p="ib" style="${IB};width:10px;height:60px;vertical-align:bottom"></span> bb` },
  { id: 'f5-top-bottom-both', note: 'top 40px and bottom 60px boxes on one line', width: 200, style: 'font-size:10px;line-height:15px', html: `aa <span data-p="t" style="${IB};width:10px;height:40px;vertical-align:top"></span><span data-p="b" style="${IB};width:10px;height:60px;vertical-align:bottom"></span> bb` },
  { id: 'f5-top-span', note: 'vertical-align top on a 30px span', width: 200, style: 'font-size:10px;line-height:15px', html: `aa <span data-p="s" style="font-size:30px;vertical-align:top">bb</span> cc` },
  { id: 'f5-break-around', note: 'aaa<atomic>bbb in 50px: breaks around U+FFFC', width: 50, html: `aaa<span data-p="ib" style="${IB};width:10px;height:10px"></span>bbb` },
  { id: 'f5-break-around-img', note: 'aaaa<atomic>bbb in 50px (the atomic overflows the line)', width: 50, html: `aaaa<span data-p="ib" style="${IB};width:20px;height:10px"></span>bbb` },
  { id: 'f5-break-space-atomic', note: 'aa <atomic> bb with the atomic at the line end', width: 40, html: `aa <span data-p="ib" style="${IB};width:10px;height:10px"></span> bb` },
  { id: 'f5-stf-short', note: 'shrink-to-fit: content narrower than available', width: 200, html: `<span data-p="ib" style="${IB}">aa bb</span>` },
  { id: 'f5-stf-wrap', note: 'shrink-to-fit: content wider than available wraps at available', width: 45, html: `<span data-p="ib" style="${IB}">aa bb cc</span>` },
  { id: 'f5-stf-min', note: 'shrink-to-fit: available below min-content', width: 15, html: `<span data-p="ib" style="${IB}">aaa b</span>` },
  { id: 'f5-stf-margins', note: 'shrink-to-fit with margins and padding in a line', width: 200, html: `x<span data-p="ib" style="${IB};margin:0 7px;padding:0 3px">aa bb</span>y` },
];

// Family 6: computed font-size of small, sub, sup and code.
const FS_PARENTS = ['10px', '16px', '17.5px', '23.3px', 'medium'] as const;
const FS_FAMILIES = ['Ahem', 'monospace'] as const;
const family6: Case[] = FS_FAMILIES.flatMap((fam) => FS_PARENTS.map((size): Case => ({
  id: `f6-${fam.toLowerCase()}-${size.replace('.', '_')}`, note: `font-family ${fam}, font-size ${size}`, width: 300,
  style: `font-family:${fam};font-size:${size}`,
  html: `x<small data-p="small">a</small><sub data-p="sub">b</sub><sup data-p="sup">c</sup><code data-p="code">d</code><span data-p="larger" style="font-size:larger">e</span><span data-p="smaller" style="font-size:smaller">f</span><code data-p="code-ahem" style="font-family:Ahem">g</code>`,
})));

const FAMILIES: readonly Family[] = [
  { id: 'family1-mixed-sizes', title: 'Mixed sizes and line-heights per line', cases: family1 },
  { id: 'family2-br', title: '<br>', cases: family2 },
  { id: 'family3-breaks', title: 'Break opportunities', cases: family3 },
  { id: 'family4-decorations', title: 'Inline box margins, borders and padding', cases: family4 },
  { id: 'family5-atomic', title: 'Atomic inlines and vertical-align', cases: family5 },
  { id: 'family6-font-size', title: 'Computed font-size of small, sub, sup and code', cases: family6 },
];

const docFor = (c: Case): string =>
  `<!DOCTYPE html><html><head><style>body{margin:0}#c{font-size:10px}</style></head><body><div id="c" style="width:${c.width}px;${c.style ?? ''}">${c.html}</div><div style="height:40px"></div></body></html>`;

type Rect = [number, number, number, number];
type Measured = {
  container: Rect;
  lines: { top: number; height: number; text: string; baseline: number | null; baselineParent: string | null; baselineSkipped: string | null }[];
  leaves: { owner: string; index: number; text: string; rects: Rect[] }[];
  elements: Record<string, { tag: string; rects: Rect[]; bounding: Rect; computed: Record<string, string> }>;
  errors: string[];
};

/** Runs in the page: measures #c. Kept self-contained because Playwright serializes it. */
function measure(props: readonly string[]): Measured {
  const c = document.getElementById('c') as HTMLElement;
  const origin = c.getBoundingClientRect();
  const rect = (r: DOMRect): Rect => [r.left - origin.left, r.top - origin.top, r.width, r.height];
  const errors: string[] = [];
  const label = (n: Node): string => {
    for (let e: Node | null = n; e && e !== c; e = e.parentNode) if (e instanceof HTMLElement && e.dataset.p) return e.dataset.p;
    return 'root';
  };
  const isAtomic = (e: Element): boolean => {
    const d = getComputedStyle(e).display;
    return d.startsWith('inline-') || d === 'block' || d === 'flex';
  };
  // Items of the root inline formatting context in logical order: rendered characters, <br> and atomics.
  type Item = { kind: 'char'; node: Text; offset: number } | { kind: 'br' | 'atomic'; el: Element };
  const items: Item[] = [];
  const leafNodes: Text[] = [];
  const walk = (n: Node, inRoot: boolean): void => {
    for (const ch of Array.from(n.childNodes)) {
      if (ch instanceof Text) {
        leafNodes.push(ch);
        if (inRoot) for (let i = 0; i < ch.data.length; i++) items.push({ kind: 'char', node: ch, offset: i });
      } else if (ch instanceof HTMLBRElement) {
        if (inRoot) items.push({ kind: 'br', el: ch });
      } else if (ch instanceof Element) {
        const atomic = isAtomic(ch);
        if (inRoot && atomic) items.push({ kind: 'atomic', el: ch });
        walk(ch, inRoot && !atomic);
      }
    }
  };
  walk(c, true);
  // Recorded from the pristine layout, before any marker mutates the DOM.
  const leaves = leafNodes.map((n) => {
    const r = document.createRange();
    r.selectNodeContents(n);
    const owner = label(n);
    const siblings = leafNodes.filter((x) => label(x) === owner);
    return { owner, index: siblings.indexOf(n), text: n.data, rects: Array.from(r.getClientRects()).map(rect) };
  });
  const elements: Measured['elements'] = {};
  for (const e of Array.from(c.querySelectorAll('[data-p]')) as HTMLElement[]) {
    const cs = getComputedStyle(e);
    elements[e.dataset.p!] = {
      tag: e.tagName.toLowerCase(),
      rects: Array.from(e.getClientRects()).map(rect),
      bounding: rect(e.getBoundingClientRect()),
      computed: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])),
    };
  }
  const ccs = getComputedStyle(c);
  elements['#c'] = { tag: 'div', rects: [], bounding: rect(origin), computed: Object.fromEntries(props.map((p) => [p, ccs.getPropertyValue(p)])) };
  const itemRects = (it: Item): DOMRect[] => {
    if (it.kind !== 'char') return Array.from(it.el.getClientRects());
    const r = document.createRange();
    r.setStart(it.node, it.offset);
    r.setEnd(it.node, it.offset + 1);
    return Array.from(r.getClientRects());
  };
  const oof = document.createElement('i');
  oof.style.cssText = 'position:absolute;display:inline';
  const marker = document.createElement('i');
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  // A fresh walk, so it stays valid while a marker has split a text node; the marker itself is skipped.
  const snapshot = (): string => {
    const out: number[][] = [[c.getBoundingClientRect().height]];
    const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n === marker || n === oof) continue;
      // Inline boxes are skipped: after a DOM mutation Chrome drops the zero-width <br> piece from a span's getClientRects.
      const rs: DOMRect[] = [];
      if (n instanceof Text) {
        for (let i = 0; i < n.data.length; i++) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          rs.push(...Array.from(r.getClientRects()));
        }
      } else if (n instanceof HTMLBRElement || isAtomic(n as Element)) rs.push(...Array.from((n as Element).getClientRects()));
      else continue;
      for (const r of rs) out.push([r.left, r.top, r.width, r.height]);
    }
    return JSON.stringify(out);
  };
  const before = snapshot();
  const rendered = items.filter((it) => itemRects(it).length > 0);
  // Inserts `m` at the gap before (side 0) or after (side 1) an item, runs f, and restores the DOM.
  const at = <T>(it: Item, side: 0 | 1, m: Element, f: () => T): T => {
    if (it.kind === 'char') {
      const tail = it.node.splitText(it.offset + side);
      it.node.parentNode!.insertBefore(m, tail);
      const v = f();
      m.remove();
      it.node.appendData(tail.data);
      tail.remove();
      return v;
    }
    it.el.parentNode!.insertBefore(m, side === 0 ? it.el : it.el.nextSibling);
    const v = f();
    m.remove();
    return v;
  };
  const top = (): number => oof.getBoundingClientRect().top - origin.top;
  const cands = rendered.map((it) => [at(it, 0, oof, top), at(it, 1, oof, top)] as const);
  const tops = [...new Set(cands.flat())].sort((a, b) => a - b);
  const contentBottom = origin.height;
  const heightOf = (t: number): number => {
    const i = tops.indexOf(t);
    return (i + 1 < tops.length ? tops[i + 1]! : contentBottom) - t;
  };
  const rectLine = (it: Item): number | undefined => {
    const r = itemRects(it)[0]!;
    const mid = r.top - origin.top + r.height / 2;
    const hit = tops.filter((t) => mid >= t && mid < t + Math.max(heightOf(t), 1e-9));
    return hit.length === 1 ? hit[0] : undefined;
  };
  const lineOf = rendered.map((it, k) => {
    const [b, a] = cands[k]!;
    // A soft wrap never starts a line with a space: a space hangs or collapses at the end of the earliest line it can be on.
    if (it.kind === 'char' && (it.node.data[it.offset] === ' ' || it.node.data[it.offset] === '\t')) {
      const byRect = rectLine(it);
      return Math.min(a, b, ...(byRect === undefined ? [] : [byRect]));
    }
    if (a === b) return a;
    // Otherwise a boundary item's two gaps fall on different lines; its line is the one whose box contains its rect's center.
    const byRect = rectLine(it);
    if (byRect !== a && byRect !== b) errors.push(`item ${k}: line ambiguous between ${b} and ${a}`);
    return byRect ?? a;
  });
  const lineTops = [...new Set(lineOf)].sort((x, y) => x - y);
  const text = (it: Item): string => (it.kind === 'char' ? it.node.data[it.offset]! : it.kind === 'br' ? '\n' : '￼');
  const lines = lineTops.map((t) => {
    const own = rendered.filter((_, k) => lineOf[k] === t);
    let baseline: number | null = null;
    let baselineParent: string | null = null;
    let baselineSkipped: string | null = null;
    // Gaps inside the line first: after an item that is not the line's last, then before one that is not its first.
    const tries: [Item, 0 | 1][] = [...own.slice(0, -1).map((it): [Item, 1] => [it, 1]), ...own.slice(1).map((it): [Item, 0] => [it, 0]), [own[0]!, 0], [own.at(-1)!, 1]];
    for (const [it, side] of tries) {
      const r = at(it, side, marker, () => ({ y: marker.getBoundingClientRect().top - origin.top, same: snapshot() === before, parent: label(marker) }));
      if (r.same && r.y >= t && r.y <= t + heightOf(t)) {
        baseline = r.y - t;
        baselineParent = r.parent;
        break;
      }
      baselineSkipped = r.same ? 'marker off the line' : 'marker moves content';
    }
    if (baseline !== null) baselineSkipped = null;
    return { top: t, height: heightOf(t), text: own.map(text).join(''), baseline, baselineParent, baselineSkipped };
  });
  if (snapshot() !== before) errors.push('markers did not restore the layout');
  return { container: rect(origin), lines, leaves, elements, errors };
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

async function captureFamily(browsers: Map<number, Awaited<ReturnType<typeof launchChrome>>>, fam: Family): Promise<unknown> {
  const cases: Record<string, unknown> = {};
  for (const c of fam.cases) {
    const results: Record<string, unknown> = {};
    for (const dpr of DPRS) {
      for (const dir of DIRS) {
        const page = await openPage(browsers.get(dpr)!, docFor(c), { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, direction: dir, rootFont: 'ahem' });
        const m = await page.evaluate(measure, [...COMPUTED]);
        if (m.errors.length > 0) throw new Error(`${c.id} dpr ${dpr} ${dir}: ${m.errors.join('; ')}`);
        const entry: Record<string, unknown> = { container: m.container, lines: m.lines, leaves: m.leaves, elements: m.elements };
        if (c.samples) {
          const box = await page.locator('#c').boundingBox();
          const png = decodePng(await page.screenshot({ fullPage: true }));
          entry.samples = Object.fromEntries(c.samples.map((s) => {
            const x = Math.floor((box!.x + (dir === 'rtl' ? box!.width - s.x : s.x)) * dpr);
            const y = Math.floor((box!.y + s.y) * dpr);
            const i = (y * png.width + x) * png.channels;
            const rgb = `rgb(${png.data[i]},${png.data[i + 1]},${png.data[i + 2]})`;
            if (rgb === 'rgb(255,255,255)') throw new Error(`${c.id} dpr ${dpr} ${dir}: sample ${s.name} reads the page background`);
            return [s.name, rgb];
          }));
        }
        results[`dpr${dpr}-${dir}`] = entry;
        await page.context().close();
      }
    }
    cases[c.id] = { note: c.note, width: c.width, style: c.style ?? '', html: c.html, ...(c.samples ? { samplePoints: c.samples } : {}), results };
  }
  return { chrome: CHROME_VERSION, playwright: PLAYWRIGHT_VERSION, family: fam.id, title: fam.title, font: 'Ahem', dprs: DPRS, directions: DIRS, units: 'CSS px relative to the container border box; line baseline relative to the line top', cases };
}

const check = process.argv.includes('--check');
const browsers = new Map<number, Awaited<ReturnType<typeof launchChrome>>>();
let failed = false;
try {
  for (const dpr of DPRS) browsers.set(dpr, await launchChrome(dpr));
  if (!check) mkdirSync(repoPath(OUT_DIR), { recursive: true });
  for (const fam of FAMILIES) {
    const text = `${JSON.stringify(await captureFamily(browsers, fam), null, 1)}\n`;
    const file = repoPath(`${OUT_DIR}/${fam.id}.json`);
    if (check) {
      const same = existsSync(file) && readFileSync(file, 'utf8') === text;
      console.log(`${same ? 'same' : 'DIFFERS'} ${OUT_DIR}/${fam.id}.json (${fam.cases.length} cases)`);
      if (!same) failed = true;
    } else {
      writeFileSync(file, text);
      console.log(`wrote ${OUT_DIR}/${fam.id}.json (${fam.cases.length} cases x ${DPRS.length * DIRS.length} environments)`);
    }
  }
} finally {
  for (const b of browsers.values()) await b.close();
}
if (failed) {
  console.error('capture-inline-probe --check: the committed corpus differs from a fresh capture');
  process.exit(1);
}
