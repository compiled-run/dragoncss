// The web band sweep (notes/T025 §3 B item 8): every fixture of the media group rendered in Chrome, authored and compiled, at a
// sample width inside every @media band and at each side of every band boundary. Dragon's web output is one stylesheet for all
// widths, so each rendering pair must have equal boxes, computed values and colour channels (the chrome-dual comparison).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import type { CompilerFaults, Environment, FrontEndResult } from 'dragon';
import { createProjectWith, NO_FAULTS, resolvedColors, resolvedTextColors, WEB_CSS_PATH, webClassMap } from 'dragon';
import type { Band, BandPartition } from '../../dragon/src/media/index.ts';
import { band, bandAt, parseMediaQueryList } from '../../dragon/src/media/index.ts';
import { captureFixture } from './capture.ts';
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

/** Whole-px values of one axis: each side of every finite interval end, and one value inside each interval. */
function axisSamples(intervals: readonly Band['width'][number][]): number[] {
  const out = new Set<number>();
  for (const i of intervals) {
    for (const e of [i.lo, i.hi]) {
      if (!Number.isFinite(e) || e === 0) continue;
      for (const n of [Math.floor(e) - 1, Math.floor(e), Math.ceil(e), Math.ceil(e) + 1]) if (inRange(n)) out.add(n);
    }
    const hi = Number.isFinite(i.hi) ? i.hi : i.lo + 200;
    const mid = Math.floor((i.lo + hi) / 2);
    for (const n of [mid, mid + 1]) {
      if (inRange(n) && (n > i.lo || (i.loInclusive && n === i.lo)) && (n < i.hi || (i.hiInclusive && n === i.hi))) {
        out.add(n);
        break;
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The sweep's viewports: every width sample at the fixture height, and every height sample at the fixture width (an axis
 * without atoms has none), each with the band it lies in. Every band must hold at least one sample.
 */
export function sampleViewports(partition: Partition, base: Viewport): { readonly samples: readonly (Viewport & { readonly band: number })[]; readonly unsampled: readonly number[] } {
  const on = (axis: 'width' | 'height'): number[] => (partition.atoms.some((a) => a.axis === axis) ? axisSamples(partition.bands.flatMap((b) => b[axis])) : []);
  const viewports = [...on('width').map((width) => ({ width, height: base.height })), ...on('height').map((height) => ({ width: base.width, height }))];
  const seen = new Set<string>();
  const samples: (Viewport & { band: number })[] = [];
  // A sheet whose @media rules have no width or height atom has one band, sampled at the fixture viewport.
  for (const v of viewports.length === 0 ? [base] : viewports) {
    const key = `${v.width}x${v.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = bandAt(partition, v);
    if (at === null) throw new Error(`no band holds ${key}`);
    samples.push({ ...v, band: at.index });
  }
  const unsampled = partition.bands.filter((b) => !samples.some((s) => s.band === b.index)).map((b) => b.index);
  return { samples, unsampled };
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
    const { samples: viewports, unsampled } = sampleViewports(partition, env.viewport);
    if (unsampled.length > 0) {
      records.push({ ...empty, bands, problem: `no whole-px viewport in ${SWEEP_RANGE.min}-${SWEEP_RANGE.max} lies in band ${unsampled.join(', ')}` });
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
      const base = { width: v.width, height: v.height, band: v.band };
      if (css === null || classOf === null || colors === null || textColors === null) {
        samples.push({ ...base, pass: false, boxesCompared: 0, valuesCompared: 0, channelsCompared: 0, problems: [`web output not ready: ${compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`] });
        continue;
      }
      const body = css.slice(css.indexOf('\n') + 1);
      if (firstBody === null) firstBody = body;
      const id = `${spec.id}${directionSuffix(env.direction)}@${v.width}x${v.height}`;
      const authored = await captureFixture(browser, id, html, at);
      const compiledCapture = await captureFixture(browser, id, compiledFixtureHtml(html, css, classOf), at);
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
  const committed = (() => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  })();
  for (const f of committed) if (!names.has(`${dir}/${f}`)) problems.push(`${EXPECTED_MEDIA_DIR}/${f} is committed but no fixture of the media group produced it`);
  for (const r of records) {
    let text: string | null = null;
    try {
      text = readFileSync(recordPath(r), 'utf8');
    } catch {
      text = null;
    }
    if (text === null) problems.push(`${recordPath(r)} is not committed`);
    else if (text !== recordJson(r)) problems.push(`${recordPath(r)} differs from the sweep`);
  }
  return problems;
}
