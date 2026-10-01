// SELD-R1b (notes/T047-runtime-spec.md RT-9 and amendment T063J): the hit-test lane on the host. Every layout case gets a grid of
// points derived from its hit table (each box, line and text rect's edges, both sides of each edge's hit boundary and the
// centre), Chrome's document.elementFromPoint at each point is captured into packages/parity/expected-hit/, and the TypeScript
// hit test (packages/layout/src/rt-hit.ts) over the engine's boxes must name the same element at every point. Points are in
// LU (1/64 px), so every coordinate Chrome is given is exact.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { absoluteRects, buildRun, layout, NO_ENGINE_FAULTS, resolveBorder, zoomInput } from '@dragon/layout';
import type { HitEngine, HitTable, HitTableFaults } from 'dragon';
import { hitFacts, hitTable, NO_HIT_TABLE_FAULTS } from 'dragon';
import type { HitFaults } from '../../layout/src/rt-hit.ts';
import { activationTarget, hitTest, NO_HIT_FAULTS } from '../../layout/src/rt-hit.ts';
import { CHROME_VERSION, openPage } from './chrome.ts';
import type { NativeCase } from './native-host.ts';
import { nativeCases, referenceMeasurer } from './native-host.ts';
import { repoPath } from './paths.ts';

export const HIT_CAPTURE_VERSION = 'dragon.hit-capture/1';
const LU = 64;

export const expectedHitDir = (): string => repoPath('packages/parity/expected-hit');
export const expectedHitPath = (caseId: string): string => `${expectedHitDir()}/${caseId.replace(/#/g, '~')}.hit.json`;

let engine: HitEngine | null = null;

/** The TS engine the hit tables are built with: the helpers the device runs translated. */
export function hitEngine(): HitEngine {
  if (engine === null) engine = { layout, measurer: referenceMeasurer(), absoluteRects, zoomInput, resolveBorder, buildRun, noFaults: NO_ENGINE_FAULTS };
  return engine;
}

/** A case's hit table at DPR 1 (the Chrome captures' ratio), from its uikit program and its compile's hit facts. */
export function caseHitTable(n: NativeCase, faults: HitTableFaults = NO_HIT_TABLE_FAULTS, dpr = 1): HitTable {
  const facts = hitFacts(n.compiled, n.case.assignment);
  if (facts === null) throw new Error(`${n.case.id}: no hit facts`);
  return hitTable(n.programs.uikit, facts, n.case.environment.viewport, dpr, hitEngine(), faults);
}

const snap = (v: number): number => Math.floor((v + LU / 2) / LU) * LU;

/**
 * The derived grid of a hit table in LU: for each rect, around each edge's exclusive boundary (a point p hits [a, b) when
 * a - 1 px < p < b) and inclusive boundary, 0.5 px either side of each edge and the centre, crossed per rect, inside the viewport.
 */
export function hitGrid(t: HitTable, viewport: { readonly width: number; readonly height: number }): [number, number][] {
  const axis = (a: number, b: number): number[] => [a - LU - 1, a - LU, a - LU + 1, a - LU / 2, a + LU / 2, Math.floor((a + b) / 2), b - LU / 2, b - 1, b, b + LU / 2, b + 1];
  const seen = new Set<string>();
  const out: [number, number][] = [];
  const add = (xs: readonly number[], ys: readonly number[]): void => {
    for (const x of xs) {
      for (const y of ys) {
        // elementFromPoint answers only points whose rounded position is inside the viewport (a gate before the hit test).
        if (x < 0 || y < 0 || x >= viewport.width * LU - LU / 2 || y >= viewport.height * LU - LU / 2) continue;
        const k = `${x},${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([x, y]);
      }
    }
  };
  t.nodes.forEach((n, i) => {
    if (n.width <= 0 && n.height <= 0 && n.kind !== 'line') return;
    add(axis(n.x, n.x + n.width), axis(n.y, n.y + n.height));
    if (n.kind === 'text') add(axis(snap(n.x), snap(n.x + n.width)), axis(snap(n.y), snap(n.y + n.height)));
    if (n.kind === 'line') {
      const block = t.nodes[n.parent];
      if (block === undefined) throw new Error(`line ${t.ids[i]} has no block`);
      add(axis(snap(n.x), snap(n.x + block.width)), axis(snap(n.y), snap(n.y + block.height)));
    }
  });
  return out.sort((p, q) => (p[1] === q[1] ? p[0] - q[0] : p[1] - q[1]));
}

export type HitCapture = { readonly case: string; readonly chrome: string; readonly version: string; readonly viewport: { readonly width: number; readonly height: number }; readonly direction: 'ltr' | 'rtl'; readonly ids: readonly string[]; readonly points: readonly (readonly [number, number, number])[] };

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
    return { case: n.case.id, chrome: CHROME_VERSION, version: HIT_CAPTURE_VERSION, viewport: n.case.environment.viewport, direction: n.case.environment.direction, ids, points: grid.map(([x, y], i) => [x, y, ids.indexOf(hits[i] as string)] as const) };
  } finally {
    await page.context().close();
  }
}

export const hitCaptureJson = (c: HitCapture): string => `{\n  "case": ${JSON.stringify(c.case)},\n  "chrome": ${JSON.stringify(c.chrome)},\n  "version": ${JSON.stringify(c.version)},\n  "viewport": ${JSON.stringify(c.viewport)},\n  "direction": ${JSON.stringify(c.direction)},\n  "ids": ${JSON.stringify(c.ids)},\n  "points": [\n${c.points.map((p) => `    ${JSON.stringify(p)}`).join(',\n')}\n  ]\n}\n`;

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
  const ok = c.case === caseId && c.chrome === CHROME_VERSION && c.version === HIT_CAPTURE_VERSION && Array.isArray(c.ids) && c.ids.every((x) => typeof x === 'string') && Array.isArray(c.points)
    && c.points.every((p) => Array.isArray(p) && p.length === 3 && p.every((v) => Number.isInteger(v)) && (p[2] as number) >= 0 && (p[2] as number) < (c.ids as string[]).length);
  if (!ok) throw new Error(`${caseId}: the hit capture at ${path} is malformed or from another Chrome or capture version`);
  return c as HitCapture;
}

export type HitMismatch = { readonly case: string; readonly x: number; readonly y: number; readonly chrome: string; readonly dragon: string };

/** The TS hit test against a capture at every captured point; the grid must be the one the table derives now. */
export function compareHits(n: NativeCase, c: HitCapture, faults: HitFaults = NO_HIT_FAULTS, tableFaults: HitTableFaults = NO_HIT_TABLE_FAULTS): { readonly points: number; readonly mismatches: readonly HitMismatch[]; readonly stale: boolean } {
  const t = caseHitTable(n, tableFaults);
  const grid = hitGrid(caseHitTable(n), n.case.environment.viewport);
  const stale = grid.length !== c.points.length || grid.some(([x, y], i) => (c.points[i] as readonly number[])[0] !== x || (c.points[i] as readonly number[])[1] !== y);
  const mismatches: HitMismatch[] = [];
  for (const [x, y, k] of c.points) {
    const i = hitTest(t.nodes, x, y, faults);
    const dragon = t.ids[i] as string;
    const chrome = c.ids[k] as string;
    if (dragon !== chrome) mismatches.push({ case: n.case.id, x, y, chrome, dragon });
  }
  return { points: c.points.length, mismatches, stale };
}

/** Tap dispatch on the host: the element a tap at (x, y) in LU activates, or null when no ancestor has a handler. */
export function tapTarget(t: HitTable, x: number, y: number, faults: HitFaults = NO_HIT_FAULTS): string | null {
  const hit = hitTest(t.nodes, x, y, faults);
  const a = activationTarget(t.nodes, t.activation, hit);
  return a < 0 ? null : (t.ids[a] as string);
}

/** Every layout case the hit lane covers: all of them. */
export const hitCases = (): readonly NativeCase[] => nativeCases();
