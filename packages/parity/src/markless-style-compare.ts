// Every frame of every assignment of a Markless style export against Chrome's boxes for the same element tree, at the export's
// viewport and ratio, under the device lanes' gate: classes and attributes as each assignment's states set them, and the colour
// scheme its @media band reads. Usage: pnpm run markless:style-compare -- <input.json> <export.json> <report.json>
import type { Browser } from 'playwright';
import type { NativeStyleTarget } from 'dragon';
import { BAND_KEY } from 'dragon';
import { authoredFontHtml } from './cases.ts';
import { captureFixture } from './capture.ts';
import { launchChrome } from './chrome.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from './font-reference.ts';
import type { MarklessCompiledTarget, MarklessStyleInput } from './markless-style-input.ts';
import { MARKLESS_DOCUMENT_CSS, marklessCompiledTargets, stateCombinations, textNodesByAddress } from './markless-style-input.ts';
import type { ExportTarget, NativeStyleExport } from './native-style-export.ts';

type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Values = Readonly<Record<string, unknown>>;

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The value a by-state list gives under an assignment's values; the input lists one entry per combination. */
function valueUnder(entries: readonly { readonly when: Readonly<Record<string, boolean>>; readonly value: string | null }[], values: Values, id: string): string | null {
  const found = entries.filter((e) => Object.entries(e.when).every(([cell, v]) => values[cell] === v));
  if (found.length !== 1) throw new Error(`${id}: ${found.length} by-state entries hold for ${JSON.stringify(values)}`);
  return (found[0] as (typeof entries)[number]).value;
}

/** The input's tree as one assignment shows it, each element named by its input id (data-dragon-id). */
export function marklessDocumentHtml(input: MarklessStyleInput, values: Values): string {
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const render = (n: MarklessStyleInput['nodes'][number]): string => {
    if (n.kind === 'text') return escape(n.text);
    const attributes: [string, string][] = Object.entries(n.attributes).filter(([name]) => name !== 'class');
    const cls = n.classByState === undefined ? (n.attributes['class'] ?? null) : valueUnder(n.classByState, values, n.id);
    if (cls !== null) attributes.push(['class', cls]);
    for (const [name, entries] of Object.entries(n.attributesByState ?? {})) {
      const v = valueUnder(entries, values, n.id);
      if (v !== null) attributes.push([name, v]);
    }
    const open = [`<${n.element} data-dragon-id="${escape(n.id)}"`, ...attributes.map(([k, v]) => `${k}="${escape(v)}"`)].join(' ');
    return `${open}>${(children.get(n.id) ?? []).map(render).join('')}</${n.element}>`;
  };
  return `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${MARKLESS_DOCUMENT_CSS}\n${input.css}\n</style>\n</head>\n<body data-dragon-id="body">${(children.get(null) ?? []).map(render).join('')}</body>\n</html>\n`;
}

type Bands = ExportTarget['bands'];

/** The colour scheme whose readings make a band's atoms true; a band no scheme reaches, or another feature, is refused. */
function schemeOf(bands: Bands, band: number): 'light' | 'dark' {
  const want = bands?.bands[band];
  if (bands === undefined || want === undefined) throw new Error(`no band ${band}`);
  const truth = (dark: boolean): boolean[] => bands.atoms.map((a) => {
    const atom = a as { feature: string; comparisons: readonly unknown[]; keyword: string };
    if (atom.feature !== 'prefers-color-scheme' || atom.comparisons.length > 0) throw new Error(`the comparison reads prefers-color-scheme only, not ${atom.feature}`);
    return atom.keyword === 'any' || (atom.keyword === 'dark') === dark;
  });
  for (const scheme of ['light', 'dark'] as const) if (truth(scheme === 'dark').every((v, i) => v === want[i])) return scheme;
  throw new Error(`no colour scheme reaches band ${band}`);
}

/**
 * Refuses a target whose states, @media bands and assignments are not exactly what the input compiles to for that target, one
 * assignment per combination of the input's states and bands, since a band or assignment left out would never be compared.
 */
export function checkCoverage(input: MarklessStyleInput, compiled: MarklessCompiledTarget | undefined, target: string, t: ExportTarget): void {
  if (compiled === undefined) throw new Error(`${target}: the input does not compile to this target`);
  const banded = compiled.bands !== undefined;
  if (JSON.stringify(t.states) !== JSON.stringify(compiled.states)) throw new Error(`${target}: states ${JSON.stringify(t.states)} are not the input's states${banded ? ' and the band' : ''} ${JSON.stringify(compiled.states)}`);
  if (JSON.stringify(t.bands ?? null) !== JSON.stringify(compiled.bands ?? null)) throw new Error(`${target}: bands ${JSON.stringify(t.bands ?? null)} are not the bands the input's @media compiles to ${JSON.stringify(compiled.bands ?? null)}`);
  const keys = compiled.states.map((s) => s.key);
  const want = stateCombinations(input).flatMap((c) => (compiled.bands === undefined ? [c] : compiled.bands.bands.map((_, b): Values => ({ ...c, [BAND_KEY]: b }))));
  const keyOf = (values: Values): string => JSON.stringify(keys.map((k) => values[k]));
  const seen = new Set<string>();
  const extra: Values[] = [];
  for (const a of t.assignments) {
    if (Object.keys(a.values).length !== keys.length || !keys.every((k) => k in a.values)) throw new Error(`${target}: assignment ${JSON.stringify(a.values)} does not set exactly ${keys.join(', ')}`);
    if (seen.has(keyOf(a.values))) extra.push(a.values);
    seen.add(keyOf(a.values));
  }
  const wanted = new Set(want.map(keyOf));
  extra.push(...t.assignments.map((a) => a.values).filter((v) => !wanted.has(keyOf(v))));
  const missing = want.filter((c) => !seen.has(keyOf(c)));
  if (missing.length > 0 || extra.length > 0) throw new Error(`${target}: the assignments are not one per combination of the input's states${banded ? ' and bands' : ''}: missing ${JSON.stringify(missing)}, extra or repeated ${JSON.stringify(extra)}`);
}

/** A measured box, or (maxDeltaDevicePx null, never passing) a box only one side has, with the problem named. */
export type CompareRow = { readonly target: string; readonly values: Values; readonly id: string; readonly maxDeltaDevicePx: number | null; readonly pass: boolean; readonly problem?: string };

export async function compareMarklessExport(input: MarklessStyleInput, exported: NativeStyleExport): Promise<{ readonly compared: number; readonly failed: number; readonly rows: readonly CompareRow[] }> {
  const rows: CompareRow[] = [];
  const compiled = marklessCompiledTargets(input);
  for (const [target, t] of Object.entries(exported.targets)) if (t !== undefined) checkCoverage(input, compiled[target as NativeStyleTarget], target, t);
  // Chrome's capture names a text node by Dragon's rule under its element's data-dragon-id; the export, by its input id.
  const textOf = textNodesByAddress(input, (id) => id);
  for (const [target, t] of Object.entries(exported.targets)) {
    if (t === undefined) continue;
    const browser: Browser = await launchChrome(t.dpr);
    try {
      for (const assignment of t.assignments) {
        const band = assignment.values[BAND_KEY];
        const scheme = typeof band === 'number' ? schemeOf(t.bands, band) : 'light';
        const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
        const absolute = (id: string): Frame => {
          const n = byId.get(id);
          if (n === undefined || n.frame === null) throw new Error(`${id} has no frame`);
          const p = n.parent === null ? { x: 0, y: 0 } : absolute(n.parent);
          return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
        };
        const fonts = fontReferencePrepare(FONT_REFERENCE_MAP);
        const capture = await captureFixture(browser, `markless-${input.component}`, authoredFontHtml(marklessDocumentHtml(input, assignment.values)), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], async (page) => {
          await page.emulateMedia({ colorScheme: scheme });
          await fonts(page);
        });
        const seen = new Set<string>();
        const mismatch = (id: string, problem: string): void => {
          rows.push({ target, values: assignment.values, id, maxDeltaDevicePx: null, pass: false, problem });
        };
        for (const c of capture.nodes) {
          // The export has no line boxes; a text node's own box is compared.
          if (c.kind === 'line') continue;
          const id = c.kind === 'text' ? (textOf.get(c.id) ?? c.id) : c.id;
          seen.add(id);
          const node = byId.get(id);
          if (!c.hasBox) {
            if (node !== undefined && node.frame !== null) mismatch(id, 'Chrome generates no box but the export has a frame');
            continue;
          }
          if (node === undefined && c.svg !== undefined) continue;
          if (node === undefined || node.frame === null) {
            mismatch(id, node === undefined ? 'Chrome has a box but the export has no node' : 'Chrome has a box but the export has no frame');
            continue;
          }
          const d = absolute(id);
          const chrome = { x: c.x * t.dpr, y: c.y * t.dpr, width: c.width * t.dpr, height: c.height * t.dpr };
          const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(chrome[k] - d[k])));
          rows.push({ target, values: assignment.values, id, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX });
        }
        for (const n of assignment.nodes) {
          if (seen.has(n.id) || n.frame === null) continue;
          if (n.kind !== 'anonymous') {
            mismatch(n.id, 'the export has a framed node Chrome does not have');
            continue;
          }
          // An anonymous box only Dragon has passes only when it holds at least one node and Chrome has every one of them.
          const inside = assignment.nodes.filter((x) => x.parent === n.id);
          if (inside.length === 0 || inside.some((x) => !seen.has(x.id))) mismatch(n.id, 'anonymous box whose nodes are not all Chrome nodes');
        }
      }
    } finally {
      await browser.close();
    }
  }
  return { compared: rows.filter((r) => r.maxDeltaDevicePx !== null).length, failed: rows.filter((r) => !r.pass).length, rows };
}
