// Every frame of every assignment of a Markless style export against Chrome's boxes for the same element tree, at the export's
// viewport and ratio, under the device lanes' gate: classes and attributes as each assignment's states set them, and the colour
// scheme its @media band reads. Usage: pnpm run markless:style-compare -- <input.json> <export.json> <report.json>
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { authoredFontHtml } from './cases.ts';
import { captureFixture } from './capture.ts';
import { launchChrome } from './chrome.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from './font-reference.ts';
import type { MarklessFontFile, MarklessFonts, MarklessStyleInput, StateValue } from './markless-style-input.ts';
import { MARKLESS_BOXLESS_ATTRIBUTE, marklessDocumentCss, schemeOf } from './markless-style-input.ts';
import type { NativeStyleExport } from './native-style-export.ts';
import { systemFontReference } from './system-fonts/reference.ts';

type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Values = Readonly<Record<string, unknown>>;

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The value a by-state list gives under an assignment's values; the input lists one entry per combination. */
function valueUnder(entries: readonly { readonly when: Readonly<Record<string, StateValue>>; readonly value: string | null }[], values: Values, id: string): string | null {
  const found = entries.filter((e) => Object.entries(e.when).every(([cell, v]) => values[cell] === v));
  if (found.length !== 1) throw new Error(`${id}: ${found.length} by-state entries hold for ${JSON.stringify(values)}`);
  return (found[0] as (typeof entries)[number]).value;
}

/** The input's tree as one assignment shows it, each element named by its input id (data-dragon-id). */
export function marklessDocumentHtml(input: MarklessStyleInput, values: Values, fonts: MarklessFonts = 'pinned'): string {
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const render = (n: MarklessStyleInput['nodes'][number]): string => {
    if (n.kind === 'text') return escape(n.textByState === undefined ? n.text : (valueUnder(n.textByState, values, n.id) as string));
    const attributes: [string, string][] = Object.entries(n.attributes).filter(([name]) => name !== 'class');
    if (n.boxless === true) attributes.push([MARKLESS_BOXLESS_ATTRIBUTE, '']);
    const cls = n.classByState === undefined ? (n.attributes['class'] ?? null) : valueUnder(n.classByState, values, n.id);
    if (cls !== null) attributes.push(['class', cls]);
    for (const [name, entries] of Object.entries(n.attributesByState ?? {})) {
      const v = valueUnder(entries, values, n.id);
      if (v !== null) attributes.push([name, v]);
    }
    const open = [`<${n.element} data-dragon-id="${escape(n.id)}"`, ...attributes.map(([k, v]) => `${k}="${escape(v)}"`)].join(' ');
    return `${open}>${(children.get(n.id) ?? []).map(render).join('')}</${n.element}>`;
  };
  return `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${marklessDocumentCss(input, fonts)}\n${input.css}\n</style>\n</head>\n<body data-dragon-id="body">${(children.get(null) ?? []).map(render).join('')}</body>\n</html>\n`;
}


export type CompareRow = { readonly target: string; readonly values: Values; readonly id: string; readonly maxDeltaDevicePx: number; readonly pass: boolean };

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
  for (const [target, t] of Object.entries(exported.targets)) {
    if (t === undefined || (only !== null && !only.includes(target))) continue;
    // Safari, not Chrome, is the web that draws iOS's system and author faces: Chrome on the Mac rounds their metrics and spaces otherwise.
    if (mode === 'system' && target === 'ios' && ((exported.systemFonts ?? []).some((e) => e.ios !== undefined) || exported.fonts.some((f) => f.from === 'input'))) throw new Error(`${input.component}: the iOS target measures its faces as Safari does, so it is compared with Safari on iOS (markless:style-web-column), not Chrome; compare the other targets`);
    const browser: Browser = await launchChrome(t.dpr);
    try {
      for (const [index, assignment] of t.assignments.entries()) {
        const band = assignment.values['@env#band'];
        const scheme = typeof band === 'number' ? schemeOf(t.bands, band) : unbanded;
        const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
        const absolute = (id: string): Frame => {
          const n = byId.get(id);
          if (n === undefined || n.frame === null) throw new Error(`${id} has no frame`);
          const p = n.parent === null ? { x: 0, y: 0 } : absolute(n.parent);
          return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
        };
        const fonts = mode === 'system' ? systemFontReference(target as 'ios' | 'android', exported.systemFonts ?? []) : fontReferencePrepare(FONT_REFERENCE_MAP);
        const capture = await captureFixture(browser, `markless-${input.component}`, authoredFontHtml(marklessDocumentHtml(input, assignment.values, mode), files), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], async (page) => {
          await page.emulateMedia({ colorScheme: scheme });
          await fonts(page);
          if (screenshots !== undefined) await page.screenshot({ path: join(screenshots, `${target}-${index}.png`), fullPage: true });
        });
        for (const c of capture.nodes) {
          const node = byId.get(c.id);
          if (!c.hasBox || c.kind === 'line' || node === undefined || node.frame === null) continue;
          const d = absolute(c.id);
          const chrome = { x: c.x * t.dpr, y: c.y * t.dpr, width: c.width * t.dpr, height: c.height * t.dpr };
          const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(chrome[k] - d[k])));
          rows.push({ target, values: assignment.values, id: c.id, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX });
        }
      }
    } finally {
      await browser.close();
    }
  }
  return { compared: rows.length, failed: rows.filter((r) => !r.pass).length, rows };
}
