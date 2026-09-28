// Captures Chrome's matchMedia and mediaText for the media query corpus and for every band condition band() derives,
// at each viewport derived from the corpus thresholds, on pages whose root font size is 16px and 20px.
// Writes packages/dragon/test/media/captures/chrome-145.json; --check requires a byte-identical recapture.
// Run with: node --conditions=dragon-internal scripts/capture-media-data.ts [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { band, contains, featuresOfList, INITIAL_FONT_SIZE, parseMediaQueryList, resolveLength } from '../packages/dragon/src/media/index.ts';
import type { Interval, MediaQueryList, MediaValue } from '../packages/dragon/src/media/index.ts';

type Corpus = {
  readonly roots: readonly number[];
  readonly defaultViewport: Viewport;
  readonly limits: ViewportLimits;
  readonly queries: readonly string[];
  readonly refusedQueries: readonly string[];
  readonly bandSheets: readonly { readonly name: string; readonly queries: readonly string[]; readonly refused?: string }[];
};
type Page = Awaited<ReturnType<typeof openPage>>;

// Viewports derived from a list's thresholds: equal and ±1 (the two integers around a fractional one), the midpoint between
// neighbours, below the first and above the last.
type Viewport = { readonly width: number; readonly height: number };
type ViewportLimits = { readonly minWidth: number; readonly maxWidth: number; readonly minHeight: number; readonly maxHeight: number };

function around(t: number): number[] {
  return Number.isInteger(t) ? [t - 1, t, t + 1] : [Math.floor(t), Math.ceil(t)];
}

function axisSizes(thresholds: readonly number[]): number[] {
  const ts = [...new Set(thresholds)].filter(Number.isFinite).sort((a, b) => a - b);
  const out = ts.flatMap(around);
  ts.forEach((t, k) => {
    const next = ts[k + 1];
    if (next !== undefined) out.push(Math.floor((t + next) / 2));
  });
  if (ts.length > 0) out.push(Math.floor((ts[0] as number) / 2), Math.floor(ts[ts.length - 1] as number) + 100);
  return out;
}

const lengthPx = (v: MediaValue | null | undefined): number[] =>
  v !== null && v !== undefined && v.kind === 'length' ? [resolveLength(v.length, INITIAL_FONT_SIZE)] : [];

/**
 * The viewports at which a list's evaluated features change or hold: width thresholds at the base height, height thresholds
 * at the base width, and aspect-ratio and orientation boundaries at the base height.
 */
function sampleViewports(list: MediaQueryList, base: Viewport): Viewport[] {
  const widths: number[] = [];
  const heights: number[] = [];
  const out: Viewport[] = [];
  for (const f of featuresOfList(list)) {
    if (f.refused !== null) continue;
    const values = [f.value, f.left?.value, f.right?.value];
    if (f.base === 'width') widths.push(...values.flatMap(lengthPx));
    if (f.base === 'height') heights.push(...values.flatMap(lengthPx));
    if (f.base === 'aspect-ratio') {
      for (const v of values) {
        if (v?.kind === 'ratio' && v.den !== 0) for (const width of around((v.num / v.den) * base.height)) out.push({ width, height: base.height });
      }
    }
    if (f.base === 'orientation') for (const width of around(base.height)) out.push({ width, height: base.height });
  }
  for (const width of axisSizes(widths)) out.push({ width, height: base.height });
  for (const height of axisSizes(heights)) out.push({ width: base.width, height });
  return out;
}

/** The viewports inside the limits, deduplicated and sorted by width, then height. */
function viewportSet(viewports: readonly Viewport[], limits: ViewportLimits): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const { width, height } of viewports) {
    if (width < limits.minWidth || width > limits.maxWidth || height < limits.minHeight || height > limits.maxHeight) continue;
    const k = `${width},${height}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([width, height]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** The viewports a Chrome capture covers: the base, every list's sample viewports and every band sample, inside the limits. */
function captureViewports(
  lists: readonly MediaQueryList[],
  bandSamples: readonly Viewport[],
  base: Viewport,
  limits: ViewportLimits,
): [number, number][] {
  return viewportSet([base, ...lists.flatMap((l) => sampleViewports(l, base)), ...bandSamples], limits);
}

/** An integer inside a band's intervals: the midpoint of the first bounded one that holds one, else 100 past an unbounded start. */
function integerIn(intervals: readonly Interval[], fallback: number): number | null {
  const only = intervals[0];
  if (intervals.length === 1 && only !== undefined && only.lo === 0 && only.loInclusive && only.hi === Infinity) return fallback;
  for (const i of intervals) {
    if (i.hi === Infinity) return Math.floor(i.lo) + 100;
    const mid = Math.floor((i.lo + i.hi) / 2);
    if (contains(i, mid)) return mid;
    for (let v = Math.ceil(i.lo); v <= Math.floor(i.hi); v++) if (contains(i, v)) return v;
  }
  return null;
}

const CAPTURE_PATH = 'packages/dragon/test/media/captures/chrome-145.json';
const corpus = JSON.parse(readFileSync(repoPath('packages/dragon/test/media/corpus.json'), 'utf8')) as Corpus;
const check = process.argv.includes('--check');

const queries = [...corpus.queries, ...corpus.refusedQueries];
const sheets = corpus.bandSheets
  .filter((s) => s.refused === undefined)
  .map((s) => {
    const lists = s.queries.map((q) => parseMediaQueryList(q));
    const partition = band(lists);
    if (partition.kind !== 'bands') throw new Error(`band sheet ${s.name} is refused: ${partition.detail}`);
    const samples = partition.bands.map((b) => {
      const width = integerIn(b.width, corpus.defaultViewport.width);
      const height = integerIn(b.height, corpus.defaultViewport.height);
      if (width === null || height === null) throw new Error(`band sheet ${s.name} band ${b.index} holds no integer viewport`);
      return { width, height };
    });
    return { sheet: s.name, lists, texts: partition.bands.map((b) => b.condition), samples };
  });
const points = captureViewports(
  [...queries.map((q) => parseMediaQueryList(q)), ...sheets.flatMap((s) => s.lists)],
  sheets.flatMap((s) => s.samples),
  corpus.defaultViewport,
  corpus.limits,
);
const texts = [...queries, ...sheets.flatMap((s) => s.texts)];

async function sweep(page: Page): Promise<{ mediaText: string[]; bits: string[] }> {
  const mediaText = await page.evaluate((qs: string[]) => qs.map((q) => matchMedia(q).media), texts);
  const bits = texts.map(() => '');
  for (const [width, height] of points) {
    await page.setViewportSize({ width, height });
    const r = await page.evaluate(
      async ({ qs, width, height }: { qs: string[]; width: number; height: number }) => {
        await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
        if (window.innerWidth !== width || window.innerHeight !== height) throw new Error(`viewport ${window.innerWidth}x${window.innerHeight}, wanted ${width}x${height}`);
        return qs.map((q) => (matchMedia(q).matches ? '1' : '0'));
      },
      { qs: texts, width, height },
    );
    r.forEach((b: string, k: number) => (bits[k] += b));
  }
  return { mediaText, bits };
}

const browser = await launchChrome();
const byRoot = new Map<number, { mediaText: string[]; bits: string[] }>();
let chrome: string;
try {
  chrome = browser.version();
  for (const root of corpus.roots) {
    const html = `<!DOCTYPE html><html style="font-size:${root}px"><head></head><body></body></html>`;
    const page = await openPage(browser, html, { viewport: corpus.defaultViewport, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' });
    const size = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    if (size !== `${root}px`) throw new Error(`root font size ${size}, wanted ${root}px`);
    byRoot.set(root, await sweep(page));
    await page.context().close();
  }
} finally {
  await browser.close();
}
if (chrome !== CHROME_VERSION) throw new Error(`Chrome must be ${CHROME_VERSION}, got ${chrome}`);

const first = byRoot.get(corpus.roots[0] as number) as { mediaText: string[] };
for (const [root, r] of byRoot) {
  r.mediaText.forEach((t, k) => {
    if (t !== first.mediaText[k]) throw new Error(`mediaText of ${texts[k]} differs at root ${root}px`);
  });
}
const entry = (k: number): { mediaText: string; matches: Record<string, string> } => ({
  mediaText: first.mediaText[k] as string,
  matches: Object.fromEntries(corpus.roots.map((r) => [String(r), (byRoot.get(r) as { bits: string[] }).bits[k] as string])),
});
let k = 0;
const capture = {
  chrome,
  roots: corpus.roots,
  points,
  queries: queries.map((query) => ({ query, ...entry(k++) })),
  bands: sheets.map((s) => ({ sheet: s.sheet, conditions: s.texts.map((text) => ({ text, ...entry(k++) })) })),
};

const out = `${JSON.stringify(capture, null, 1)}\n`;
const path = repoPath(CAPTURE_PATH);
const summary = `${capture.queries.length} queries, ${capture.bands.length} band sheets, ${points.length} viewports, roots ${corpus.roots.join(' and ')}px`;
if (check) {
  let current = '';
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = '';
  }
  if (current !== out) {
    console.error(`media capture differs from ${CAPTURE_PATH}; rerun without --check`);
    process.exit(1);
  }
  console.log(`media capture unchanged: ${summary}`);
} else {
  writeFileSync(path, out);
  console.log(`wrote ${CAPTURE_PATH}: ${summary}`);
}
