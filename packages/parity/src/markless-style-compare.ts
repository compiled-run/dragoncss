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
import { launchChrome, openPage } from './chrome.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from './font-reference.ts';
import type { CapturedNode } from './capture.ts';
import type { MarklessCompiledTarget, MarklessExportAssignment, MarklessFontFile, MarklessFonts, MarklessStyleExport, MarklessStyleInput } from './markless-style-input.ts';
import { armShown, assignmentCombinations, checkMarklessExport, filledAtInitial, MARKLESS_BOXLESS_ATTRIBUTE, marklessCompiledTargets, marklessDocumentCss, marklessNodeId, marklessShownModal, schemeOf, shownText, valueUnder } from './markless-style-input.ts';
import type { ExportAssignment, ExportInteractionMatch, ExportNode, ExportTarget, NativeStyleExport } from './native-style-export.ts';
import type { ForcedPseudo } from './cases.ts';
import { forcePseudo } from './forced-pseudo.ts';
import { decodePng } from './pixel-reference.ts';
import type { SystemFonts } from './system-fonts/provider.ts';
import { systemFontsFor, systemRequestOf } from './system-fonts/provider.ts';
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
export function marklessBodyTree(slotted: MarklessStyleInput, values: Values): DocumentNode[] {
  const input = filledAtInitial(slotted);
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
    return { element: n.element, namespace, attributes, children: shownIn(children.get(n.id)).map((c) => build(c, namespace)) };
  };
  // A node of an arm its branch does not show here is not in the page, as the web leaves it out.
  const shownIn = (nodes: readonly MarklessStyleInput['nodes'][number][] | undefined): MarklessStyleInput['nodes'][number][] => (nodes ?? []).filter((n) => armShown(input, n.arm, values));
  return shownIn(children.get(null)).map((n) => build(n, HTML_NS));
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
 * Refuses a target whose device, states, @media bands, assignments or state machine are not exactly what the input compiles to for
 * that target, one assignment per combination of the input's states and bands, since a band or assignment left out would never be
 * compared, and Chrome lays out at whatever viewport the target states.
 */
export function checkCoverage(input: MarklessStyleInput, compiled: MarklessCompiledTarget | undefined, target: string, t: ExportTarget): void {
  if (compiled === undefined) throw new Error(`${target}: the input does not compile to this target`);
  if (t.viewport.width !== compiled.viewport.width || t.viewport.height !== compiled.viewport.height || t.dpr !== compiled.dpr) {
    throw new Error(`${target}: viewport ${JSON.stringify({ width: t.viewport.width, height: t.viewport.height })} at ${t.dpr}x is not the input's ${JSON.stringify({ width: compiled.viewport.width, height: compiled.viewport.height })} at ${compiled.dpr}x`);
  }
  const banded = compiled.bands !== undefined;
  if (JSON.stringify(t.states) !== JSON.stringify(compiled.states)) throw new Error(`${target}: states ${JSON.stringify(t.states)} are not the input's states${banded ? ' and the band' : ''} ${JSON.stringify(compiled.states)}`);
  if (JSON.stringify(t.bands ?? null) !== JSON.stringify(compiled.bands ?? null)) throw new Error(`${target}: bands ${JSON.stringify(t.bands ?? null)} are not the bands the input's @media compiles to ${JSON.stringify(compiled.bands ?? null)}`);
  const keys = compiled.states.map((s) => s.key);
  const want = assignmentCombinations(input).flatMap((c) => (compiled.bands === undefined ? [c] : compiled.bands.bands.map((_, b): Values => ({ ...c, [BAND_KEY]: b }))));
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
  const shown = (values: Values): string => JSON.stringify(Object.fromEntries(keys.map((k) => [k, values[k]])));
  const at = (i: unknown): Values | undefined => (Number.isInteger(i) ? t.assignments[i as number]?.values : undefined);
  const initial = at(t.initial);
  if (initial === undefined) throw new Error(`${target}: initial ${JSON.stringify(t.initial)} is not an assignment`);
  const compiledInitial = compiled.assignments[compiled.initial] as Values;
  if (keyOf(initial) !== keyOf(compiledInitial)) throw new Error(`${target}: the initial assignment ${shown(initial)} is not the input's ${shown(compiledInitial)}`);
  if (!Array.isArray(t.next) || t.next.length !== t.assignments.length) throw new Error(`${target}: next is not one row per assignment`);
  const compiledIndex = new Map(compiled.assignments.map((v, i) => [keyOf(v), i]));
  const reached = (i: unknown, of: (i: number) => Values | undefined): string => {
    if (i === -1) return 'no assignment';
    const v = Number.isInteger(i) ? of(i as number) : undefined;
    return v === undefined ? `${JSON.stringify(i ?? null)}, not an assignment` : shown(v);
  };
  for (const [i, a] of t.assignments.entries()) {
    const j = compiledIndex.get(keyOf(a.values)) as number;
    for (const [s, state] of compiled.states.entries()) {
      for (const [v, value] of state.domain.entries()) {
        const got = reached(t.next[i]?.[s]?.[v], at);
        const wantTo = reached(compiled.next[j]?.[s]?.[v], (k) => compiled.assignments[k]);
        if (got !== wantTo) throw new Error(`${target}: setting ${state.key} to ${JSON.stringify(value)} from ${shown(a.values)} reaches ${got}, where the input reaches ${wantTo}`);
      }
    }
  }
}

/**
 * Refuses an export of another component, or whose targets are not exactly the targets the input compiles to, and a target
 * subset (`only`) naming a target the input does not compile to: only the targets a caller names are left uncompared.
 */
export function checkTargets(input: MarklessStyleInput, exported: NativeStyleExport, compiled: { readonly [T in NativeStyleTarget]?: MarklessCompiledTarget }, only: readonly string[] | null = null): void {
  if (exported.component !== input.component) throw new Error(`the export is of ${exported.component}, not the input's ${input.component}`);
  const targetsOf = (o: object): string[] => Object.entries(o).filter(([, t]) => t !== undefined).map(([k]) => k).sort();
  const want = targetsOf(compiled);
  if (JSON.stringify(targetsOf(exported.targets)) !== JSON.stringify(want)) throw new Error(`the export's targets ${targetsOf(exported.targets).join(', ') || 'none'} are not the targets the input compiles to, ${want.join(', ')}`);
  const unknown = (only ?? []).filter((t) => !want.includes(t));
  if (unknown.length > 0 || only?.length === 0) throw new Error(`the targets to compare, ${only?.join(', ') || 'none'}, are not a set of the targets the input compiles to, ${want.join(', ')}`);
}

/** Refuses an export that lists a face from the input that is not one of the input's font files, by id and file, which the hosts load. */
export function checkInputFonts(exported: NativeStyleExport, fonts: readonly MarklessFontFile[]): void {
  for (const f of exported.fonts) {
    if (f.from !== 'input') continue;
    if (!fonts.some((x) => x.id === f.id && x.sfntFile === f.file)) throw new Error(`the export lists the face ${f.id} from the input as ${f.file}, which is not one of the input's font files`);
  }
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
  const capture = await captureFixture(browser, `markless-${input.component}`, authoredFontHtml(marklessDocumentHtml(input, values, fonts.mode), fonts.files), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, OUTLINE_PROPERTIES, async (page) => {
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
    // Chrome draws a backdrop only under a dialog that is laid out.
    const hasBox = el.matches(':modal') && cs.display !== 'none' && el.getClientRects().length > 0;
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

/**
 * Runs every cleanup step, each whatever the others do, then rethrows: the body's error with every failed step's error in an
 * AggregateError, or the failed steps alone when the body succeeded.
 */
export async function withCleanup<T>(body: (undo: (name: string, step: () => void | Promise<void>) => void) => Promise<T>): Promise<T> {
  const steps: { readonly name: string; readonly step: () => void | Promise<void> }[] = [];
  let failed: { readonly error: unknown } | null = null;
  let value: T | undefined;
  try {
    value = await body((name, step) => steps.push({ name, step }));
  } catch (error) {
    failed = { error };
  }
  const errors: Error[] = [];
  for (const { name, step } of steps.reverse()) {
    try {
      await step();
    } catch (e) {
      errors.push(new Error(`cleanup (${name}) failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e }));
    }
  }
  if (failed !== null) {
    if (errors.length === 0) throw failed.error;
    const message = failed.error instanceof Error ? failed.error.message : String(failed.error);
    throw new AggregateError([failed.error, ...errors], `${message}; and ${errors.map((e) => e.message).join('; ')}`);
  }
  if (errors.length > 0) throw new AggregateError(errors, errors.map((e) => e.message).join('; '));
  return value as T;
}

/** The backdrop layout as collectBackdrops reads it must be within one layout unit (1/64 CSS px) of Chrome's own border box. */
const BACKDROP_CHECK_CSS_PX = 1 / 64;

/**
 * Sets every ::backdrop's transforms aside in the first cascade layer of the document's first sheet, whose !important beats every
 * author !important rule (css-cascade-5 §6.4), with transitions off so the change applies at once.
 */
const UNTRANSFORMED_BACKDROPS = '@layer dragon-untransformed { ::backdrop { transform: none !important; translate: none !important; rotate: none !important; scale: none !important; transition: none !important; } }';

/**
 * Checks collectBackdrops (which the phones' browsers run too) against the border box Chrome laid each ::backdrop out at, read
 * through CDP with transforms set aside, as every captured frame is untransformed.
 */
async function checkBackdrops(page: Page, measured: readonly CapturedNode[]): Promise<void> {
  if (!measured.some((b) => b.hasBox)) return;
  await withCleanup(async (undo) => {
    const sheet = await page.evaluateHandle((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.prepend(s);
      return s;
    }, UNTRANSFORMED_BACKDROPS);
    undo('remove the untransformed-backdrop sheet', () => sheet.evaluate((s) => s.remove()));
    const cdp = await page.context().newCDPSession(page);
    undo('detach the CDP session', () => cdp.detach());
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
  });
}

/**
 * Runs in the page (so it closes over nothing), after the boxes are read: the height 100vh resolves to, the viewport's (the initial
 * containing block's), and the Canvas colour as the root's used colour scheme gives it and as light and dark give it, from probes
 * outside body that are removed again.
 */
export const readRootProbe = (): RootProbe => {
  const probe = (scheme: string): { readonly color: string; readonly height: number } => {
    const el = document.createElement('div');
    // Inline !important beats every author rule, and all:initial clears every property the probe does not set itself.
    el.style.cssText = `all:initial!important;position:absolute!important;visibility:hidden!important;width:0!important;height:100vh!important;color-scheme:${scheme}!important;color:Canvas!important`;
    document.documentElement.append(el);
    const cs = getComputedStyle(el);
    const out = { color: cs.color, height: parseFloat(cs.height) };
    el.remove();
    return out;
  };
  const root = probe('inherit');
  return { vh: root.height, viewportHeight: document.documentElement.clientHeight, innerHeight, prefersDark: matchMedia('(prefers-color-scheme: dark)').matches, canvas: root.color, lightCanvas: probe('light').color, darkCanvas: probe('dark').color };
};
export type RootProbe = { readonly vh: number; readonly viewportHeight: number; readonly innerHeight: number; readonly prefersDark: boolean; readonly canvas: string; readonly lightCanvas: string; readonly darkCanvas: string };

/** The root's used colour scheme as the browser resolves it: the scheme whose Canvas colour the root's gives. */
export function usedScheme(p: RootProbe): 'light' | 'dark' {
  if (p.lightCanvas === p.darkCanvas) throw new Error(`the browser gives Canvas one colour, ${p.lightCanvas}, in light and dark, so its used colour scheme cannot be read`);
  if (p.canvas === p.lightCanvas) return 'light';
  if (p.canvas === p.darkCanvas) return 'dark';
  throw new Error(`the root's Canvas colour ${p.canvas} is neither light's ${p.lightCanvas} nor dark's ${p.darkCanvas}`);
}

type Rgba8 = MarklessExportAssignment['canvas'];

/** What Chrome paints for the page itself: the canvas, body's own box (null where body shows no area), and the root's used scheme. */
export type ChromePagePaint = { readonly canvas: Rgba8; readonly body: Rgba8 | null; readonly colorScheme: 'light' | 'dark' };

/**
 * Chrome's page paint for one assignment. The page itself gives the root's used scheme, html's and body's computed background
 * colours and whether body's box shows; the export refuses every other paint of html and body, so Chrome then paints those colours
 * in a page with no author CSS and nothing else in it, where no pseudo-element, descendant or !important rule can cover the pixels:
 * the canvas at the viewport's top left, body's box below it.
 */
export async function chromePagePaint(browser: Browser, html: string, input: MarklessStyleInput, t: ExportTarget, values: Values, scheme: 'light' | 'dark'): Promise<ChromePagePaint> {
  const read = await withCleanup(async (undo) => {
    const page = await openPage(browser, html, { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' });
    undo('close the page', () => page.context().close());
    await page.emulateMedia({ colorScheme: scheme });
    const mismatch = documentMismatch(marklessDocumentTree(input, values), await page.evaluate(readDocumentTree));
    if (mismatch !== null) throw new Error(`Chrome's document is not the input's tree: ${mismatch}`);
    const colorScheme = usedScheme(await page.evaluate(readRootProbe));
    return { colorScheme, ...(await page.evaluate(readRootBackgrounds)) };
  });
  return withCleanup(async (undo) => {
    const context = await browser.newContext({ viewport: { width: 2, height: 2 }, deviceScaleFactor: t.dpr });
    undo('close the probe page', () => context.close());
    const probe = await context.newPage();
    await probe.emulateMedia({ colorScheme: scheme });
    await probe.setContent('<!DOCTYPE html><html><head></head><body></body></html>');
    await probe.evaluate(paintRootBackgrounds, read);
    const pixel = async (x: number, y: number): Promise<Rgba8> => {
      const image = decodePng(await probe.screenshot({ clip: { x, y, width: 1, height: 1 } }));
      return { r: image.data[0] as number, g: image.data[1] as number, b: image.data[2] as number, alpha: image.data[3] as number };
    };
    return { canvas: await pixel(0, 0), body: read.bodyShows ? await pixel(0, 1) : null, colorScheme: read.colorScheme };
  });
}

/** Runs in the page: html's and body's computed background colours, and whether body's border box shows any of the viewport. */
export const readRootBackgrounds = (): { readonly html: string; readonly body: string; readonly bodyShows: boolean } => {
  const r = document.body.getBoundingClientRect();
  const bodyShows = Math.min(innerWidth, r.right) - Math.max(0, r.left) >= 1 && Math.min(innerHeight, r.bottom) - Math.max(0, r.top) >= 1;
  return { html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, bodyShows };
};

/** Runs in the 2×2 probe page: html takes the used scheme and html's colour, body the bottom row with body's colour. */
const paintRootBackgrounds = (r: { readonly colorScheme: string; readonly html: string; readonly body: string }): void => {
  const set = (el: HTMLElement, props: Readonly<Record<string, string>>): void => {
    for (const [k, v] of Object.entries(props)) {
      el.style.setProperty(k, v);
      if (el.style.getPropertyValue(k) === '') throw new Error(`the probe page cannot take ${k}: ${v}`);
    }
  };
  set(document.documentElement, { 'color-scheme': r.colorScheme, 'background-color': r.html });
  set(document.body, { margin: '0', position: 'absolute', left: '0', top: '1px', width: '2px', height: '1px', 'background-color': r.body });
};

/** One of the page's own paint fields of an assignment against Chrome's: exact equality, failing on any difference. */
export type PaintRow = { readonly target: string; readonly values: Values; readonly field: 'canvas' | 'bodyBackground' | 'colorScheme'; readonly exported: unknown; readonly chrome: unknown; readonly pass: boolean };

/** The assignment's canvas, body background (Chrome's body pixel is the canvas where body paints none) and colour scheme against Chrome's. */
export function paintRows(target: string, a: MarklessExportAssignment, chrome: ChromePagePaint): PaintRow[] {
  const same = (x: unknown, y: unknown): boolean => JSON.stringify(x) === JSON.stringify(y);
  const body = chrome.body === null ? null : same(chrome.body, chrome.canvas) ? null : chrome.body;
  const bodyPass = chrome.body === null || same(a.bodyBackground ?? a.canvas, chrome.body);
  return [
    { target, values: a.values, field: 'canvas', exported: a.canvas, chrome: chrome.canvas, pass: same(a.canvas, chrome.canvas) },
    { target, values: a.values, field: 'bodyBackground', exported: a.bodyBackground, chrome: chrome.body === null ? 'body shows no area' : body, pass: bodyPass },
    { target, values: a.values, field: 'colorScheme', exported: a.colorScheme, chrome: chrome.colorScheme, pass: a.colorScheme === chrome.colorScheme },
  ];
}

/**
 * Refuses a target's system faces that are not what the input's compile resolves: a system face a font write names with no entry
 * for the target, or an entry whose platform font is not the provider's for that face.
 */
export function checkSystemFonts(exported: NativeStyleExport, target: NativeStyleTarget, provider: Pick<SystemFonts, 'descriptor'>): void {
  const entries = new Map((exported.systemFonts ?? []).map((e) => [e.id, e[target]]));
  const named = new Set(exported.targets[target]?.assignments.flatMap((a) => a.nodes.flatMap((n) => n.writes.flatMap((w) => {
    const family = (w['font'] as { family?: unknown } | undefined)?.family;
    return w['kind'] === 'font' && typeof family === 'string' && systemRequestOf(family) !== null ? [family] : [];
  }))) ?? []);
  for (const id of named) if (entries.get(id) === undefined) throw new Error(`${target}: the export draws text in the system face ${id} and lists no ${target} font for it`);
  for (const [id, got] of entries) {
    if (got === undefined) continue;
    const { platform: _platform, ...want } = provider.descriptor(id);
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${target}: the export lists ${JSON.stringify(got)} for the system face ${id}, where the input's compile resolves ${JSON.stringify(want)}`);
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
export type CompareRow = { readonly target: string; readonly values: Values; readonly state?: string; readonly id: string; readonly maxDeltaDevicePx: number | null; readonly pass: boolean; readonly problem?: string };

/** Chrome's computed background-color as 8-bit RGBA, or null when it is not an rgb() or rgba() colour. */
function computedRgba(text: string | undefined): Rgba8 | null {
  const m = text === undefined ? null : /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(text);
  if (m === null) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), alpha: Math.round(255 * (m[4] === undefined ? 1 : Number(m[4]))) };
}

/** The outline longhands every Markless capture reads, for the outline an interaction state draws (:focus, :focus-visible). */
const OUTLINE_PROPERTIES = ['outline-style', 'outline-width', 'outline-color', 'outline-offset'];

/** A state's outline against Chrome's computed one: style, width and offset in CSS px, and colour; none where the state draws none. */
function outlineRow(target: string, values: Values, state: string, id: string, w: Record<string, unknown> | undefined, c: CapturedNode | undefined, dpr: number): CompareRow {
  const got = c?.computed;
  if (got === undefined || got === null || typeof got['outline-style'] !== 'string') return { target, values, state, id, maxDeltaDevicePx: null, pass: false, problem: "Chrome's outline was not captured" };
  const px = (v: string | undefined): number | null => (v !== undefined && v.endsWith('px') ? Number(v.slice(0, -2)) : null);
  // Chrome uses an outline's width floored to whole device px (at least one), as it does a border's; both are compared in device px.
  const devicePx = (css: number | null): number | null => (css === null ? null : css === 0 ? 0 : Math.max(1, Math.floor(css * dpr + 1e-6)));
  const chromeWidth = px(got?.['outline-width']);
  const chromeColor = computedRgba(got?.['outline-color']);
  // Chrome draws nothing for a zero-width or transparent outline, where the export writes none.
  const drawn = got['outline-style'] !== 'none' && chromeWidth !== 0 && chromeColor?.alpha !== 0;
  const chrome = drawn ? { style: got['outline-style'], width: chromeWidth === null ? null : Math.round(chromeWidth * dpr), color: chromeColor } : null;
  const exported = w === undefined ? null : { style: w['style'], width: devicePx(w['width'] as number), color: w['color'] };
  // Chrome keeps an offset to 1/64 device px; the export writes the CSS value.
  const chromeOffset = drawn ? px(got['outline-offset']) : null;
  const exportOffset = w === undefined || typeof w['offset'] !== 'number' ? null : Math.round((w['offset'] as number) * dpr * 64) / (64 * dpr);
  const offsetsMatch = chromeOffset === null || exportOffset === null ? chromeOffset === exportOffset : Math.abs(chromeOffset - exportOffset) < 1e-4;
  const pass = JSON.stringify(chrome) === JSON.stringify(exported) && offsetsMatch;
  return { target, values, state, id, maxDeltaDevicePx: null, pass, ...(pass ? {} : { problem: `outline ${JSON.stringify(exported === null ? null : { ...exported, offset: exportOffset })} in the export, ${JSON.stringify(chrome === null ? null : { ...chrome, offset: chromeOffset })} in Chrome` }) };
}

/**
 * An interaction state's paint against Chrome forced into the state. Every element of the state but html and body (whose
 * backgrounds the canvas rows compare): its background colour, or transparent where the export writes none, and its outline, or
 * none, against Chrome's computed ones, so a state that misses a change Chrome makes fails too. A write of another kind the state changes from its
 * assignment is a failing row naming it, as this comparison does not read it from Chrome yet.
 */
export function interactionPaintRows(target: string, state: string, base: ExportAssignment, a: ExportAssignment, captured: readonly CapturedNode[], dpr = 1): CompareRow[] {
  const rows: CompareRow[] = [];
  const before = new Map(base.nodes.map((n) => [n.id, n]));
  const chrome = new Map(captured.filter((c) => c.kind === 'element').map((c) => [c.id, c]));
  const byKind = (writes: ExportNode['writes']): Map<string, string> => new Map(writes.map((w) => [String(w['kind']), JSON.stringify(w)]));
  const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
  for (const n of a.nodes) {
    if (n.kind !== 'element' || n.id === 'html' || n.id === 'body') continue;
    const now = byKind(n.writes);
    const then = byKind(before.get(n.id)?.writes ?? []);
    const c = chrome.get(n.id);
    // Every boxed element, as for its background: an outline Chrome draws in the state (its focus ring included) and the export misses fails.
    if (c !== undefined && c.hasBox) rows.push(outlineRow(target, a.values, state, n.id, n.writes.find((w) => w['kind'] === 'outline'), c, dpr));
    for (const kind of [...new Set([...now.keys(), ...then.keys()])].filter((k) => k !== 'background-color' && k !== 'outline' && now.get(k) !== then.get(k))) {
      rows.push({ target, values: a.values, state, id: n.id, maxDeltaDevicePx: null, pass: false, problem: `the state changes its ${kind} write, which this comparison does not read from Chrome yet` });
    }
    if (c === undefined || !c.hasBox) continue;
    const exported = (n.writes.find((w) => w['kind'] === 'background-color')?.['color'] as Rgba8 | undefined) ?? TRANSPARENT;
    const got = computedRgba(c.computed?.['background-color']);
    const pass = got !== null && JSON.stringify(got) === JSON.stringify(exported);
    rows.push({ target, values: a.values, state, id: n.id, maxDeltaDevicePx: null, pass, ...(pass ? {} : { problem: `background-color ${JSON.stringify(exported)} in the export, ${JSON.stringify(got)} in Chrome` }) });
  }
  return rows;
}

/**
 * With `screenshots`, Chrome's rendering of each assignment is saved there as `<target>-<assignment>.png`, the reference a device
 * screenshot is read beside. `unbanded`: the colour-scheme preference Chrome is given for an assignment no band fixes (light).
 * `fonts`: the input's author font files (marklessFontFiles), which Chrome loads at their urls. The export's fontMode says how it
 * resolved fonts; with system fonts Chrome draws each target's system faces from the files the export measured
 * (system-fonts/reference.ts), else the pinned reference faces. `mode`, when given, must be the export's. `failed` counts the box
 * rows and the page's paint rows (`paint`) that fail.
 */
export async function compareMarklessExport(input: MarklessStyleInput, given: NativeStyleExport, screenshots?: string, unbanded: 'light' | 'dark' = 'light', fonts: readonly MarklessFontFile[] = [], mode: MarklessFonts | null = null, only: readonly string[] | null = null): Promise<{ readonly fontMode: MarklessFonts; readonly compared: number; readonly failed: number; readonly rows: readonly CompareRow[]; readonly paint: readonly PaintRow[] }> {
  const exported: MarklessStyleExport = checkMarklessExport(given);
  if (mode !== null && mode !== exported.fontMode) throw new Error(`the export resolved fonts as ${exported.fontMode}, not the ${mode} the comparison was asked for`);
  const fontMode = exported.fontMode;
  const rows: CompareRow[] = [];
  const paint: PaintRow[] = [];
  const files = new Map(fonts.map((f) => [f.url, f.bytes]));
  const compiled = marklessCompiledTargets(input, fonts, fontMode);
  checkTargets(input, exported, compiled, only);
  checkInputFonts(exported, fonts);
  for (const [target, t] of Object.entries(exported.targets)) if (t !== undefined) checkCoverage(input, compiled[target as NativeStyleTarget], target, t);
  for (const [target, t] of Object.entries(exported.targets)) {
    if (t === undefined || (only !== null && !only.includes(target))) continue;
    // Safari, not Chrome, is the web that draws iOS's system and author faces: Chrome on the Mac rounds their metrics and spaces otherwise.
    if (fontMode === 'system' && target === 'ios' && ((exported.systemFonts ?? []).some((e) => e.ios !== undefined) || exported.fonts.some((f) => f.from === 'input'))) throw new Error(`${input.component}: the iOS target measures its faces as Safari does, so it is compared with Safari on iOS (markless:style-web-column), not Chrome; compare the other targets`);
    if (fontMode === 'system' && target === 'android') checkSystemFonts(exported, 'android', systemFontsFor('android', t.dpr));
    await withCleanup(async (undo) => {
      const browser: Browser = await launchChrome(t.dpr);
      undo('close Chrome', () => browser.close());
      // Each assignment, then each of its interaction states with Chrome forced into it (CSS.forcePseudoState, as DevTools does).
      const views = [
        ...t.assignments.map((assignment, index) => ({ label: `${index}`, assignment, forced: [] as readonly { readonly address: string; readonly pseudo: string }[], base: null as MarklessExportAssignment | null })),
        ...(t.interaction?.levels ?? []).flatMap((l, i) => l.states.map((st, k) => ({ label: `${i}-state${k}`, assignment: st as MarklessExportAssignment, forced: (l.matches[k] as ExportInteractionMatch).force, base: t.assignments[i] as MarklessExportAssignment }))),
      ];
      for (const { label, assignment, forced, base } of views) {
        const band = assignment.values[BAND_KEY];
        const scheme = typeof band === 'number' ? schemeOf(t.bands, band) : unbanded;
        const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
        const absolute = (id: string): Frame => {
          const n = byId.get(id);
          if (n === undefined || n.frame === null) throw new Error(`${id} has no frame`);
          const p = n.parent === null ? { x: 0, y: 0 } : absolute(n.parent);
          return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
        };
        const fontPrepare = fontMode === 'system' ? systemFontReference(target as 'ios' | 'android', exported.systemFonts ?? []) : fontReferencePrepare(FONT_REFERENCE_MAP);
        const force = forcePseudo(forced as readonly ForcedPseudo[]);
        const prepare = forced.length === 0 ? fontPrepare : async (page: Page): Promise<void> => {
          await fontPrepare(page);
          await force(page);
        };
        const capture = await captureMarklessAssignment(browser, input, t, assignment.values, scheme, { mode: fontMode, files, prepare }, screenshots === undefined ? undefined : join(screenshots, `${target}-${label}.png`));
        if (base === null) paint.push(...paintRows(target, assignment, await chromePagePaint(browser, authoredFontHtml(marklessDocumentHtml(input, assignment.values, fontMode), files), input, t, assignment.values, scheme)));
        else rows.push(...interactionPaintRows(target, label, base, assignment, capture.nodes, t.dpr));
        const paired = pairBoxes(input, assignment, capture.nodes);
        for (const { id, kind } of paired.problems) rows.push({ target, values: assignment.values, ...(base === null ? {} : { state: label }), id, maxDeltaDevicePx: null, pass: false, problem: CHROME_PROBLEM[kind] });
        for (const { id, c } of paired.pairs) {
          const d = absolute(id);
          const chrome = { x: c.x * t.dpr, y: c.y * t.dpr, width: c.width * t.dpr, height: c.height * t.dpr };
          const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(chrome[k] - d[k])));
          rows.push({ target, values: assignment.values, ...(base === null ? {} : { state: label }), id, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX });
        }
      }
    });
  }
  return { fontMode, compared: rows.filter((r) => r.maxDeltaDevicePx !== null).length, failed: rows.filter((r) => !r.pass).length + paint.filter((r) => !r.pass).length, rows, paint };
}
