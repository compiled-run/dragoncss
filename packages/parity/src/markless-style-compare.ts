// Every frame of every assignment of a Markless style export against Chrome's boxes for the same element tree, at the export's
// viewport and ratio, under the device lanes' gate: classes and attributes as each assignment's states set them, and the colour
// scheme its @media band reads. Usage: pnpm run markless:style-compare -- <input.json> <export.json> <report.json>
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { BAND_KEY } from 'dragon';
import { authoredFontHtml } from './cases.ts';
import { captureFixture } from './capture.ts';
import { launchChrome } from './chrome.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from './font-reference.ts';
import type { CapturedNode } from './capture.ts';
import type { MarklessFontFile, MarklessFonts, MarklessStyleInput } from './markless-style-input.ts';
import { MARKLESS_BOXLESS_ATTRIBUTE, marklessDocumentCss, marklessShownModal, schemeOf, stateCombinations, textNodesByAddress, valueUnder } from './markless-style-input.ts';
import type { ExportAssignment, NativeStyleExport } from './native-style-export.ts';
import { systemFontReference } from './system-fonts/reference.ts';

type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Values = Readonly<Record<string, unknown>>;

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The input's tree as one assignment shows it, by input id (data-dragon-id); each dialog is opened with showModal(), so without open. */
export function marklessDocumentHtml(input: MarklessStyleInput, values: Values, fonts: MarklessFonts = 'pinned'): string {
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const modal = input.nodes.filter(marklessShownModal).map((n) => n.id);
  const render = (n: MarklessStyleInput['nodes'][number]): string => {
    if (n.kind === 'text') return escape(n.textByState === undefined ? n.text : (valueUnder(n.textByState, values, n.id) as string));
    const shown = (name: string): boolean => name !== 'class' && !(name === 'open' && modal.includes(n.id));
    const attributes: [string, string][] = Object.entries(n.attributes).filter(([name]) => shown(name));
    if (n.boxless === true) attributes.push([MARKLESS_BOXLESS_ATTRIBUTE, '']);
    const cls = n.classByState === undefined ? (n.attributes['class'] ?? null) : valueUnder(n.classByState, values, n.id);
    if (cls !== null) attributes.push(['class', cls]);
    for (const [name, entries] of Object.entries(n.attributesByState ?? {})) {
      if (!shown(name)) continue;
      const v = valueUnder(entries, values, n.id);
      if (v !== null) attributes.push([name, v]);
    }
    const open = [`<${n.element} data-dragon-id="${escape(n.id)}"`, ...attributes.map(([k, v]) => `${k}="${escape(v)}"`)].join(' ');
    return `${open}>${(children.get(n.id) ?? []).map(render).join('')}</${n.element}>`;
  };
  const show = modal.length === 0 ? '' : `<script>{ const ids = new Set(${JSON.stringify(modal).replace(/</g, '\\u003c')}); for (const e of document.querySelectorAll('[data-dragon-id]')) if (ids.has(e.dataset.dragonId)) e.showModal(); }</script>`;
  return `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${marklessDocumentCss(input, fonts)}\n${input.css}\n</style>\n</head>\n<body data-dragon-id="body">${(children.get(null) ?? []).map(render).join('')}${show}</body>\n</html>\n`;
}


/**
 * Refuses a target whose assignments are not exactly one per combination of the input's states and the export's bands, with
 * states naming those cells (and the band) in that order, since an assignment left out would never be compared.
 */
export function checkCoverage(input: MarklessStyleInput, target: string, t: NonNullable<NativeStyleExport['targets']['ios']>): void {
  const bands = t.bands === undefined ? null : t.bands.bands.map((_, i) => i);
  const keys = [...input.states.map((s) => s.cell), ...(bands === null ? [] : [BAND_KEY])];
  const want = stateCombinations(input).flatMap((c) => (bands === null ? [c] : bands.map((b): Values => ({ ...c, [BAND_KEY]: b }))));
  const domains = [...input.states.map((s) => s.domain), ...(bands === null ? [] : [bands])];
  if (JSON.stringify(t.states) !== JSON.stringify(keys.map((key, i) => ({ key, domain: domains[i] })))) throw new Error(`${target}: states ${JSON.stringify(t.states)} are not the input's states${bands === null ? '' : ' and the band'}`);
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
  if (missing.length > 0 || extra.length > 0) throw new Error(`${target}: the assignments are not one per combination of the input's states${bands === null ? '' : ' and bands'}: missing ${JSON.stringify(missing)}, extra or repeated ${JSON.stringify(extra)}`);
}

/** The ids of the dialogs the host shows with showModal(), whose ::backdrop boxes are measured beside the page's nodes. */
export const modalIds = (input: MarklessStyleInput): string[] => input.nodes.filter(marklessShownModal).map((n) => n.id);

/** Runs in the page (so it closes over nothing): each shown dialog's ::backdrop box as "<id>::backdrop", from its resolved values. */
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
    out.push({ id: `${id}::backdrop`, kind: 'element', hasBox, x: hasBox ? px('left') : 0, y: hasBox ? px('top') : 0, width: hasBox ? px('width') : 0, height: hasBox ? px('height') : 0, computed: null });
  }
  return out;
};

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
 * One assignment's browser boxes paired with the export's nodes by input id (a text node by Dragon's numbering under its element's
 * data-dragon-id); every box only one side has is a problem, never skipped. The export has no line boxes.
 */
export function pairBoxes(input: MarklessStyleInput, assignment: ExportAssignment, captured: readonly CapturedNode[]): { readonly pairs: readonly { readonly id: string; readonly c: CapturedNode }[]; readonly problems: readonly { readonly id: string; readonly kind: BoxProblem }[] } {
  const textOf = textNodesByAddress(input, (id) => id, assignment.values);
  const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const pairs: { id: string; c: CapturedNode }[] = [];
  const problems: { id: string; kind: BoxProblem }[] = [];
  for (const c of captured) {
    if (c.kind === 'line') continue;
    const id = c.kind === 'text' ? (textOf.get(c.id) ?? c.id) : c.id;
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
  for (const [target, t] of Object.entries(exported.targets)) if (t !== undefined && (only === null || only.includes(target))) checkCoverage(input, target, t);
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
        const fonts = mode === 'system' ? systemFontReference(target as 'ios' | 'android', exported.systemFonts ?? []) : fontReferencePrepare(FONT_REFERENCE_MAP);
        let backdrops: CapturedNode[] = [];
        const capture = await captureFixture(browser, `markless-${input.component}`, authoredFontHtml(marklessDocumentHtml(input, assignment.values, mode), files), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], async (page) => {
          await page.emulateMedia({ colorScheme: scheme });
          await fonts(page);
          backdrops = await page.evaluate(collectBackdrops, modalIds(input));
          if (screenshots !== undefined) await page.screenshot({ path: join(screenshots, `${target}-${index}.png`), fullPage: true });
        });
        const paired = pairBoxes(input, assignment, [...capture.nodes, ...backdrops]);
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
