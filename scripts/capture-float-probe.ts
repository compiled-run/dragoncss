// FLT-P: the float probe corpus. Measures Chrome 145.0.7632.6 float layout over Ahem-only cases at DPR 1, 2, 3 and 2.625, in ltr
// and rtl, and in horizontal-tb, vertical-rl and vertical-lr, and writes docs/research/float-spike/probe/<family>.json. Per case it
// records the border box of every labelled element (getBoundingClientRect, plus getClientRects for inline boxes), per-line rects
// (the union of the Ahem glyph rects of each line, per block container), and computed float, clear and display. Each case also
// lists the environments whose line-relative geometry differs from horizontal-tb (same DPR and direction) or from DPR 1.
// Run with: node --conditions=dragon-internal scripts/capture-float-probe.ts [--check]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';

type Case = {
  readonly id: string;
  readonly note: string;
  /** The container's inline-size in CSS px. */
  readonly width: number;
  /** Declarations appended to the container's style (font-size is 10px, line-height normal, display flow-root). */
  readonly style?: string;
  readonly html: string;
};
type Family = { readonly id: string; readonly title: string; readonly computed: readonly string[]; readonly cases: readonly Case[] };

const DPRS = [1, 2, 3, 2.625] as const;
const DIRS = ['ltr', 'rtl'] as const;
const MODES = ['horizontal-tb', 'vertical-rl', 'vertical-lr'] as const;
const OUT_DIR = 'docs/research/float-spike/probe';
const COMPUTED = ['float', 'clear', 'display'] as const;
const SHAPE_COMPUTED = [...COMPUTED, 'shape-outside', 'shape-margin', 'shape-image-threshold'] as const;

/** A float (or any block) sized in logical px; `extra` is appended to its style. */
const box = (p: string, fl: string, i: number | null, b: number | null, extra = '', content = ''): string =>
  `<div data-p="${p}" style="${fl === 'none' ? '' : `float:${fl};`}${i === null ? '' : `inline-size:${i}px;`}${b === null ? '' : `block-size:${b}px;`}${extra}">${content}</div>`;
const fl = (p: string, side: string, i: number, b: number, extra = ''): string => box(p, side, i, b, extra);
const blk = (p: string, b: number | null, extra = '', content = ''): string => box(p, 'none', null, b, extra, content);
const TEXT = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh';

// Family 1: placement and the top-edge rule.
const family1: Case[] = [
  { id: 'p-left', note: 'one left float 50x30', width: 200, html: fl('f', 'left', 50, 30) },
  { id: 'p-right', note: 'one right float 50x30', width: 200, html: fl('f', 'right', 50, 30) },
  { id: 'p-inline-start', note: 'float:inline-start resolves against the containing block direction', width: 200, html: fl('f', 'inline-start', 50, 30) },
  { id: 'p-inline-end', note: 'float:inline-end', width: 200, html: fl('f', 'inline-end', 50, 30) },
  { id: 'p-inline-start-own-rtl', note: 'float:inline-start with direction:rtl on the float itself: the containing block decides', width: 200, html: fl('f', 'inline-start', 50, 30, 'direction:rtl') },
  { id: 'p-inline-start-own-ltr', note: 'float:inline-start with direction:ltr on the float itself', width: 200, html: fl('f', 'inline-start', 50, 30, 'direction:ltr') },
  { id: 'p-left-row', note: 'three left floats 50x20 side by side', width: 200, html: fl('a', 'left', 50, 20) + fl('b', 'left', 50, 20) + fl('c', 'left', 50, 20) },
  { id: 'p-right-row', note: 'three right floats 50x20 side by side', width: 200, html: fl('a', 'right', 50, 20) + fl('b', 'right', 50, 20) + fl('c', 'right', 50, 20) },
  { id: 'p-left-wrap', note: 'three left floats 80x20: the third does not fit and goes below', width: 200, html: fl('a', 'left', 80, 20) + fl('b', 'left', 80, 20) + fl('c', 'left', 80, 20) },
  { id: 'p-left-wrap-step', note: 'left 80x40, left 80x20, left 80x20: the third lands at the second float bottom beside the first', width: 200, html: fl('a', 'left', 80, 40) + fl('b', 'left', 80, 20) + fl('c', 'left', 80, 20) },
  { id: 'p-right-then-left', note: 'right 100x30 then left 120x10: the left goes below the right', width: 200, html: fl('a', 'right', 100, 30) + fl('b', 'left', 120, 10) },
  { id: 'p-left-right-meet', note: 'left 100 and right 100 exactly fill 200', width: 200, html: fl('a', 'left', 100, 20) + fl('b', 'right', 100, 30) },
  { id: 'p-top-edge', note: 'left 150x40, right 30x10, left 100x10 (goes to 40), right 30x10 must not rise above 40', width: 200, html: fl('a', 'left', 150, 40) + fl('b', 'right', 30, 10) + fl('c', 'left', 100, 10) + fl('d', 'right', 30, 10) },
  { id: 'p-top-edge-gap', note: 'left 190x10, left 50x50 (goes to 10), right 5x5 fits at 0 but the top-edge rule holds it at 10', width: 200, html: fl('a', 'left', 190, 10) + fl('b', 'left', 50, 50) + fl('c', 'right', 5, 5) },
  { id: 'p-margins', note: 'left float 50x30 with 5px margins on every side, then a left float 20x20', width: 200, html: fl('a', 'left', 50, 30, 'margin:5px') + fl('b', 'left', 20, 20) },
  { id: 'p-margins-logical', note: 'margin-inline-start 7, margin-block-start 3 on a left float, then a right float with margin-inline-end 9', width: 200, html: fl('a', 'left', 50, 30, 'margin-inline-start:7px;margin-block-start:3px') + fl('b', 'right', 40, 20, 'margin-inline-end:9px') },
  { id: 'p-neg-margin-start', note: 'left float with margin-inline-start -10px', width: 200, html: fl('a', 'left', 50, 30, 'margin-inline-start:-10px') + fl('b', 'left', 20, 20) },
  { id: 'p-neg-margin-end', note: 'left float with margin-inline-end -20px, then a left float that overlaps it', width: 200, html: fl('a', 'left', 50, 30, 'margin-inline-end:-20px') + fl('b', 'left', 40, 20) },
  { id: 'p-neg-margin-overlap-all', note: 'left float whose margin box has zero inline size (margin-inline-end -50px)', width: 200, html: fl('a', 'left', 50, 30, 'margin-inline-end:-50px') + fl('b', 'left', 40, 20) },
  { id: 'p-neg-margin-block', note: 'left float with margin-block-start -8px after a 20px block', width: 200, html: blk('x', 20) + fl('a', 'left', 50, 30, 'margin-block-start:-8px') },
  { id: 'p-wider-than-cb', note: 'left float 250 wide in 200: placed at the start and overflows', width: 200, html: fl('a', 'left', 250, 20) },
  { id: 'p-wider-right', note: 'right float 250 wide in 200', width: 200, html: fl('a', 'right', 250, 20) },
  { id: 'p-wider-after-float', note: 'left 50x20, then left 250x10: goes below the first where the full width is free', width: 200, html: fl('a', 'left', 50, 20) + fl('b', 'left', 250, 10) },
  { id: 'p-auto-width', note: 'left float with auto width and text "aa bb": shrink-to-fit', width: 200, html: box('a', 'left', null, null, '', 'aa bb') },
  { id: 'p-auto-width-wrap', note: 'left float with auto width and long text: clamps to the available size', width: 100, html: box('a', 'left', null, null, '', 'aaaa bbbb cccc dddd') },
  { id: 'p-auto-width-beside', note: 'auto-width float after a 60px float: its available size is the full container, not the remainder', width: 150, html: fl('a', 'left', 60, 20) + box('b', 'left', null, null, '', 'aaaa bbbb cccc') },
  { id: 'p-percent', note: 'left floats at 33.3% width', width: 200, html: box('a', 'left', null, 10, 'inline-size:33.3%') + box('b', 'left', null, 10, 'inline-size:33.3%') + box('c', 'left', null, 10, 'inline-size:33.3%') },
  { id: 'p-fractional-fit', note: 'three 33.3px left floats in 100', width: 100, html: fl('a', 'left', 33.3, 10) + fl('b', 'left', 33.3, 10) + fl('c', 'left', 33.3, 10) },
  { id: 'p-fractional-overflow', note: 'four 25.1px left floats in 100: the fourth may wrap', width: 100, html: fl('a', 'left', 25.1, 10) + fl('b', 'left', 25.1, 10) + fl('c', 'left', 25.1, 10) + fl('d', 'left', 25.1, 10) },
  { id: 'p-fractional-exact', note: 'four 25px left floats in 100.01', width: 100.01, html: fl('a', 'left', 25, 10) + fl('b', 'left', 25, 10) + fl('c', 'left', 25, 10) + fl('d', 'left', 25, 10) },
  { id: 'p-fractional-sum', note: 'left 33.33 + left 33.33 + right 33.34 in 100', width: 100, html: fl('a', 'left', 33.33, 10) + fl('b', 'left', 33.33, 10) + fl('c', 'right', 33.34, 10) },
  { id: 'p-fractional-height', note: 'left 60x10.3, left 60x10.3, left 100x5: the third goes to the lower float bottom', width: 150, html: fl('a', 'left', 60, 10.3) + fl('b', 'left', 60, 10.7) + fl('c', 'left', 100, 5) },
  { id: 'p-after-block', note: 'float after a 20px block', width: 200, html: blk('x', 20) + fl('a', 'left', 50, 30) },
  { id: 'p-in-child-margin', note: 'float first in a child with margin-block-start 15 (the child margin collapses through the float)', width: 200, html: blk('p', null, 'margin-block-start:15px', fl('a', 'left', 50, 30) + 'aa') },
  { id: 'p-after-margin', note: 'float between a block with margin-block-end 20 and a block with margin-block-start 10', width: 200, html: blk('x', 10, 'margin-block-end:20px') + fl('a', 'left', 50, 30) + blk('y', 10, 'margin-block-start:10px') },
  { id: 'p-text-fits', note: 'float after "aa " on the line fits: placed on the current line', width: 200, html: `aa ${fl('a', 'left', 30, 30)}bb cc` },
  { id: 'p-text-fits-right', note: 'right float after "aa " on the line', width: 200, html: `aa ${fl('a', 'right', 30, 30)}bb cc` },
  { id: 'p-text-nofit', note: 'float 120 after 140px of text in 200: pushed below the line', width: 200, html: `aaaa bbbb cccc ${fl('a', 'left', 120, 20)}dd` },
  { id: 'p-text-nofit-trailing-space', note: 'float that fits only once the trailing space is excluded', width: 200, html: `aaaa bbbb ${fl('a', 'left', 110, 20)}cc` },
  { id: 'p-text-exact', note: 'float that exactly fills the rest of the line', width: 200, html: `aaaa bbbb${fl('a', 'left', 110, 20)} cc` },
  { id: 'p-text-ancestor-end', note: 'float inside a span with padding-inline-end 50: the padding counts toward the float fit', width: 200, html: `<span data-p="s" style="padding-inline-end:50px">aaaa bbbb ${fl('a', 'left', 60, 20)}</span> cc` },
  { id: 'p-text-second-pending', note: 'two floats in one line: the first is pushed after the line, so the second is too', width: 200, html: `aaaa bbbb cccc ${fl('a', 'left', 120, 20)}${fl('b', 'right', 10, 10)}dd` },
  { id: 'p-text-leading', note: 'float before any text on the line', width: 200, html: `${fl('a', 'left', 30, 25)}aa bb cc` },
  { id: 'p-text-second-line', note: 'float in the second line of a paragraph', width: 60, html: `aaa bbb ccc ${fl('a', 'right', 20, 20)}ddd eee fff` },
  { id: 'p-clear-self', note: 'right float with clear:right after two right floats', width: 200, html: fl('a', 'right', 50, 20) + fl('b', 'right', 50, 30) + fl('c', 'right', 50, 10, 'clear:right') },
  { id: 'p-clear-self-left', note: 'right float with clear:left after a left float', width: 200, html: fl('a', 'left', 50, 20) + fl('b', 'right', 50, 10, 'clear:left') },
  {
    id: 'p-computed-display', note: 'computed display of floated inline, inline-block, inline-flex, inline-grid, inline-table, list-item, table-cell, contents', width: 300,
    html: `<span data-p="i" style="float:left">a</span><span data-p="ib" style="float:left;display:inline-block">b</span><span data-p="if" style="float:left;display:inline-flex">c</span><span data-p="ig" style="float:left;display:inline-grid">d</span><span data-p="it" style="float:left;display:inline-table">e</span><span data-p="li" style="float:left;display:list-item">f</span><span data-p="tc" style="float:left;display:table-cell">g</span><span data-p="dc" style="float:left;display:contents">h</span>`,
  },
  {
    id: 'p-computed-none', note: 'computed float of absolute, fixed, flex item and grid item', width: 200,
    html: `${fl('abs', 'left', 10, 10, 'position:absolute')}${fl('fix', 'left', 10, 10, 'position:fixed')}<div data-p="flex" style="display:flex">${fl('fi', 'left', 10, 10)}</div><div data-p="grid" style="display:grid">${fl('gi', 'left', 10, 10)}</div>`,
  },
  { id: 'p-relative', note: 'position:relative float offset by inset-inline-start 5', width: 200, html: fl('a', 'left', 50, 30, 'position:relative;inset-inline-start:5px;inset-block-start:4px') + fl('b', 'left', 20, 20) },
  { id: 'p-orthogonal', note: 'float with the other writing mode: its size in the container axes', width: 200, html: box('a', 'left', null, null, 'writing-mode:vertical-rl;width:30px;height:40px') + box('b', 'left', null, null, 'writing-mode:horizontal-tb;width:30px;height:40px') },
];

// Family 2: clearance.
const TWO = fl('l', 'left', 50, 30) + fl('r', 'right', 60, 50);
const family2: Case[] = [
  ...['none', 'left', 'right', 'both', 'inline-start', 'inline-end'].map((c): Case => ({
    id: `c-${c}`, note: `left 50x30 and right 60x50, then a 10px block with clear:${c}`, width: 200, html: TWO + blk('x', 10, `clear:${c}`, 'aa'),
  })),
  ...['left', 'right', 'both', 'inline-start', 'inline-end'].map((c): Case => ({
    id: `c-text-${c}`, note: `left 50x30 and right 60x50, then an auto-height block of text with clear:${c}`, width: 200, html: TWO + box('x', 'none', null, null, `clear:${c}`, 'aa bb'),
  })),
  { id: 'c-margin-less', note: 'cleared block with margin-block-start 10 < float height 30: clearance', width: 200, html: fl('l', 'left', 50, 30) + blk('x', 10, 'clear:left;margin-block-start:10px') },
  { id: 'c-margin-more', note: 'cleared block with margin-block-start 50 > float height 30: no clearance', width: 200, html: fl('l', 'left', 50, 30) + blk('x', 10, 'clear:left;margin-block-start:50px') },
  { id: 'c-margin-equal', note: 'cleared block with margin-block-start exactly the float height', width: 200, html: fl('l', 'left', 50, 30) + blk('x', 10, 'clear:left;margin-block-start:30px') },
  { id: 'c-prev-margin', note: 'block with margin-block-end 20, float 40, cleared block with margin-block-start 10', width: 200, html: blk('p', 10, 'margin-block-end:20px') + fl('l', 'left', 50, 40) + blk('x', 10, 'clear:left;margin-block-start:10px') },
  { id: 'c-prev-margin-big', note: 'block with margin-block-end 40, float 10, cleared block: the hypothetical position is already past the float', width: 200, html: blk('p', 10, 'margin-block-end:40px') + fl('l', 'left', 50, 10) + blk('x', 10, 'clear:left') },
  { id: 'c-negative-clearance', note: 'block margin-block-end 30, float 10, cleared block margin-block-start 30', width: 200, html: blk('p', 10, 'margin-block-end:30px') + fl('l', 'left', 50, 10) + blk('x', 10, 'clear:left;margin-block-start:30px') },
  { id: 'c-after-margin', note: 'cleared block with margin-block-end 15 followed by a block', width: 200, html: fl('l', 'left', 50, 30) + blk('x', 10, 'clear:left;margin-block-end:15px') + blk('y', 10, 'margin-block-start:5px') },
  { id: 'c-nested', note: 'clear on a grandchild whose parent has no border: clearance applies through margin collapsing', width: 200, html: fl('l', 'left', 50, 40) + box('p', 'none', null, null, 'margin-block-start:10px', blk('x', 10, 'clear:left;margin-block-start:5px')) },
  { id: 'c-nested-border', note: 'clear on a grandchild inside a bordered parent', width: 200, html: fl('l', 'left', 50, 40) + box('p', 'none', null, null, 'border-block-start:2px solid', blk('x', 10, 'clear:left')) },
  { id: 'c-self-collapsing', note: 'empty block with clear:both, then text', width: 200, html: TWO + blk('x', 0, 'clear:both') + 'aa bb' },
  { id: 'c-self-collapsing-margins', note: 'empty block with clear:left and margins 5/7, then a block with margin-block-start 3', width: 200, html: fl('l', 'left', 50, 30) + box('x', 'none', null, null, 'clear:left;margin-block:5px 7px') + blk('y', 10, 'margin-block-start:3px') },
  { id: 'c-br-all', note: '<br clear=all> in text beside two floats', width: 200, html: `${TWO}aa<br data-p="br" clear="all">bb` },
  { id: 'c-br-left', note: '<br clear=left>', width: 200, html: `${TWO}aa<br data-p="br" clear="left">bb` },
  { id: 'c-br-style', note: '<br style="clear:right">', width: 200, html: `${TWO}aa<br data-p="br" style="clear:right">bb` },
  { id: 'c-bfc', note: 'clear:left on a flow-root', width: 200, html: fl('l', 'left', 50, 30) + blk('x', 10, 'display:flow-root;clear:left') },
  { id: 'c-float-in-sibling-bfc', note: 'a float inside a sibling flow-root does not affect clear outside it', width: 200, html: box('p', 'none', null, null, 'display:flow-root', fl('l', 'left', 50, 30)) + blk('x', 10, 'clear:left') },
  { id: 'c-float-in-child', note: 'a float inside a normal child still affects a later cleared sibling', width: 200, html: box('p', 'none', null, null, '', fl('l', 'left', 50, 30) + 'aa') + blk('x', 10, 'clear:left') },
  { id: 'c-fractional', note: 'float 30.3px, cleared block', width: 200, html: fl('l', 'left', 50, 30.3) + blk('x', 10, 'clear:left') + blk('y', 10) },
  { id: 'c-fractional-margin', note: 'float 17.7px after a 5.2px block, cleared block with margin 3.3', width: 200, html: blk('p', 5.2) + fl('l', 'left', 50, 17.7) + blk('x', 10, 'clear:left;margin-block-start:3.3px') },
  { id: 'c-neg-margin-float', note: 'float with margin-block-end -10: clearance uses the margin box bottom', width: 200, html: fl('l', 'left', 50, 30, 'margin-block-end:-10px') + blk('x', 10, 'clear:left') },
  { id: 'c-computed', note: 'computed clear of a float, an inline span and an abspos box', width: 200, html: fl('f', 'left', 10, 10, 'clear:both') + `<span data-p="s" style="clear:left">a</span>` + fl('abs', 'none', 10, 10, 'position:absolute;clear:right') },
];

// Family 3: block formatting context roots beside floats.
const F50 = fl('f', 'left', 50, 40);
const family3: Case[] = [
  ...[['flow-root', 'display:flow-root'], ['overflow', 'overflow:hidden'], ['flex', 'display:flex'], ['grid', 'display:grid'], ['table', 'display:table'], ['contain', 'contain:paint'], ['multicol', 'column-count:1']].map(([id, css]): Case => ({
    id: `b-${id}`, note: `left float 50x40, then an auto-width ${css} holding text`, width: 200, html: F50 + box('b', 'none', null, null, css!, 'aa bb cc'),
  })),
  { id: 'b-plain-block', note: 'a plain block (not a BFC) beside the float: full width, text wraps around', width: 200, html: F50 + box('b', 'none', null, null, '', 'aa bb cc') },
  { id: 'b-right', note: 'right float 50x40, then an auto-width flow-root', width: 200, html: fl('f', 'right', 50, 40) + box('b', 'none', null, 20, 'display:flow-root') },
  { id: 'b-both', note: 'left 50 and right 30 floats, then an auto-width flow-root', width: 200, html: F50 + fl('g', 'right', 30, 20) + box('b', 'none', null, 30, 'display:flow-root') },
  { id: 'b-fixed-fits', note: 'flow-root 100 wide beside a 50 float in 200', width: 200, html: F50 + box('b', 'none', 100, 20, 'display:flow-root') },
  { id: 'b-fixed-exact', note: 'flow-root 150 wide beside a 50 float in 200', width: 200, html: F50 + box('b', 'none', 150, 20, 'display:flow-root') },
  { id: 'b-fixed-nofit', note: 'flow-root 180 wide: moved below the float', width: 200, html: F50 + box('b', 'none', 180, 20, 'display:flow-root') },
  { id: 'b-fixed-fractional', note: 'flow-root 150.01 wide beside a 50 float in 200', width: 200, html: F50 + box('b', 'none', 150.01, 20, 'display:flow-root') },
  { id: 'b-min-content-wide', note: 'auto-width flow-root whose word is wider than the opportunity stays beside and overflows', width: 200, html: F50 + box('b', 'none', null, null, 'display:flow-root', 'aaaaaaaaaaaaaaaa') },
  { id: 'b-table-wide', note: 'auto-width table whose min-content is wider than the opportunity moves below', width: 200, html: F50 + box('b', 'none', null, null, 'display:table', 'aaaaaaaaaaaaaaaa') },
  { id: 'b-margin-start-small', note: 'flow-root margin-inline-start 30 beside a 50 float: the margin overlaps the float', width: 200, html: F50 + box('b', 'none', null, 20, 'display:flow-root;margin-inline-start:30px') },
  { id: 'b-margin-start-big', note: 'flow-root margin-inline-start 70 beside a 50 float', width: 200, html: F50 + box('b', 'none', null, 20, 'display:flow-root;margin-inline-start:70px') },
  { id: 'b-margin-end', note: 'flow-root margin-inline-end 30 beside a right 50 float', width: 200, html: fl('f', 'right', 50, 40) + box('b', 'none', null, 20, 'display:flow-root;margin-inline-end:30px') },
  { id: 'b-margin-neg', note: 'flow-root margin-inline-start -20 beside a left 50 float', width: 200, html: F50 + box('b', 'none', null, 20, 'display:flow-root;margin-inline-start:-20px') },
  { id: 'b-auto-margins', note: 'flow-root 60 wide with auto inline margins beside a 50 float', width: 200, html: F50 + box('b', 'none', 60, 20, 'display:flow-root;margin-inline:auto') },
  { id: 'b-auto-margin-start', note: 'flow-root 60 wide with margin-inline-start auto', width: 200, html: F50 + box('b', 'none', 60, 20, 'display:flow-root;margin-inline-start:auto') },
  { id: 'b-stair', note: 'left 50x20 and left 100x40, then flow-root 80 wide: goes to the second float bottom', width: 200, html: fl('a', 'left', 50, 20) + fl('c', 'left', 100, 40) + box('b', 'none', 80, 10, 'display:flow-root') },
  { id: 'b-closed-short', note: 'a closed-off area 20 tall beside two floats: a 30-tall flow-root skips it', width: 200, html: fl('a', 'left', 150, 20) + fl('c', 'left', 160, 20) + box('b', 'none', 40, 30, 'display:flow-root') },
  { id: 'b-closed-fits', note: 'the same closed-off area: a 15-tall flow-root fits in it', width: 200, html: fl('a', 'left', 150, 20) + fl('c', 'left', 160, 20) + box('b', 'none', 40, 15, 'display:flow-root') },
  { id: 'b-clear', note: 'flow-root with clear:left beside a left float', width: 200, html: F50 + box('b', 'none', null, 20, 'display:flow-root;clear:left') },
  { id: 'b-margin-adjoining', note: 'float in a child, then a flow-root 180 wide with margin-block-start 20: it does not fit, so its margin stops collapsing', width: 200, html: box('p', 'none', null, null, '', F50 + box('b', 'none', 180, 10, 'display:flow-root;margin-block-start:20px')) },
  { id: 'b-margin-adjoining-fits', note: 'float in a child, then a flow-root 100 wide with margin-block-start 20', width: 200, html: box('p', 'none', null, null, '', F50 + box('b', 'none', 100, 10, 'display:flow-root;margin-block-start:20px')) },
  { id: 'b-percent', note: 'flow-root inline-size 50% beside a 50 float', width: 200, html: F50 + box('b', 'none', null, 10, 'display:flow-root;inline-size:50%') },
  { id: 'b-fractional-float', note: 'left float 50.3 wide, auto-width flow-root', width: 200, html: fl('f', 'left', 50.3, 40) + box('b', 'none', null, 20, 'display:flow-root') },
  { id: 'b-hr', note: 'an <hr> (not a BFC) and an overflow:hidden <hr> beside a float', width: 200, html: F50 + '<hr data-p="h1" style="margin:0;border:2px solid"><hr data-p="h2" style="margin:0;border:2px solid;overflow:hidden">' },
];

// Family 4: line opportunities with Ahem.
const family4: Case[] = [
  { id: 'l-left', note: 'left float 50x25, text in 150', width: 150, html: fl('f', 'left', 50, 25) + TEXT },
  { id: 'l-right', note: 'right float 50x25, text in 150', width: 150, html: fl('f', 'right', 50, 25) + TEXT },
  { id: 'l-both', note: 'left 30x15 and right 40x35, text in 150', width: 150, html: fl('f', 'left', 30, 15) + fl('g', 'right', 40, 35) + TEXT },
  { id: 'l-left-end', note: 'left float, text-align:end (shows the opportunity end edge)', width: 150, style: 'text-align:end', html: fl('f', 'left', 50, 25) + TEXT },
  { id: 'l-right-end', note: 'right float, text-align:end', width: 150, style: 'text-align:end', html: fl('f', 'right', 50, 25) + TEXT },
  { id: 'l-both-center', note: 'left and right floats, text-align:center', width: 150, style: 'text-align:center', html: fl('f', 'left', 30, 15) + fl('g', 'right', 40, 35) + TEXT },
  { id: 'l-justify', note: 'left float, text-align:justify', width: 150, style: 'text-align:justify', html: fl('f', 'left', 50, 25) + TEXT },
  { id: 'l-word-too-wide', note: 'a 120px word beside a 50x30 float in 150: moves below the float', width: 150, html: fl('f', 'left', 50, 30) + 'aaaaaaaaaaaa bb' },
  { id: 'l-word-too-wide-both', note: 'left 80 and right 80 in 200: a 50px word skips the 40px gap', width: 200, html: fl('f', 'left', 80, 20) + fl('g', 'right', 80, 35) + 'aaaaa bb' },
  { id: 'l-word-too-wide-last', note: 'a word wider than the container beside a float goes below and overflows', width: 100, html: fl('f', 'left', 30, 20) + 'aaaaaaaaaaaaaa' },
  { id: 'l-atomic-too-wide', note: 'a 120px inline-block beside a 50 float in 150', width: 150, html: fl('f', 'left', 50, 30) + `aa <span data-p="ib" style="display:inline-block;inline-size:120px;block-size:10px"></span>` },
  { id: 'l-nowrap', note: 'nowrap text beside a float overflows the opportunity', width: 150, style: 'white-space:nowrap', html: fl('f', 'left', 50, 30) + 'aaaa bbbb cccc' },
  { id: 'l-pre-wrap', note: 'pre-wrap text with trailing spaces beside a right float', width: 150, style: 'white-space:pre-wrap', html: fl('f', 'right', 50, 30) + 'aaaa    bbbb    cccc' },
  { id: 'l-indent', note: 'text-indent 20 beside a left float', width: 150, style: 'text-indent:20px', html: fl('f', 'left', 50, 25) + TEXT },
  { id: 'l-indent-negative', note: 'text-indent -20 beside a left float', width: 150, style: 'text-indent:-20px', html: fl('f', 'left', 50, 25) + TEXT },
  { id: 'l-tall-lines', note: 'line-height 25px beside a 30px float', width: 150, style: 'line-height:25px', html: fl('f', 'left', 50, 30) + TEXT },
  { id: 'l-odd-leading-alone', note: 'line-height 25px, the float alone in a block child (no line box around it)', width: 150, style: 'line-height:25px', html: box('p', 'none', null, null, '', fl('f', 'left', 50, 30)) + TEXT },
  { id: 'l-odd-leading-23', note: 'line-height 23px beside a 30px float', width: 150, style: 'line-height:23px', html: fl('f', 'left', 50, 30) + TEXT },
  { id: 'l-even-leading-24', note: 'line-height 24px beside a 30px float', width: 150, style: 'line-height:24px', html: fl('f', 'left', 50, 30) + TEXT },
  { id: 'l-big-span', note: 'a 20px span makes the first line taller beside a float', width: 150, html: fl('f', 'left', 50, 25) + `aa <span data-p="s" style="font-size:20px">BB</span> cc dddd eeee ffff` },
  ...[['19p99', 19.99], ['20', 20], ['20p01', 20.01], ['20p02', 20.02], ['20p5', 20.5], ['25p3', 25.3]].map(([id, h]): Case => ({
    id: `l-edge-${id}`, note: `left float 50 x ${h}: does the third line (20..30) sit beside it`, width: 150, html: fl('f', 'left', 50, h as number) + TEXT,
  })),
  ...[['49p99', 49.99], ['50p01', 50.01], ['50p5', 50.5]].map(([id, w]): Case => ({
    id: `l-width-${id}`, note: `left float ${w} wide: line start and the fit of a 100px word in 150`, width: 150, html: fl('f', 'left', w as number, 25) + 'aaaaaaaaaa b',
  })),
  { id: 'l-mid-paragraph', note: 'a left float after the fourth word', width: 150, html: `aaaa bbbb cccc dddd ${fl('f', 'left', 40, 25)}eeee ffff gggg hhhh` },
  { id: 'l-sibling-block', note: 'a sibling block (not a BFC) wraps its lines around the float', width: 150, html: fl('f', 'left', 50, 35) + box('b', 'none', null, null, '', TEXT) },
  { id: 'l-sibling-padding', note: 'the sibling has padding-inline-start 20: lines start at the float edge, not float edge + 20', width: 150, html: fl('f', 'left', 50, 35) + box('b', 'none', null, null, 'padding-inline-start:20px', TEXT) },
  { id: 'l-sibling-margin', note: 'the sibling has margin-inline-start 70 > the float width', width: 150, html: fl('f', 'left', 50, 35) + box('b', 'none', null, null, 'margin-inline-start:70px', 'aaaa bbbb cccc') },
  { id: 'l-stair', note: 'three stacked left floats of decreasing width', width: 150, html: fl('f', 'left', 80, 12) + fl('g', 'left', 50, 12, 'clear:left') + fl('h', 'left', 20, 12, 'clear:left') + TEXT },
  { id: 'l-zero-block', note: 'a float with block-size 0 and a second 50x20 float', width: 150, html: fl('f', 'left', 50, 0) + fl('g', 'right', 50, 20) + TEXT },
  { id: 'l-zero-inline', note: 'a float with inline-size 0 and block-size 30, then a right float', width: 150, html: fl('f', 'left', 0, 30) + fl('g', 'right', 5, 5) + TEXT },
  { id: 'l-br-lines', note: 'forced breaks beside a float', width: 150, html: `${fl('f', 'left', 50, 25)}aa<br>bb<br><br>cc` },
  { id: 'l-float-in-span', note: 'a float inside a decorated span', width: 150, html: `<span data-p="s" style="border-inline-start:3px solid;padding-inline:4px">aa ${fl('f', 'right', 40, 20)}bb cc dd</span>` },
  { id: 'l-many', note: 'alternating left and right floats in the text', width: 150, html: `aa ${fl('f', 'left', 20, 15)}bb cc ${fl('g', 'right', 30, 25)}dd ee ff ${fl('h', 'left', 25, 10)}gg hh ii jj kk` },
];

// Family 5: container height.
const family5: Case[] = [
  { id: 'h-root', note: 'the flow-root container grows to a 50x80 float', width: 200, html: fl('f', 'left', 50, 80) + 'aa' },
  { id: 'h-plain-child', note: 'a plain child does not grow to its float', width: 200, html: box('p', 'none', null, null, '', fl('f', 'left', 50, 80) + 'aa') },
  { id: 'h-empty-child', note: 'a child holding only a float has height 0; later text wraps around the float', width: 200, html: box('p', 'none', null, null, '', fl('f', 'left', 50, 40)) + 'aa bb' },
  ...[['flow-root', 'display:flow-root'], ['overflow', 'overflow:hidden'], ['inline-block', 'display:inline-block'], ['abspos', 'position:absolute'], ['float', 'float:left'], ['table-cell', 'display:table-cell'], ['flex-item', '']].map(([id, css]): Case => ({
    id: `h-${id}`, note: `a ${id} child grows to its float`, width: 200,
    html: id === 'flex-item'
      ? `<div data-p="flex" style="display:flex">${box('p', 'none', null, null, '', fl('f', 'left', 50, 80) + 'aa')}</div>`
      : box('p', 'none', null, null, css!, fl('f', 'left', 50, 80) + 'aa'),
  })),
  { id: 'h-float-margin', note: 'float with margin-block-end 15: the container includes the margin', width: 200, html: fl('f', 'left', 50, 30, 'margin-block-end:15px') },
  { id: 'h-float-neg-margin', note: 'float with margin-block-end -12', width: 200, html: fl('f', 'left', 50, 30, 'margin-block-end:-12px') + 'aa' },
  { id: 'h-float-neg-margin-all', note: 'float with margin-block-end -40 (margin box below zero)', width: 200, html: fl('f', 'left', 50, 30, 'margin-block-end:-40px') },
  { id: 'h-fractional', note: 'floats 30.3 and 30.7 tall', width: 200, html: fl('f', 'left', 50, 30.3) + fl('g', 'right', 50, 30.7) },
  { id: 'h-min-block', note: 'flow-root child with min-block-size 20 and a 50-tall float', width: 200, html: box('p', 'none', null, null, 'display:flow-root;min-block-size:20px', fl('f', 'left', 50, 50)) },
  { id: 'h-max-block', note: 'flow-root child with max-block-size 20 and a 50-tall float', width: 200, html: box('p', 'none', null, null, 'display:flow-root;max-block-size:20px', fl('f', 'left', 50, 50)) + blk('y', 10) },
  { id: 'h-clearfix-div', note: 'a plain child with a trailing clear:both div grows past its float', width: 200, html: box('p', 'none', null, null, '', fl('f', 'left', 50, 40) + 'aa' + blk('x', 0, 'clear:both')) },
  { id: 'h-clearfix-margin', note: 'the trailing clear div has margin-block-start 10', width: 200, html: box('p', 'none', null, null, '', fl('f', 'left', 50, 40) + 'aa' + blk('x', 0, 'clear:both;margin-block-start:10px')) },
  { id: 'h-inline-block-width', note: 'shrink-to-fit inline-block holding a 60 float and "aa bb"', width: 200, html: box('p', 'none', null, null, 'display:inline-block', fl('f', 'left', 60, 20) + 'aa bb') },
  { id: 'h-min-content', note: 'min-content width of a flow-root holding a 60 float and "aa bb"', width: 200, html: box('p', 'none', null, null, 'display:flow-root;inline-size:min-content', fl('f', 'left', 60, 20) + 'aa bb') },
  { id: 'h-max-content', note: 'max-content width of a flow-root holding left 60, right 40 and "aa bb"', width: 300, html: box('p', 'none', null, null, 'display:flow-root;inline-size:max-content', fl('f', 'left', 60, 20) + fl('g', 'right', 40, 20) + 'aa bb') },
  { id: 'h-max-content-cleared', note: 'max-content width with cleared floats: the widest row, not the sum', width: 300, html: box('p', 'none', null, null, 'display:flow-root;inline-size:max-content', fl('f', 'left', 60, 20) + fl('g', 'left', 40, 20, 'clear:left') + fl('h', 'right', 30, 10)) },
  { id: 'h-max-content-block', note: 'max-content width: a float then a block child with text', width: 300, html: box('p', 'none', null, null, 'display:flow-root;inline-size:max-content', fl('f', 'left', 60, 20) + box('b', 'none', null, null, '', 'aaaa')) },
  { id: 'h-max-content-bfc-child', note: 'max-content width: a float then a flow-root child with text', width: 300, html: box('p', 'none', null, null, 'display:flow-root;inline-size:max-content', fl('f', 'left', 60, 20) + box('b', 'none', null, null, 'display:flow-root', 'aaaa')) },
  { id: 'h-float-auto-in-inline-block', note: 'a shrink-to-fit float inside a shrink-to-fit inline-block', width: 200, html: box('p', 'none', null, null, 'display:inline-block', box('f', 'left', null, null, '', 'aa bb') + 'cc') },
];

// Family 6: shape-outside basic shapes. Image shapes (url(), gradients, shape-image-threshold) are listed in the notes only.
const SHAPE_TEXT = 'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv ww xx yy zz AA BB CC DD EE FF GG HH II JJ KK LL MM NN OO PP QQ RR SS TT UU VV WW XX YY ZZ';
const shape = (id: string, note: string, side: 'left' | 'right', css: string, width = 150, text = SHAPE_TEXT, size: [number, number] = [100, 100]): Case => ({
  id, note, width, html: fl('f', side, size[0], size[1], css) + text,
});
const family6: Case[] = [
  shape('s-circle', 'circle(50%) on a left 100x100 float', 'left', 'shape-outside:circle(50%)'),
  shape('s-circle-right', 'circle(50%) on a right float', 'right', 'shape-outside:circle(50%)'),
  shape('s-circle-margin', 'circle(50%) with shape-margin 10px', 'left', 'shape-outside:circle(50%);shape-margin:10px'),
  shape('s-circle-margin-box', 'circle(50%) with 10px float margins (reference box margin-box)', 'left', 'shape-outside:circle(50%);margin:10px'),
  shape('s-circle-pos', 'circle(40px at 30% 60%)', 'left', 'shape-outside:circle(40px at 30% 60%)'),
  shape('s-circle-closest', 'circle(closest-side at 20% 50%)', 'left', 'shape-outside:circle(closest-side at 20% 50%)'),
  shape('s-circle-farthest', 'circle(farthest-side at 20% 50%)', 'left', 'shape-outside:circle(farthest-side at 20% 50%)'),
  shape('s-circle-too-big', 'circle(100px): clamped to the float margin box', 'left', 'shape-outside:circle(100px)'),
  shape('s-circle-tall-lines', 'circle(50%) with line-height 20px', 'left', 'shape-outside:circle(50%);line-height:10px', 200, `<span data-p="s" style="line-height:20px">${SHAPE_TEXT}</span>`),
  shape('s-circle-word-steps', 'circle(50%) and a 130px word: the line steps down 1px at a time', 'left', 'shape-outside:circle(50%)', 200, 'aaaaaaaaaaaaa bb cc dd ee'),
  shape('s-ellipse', 'ellipse(50% 30%)', 'left', 'shape-outside:ellipse(50% 30%)'),
  shape('s-ellipse-pos', 'ellipse(30px 45px at 40% 40%) on a right float', 'right', 'shape-outside:ellipse(30px 45px at 40% 40%)'),
  shape('s-ellipse-sides', 'ellipse(closest-side farthest-side at 30% 70%)', 'left', 'shape-outside:ellipse(closest-side farthest-side at 30% 70%)'),
  shape('s-inset', 'inset(10px 20px 30px 5px)', 'left', 'shape-outside:inset(10px 20px 30px 5px)'),
  shape('s-inset-round', 'inset(10px round 30px)', 'left', 'shape-outside:inset(10px round 30px)'),
  shape('s-inset-round-right', 'inset(5px 10px round 20px 40px) on a right float', 'right', 'shape-outside:inset(5px 10px round 20px 40px)'),
  shape('s-polygon', 'polygon triangle (0 0, 100% 0, 0 100%)', 'left', 'shape-outside:polygon(0 0, 100% 0, 0 100%)'),
  shape('s-polygon-right', 'polygon triangle on a right float (100% 0, 100% 100%, 0 100%)', 'right', 'shape-outside:polygon(100% 0, 100% 100%, 0 100%)'),
  shape('s-polygon-notch', 'concave polygon (0 0, 100% 0, 30% 50%, 100% 100%, 0 100%)', 'left', 'shape-outside:polygon(0 0, 100% 0, 30% 50%, 100% 100%, 0 100%)'),
  shape('s-polygon-evenodd', 'self-intersecting polygon with evenodd', 'left', 'shape-outside:polygon(evenodd, 0 0, 100% 100%, 100% 0, 0 100%)'),
  shape('s-polygon-margin', 'polygon triangle with shape-margin 8px', 'left', 'shape-outside:polygon(0 0, 100% 0, 0 100%);shape-margin:8px'),
  shape('s-box-margin-radius', 'margin-box with border-radius 50% and margin 5px', 'left', 'shape-outside:margin-box;border-radius:50%;margin:5px'),
  shape('s-box-border', 'border-box with border-radius 40px, margin 10px, border 5px', 'left', 'shape-outside:border-box;border-radius:40px;margin:10px;border:5px solid'),
  shape('s-box-padding', 'padding-box with border 10px and border-radius 30px', 'left', 'shape-outside:padding-box;border:10px solid;border-radius:30px'),
  shape('s-box-content', 'content-box with border 5px, padding 10px and border-radius 30px', 'left', 'shape-outside:content-box;border:5px solid;padding:10px;border-radius:30px'),
  shape('s-circle-content-box', 'circle(50%) content-box with padding 10px', 'left', 'shape-outside:circle(50%) content-box;padding:10px'),
  shape('s-circle-border-box-margin', 'circle(50%) border-box with margin 15px', 'left', 'shape-outside:circle(50%) border-box;margin:15px'),
  shape('s-fractional', 'circle(33.3px at 45.5% 50%) on a 90.5 x 70.25 float', 'left', 'shape-outside:circle(33.3px at 45.5% 50%)', 200, SHAPE_TEXT, [90.5, 70.25]),
  shape('s-two-shapes', 'circle left and polygon right', 'left', 'shape-outside:circle(50%)', 200, `${fl('g', 'right', 60, 80, 'shape-outside:polygon(100% 0, 100% 100%, 0 50%)')}${SHAPE_TEXT}`),
  shape('s-bfc-ignores-shape', 'a flow-root beside a circle float avoids the float box, not the shape', 'left', 'shape-outside:circle(50%)', 200, box('b', 'none', null, 20, 'display:flow-root')),
  shape('s-next-float-ignores-shape', 'a second left float is placed against the float box, not the shape', 'left', 'shape-outside:circle(50%)', 200, fl('g', 'left', 30, 30)),
  { id: 's-not-float', note: 'shape-outside on a non-float has no effect', width: 150, html: blk('f', 30, 'shape-outside:circle(50%)') + SHAPE_TEXT },
];

const FAMILIES: readonly Family[] = [
  { id: 'family1-placement', title: 'Placement and the top-edge rule', computed: COMPUTED, cases: family1 },
  { id: 'family2-clearance', title: 'Clearance', computed: COMPUTED, cases: family2 },
  { id: 'family3-bfc', title: 'BFC roots beside floats', computed: COMPUTED, cases: family3 },
  { id: 'family4-lines', title: 'Line opportunities with Ahem', computed: COMPUTED, cases: family4 },
  { id: 'family5-height', title: 'Container height and intrinsic sizes', computed: COMPUTED, cases: family5 },
  { id: 'family6-shapes', title: 'shape-outside basic shapes', computed: SHAPE_COMPUTED, cases: family6 },
];

const docFor = (c: Case, mode: string): string =>
  `<!DOCTYPE html><html><head><style>body{margin:0}#c{font-size:10px;display:flow-root}</style></head><body><div id="c" style="writing-mode:${mode};inline-size:${c.width}px;${c.style ?? ''}">${c.html}</div></body></html>`;

type Rect = [number, number, number, number];
type Line = { rect: Rect; text: string };
type Measured = {
  container: Rect;
  elements: Record<string, { tag: string; box: Rect; rects?: Rect[]; computed: Record<string, string> }>;
  lines: Record<string, Line[]>;
};

/** Runs in the page: measures #c. Kept self-contained because Playwright serializes it. */
function measure(props: readonly string[]): Measured {
  const c = document.getElementById('c') as HTMLElement;
  const origin = c.getBoundingClientRect();
  const rect = (r: DOMRect): Rect => [r.left - origin.left, r.top - origin.top, r.width, r.height];
  const vertical = getComputedStyle(c).writingMode !== 'horizontal-tb';
  const labelOf = (e: Element): string => (e === c ? '#c' : ((e as HTMLElement).dataset.p ?? e.tagName.toLowerCase()));
  const elements: Measured['elements'] = {};
  for (const e of Array.from(c.querySelectorAll('[data-p]')) as HTMLElement[]) {
    const cs = getComputedStyle(e);
    const entry: Measured['elements'][string] = { tag: e.tagName.toLowerCase(), box: rect(e.getBoundingClientRect()), computed: Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])) };
    if (cs.display === 'inline' || e instanceof HTMLBRElement) entry.rects = Array.from(e.getClientRects()).map(rect);
    elements[e.dataset.p!] = entry;
  }
  // Lines: every rendered character, grouped per block container, then into lines by overlapping block-axis extents in DOM order.
  const lines: Measured['lines'] = {};
  const containerOf = (n: Node): Element => {
    for (let e = n.parentElement; e; e = e.parentElement) if (e === c || getComputedStyle(e).display !== 'inline') return e;
    return c;
  };
  const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  let current: { key: string; lo: number; hi: number; glyphs: DOMRect[]; text: string } | null = null;
  const flush = (): void => {
    if (!current) return;
    const g = current.glyphs;
    const l = Math.min(...g.map((r) => r.left)), t = Math.min(...g.map((r) => r.top));
    const r = Math.max(...g.map((q) => q.right)), b = Math.max(...g.map((q) => q.bottom));
    (lines[current.key] ??= []).push({ rect: [l - origin.left, t - origin.top, r - l, b - t], text: current.text });
    current = null;
  };
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n as Text;
    const key = labelOf(containerOf(t));
    for (let i = 0; i < t.data.length; i++) {
      const range = document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + 1);
      const rs = Array.from(range.getClientRects()).filter((q) => q.width > 0 && q.height > 0);
      if (rs.length === 0) continue;
      const q = rs[0]!;
      const lo = vertical ? q.left : q.top, hi = vertical ? q.right : q.bottom;
      const ch = t.data[i]!;
      const space = ch === ' ' || ch === '\t' || ch === '\n';
      // Glyphs of one line overlap by several px; 0.5 px absorbs the float noise between adjacent lines at fractional DPRs.
      if (current && current.key === key && lo < current.hi - 0.5 && hi > current.lo + 0.5) {
        current.text += ch;
        if (!space) {
          current.glyphs.push(q);
          current.lo = Math.min(current.lo, lo);
          current.hi = Math.max(current.hi, hi);
        }
        continue;
      }
      if (space) {
        if (current && current.key === key) current.text += ch;
        continue;
      }
      flush();
      current = { key, lo, hi, glyphs: [q], text: ch };
    }
  }
  flush();
  for (const ls of Object.values(lines)) for (const l of ls) l.text = l.text.trimEnd();
  return { container: rect(origin), elements, lines };
}

/** Physical rect (relative to the container) to line-relative [line-left offset, block-start offset, inline size, block size]. */
function lineRelative(r: Rect, cont: Rect, mode: string): Rect {
  const [x, y, w, h] = r;
  if (mode === 'horizontal-tb') return [x, y, w, h];
  return [y, mode === 'vertical-rl' ? cont[2] - x - w : x, h, w];
}

type Geometry = (string | number | Geometry)[];

/** The line-relative geometry of one environment (display:contents boxes, which have no box, are skipped). */
function geometry(m: Measured, mode: string): Geometry {
  const cont = m.container;
  const parts: Geometry = [mode === 'horizontal-tb' ? [cont[2], cont[3]] : [cont[3], cont[2]]];
  for (const [k, e] of Object.entries(m.elements)) {
    if (e.computed.display === 'contents') continue;
    parts.push([k, lineRelative(e.box, cont, mode), (e.rects ?? []).map((r) => lineRelative(r, cont, mode))]);
  }
  for (const [k, ls] of Object.entries(m.lines)) parts.push([k, ls.map((l) => [lineRelative(l.rect, cont, mode), l.text])]);
  return parts;
}

/** Equal up to 0.001 px: well under a device LayoutUnit at DPR 3 (1/192 px), above the float noise of subtracting page offsets. */
function same(a: Geometry | string | number, b: Geometry | string | number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-3;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]!));
  return a === b;
}

async function captureFamily(browsers: Map<number, Awaited<ReturnType<typeof launchChrome>>>, fam: Family): Promise<unknown> {
  const cases: Record<string, unknown> = {};
  for (const c of fam.cases) {
    // The four DPRs run concurrently, one browser each; results are assembled in a fixed order.
    const perDpr = await Promise.all(DPRS.map(async (dpr) => {
      const out: [string, string, string, Measured][] = [];
      for (const mode of MODES) {
        for (const dir of DIRS) {
          const page = await openPage(browsers.get(dpr)!, docFor(c, mode), { viewport: { width: 600, height: 600 }, devicePixelRatio: dpr, direction: dir, rootFont: 'ahem' });
          out.push([dir, mode, `dpr${dpr}-${dir}-${mode}`, await page.evaluate(measure, [...fam.computed])]);
          await page.context().close();
        }
      }
      return out;
    }));
    const results: Record<string, Measured> = {};
    const keys = new Map<string, Geometry>();
    for (const out of perDpr) for (const [dir, mode, env, m] of out) {
      results[env] = m;
      keys.set(env, geometry(m, mode));
    }
    // Where the line-relative geometry departs from horizontal-tb (same DPR and direction), and from DPR 1 (same direction and mode).
    const modeDivergent: string[] = [];
    const dprDivergent: string[] = [];
    for (const dpr of DPRS) for (const mode of MODES) for (const dir of DIRS) {
      const env = `dpr${dpr}-${dir}-${mode}`;
      if (mode !== 'horizontal-tb' && !same(keys.get(env)!, keys.get(`dpr${dpr}-${dir}-horizontal-tb`)!)) modeDivergent.push(env);
      if (dpr !== 1 && !same(keys.get(env)!, keys.get(`dpr1-${dir}-${mode}`)!)) dprDivergent.push(env);
    }
    cases[c.id] = { note: c.note, width: c.width, style: c.style ?? '', html: c.html, modeDivergent, dprDivergent, results };
  }
  return {
    chrome: CHROME_VERSION, playwright: PLAYWRIGHT_VERSION, family: fam.id, title: fam.title, font: 'Ahem', dprs: DPRS, directions: DIRS, writingModes: MODES,
    units: 'CSS px, physical, relative to the container border box; box is getBoundingClientRect (the border box); lines are unions of Ahem glyph rects per block container',
    cases,
  };
}

/** JSON with one key per line but every array of numbers kept on one line. */
function format(v: unknown): string {
  return JSON.stringify(v, null, 1).replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (_, body: string) => `[${body.replace(/\s+/g, '')}]`);
}

const check = process.argv.includes('--check');
const browsers = new Map<number, Awaited<ReturnType<typeof launchChrome>>>();
let failed = false;
try {
  for (const dpr of DPRS) browsers.set(dpr, await launchChrome(dpr));
  if (!check) mkdirSync(repoPath(OUT_DIR), { recursive: true });
  for (const fam of FAMILIES) {
    const text = `${format(await captureFamily(browsers, fam))}\n`;
    const file = repoPath(`${OUT_DIR}/${fam.id}.json`);
    if (check) {
      const same = existsSync(file) && readFileSync(file, 'utf8') === text;
      console.log(`${same ? 'same' : 'DIFFERS'} ${OUT_DIR}/${fam.id}.json (${fam.cases.length} cases)`);
      if (!same) failed = true;
    } else {
      writeFileSync(file, text);
      console.log(`wrote ${OUT_DIR}/${fam.id}.json (${fam.cases.length} cases x ${DPRS.length * DIRS.length * MODES.length} environments)`);
    }
  }
} finally {
  for (const b of browsers.values()) await b.close();
}
if (failed) {
  console.error('capture-float-probe --check: the committed corpus differs from a fresh capture');
  process.exit(1);
}
