// The web band sweep (notes/T025 §3 B item 8): every fixture of the media group rendered in Chrome, authored and compiled, at a
// sample width inside every @media band and at each side of every band boundary, orientation and aspect-ratio ones included.
// Dragon's web output is one stylesheet for all widths, so each rendering pair must have equal boxes, computed values and colour
// channels (the chrome-dual comparison).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { CompilerFaults, Environment, FrontEndResult } from 'dragon';
import { createProjectWith, NO_FAULTS, resolvedColors, resolvedTextColors, WEB_CSS_PATH, webClassMap } from 'dragon';
import type { Band, BandPartition } from '../../dragon/src/media/index.ts';
import { band, bandAt, contains, mediaSize, mediaViewport, parseMediaQueryList } from '../../dragon/src/media/index.ts';
import { captureFixture, captureFixtureInFrame } from './capture.ts';
import type { ZoomedFrame } from './capture.ts';
import { CHROME_VERSION } from './chrome.ts';
import { compareDual } from './dual.ts';
import { compiledFixtureHtml, PROJECT_ID, readHtmlFixture } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { directionSuffix, environmentsOf, FIXTURE_GROUPS } from './fixtures.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';

export const MEDIA_GROUP = 'media';
/** Chrome viewports are whole CSS px; samples stay inside this range. */
export const SWEEP_RANGE = { min: 1, max: 2000 } as const;
export const EXPECTED_MEDIA_DIR = 'packages/parity/expected-media';

type Partition = Extract<BandPartition, { kind: 'bands' }>;
type Viewport = { readonly width: number; readonly height: number };

export type SweepSample = {
  readonly width: number;
  readonly height: number;
  /** MQ-R0: set for a band no whole-px viewport lies in, sampled in an iframe of exact device px at a zoom (width and height are then its media size). */
  readonly frame?: ZoomedFrame;
  readonly band: number;
  readonly pass: boolean;
  readonly boxesCompared: number;
  readonly valuesCompared: number;
  readonly channelsCompared: number;
  readonly problems: readonly string[];
};

export type SweepRecord = {
  readonly fixture: string;
  readonly direction: Environment['direction'];
  readonly chrome: string;
  readonly bands: readonly { readonly index: number; readonly condition: string }[];
  readonly samples: readonly SweepSample[];
  /** Why the fixture could not be swept (no @media, a refused partition, a band no whole-px viewport reaches), or null. */
  readonly problem: string | null;
};

/** The media group's layout fixtures; every one must be an HTML fixture. */
export function mediaFixtures(): FixtureSpec[] {
  const group = FIXTURE_GROUPS.find((g) => g.id === MEDIA_GROUP);
  if (group === undefined) throw new Error(`fixture group ${MEDIA_GROUP} is not registered`);
  const layout = group.fixtures.filter((f) => f.kind === 'layout');
  if (layout.length === 0) throw new Error(`fixture group ${MEDIA_GROUP} has no layout fixture to sweep`);
  for (const f of layout) if (f.format !== 'html') throw new Error(`${f.id}: the media sweep reads HTML fixtures only`);
  return layout;
}

/** The fixture's stylesheet text, from its FrontEndResult. */
function sheetText(input: FrontEndResult): string {
  const styles = input.tree === null ? [] : input.tree.styles;
  const [style] = styles;
  if (style === undefined || styles.length !== 1) throw new Error('a media fixture has exactly one stylesheet');
  const src = input.snapshot.sources.find((s) => s.ref.uri === style.css.source.uri);
  if (src === undefined) throw new Error(`no source ${style.css.source.uri}`);
  return src.text.slice(style.css.start, style.css.end);
}

/** The band partition of every @media prelude in a stylesheet, parsed from the authored text. */
export function partitionOf(css: string): BandPartition | null {
  const lists: ReturnType<typeof parseMediaQueryList>[] = [];
  const children = (node: CssNode | null | undefined): CssNode[] => {
    const c = node?.['children'] as { toArray(): CssNode[] } | null | undefined;
    return c === null || c === undefined ? [] : c.toArray();
  };
  const visit = (node: CssNode): void => {
    if (node.type === 'Atrule' && String(node['name']).toLowerCase() === 'media') {
      const loc = (node['prelude'] as CssNode | null | undefined)?.loc;
      lists.push(parseMediaQueryList(loc === null || loc === undefined ? '' : css.slice(loc.start.offset, loc.end.offset)));
    }
    for (const c of [...children(node), ...children(node['block'] as CssNode | null | undefined)]) visit(c);
  };
  visit(parse(css, { positions: true }));
  return lists.length === 0 ? null : band(lists);
}

const inRange = (n: number): boolean => n >= SWEEP_RANGE.min && n <= SWEEP_RANGE.max;

/**
 * Whole-px values of one axis: each side of every finite interval end, and one value inside each interval. Ends are read at the
 * authored thresholds (an end sits up to 1/64 px from its threshold), so the samples are the same whole px either way.
 */
function axisSamples(intervals: readonly Band['width'][number][]): number[] {
  const out = new Set<number>();
  for (const i of intervals) {
    for (const e of [i.nominalLo, i.nominalHi]) {
      if (!Number.isFinite(e) || e === 0) continue;
      for (const n of [Math.floor(e) - 1, Math.floor(e), Math.ceil(e), Math.ceil(e) + 1]) if (inRange(n)) out.add(n);
    }
    const hi = Number.isFinite(i.nominalHi) ? i.nominalHi : i.nominalLo + 200;
    const mid = Math.floor((i.nominalLo + hi) / 2);
    for (const n of [mid, mid + 1]) {
      if (inRange(n) && contains(i, n)) {
        out.add(n);
        break;
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The width/height ratios where the orientation and aspect-ratio atoms change (1 for orientation). */
function ratioBoundaries(partition: Partition): number[] {
  const values = partition.atoms.flatMap((a) => {
    if (a.axis !== 'ratio' || a.feature.form === 'boolean') return [];
    if (a.feature.base === 'orientation') return [1];
    return [a.feature.value, a.feature.left?.value, a.feature.right?.value].flatMap((v) => (v?.kind === 'ratio' && v.num > 0 && v.den > 0 ? [v.num / v.den] : []));
  });
  return [...new Set(values)];
}

const around = (v: number): number[] => [Math.floor(v) - 1, Math.floor(v), Math.ceil(v), Math.ceil(v) + 1].filter(inRange);

/**
 * The sweep's viewports: the cross product of the width samples and the height samples, so a band that needs both axes, and every
 * corner where a width and a height boundary meet, is sampled. An axis without atoms takes the fixture's value only. With ratio
 * atoms (orientation, aspect-ratio), each width sample adds the heights around each ratio boundary and each height sample the
 * widths around it. Each viewport carries the band it lies in; every band must hold at least one (the caller fails a band that
 * none reaches).
 */
export function sampleViewports(partition: Partition, base: Viewport): { readonly samples: readonly (Viewport & { readonly band: number })[]; readonly unsampled: readonly number[] } {
  const on = (axis: 'width' | 'height'): number[] => (partition.atoms.some((a) => a.axis === axis) ? axisSamples(partition.bands.flatMap((b) => b[axis])) : [base[axis]]);
  const ratios = ratioBoundaries(partition);
  const [widths0, heights0] = [on('width'), on('height')];
  const sorted = (xs: number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);
  const widths = sorted([...widths0, ...heights0.flatMap((h) => ratios.flatMap((r) => around(h * r)))]);
  const heights = sorted([...heights0, ...widths0.flatMap((w) => ratios.flatMap((r) => around(w / r)))]);
  const samples: (Viewport & { band: number })[] = [];
  for (const width of widths) {
    for (const height of heights) {
      const at = bandAt(partition, { width, height });
      if (at === null) throw new Error(`no band holds ${width}x${height}`);
      samples.push({ width, height, band: at.index });
    }
  }
  const unsampled = partition.bands.filter((b) => !samples.some((s) => s.band === b.index)).map((b) => b.index);
  return { samples, unsampled };
}

/** The zoom of a fractional sample's frame: its media size moves in 1/128 px steps, finer than Chrome's 1/64 px slack. */
export const FRAME_ZOOM = 128;

/**
 * MQ-R0: a sample for each band no whole-px viewport lies in (a band between a threshold and its 1/64 px slack): the first
 * frame of whole device px at FRAME_ZOOM, near the band's ends, whose media size lies in the band.
 */
export function fractionalSamples(partition: Partition, base: Viewport, bands: readonly number[]): { readonly samples: readonly (Viewport & { readonly band: number; readonly frame: ZoomedFrame })[]; readonly unsampled: readonly number[] } {
  const samples: (Viewport & { band: number; frame: ZoomedFrame })[] = [];
  const unsampled: number[] = [];
  const near = (axis: 'width' | 'height', b: Band): number[] => {
    if (!partition.atoms.some((a) => a.axis === axis)) return [Math.round(base[axis] * FRAME_ZOOM)];
    const xs = b[axis].flatMap((i) => [i.lo, ...(Number.isFinite(i.hi) ? [i.hi, (i.lo + i.hi) / 2] : [i.lo + 1])]);
    const px = xs.flatMap((x) => [-2, -1, 0, 1, 2].map((d) => Math.round(x * FRAME_ZOOM) + d)).filter((n) => n >= 0 && inRange(mediaSize(n, FRAME_ZOOM)));
    return [...new Set(px)].sort((x, y) => x - y);
  };
  for (const index of bands) {
    const b = partition.bands[index] as Band;
    let found: (Viewport & { band: number; frame: ZoomedFrame }) | null = null;
    for (const widthPx of near('width', b)) {
      for (const heightPx of near('height', b)) {
        const v = mediaViewport({ width: widthPx, height: heightPx }, FRAME_ZOOM);
        if (found === null && bandAt(partition, v)?.index === index) found = { ...v, band: index, frame: { widthPx, heightPx, zoom: FRAME_ZOOM } };
      }
    }
    if (found === null) unsampled.push(index);
    else samples.push(found);
  }
  return { samples, unsampled };
}

/** Media queries that hold only in a frame of exactly px device px at the zoom: strict comparisons are exact (M2). */
export function exactFrameChecks(frame: ZoomedFrame): string[] {
  const between = (axis: 'width' | 'height', px: number): string => {
    const at = (n: number): number => mediaSize(n, frame.zoom);
    const hi = `(${axis} < ${(at(px) + at(px + 1)) / 2}px)`;
    return px === 0 ? hi : `(${axis} > ${(at(px - 1) + at(px)) / 2}px) and ${hi}`;
  };
  return [between('width', frame.widthPx), between('height', frame.heightPx)];
}

/** Compiles the fixture with the sample as its fold viewport: the web CSS is the same at every sample, the resolved colours are the band's. */
function compileAt(input: FrontEndResult, direction: Environment['direction'], viewport: Viewport, faults: CompilerFaults) {
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { web: {} } }, { faults, profiles: 'enforce', direction, platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: viewport });
  const compiled = project.compile(input);
  const web = compiled.outputs.web;
  const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH)?.text : undefined;
  return { compiled, css: css === undefined ? null : css };
}

/** Sweeps one media fixture in each of its environments. */
export async function sweepFixture(spec: FixtureSpec, browser: Browser, faults: CompilerFaults = NO_FAULTS): Promise<SweepRecord[]> {
  const { html, input } = readHtmlFixture(spec.id);
  const partition = partitionOf(sheetText(input));
  const records: SweepRecord[] = [];
  for (const env of environmentsOf(spec)) {
    const empty = { fixture: spec.id, direction: env.direction, chrome: CHROME_VERSION, samples: [] };
    if (partition === null || partition.kind === 'refused') {
      records.push({ ...empty, bands: [], problem: partition === null ? 'the fixture has no @media rule' : `the band partition is refused: ${partition.detail}` });
      continue;
    }
    const bands = partition.bands.map((b) => ({ index: b.index, condition: b.condition }));
    const whole = sampleViewports(partition, env.viewport);
    const fractional = fractionalSamples(partition, env.viewport, whole.unsampled);
    const viewports: (Viewport & { readonly band: number; readonly frame?: ZoomedFrame })[] = [...whole.samples, ...fractional.samples];
    if (fractional.unsampled.length > 0) {
      records.push({ ...empty, bands, problem: `no whole-px viewport in ${SWEEP_RANGE.min}-${SWEEP_RANGE.max}, and no frame at zoom ${FRAME_ZOOM}, lies in band ${fractional.unsampled.join(', ')}` });
      continue;
    }
    const samples: SweepSample[] = [];
    let firstBody: string | null = null;
    for (const v of viewports) {
      const at: Environment = { ...env, viewport: { width: v.width, height: v.height } };
      const { compiled, css } = compileAt(input, env.direction, at.viewport, faults);
      const classOf = webClassMap(compiled, []);
      const colors = resolvedColors(compiled, []);
      const textColors = resolvedTextColors(compiled, []);
      const base = { width: v.width, height: v.height, ...(v.frame === undefined ? {} : { frame: v.frame }), band: v.band };
      if (css === null || classOf === null || colors === null || textColors === null) {
        samples.push({ ...base, pass: false, boxesCompared: 0, valuesCompared: 0, channelsCompared: 0, problems: [`web output not ready: ${compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`] });
        continue;
      }
      const body = css.slice(css.indexOf('\n') + 1);
      if (firstBody === null) firstBody = body;
      const id = `${spec.id}${directionSuffix(env.direction)}@${v.width}x${v.height}`;
      const frame = v.frame;
      const condition = (partition.bands[v.band] as Band).condition;
      const capture = (page: string): ReturnType<typeof captureFixture> =>
        frame === undefined ? captureFixture(browser, id, page, at) : captureFixtureInFrame(browser, id, page, { ...env }, frame, [...exactFrameChecks(frame), condition]);
      const authored = await capture(html);
      const compiledCapture = await capture(compiledFixtureHtml(html, css, classOf));
      const dual = compareDual(authored, compiledCapture, colors, textColors);
      const problems = [...(body === firstBody ? [] : ['the web CSS differs from the first sample\'s: it must not depend on the fold viewport']), ...dual.problems];
      samples.push({ ...base, pass: problems.length === 0, boxesCompared: dual.boxesCompared, valuesCompared: dual.valuesCompared, channelsCompared: dual.channelsCompared, problems });
    }
    records.push({ fixture: spec.id, direction: env.direction, chrome: CHROME_VERSION, bands, samples, problem: null });
  }
  return records;
}

export const recordPass = (r: SweepRecord): boolean => r.problem === null && r.samples.length > 0 && r.samples.every((s) => s.pass);

export const recordPath = (r: { readonly fixture: string; readonly direction: Environment['direction'] }): string => repoPath(`${EXPECTED_MEDIA_DIR}/${r.fixture}${directionSuffix(r.direction)}.json`);

export const recordJson = (r: SweepRecord): string => `${JSON.stringify(r, null, 1)}\n`;

/** Writes every record and removes any committed file no record names. */
export function writeRecords(records: readonly SweepRecord[]): void {
  const dir = repoPath(EXPECTED_MEDIA_DIR);
  mkdirSync(dir, { recursive: true });
  const names = new Set(records.map((r) => recordPath(r)));
  for (const f of readdirSync(dir)) if (!names.has(`${dir}/${f}`)) throw new Error(`${EXPECTED_MEDIA_DIR}/${f} is not a record of the media sweep; remove it by hand`);
  for (const r of records) writeFileSync(recordPath(r), recordJson(r));
}

/** The records that differ from the committed files, and committed files no record names. */
export function checkRecords(records: readonly SweepRecord[]): string[] {
  const problems: string[] = [];
  const dir = repoPath(EXPECTED_MEDIA_DIR);
  const names = new Set(records.map((r) => recordPath(r)));
  const missing = (e: unknown): boolean => (e as { code?: unknown }).code === 'ENOENT';
  const committed = (() => {
    try {
      return readdirSync(dir);
    } catch (e) {
      if (missing(e)) return [];
      throw e;
    }
  })();
  for (const f of committed) if (!names.has(`${dir}/${f}`)) problems.push(`${EXPECTED_MEDIA_DIR}/${f} is committed but no fixture of the media group produced it`);
  for (const r of records) {
    let text: string | null = null;
    try {
      text = readFileSync(recordPath(r), 'utf8');
    } catch (e) {
      if (!missing(e)) throw e;
    }
    if (text === null) problems.push(`${recordPath(r)} is not committed`);
    else if (text !== recordJson(r)) problems.push(`${recordPath(r)} differs from the sweep`);
  }
  return problems;
}
