// Deterministic report: report.json (numbers) and index.html (side-by-side boxes). No timestamps or absolute paths.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromeDeviations } from '@dragon/layout';
import { CHROME_VERSION, PLAYWRIGHT_VERSION } from './chrome.ts';
import type { Edges } from './compare.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { ENVIRONMENT, FIXTURES } from './fixtures.ts';
import type { CaseOutcome, FixtureOutcome } from './pipeline.ts';
import { repoPath } from './paths.ts';

export type Report = {
  readonly run: {
    readonly lanes: readonly ['linux-dragon-layout', 'chrome-dual'];
    readonly chrome: string;
    readonly playwright: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: number;
    readonly gateDevicePx: number;
    readonly gateSource: string;
    readonly dualRule: string;
  };
  readonly summary: {
    readonly fixtures: number;
    readonly layoutFixtures: number;
    readonly treeFixtures: number;
    readonly rejectFixtures: number;
    /** Layout fixtures written by scripts/gen-granularity-fixtures.ts from its committed selection. */
    readonly generatedFixtures: readonly string[];
    readonly passed: number;
    readonly failed: number;
    readonly cases: number;
    readonly casesPassed: number;
    /** Per layout fixture: cases declared (by hand for tree fixtures), rendered, enumerated by Dragon, per environment and in total, and every case id. */
    readonly caseCounts: readonly {
      readonly fixture: string;
      readonly expected: number;
      readonly renderer: number;
      readonly dragon: number;
      readonly environments: readonly { readonly direction: 'ltr' | 'rtl'; readonly expected: number; readonly renderer: number; readonly dragon: number }[];
      readonly cases: readonly string[];
    }[];
    /** Cases per environment direction, and how many passed. */
    readonly casesByDirection: readonly { readonly direction: 'ltr' | 'rtl'; readonly cases: number; readonly passed: number }[];
    readonly comparedNodes: number;
    readonly exactLuNodes: number;
    /** Compared text nodes (Range bounding rects) and per-line text fragments (Range client rects), and how many are exact. */
    readonly textNodes: number;
    readonly textNodesExact: number;
    readonly lineNodes: number;
    readonly lineNodesExact: number;
    /** Every anonymous box only Dragon has, with the Chrome-compared text lines inside it. */
    readonly anonymousBoxes: readonly { readonly case: string; readonly id: string; readonly lines: readonly string[] }[];
    readonly dual: {
      readonly boxesCompared: number;
      readonly boxesEqual: number;
      readonly valuesCompared: number;
      readonly valuesEqual: number;
      readonly channelsCompared: number;
      readonly channelsEqual: number;
    };
    readonly unsupportedCodes: readonly string[];
  };
  readonly deviations: typeof chromeDeviations;
  readonly fixtures: readonly FixtureOutcome[];
};

export function buildReport(outcomes: readonly FixtureOutcome[]): Report {
  const allCases: CaseOutcome[] = outcomes.flatMap((o) => o.cases);
  const nodes = allCases.flatMap((o) => (o.comparison === null ? [] : o.comparison.nodes));
  const duals = allCases.flatMap((o) => (o.dual === null ? [] : [o.dual]));
  const total = (f: (d: (typeof duals)[number]) => number): number => duals.reduce((s, d) => s + f(d), 0);
  return {
    run: {
      lanes: ['linux-dragon-layout', 'chrome-dual'],
      chrome: CHROME_VERSION,
      playwright: PLAYWRIGHT_VERSION,
      viewport: { width: ENVIRONMENT.viewport.width, height: ENVIRONMENT.viewport.height },
      devicePixelRatio: ENVIRONMENT.devicePixelRatio,
      gateDevicePx: GATE_DEVICE_PX,
      gateSource: 'docs/decisions.md decision 13',
      dualRule: 'authored vs compiled web in the same Chrome: boxes (elements, text nodes, text lines) equal, every longhand getComputedStyle string equal, colour channels equal to Dragon (a text node against its parent element computed color); no tolerance',
    },
    summary: {
      fixtures: outcomes.length,
      layoutFixtures: outcomes.filter((o) => o.kind === 'layout').length,
      treeFixtures: outcomes.filter((o) => o.kind === 'layout' && o.format === 'tree').length,
      rejectFixtures: outcomes.filter((o) => o.kind === 'reject').length,
      generatedFixtures: outcomes.filter((o) => FIXTURES.some((f) => f.id === o.id && f.kind === 'layout' && f.source === 'generated')).map((o) => o.id),
      passed: outcomes.filter((o) => o.status === 'pass').length,
      failed: outcomes.filter((o) => o.status === 'fail').length,
      cases: allCases.length,
      casesPassed: allCases.filter((c) => c.status === 'pass').length,
      caseCounts: outcomes.filter((o) => o.kind === 'layout').map((o) => ({ fixture: o.id, expected: o.expectedCases, renderer: o.rendererCases, dragon: o.dragonCases, environments: o.environments, cases: o.cases.map((c) => c.id) })),
      casesByDirection: (['ltr', 'rtl'] as const).map((direction) => ({ direction, cases: allCases.filter((c) => c.direction === direction).length, passed: allCases.filter((c) => c.direction === direction && c.status === 'pass').length })),
      comparedNodes: nodes.length,
      exactLuNodes: nodes.filter((n) => n.exactLu).length,
      textNodes: nodes.filter((n) => n.kind === 'text').length,
      textNodesExact: nodes.filter((n) => n.kind === 'text' && n.exactLu).length,
      lineNodes: nodes.filter((n) => n.kind === 'line').length,
      lineNodesExact: nodes.filter((n) => n.kind === 'line' && n.exactLu).length,
      anonymousBoxes: allCases.flatMap((c) => (c.comparison === null ? [] : c.comparison.anonymous.map((a) => ({ case: c.id, id: a.id, lines: a.lines })))),
      dual: {
        boxesCompared: total((d) => d.boxesCompared),
        boxesEqual: total((d) => d.boxesEqual),
        valuesCompared: total((d) => d.valuesCompared),
        valuesEqual: total((d) => d.valuesEqual),
        channelsCompared: total((d) => d.channelsCompared),
        channelsEqual: total((d) => d.channelsEqual),
      },
      unsupportedCodes: [...new Set(allCases.flatMap((o) => (o.unsupported === null ? [] : [o.unsupported.code])))].sort(),
    },
    deviations: chromeDeviations,
    fixtures: outcomes.map((o) => ({ ...o, webCss: { ltr: null, rtl: null }, cases: o.cases.map((c) => ({ ...c, vector: null, topology: null })) })),
  };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number): string => String(Math.round(n * 1e6) / 1e6);

function svg(title: string, boxes: readonly { id: string; e: Edges }[]): string {
  const w = ENVIRONMENT.viewport.width;
  const h = ENVIRONMENT.viewport.height;
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
  parts.push(`<h1>Dragon parity (S4b)</h1><p>Lanes ${r.run.lanes.join(' and ')}; Chrome ${esc(r.run.chrome)} via Playwright ${esc(r.run.playwright)}; viewport ${r.run.viewport.width}x${r.run.viewport.height} at DPR ${r.run.devicePixelRatio}; layout gate ${r.run.gateDevicePx} device px per edge (${esc(r.run.gateSource)}); dual rule: ${esc(r.run.dualRule)}. Screenshots are not used; these drawings are evidence only.</p>`);
  const d = r.summary.dual;
  parts.push(`<p>${r.summary.passed}/${r.summary.fixtures} fixtures pass (${r.summary.layoutFixtures} layout, of which ${r.summary.treeFixtures} tree and ${r.summary.generatedFixtures.length} generated; ${r.summary.rejectFixtures} reject); ${r.summary.casesPassed}/${r.summary.cases} cases pass (${r.summary.casesByDirection.map((d) => `${d.direction} ${d.passed}/${d.cases}`).join(', ')}). Layout lane: ${r.summary.exactLuNodes}/${r.summary.comparedNodes} compared nodes match Chrome exactly at 1/64 px (informational), of them text nodes ${r.summary.textNodesExact}/${r.summary.textNodes} and per-line text fragments ${r.summary.lineNodesExact}/${r.summary.lineNodes}; ${r.summary.anonymousBoxes.length} anonymous boxes (Dragon only, listed per case). Dual lane: boxes ${d.boxesEqual}/${d.boxesCompared}, computed values ${d.valuesEqual}/${d.valuesCompared}, colour channels ${d.channelsEqual}/${d.channelsCompared}.</p>`);
  for (const f of r.fixtures) {
    const perEnv = f.environments.map((e) => `${e.direction}: ${e.expected} declared, ${e.renderer} rendered, ${e.dragon} enumerated by Dragon`).join('; ');
    parts.push(`<h2 id="${esc(f.id)}">${esc(f.id)} <span class="${f.status}">${f.status}</span></h2><p>${f.format} ${f.kind} fixture; ${f.cases.length} case(s)${perEnv === '' ? '' : ` (${esc(perEnv)})`}</p>`);
    if (f.reason !== null) parts.push(`<p class="fail">${esc(f.reason)}</p>`);
    for (const d of f.diagnostics) parts.push(`<p>${esc(d.code)}: ${esc(d.message)}${d.spanText === null ? '' : ` at "${esc(d.spanText)}"`}</p>`);
    for (const c of f.cases) {
      const assignment = c.assignment.map((a) => `${a.state.instance}.${a.state.state}=${JSON.stringify(a.value)}`).join(', ');
      parts.push(`<h3 id="${esc(c.id)}">${esc(c.id)} <span class="${c.status}">${c.status}</span></h3><p>direction ${c.direction}; ${assignment === '' ? 'no states' : esc(assignment)}${c.isInitial ? ' (initial)' : ''}; linux-dragon-layout: ${c.lanes['linux-dragon-layout']}; chrome-dual: ${c.lanes['chrome-dual']}${c.dual === null ? '' : ` (boxes ${c.dual.boxesEqual}/${c.dual.boxesCompared}, values ${c.dual.valuesEqual}/${c.dual.valuesCompared}, channels ${c.dual.channelsEqual}/${c.dual.channelsCompared})`}</p>`);
      if (c.reason !== null) parts.push(`<p class="fail">${esc(c.reason)}</p>`);
      if (c.comparison === null) continue;
      for (const a of c.comparison.anonymous) parts.push(`<p>anonymous box ${esc(a.id)} (Dragon only): text lines ${esc(a.lines.join(', '))}, each compared with Chrome</p>`);
      const nodes = c.comparison.nodes;
      parts.push(svg('Chrome (authored CSS)', nodes.map((n) => ({ id: n.id, e: n.chrome }))));
      parts.push(svg('Dragon layout (compiled ios projection)', nodes.flatMap((n) => (n.dragon === null ? [] : [{ id: n.id, e: n.dragon }]))));
      parts.push('<table><tr><th>node</th><th>Chrome l,t,r,b</th><th>Dragon l,t,r,b</th><th>delta l,t,r,b</th><th>gate</th><th>exact 1/64</th></tr>');
      for (const n of nodes) {
        const e = (x: Edges | null): string => (x === null ? '-' : [x.left, x.top, x.right, x.bottom].map(num).join(', '));
        parts.push(`<tr><td class="id">${esc(n.id)}</td><td>${e(n.chrome)}</td><td>${e(n.dragon)}</td><td>${e(n.delta)}</td><td class="${n.pass ? 'pass' : 'fail'}">${n.pass ? 'pass' : 'fail'}</td><td>${n.exactLu ? 'yes' : 'no'}</td></tr>`);
      }
      parts.push('</table>');
    }
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
