// Deterministic report: report.json (numbers) and index.html (side-by-side boxes). No timestamps or absolute paths.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromeDeviations } from '@dragon/layout';
import { CHROME_VERSION, PLAYWRIGHT_VERSION } from './chrome.ts';
import type { Edges } from './compare.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { VIEWPORT } from './fixtures.ts';
import type { FixtureOutcome } from './pipeline.ts';
import { repoPath } from './paths.ts';

export type Report = {
  readonly run: {
    readonly lane: 'linux-dragon-layout';
    readonly chrome: string;
    readonly playwright: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: 1;
    readonly gateDevicePx: number;
    readonly gateSource: string;
  };
  readonly summary: {
    readonly fixtures: number;
    readonly passed: number;
    readonly failed: number;
    readonly comparedNodes: number;
    readonly exactLuNodes: number;
    readonly unsupportedCodes: readonly string[];
  };
  readonly deviations: typeof chromeDeviations;
  readonly fixtures: readonly FixtureOutcome[];
};

export function buildReport(outcomes: readonly FixtureOutcome[]): Report {
  const nodes = outcomes.flatMap((o) => (o.comparison === null ? [] : o.comparison.nodes));
  return {
    run: {
      lane: 'linux-dragon-layout',
      chrome: CHROME_VERSION,
      playwright: PLAYWRIGHT_VERSION,
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      devicePixelRatio: 1,
      gateDevicePx: GATE_DEVICE_PX,
      gateSource: 'docs/decisions.md decision 13',
    },
    summary: {
      fixtures: outcomes.length,
      passed: outcomes.filter((o) => o.status === 'pass').length,
      failed: outcomes.filter((o) => o.status === 'fail').length,
      comparedNodes: nodes.length,
      exactLuNodes: nodes.filter((n) => n.exactLu).length,
      unsupportedCodes: [...new Set(outcomes.flatMap((o) => (o.unsupported === null ? [] : [o.unsupported.code])))].sort(),
    },
    deviations: chromeDeviations,
    fixtures: outcomes.map((o) => ({ ...o, vector: null })),
  };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number): string => String(Math.round(n * 1e6) / 1e6);

function svg(title: string, boxes: readonly { id: string; e: Edges }[]): string {
  const w = VIEWPORT.width;
  const h = VIEWPORT.height;
  const rects = boxes
    .map(({ id, e }) => `<rect x="${num(e.left)}" y="${num(e.top)}" width="${num(e.right - e.left)}" height="${num(e.bottom - e.top)}"><title>${esc(id)}</title></rect>`)
    .join('');
  return `<figure><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${rects}</svg></figure>`;
}

export function renderHtml(r: Report): string {
  const parts: string[] = [];
  parts.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dragon layout parity</title><style>');
  parts.push('body{font:13px system-ui,sans-serif;margin:16px}figure{display:inline-block;margin:0 12px 8px 0}svg{border:1px solid #999;background:#fff}');
  parts.push('rect{fill:rgba(40,110,220,.08);stroke:#246;stroke-width:.5}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px;text-align:right}');
  parts.push('.fail{color:#b00}.pass{color:#070}td.id{text-align:left}</style></head><body>');
  parts.push(`<h1>Dragon layout parity (S1)</h1><p>Lane ${r.run.lane}; Chrome ${esc(r.run.chrome)} via Playwright ${esc(r.run.playwright)}; viewport ${r.run.viewport.width}x${r.run.viewport.height} at DPR 1; gate ${r.run.gateDevicePx} device px per edge (${esc(r.run.gateSource)}). Screenshots are not used; these drawings are evidence only.</p>`);
  parts.push(`<p>${r.summary.passed}/${r.summary.fixtures} fixtures pass. ${r.summary.exactLuNodes}/${r.summary.comparedNodes} compared nodes match Chrome exactly at 1/64 px (informational).</p>`);
  for (const f of r.fixtures) {
    parts.push(`<h2 id="${esc(f.id)}">${esc(f.id)} <span class="${f.status}">${f.status}</span></h2>`);
    if (f.reason !== null) parts.push(`<p class="fail">${esc(f.reason)}</p>`);
    for (const d of f.diagnostics) parts.push(`<p>${esc(d.code)}: ${esc(d.message)}${d.spanText === null ? '' : ` at "${esc(d.spanText)}"`}</p>`);
    if (f.comparison === null) continue;
    const nodes = f.comparison.nodes;
    parts.push(svg('Chrome (authored CSS)', nodes.map((n) => ({ id: n.id, e: n.chrome }))));
    parts.push(svg('Dragon layout (compiled ios projection)', nodes.flatMap((n) => (n.dragon === null ? [] : [{ id: n.id, e: n.dragon }]))));
    parts.push('<table><tr><th>node</th><th>Chrome l,t,r,b</th><th>Dragon l,t,r,b</th><th>delta l,t,r,b</th><th>gate</th><th>exact 1/64</th></tr>');
    for (const n of nodes) {
      const e = (x: Edges | null): string => (x === null ? '-' : [x.left, x.top, x.right, x.bottom].map(num).join(', '));
      parts.push(`<tr><td class="id">${esc(n.id)}</td><td>${e(n.chrome)}</td><td>${e(n.dragon)}</td><td>${e(n.delta)}</td><td class="${n.pass ? 'pass' : 'fail'}">${n.pass ? 'pass' : 'fail'}</td><td>${n.exactLu ? 'yes' : 'no'}</td></tr>`);
    }
    parts.push('</table>');
  }
  parts.push('</body></html>\n');
  return parts.join('\n');
}

export function writeReport(r: Report): void {
  const dir = repoPath('packages/parity/out');
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/report.json`, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(`${dir}/index.html`, renderHtml(r));
}
