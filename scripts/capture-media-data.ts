// Captures Chrome's matchMedia and mediaText for the media query corpus and for every band condition band() derives,
// at each viewport derived from the corpus thresholds, on pages whose root font size is 16px and 20px. The fractional part
// (MQ-R0, notes/T067 §4) evaluates its rows inside iframes of exact device px and emulated main frames at DPR 1, 2, 2.625 and 3.
// Writes packages/dragon/test/media/captures/chrome-145.json; --check requires a byte-identical recapture.
// Run with: node --conditions=dragon-internal scripts/capture-media-data.ts [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { band, bandAt, contains, emulatedMediaViewport, featuresOfList, INITIAL_FONT_SIZE, mediaSize, mediaViewport, parseMediaQueryList, resolveLength } from '../packages/dragon/src/media/index.ts';
import type { Band, BandPartition, Interval, MediaQueryList, MediaValue } from '../packages/dragon/src/media/index.ts';

type Corpus = {
  readonly roots: readonly number[];
  readonly defaultViewport: Viewport;
  readonly limits: ViewportLimits;
  readonly queries: readonly string[];
  readonly refusedQueries: readonly string[];
  readonly bandSheets: readonly { readonly name: string; readonly queries: readonly string[]; readonly refused?: string }[];
  readonly fractional: {
    readonly viewport: Viewport;
    readonly iframes: readonly (readonly [number, number, number])[];
    readonly mainFrames: readonly (readonly [number, number, number])[];
    readonly queries: readonly string[];
    readonly bandSheets: readonly { readonly name: string; readonly queries: readonly string[] }[];
  };
};
/** A fractional frame: an iframe of whole device px, or an emulated main frame of CSS px, at a DPR. */
type Frame = { readonly kind: 'iframe' | 'main'; readonly width: number; readonly height: number; readonly dpr: number };
/** The media viewport Chrome evaluates in a frame (R3). */
const frameViewport = (f: Frame): Viewport => (f.kind === 'iframe' ? mediaViewport(f, f.dpr) : emulatedMediaViewport(f, f.dpr));
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

/**
 * An integer inside a band's intervals: the midpoint of the first bounded one that holds one, else 100 past an unbounded start.
 * The midpoint is taken between the authored thresholds, so the 1/64 px slack of an end does not move the sample.
 */
function integerIn(intervals: readonly Interval[], fallback: number): number | null {
  const only = intervals[0];
  if (intervals.length === 1 && only !== undefined && only.lo === 0 && only.loInclusive && only.hi === Infinity) return fallback;
  for (const i of intervals) {
    if (i.hi === Infinity) return Math.floor(i.nominalLo) + 100;
    const mid = Math.floor((i.nominalLo + i.nominalHi) / 2);
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


// The fractional part. A band sheet adds, for every band no listed frame lies in, the first whole-px DPR 1 iframe inside it
// among sizes near its thresholds (zero included, since only a zero-size frame reaches some ratio bands).
function aroundAll(values: readonly number[]): number[] {
  return values.filter(Number.isFinite).flatMap((v) => [Math.floor(v) - 1, Math.floor(v), Math.ceil(v), Math.ceil(v) + 1]).filter((v) => v >= 0);
}

function wholeSampleIn(partition: Extract<BandPartition, { kind: 'bands' }>, b: Band, base: Viewport): [number, number] {
  const ends = (axis: 'width' | 'height'): number[] => partition.bands.flatMap((x) => x[axis].flatMap((i) => [i.nominalLo, i.nominalHi]));
  const widths0 = [...new Set([base.width, 0, ...aroundAll(ends('width'))])];
  const heights0 = [...new Set([base.height, 0, ...aroundAll(ends('height'))])];
  const ratios = partition.atoms.flatMap((a) => (a.axis !== 'ratio' ? [] : a.feature.base === 'orientation' ? [1] : [a.feature.value, a.feature.left?.value, a.feature.right?.value].flatMap((v) => (v?.kind === 'ratio' && v.den !== 0 && v.num !== 0 ? [v.num / v.den] : []))));
  const widths = [...new Set([...widths0, ...heights0.flatMap((h) => aroundAll(ratios.map((r) => h * r)))])];
  const heights = [...new Set([...heights0, ...widths0.flatMap((w) => aroundAll(ratios.map((r) => w / r)))])];
  for (const width of widths) for (const height of heights) if (bandAt(partition, { width, height })?.index === b.index) return [width, height];
  throw new Error(`band ${b.index} (${b.condition}) holds no whole-px viewport near its thresholds`);
}

const fractional = corpus.fractional;
const listed: Frame[] = [
  ...fractional.iframes.map(([width, height, dpr]): Frame => ({ kind: 'iframe', width, height, dpr })),
  ...fractional.mainFrames.map(([width, height, dpr]): Frame => ({ kind: 'main', width, height, dpr })),
];
const fracSheets = fractional.bandSheets.map((s) => {
  const partition = band(s.queries.map((q) => parseMediaQueryList(q)));
  if (partition.kind !== 'bands') throw new Error(`fractional band sheet ${s.name} is refused: ${partition.detail}`);
  const reached = (b: Band): boolean => listed.some((f) => bandAt(partition, frameViewport(f))?.index === b.index);
  const samples = partition.bands.filter((b) => !reached(b)).map((b) => wholeSampleIn(partition, b, corpus.defaultViewport));
  return { sheet: s.name, texts: partition.bands.map((b) => b.condition), samples };
});
const frames: Frame[] = [];
const addFrame = (f: Frame): void => {
  if (!frames.some((g) => g.kind === f.kind && g.width === f.width && g.height === f.height && g.dpr === f.dpr)) frames.push(f);
};
for (const f of listed.filter((g) => g.kind === 'iframe')) addFrame(f);
for (const [width, height] of fracSheets.flatMap((s) => s.samples)) addFrame({ kind: 'iframe', width, height, dpr: 1 });
for (const f of listed.filter((g) => g.kind === 'main')) addFrame(f);
for (const f of frames) {
  if (!Number.isInteger(f.width) || !Number.isInteger(f.height) || f.width < 0 || f.height < 0) throw new Error(`frame ${JSON.stringify(f)} is not whole px`);
  if (!(f.dpr > 0)) throw new Error(`frame ${JSON.stringify(f)} has no positive DPR`);
}
const fracTexts = [...fractional.queries, ...fracSheets.flatMap((s) => s.texts)];

/** Strict comparisons are exact (M2), so a media size strictly between the neighbours' proves the iframe has exactly px device px. */
function exactly(axis: 'width' | 'height', px: number, dpr: number): string {
  const at = (n: number): number => mediaSize(n, dpr);
  const hi = `(${axis} < ${(at(px) + at(px + 1)) / 2}px)`;
  return px === 0 ? hi : `(${axis} > ${(at(px - 1) + at(px)) / 2}px) and ${hi}`;
}

async function sweepFrames(dpr: number, own: readonly Frame[]): Promise<Map<Frame, string>> {
  const out = new Map<Frame, string>();
  const browser = await launchChrome(dpr);
  try {
    if (browser.version() !== CHROME_VERSION) throw new Error(`Chrome must be ${CHROME_VERSION}, got ${browser.version()}`);
    const context = await browser.newContext({ viewport: fractional.viewport, deviceScaleFactor: dpr });
    try {
      const page = await context.newPage();
      for (const f of own) {
        let bits: string[];
        if (f.kind === 'iframe') {
          await page.setViewportSize(fractional.viewport);
          await page.setContent(`<!DOCTYPE html><html><body style="margin:0"><iframe style="border:0;display:block;width:${f.width / dpr}px;height:${f.height / dpr}px" srcdoc="<!DOCTYPE html><html><body></body></html>"></iframe></body></html>`);
          const handle = await page.waitForSelector('iframe', { state: 'attached' });
          const frame = await handle.contentFrame();
          if (frame === null) throw new Error(`no iframe document for ${JSON.stringify(f)}`);
          await frame.waitForLoadState('load');
          bits = await frame.evaluate(
            async ({ qs, checks }: { qs: string[]; checks: string[] }) => {
              await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
              for (const c of checks) if (!matchMedia(c).matches) throw new Error(`iframe fails ${c}`);
              return qs.map((q) => (matchMedia(q).matches ? '1' : '0'));
            },
            { qs: fracTexts, checks: [exactly('width', f.width, dpr), exactly('height', f.height, dpr)] },
          );
        } else {
          await page.setContent('<!DOCTYPE html><html><body></body></html>');
          await page.setViewportSize({ width: f.width, height: f.height });
          bits = await page.evaluate(
            async ({ qs, width, height }: { qs: string[]; width: number; height: number }) => {
              await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
              if (window.innerWidth !== width || window.innerHeight !== height) throw new Error(`viewport ${window.innerWidth}x${window.innerHeight}, wanted ${width}x${height}`);
              return qs.map((q) => (matchMedia(q).matches ? '1' : '0'));
            },
            { qs: fracTexts, width: f.width, height: f.height },
          );
        }
        out.set(f, bits.join(''));
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return out;
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

const frameBits = new Map<Frame, string>();
for (const dpr of [...new Set(frames.map((f) => f.dpr))].sort((a, b) => a - b)) {
  for (const [f, bits] of await sweepFrames(dpr, frames.filter((g) => g.dpr === dpr))) frameBits.set(f, bits);
}
const fracMediaText = await (async () => {
  const b = await launchChrome();
  try {
    const page = await openPage(b, '<!DOCTYPE html><html><head></head><body></body></html>', { viewport: corpus.defaultViewport, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' });
    return await page.evaluate((qs: string[]) => qs.map((q) => matchMedia(q).media), fracTexts);
  } finally {
    await b.close();
  }
})();
/** One row's bit per frame, in frame order. */
const fracEntry = (k: number): { mediaText: string; matches: string } => ({
  mediaText: fracMediaText[k] as string,
  matches: frames.map((f) => (frameBits.get(f) as string)[k]).join(''),
});

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
  fractional: (() => {
    let j = 0;
    return {
      frames: frames.map((f) => [f.kind, f.width, f.height, f.dpr]),
      queries: fractional.queries.map((query) => ({ query, ...fracEntry(j++) })),
      bands: fracSheets.map((s) => ({ sheet: s.sheet, conditions: s.texts.map((text) => ({ text, ...fracEntry(j++) })) })),
    };
  })(),
};

const out = `${JSON.stringify(capture, null, 1)}\n`;
const path = repoPath(CAPTURE_PATH);
const summary = `${capture.queries.length} queries, ${capture.bands.length} band sheets, ${points.length} viewports, roots ${corpus.roots.join(' and ')}px; fractional: ${capture.fractional.queries.length} queries, ${capture.fractional.bands.length} band sheets, ${frames.length} frames`;
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
