// Every frame of every assignment of a Markless style export against Chrome's boxes for the same element tree, at the export's
// viewport and ratio, under the device lanes' gate: classes and attributes as each assignment's states set them, and the colour
// scheme its @media band reads. Usage: pnpm run markless:style-compare -- <input.json> <export.json> <report.json>
import type { Browser } from 'playwright';
import type { NativeStyleTarget } from 'dragon';
import { BAND_KEY } from 'dragon';
import { authoredFontHtml } from './cases.ts';
import type { WebCapture } from './capture.ts';
import { captureFixture } from './capture.ts';
import { launchChrome } from './chrome.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from './font-reference.ts';
import type { MarklessCompiledTarget, MarklessStyleInput } from './markless-style-input.ts';
import { MARKLESS_DOCUMENT_CSS, marklessCompiledTargets, marklessNodeId, stateCombinations } from './markless-style-input.ts';
import type { ExportTarget, NativeStyleExport } from './native-style-export.ts';

type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Values = Readonly<Record<string, unknown>>;

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/** A node of the document as Chrome must hold it: an element (namespace, name, attributes in order) or a text node. */
export type DocumentNode =
  | { readonly element: string; readonly namespace: string; readonly attributes: readonly (readonly [string, string])[]; readonly children: readonly DocumentNode[] }
  | { readonly text: string };

/** The value a by-state list gives under an assignment's values; the input lists one entry per combination. */
function valueUnder(entries: readonly { readonly when: Readonly<Record<string, boolean>>; readonly value: string | null }[], values: Values, id: string): string | null {
  const found = entries.filter((e) => Object.entries(e.when).every(([cell, v]) => values[cell] === v));
  if (found.length !== 1) throw new Error(`${id}: ${found.length} by-state entries hold for ${JSON.stringify(values)}`);
  return (found[0] as (typeof entries)[number]).value;
}

/** The input's body as one assignment shows it, node for node, each element named by its input id (data-dragon-id). */
export function marklessBodyTree(input: MarklessStyleInput, values: Values): DocumentNode[] {
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const build = (n: MarklessStyleInput['nodes'][number], parentNs: string): DocumentNode => {
    if (n.kind === 'text') return { text: n.text };
    // An element made by name takes its namespace as the HTML parser would give it: <svg> and <math> open their own.
    const namespace = n.element === 'svg' ? SVG_NS : n.element === 'math' ? MATHML_NS : parentNs;
    const attributes: [string, string][] = [['data-dragon-id', n.id], ...Object.entries(n.attributes).filter(([name]) => name !== 'class')];
    const cls = n.classByState === undefined ? (n.attributes['class'] ?? null) : valueUnder(n.classByState, values, n.id);
    if (cls !== null) attributes.push(['class', cls]);
    for (const [name, entries] of Object.entries(n.attributesByState ?? {})) {
      const v = valueUnder(entries, values, n.id);
      if (v !== null) attributes.push([name, v]);
    }
    if (attributes.slice(1).some(([name]) => name === 'data-dragon-id')) throw new Error(`${n.id}: data-dragon-id is the comparison's own attribute, so the input cannot set it`);
    return { element: n.element, namespace, attributes, children: (children.get(n.id) ?? []).map((c) => build(c, namespace)) };
  };
  return (children.get(null) ?? []).map((n) => build(n, HTML_NS));
}

/** The whole document Chrome must lay out: html, an empty head (its content is the comparison's own styles) and the body. */
export function marklessDocumentTree(input: MarklessStyleInput, values: Values): DocumentNode {
  return {
    element: 'html',
    namespace: HTML_NS,
    attributes: [['data-dragon-id', 'html']],
    children: [{ element: 'head', namespace: HTML_NS, attributes: [], children: [] }, { element: 'body', namespace: HTML_NS, attributes: [['data-dragon-id', 'body']], children: marklessBodyTree(input, values) }],
  };
}

/** Runs in the page: the document as marklessDocumentTree describes it, the head's content left out. */
export const readDocumentTree = (): DocumentNode => {
  const read = (n: Node): DocumentNode => {
    if (n.nodeType === Node.TEXT_NODE) return { text: (n as Text).data };
    if (n.nodeType !== Node.ELEMENT_NODE) return { element: `#${n.nodeName}`, namespace: '', attributes: [], children: [] };
    const el = n as Element;
    return { element: el.localName, namespace: el.namespaceURI ?? '', attributes: [...el.attributes].map((a) => [a.name, a.value] as const), children: el === document.head ? [] : [...el.childNodes].map(read) };
  };
  return read(document.documentElement);
};

/** Where Chrome's document first differs from the tree it must hold, or null when it holds exactly that tree. */
export function documentMismatch(want: DocumentNode, got: DocumentNode, path = 'html'): string | null {
  if ('text' in want || 'text' in got) return JSON.stringify(want) === JSON.stringify(got) ? null : `${path}: ${JSON.stringify(got)} where the input has ${JSON.stringify(want)}`;
  if (want.element !== got.element || want.namespace !== got.namespace || JSON.stringify(want.attributes) !== JSON.stringify(got.attributes)) {
    return `${path}: <${got.element}> in ${got.namespace} with ${JSON.stringify(got.attributes)} where the input has <${want.element}> in ${want.namespace} with ${JSON.stringify(want.attributes)}`;
  }
  if (want.children.length !== got.children.length) return `${path}: ${got.children.length} child nodes where the input has ${want.children.length}`;
  for (const [i, w] of want.children.entries()) {
    const m = documentMismatch(w, got.children[i] as DocumentNode, `${path}/${i}`);
    if (m !== null) return m;
  }
  return null;
}

/** The input's document as one assignment shows it, its body built by DOM calls since the HTML parser rebuilds some trees (a <div> in a <p>). */
export function marklessDocumentHtml(input: MarklessStyleInput, values: Values): string {
  // The HTML tokenizer ends a <style> at "</style" followed by white space, "/" or ">".
  if (/<\/style[\t\n\f\r />]/i.test(input.css)) throw new Error(`${input.component}: the css holds "</style", which would end the document's <style> early`);
  const json = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');
  const build = `(() => {
  const self = document.currentScript;
  const tree = ${json(marklessBodyTree(input, values))};
  const make = (n) => {
    if ('text' in n) return document.createTextNode(n.text);
    const el = document.createElementNS(n.namespace, n.element);
    for (const [name, value] of n.attributes) el.setAttribute(name, value);
    for (const c of n.children) el.append(make(c));
    return el;
  };
  document.addEventListener('DOMContentLoaded', () => {
    const sheet = document.createElement('style');
    sheet.textContent = ${json(MARKLESS_DOCUMENT_CSS)};
    self.replaceWith(sheet);
    document.body.append(...tree.map(make));
  }, { once: true });
})();`;
  return `<!DOCTYPE html>\n<html data-dragon-id="html"><head><script>${build}</script><style>${input.css}</style></head><body data-dragon-id="body"></body></html>`;
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

/** Chrome's capture of the input's tree as one assignment shows it, on the target's device, in a colour scheme. */
export function captureMarklessAssignment(browser: Browser, input: MarklessStyleInput, t: ExportTarget, values: Values, scheme: 'light' | 'dark'): Promise<WebCapture> {
  const fonts = fontReferencePrepare(FONT_REFERENCE_MAP);
  return captureFixture(browser, `markless-${input.component}`, authoredFontHtml(marklessDocumentHtml(input, values)), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], async (page) => {
    await page.emulateMedia({ colorScheme: scheme });
    await fonts(page);
    const mismatch = documentMismatch(marklessDocumentTree(input, values), await page.evaluate(readDocumentTree));
    if (mismatch !== null) throw new Error(`Chrome's document is not the input's tree: ${mismatch}`);
  });
}

/** A measured box, or (maxDeltaDevicePx null, never passing) a box only one side has, with the problem named. */
export type CompareRow = { readonly target: string; readonly values: Values; readonly id: string; readonly maxDeltaDevicePx: number | null; readonly pass: boolean; readonly problem?: string };

export async function compareMarklessExport(input: MarklessStyleInput, exported: NativeStyleExport): Promise<{ readonly compared: number; readonly failed: number; readonly rows: readonly CompareRow[] }> {
  const rows: CompareRow[] = [];
  const compiled = marklessCompiledTargets(input);
  const targetsOf = (o: object): string[] => Object.entries(o).filter(([, t]) => t !== undefined).map(([k]) => k).sort();
  if (JSON.stringify(targetsOf(exported.targets)) !== JSON.stringify(targetsOf(compiled))) throw new Error(`the export's targets ${targetsOf(exported.targets).join(', ') || 'none'} are not the targets the input compiles to, ${targetsOf(compiled).join(', ')}`);
  for (const [target, t] of Object.entries(exported.targets)) if (t !== undefined) checkCoverage(input, compiled[target as NativeStyleTarget], target, t);
  // Chrome's capture names nodes by Dragon's rule under each element's data-dragon-id, its input id, as the export does.
  const idOf = marklessNodeId(input, (id) => id);
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
        const capture = await captureMarklessAssignment(browser, input, t, assignment.values, scheme);
        const ids = capture.nodes.map((c) => c.id);
        const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
        if (twice.length > 0) throw new Error(`Chrome's capture names more than one node ${[...new Set(twice)].join(', ')}: an input id collides with another node's address`);
        const seen = new Set<string>();
        const mismatch = (id: string, problem: string): void => {
          rows.push({ target, values: assignment.values, id, maxDeltaDevicePx: null, pass: false, problem });
        };
        for (const c of capture.nodes) {
          // The export has no line boxes; a text node's own box is compared.
          if (c.kind === 'line') continue;
          const id = idOf(c.id);
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
