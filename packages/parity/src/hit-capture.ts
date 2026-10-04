// SELD-R1b (notes/T047-runtime-spec.md RT-9 and amendment T063J): the hit-test lane on the host. Every layout case gets a grid of
// points derived from its hit table (each box, line and text rect's edges, both sides of each edge's hit boundary and the
// centre), Chrome's document.elementFromPoint at each point is captured into packages/parity/expected-hit/, and the TypeScript
// hit test (packages/layout/src/rt-hit.ts) over the engine's boxes must name the same element at every point. Points are in
// LU (1/64 px), so every coordinate Chrome is given is exact.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { hitFacts, programInput } from 'dragon';
import type { HitFaults, HitTable, HitTableFaults } from '../../layout/src/rt-hit.ts';
import { activationTarget, hitAt, hitGrid as rtHitGrid, hitTableOf, hitTest, NO_HIT_FAULTS, NO_HIT_TABLE_FAULTS, prepareHit } from '../../layout/src/rt-hit.ts';
import { CHROME_VERSION, openPage } from './chrome.ts';
import type { NativeCase } from './native-host.ts';
import { nativeCases, referenceMeasurer } from './native-host.ts';
import { repoPath } from './paths.ts';

export const HIT_CAPTURE_VERSION = 'dragon.hit-capture/2';
const LU = 64;

export const expectedHitDir = (): string => repoPath('packages/parity/expected-hit');
export const expectedHitPath = (caseId: string): string => `${expectedHitDir()}/${caseId.replace(/#/g, '~')}.hit.json`;

/** A program's hit table at a DPR (rt-hit.ts hitTableOf, the function the device runs translated). */
export function programHitTable(program: NativeCase['programs']['uikit'], facts: NonNullable<ReturnType<typeof hitFacts>>, viewport: { readonly width: number; readonly height: number }, dpr: number, faults: HitTableFaults = NO_HIT_TABLE_FAULTS): HitTable {
  return hitTableOf(programInput(program, viewport, dpr), referenceMeasurer(), facts, faults);
}

/** A case's hit table at DPR 1 (the Chrome captures' ratio), from its uikit program and its compile's hit facts. */
export function caseHitTable(n: NativeCase, faults: HitTableFaults = NO_HIT_TABLE_FAULTS, dpr = 1): HitTable {
  const facts = hitFacts(n.compiled, n.case.assignment);
  if (facts === null) throw new Error(`${n.case.id}: no hit facts`);
  return programHitTable(n.programs.uikit, facts, n.case.environment.viewport, dpr, faults);
}

/** The derived grid of a table in LU (rt-hit.ts hitGrid), as [x, y] pairs. */
export function hitGrid(t: HitTable, viewport: { readonly width: number; readonly height: number }): [number, number][] {
  return rtHitGrid(t, viewport.width * LU, viewport.height * LU).map((p): [number, number] => [p.x, p.y]);
}

/**
 * A case's capture: the grid is not stored, since the hit table derives it; gridSha256 pins the grid it was taken on, and runs
 * holds Chrome's answer at each grid point in grid order, run-length encoded as [id index, count].
 */
export type HitCapture = { readonly case: string; readonly chrome: string; readonly version: string; readonly viewport: { readonly width: number; readonly height: number }; readonly direction: 'ltr' | 'rtl'; readonly points: number; readonly gridSha256: string; readonly ids: readonly string[]; readonly runs: readonly (readonly [number, number])[] };

export const gridSha256 = (grid: readonly (readonly [number, number])[]): string => createHash('sha256').update(grid.map(([x, y]) => `${x},${y}`).join(';')).digest('hex');

/** Chrome's elementFromPoint at every grid point of a case, on its authored rendering; each id is the element's data-dragon-id. */
export async function captureHits(browser: Browser, n: NativeCase): Promise<HitCapture> {
  const grid = hitGrid(caseHitTable(n), n.case.environment.viewport);
  const page = await openPage(browser, n.case.authoredHtml, n.case.environment);
  try {
    const hits = await page.evaluate((pts) => pts.map(([x, y]) => {
      const e = document.elementFromPoint(x / 64, y / 64);
      const el = e === null ? null : e.closest('[data-dragon-id]');
      return el === null ? '#none' : (el.getAttribute('data-dragon-id') as string);
    }), grid);
    const ids = [...new Set(hits)].sort();
    const runs: [number, number][] = [];
    for (const h of hits) {
      const k = ids.indexOf(h);
      const last = runs[runs.length - 1];
      if (last !== undefined && last[0] === k) last[1]++;
      else runs.push([k, 1]);
    }
    return { case: n.case.id, chrome: CHROME_VERSION, version: HIT_CAPTURE_VERSION, viewport: n.case.environment.viewport, direction: n.case.environment.direction, points: grid.length, gridSha256: gridSha256(grid), ids, runs };
  } finally {
    await page.context().close();
  }
}

export const hitCaptureJson = (c: HitCapture): string => `${JSON.stringify({ ...c, runs: undefined }, null, 2).replace(/\n}$/, ',')}\n  "runs": ${JSON.stringify(c.runs)}\n}\n`;

/** The committed capture of a case; a missing or malformed file throws, naming what is wrong. */
export function committedHits(caseId: string): HitCapture {
  const path = expectedHitPath(caseId);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${caseId}: no readable hit capture at ${path} (${e instanceof Error ? e.message : String(e)}); run pnpm run parity:hit-capture`);
  }
  const c = raw as Partial<HitCapture>;
  const ok = c.case === caseId && c.chrome === CHROME_VERSION && c.version === HIT_CAPTURE_VERSION && Number.isInteger(c.points) && typeof c.gridSha256 === 'string' && Array.isArray(c.ids) && c.ids.every((x) => typeof x === 'string') && Array.isArray(c.runs)
    && c.runs.every((r) => Array.isArray(r) && r.length === 2 && Number.isInteger(r[0]) && Number.isInteger(r[1]) && (r[0] as number) >= 0 && (r[0] as number) < (c.ids as string[]).length && (r[1] as number) > 0)
    && c.runs.reduce((n, r) => n + (r[1] as number), 0) === c.points;
  if (!ok) throw new Error(`${caseId}: the hit capture at ${path} is malformed or from another Chrome or capture version`);
  return c as HitCapture;
}

/** Chrome's answer at each point of a capture, in grid order. */
export function capturedIds(c: HitCapture): string[] {
  return c.runs.flatMap(([k, count]) => Array.from({ length: count }, () => c.ids[k] as string));
}

export type HitMismatch = { readonly case: string; readonly x: number; readonly y: number; readonly chrome: string; readonly dragon: string };

/** The TS hit test against a capture at every captured point; the grid must be the one the table derives now. */
export function compareHits(n: NativeCase, c: HitCapture, faults: HitFaults = NO_HIT_FAULTS, tableFaults: HitTableFaults = NO_HIT_TABLE_FAULTS): { readonly points: number; readonly mismatches: readonly HitMismatch[]; readonly stale: boolean } {
  const t = caseHitTable(n, tableFaults);
  const grid = hitGrid(caseHitTable(n), n.case.environment.viewport);
  const stale = grid.length !== c.points || gridSha256(grid) !== c.gridSha256;
  const mismatches: HitMismatch[] = [];
  if (stale) return { points: c.points, mismatches, stale };
  const chrome = capturedIds(c);
  const prepared = prepareHit(t.nodes, faults);
  grid.forEach(([x, y], i) => {
    const dragon = t.ids[hitAt(prepared, x, y)] as string;
    if (dragon !== chrome[i]) mismatches.push({ case: n.case.id, x, y, chrome: chrome[i] as string, dragon });
  });
  return { points: c.points, mismatches, stale };
}

/** Tap dispatch on the host: the element a tap at (x, y) in LU activates, or null when no ancestor has a handler. */
export function tapTarget(t: HitTable, x: number, y: number, faults: HitFaults = NO_HIT_FAULTS): string | null {
  const hit = hitTest(t.nodes, x, y, faults);
  const a = activationTarget(t.nodes, t.activation, hit);
  return a < 0 ? null : (t.ids[a] as string);
}

/** Every layout case the hit lane covers: all of them. */
export const hitCases = (): readonly NativeCase[] => nativeCases();

/** The hit facts of every layout case, which the P1 hit suite pairs with the layout vectors (parity:hit-capture -- --vectors). */
export const HIT_FACTS_PATH = 'packages/layout/rt-vectors/hit/facts.json';

/** The text of HIT_FACTS_PATH for these cases: each case's facts as [id, pointerEvents, inherited, activation], sorted by id. */
export function hitFactsJson(cases: readonly NativeCase[]): string {
  const rows = cases.map((n) => {
    const facts = hitFacts(n.compiled, n.case.assignment);
    if (facts === null) throw new Error(`${n.case.id}: no hit facts`);
    const v = [...facts].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([id, f]) => [id, f.pointerEvents, f.inherited, f.activation]);
    return `    ${JSON.stringify(n.case.id)}: ${JSON.stringify(v)}`;
  });
  return `{\n  "cases": {\n${rows.join(',\n')}\n  }\n}\n`;
}

export type HitCaptureArgs = { readonly mode: 'capture' } | { readonly mode: 'vectors' } | { readonly mode: 'identity-base'; readonly rev: string };

/** parity:hit-capture's arguments: nothing (the Chrome captures), --vectors, or --identity-base <rev>; anything else is refused. */
export function parseHitCaptureArgs(argv: readonly string[]): HitCaptureArgs {
  let out: HitCaptureArgs = { mode: 'capture' };
  const usage = 'usage: parity:hit-capture [-- --vectors | --identity-base <rev>]';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a !== '--vectors' && a !== '--identity-base') throw new Error(`unknown argument ${JSON.stringify(a)}; ${usage}`);
    if (out.mode !== 'capture') throw new Error(`give one of --vectors and --identity-base, once; ${usage}`);
    if (a === '--vectors') {
      out = { mode: 'vectors' };
      continue;
    }
    const rev = argv[i + 1];
    if (rev === undefined || rev.startsWith('--')) throw new Error('--identity-base needs a revision');
    out = { mode: 'identity-base', rev };
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- the pointer-events identity (PM capture ruling, T063J)

/** The committed outputs that pointer-events may change only by its own key: the Chrome captures and the emitted CSS. */
export const IDENTITY_ROOTS: readonly string[] = ['packages/parity/expected', 'packages/parity/expected-dpr', 'packages/parity/expected-fonts', 'packages/parity/emitted'];
export const IDENTITY_MANIFEST = 'packages/parity/expected-hit/identity-base.json';
/** Files that are new with SELD-R1b's fixtures (hit-*, reject-pointer-events-*), not in the base. */
export const IDENTITY_NEW = /(^|\/)(hit-|reject-pointer-events-)[^/]*$/;

/**
 * A committed output with the pointer-events key removed: the "pointer-events" computed value of every captured element, and the
 * pointer-events declaration of every emitted rule; an emitted file's compilation digest (its first line) is masked, since every
 * compilation digest moves with the compiler input.
 */
export function withoutPointerEvents(path: string, text: string): string {
  if (path.endsWith('.json')) return text.replace(/,\n[ ]*"pointer-events": "[a-z-]+"/g, '');
  if (path.endsWith('.css')) return text.replace(/^[ ]*pointer-events: [a-z-]+;\n/gm, '').replace(/compilation [0-9a-f]{64}/g, 'compilation <digest>');
  throw new Error(`${path}: the identity check reads only .json captures and .css outputs`);
}

export type IdentityManifest = { readonly base: string; readonly files: { readonly [path: string]: string } };
