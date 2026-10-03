// Scroll metrics (OVFL, notes/T046-paint-spec.md §5.8): Chrome's scrollWidth, scrollHeight, clientWidth and clientHeight of every
// scroll container and of the viewport (document.scrollingElement), captured under chromeArgsAt at DPR 1, 2, 3 and 2.625 into
// packages/parity/expected-scroll/<platform>/dpr-<N>/<case>.scroll.json, and the engine's (packages/layout/src/overflow.ts)
// converted to the integers CSSOM View §4 reports, with Chrome 145.0.7632.6's two rounding formulas as measured (ports.json
// references: core/dom/element.cc lines 2593-2935, core/layout/adjust_for_absolute_zoom.h lines 44-57).
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import type { EngineFaults, LayoutBox, LayoutInput, LU } from '@dragon/layout';
import { measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import type { Compiled, Environment } from 'dragon';
import { iosLayoutProjection, NO_FAULTS } from 'dragon';
import type { ScrollMetrics } from '../../layout/src/overflow.ts';
import { scrollMetricsWithFaults } from '../../layout/src/overflow.ts';
import type { ParityCase } from './cases.ts';
import { CHROME_VERSION, openPage } from './chrome.ts';
import type { FixtureSpec } from './fixtures.ts';
import { dprLabel, layoutCases } from './dpr.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { compileFixture } from './pipeline.ts';

/** The pixel ratios the metrics are captured and compared at: DPR 1 and every device DPR. */
export const SCROLL_DPRS: readonly number[] = [1, 2, 3, 2.625];

/** The fixture groups whose cases carry scroll metrics. */
export const SCROLL_FIXTURE_PREFIXES: readonly string[] = ['overflow-', 'viewport-prop-', 'scroll-'];

/** One scroll container's metrics in CSS px, as Element reports them; id "viewport" is document.scrollingElement. */
export type ScrollRecord = { readonly id: string; readonly scrollWidth: number; readonly scrollHeight: number; readonly clientWidth: number; readonly clientHeight: number };

export type ScrollCapture = {
  readonly case: string;
  readonly chrome: string;
  readonly platform: string;
  readonly devicePixelRatio: number;
  readonly direction: 'ltr' | 'rtl';
  /** The viewport first, then every element that is a scroll container in document order. */
  readonly records: readonly ScrollRecord[];
};

export const expectedScrollDir = (dpr: number, platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-scroll/${platform}/${dprLabel(dpr)}`);
export const expectedScrollPath = (caseId: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${expectedScrollDir(dpr, platform)}/${caseId}.scroll.json`;

/** Whether a layout fixture's cases carry scroll metrics. */
export function hasScrollMetrics(spec: FixtureSpec): boolean {
  return spec.kind === 'layout' && SCROLL_FIXTURE_PREFIXES.some((p) => spec.id.startsWith(p));
}

/** The cases with scroll metrics, in fixture order. */
export function scrollCases(): { readonly spec: FixtureSpec; readonly cases: readonly ParityCase[] }[] {
  return layoutCases().filter((f) => hasScrollMetrics(f.spec));
}

/**
 * Captures one case: the viewport, then every element whose used overflow makes it a scroll container. html or body, whichever
 * the viewport took its overflow from (css-overflow-3 §3.3: html when it is not visible, else body), uses visible and is skipped.
 */
export async function captureScrollMetrics(browser: Browser, caseId: string, html: string, env: Environment): Promise<ScrollCapture> {
  const page = await openPage(browser, html, env);
  try {
    const records = await page.evaluate(() => {
      const out: ScrollRecord[] = [];
      const scroller = document.scrollingElement;
      if (scroller === null) throw new Error('no scrolling element');
      out.push({ id: 'viewport', scrollWidth: scroller.scrollWidth, scrollHeight: scroller.scrollHeight, clientWidth: scroller.clientWidth, clientHeight: scroller.clientHeight });
      const visible = (el: Element): boolean => {
        const cs = getComputedStyle(el);
        return cs.overflowX === 'visible' && cs.overflowY === 'visible';
      };
      const root = document.documentElement;
      const propagated = !visible(root) ? root : document.body !== null && !visible(document.body) ? document.body : null;
      for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
        if (el === propagated) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || !['hidden', 'auto', 'scroll'].includes(cs.overflowX)) continue;
        out.push({ id: el.getAttribute('data-dragon-id') as string, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight });
      }
      return out;
    });
    return { case: caseId, chrome: CHROME_VERSION, platform: REFERENCE_PLATFORM, devicePixelRatio: env.devicePixelRatio, direction: env.direction, records };
  } finally {
    await page.context().close();
  }
}

export function scrollCaptureJson(c: ScrollCapture): string {
  return `${JSON.stringify(c, null, 1)}\n`;
}

const isRecordArray = (v: unknown): v is ScrollRecord[] =>
  Array.isArray(v) && v.every((r) => typeof r === 'object' && r !== null && typeof (r as ScrollRecord).id === 'string' && ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'].every((k) => Number.isInteger((r as Record<string, unknown>)[k])));

/** A committed capture, checked for its shape, its case and its DPR. */
export function committedScrollCapture(caseId: string, dpr: number): ScrollCapture {
  const v = JSON.parse(readFileSync(expectedScrollPath(caseId, dpr), 'utf8')) as Record<string, unknown>;
  if (v['case'] !== caseId || v['devicePixelRatio'] !== dpr || v['chrome'] !== CHROME_VERSION || !isRecordArray(v['records'])) throw new Error(`${expectedScrollPath(caseId, dpr)} is not a scroll capture of ${caseId} at DPR ${dpr}`);
  const records = v['records'];
  if (records[0]?.id !== 'viewport') throw new Error(`${caseId} at DPR ${dpr}: the first record is not the viewport`);
  return v as unknown as ScrollCapture;
}

// ---------------------------------------------------------------- Blink's integer conversions

const f32 = Math.fround;

/** LayoutUnit::Round: half up, on the raw 1/64 value. */
function roundLu(raw: number): number {
  return Math.floor((raw + 32) / 64);
}

/** AdjustForAbsoluteZoom::AdjustLayoutUnit then LayoutUnit::Round: LayoutUnit(float(v) / zoom), truncating, then rounded. */
export function adjustLayoutUnitRound(v: LU, zoom: number): number {
  if (zoom === 1) return roundLu(v);
  const q = f32(f32(v / 64) / f32(zoom));
  return roundLu(Math.trunc(f32(q * 64)));
}

/** AdjustForAbsoluteZoom::AdjustInt: (value + 0.5) / zoom in float, then RoundForImpreciseConversion (+0.01, truncated). */
export function adjustInt(value: number, zoom: number): number {
  if (zoom === 1) return value;
  const fv = f32(value + (zoom > 1 ? (value < 0 ? -0.5 : 0.5) : 0));
  const d = f32(fv / f32(zoom));
  return Math.trunc(d + (d < 0 ? -0.01 : 0.01));
}

/** An element scroll container's record: its overflow rect and client size, each AdjustLayoutUnit and rounded. */
export function elementRecord(m: ScrollMetrics, zoom: number): ScrollRecord {
  return { id: m.id, scrollWidth: adjustLayoutUnitRound(m.scrollRect.width, zoom), scrollHeight: adjustLayoutUnitRound(m.scrollRect.height, zoom), clientWidth: adjustLayoutUnitRound(m.clientWidth, zoom), clientHeight: adjustLayoutUnitRound(m.clientHeight, zoom) };
}

/** The viewport's record: the contents size pixel-snapped at origin 0 and the layout size, each AdjustInt. */
export function viewportRecord(m: ScrollMetrics, zoom: number): ScrollRecord {
  return { id: 'viewport', scrollWidth: adjustInt(roundLu(m.scrollRect.width), zoom), scrollHeight: adjustInt(roundLu(m.scrollRect.height), zoom), clientWidth: adjustInt(roundLu(m.clientWidth), zoom), clientHeight: adjustInt(roundLu(m.clientHeight), zoom) };
}

/**
 * The viewport's direction as Chrome propagates it: body's (the root's child with id body in the fixtures), else the root's.
 * The compiler's viewportOverflow() decides the same from the resolved tree.
 */
export function viewportDirectionOf(input: LayoutInput): 'ltr' | 'rtl' {
  const body = input.root.children.find((c): c is LayoutBox => c.kind === 'box' && c.id === 'body');
  return (body === undefined ? input.root : body).style.direction;
}

export type EngineScroll = { readonly kind: 'ok'; readonly records: readonly ScrollRecord[] } | { readonly kind: 'fail'; readonly reason: string };

/** The engine's records of one case at a DPR, in the capture's order (viewport first, then input preorder). */
export function engineScrollRecords(c: ParityCase, compiled: Compiled<'ios' | 'web'>, dpr: number, faults: EngineFaults = NO_ENGINE_FAULTS): EngineScroll {
  const env = { ...c.environment, devicePixelRatio: dpr };
  const projection = iosLayoutProjection(compiled, env, c.assignment);
  if (projection.kind === 'blocked') return { kind: 'fail', reason: `ios projection blocked: ${projection.reason}` };
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) return { kind: 'fail', reason: `layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}` };
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') return { kind: 'fail', reason: `${m.code}: ${m.detail}` };
  const r = scrollMetricsWithFaults(validated.input, m.measurer, viewportDirectionOf(validated.input), faults);
  if (r.kind === 'refused') return { kind: 'fail', reason: `scroll metrics refused at ${r.nodeId}: ${r.detail}` };
  return { kind: 'ok', records: [viewportRecord(r.viewport, dpr), ...r.containers.map((x) => elementRecord(x, dpr))] };
}

/** Every difference between the engine's records and Chrome's: a missing or extra container, or any differing number. */
export function scrollProblems(engine: readonly ScrollRecord[], chrome: readonly ScrollRecord[]): string[] {
  const out: string[] = [];
  const ids = (rs: readonly ScrollRecord[]): string => rs.map((r) => r.id).join(',');
  if (ids(engine) !== ids(chrome)) out.push(`scroll containers: engine [${ids(engine)}], chrome [${ids(chrome)}]`);
  for (const e of engine) {
    const c = chrome.find((x) => x.id === e.id);
    if (c === undefined) continue;
    for (const k of ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'] as const) if (e[k] !== c[k]) out.push(`${e.id} ${k}: engine ${e[k]}, chrome ${c[k]}`);
  }
  return out;
}

/** The compiled fixture of each scroll case's direction, compiled once. */
export function compiledScrollFixture(spec: FixtureSpec, direction: Environment['direction']): Compiled<'ios' | 'web'> {
  return compileFixture(spec, NO_FAULTS, 'enforce', direction).compiled;
}
