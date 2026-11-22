// REPL-r1 (notes/IMG-dynamic-src-spec.md, with the Judge's verdict of 2026-11-22): an img whose src the app sets at run time. Dragon
// lays it out once without the image, so the build refuses every way its box could follow the image: a layout that reads the
// natural size (the engine's runtime-image-size, at every case, band, interaction state and export viewport, and each band's
// edge widths), an alt text a missing src would show, and a selector that tests the src. A load error, an empty src or a src
// removed at run time is a named divergence: Chrome draws fallback content, which the build names per img.
import type { LayoutBox, LayoutInput } from '@dragon/layout';
import type { ResolvedElement } from '../analysis/resolve.ts';
import { runtimeSrcSelectors } from '../analysis/match.ts';
import type { Rule } from '../css/stylesheet.ts';
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Band } from '../media/band.ts';
import { contains } from '../media/band.ts';
import type { Diagnostic, Origin } from '../types.ts';

/**
 * A device the build lays every case out at: its viewport in CSS px, its DPR, and the engine's layout with the device's text
 * measurer, which gives the engine's refusal or null.
 */
export type LayoutDevice = {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly layout: (input: LayoutInput) => { readonly code: string; readonly nodeId: string; readonly detail: string } | null;
};

/** The build-time layout a compile with a runtimeSrc img needs (InternalOptions.runtimeImageLayout): the export devices. */
export type RuntimeImageLayout = { readonly devices: readonly LayoutDevice[] };

type OriginOf = (root: ResolvedElement, address: string) => Origin;

const isRuntimeImg = (el: ResolvedElement): boolean => el.element.tag === 'img' && el.element.node.runtimeSrc !== undefined;

function eachElement(root: ResolvedElement, f: (el: ResolvedElement) => void): void {
  f(root);
  for (const c of root.children) if (c.kind === 'element') eachElement(c, f);
}

/**
 * Per runtimeSrc img of every resolved tree: a missing src with alt text is refused (Chrome lays the alt text out instead), and
 * the build notes the fallback box Chrome draws on a load error (Q1): the alt text, or a broken-image box of the width and height
 * attributes or of its CSS size.
 */
export function runtimeImageNotes(roots: readonly ResolvedElement[], originOf: OriginOf, diagnostics: Diagnostic[]): void {
  const noted = new Set<string>();
  const refused = new Set<string>();
  for (const root of roots) {
    eachElement(root, (el) => {
      if (!isRuntimeImg(el)) return;
      const id = el.element.address;
      const attrs = el.element.attributes;
      const alt = attrs.get('alt');
      const shows = alt !== undefined ? alt !== '' : attrs.has('title');
      if (el.element.node.runtimeSrc?.absent === true && shows && !refused.has(id)) {
        refused.add(id);
        diagnostics.push(diagnostic('DRAGON_RUNTIME_IMAGE_SIZE', { origin: originOf(root, id), message: `<img> ${id} has a src set at run time that may be missing, and a missing src shows its ${alt !== undefined ? 'alt text' : 'title'} (Chrome lays the text out in place of the image): give it alt=""` }));
      }
      if (noted.has(id)) return;
      noted.add(id);
      const w = attrs.get('width');
      const h = attrs.get('height');
      const fallback = alt !== undefined && alt !== '' ? `its alt text "${alt}"` : w !== undefined && h !== undefined ? `a ${w}x${h} box (its width and height attributes) with a broken-image icon` : 'a box of its CSS size with a broken-image icon';
      diagnostics.push(diagnostic('DRAGON_RUNTIME_IMAGE_FALLBACK', { origin: originOf(root, id), message: `<img> ${id}: on a load error, an empty src or a src removed at run time, Chrome draws ${fallback}; the native output keeps the laid-out box and draws the no-image outline` }));
    });
  }
}

/** Each selector of a band's rules that reads a runtimeSrc img's src on some case of the band, refused at that img. */
export function runtimeSrcSelectorRefusals(bands: readonly { readonly rules: readonly Rule[]; readonly roots: readonly ResolvedElement[] }[], faults: CompilerFaults, originOf: OriginOf, diagnostics: Diagnostic[]): void {
  const reported = new Set<string>();
  for (const { rules, roots } of bands) {
    for (const root of roots) {
      for (const hit of runtimeSrcSelectors(rules, root.element, faults)) {
        const span = hit.rule.declarations[0]?.span;
        const where = span === undefined ? `a rule of ${hit.rule.sheet}` : `the rule at ${span.source.uri}:${span.start}`;
        const key = `${where}|${hit.address}`;
        if (reported.has(key)) continue;
        reported.add(key);
        diagnostics.push(diagnostic('DRAGON_RUNTIME_IMAGE_SIZE', { origin: originOf(root, hit.address), message: `a selector of ${where} tests the src of an <img> whose src is set at run time, so whether it matches ${hit.address} depends on the app's data: match the img by a class instead` }));
      }
    }
  }
}

type Node = LayoutBox['children'][number] | LayoutBox;

function runtimeLeaves(n: Node, out: string[]): string[] {
  if (n.kind === 'replaced' && n.natural.kind === 'runtime') out.push(n.id);
  if (n.kind === 'box' || n.kind === 'control') for (const c of n.children) runtimeLeaves(c, out);
  return out;
}

/**
 * The widths the band's own edges give (Q3): the smallest and largest whole CSS px of each width interval, the largest export
 * viewport standing in for a band with no maximum.
 */
export function bandEdgeWidths(band: Band, devices: readonly LayoutDevice[]): number[] {
  const widest = Math.max(...devices.map((d) => d.width));
  const out: number[] = [];
  for (const i of band.width) {
    let lo = Math.max(0, Math.ceil(i.lo));
    if (!contains(i, lo)) lo += 1;
    const top = i.hi === Infinity ? Math.max(widest, lo) : Math.floor(i.hi);
    const hi = contains(i, top) ? top : top - 1;
    if (contains(i, lo)) out.push(lo);
    if (hi !== lo && contains(i, hi)) out.push(hi);
  }
  return out;
}

/**
 * Lays every lowered tree holding a runtimeSrc img out at every device and at each of its band's edge widths, refusing every img
 * whose size the layout reads from its image. Without a build-time layout every such img is refused: nothing proves its box.
 */
export function runtimeLayoutRefusals(trees: readonly { readonly tree: LayoutBox; readonly rootFontSize: number; readonly band: Band | null; readonly resolved: ResolvedElement }[], layout: RuntimeImageLayout | null, originOf: OriginOf, diagnostics: Diagnostic[]): void {
  const reported = new Set<string>();
  const refuse = (root: ResolvedElement, id: string, message: string): void => {
    if (reported.has(`${id}|${message}`)) return;
    reported.add(`${id}|${message}`);
    diagnostics.push(diagnostic('DRAGON_RUNTIME_IMAGE_SIZE', { origin: originOf(root, id), message }));
  };
  for (const t of trees) {
    const leaves = runtimeLeaves(t.tree, []);
    if (leaves.length === 0) continue;
    if (layout === null) {
      for (const id of leaves) refuse(t.resolved, id, `<img> ${id} has a src set at run time, and this compile lays nothing out at build time, so nothing proves its box does not follow its image`);
      continue;
    }
    const edges = t.band === null ? [] : layout.devices.flatMap((d) => bandEdgeWidths(t.band as Band, layout.devices).map((width) => ({ ...d, width })));
    for (const d of [...layout.devices, ...edges]) {
      const viewport = { width: d.width, height: d.height };
      const r = d.layout({ viewport, devicePixelRatio: d.dpr, viewportUnits: { small: viewport, large: viewport, dynamic: viewport }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: t.rootFontSize, root: t.tree });
      if (r === null) continue;
      if (r.code === 'runtime-image-size') refuse(t.resolved, r.nodeId, `<img> ${r.nodeId} has a src set at run time, and ${r.detail}`);
      // A layout stopped before the img proves nothing about it.
      else for (const id of leaves) refuse(t.resolved, id, `<img> ${id} has a src set at run time, and the build could not lay the page out at ${d.width}x${d.height} (${r.code} at ${r.nodeId}), so nothing proves its box does not follow its image`);
    }
  }
}
