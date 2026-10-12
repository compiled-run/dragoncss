// Scroll metrics (OVFL, notes/T046-paint-spec.md §5.8): Chrome's scrollWidth, scrollHeight, clientWidth and clientHeight of every
// scroll container and of the viewport (document.scrollingElement), captured under chromeArgsAt at DPR 1, 2, 3 and 2.625 into
// packages/parity/expected-scroll/<platform>/dpr-<N>/<case>.scroll.json, and the engine's (packages/layout/src/overflow.ts)
// converted to the integers CSSOM View §4 reports, with Chrome 145.0.7632.6's two rounding formulas as measured (ports.json
// references: core/dom/element.cc lines 2593-2935, core/layout/adjust_for_absolute_zoom.h lines 44-57).
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import type { EngineFaults, LayoutBox, LayoutInput, LU } from '@dragon/layout';
import { measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import type { Compiled, Environment } from 'dragon';
import { iosLayoutProjection, NO_FAULTS } from 'dragon';
import type { ScrollMetrics } from '../../layout/src/overflow.ts';
import { scrollMetricsWithFaults } from '../../layout/src/overflow.ts';
import type { ParityCase } from './cases.ts';
import { CHROME_VERSION, chromeArgsAt, openPage, PLAYWRIGHT_VERSION } from './chrome.ts';
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
  /** The scrollbar environment the capture checked (assertOverlayScrollbars); the reference is overlay. */
  readonly scrollbars: 'overlay';
  /** The macOS defaults arguments Chrome was launched with (launchOverlayChrome). */
  readonly scrollbarArgs: string;
  /** The viewport first, then every element that is a scroll container in document order. */
  readonly records: readonly ScrollRecord[];
  /** OVFL-B: every element scroll container's scroll offset range as Chrome clamps it, in document order (no viewport). */
  readonly extents: readonly ScrollExtent[];
};

/**
 * An element scroll container's scroll offset range in CSS px as Chrome reports it after scrollTo far past each end (CSSOM View
 * §4: scrollLeft and scrollTop clamp to the scrolling area; the start side is negative where the overflow extends past the
 * start, as in rtl or a reversed flex container). Each is a whole number of device px divided by the DPR.
 */
export type ScrollExtent = { readonly id: string; readonly minLeft: number; readonly maxLeft: number; readonly minTop: number; readonly maxTop: number };

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
    await assertOverlayScrollbars(page);
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
    // The element scroll containers are the records after the viewport, in document order.
    const extents = await page.evaluate((ids: string[]) => {
      const out: ScrollExtent[] = [];
      for (const id of ids) {
        const el = document.querySelector(`[data-dragon-id="${CSS.escape(id)}"]`);
        if (el === null) throw new Error(`no element ${id}`);
        el.scrollTo({ left: -1e7, top: -1e7, behavior: 'instant' });
        const minLeft = el.scrollLeft;
        const minTop = el.scrollTop;
        el.scrollTo({ left: 1e7, top: 1e7, behavior: 'instant' });
        const maxLeft = el.scrollLeft;
        const maxTop = el.scrollTop;
        el.scrollTo({ left: 0, top: 0, behavior: 'instant' });
        out.push({ id, minLeft, maxLeft, minTop, maxTop });
      }
      return out;
    }, records.slice(1).map((r) => r.id));
    return { case: caseId, chrome: CHROME_VERSION, platform: REFERENCE_PLATFORM, devicePixelRatio: env.devicePixelRatio, direction: env.direction, scrollbars: 'overlay', scrollbarArgs: SCROLLBAR_ARGS.join(' '), records, extents };
  } finally {
    await page.context().close();
  }
}

export function scrollCaptureJson(c: ScrollCapture): string {
  return `${JSON.stringify(c, null, 1)}\n`;
}

const isRecordArray = (v: unknown): v is ScrollRecord[] =>
  Array.isArray(v) && v.every((r) => typeof r === 'object' && r !== null && typeof (r as ScrollRecord).id === 'string' && ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight'].every((k) => Number.isInteger((r as Record<string, unknown>)[k])));

/** A capture's text, checked for its shape, its case, its DPR, its platform and direction and its overlay scrollbar environment; where names it in errors. */
export function parseScrollCapture(text: string, caseId: string, dpr: number, where: string): ScrollCapture {
  const v = JSON.parse(text) as unknown;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${where} is not a scroll capture object`);
  const o = v as Record<string, unknown>;
  if (o['case'] !== caseId || o['devicePixelRatio'] !== dpr || o['chrome'] !== CHROME_VERSION || !isRecordArray(o['records'])) throw new Error(`${where} is not a scroll capture of ${caseId} at DPR ${dpr}`);
  if (o['platform'] !== REFERENCE_PLATFORM || (o['direction'] !== 'ltr' && o['direction'] !== 'rtl')) throw new Error(`${where}: platform ${JSON.stringify(o['platform'])} or direction ${JSON.stringify(o['direction'])} is not a ${REFERENCE_PLATFORM} capture in ltr or rtl`);
  if (o['scrollbars'] !== 'overlay') throw new Error(`${where}: scrollbars is ${JSON.stringify(o['scrollbars'])}, not overlay (decisions.md, overlay-scrollbar rule)`);
  if (o['scrollbarArgs'] !== SCROLLBAR_ARGS.join(' ')) throw new Error(`${where}: scrollbarArgs is ${JSON.stringify(o['scrollbarArgs'])}, not ${JSON.stringify(SCROLLBAR_ARGS.join(' '))}`);
  if (o['records'][0]?.id !== 'viewport') throw new Error(`${caseId} at DPR ${dpr}: the first record is not the viewport`);
  const extents = o['extents'];
  const finite = (r: Record<string, unknown>): boolean => ['minLeft', 'maxLeft', 'minTop', 'maxTop'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
  if (!Array.isArray(extents) || !extents.every((r) => typeof r === 'object' && r !== null && typeof (r as Record<string, unknown>)['id'] === 'string' && finite(r as Record<string, unknown>))) throw new Error(`${where}: extents is not a list of scroll offset ranges`);
  const ids = (rs: readonly { readonly id: string }[]): string => rs.map((r) => r.id).join(',');
  if (ids(extents as ScrollExtent[]) !== ids((o['records'] as ScrollRecord[]).slice(1))) throw new Error(`${where}: extents [${ids(extents as ScrollExtent[])}] are not the element scroll containers [${ids((o['records'] as ScrollRecord[]).slice(1))}]`);
  return o as unknown as ScrollCapture;
}

/** A committed capture (parseScrollCapture). */
export function committedScrollCapture(caseId: string, dpr: number): ScrollCapture {
  const path = expectedScrollPath(caseId, dpr);
  return parseScrollCapture(readFileSync(path, 'utf8'), caseId, dpr, path);
}

// ---------------------------------------------------------------- the scrollbar environment (R2)

/**
 * The overlay probe: Playwright adds --hide-scrollbars to every headless launch, yet scrollbar-gutter: stable still reserves a
 * classic scrollbar's 15px under it, so a 100px probe keeps clientWidth 100 only where scrollbars overlay. all: initial and
 * position: absolute keep the case's own rules and layout off the probe.
 */
export const OVERLAY_PROBE_STYLE = 'all:initial;position:absolute;left:0;top:0;display:block;overflow:auto;scrollbar-gutter:stable;width:100px;height:100px';

export const CLASSIC_SCROLLBARS = 'capture environment has classic scrollbars (System Settings > Appearance > Show scroll bars, or a mouse attached); the reference is overlay (decisions.md, overlay-scrollbar rule)';

/**
 * NSUserDefaults argument-domain pair that makes this Chrome process use overlay scrollbars whatever the machine's setting or
 * mouse; it changes no system setting. Playwright refuses a launch argument that does not start with "-", so a wrapper script
 * appends the pair when it execs the headless shell Playwright would launch.
 */
export const SCROLLBAR_ARGS: readonly string[] = ['-AppleShowScrollBars', 'WhenScrolling'];

/** The chromium-headless-shell executable Playwright launches by default (its registry). */
function headlessShellPath(): string {
  const own = createRequire(import.meta.url);
  const pw = createRequire(own.resolve('playwright'));
  const core = pw.resolve('playwright-core');
  const { registry } = pw(core.replace(/index\.js$/, 'lib/server/registry/index.js')) as { registry: { findExecutable(n: string): { executablePath(): string | undefined } | undefined } };
  const path = registry.findExecutable('chromium-headless-shell')?.executablePath();
  if (path === undefined) throw new Error(`Playwright ${PLAYWRIGHT_VERSION} names no chromium-headless-shell executable`);
  return path;
}

/** launchChrome (chrome.ts) with SCROLLBAR_ARGS; the wrapper directory is removed once Chrome has started or failed to. */
export async function launchOverlayChrome(forceDeviceScaleFactor: number): Promise<Browser> {
  const dir = mkdtempSync(`${tmpdir()}/dragon-scroll-chrome-`);
  try {
    const wrapper = `${dir}/chrome`;
    const quoted = (a: string): string => `'${a.replaceAll("'", "'\\''")}'`;
    writeFileSync(wrapper, `#!/bin/sh\nexec ${quoted(headlessShellPath())} "$@" ${SCROLLBAR_ARGS.map(quoted).join(' ')}\n`);
    chmodSync(wrapper, 0o755);
    const browser = await chromium.launch({ executablePath: wrapper, args: [...chromeArgsAt(forceDeviceScaleFactor)] });
    if (browser.version() !== CHROME_VERSION) {
      await browser.close();
      throw new Error(`Chrome must be ${CHROME_VERSION} (Playwright ${PLAYWRIGHT_VERSION}), got ${browser.version()}`);
    }
    return browser;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Throws unless the probe, added to the page and removed again, measures clientWidth 100 (R2). Run before every capture. */
export async function assertOverlayScrollbars(page: Pick<Page, 'evaluate'>): Promise<void> {
  const width = await page.evaluate((style: string) => {
    const probe = document.createElement('div');
    probe.setAttribute('style', style);
    document.documentElement.appendChild(probe);
    try {
      return probe.clientWidth;
    } finally {
      probe.remove();
    }
  }, OVERLAY_PROBE_STYLE);
  if (width !== 100) throw new Error(`${CLASSIC_SCROLLBARS}: the probe measured clientWidth ${String(width)}, not 100`);
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
