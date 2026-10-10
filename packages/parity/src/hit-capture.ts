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
import { activationTarget, hitAt, hitGrid as rtHitGrid, hitRefusal as inputHitRefusal, hitRuns, hitTableOf, hitTest, NO_HIT_FAULTS, NO_HIT_TABLE_FAULTS, prepareHit } from '../../layout/src/rt-hit.ts';
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

/**
 * Why the hit lane leaves a layout case out, or null when it covers it. The hit test models box geometry, overflow clips, positioned
 * layers and pointer-events (T064 R13); a case whose program writes a transform is refused by name until SELD-R2b (T146) models
 * hit testing through transforms; so is a case with a stacking context below the root (an integer z-index or an opacity below 1,
 * PNT1), whose layers rt-hit.ts orders as z-index auto, and one whose program rounds a corner until the hit test models rounded
 * borders (Blink clips a hit to the rounded border box), so none is ever silently mis-hit; one holding an inline box or a <br> (INL1a)
 * is refused as rt-hit.ts hitRefusal names it, since the hit table does not model them yet.
 */
export function hitRefusal(n: NativeCase): string | null {
  const nodes = n.programs.uikit.nodes;
  const moved = nodes.filter((x) => x.writes.some((w) => w.kind === 'transform')).map((x) => x.id);
  if (moved.length > 0) return `transform on ${moved.join(', ')}: hit testing through transforms is SELD-R2b (T146)`;
  // PNT1: a stacking context below the root paints its layer in z-order, which rt-hit.ts does not order yet.
  const contexts = nodes.filter((x) => x.parent !== null && (x.facts['stacking'] as { readonly createsContext?: boolean } | undefined)?.createsContext === true).map((x) => x.id);
  if (contexts.length > 0) return `stacking context on ${contexts.join(', ')}: hit testing through z-index and opacity layers is not modelled yet (rt-hit.ts orders positioned boxes as z-index auto)`;
  // PNT1-radius: Blink clips a hit to the rounded border box, which the hit test does not model yet.
  const rounded = n.programs.uikit.nodes.filter((x) => x.writes.some((w) => w.kind === 'border-radius')).map((x) => x.id);
  if (rounded.length > 0) return `border-radius on ${rounded.join(', ')}: hit testing through rounded corners is not modelled yet (PNT1)`;
  // INL1a: hitTableOf refuses an inline box or a <br> by name (rt-hit.ts), so such a case is left out with that reason.
  return inputHitRefusal(programInput(n.programs.uikit, n.case.environment.viewport, 1));
}

/** Every layout case the hit lane covers: all of them but the refused ones (hitRefusal). */
export const hitCases = (): readonly NativeCase[] => nativeCases().filter((n) => hitRefusal(n) === null);

/** The layout cases the hit lane refuses, with the reason, in case order. */
export const hitRefusedCases = (): readonly { readonly id: string; readonly reason: string }[] =>
  nativeCases().flatMap((n) => {
    const reason = hitRefusal(n);
    return reason === null ? [] : [{ id: n.case.id, reason }];
  });

/** The hit facts of every layout case, which the P1 hit suite pairs with the layout vectors (parity:hit-capture -- --vectors). */
export const HIT_FACTS_PATH = 'packages/layout/rt-vectors/hit/facts.json';

/**
 * The text of HIT_FACTS_PATH for these cases: each case's facts as [id, pointerEvents, inherited, activation], sorted by id, and
 * the refused cases with their reasons, which the P1 hit suite skips by name.
 */
export function hitFactsJson(cases: readonly NativeCase[], refused: readonly { readonly id: string; readonly reason: string }[] = hitRefusedCases()): string {
  const rows = cases.map((n) => {
    const facts = hitFacts(n.compiled, n.case.assignment);
    if (facts === null) throw new Error(`${n.case.id}: no hit facts`);
    const v = [...facts].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([id, f]) => [id, f.pointerEvents, f.inherited, f.activation]);
    return `    ${JSON.stringify(n.case.id)}: ${JSON.stringify(v)}`;
  });
  const no = refused.map((r) => `    ${JSON.stringify(r.id)}: ${JSON.stringify(r.reason)}`);
  return `{\n  "cases": {\n${rows.join(',\n')}\n  },\n  "refused": {${no.length === 0 ? '' : `\n${no.join(',\n')}\n  `}}\n}\n`;
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
/**
 * Files that are new since the identity base: SELD-R1b's fixtures (hit-*, reject-pointer-events-*), SELD-R2a's (interaction-*,
 * reject-interaction-*), the fixtures of PNT2's transforms group (transform-*, reject-transform-*), CTX-PROOF's (ctx-proof-*),
 * PNT1's radius group (radius-*, reject-radius-*) and PNT1's effects group (opacity-*, stacking-*, their rejects included), which
 * landed after it.
 */
export const IDENTITY_NEW = /(^|\/)(hit-|reject-pointer-events-|interaction-|reject-interaction-|transform-|reject-transform-|ctx-proof-|radius-|reject-radius-|opacity-|stacking-)[^/]*$/;
/** Base files a later ruling moves beyond the pointer-events key: each must hash (key removed) to its post-ruling sha256 instead. */
export const IDENTITY_RULED: Readonly<Record<string, { readonly sha256: string; readonly ruling: string }>> = {
  'packages/parity/emitted/media-range.css': { sha256: '3836abedb74609093db7d06cafb085aa04376d6ada3b20ed142eecf654b79226', ruling: 'MQ-R0 (PM 2026-10-04): the fractional-width @media bands are emitted' },
  'packages/parity/emitted/media-range-rtl.css': { sha256: '281d321b2c05e0d1a2b7d810eafdb11b3f5e3c76baba447b983f23716ae4bd1f', ruling: 'MQ-R0 (PM 2026-10-04): the fractional-width @media bands are emitted' },
  'packages/parity/emitted/background-shorthand-colors.css': { sha256: 'e90b930ed6d4e52dd6ce50dc627d86c0a6f59ff34020814daf20ee2e11bc0fc9', ruling: 'BG2 (#235): the background shorthand emits its layer longhands as written' },
};

/**
 * The longhands added since the identity base, beside pointer-events: PNT1's four corner radii, which every capture and emitted rule
 * gained after the base was written, so the base files must differ from it by exactly these keys and pointer-events.
 */
const KEYS_SINCE_BASE = ['pointer-events', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
const JSON_KEYS = new RegExp(`,\\n[ ]*"(${KEYS_SINCE_BASE.join('|')})": "[^"]*"`, 'g');
const CSS_KEYS = new RegExp(`^[ ]*(${KEYS_SINCE_BASE.join('|')}): [^;\\n]*;\\n`, 'gm');
/**
 * PNT1's opacity and z-index, also added after the base, only at their neutral values (opacity 1, z-index auto), as GEN-b's below:
 * any other value stays in the text, so a base file that gained one no longer hashes to the base.
 */
const JSON_EFFECTS = /,\n[ ]*"(?:opacity": "1|z-index": "auto)"/g;
const CSS_EFFECTS = /^[ ]*(?:opacity: 1|z-index: auto);\n/gm;

/**
 * GEN-b's longhands (content, list-style-type, -position, -image), also added after the identity base, at their neutral values in
 * LONGHANDS order (docs/decisions.md, "Adding engine fields and CSS longhands"). list-style-type is decimal only where Chrome's UA
 * ol rule sets it, in GEN_B_DECIMAL_FIXTURES; any other value stays in the text, so the file no longer hashes to the base.
 */
const GEN_B_DECIMAL_FIXTURES: readonly string[] = ['block-elements-defaults'];
const genBType = (path: string): string => (GEN_B_DECIMAL_FIXTURES.includes((path.split('/').pop() as string).split('.')[0]!.replace(/-rtl$/, '')) ? '(?:disc|decimal)' : 'disc');

/**
 * BG2's eight background layer longhands, also added after the identity base, at their initial values in LONGHANDS order. Any other
 * value stays in the text, so a file whose background moved no longer hashes to the base. The three captures in BG2_BASE_CAPTURES
 * already held these keys at the base, so they keep them.
 */
const BG2_BASE_CAPTURES: readonly string[] = ['background-important', 'background-shorthand-cascade', 'background-shorthand-colors'].map((f) => `packages/parity/expected/darwin-arm64/${f}.web.json`);
const BG2_LONGHANDS: readonly (readonly [string, string])[] = [
  ['background-image', 'none'],
  ['background-position-x', '0%'],
  ['background-position-y', '0%'],
  ['background-size', 'auto'],
  ['background-repeat', 'repeat'],
  ['background-attachment', 'scroll'],
  ['background-origin', 'padding-box'],
  ['background-clip', 'border-box'],
];
const JSON_BG2 = new RegExp(BG2_LONGHANDS.map(([k, v]) => `,\\n[ ]*"${k}": "${v}"`).join(''), 'g');
const CSS_BG2 = new RegExp(BG2_LONGHANDS.map(([k, v]) => `^[ ]*${k}: ${v};\\n`).join(''), 'gm');

/**
 * A committed output with the pointer-events key (and the other KEYS_SINCE_BASE, and PNT1's, GEN-b's and BG2's neutral longhands) removed: the computed
 * value of every captured element, and the declaration of every emitted rule; an emitted file's compilation digest (its first line)
 * is masked, since every compilation digest moves with the compiler input.
 */
export function withoutPointerEvents(path: string, text: string): string {
  const type = genBType(path);
  if (path.endsWith('.json')) {
    const genB = new RegExp(`,\\n[ ]*"content": "normal",\\n[ ]*"list-style-type": "${type}",\\n[ ]*"list-style-position": "outside",\\n[ ]*"list-style-image": "none"`, 'g');
    const stripped = text.replace(JSON_KEYS, '').replace(JSON_EFFECTS, '').replace(genB, '');
    return BG2_BASE_CAPTURES.includes(path) ? stripped : stripped.replace(JSON_BG2, '');
  }
  if (path.endsWith('.css')) {
    const genB = new RegExp(`^[ ]*content: normal;\\n[ ]*list-style-type: ${type};\\n[ ]*list-style-position: outside;\\n[ ]*list-style-image: none;\\n`, 'gm');
    return text.replace(CSS_KEYS, '').replace(CSS_EFFECTS, '').replace(genB, '').replace(CSS_BG2, '').replace(/compilation [0-9a-f]{64}/g, 'compilation <digest>');
  }
  throw new Error(`${path}: the identity check reads only .json captures and .css outputs`);
}

export type IdentityManifest = { readonly base: string; readonly files: { readonly [path: string]: string } };

// ---------------------------------------------------------------- the device-hit host sources (SELD-R1b)

/** Every layout case's hit facts as text lines "<case>\t<id>\t<pointer-events>\t<inherited 0|1>\t<activation 0|1>", in case order. */
export function hitFactLines(): string[] {
  const out: string[] = [];
  for (const n of hitCases()) {
    const facts = hitFacts(n.compiled, n.case.assignment);
    if (facts === null) throw new Error(`${n.case.id}: no hit facts`);
    for (const [id, f] of [...facts].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      for (const s of [n.case.id, id]) if (/[\t\n\\"$]/.test(s)) throw new Error(`${n.case.id}: id ${JSON.stringify(s)} holds a character the device facts table cannot carry`);
      out.push(`${n.case.id}\t${id}\t${f.pointerEvents}\t${f.inherited ? 1 : 0}\t${f.activation ? 1 : 0}`);
    }
  }
  return out;
}

const FACT_CHUNK = 20_000;

/**
 * The device side of device-hit, generated for a host app: the hit facts of every layout case (chunked string constants, since a
 * JVM string constant holds at most 64 KB) and dragonHitRuns, which runs the translated hit table, grid and answers on the case's
 * own input and the device's measurer. The host writes the answers beside each dump as <case>@<scale>.hit.
 */
export function deviceHitSource(target: 'ios' | 'android'): { readonly path: string; readonly text: string } {
  const chunks: string[] = [];
  let cur = '';
  for (const l of hitFactLines()) {
    if (cur.length + l.length + 1 > FACT_CHUNK) {
      chunks.push(cur);
      cur = '';
    }
    cur += `${l}\n`;
  }
  if (cur !== '') chunks.push(cur);
  const lit = (s: string): string => JSON.stringify(s);
  if (target === 'ios') {
    return {
      path: 'Host/DragonHitFacts.swift',
      text: `// GENERATED by @dragon/parity hit-capture.ts (${HIT_CAPTURE_VERSION}). Do not edit.
import Foundation

private let dragonHitFactChunks: [String] = [
${chunks.map((c) => `  ${lit(c)},`).join('\n')}
]

/// Every layout case's hit facts, by case id (script cases have none).
let dragonHitFactsTable: [String: [(String, String, Bool, Bool)]] = {
  var out: [String: [(String, String, Bool, Bool)]] = [:]
  for chunk in dragonHitFactChunks {
    for line in chunk.split(separator: "\\n", omittingEmptySubsequences: true) {
      let f = line.split(separator: "\\t", omittingEmptySubsequences: false).map(String.init)
      guard f.count == 5, f[2] == "auto" || f[2] == "none", f[3] == "0" || f[3] == "1", f[4] == "0" || f[4] == "1" else { fatalError("dragon host: bad hit facts line: \\(line)") }
      out[f[0], default: []].append((f[1], f[2], f[3] == "1", f[4] == "1"))
    }
  }
  return out
}()

/// The translated hit test of a case at a device scale: its answers at every point of its derived grid, run-length encoded.
func dragonHitRuns(_ c: DragonCase, _ facts: [(String, String, Bool, Bool)], scale: Double, measurer: TextMeasurer) -> String {
  let map = JsStringMap<HitFact>()
  for (id, pe, inherited, activation) in facts { map.set(JsString(id), HitFact(JsString(pe), inherited, activation)) }
  do {
    let t = try rtHit_hitTableOf(c.input(scale), measurer, map, HitTableFaults(false))
    let zoom = scale * 64
    let grid = try rtHit_hitGrid(t, c.viewport.width * zoom, c.viewport.height * zoom)
    return try rtHit_hitRuns(t, grid, HitFaults(false, false)).description
  } catch {
    fatalError("dragon host: \\(c.id): hit test: \\(error)")
  }
}
`,
    };
  }
  return {
    path: 'kotlin/dev/dragon/host/DragonHitFacts.kt',
    text: `// GENERATED by @dragon/parity hit-capture.ts (${HIT_CAPTURE_VERSION}). Do not edit.
package dev.dragon.host

import dev.dragon.views.DragonCase
import dev.dragon.layout.HitFact
import dev.dragon.layout.HitFaults
import dev.dragon.layout.HitTableFaults
import dev.dragon.layout.JsStringMap
import dev.dragon.layout.TextMeasurer
import dev.dragon.layout.rtHit_hitGrid
import dev.dragon.layout.rtHit_hitRuns
import dev.dragon.layout.rtHit_hitTableOf

private val dragonHitFactChunks: List<String> = listOf(
${chunks.map((c) => `  ${lit(c).replace(/\$/g, '\\$')},`).join('\n')}
)

class DragonHitFact(val id: String, val pointerEvents: String, val inherited: Boolean, val activation: Boolean)

/** Every layout case's hit facts, by case id (script cases have none). */
val dragonHitFactsTable: Map<String, List<DragonHitFact>> by lazy {
  val out = LinkedHashMap<String, MutableList<DragonHitFact>>()
  for (chunk in dragonHitFactChunks) {
    for (line in chunk.split("\\n")) {
      if (line.isEmpty()) continue
      val f = line.split("\\t")
      if (f.size != 5 || (f[2] != "auto" && f[2] != "none") || (f[3] != "0" && f[3] != "1") || (f[4] != "0" && f[4] != "1")) throw IllegalStateException("dragon host: bad hit facts line: " + line)
      out.getOrPut(f[0]) { ArrayList() }.add(DragonHitFact(f[1], f[2], f[3] == "1", f[4] == "1"))
    }
  }
  out
}

/** The translated hit test of a case at a device scale: its answers at every point of its derived grid, run-length encoded. */
fun dragonHitRuns(c: DragonCase, facts: List<DragonHitFact>, scale: Double, measurer: TextMeasurer): String {
  val map = JsStringMap<HitFact>()
  for (f in facts) map.set(f.id, HitFact(f.pointerEvents, f.inherited, f.activation))
  val t = rtHit_hitTableOf(c.input(scale), measurer, map, HitTableFaults(false))
  val zoom = scale * 64.0
  val grid = rtHit_hitGrid(t, c.viewportWidth * zoom, c.viewportHeight * zoom)
  return rtHit_hitRuns(t, grid, HitFaults(false, false))
}
`,
  };
}

/** The host's expected answers of a case at a device DPR: the TS hit test, grid and run encoding the device runs translated. */
export function expectedHitRuns(n: NativeCase, dpr: number): string {
  const t = caseHitTable(n, NO_HIT_TABLE_FAULTS, dpr);
  const zoom = dpr * LU;
  return hitRuns(t, rtHitGrid(t, n.case.environment.viewport.width * zoom, n.case.environment.viewport.height * zoom), NO_HIT_FAULTS);
}
