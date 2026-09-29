// G-P: the grid probe corpus. Measures Chrome 145.0.7632.6 CSS grid layout over Ahem-only cases at DPR 1, 2, 3 and 2.625, in ltr
// and rtl, in horizontal-tb, vertical-rl and vertical-lr, and writes docs/research/grid-spike/probe/<family>.json.
// Each case is a grid container inside a fixed-size wrapper that carries the writing mode; the root carries the direction. Per
// environment it records the container border box (physical, relative to the wrapper border box), the computed
// grid-template-columns and grid-template-rows, and the physical border box of every labelled item (relative to the container
// border box). Identical results are stored once: `envs` lists the environments and each case maps them to `distinct` results.
// Run with: node --conditions=dragon-internal scripts/capture-grid-probe.ts [--check | --only=<family> | --plants]
// --plants checks the planted-fault and deviation pins against the committed corpus without launching Chrome.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';

/** A grid item: `s` is its style, `t` its Ahem text, `k` its children (labelled too, for subgrids). */
type Item = { readonly s?: string; readonly t?: string; readonly k?: readonly Item[] };
type Case = {
  readonly id: string;
  readonly note: string;
  /** The container's style; `display:grid` is prepended unless it sets display. Written with logical properties. */
  readonly style: string;
  readonly items: readonly Item[];
  /** The wrapper's logical inline and block size (default 400 x 300). */
  readonly cb?: readonly [number, number];
  /** Ahem text placed in the wrapper after the grid, so its position shows where the line box put an inline-level grid's baseline. */
  readonly after?: string;
};
type Family = { readonly id: string; readonly title: string; readonly cases: readonly Case[] };

const DPRS = [1, 2, 3, 2.625] as const;
const DIRS = ['ltr', 'rtl'] as const;
const WMS = ['horizontal-tb', 'vertical-rl', 'vertical-lr'] as const;
const ENVS = DPRS.flatMap((dpr) => DIRS.flatMap((dir) => WMS.map((wm) => ({ dpr, dir, wm, name: `dpr${dpr}-${dir}-${wm}` }))));
const OUT_DIR = 'docs/research/grid-spike/probe';
const RANDOM_CASES = 2000;
const RANDOM_SHARD = 250;

const X = (n: number): string => 'X'.repeat(n);
const box = (i: number | string, b: number | string, extra = ''): Item => ({ s: `inline-size:${typeof i === 'number' ? `${i}px` : i};block-size:${typeof b === 'number' ? `${b}px` : b};${extra}` });
const n = (count: number, f: (k: number) => Item): Item[] => Array.from({ length: count }, (_, k) => f(k));

// Family 1: placement.
const placement: Case[] = [
  { id: 'p-auto-row', note: 'row auto-placement into 3 fixed columns; implicit auto rows', style: 'grid-template-columns:20px 20px 20px', items: n(7, (k) => box(10 + k, 5 + k)) },
  { id: 'p-auto-column', note: 'column auto-flow with 2 fixed rows; implicit auto columns', style: 'grid-auto-flow:column;grid-template-rows:20px 20px', items: n(5, (k) => box(5 + k, 10)) },
  { id: 'p-sparse-cursor', note: 'sparse packing never moves the cursor back into holes', style: 'grid-template-columns:repeat(4,20px);grid-auto-rows:10px', items: [box(10, 5, 'grid-column:span 3'), box(10, 5, 'grid-column:span 2'), box(10, 5), box(10, 5), box(10, 5, 'grid-column:span 3')] },
  { id: 'p-dense', note: 'the same items with dense packing fill holes', style: 'grid-template-columns:repeat(4,20px);grid-auto-rows:10px;grid-auto-flow:row dense', items: [box(10, 5, 'grid-column:span 3'), box(10, 5, 'grid-column:span 2'), box(10, 5), box(10, 5), box(10, 5, 'grid-column:span 3')] },
  { id: 'p-dense-column', note: 'column dense packing', style: 'grid-template-rows:repeat(3,10px);grid-auto-columns:15px;grid-auto-flow:column dense', items: [box(5, 5, 'grid-row:span 2'), box(5, 5, 'grid-row:span 2'), box(5, 5), box(5, 5, 'grid-row:span 3'), box(5, 5)] },
  { id: 'p-explicit', note: 'explicit line numbers in both axes', style: 'grid-template-columns:repeat(4,15px);grid-template-rows:repeat(3,10px)', items: [box('auto', 'auto', 'grid-column:2/4;grid-row:2'), box('auto', 'auto', 'grid-column:1;grid-row:3/4'), box('auto', 'auto', 'grid-column:4/2;grid-row:1')] },
  { id: 'p-span-end', note: 'span before a line: span 2 / 3 starts at line 1', style: 'grid-template-columns:repeat(4,15px)', items: [box('auto', 10, 'grid-column:span 2/3'), box('auto', 10, 'grid-column:2/span 3')] },
  { id: 'p-negative', note: 'negative lines count from the explicit end', style: 'grid-template-columns:repeat(4,15px);grid-template-rows:10px 10px', items: [box('auto', 'auto', 'grid-column:-1/-3;grid-row:1'), box('auto', 'auto', 'grid-column:1/-1;grid-row:2'), box('auto', 'auto', 'grid-column:-2;grid-row:-2')] },
  { id: 'p-implicit-before', note: 'lines before the explicit grid create implicit tracks sized by grid-auto-columns cycling backwards', style: 'grid-template-columns:5px 6px;grid-auto-columns:10px 20px 30px', items: [box('auto', 10, 'grid-column:-5/-4'), box('auto', 10, 'grid-column:1'), box('auto', 10, 'grid-column:2')] },
  { id: 'p-implicit-after', note: 'lines after the explicit grid create implicit tracks cycling forwards', style: 'grid-template-columns:5px;grid-auto-columns:10px 20px 30px', items: [box('auto', 10, 'grid-column:5'), box('auto', 10, 'grid-column:1')] },
  { id: 'p-named-lines', note: 'repeated line names: a 2, b, a -1, c', style: 'grid-template-columns:[a] 20px [b] 20px [a] 20px [c]', items: [box('auto', 10, 'grid-column:a 2/c;grid-row:1'), box('auto', 10, 'grid-column:b;grid-row:2'), box('auto', 10, 'grid-column:a -1;grid-row:3'), box('auto', 10, 'grid-column:a/a 2;grid-row:4')] },
  { id: 'p-named-missing', note: 'a missing line name resolves to an implicit line after the explicit grid', style: 'grid-template-columns:20px 20px;grid-auto-columns:7px', items: [box('auto', 10, 'grid-column:foo'), box('auto', 10, 'grid-column:span foo/2')] },
  { id: 'p-areas', note: 'grid-template-areas and grid-area names', style: 'grid-template-areas:"a a b" "c d d";grid-template-columns:10px 20px 30px;grid-template-rows:10px 15px', items: [box('auto', 'auto', 'grid-area:d'), box('auto', 'auto', 'grid-area:a'), box('auto', 'auto', 'grid-area:c'), box('auto', 'auto', 'grid-area:b')] },
  { id: 'p-area-lines', note: 'implicit area lines a-start and a-end, and a line named after an area', style: 'grid-template-areas:". a a" ". a a";grid-template-columns:10px 20px 30px;grid-template-rows:10px 15px', items: [box('auto', 'auto', 'grid-column:a-start/a-end;grid-row:a-end'), box('auto', 'auto', 'grid-column:a;grid-row:1')] },
  { id: 'p-order', note: 'order changes auto-placement order', style: 'grid-template-columns:repeat(3,15px)', items: [box(5, 5, 'order:2'), box(6, 5), box(7, 5, 'order:-1'), box(8, 5)] },
  { id: 'p-locked-row', note: 'items locked to a row are placed first; others flow around them', style: 'grid-template-columns:repeat(3,15px);grid-auto-rows:10px', items: [box(5, 5), box(5, 5, 'grid-row:1'), box(5, 5, 'grid-row:1'), box(5, 5, 'grid-row:2;grid-column:span 2'), box(5, 5)] },
  { id: 'p-auto-both-span', note: 'items spanning rows with auto columns', style: 'grid-template-columns:repeat(3,15px);grid-auto-rows:10px', items: [box(5, 5, 'grid-row:span 2'), box(5, 5, 'grid-row:span 3;grid-column:span 2'), box(5, 5), box(5, 5)] },
  { id: 'p-column-locked', note: 'column auto-flow with items locked to a column', style: 'grid-auto-flow:column;grid-template-rows:repeat(3,10px);grid-auto-columns:12px', items: [box(5, 5), box(5, 5, 'grid-column:1'), box(5, 5, 'grid-column:3'), box(5, 5, 'grid-column:1;grid-row:span 2'), box(5, 5)] },
  { id: 'p-span-past-end', note: 'an auto item wider than the explicit grid extends it', style: 'grid-template-columns:repeat(2,15px);grid-auto-columns:4px', items: [box(5, 5, 'grid-column:span 4'), box(5, 5)] },
  { id: 'p-dense-order', note: 'dense packing with order', style: 'grid-template-columns:repeat(3,15px);grid-auto-flow:dense;grid-auto-rows:10px', items: [box(5, 5, 'grid-column:span 2'), box(5, 5, 'grid-column:span 2;order:1'), box(5, 5, 'order:2'), box(5, 5)] },
];

// Family 2: ranges, sets and the truncating share.
const sets: Case[] = [
  { id: 's-span3-one-set', note: 'repeat(3,auto) with one item spanning all 3: one set of 3 tracks; computed track = set / 3 truncated', style: 'grid-template-columns:repeat(3,auto);justify-content:start', items: [box(100, 10, 'grid-column:1/4')] },
  { id: 's-span3-one-set-frac', note: 'the same with a 100.3px item', style: 'grid-template-columns:repeat(3,auto);justify-content:start', items: [box('100.3px', 10, 'grid-column:1/4')] },
  { id: 's-stretch-remainder', note: 'stretching 3 auto tracks over 100px: the remainder goes to the last set', style: 'grid-template-columns:auto auto auto;inline-size:100px', items: n(3, () => box('auto', 10)) },
  { id: 's-stretch-remainder-7', note: 'stretching 7 auto tracks over 100.7px', style: 'grid-template-columns:repeat(7,auto);inline-size:100.7px', items: n(7, () => box('auto', 10)) },
  { id: 's-fr-one-set', note: 'repeat(3,1fr) with one item spanning 1/-1: one set', style: 'grid-template-columns:repeat(3,1fr);inline-size:100px', items: [box('auto', 10, 'grid-column:1/-1')] },
  { id: 's-fr-three-sets', note: '1fr 1fr 1fr with three items: fr leftover accumulates', style: 'grid-template-columns:1fr 1fr 1fr;inline-size:100px', items: n(3, () => box('auto', 10)) },
  { id: 's-fr-seven', note: 'repeat(7,1fr) with seven items over 100px', style: 'grid-template-columns:repeat(7,1fr);inline-size:100px', items: n(7, () => box('auto', 10)) },
  { id: 's-fr-seven-cut', note: 'repeat(7,1fr) with one item at column 3: sets of 2, 1 and 4 tracks', style: 'grid-template-columns:repeat(7,1fr);inline-size:100px', items: [box('auto', 10, 'grid-column:3')] },
  { id: 's-mixed-repeaters', note: '10px repeat(2,1fr 2fr) 20px over 211px with items on columns 2 and 5', style: 'grid-template-columns:10px repeat(2,1fr 2fr) 20px;inline-size:211px', items: [box('auto', 10, 'grid-column:2'), box('auto', 10, 'grid-column:5')] },
  { id: 's-maximize-limits', note: 'maximize: minmax(10px,20px) minmax(10px,100px) in 100px freezes the first at its limit', style: 'grid-template-columns:minmax(10px,20px) minmax(10px,100px);inline-size:100px', items: n(2, () => box('auto', 10)) },
  { id: 's-maximize-frac', note: 'maximize three minmax(0,50px) tracks over 100.7px', style: 'grid-template-columns:repeat(3,minmax(0,50px));inline-size:100.7px', items: n(3, () => box('auto', 10)) },
  { id: 's-span-grouping', note: 'span-1 items are resolved before span-2 items', style: 'grid-template-columns:auto auto;justify-content:start', items: [box(50, 10, 'grid-column:1;grid-row:1'), box(120, 10, 'grid-column:1/3;grid-row:2')] },
  { id: 's-gutter-in-span', note: 'a spanning item\'s extra space excludes the spanned gutter', style: 'grid-template-columns:auto auto;column-gap:10px;justify-content:start', items: [box(100, 10, 'grid-column:1/3')] },
  { id: 's-weighted-flex-span', note: 'an item spanning minmax(min-content,1fr) minmax(min-content,3fr) distributes by flex factor', style: 'grid-template-columns:minmax(min-content,1fr) minmax(min-content,3fr);inline-size:40px', items: [{ s: 'grid-column:1/3', t: X(8) }] },
  { id: 's-growth-limits', note: 'max-content maximums: span-2 item over auto and max-content', style: 'grid-template-columns:auto max-content;justify-content:start', items: [{ s: 'grid-column:1;grid-row:1', t: 'XX XX' }, { s: 'grid-column:1/3;grid-row:2', t: X(9) }] },
  { id: 's-infinitely-growable', note: 'growth limits marked infinitely growable', style: 'grid-template-columns:minmax(min-content,auto) auto;justify-content:start', items: [{ s: 'grid-column:1', t: 'XXX' }, { s: 'grid-column:1/3;grid-row:2', t: 'XXXXX XXXXXXX' }] },
  { id: 's-fit-content-span', note: 'a spanning item grows fit-content tracks up to their limit first', style: 'grid-template-columns:fit-content(20px) fit-content(60px);justify-content:start', items: [{ s: 'grid-column:1/3', t: X(10) }] },
  { id: 's-large-count', note: 'repeat(50,1fr) over 333px with an item on 17/34', style: 'grid-template-columns:repeat(50,1fr);inline-size:333px', items: [box('auto', 10, 'grid-column:17/34')] },
  { id: 's-share-seven', note: 'an item spanning 7 auto tracks distributes 100px equally with truncation', style: 'grid-template-columns:repeat(7,auto) 1px;justify-content:start', items: [box(100, 10, 'grid-column:1/8'), ...n(7, (k) => box(0, 5, `grid-column:${k + 1};grid-row:2`))] },
  { id: 's-share-seven-frac', note: 'the same over 100.3px', style: 'grid-template-columns:repeat(7,auto) 1px;justify-content:start', items: [box('100.3px', 10, 'grid-column:1/8'), ...n(7, (k) => box(0, 5, `grid-column:${k + 1};grid-row:2`))] },
];

// Family 3: fr and leftover.
const fr: Case[] = [
  { id: 'fr-restart', note: '1fr 1fr in 100px with an 80px min-content item: the first track becomes inflexible', style: 'grid-template-columns:1fr 1fr;inline-size:100px', items: [{ t: X(8) }, box(0, 10)] },
  { id: 'fr-sum-below-one', note: '0.2fr 0.3fr: a flex sum below 1 is treated as 1', style: 'grid-template-columns:0.2fr 0.3fr;inline-size:100px', items: n(2, () => box('auto', 10)) },
  { id: 'fr-fractional', note: '1.5fr 2.7fr 0.3fr over 101.3px', style: 'grid-template-columns:1.5fr 2.7fr 0.3fr;inline-size:101.3px', items: n(3, () => box('auto', 10)) },
  { id: 'fr-with-fixed', note: '30px 1fr 2fr over 100px with a 3px gap', style: 'grid-template-columns:30px 1fr 2fr;column-gap:3px;inline-size:100px', items: n(3, () => box('auto', 10)) },
  { id: 'fr-indefinite-columns', note: 'inline-grid 1fr 2fr: the fr size is the largest item max-content / flex', style: 'display:inline-grid;grid-template-columns:1fr 2fr', items: [{ t: X(3) }, { t: X(2) }] },
  { id: 'fr-indefinite-rows', note: 'rows 1fr 2fr with an auto block size', style: 'grid-template-rows:1fr 2fr', items: [box(10, 30), box(10, 20)] },
  { id: 'fr-min-block-redo', note: 'rows 1fr 1fr with min-block-size 100px (spec: redo with a definite 100px)', style: 'grid-template-rows:1fr 1fr;min-block-size:100px', items: [box(10, 10), box(10, 10)] },
  { id: 'fr-max-block-redo', note: 'rows 1fr with a 100px item (min-block-size 0) and max-block-size 50px', style: 'grid-template-rows:1fr;max-block-size:50px', items: [box(10, 100, 'min-block-size:0')] },
  { id: 'fr-max-block-redo-text', note: 'rows 1fr with a 100px-tall wrapped-text item (min-block-size 0) and max-block-size 50px (spec: redo with a definite 50px)', style: 'grid-template-rows:1fr;max-block-size:50px', items: [{ s: 'inline-size:10px;min-block-size:0', t: 'X X X X X X X X X X' }] },
  { id: 'fr-min-inline-redo', note: 'inline-grid 1fr 1fr with min-inline-size 100px', style: 'display:inline-grid;grid-template-columns:1fr 1fr;min-inline-size:100px', items: [box(10, 10), box(10, 10)] },
  { id: 'fr-max-inline-redo', note: 'inline-grid 1fr 1fr with 80px items and max-inline-size 100px', style: 'display:inline-grid;grid-template-columns:1fr 1fr;max-inline-size:100px', items: [{ s: 'min-inline-size:0', t: X(8) }, { s: 'min-inline-size:0', t: X(8) }] },
  { id: 'fr-zero', note: '0fr 1fr', style: 'grid-template-columns:0fr 1fr;inline-size:100px', items: [{ t: 'XX' }, box('auto', 10)] },
  { id: 'fr-leftover-frac', note: 'repeat(3,1fr) with three items over 100.7px', style: 'grid-template-columns:repeat(3,1fr);inline-size:100.7px', items: n(3, () => box('auto', 10)) },
  { id: 'fr-leftover-six', note: '1fr 2fr 1fr 2fr 1fr 2fr over 100px', style: 'grid-template-columns:1fr 2fr 1fr 2fr 1fr 2fr;inline-size:100px', items: n(6, () => box('auto', 10)) },
  { id: 'fr-with-auto', note: 'auto 1fr: fr takes the leftover after the auto track', style: 'grid-template-columns:auto 1fr;inline-size:100px', items: [{ t: 'XXX' }, box('auto', 10)] },
  { id: 'fr-minmax-fixed-fr', note: 'minmax(30px,1fr) minmax(10px,2fr) over 100px', style: 'grid-template-columns:minmax(30px,1fr) minmax(10px,2fr);inline-size:100px', items: n(2, () => box('auto', 10)) },
  { id: 'fr-overflow', note: 'fixed tracks already overflow: fr tracks get 0', style: 'grid-template-columns:80px 1fr 40px;inline-size:100px', items: n(3, () => box('auto', 10)) },
];

// Family 4: minmax, fit-content and auto.
const minmax: Case[] = [
  { id: 'm-fit-content', note: 'fit-content(50px) with an item min 30 max 110', style: 'grid-template-columns:fit-content(50px) auto', items: [{ t: 'XXX XXX XXX' }, box('auto', 10)] },
  { id: 'm-fit-content-large', note: 'fit-content(200px) with max-content 110 (not stretched)', style: 'grid-template-columns:fit-content(200px)', items: [{ t: 'XXX XXX XXX' }] },
  { id: 'm-fit-content-pct', note: 'fit-content(50%) in a 300px grid', style: 'grid-template-columns:fit-content(50%);inline-size:300px', items: [{ t: `${X(10)} ${X(10)}` }] },
  { id: 'm-fit-content-pct-indefinite', note: 'fit-content(50%) in an inline-grid is minmax(auto,max-content)', style: 'display:inline-grid;grid-template-columns:fit-content(50%)', items: [{ t: 'XXX XXX' }] },
  { id: 'm-auto-min-clamp', note: 'minmax(auto,30px) with an 80px min-content item: the automatic minimum is clamped to 30px', style: 'grid-template-columns:minmax(auto,30px);justify-content:start', items: [{ t: X(8) }] },
  { id: 'm-auto-min-clamp-border', note: 'the clamp never goes below border and padding', style: 'grid-template-columns:minmax(auto,10px);justify-content:start', items: [{ s: 'padding-inline:8px;border-inline:3px solid', t: X(8) }] },
  { id: 'm-auto-min-span-flex', note: 'an item spanning auto 1fr has a zero automatic minimum', style: 'grid-template-columns:auto 1fr;inline-size:50px', items: [box(5, 5), { s: 'grid-column:1/3', t: X(8) }] },
  { id: 'm-min-max-content', note: 'min-content and max-content tracks', style: 'grid-template-columns:min-content max-content;justify-content:start', items: [{ t: 'XX XXX' }, { t: 'XX XXX' }] },
  { id: 'm-minmax-pct', note: 'minmax(10%,50%) over 200px', style: 'grid-template-columns:minmax(10%,50%) 1fr;inline-size:200px', items: n(2, () => box('auto', 10)) },
  { id: 'm-max-content-auto-min', note: 'inline-grid minmax(auto,20px) with an item min 20 max 110 (spec: max-content sizing uses max-content for auto minimums)', style: 'display:inline-grid;grid-template-columns:minmax(auto,20px)', items: [{ t: 'XX XX XX XX' }] },
  { id: 'm-max-content-auto-min-float', note: 'the same grid floated', style: 'float:inline-start;grid-template-columns:minmax(auto,20px)', items: [{ t: 'XX XX XX XX' }] },
  { id: 'm-max-content-min', note: 'minmax(max-content,10px)', style: 'grid-template-columns:minmax(max-content,10px);justify-content:start', items: [{ t: 'XX XX XX' }] },
  { id: 'm-scroll-item-min', note: 'a scroll container item has a zero automatic minimum', style: 'grid-template-columns:minmax(auto,10px);justify-content:start', items: [{ s: 'overflow:hidden', t: X(8) }] },
  { id: 'm-min-size-explicit', note: 'an item with min-inline-size 40px in an auto track', style: 'grid-template-columns:minmax(auto,10px);justify-content:start', items: [{ s: 'min-inline-size:40px', t: 'X' }] },
  { id: 'm-auto-rows-text', note: 'auto rows sized by wrapped Ahem text in 40px columns', style: 'grid-template-columns:40px 40px', items: [{ t: 'XX XX XX' }, { t: 'XXXX XX XXXXX' }, { s: 'font-size:13px', t: 'X X' }] },
  { id: 'm-margins', note: 'item margins add to contributions', style: 'grid-template-columns:auto auto;justify-content:start', items: [box(20, 10, 'margin-inline:3px 7.5px'), box(10, 10, 'margin:2px')] },
];

// Family 5: gutters.
const gutters: Case[] = [
  { id: 'g-fixed', note: 'gap 10px 5px', style: 'grid-template-columns:repeat(3,20px);gap:10px 5px', items: n(5, () => box('auto', 10)) },
  { id: 'g-pct-columns', note: 'column-gap 10% of a 200px grid', style: 'grid-template-columns:repeat(3,1fr);column-gap:10%;inline-size:200px', items: n(3, () => box('auto', 10)) },
  { id: 'g-pct-columns-frac', note: 'column-gap 7.3% of 101.3px', style: 'grid-template-columns:repeat(3,1fr);column-gap:7.3%;inline-size:101.3px', items: n(3, () => box('auto', 10)) },
  { id: 'g-pct-rows-indefinite', note: 'row-gap 10% with an auto block size: zero while sizing, then resolved against the final size', style: 'grid-template-rows:auto auto;row-gap:10%', items: [box(10, 20), box(10, 20)] },
  { id: 'g-fractional', note: 'gap 7.3px with repeat(4,1fr) over 100px', style: 'grid-template-columns:repeat(4,1fr);gap:7.3px;inline-size:100px', items: n(8, () => box('auto', 5)) },
  { id: 'g-normal', note: 'gap normal is 0 in grid', style: 'grid-template-columns:repeat(3,20px);gap:normal', items: n(4, () => box('auto', 10)) },
  { id: 'g-auto-fit-collapse', note: 'auto-fit collapsed tracks collapse their gutters', style: 'grid-template-columns:repeat(auto-fit,20px);column-gap:10px;inline-size:200px;justify-content:center', items: n(2, () => box('auto', 10)) },
  { id: 'g-calc', note: 'column-gap calc(5% + 2px) over 150px', style: 'grid-template-columns:repeat(3,1fr);column-gap:calc(5% + 2px);inline-size:150px', items: n(3, () => box('auto', 10)) },
];

// Family 6: alignment.
const CONTENT = ['normal', 'start', 'end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'flex-start', 'flex-end', 'safe center', 'unsafe center', 'left', 'right'] as const;
const ALIGN_CONTENT = CONTENT.filter((v) => v !== 'left' && v !== 'right');
const SELF = ['normal', 'stretch', 'start', 'end', 'center', 'self-start', 'self-end', 'flex-start', 'flex-end', 'left', 'right', 'baseline', 'last baseline', 'safe center', 'unsafe center', 'anchor-center'] as const;
const ALIGN_SELF = SELF.filter((v) => v !== 'left' && v !== 'right');
const slug = (v: string): string => v.replace(/ /g, '-');
const alignment: Case[] = [
  ...CONTENT.map((v): Case => ({ id: `a-jc-${slug(v)}`, note: `justify-content ${v}: 3 auto tracks in 101.3px`, style: `grid-template-columns:repeat(3,auto);inline-size:101.3px;justify-content:${v}`, items: n(3, (k) => box(10 + k, 5)) })),
  ...CONTENT.map((v): Case => ({ id: `a-jc-${slug(v)}-4`, note: `justify-content ${v}: 4 fixed tracks in 102px`, style: `grid-template-columns:repeat(4,10px);inline-size:102px;justify-content:${v}`, items: n(4, () => box('auto', 5)) })),
  ...ALIGN_CONTENT.map((v): Case => ({ id: `a-ac-${slug(v)}`, note: `align-content ${v}: 3 auto rows in 57.7px`, style: `grid-template-rows:repeat(3,auto);grid-template-columns:20px;block-size:57.7px;align-content:${v}`, items: n(3, (k) => box(5, 5 + k)) })),
  ...CONTENT.map((v): Case => ({ id: `a-jc-${slug(v)}-overflow`, note: `justify-content ${v}: tracks overflow the container`, style: `grid-template-columns:repeat(3,20px);inline-size:40.3px;justify-content:${v}`, items: n(3, () => box('auto', 5)) })),
  ...SELF.map((v): Case => ({ id: `a-js-${slug(v)}`, note: `justify-self ${v} in a 43.3px column`, style: 'grid-template-columns:43.3px', items: [{ s: `justify-self:${v};block-size:5px`, t: 'X' }, { s: `justify-self:${v};writing-mode:vertical-rl;block-size:7px;inline-size:5px` }, { s: `justify-self:${v};font-size:13px`, t: 'XX' }] })),
  ...ALIGN_SELF.map((v): Case => ({ id: `a-as-${slug(v)}`, note: `align-self ${v} in a 43.3px row`, style: 'grid-template-columns:20px 20px 20px;grid-template-rows:43.3px', items: [{ s: `align-self:${v};inline-size:5px`, t: 'X' }, { s: `align-self:${v};font-size:13px`, t: 'X' }, { s: `align-self:${v};inline-size:5px;block-size:9px` }] })),
  ...SELF.map((v): Case => ({ id: `a-js-${slug(v)}-overflow`, note: `justify-self ${v}: a 100px item in a 40.3px column`, style: 'grid-template-columns:40.3px 20px', items: [box(100, 5, `justify-self:${v}`)] })),
  { id: 'a-self-overflow-scroller', note: 'justify-self center, 100px item in a 40px column of a scroll container (default overflow alignment)', style: 'grid-template-columns:40px;inline-size:40px;overflow:auto', items: [box(100, 5, 'justify-self:center')] },
  { id: 'a-self-overflow-scroller-safe', note: 'the same with safe center', style: 'grid-template-columns:40px;inline-size:40px;overflow:auto', items: [box(100, 5, 'justify-self:safe center')] },
  { id: 'a-content-overflow-scroller', note: 'justify-content center with 100px of tracks in a 40px scroll container', style: 'grid-template-columns:100px;inline-size:40px;overflow:auto;justify-content:center', items: [box('auto', 5)] },
  { id: 'a-center-odd', note: 'justify-self center with a 1/64-odd free space (40.3px column, 20px item)', style: 'grid-template-columns:40.3px', items: [box(20, 5, 'justify-self:center'), box(100, 5, 'justify-self:center')] },
  { id: 'a-auto-margins', note: 'auto margins center, push to the end, and are safe', style: 'grid-template-columns:50.3px;grid-auto-rows:10px', items: [box(20, 5, 'margin-inline:auto'), box(20, 5, 'margin-inline-start:auto'), box(20, 5, 'margin-inline-end:auto'), box(80, 5, 'margin-inline:auto'), box(20, 5, 'margin-block:auto')] },
  { id: 'a-items', note: 'justify-items and align-items on the container', style: 'grid-template-columns:30px 30px;grid-template-rows:20px;justify-items:center;align-items:end', items: [box(10, 5), box(11, 7, 'justify-self:start')] },
  { id: 'a-stretch-min', note: 'stretch respects max-inline-size and min-block-size', style: 'grid-template-columns:40px;grid-template-rows:30px', items: [{ s: 'max-inline-size:25px;min-block-size:40px', t: 'X' }] },
  { id: 'a-stretch-aspect', note: 'normal alignment of an item with aspect-ratio does not stretch the block axis', style: 'grid-template-columns:40px;grid-template-rows:50px', items: [{ s: 'aspect-ratio:2/1' }] },
];

// Family 7: intrinsic container sizes.
const intrinsic: Case[] = [
  { id: 'i-inline-grid', note: 'inline-grid with auto columns of text', style: 'display:inline-grid;grid-template-columns:auto auto', items: [{ t: 'XX XXX' }, { t: 'X XXXX' }] },
  { id: 'i-min-content', note: 'inline-size min-content', style: 'inline-size:min-content;grid-template-columns:auto 1fr', items: [{ t: 'XX XXX' }, { t: 'X XXXX' }] },
  { id: 'i-max-content', note: 'inline-size max-content', style: 'inline-size:max-content;grid-template-columns:auto 1fr', items: [{ t: 'XX XXX' }, { t: 'X XXXX' }] },
  { id: 'i-fit-content', note: 'inline-size fit-content in a 60px wrapper', cb: [60, 300], style: 'inline-size:fit-content;grid-template-columns:auto auto', items: [{ t: 'XX XXX' }, { t: 'X XXXX' }] },
  { id: 'i-float', note: 'a floated grid shrinks to fit', style: 'float:inline-start;grid-template-columns:repeat(2,minmax(10px,auto)) 1fr', items: [{ t: 'XXX' }, { t: 'X X' }, { t: 'XX' }] },
  { id: 'i-abspos', note: 'an absolutely positioned grid shrinks to fit', style: 'position:absolute;grid-template-columns:auto minmax(0,1fr)', items: [{ t: 'XXX' }, { t: 'XX XX' }] },
  { id: 'i-padding-border', note: 'inline-grid with fractional padding and border', style: 'display:inline-grid;grid-template-columns:auto auto;padding:2.5px 3.3px;border:solid;border-width:1.5px 2px', items: [{ t: 'XX' }, { t: 'XXX' }] },
  { id: 'i-block-auto', note: 'auto block size from rows of text', style: 'grid-template-columns:30px;grid-template-rows:auto 13.3px auto', items: [{ t: 'XX XX' }, box(5, 5), { s: 'font-size:13px', t: 'X' }] },
  { id: 'i-block-min-max', note: 'block size clamped by min-block-size 55.5px', style: 'grid-template-rows:auto;min-block-size:55.5px', items: [box(10, 20)] },
  { id: 'i-stretch-min-indefinite', note: 'auto rows stretch into min-block-size when the block size is indefinite', style: 'grid-template-rows:auto auto;min-block-size:100px', items: [box(10, 10), box(10, 10)] },
  { id: 'i-maximize-max-block', note: 'rows minmax(10px,100px) x2 with max-block-size 50px (spec: redo maximize at 50px)', style: 'grid-template-rows:minmax(10px,100px) minmax(10px,100px);max-block-size:50px', items: [box(10, 5), box(10, 5)] },
  { id: 'i-maximize-max-inline', note: 'inline-grid columns minmax(10px,100px) x2 with max-inline-size 50px', style: 'display:inline-grid;grid-template-columns:minmax(10px,100px) minmax(10px,100px);max-inline-size:50px', items: [box(5, 5), box(5, 5)] },
  { id: 'i-empty', note: 'an empty grid with padding', style: 'grid-template-columns:10px;padding:3px', items: [] },
  { id: 'i-orthogonal-item', note: 'an orthogonal item contributes its block size to the column', style: 'display:inline-grid;grid-template-columns:auto', items: [{ s: 'writing-mode:vertical-rl;block-size:auto', t: 'XX XX' }] },
  { id: 'i-contain-size', note: 'contain:inline-size ignores children for the min/max sizes', style: 'display:inline-grid;contain:inline-size;grid-template-columns:auto 20px', items: [{ t: 'XXXX' }] },
  { id: 'i-aspect-ratio', note: 'grid with aspect-ratio 2/1 and inline-size 100px', style: 'grid-template-rows:1fr;inline-size:100px;aspect-ratio:2/1', items: [box(10, 10)] },
];

// Family 8: percentages.
const percent: Case[] = [
  { id: 'pc-tracks', note: '33.3% 50% tracks of 100.7px', style: 'grid-template-columns:33.3% 50%;inline-size:100.7px', items: n(2, () => box('auto', 10)) },
  { id: 'pc-tracks-indefinite', note: '% columns in an inline-grid are auto while sizing', style: 'display:inline-grid;grid-template-columns:50% 20px', items: [{ t: 'XXX' }, box('auto', 10)] },
  { id: 'pc-rows-indefinite', note: '% rows with an auto block size are auto first, then resolved against the final block size', style: 'grid-template-rows:50% 20px', items: [box(10, 30), box(10, 10)] },
  { id: 'pc-rows-definite', note: '% rows of a 77.7px block size', style: 'grid-template-rows:33.3% 50%;block-size:77.7px', items: [box(10, 'auto'), box(10, 'auto')] },
  { id: 'pc-item-size', note: 'item inline-size 50% and margin 10% resolve against the grid area', style: 'grid-template-columns:60px 40.3px', items: [box('50%', 10, 'margin-inline-start:10%'), box('33.3%', '50%')] },
  { id: 'pc-item-padding', note: 'item padding % resolves against the grid area inline size', style: 'grid-template-columns:60px', items: [box(10, 10, 'padding:10%')] },
  { id: 'pc-minmax', note: 'minmax(20%,30%) and minmax(10px,40%) over 150.3px', style: 'grid-template-columns:minmax(20%,30%) minmax(10px,40%);inline-size:150.3px', items: n(2, () => box('auto', 10)) },
  { id: 'pc-calc', note: 'calc(20% + 3.3px) track over 120px', style: 'grid-template-columns:calc(20% + 3.3px) 1fr;inline-size:120px', items: n(2, () => box('auto', 10)) },
  { id: 'pc-relative-offset', note: 'position:relative item offsets resolve against the grid area', style: 'grid-template-columns:60px;grid-template-rows:40px', items: [box(10, 10, 'position:relative;inset-inline-start:10%;inset-block-start:25%')] },
];

// Family 9: absolutely positioned items in grid areas.
const abspos: Case[] = [
  { id: 'ab-mid-range', note: 'abspos 2/3 in repeat(3,1fr) over 100px with no in-flow items: the start lies mid-set', style: 'position:relative;grid-template-columns:repeat(3,1fr);inline-size:100px;block-size:20px', items: [{ s: 'position:absolute;grid-column:2/3;inset:0' }, { s: 'position:absolute;grid-column:3/4;inset:0' }] },
  { id: 'ab-mid-range-7', note: 'abspos items at 2/3, 3/5, 6/8 in repeat(7,1fr) over 100.7px', style: 'position:relative;grid-template-columns:repeat(7,1fr);inline-size:100.7px;block-size:20px;column-gap:1.3px', items: [{ s: 'position:absolute;grid-column:2/3;inset:0' }, { s: 'position:absolute;grid-column:3/5;inset:0' }, { s: 'position:absolute;grid-column:6/8;inset:0' }] },
  { id: 'ab-auto-lines', note: 'auto lines use the padding box', style: 'position:relative;grid-template-columns:30px 30px;padding:5px 7px;border:3px solid', items: [box(10, 10), { s: 'position:absolute;grid-column:2/auto;grid-row:auto/auto;inset:0' }, { s: 'position:absolute;grid-column:auto/2;inset:0' }] },
  { id: 'ab-beyond-grid', note: 'a line beyond the implicit grid is treated as auto', style: 'position:relative;grid-template-columns:30px 30px;padding:4px', items: [box(10, 10), { s: 'position:absolute;grid-column:2/9;inset:0' }, { s: 'position:absolute;grid-column:-9/2;inset:0' }] },
  { id: 'ab-align', note: 'justify-self and align-self center inside the area', style: 'position:relative;grid-template-columns:40.3px 30px;grid-template-rows:30.3px', items: [box(10, 10, 'position:absolute;grid-column:1;grid-row:1;justify-self:center;align-self:center'), box(10, 10, 'position:absolute;grid-column:2;grid-row:1;justify-self:end;align-self:end')] },
  { id: 'ab-insets', note: 'insets resolve against the grid area', style: 'position:relative;grid-template-columns:20px 40px;grid-template-rows:20px 40px', items: [{ s: 'position:absolute;grid-area:2/2;inset-block:10% 5px;inset-inline:3px 25%' }] },
  { id: 'ab-static', note: 'an abspos item with auto insets sits at its static position in the area', style: 'position:relative;grid-template-columns:20px 40px;grid-template-rows:20px 40px;justify-items:center', items: [box(10, 10, 'position:absolute;grid-area:2/2')] },
  { id: 'ab-gap', note: 'areas with gaps: the end line excludes the trailing gap', style: 'position:relative;grid-template-columns:repeat(3,20px);column-gap:6.5px;block-size:10px', items: [{ s: 'position:absolute;grid-column:1/3;inset:0' }, { s: 'position:absolute;grid-column:3/4;inset:0' }] },
  { id: 'ab-content-align', note: 'abspos areas follow justify-content center', style: 'position:relative;grid-template-columns:20px 20px;inline-size:100.3px;justify-content:center;block-size:10px', items: [{ s: 'position:absolute;grid-column:2;inset:0' }, { s: 'position:absolute;grid-column:1/3;inset:0' }] },
  { id: 'ab-implicit', note: 'an abspos item does not create implicit tracks; named lines', style: 'position:relative;grid-template-columns:[a] 20px [b] 20px [c];block-size:10px', items: [{ s: 'position:absolute;grid-column:b/c;inset:0' }, { s: 'position:absolute;grid-column:a/foo;inset:0' }] },
  { id: 'ab-not-cb', note: 'a non-positioned grid: the abspos item uses the wrapper as its containing block and the grid for its static position', style: 'grid-template-columns:30px 30px', items: [box(5, 5), box(10, 10, 'position:absolute;grid-column:2')] },
];

// Family 10: subgrid.
const subgrid: Case[] = [
  { id: 'sg-columns', note: 'a column subgrid spanning 3 parent columns', style: 'grid-template-columns:20px 30px 40px;column-gap:5px', items: [{ s: 'display:grid;grid-column:1/4;grid-template-columns:subgrid', k: [box('auto', 10), box('auto', 10), box('auto', 10)] }] },
  { id: 'sg-gap-delta', note: 'a subgrid with a different column-gap: the extra margin is half the delta', style: 'grid-template-columns:repeat(3,auto);column-gap:10px;justify-content:start', items: [{ s: 'display:grid;grid-column:1/4;grid-template-columns:subgrid;column-gap:3px', k: [box(20, 10), box(20, 10), box(20, 10)] }] },
  { id: 'sg-padding', note: 'subgrid padding and border become extra margins of its edge tracks', style: 'grid-template-columns:repeat(3,auto);justify-content:start', items: [{ s: 'display:grid;grid-column:1/4;grid-template-columns:subgrid;padding-inline:7.5px 3px;border-inline-start:2px solid', k: [box(10, 10), box(10, 10), box(10, 10)] }, box(15, 5, 'grid-column:1;grid-row:2')] },
  { id: 'sg-rows', note: 'a row subgrid', style: 'grid-template-rows:10px auto 20px;grid-template-columns:30px 30px', items: [{ s: 'display:grid;grid-row:1/4;grid-template-rows:subgrid', k: [box(10, 'auto'), box(10, 25), box(10, 'auto')] }, box(10, 5, 'grid-row:2;grid-column:2')] },
  { id: 'sg-both', note: 'a subgrid in both axes with its own line names', style: 'grid-template-columns:repeat(3,20px);grid-template-rows:repeat(2,15px);gap:2px', items: [{ s: 'display:grid;grid-area:1/1/3/4;grid-template-columns:subgrid [x] [y] [z];grid-template-rows:subgrid', k: [box('auto', 'auto', 'grid-column:y/z;grid-row:2'), box('auto', 'auto', 'grid-column:x;grid-row:1')] }] },
  { id: 'sg-auto-tracks', note: 'auto parent tracks sized by subgrid descendants', style: 'grid-template-columns:auto auto 1fr;inline-size:200px', items: [{ s: 'display:grid;grid-column:1/3;grid-template-columns:subgrid', k: [{ t: 'XXX' }, { t: 'XXXXX' }] }, { s: 'grid-column:1;grid-row:2', t: 'X' }] },
  { id: 'sg-nested', note: 'a subgrid inside a subgrid', style: 'grid-template-columns:repeat(4,auto);column-gap:4px;justify-content:start', items: [{ s: 'display:grid;grid-column:1/5;grid-template-columns:subgrid;padding-inline-start:3px', k: [{ s: 'display:grid;grid-column:2/4;grid-template-columns:subgrid', k: [box(13, 5), box(17, 5)] }, box(7, 5, 'grid-column:1'), box(9, 5, 'grid-column:4')] }] },
  { id: 'sg-margin', note: 'subgrid margins add extra margin to the parent edge tracks', style: 'grid-template-columns:repeat(2,auto);justify-content:start', items: [{ s: 'display:grid;grid-column:1/3;grid-template-columns:subgrid;margin-inline:5px 2.5px', k: [box(10, 5), box(10, 5)] }] },
  { id: 'sg-orthogonal', note: 'an orthogonal subgrid: its columns subgrid the parent rows', style: 'grid-template-columns:30px 30px;grid-template-rows:12px 18px', items: [{ s: 'display:grid;grid-row:1/3;grid-column:1;writing-mode:vertical-lr;grid-template-columns:subgrid', k: [box(5, 5), box(5, 5)] }] },
];

// Family 11: auto-fill and auto-fit.
const autoRepeat: Case[] = [
  { id: 'r-fill-fixed', note: 'repeat(auto-fill,30px) in 100px with a 5px gap: floor((100+5)/35) = 3', style: 'grid-template-columns:repeat(auto-fill,30px);column-gap:5px;inline-size:100px', items: n(2, () => box('auto', 10)) },
  { id: 'r-fill-minmax', note: 'repeat(auto-fill,minmax(30px,1fr)) over 100px', style: 'grid-template-columns:repeat(auto-fill,minmax(30px,1fr));inline-size:100px', items: n(4, () => box('auto', 10)) },
  { id: 'r-fit-collapse', note: 'repeat(auto-fit,30px) with 2 items: empty tracks collapse', style: 'grid-template-columns:repeat(auto-fit,30px);inline-size:200px', items: n(2, () => box('auto', 10)) },
  { id: 'r-fit-center', note: 'auto-fit collapse with justify-content center', style: 'grid-template-columns:repeat(auto-fit,30px);column-gap:4px;inline-size:200px;justify-content:center', items: n(2, () => box('auto', 10)) },
  { id: 'r-fit-fr', note: 'repeat(auto-fit,minmax(20px,1fr)) with 2 items: collapsed tracks give their space to the rest', style: 'grid-template-columns:repeat(auto-fit,minmax(20px,1fr));inline-size:100.3px', items: n(2, () => box('auto', 10)) },
  { id: 'r-fill-min-inline', note: 'inline-grid with min-inline-size 100px: ceil path', style: 'display:inline-grid;grid-template-columns:repeat(auto-fill,30px);min-inline-size:100px', items: [box('auto', 10)] },
  { id: 'r-fill-max-inline', note: 'inline-grid with max-inline-size 100px: floor path', style: 'display:inline-grid;grid-template-columns:repeat(auto-fill,30px);max-inline-size:100px', items: [box('auto', 10)] },
  { id: 'r-fill-indefinite', note: 'inline-grid with no min or max: one repetition', style: 'display:inline-grid;grid-template-columns:repeat(auto-fill,30px)', items: n(3, () => box('auto', 10)) },
  { id: 'r-fill-pct', note: 'repeat(auto-fill,23%) over 100px', style: 'grid-template-columns:repeat(auto-fill,23%);inline-size:100px', items: n(2, () => box('auto', 10)) },
  { id: 'r-fill-frac', note: 'repeat(auto-fill,33.3px) over 100px', style: 'grid-template-columns:repeat(auto-fill,33.3px);inline-size:100px', items: n(4, () => box('auto', 10)) },
  { id: 'r-fill-mixed', note: '10px repeat(auto-fill,20px 7px) 15px over 100px', style: 'grid-template-columns:10px repeat(auto-fill,20px 7px) 15px;inline-size:100px', items: n(3, () => box('auto', 10)) },
  { id: 'r-fill-rows', note: 'repeat(auto-fill,20px) rows in a 70.5px block size', style: 'grid-template-rows:repeat(auto-fill,20px);block-size:70.5px;grid-auto-flow:column', items: n(4, () => box(10, 'auto')) },
  { id: 'r-fill-named', note: 'auto-fill with line names and a named placement', style: 'grid-template-columns:repeat(auto-fill,[a] 25px [b]);inline-size:100px', items: [box('auto', 10, 'grid-column:a 3/b 3'), box('auto', 10, 'grid-column:b 1/span 1')] },
  { id: 'r-fill-zero', note: 'repeat(auto-fill,0px) floors the track at 1px', style: 'grid-template-columns:repeat(auto-fill,0px);inline-size:10px', items: [box('auto', 10)] },
];

// Family 12: baselines.
const baselines: Case[] = [
  { id: 'b-row', note: 'align-items baseline with 10, 20 and 13px Ahem', style: 'grid-template-columns:repeat(3,auto);align-items:baseline;justify-content:start', items: [{ t: 'X' }, { s: 'font-size:20px', t: 'X' }, { s: 'font-size:13px', t: 'X' }] },
  { id: 'b-row-shim', note: 'the baseline shim grows the auto row', style: 'grid-template-columns:repeat(2,auto);align-items:baseline;justify-content:start', items: [{ s: 'font-size:20px;padding-block-end:7px', t: 'X' }, { s: 'font-size:10px;padding-block-start:15px', t: 'X' }] },
  { id: 'b-last', note: 'last baseline alignment', style: 'grid-template-columns:repeat(3,30px);align-items:last baseline', items: [{ t: 'X X X' }, { s: 'font-size:20px', t: 'X' }, { s: 'font-size:13px', t: 'X' }] },
  { id: 'b-margins', note: 'baseline items with margins and borders', style: 'grid-template-columns:repeat(2,auto);align-items:baseline;justify-content:start', items: [{ s: 'margin-block-start:3.5px;border-block-start:2px solid', t: 'X' }, { s: 'font-size:17px;margin-block-end:4px', t: 'X' }] },
  { id: 'b-spanning', note: 'an item spanning two rows joins the first row baseline group', style: 'grid-template-columns:repeat(2,auto);align-items:baseline;justify-content:start', items: [{ s: 'grid-row:span 2;font-size:20px', t: 'X' }, { t: 'X' }, { s: 'grid-column:2', t: 'X' }] },
  { id: 'b-synthesized', note: 'empty boxes synthesize their baseline from the border box', style: 'grid-template-columns:repeat(3,auto);align-items:baseline;justify-content:start', items: [box(10, 30), box(10, 17.5), { s: 'font-size:13px', t: 'X' }] },
  { id: 'b-columns', note: 'justify-self baseline with orthogonal items', style: 'grid-template-columns:auto;grid-template-rows:repeat(3,auto);justify-items:baseline;justify-content:start', items: [{ s: 'writing-mode:vertical-rl', t: 'X' }, { s: 'writing-mode:vertical-rl;font-size:20px', t: 'X' }, { s: 'writing-mode:vertical-lr;font-size:13px', t: 'X' }] },
  { id: 'b-fixed-row', note: 'baseline items in a fixed 50px row', style: 'grid-template-columns:repeat(2,auto);grid-template-rows:50px;align-items:baseline;justify-content:start', items: [{ t: 'X' }, { s: 'font-size:25px', t: 'X' }] },
  { id: 'b-container-baseline', note: 'an inline-grid baseline next to text: the text run (a) sits on the grid baseline', after: 'X', style: 'display:inline-grid;grid-template-columns:auto auto;align-items:baseline', items: [{ s: 'font-size:7px', t: 'X' }, { s: 'font-size:15px', t: 'X' }] },
  { id: 'b-nested-grid', note: 'a nested grid item exports its first baseline', style: 'grid-template-columns:repeat(2,auto);align-items:baseline;justify-content:start', items: [{ s: 'display:grid;padding-block-start:5px', k: [{ s: 'font-size:15px', t: 'X' }] }, { t: 'X' }] },
];

// Family 13: seeded random grids.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TRACKS = ['20px', '33.3px', '17.5px', '7px', '1fr', '2fr', '0.5fr', '1.3fr', 'auto', 'auto', 'min-content', 'max-content', 'minmax(10px,1fr)', 'minmax(auto,25px)', 'minmax(0,1fr)', 'fit-content(30px)', '10%', '33.3%', 'minmax(15px,max-content)', 'minmax(min-content,2fr)'] as const;
const AUTO_TRACKS = ['auto', 'auto', 'auto', '10px', 'minmax(5px,auto)', '1fr', '12.5px 20px', 'min-content'] as const;
const GAPS = ['0', '0', '3px', '7.5px', '5%', '1px 4px', '2.3px'] as const;
const INLINE = ['auto', 'auto', '100px', '151.3px', '87px', '233.7px', 'fit-content', 'min-content'] as const;
const BLOCK = ['auto', 'auto', 'auto', '80px', '63.7px'] as const;
const JC = ['normal', 'normal', 'normal', 'start', 'end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch'] as const;
const JI = ['normal', 'normal', 'normal', 'start', 'end', 'center', 'stretch', 'baseline'] as const;
const FLOW = ['row', 'row', 'column', 'row dense', 'column dense'] as const;
const PAD = ['0', '0', '0', '3px', '2.5px 7px'] as const;
const BORDER = ['0', '0', '1px solid', '3.5px solid'] as const;
const PLACE = ['auto', 'auto', 'auto', 'auto', 'span 2', '2', '1 / 3', '-1', '-2 / -1', 'span 3', '3 / span 2', '1'] as const;
const ISIZE = ['auto', 'auto', '10px', '23.3px', '40px', '50%'] as const;
const FONT = ['10px', '10px', '10px', '13px', '7.5px'] as const;
const SELF_R = ['auto', 'auto', 'auto', 'auto', 'center', 'end', 'start', 'stretch', 'baseline'] as const;

function randomCase(index: number): Case {
  const r = mulberry32(0x9e3779b9 ^ Math.imul(index + 1, 0x85ebca6b));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const trackList = (count: number, list: readonly string[]): string => {
    const tracks = Array.from({ length: count }, () => pick(list));
    if (count >= 2 && r() < 0.25) return `repeat(${int(2, 3)},${tracks.slice(0, 2).join(' ')})${count > 2 ? ` ${tracks.slice(2).join(' ')}` : ''}`;
    return tracks.join(' ');
  };
  const decl: string[] = [];
  const display = r() < 0.2 ? 'inline-grid' : 'grid';
  decl.push(`display:${display}`);
  decl.push(`grid-template-columns:${trackList(int(1, 5), TRACKS)}`);
  const rowCount = int(0, 3);
  if (rowCount > 0) decl.push(`grid-template-rows:${trackList(rowCount, TRACKS)}`);
  const gap = pick(GAPS);
  if (gap !== '0') decl.push(`gap:${gap}`);
  if (display === 'grid') {
    const is = pick(INLINE);
    if (is !== 'auto') decl.push(`inline-size:${is}`);
  }
  const bs = pick(BLOCK);
  if (bs !== 'auto') decl.push(`block-size:${bs}`);
  const jc = pick(JC);
  if (jc !== 'normal') decl.push(`justify-content:${jc}`);
  const ac = pick(JC);
  if (ac !== 'normal') decl.push(`align-content:${ac}`);
  const ji = pick(JI);
  if (ji !== 'normal') decl.push(`justify-items:${ji}`);
  const ai = pick(JI);
  if (ai !== 'normal') decl.push(`align-items:${ai}`);
  const flow = pick(FLOW);
  if (flow !== 'row') decl.push(`grid-auto-flow:${flow}`);
  const ac1 = pick(AUTO_TRACKS);
  if (ac1 !== 'auto') decl.push(`grid-auto-columns:${ac1}`);
  const ar = pick(AUTO_TRACKS);
  if (ar !== 'auto') decl.push(`grid-auto-rows:${ar}`);
  const pad = pick(PAD);
  if (pad !== '0') decl.push(`padding:${pad}`);
  const border = pick(BORDER);
  if (border !== '0') decl.push(`border:${border}`);
  const items = Array.from({ length: int(1, 6) }, (): Item => {
    const s: string[] = [];
    const col = pick(PLACE);
    if (col !== 'auto') s.push(`grid-column:${col}`);
    const row = pick(PLACE);
    if (row !== 'auto') s.push(`grid-row:${row}`);
    const is = pick(ISIZE);
    if (is !== 'auto') s.push(`inline-size:${is}`);
    const font = pick(FONT);
    if (font !== '10px') s.push(`font-size:${font}`);
    if (r() < 0.15) s.push(`margin:${pick(['2px', 'auto', '1.5px 3px'])}`);
    const js = pick(SELF_R);
    if (js !== 'auto') s.push(`justify-self:${js}`);
    const as = pick(SELF_R);
    if (as !== 'auto') s.push(`align-self:${as}`);
    if (r() < 0.35) {
      s.push(`block-size:${pick(['5px', '12.5px', '20px', '31.7px'])}`);
      return { s: s.join(';') };
    }
    const words = Array.from({ length: int(1, 3) }, () => X(int(1, 5)));
    return { s: s.join(';'), t: words.join(' ') };
  });
  return { id: `rnd-${String(index).padStart(4, '0')}`, note: `seeded random grid ${index}`, cb: [300, 200], style: decl.join(';'), items };
}

const randomFamilies: Family[] = Array.from({ length: RANDOM_CASES / RANDOM_SHARD }, (_, s) => ({
  id: `random-${String(s).padStart(2, '0')}`,
  title: `Seeded random grids ${s * RANDOM_SHARD}-${(s + 1) * RANDOM_SHARD - 1}`,
  cases: Array.from({ length: RANDOM_SHARD }, (_, k) => randomCase(s * RANDOM_SHARD + k)),
}));

const FAMILIES: Family[] = [
  { id: 'placement', title: 'Placement: sparse and dense, spans, negative, named lines and areas, implicit tracks', cases: placement },
  { id: 'sets', title: 'Ranges, sets and the truncating share', cases: sets },
  { id: 'fr', title: 'Flexible tracks and the fr leftover', cases: fr },
  { id: 'minmax', title: 'minmax, fit-content and auto', cases: minmax },
  { id: 'gutters', title: 'Gutters', cases: gutters },
  { id: 'alignment', title: 'Content, self and auto-margin alignment', cases: alignment },
  { id: 'intrinsic', title: 'Intrinsic container sizes', cases: intrinsic },
  { id: 'percent', title: 'Percentages', cases: percent },
  { id: 'abspos', title: 'Absolutely positioned items in grid areas', cases: abspos },
  { id: 'subgrid', title: 'Subgrid', cases: subgrid },
  { id: 'auto-repeat', title: 'auto-fill and auto-fit', cases: autoRepeat },
  { id: 'baselines', title: 'Baseline alignment', cases: baselines },
  ...randomFamilies,
];

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const itemHtml = (it: Item, label: string): string =>
  `<div data-i="${label}"${it.s ? ` style="${escapeAttr(it.s)}"` : ''}>${it.t ? escapeText(it.t) : ''}${(it.k ?? []).map((c, j) => itemHtml(c, `${label}.${j}`)).join('')}</div>`;
const gridHtml = (c: Case): string => {
  const style = /(^|;)display:/.test(c.style) ? c.style : `display:grid;${c.style}`;
  return `<div class="g" style="${escapeAttr(style)}">${c.items.map((it, j) => itemHtml(it, `i${j}`)).join('')}</div>`;
};
const labelsOf = (items: readonly Item[], prefix = 'i'): string[] =>
  items.flatMap((it, j) => [`${prefix}${j}`, ...labelsOf(it.k ?? [], `${prefix}${j}.`)]);

const docFor = (cases: readonly Case[], wm: string): string =>
  `<!DOCTYPE html><html><head><style>body{margin:0}.cb{position:absolute;top:0;left:0;font-size:10px;line-height:1}</style></head><body>${cases
    .map((c) => `<div class="cb" style="writing-mode:${wm};inline-size:${(c.cb ?? [400, 300])[0]}px;block-size:${(c.cb ?? [400, 300])[1]}px">${gridHtml(c)}${c.after === undefined ? '' : `<span class="a">${escapeText(c.after)}</span>`}</div>`)
    .join('')}</body></html>`;

type Rect = [number, number, number, number];
type Measured = { c: Rect; cols: string; rows: string; items: Rect[]; a?: Rect };

/** Runs in the page: measures every .g container. Kept self-contained because Playwright serializes it. */
function measure(): Measured[] {
  const rel = (r: DOMRect, o: DOMRect): Rect => [r.left - o.left, r.top - o.top, r.width, r.height];
  return Array.from(document.querySelectorAll('.cb')).map((cb) => {
    const g = cb.querySelector('.g') as HTMLElement;
    const origin = g.getBoundingClientRect();
    const cs = getComputedStyle(g);
    return {
      c: rel(origin, cb.getBoundingClientRect()),
      cols: cs.gridTemplateColumns,
      rows: cs.gridTemplateRows,
      items: Array.from(g.querySelectorAll('[data-i]')).map((e) => rel(e.getBoundingClientRect(), origin)),
      ...(cb.querySelector('.a') ? { a: rel(cb.querySelector('.a')!.getBoundingClientRect(), origin) } : {}),
    };
  });
}

/** One LayoutUnit of the zoomed layout: 1/(64 * dpr) CSS px. getBoundingClientRect is float32, so this checks it stays within 0.05. */
function raw(v: number, dpr: number, what: string): number {
  const x = v * 64 * dpr;
  const r = Math.round(x);
  if (Math.abs(x - r) > 0.05) throw new Error(`${what}: ${v} is not a multiple of 1/(64*${dpr}) px`);
  return r === 0 ? 0 : r;
}

type Env = (typeof ENVS)[number];
/**
 * Converts a physical measurement to logical [inline-start, block-start, inline-size, block-size] in raw units of the case's
 * writing mode and direction. The container is relative to the wrapper border box, items to the container border box.
 */
function logical(m: Measured, c: Case, env: Env): { c: Rect; cols: string; rows: string; items: Rect[]; a?: Rect } {
  const vertical = env.wm !== 'horizontal-tb';
  const [ci, cbk] = c.cb ?? [400, 300];
  const toLogical = (r: Rect, outerW: number, outerH: number, what: string): Rect => {
    const [x, y, w, h] = r.map((v) => raw(v, env.dpr, what)) as Rect;
    if (!vertical) return [env.dir === 'ltr' ? x : outerW - x - w, y, w, h];
    const b = env.wm === 'vertical-rl' ? outerW - x - w : x;
    return [env.dir === 'ltr' ? y : outerH - y - h, b, h, w];
  };
  const cbW = raw(vertical ? cbk : ci, env.dpr, `${c.id} wrapper`);
  const cbH = raw(vertical ? ci : cbk, env.dpr, `${c.id} wrapper`);
  const cw = raw(m.c[2], env.dpr, `${c.id} container`);
  const ch = raw(m.c[3], env.dpr, `${c.id} container`);
  return {
    c: toLogical(m.c, cbW, cbH, `${c.id} ${env.name} container`),
    cols: m.cols,
    rows: m.rows,
    items: m.items.map((r, j) => toLogical(r, cw, ch, `${c.id} ${env.name} item ${j}`)),
    ...(m.a === undefined ? {} : { a: toLogical(m.a, cw, ch, `${c.id} ${env.name} text run`) }),
  };
}

async function captureFamily(browsers: Map<number, Awaited<ReturnType<typeof launchChrome>>>, fam: Family): Promise<string> {
  const perEnv: Measured[][] = [];
  for (const env of ENVS) {
    const page = await openPage(browsers.get(env.dpr)!, docFor(fam.cases, env.wm), { viewport: { width: 800, height: 600 }, devicePixelRatio: env.dpr, direction: env.dir, rootFont: 'ahem' });
    const m = await page.evaluate(measure);
    if (m.length !== fam.cases.length) throw new Error(`${fam.id} ${env.name}: measured ${m.length} of ${fam.cases.length} cases`);
    perEnv.push(m);
    await page.context().close();
  }
  const lines = fam.cases.map((c, k) => {
    const labels = labelsOf(c.items);
    const distinct: string[] = [];
    const env = ENVS.map((en, e) => {
      const m = perEnv[e]![k]!;
      if (m.items.length !== labels.length) throw new Error(`${c.id}: measured ${m.items.length} items, expected ${labels.length}`);
      const text = JSON.stringify(logical(m, c, en));
      const at = distinct.indexOf(text);
      if (at >= 0) return at;
      distinct.push(text);
      return distinct.length - 1;
    });
    if ((perEnv[0]![k]!.a !== undefined) !== (c.after !== undefined)) throw new Error(`${c.id}: the text run after the grid was not measured`);
    const head = JSON.stringify({ note: c.note, cb: c.cb ?? [400, 300], html: gridHtml(c), ...(c.after === undefined ? {} : { after: c.after }), labels, env });
    return `${JSON.stringify(c.id)}:${head.slice(0, -1)},"distinct":[${distinct.join(',')}]}`;
  });
  const header = {
    chrome: CHROME_VERSION,
    playwright: PLAYWRIGHT_VERSION,
    family: fam.id,
    title: fam.title,
    font: 'Ahem, font-size 10px, line-height 1 on the wrapper',
    envs: ENVS.map((e) => e.name),
    units:
      'Raw LayoutUnits of the zoomed layout: 1/(64*dpr) CSS px. Every box is logical [inline-start, block-start, inline-size, block-size] in the case writing mode and direction. c: the container border box within the wrapper border box (the wrapper is cb[0] x cb[1] logical px); items: the border boxes of the [data-i] elements in document order (labels) within the container border box. The wrapper carries writing-mode, the root carries direction. cols and rows are getComputedStyle gridTemplateColumns and gridTemplateRows. env[i] indexes distinct for envs[i].',
  };
  return `${JSON.stringify(header).slice(0, -1)},"cases":{\n${lines.join(',\n')}\n}}\n`;
}

/**
 * Planted faults and suspected Chrome deviations, each pinned to the corpus at dpr1-ltr-horizontal-tb (raw units, or the computed
 * track list). `--plants` checks, without Chrome, that the corpus holds `chrome` and that it differs from `other`: the value the
 * planted fault gives, the spec value for a confirmed deviation, or the suspected-deviation value for a refuted one. blink-notes.md
 * explains each one.
 */
type Pin = { readonly id: string; readonly file: string; readonly kase: string; readonly at: string; readonly chrome: number | string; readonly other: number | string };
const PLANTS: readonly Pin[] = [
  { id: 'frLeftoverDropped', file: 'sets', kase: 's-fr-seven', at: 'i3.inline-size', chrome: 915, other: 914 },
  { id: 'frLeftoverFloat64', file: 'sets', kase: 's-fr-three-sets', at: 'i2.inline-size', chrome: 2133, other: 2134 },
  { id: 'frRestartMissing', file: 'fr', kase: 'fr-restart', at: 'cols', chrome: '80px 20px', other: '80px 50px' },
  { id: 'flexSumBelowOneNotClamped', file: 'fr', kase: 'fr-sum-below-one', at: 'i0.inline-size', chrome: 1280, other: 2560 },
  { id: 'flexSpanWeightedAsEqual', file: 'sets', kase: 's-weighted-flex-span', at: 'cols', chrome: '20px 60px', other: '40px 40px' },
  { id: 'sharePerTrackNotPerSet', file: 'sets', kase: 's-span3-one-set', at: 'cols', chrome: '33.3281px 33.3281px 33.3281px', other: '33.3281px 33.3281px 33.3438px' },
  { id: 'remainderNotToLastSet', file: 'sets', kase: 's-stretch-remainder', at: 'i0.inline-size', chrome: 2133, other: 2134 },
  { id: 'shareRounded', file: 'sets', kase: 's-share-seven', at: 'i5.inline-start', chrome: 3656, other: 3657 },
  { id: 'maximizeIgnoresGrowthLimit', file: 'sets', kase: 's-maximize-limits', at: 'i0.inline-size', chrome: 1280, other: 3200 },
  { id: 'spanGroupingFlat', file: 'sets', kase: 's-span-grouping', at: 'cols', chrome: '50px 70px', other: '60px 60px' },
  { id: 'gutterNotInSpannedSize', file: 'sets', kase: 's-gutter-in-span', at: 'cols', chrome: '45px 45px', other: '50px 50px' },
  { id: 'autoMinNotClamped', file: 'minmax', kase: 'm-auto-min-clamp', at: 'cols', chrome: '30px', other: '80px' },
  { id: 'fitContentAsAuto', file: 'minmax', kase: 'm-fit-content', at: 'i0.inline-size', chrome: 3200, other: 16320 },
  { id: 'stretchIgnoresContentAlignment', file: 'alignment', kase: 'a-jc-start', at: 'i2.inline-start', chrome: 1344, other: 4258 },
  { id: 'stretchIndefiniteIgnoresMinSize', file: 'intrinsic', kase: 'i-stretch-min-indefinite', at: 'rows', chrome: '50px 50px', other: '10px 10px' },
  { id: 'percentGapNotReresolved', file: 'gutters', kase: 'g-pct-rows-indefinite', at: 'i1.block-start', chrome: 1536, other: 1280 },
  { id: 'percentTrackNotReresolved', file: 'percent', kase: 'pc-rows-indefinite', at: 'rows', chrome: '25px 20px', other: '30px 20px' },
  { id: 'percentRounded', file: 'percent', kase: 'pc-tracks', at: 'i0.inline-size', chrome: 2145, other: 2146 },
  { id: 'contentDistributionRounded', file: 'alignment', kase: 'a-jc-space-between-4', at: 'i1.inline-start', chrome: 1962, other: 1963 },
  { id: 'centerNegativeFloors', file: 'alignment', kase: 'a-center-odd', at: 'i1.inline-start', chrome: -1910, other: -1911 },
  { id: 'autoPlacementNotDense', file: 'placement', kase: 'p-dense', at: 'i2.block-start', chrome: 0, other: 640 },
  { id: 'sparseCursorRewinds', file: 'placement', kase: 'p-sparse-cursor', at: 'i2.block-start', chrome: 640, other: 0 },
  { id: 'orderIgnored', file: 'placement', kase: 'p-order', at: 'i0.block-start', chrome: 320, other: 0 },
  { id: 'implicitBeforeCyclesForward', file: 'placement', kase: 'p-implicit-before', at: 'cols', chrome: '20px 30px 5px 6px', other: '10px 20px 5px 6px' },
  { id: 'autoFillCountCeil', file: 'auto-repeat', kase: 'r-fill-frac', at: 'cols', chrome: '33.2969px 33.2969px 33.2969px', other: '33.2969px 33.2969px 33.2969px 33.2969px' },
  { id: 'autoFitNotCollapsed', file: 'auto-repeat', kase: 'r-fit-center', at: 'i0.inline-start', chrome: 4352, other: 0 },
  { id: 'baselineShimMissing', file: 'baselines', kase: 'b-row-shim', at: 'i0.block-start', chrome: 448, other: 0 },
  { id: 'oofMidRangeTruncated', file: 'abspos', kase: 'ab-mid-range', at: 'i0.inline-start', chrome: 2134, other: 2133 },
];
const DEVIATIONS: readonly (Pin & { readonly verdict: 'confirmed' | 'refuted' })[] = [
  { id: 'grid-maximize-no-max-redo', verdict: 'confirmed', file: 'intrinsic', kase: 'i-maximize-max-block', at: 'rows', chrome: '100px 100px', other: '25px 25px' },
  { id: 'grid-maximize-no-max-redo (inline axis)', verdict: 'refuted', file: 'intrinsic', kase: 'i-maximize-max-inline', at: 'cols', chrome: '25px 25px', other: '100px 100px' },
  { id: 'grid-flex-no-minmax-redo (min-block-size)', verdict: 'refuted', file: 'fr', kase: 'fr-min-block-redo', at: 'rows', chrome: '50px 50px', other: '10px 10px' },
  { id: 'grid-flex-no-minmax-redo (max-block-size)', verdict: 'refuted', file: 'fr', kase: 'fr-max-block-redo-text', at: 'rows', chrome: '50px', other: '100px' },
  { id: 'grid-flex-no-minmax-redo (min-inline-size)', verdict: 'refuted', file: 'fr', kase: 'fr-min-inline-redo', at: 'cols', chrome: '50px 50px', other: '10px 10px' },
  { id: 'grid-flex-no-minmax-redo (max-inline-size)', verdict: 'refuted', file: 'fr', kase: 'fr-max-inline-redo', at: 'cols', chrome: '50px 50px', other: '80px 80px' },
  { id: 'grid-max-content-auto-min', verdict: 'confirmed', file: 'minmax', kase: 'm-max-content-auto-min', at: 'cols', chrome: '20px', other: '110px' },
  { id: 'grid-default-self-overflow-unsafe', verdict: 'confirmed', file: 'alignment', kase: 'a-self-overflow-scroller', at: 'i0.inline-start', chrome: -1920, other: 0 },
  { id: 'grid-default-self-overflow-unsafe (content)', verdict: 'confirmed', file: 'alignment', kase: 'a-content-overflow-scroller', at: 'i0.inline-start', chrome: -1920, other: 0 },
];

function checkPins(): boolean {
  const FIELDS = ['inline-start', 'block-start', 'inline-size', 'block-size'];
  let ok = true;
  for (const [kind, pins] of [['plant', PLANTS], ['deviation', DEVIATIONS]] as const) {
    for (const p of pins) {
      const j = JSON.parse(readFileSync(repoPath(`${OUT_DIR}/${p.file}.json`), 'utf8'));
      const c = j.cases[p.kase];
      const d = c.distinct[c.env[j.envs.indexOf('dpr1-ltr-horizontal-tb')]];
      let got: number | string;
      if (p.at === 'cols' || p.at === 'rows') got = d[p.at];
      else {
        const [label, field] = p.at.split('.') as [string, string];
        got = d.items[c.labels.indexOf(label)][FIELDS.indexOf(field)];
      }
      const pass = got === p.chrome && got !== p.other;
      if (!pass) ok = false;
      console.log(`${pass ? 'ok  ' : 'FAIL'} ${kind} ${p.id}: ${p.kase} ${p.at} = ${JSON.stringify(got)} (Chrome pin ${JSON.stringify(p.chrome)}, ${kind === 'plant' ? 'plant' : 'verdict' in p && p.verdict === 'confirmed' ? 'spec' : 'suspected deviation'} ${JSON.stringify(p.other)})`);
    }
  }
  return ok;
}

if (process.argv.includes('--plants')) {
  const ok = checkPins();
  console.log(`${PLANTS.length} plants, ${DEVIATIONS.length} deviation pins`);
  process.exit(ok ? 0 : 1);
}

const check = process.argv.includes('--check');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
if (only !== undefined && !FAMILIES.some((fam) => fam.id === only)) {
  console.error(`capture-grid-probe: unknown family ${only}; families: ${FAMILIES.map((fam) => fam.id).join(', ')}`);
  process.exit(1);
}
const browsers = new Map<number, Awaited<ReturnType<typeof launchChrome>>>();
let failed = false;
try {
  for (const dpr of DPRS) browsers.set(dpr, await launchChrome(dpr));
  if (!check) mkdirSync(repoPath(OUT_DIR), { recursive: true });
  for (const fam of FAMILIES) {
    if (only !== undefined && fam.id !== only) continue;
    const text = await captureFamily(browsers, fam);
    const file = repoPath(`${OUT_DIR}/${fam.id}.json`);
    if (check) {
      const same = existsSync(file) && readFileSync(file, 'utf8') === text;
      console.log(`${same ? 'same' : 'DIFFERS'} ${OUT_DIR}/${fam.id}.json (${fam.cases.length} cases)`);
      if (!same) failed = true;
    } else {
      writeFileSync(file, text);
      console.log(`wrote ${OUT_DIR}/${fam.id}.json (${fam.cases.length} cases x ${ENVS.length} environments, ${text.length} bytes)`);
    }
  }
} finally {
  for (const b of browsers.values()) await b.close();
}
if (failed) {
  console.error('capture-grid-probe --check: the committed corpus differs from a fresh capture');
  process.exit(1);
}
