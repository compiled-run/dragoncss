// GEN-a R9 (notes/T151-gen-spec.md): the capture of ::before and ::after boxes, which have no DOM element for getBoundingClientRect
// and no DOM text node for a Range. The boxes come from CDP (DOM.getDocument pseudoElements, DOM.getContentQuads), their computed
// values from getComputedStyle(host, '::before'), and their text from DOMSnapshot.captureSnapshot text boxes divided by the DPR.
// Every capture cross-checks the snapshot against the Range rects of the page's real text, and fails loud on anything it cannot
// name. A page without a generated box opens no CDP session (pageHasGeneratedContent), so every other capture is unchanged.
import type { CDPSession, Page } from 'playwright';
import type { CapturedNode } from './capture.ts';

/** The capture plants: each must make a GEN-a lane fail. */
export type PseudoCaptureFaults = {
  /** Snapshot text boxes are taken in device px, not divided by the DPR (caught by the R9 cross-check at DPR 2, 3 and 2.625). */
  readonly snapshotTextNotScaled: boolean;
  /** The set of generated boxes Chrome made is not checked against the set Dragon generated (pseudoSetProblems). */
  readonly pseudoSetUnchecked: boolean;
};

export const NO_PSEUDO_CAPTURE_FAULTS: PseudoCaptureFaults = { snapshotTextNotScaled: false, pseudoSetUnchecked: false };

/** R9: a snapshot text box divided by the DPR must equal its Range client rect within this many CSS px (probe: worst 1.0e-5). */
export const CROSS_CHECK_CSS_PX = 1 / 1024;

/** The pseudo-elements GEN-a generates; any other pseudo-element node in a captured page is an error. */
export const GENERATED_PSEUDO_TYPES: readonly string[] = ['before', 'after'];

/** A captured generated box's id: "<host>::before" (the address Dragon gives it, analysis/generated.ts). */
export const pseudoId = (host: string, type: string): string => `${host}::${type}`;

const GENERATED_ID = /::(?:before|after)$/;

/** Rect as [x, y, width, height]. */
export type Rect4 = readonly [number, number, number, number];

const isEmpty = (r: Rect4): boolean => r[2] <= 0 || r[3] <= 0;

/**
 * The bounding rect of a box's fragments, as Chrome's getBoundingClientRect forms it: the first fragment, then gfx::RectF::Union
 * with each later one (an empty rect adds nothing; an empty accumulator is replaced). Null for no fragment.
 */
export function unionRects(rects: readonly Rect4[]): Rect4 | null {
  const first = rects[0];
  if (first === undefined) return null;
  let [x, y, w, h] = first;
  for (const r of rects.slice(1)) {
    if (isEmpty(r)) continue;
    if (w <= 0 || h <= 0) {
      [x, y, w, h] = r;
      continue;
    }
    const right = Math.max(x + w, r[0] + r[2]);
    const bottom = Math.max(y + h, r[1] + r[3]);
    x = Math.min(x, r[0]);
    y = Math.min(y, r[1]);
    w = right - x;
    h = bottom - y;
  }
  return [x, y, w, h];
}

const fr = (v: number): number => Math.fround(v);

/** One text box of a generated text: its rect in CSS px and its [start, start + length) in UTF-16 units of the content string. */
export type GeneratedTextBox = { readonly rect: Rect4; readonly start: number; readonly length: number };
/** The text of one generated box, as the snapshot lays it out: the content string and its text boxes, one per line. */
export type GeneratedText = { readonly host: string; readonly type: string; readonly text: string; readonly boxes: readonly GeneratedTextBox[] };

/** The DOMSnapshot.captureSnapshot fields this file reads. */
export type Snapshot = {
  readonly strings: readonly string[];
  readonly documents: readonly {
    readonly nodes: {
      readonly parentIndex: readonly number[];
      readonly nodeType: readonly number[];
      readonly attributes: readonly (readonly number[])[];
      readonly pseudoType?: { readonly index: readonly number[]; readonly value: readonly number[] };
      readonly shadowRootType?: { readonly index: readonly number[]; readonly value: readonly number[] };
    };
    readonly layout: { readonly nodeIndex: readonly number[]; readonly text: readonly number[] };
    readonly textBoxes: { readonly layoutIndex: readonly number[]; readonly bounds: readonly (readonly number[])[]; readonly start: readonly number[]; readonly length: readonly number[] };
  }[];
};

function attrOf(strings: readonly string[], attrs: readonly number[] | undefined, name: string): string | undefined {
  if (attrs === undefined) return undefined;
  for (let k = 0; k + 1 < attrs.length; k += 2) if (strings[attrs[k] as number] === name) return strings[attrs[k + 1] as number];
  return undefined;
}

/**
 * The generated texts of a snapshot, and the R9 cross-check: every light-DOM text node's snapshot boxes, divided by the DPR, must
 * equal its Range client rects (pageTextRects, one list per text node of the document in tree order) within CROSS_CHECK_CSS_PX.
 * Throws on a failed cross-check, on a generated box whose host has no data-dragon-id, and on text of any other pseudo-element.
 */
export function snapshotGeneratedText(snap: Snapshot, dpr: number, pageTextRects: readonly (readonly Rect4[])[], faults: PseudoCaptureFaults = NO_PSEUDO_CAPTURE_FAULTS): { readonly texts: GeneratedText[]; readonly lines: number; readonly worst: number } {
  const d = snap.documents[0];
  if (d === undefined) throw new Error('DOMSnapshot has no document');
  const S = snap.strings;
  const n = d.nodes;
  const pseudo = new Map<number, string>();
  (n.pseudoType?.index ?? []).forEach((i, k) => pseudo.set(i, S[n.pseudoType?.value[k] as number] as string));
  const shadowRoot = new Set<number>(n.shadowRootType?.index ?? []);
  const inShadow: boolean[] = [];
  const lightText: number[] = [];
  for (let i = 0; i < n.parentIndex.length; i++) {
    const parent = n.parentIndex[i] as number;
    inShadow[i] = shadowRoot.has(i) || (parent >= 0 && inShadow[parent] === true);
    if (n.nodeType[i] === 3 && !inShadow[i]) lightText.push(i);
  }
  if (lightText.length !== pageTextRects.length) throw new Error(`R9 cross-check: the snapshot has ${lightText.length} light-DOM text nodes, the page ${pageTextRects.length}`);
  const scale = faults.snapshotTextNotScaled ? 1 : dpr;
  const byNode = new Map<number, { rect: Rect4; start: number; length: number }[]>();
  const layoutText = new Map<number, string>();
  for (let k = 0; k < d.textBoxes.layoutIndex.length; k++) {
    const li = d.textBoxes.layoutIndex[k] as number;
    const node = d.layout.nodeIndex[li] as number;
    const b = d.textBoxes.bounds[k] as readonly number[];
    const rect: Rect4 = [(b[0] as number) / scale, (b[1] as number) / scale, (b[2] as number) / scale, (b[3] as number) / scale];
    const list = byNode.get(node) ?? [];
    list.push({ rect, start: d.textBoxes.start[k] as number, length: d.textBoxes.length[k] as number });
    byNode.set(node, list);
    if (!layoutText.has(node)) layoutText.set(node, S[d.layout.text[li] as number] ?? '');
  }
  let lines = 0;
  let worst = 0;
  lightText.forEach((node, t) => {
    const mine = byNode.get(node) ?? [];
    const range = pageTextRects[t] as readonly Rect4[];
    if (mine.length !== range.length) throw new Error(`R9 cross-check: text node ${t} has ${mine.length} snapshot text boxes and ${range.length} Range client rects`);
    mine.forEach((s, j) => {
      lines++;
      for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs((s.rect[c] as number) - ((range[j] as Rect4)[c] as number)));
    });
  });
  if (worst > CROSS_CHECK_CSS_PX) throw new Error(`R9 cross-check: a snapshot text box divided by the DPR differs from its Range client rect by ${worst} CSS px (limit ${CROSS_CHECK_CSS_PX})`);
  const texts: GeneratedText[] = [];
  for (const [i, type] of pseudo) {
    const boxes = byNode.get(i) ?? [];
    if (!GENERATED_PSEUDO_TYPES.includes(type)) {
      if (boxes.length > 0) throw new Error(`the page shows text in a ::${type} pseudo-element, which GEN-a does not capture`);
      continue;
    }
    const host = attrOf(S, n.attributes[n.parentIndex[i] as number], 'data-dragon-id');
    if (host === undefined) throw new Error(`a ::${type} box's host has no data-dragon-id`);
    if (boxes.length === 0) continue;
    texts.push({ host, type, text: layoutText.get(i) ?? '', boxes: boxes.map((b) => ({ rect: [fr(b.rect[0]), fr(b.rect[1]), fr(b.rect[2]), fr(b.rect[3])] as const, start: b.start, length: b.length })) });
  }
  return { texts, lines, worst };
}

/** Runs in the page: whether any element has a ::before or ::after whose content computes to something other than none. */
export function pageHasGeneratedContent(page: Page): Promise<boolean> {
  return page.evaluate(() => Array.from(document.querySelectorAll('*')).some((el) => ['::before', '::after'].some((p) => getComputedStyle(el, p).content !== 'none')));
}

/** Runs in the page: the Range client rects of every text node of the document, in tree order. */
const pageTextRects = (): [number, number, number, number][][] => {
  const out: [number, number, number, number][][] = [];
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t !== null; t = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(t);
    out.push(Array.from(range.getClientRects()).map((q) => [q.x, q.y, q.width, q.height]));
  }
  return out;
};

/** The snapshot's generated texts and the cross-check, on an open CDP session of the page. */
async function generatedTexts(page: Page, cdp: CDPSession, faults: PseudoCaptureFaults): Promise<GeneratedText[]> {
  const rects = await page.evaluate(pageTextRects);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const snap = (await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: true })) as unknown as Snapshot;
  return snapshotGeneratedText(snap, dpr, rects, faults).texts;
}

/** Every generated text of the page; empty, with no CDP session, when the page has no generated box (line-breaks.ts). */
export async function captureGeneratedTexts(page: Page, faults: PseudoCaptureFaults = NO_PSEUDO_CAPTURE_FAULTS): Promise<GeneratedText[]> {
  if (!(await pageHasGeneratedContent(page))) return [];
  const cdp = await page.context().newCDPSession(page);
  try {
    return await generatedTexts(page, cdp, faults);
  } finally {
    await cdp.detach();
  }
}

type DomNode = { readonly nodeId: number; readonly nodeType: number; readonly attributes?: readonly string[]; readonly children?: readonly DomNode[]; readonly pseudoElements?: readonly DomNode[]; readonly pseudoType?: string; readonly contentDocument?: DomNode; readonly shadowRoots?: readonly DomNode[] };

const domAttr = (attrs: readonly string[] | undefined, name: string): string | undefined => {
  if (attrs === undefined) return undefined;
  for (let k = 0; k + 1 < attrs.length; k += 2) if (attrs[k] === name) return attrs[k + 1];
  return undefined;
};

/** A generated box Chrome made: its host's data-dragon-id, its type and its CDP node. */
type PseudoNode = { readonly host: string; readonly type: string; readonly nodeId: number };

/** The ::before and ::after nodes of a DOM.getDocument tree, in tree order (::before, children, ::after per host's listing). */
export function pseudoNodesOf(root: DomNode): PseudoNode[] {
  const out: PseudoNode[] = [];
  const walk = (n: DomNode): void => {
    for (const p of n.pseudoElements ?? []) {
      const type = p.pseudoType;
      if (type === undefined || !GENERATED_PSEUDO_TYPES.includes(type)) throw new Error(`the page has a ::${String(type)} pseudo-element, which GEN-a does not capture`);
      const host = domAttr(n.attributes, 'data-dragon-id');
      if (host === undefined) throw new Error(`a ::${type} box's host has no data-dragon-id`);
      out.push({ host, type, nodeId: p.nodeId });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

/** Captured nodes of one generated box: the box, its line fragments when it is inline, its text node and the text's lines. */
export function generatedNodes(p: { readonly host: string; readonly type: string }, quads: readonly Rect4[] | null, computed: { readonly [property: string]: string }, text: GeneratedText | undefined): CapturedNode[] {
  const id = pseudoId(p.host, p.type);
  const out: CapturedNode[] = [];
  const box = quads === null ? null : unionRects(quads);
  out.push({ id, kind: 'element', hasBox: box !== null, x: box?.[0] ?? 0, y: box?.[1] ?? 0, width: box?.[2] ?? 0, height: box?.[3] ?? 0, computed });
  // As capture.ts records an inline element: one "<id>:line<j>" per fragment.
  if (quads !== null && computed['display'] === 'inline') quads.forEach((q, j) => out.push({ id: `${id}:line${j}`, kind: 'line', hasBox: true, x: q[0], y: q[1], width: q[2], height: q[3], computed: null }));
  if (text !== undefined) {
    const rects = text.boxes.map((b) => b.rect);
    const u = unionRects(rects) as Rect4;
    out.push({ id: `${id}:text0`, kind: 'text', hasBox: true, x: u[0], y: u[1], width: u[2], height: u[3], computed: null });
    rects.forEach((r, j) => out.push({ id: `${id}:text0:line${j}`, kind: 'line', hasBox: true, x: r[0], y: r[1], width: r[2], height: r[3], computed: null }));
  }
  return out;
}

/** The bounding box of each CDP content quad (8 numbers: four corners), in CSS px as Math.fround. */
const quadRect = (q: readonly number[]): Rect4 => {
  const xs = [q[0], q[2], q[4], q[6]] as number[];
  const ys = [q[1], q[3], q[5], q[7]] as number[];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [fr(x), fr(y), fr(Math.max(...xs) - x), fr(Math.max(...ys) - y)];
};

/**
 * R9: every ::before and ::after box of the page, with its computed values (props, in order) and its text. The caller checks
 * pageHasGeneratedContent first, so a page without one opens no CDP session.
 */
export async function capturePseudoElements(page: Page, props: readonly string[], faults: PseudoCaptureFaults = NO_PSEUDO_CAPTURE_FAULTS): Promise<CapturedNode[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    const doc = (await cdp.send('DOM.getDocument', { depth: -1 })) as unknown as { root: DomNode };
    const pseudos = pseudoNodesOf(doc.root);
    const computed = await page.evaluate(
      ({ list, props: ps }) =>
        list.map(({ host, type }) => {
          const el = document.querySelector(`[data-dragon-id="${CSS.escape(host)}"]`);
          if (el === null) throw new Error(`no element ${host}`);
          const cs = getComputedStyle(el, `::${type}`);
          const o: Record<string, string> = {};
          for (const p of ps) o[p] = cs.getPropertyValue(p);
          return o;
        }),
      { list: pseudos.map((p) => ({ host: p.host, type: p.type })), props: [...props] },
    );
    const texts = await generatedTexts(page, cdp, faults);
    const out: CapturedNode[] = [];
    for (const [k, p] of pseudos.entries()) {
      let quads: Rect4[] | null = null;
      try {
        const r = (await cdp.send('DOM.getContentQuads', { nodeId: p.nodeId })) as unknown as { quads: number[][] };
        quads = r.quads.length === 0 ? null : r.quads.map(quadRect);
      } catch (e) {
        // A generated box with no layout object (display: none) has no quads; any other failure is a capture error.
        if (!String(e).includes('Could not compute content quads')) throw e;
      }
      out.push(...generatedNodes(p, quads, computed[k] as Record<string, string>, texts.find((t) => t.host === p.host && t.type === p.type)));
    }
    const named = new Set(pseudos.map((p) => pseudoId(p.host, p.type)));
    for (const t of texts) if (!named.has(pseudoId(t.host, t.type))) throw new Error(`the snapshot has text for ${pseudoId(t.host, t.type)}, which DOM.getDocument does not list`);
    return out;
  } finally {
    await cdp.detach();
  }
}

/**
 * R9 set check: the generated boxes Chrome made (captured ids ending in ::before or ::after) must be the ones Dragon generated
 * (dragon: every resolved element address of the case). A box only one side has is a problem, never a skipped node.
 */
export function pseudoSetProblems(capture: { readonly nodes: readonly CapturedNode[] }, dragon: Iterable<string>, faults: PseudoCaptureFaults = NO_PSEUDO_CAPTURE_FAULTS): string[] {
  if (faults.pseudoSetUnchecked) return [];
  const chrome = new Set(capture.nodes.filter((n) => n.kind === 'element' && GENERATED_ID.test(n.id)).map((n) => n.id));
  const mine = new Set([...dragon].filter((a) => GENERATED_ID.test(a)));
  return [
    ...[...chrome].filter((id) => !mine.has(id)).map((id) => `${id}: Chrome generates this box but Dragon does not`),
    ...[...mine].filter((id) => !chrome.has(id)).map((id) => `${id}: Dragon generates this box but Chrome does not`),
  ];
}
