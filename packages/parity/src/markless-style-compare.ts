// Every frame of every assignment of a Markless style export against Chrome's boxes for the same element tree, at the export's
// viewport and ratio, under the device lanes' gate: classes and attributes as each assignment's states set them, and the colour
// scheme its @media band reads. Usage: pnpm run markless:style-compare -- <input.json> <export.json> <report.json>
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { NativeStyleTarget } from 'dragon';
import { BAND_KEY } from 'dragon';
import { authoredFontHtml } from './cases.ts';
import type { WebCapture } from './capture.ts';
import { captureFixture } from './capture.ts';
import { launchChrome } from './chrome.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from './font-reference.ts';
import type { CapturedNode } from './capture.ts';
import type { MarklessCompiledTarget, MarklessFontFile, MarklessFonts, MarklessStyleInput } from './markless-style-input.ts';
import { MARKLESS_BOXLESS_ATTRIBUTE, marklessCompiledTargets, marklessDocumentCss, marklessNodeId, marklessShownModal, schemeOf, shownText, stateCombinations, valueUnder } from './markless-style-input.ts';
import type { ExportAssignment, ExportTarget, NativeStyleExport } from './native-style-export.ts';
import { systemFontReference } from './system-fonts/reference.ts';

type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Values = Readonly<Record<string, unknown>>;

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/** A node of the document as Chrome must hold it: an element (namespace, name, attributes in order) or a text node. */
export type DocumentNode =
  | { readonly element: string; readonly namespace: string; readonly attributes: readonly (readonly [string, string])[]; readonly children: readonly DocumentNode[] }
  | { readonly text: string };

/** The ids of the dialogs the host shows with showModal(), whose ::backdrop boxes are measured beside the page's nodes. */
export const modalIds = (input: MarklessStyleInput): string[] => input.nodes.filter(marklessShownModal).map((n) => n.id);

/**
 * The input's body as one assignment shows it, node for node, each element named by its input id (data-dragon-id), as the DOM
 * calls build it: a dialog the host shows with showModal() has no open attribute until it is shown.
 */
export function marklessBodyTree(input: MarklessStyleInput, values: Values): DocumentNode[] {
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const modal = new Set(modalIds(input));
  const build = (n: MarklessStyleInput['nodes'][number], parentNs: string): DocumentNode => {
    if (n.kind === 'text') return { text: shownText(n, values) };
    // An element made by name takes its namespace as the HTML parser would give it: <svg> and <math> open their own.
    const namespace = n.element === 'svg' ? SVG_NS : n.element === 'math' ? MATHML_NS : parentNs;
    const shown = (name: string): boolean => name !== 'class' && !(name === 'open' && modal.has(n.id));
    const attributes: [string, string][] = [['data-dragon-id', n.id], ...Object.entries(n.attributes).filter(([name]) => shown(name))];
    if (n.boxless === true) attributes.push([MARKLESS_BOXLESS_ATTRIBUTE, '']);
    const cls = n.classByState === undefined ? (n.attributes['class'] ?? null) : valueUnder(n.classByState, values, n.id);
    if (cls !== null) attributes.push(['class', cls]);
    for (const [name, entries] of Object.entries(n.attributesByState ?? {})) {
      if (!shown(name)) continue;
      const v = valueUnder(entries, values, n.id);
      if (v !== null) attributes.push([name, v]);
    }
    if (attributes.slice(1).some(([name]) => name === 'data-dragon-id')) throw new Error(`${n.id}: data-dragon-id is the comparison's own attribute, so the input cannot set it`);
    return { element: n.element, namespace, attributes, children: (children.get(n.id) ?? []).map((c) => build(c, namespace)) };
  };
  return (children.get(null) ?? []).map((n) => build(n, HTML_NS));
}

/** The body tree once each modal dialog is shown: showModal() adds open="" after the dialog's other attributes. */
const shownModal = (nodes: readonly DocumentNode[], modal: ReadonlySet<string>): DocumentNode[] => nodes.map((n) => {
  if ('text' in n) return n;
  const open = n.element === 'dialog' && n.namespace === HTML_NS && modal.has(n.attributes[0]?.[1] ?? '');
  return { ...n, attributes: open ? [...n.attributes, ['open', '']] : n.attributes, children: shownModal(n.children, modal) };
});

/** The whole document Chrome must lay out: html, an empty head (its content is the comparison's own styles) and the body. */
export function marklessDocumentTree(input: MarklessStyleInput, values: Values): DocumentNode {
  return {
    element: 'html',
    namespace: HTML_NS,
    attributes: [['data-dragon-id', 'html']],
    children: [{ element: 'head', namespace: HTML_NS, attributes: [], children: [] }, { element: 'body', namespace: HTML_NS, attributes: [['data-dragon-id', 'body']], children: shownModal(marklessBodyTree(input, values), new Set(modalIds(input))) }],
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

/**
 * The input's document as one assignment shows it, its body built by DOM calls since the HTML parser rebuilds some trees (a <div>
 * in a <p>); then each dialog the host shows is opened with showModal(), in tree order.
 */
export function marklessDocumentHtml(input: MarklessStyleInput, values: Values, fonts: MarklessFonts = 'pinned'): string {
  // The HTML tokenizer ends a <style> at "</style" followed by white space, "/" or ">".
  if (/<\/style[\t\n\f\r />]/i.test(input.css)) throw new Error(`${input.component}: the css holds "</style", which would end the document's <style> early`);
  const json = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');
  const build = `(() => {
  const self = document.currentScript;
  const tree = ${json(marklessBodyTree(input, values))};
  const modal = new Set(${json(modalIds(input))});
  const shown = [];
  const make = (n) => {
    if ('text' in n) return document.createTextNode(n.text);
    const el = document.createElementNS(n.namespace, n.element);
    for (const [name, value] of n.attributes) el.setAttribute(name, value);
    if (el.localName === 'dialog' && el.namespaceURI === ${json(HTML_NS)} && modal.has(el.getAttribute('data-dragon-id'))) shown.push(el);
    for (const c of n.children) el.append(make(c));
    return el;
  };
  document.addEventListener('DOMContentLoaded', () => {
    const sheet = document.createElement('style');
    sheet.textContent = ${json(marklessDocumentCss(input, fonts))};
    self.replaceWith(sheet);
    document.body.append(...tree.map(make));
    for (const d of shown) d.showModal();
  }, { once: true });
})();`;
  return `<!DOCTYPE html>\n<html data-dragon-id="html"><head><script>${build}</script><style>${input.css}</style></head><body data-dragon-id="body"></body></html>`;
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

/**
 * Refuses an export whose targets are not exactly the targets the input compiles to, and a target subset (`only`) naming a target
 * the input does not compile to: only the targets a caller names are left uncompared.
 */
export function checkTargets(exported: NativeStyleExport, compiled: { readonly [T in NativeStyleTarget]?: MarklessCompiledTarget }, only: readonly string[] | null = null): void {
  const targetsOf = (o: object): string[] => Object.entries(o).filter(([, t]) => t !== undefined).map(([k]) => k).sort();
  const want = targetsOf(compiled);
  if (JSON.stringify(targetsOf(exported.targets)) !== JSON.stringify(want)) throw new Error(`the export's targets ${targetsOf(exported.targets).join(', ') || 'none'} are not the targets the input compiles to, ${want.join(', ')}`);
  const unknown = (only ?? []).filter((t) => !want.includes(t));
  if (unknown.length > 0 || only?.length === 0) throw new Error(`the targets to compare, ${only?.join(', ') || 'none'}, are not a set of the targets the input compiles to, ${want.join(', ')}`);
}

/** How Chrome draws an assignment's text: the export's font mode, its author font files by url, and the faces to load. */
export type MarklessChromeFonts = { readonly mode: MarklessFonts; readonly files: ReadonlyMap<string, Uint8Array>; readonly prepare: (page: Page) => Promise<void> };

/**
 * Chrome's capture of the input's tree as one assignment shows it, on the target's device, in a colour scheme, with each shown
 * dialog's ::backdrop box; the document is checked node for node against the input's tree first. `screenshot`: a path for
 * Chrome's rendering.
 */
export async function captureMarklessAssignment(browser: Browser, input: MarklessStyleInput, t: ExportTarget, values: Values, scheme: 'light' | 'dark', fonts: MarklessChromeFonts = { mode: 'pinned', files: new Map(), prepare: fontReferencePrepare(FONT_REFERENCE_MAP) }, screenshot?: string): Promise<WebCapture> {
  let backdrops: CapturedNode[] = [];
  const capture = await captureFixture(browser, `markless-${input.component}`, authoredFontHtml(marklessDocumentHtml(input, values, fonts.mode), fonts.files), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], async (page) => {
    await page.emulateMedia({ colorScheme: scheme });
    await fonts.prepare(page);
    const mismatch = documentMismatch(marklessDocumentTree(input, values), await page.evaluate(readDocumentTree));
    if (mismatch !== null) throw new Error(`Chrome's document is not the input's tree: ${mismatch}`);
    backdrops = await page.evaluate(collectBackdrops, modalIds(input));
    await checkBackdrops(page, backdrops);
    if (screenshot !== undefined) await page.screenshot({ path: screenshot, fullPage: true });
  });
  return { ...capture, nodes: [...capture.nodes, ...backdrops] };
}

/**
 * Runs in the page (so it closes over nothing): each shown dialog's ::backdrop border box as "<id>::backdrop", untransformed as
 * every captured frame is, from its resolved position, margins, size, padding, borders, box-sizing and zoom.
 */
export const collectBackdrops = (ids: string[]): CapturedNode[] => {
  const out: CapturedNode[] = [];
  for (const el of Array.from(document.querySelectorAll('dialog[data-dragon-id]'))) {
    const id = el.getAttribute('data-dragon-id') as string;
    if (!ids.includes(id)) continue;
    const cs = getComputedStyle(el, '::backdrop');
    const px = (p: string): number => {
      const v = cs.getPropertyValue(p);
      if (!/^-?[0-9.]+(e-?[0-9]+)?px$/.test(v)) throw new Error(`${id}::backdrop: ${p} resolves to ${v}, not a length in px`);
      return parseFloat(v);
    };
    const hasBox = el.matches(':modal') && cs.display !== 'none';
    if (!hasBox) {
      out.push({ id: `${id}::backdrop`, kind: 'element', hasBox, x: 0, y: 0, width: 0, height: 0, computed: null });
      continue;
    }
    // Resolved lengths are in the backdrop's own unzoomed px; it inherits its effective zoom from the dialog.
    let zoom = parseFloat(cs.zoom || '1');
    for (let a: Element | null = el; a !== null; a = a.parentElement) zoom *= parseFloat(getComputedStyle(a).zoom || '1');
    const contentBox = cs.boxSizing !== 'border-box';
    const extra = (a: string, b: string): number => (contentBox ? px(`padding-${a}`) + px(`padding-${b}`) + px(`border-${a}-width`) + px(`border-${b}-width`) : 0);
    out.push({
      id: `${id}::backdrop`,
      kind: 'element',
      hasBox,
      x: (px('left') + px('margin-left')) * zoom,
      y: (px('top') + px('margin-top')) * zoom,
      width: (px('width') + extra('left', 'right')) * zoom,
      height: (px('height') + extra('top', 'bottom')) * zoom,
      computed: null,
    });
  }
  return out;
};

/** The backdrop layout as collectBackdrops reads it must be within one layout unit (1/64 CSS px) of Chrome's own border box. */
const BACKDROP_CHECK_CSS_PX = 1 / 64;

/**
 * Checks collectBackdrops (which the phones' browsers run too) against the border box Chrome laid each ::backdrop out at, read
 * through CDP with transforms set aside, as every captured frame is untransformed.
 */
async function checkBackdrops(page: Page, measured: readonly CapturedNode[]): Promise<void> {
  if (!measured.some((b) => b.hasBox)) return;
  const sheet = await page.evaluateHandle(() => {
    const s = document.createElement('style');
    s.textContent = '::backdrop { transform: none !important; translate: none !important; rotate: none !important; scale: none !important; }';
    document.head.append(s);
    return s;
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    type Node = { readonly nodeId: number; readonly attributes?: readonly string[]; readonly children?: readonly Node[]; readonly pseudoElements?: readonly (Node & { readonly pseudoType?: string })[] };
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: Node };
    const found = new Map<string, number>();
    const walk = (n: Node): void => {
      const attrs = n.attributes ?? [];
      const at = attrs.indexOf('data-dragon-id');
      const backdrop = n.pseudoElements?.find((p) => p.pseudoType === 'backdrop');
      if (at >= 0 && at % 2 === 0 && backdrop !== undefined) found.set(attrs[at + 1] as string, backdrop.nodeId);
      for (const c of n.children ?? []) walk(c);
    };
    walk(root);
    for (const b of measured) {
      const id = b.id.slice(0, -'::backdrop'.length);
      const nodeId = found.get(id);
      if (!b.hasBox) {
        if (nodeId !== undefined) throw new Error(`${b.id}: Chrome lays out a backdrop the page reads as having no box`);
        continue;
      }
      if (nodeId === undefined) throw new Error(`${b.id}: Chrome lays out no backdrop box for a dialog the page reads as shown`);
      const { model } = (await cdp.send('DOM.getBoxModel', { nodeId })) as { model: { border: number[] } };
      const xs = model.border.filter((_, i) => i % 2 === 0);
      const ys = model.border.filter((_, i) => i % 2 === 1);
      const chrome = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      const off = (['x', 'y', 'width', 'height'] as const).filter((k) => Math.abs(chrome[k] - b[k]) > BACKDROP_CHECK_CSS_PX);
      if (off.length > 0) throw new Error(`${b.id}: the page reads the box ${JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height })}, Chrome lays it out at ${JSON.stringify(chrome)}`);
    }
  } finally {
    await cdp.detach();
    await sheet.evaluate((s) => s.remove());
  }
}

/** Why a node has a box on only one side. */
export type BoxProblem = 'no-node' | 'no-frame' | 'no-box' | 'unseen' | 'anonymous';

const CHROME_PROBLEM: { readonly [K in BoxProblem]: string } = {
  'no-node': 'Chrome has a box but the export has no node',
  'no-frame': 'Chrome has a box but the export has no frame',
  'no-box': 'Chrome generates no box but the export has a frame',
  unseen: 'the export has a framed node Chrome does not have',
  anonymous: 'anonymous box whose nodes are not all Chrome nodes',
};

/**
 * One assignment's browser boxes paired with the export's nodes by input id (a text node by Dragon's numbering of the text it shows
 * under its element's data-dragon-id, a ::backdrop by its dialog); every box only one side has is a problem, never skipped. The
 * export has no line boxes.
 */
export function pairBoxes(input: MarklessStyleInput, assignment: ExportAssignment, captured: readonly CapturedNode[]): { readonly pairs: readonly { readonly id: string; readonly c: CapturedNode }[]; readonly problems: readonly { readonly id: string; readonly kind: BoxProblem }[] } {
  const ids = captured.map((c) => c.id);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (twice.length > 0) throw new Error(`the browser's capture names more than one node ${[...new Set(twice)].join(', ')}: an input id collides with another node's address`);
  // The browser names nodes by Dragon's rule under each element's data-dragon-id, its input id, as the export does.
  const idOf = marklessNodeId(input, (id) => id, assignment.values);
  const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const pairs: { id: string; c: CapturedNode }[] = [];
  const problems: { id: string; kind: BoxProblem }[] = [];
  for (const c of captured) {
    if (c.kind === 'line') continue;
    const id = idOf(c.id);
    seen.add(id);
    const node = byId.get(id);
    if (!c.hasBox) {
      if (node !== undefined && node.frame !== null) problems.push({ id, kind: 'no-box' });
      continue;
    }
    if (node === undefined && c.svg !== undefined) continue;
    if (node === undefined || node.frame === null) {
      problems.push({ id, kind: node === undefined ? 'no-node' : 'no-frame' });
      continue;
    }
    pairs.push({ id, c });
  }
  for (const n of assignment.nodes) {
    if (seen.has(n.id) || n.frame === null) continue;
    if (n.kind !== 'anonymous') {
      problems.push({ id: n.id, kind: 'unseen' });
      continue;
    }
    // An anonymous box only Dragon has passes only when it holds at least one node and the browser has every one of them.
    const inside = assignment.nodes.filter((x) => x.parent === n.id);
    if (inside.length === 0 || inside.some((x) => !seen.has(x.id))) problems.push({ id: n.id, kind: 'anonymous' });
  }
  return { pairs, problems };
}

/** A measured box, or (maxDeltaDevicePx null, never passing) a box only one side has, with the problem named. */
export type CompareRow = { readonly target: string; readonly values: Values; readonly id: string; readonly maxDeltaDevicePx: number | null; readonly pass: boolean; readonly problem?: string };

/**
 * With `screenshots`, Chrome's rendering of each assignment is saved there as `<target>-<assignment>.png`, the reference a device
 * screenshot is read beside. `unbanded`: the colour-scheme preference Chrome is given for an assignment no band fixes (light).
 * `fonts`: the input's author font files (marklessFontFiles), which Chrome loads at their urls. `mode`: how the export resolved fonts
 * (marklessStyleExport); with system fonts Chrome draws each target's system faces from the files the export measured
 * (system-fonts/reference.ts), else the pinned reference faces.
 */
export async function compareMarklessExport(input: MarklessStyleInput, exported: NativeStyleExport, screenshots?: string, unbanded: 'light' | 'dark' = 'light', fonts: readonly MarklessFontFile[] = [], mode: MarklessFonts = 'pinned', only: readonly string[] | null = null): Promise<{ readonly compared: number; readonly failed: number; readonly rows: readonly CompareRow[] }> {
  const rows: CompareRow[] = [];
  const files = new Map(fonts.map((f) => [f.url, f.bytes]));
  const compiled = marklessCompiledTargets(input, fonts, mode);
  checkTargets(exported, compiled, only);
  for (const [target, t] of Object.entries(exported.targets)) if (t !== undefined) checkCoverage(input, compiled[target as NativeStyleTarget], target, t);
  for (const [target, t] of Object.entries(exported.targets)) {
    if (t === undefined || (only !== null && !only.includes(target))) continue;
    // Safari, not Chrome, is the web that draws iOS's system and author faces: Chrome on the Mac rounds their metrics and spaces otherwise.
    if (mode === 'system' && target === 'ios' && ((exported.systemFonts ?? []).some((e) => e.ios !== undefined) || exported.fonts.some((f) => f.from === 'input'))) throw new Error(`${input.component}: the iOS target measures its faces as Safari does, so it is compared with Safari on iOS (markless:style-web-column), not Chrome; compare the other targets`);
    const browser: Browser = await launchChrome(t.dpr);
    try {
      for (const [index, assignment] of t.assignments.entries()) {
        const band = assignment.values[BAND_KEY];
        const scheme = typeof band === 'number' ? schemeOf(t.bands, band) : unbanded;
        const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
        const absolute = (id: string): Frame => {
          const n = byId.get(id);
          if (n === undefined || n.frame === null) throw new Error(`${id} has no frame`);
          const p = n.parent === null ? { x: 0, y: 0 } : absolute(n.parent);
          return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
        };
        const prepare = mode === 'system' ? systemFontReference(target as 'ios' | 'android', exported.systemFonts ?? []) : fontReferencePrepare(FONT_REFERENCE_MAP);
        const capture = await captureMarklessAssignment(browser, input, t, assignment.values, scheme, { mode, files, prepare }, screenshots === undefined ? undefined : join(screenshots, `${target}-${index}.png`));
        const paired = pairBoxes(input, assignment, capture.nodes);
        for (const { id, kind } of paired.problems) rows.push({ target, values: assignment.values, id, maxDeltaDevicePx: null, pass: false, problem: CHROME_PROBLEM[kind] });
        for (const { id, c } of paired.pairs) {
          const d = absolute(id);
          const chrome = { x: c.x * t.dpr, y: c.y * t.dpr, width: c.width * t.dpr, height: c.height * t.dpr };
          const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(chrome[k] - d[k])));
          rows.push({ target, values: assignment.values, id, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX });
        }
      }
    } finally {
      await browser.close();
    }
  }
  return { compared: rows.filter((r) => r.maxDeltaDevicePx !== null).length, failed: rows.filter((r) => !r.pass).length, rows };
}
