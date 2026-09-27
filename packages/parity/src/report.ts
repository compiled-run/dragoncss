// Deterministic report: report.json (numbers), index.html (side-by-side boxes) and summary.md (the counts the audit reads). No
// timestamps or absolute paths; the drawings are evidence, not a gate, and no assertion reads them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromeDeviations, platformRules } from '@dragon/layout';
import { iosProfile, webProfile } from 'dragon';
import { CHROME_ARGS, CHROME_VERSION, PLAYWRIGHT_VERSION } from './chrome.ts';
import { BROWSER_FLAVOUR, hostPlatform, LINUX_LANE, REFERENCE_PLATFORM } from './platform.ts';
import type { Edges } from './compare.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { ENVIRONMENT, FIXTURES } from './fixtures.ts';
import type { CaseOutcome, FixtureOutcome } from './pipeline.ts';
import { repoPath } from './paths.ts';

/** docs/decisions.md, Linux lane scope (2026-09-27), quoted in every report. */
export const SCOPE = 'Dragon\'s layout engine is platform-free TypeScript and gives the same numbers on any OS. The Chrome oracle is captured on macOS Chrome 145.0.7632.6. Reports and the final audit say exactly that. They do not claim a Linux run.';
export const ORACLE_LANE = 'macOS-captured Chrome 145.0.7632.6 (darwin-arm64) plus the platform-free Dragon layout lane';

type NodeExactness = { readonly case: string; readonly exactLu: boolean; readonly pass: boolean };
type RegistryNode = { readonly branch: string; readonly fixture: string; readonly node: string; readonly results: readonly NodeExactness[] };

export type Report = {
  readonly run: {
    readonly lanes: readonly ['linux-dragon-layout', 'chrome-dual'];
    /** Lanes the milestone names but this run could not execute, reported as unavailable, never as passed. */
    readonly unavailableLanes: readonly (typeof LINUX_LANE)[];
    readonly oracleLane: string;
    readonly scope: string;
    readonly chrome: string;
    readonly playwright: string;
    readonly browser: string;
    readonly platform: string;
    readonly referencePlatform: string;
    readonly flags: readonly string[];
    /** The environment root font of the layout fixtures, and the fixtures that keep Chrome's UA font instead. */
    readonly rootFont: { readonly default: 'ahem'; readonly uaDefault: readonly string[] };
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
    /** Layout fixtures written by a committed generator (scripts/gen-*.ts) from its committed selection. */
    readonly generatedFixtures: readonly string[];
    readonly handWrittenLayoutFixtures: number;
    readonly generatedLayoutFixtures: number;
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
  /** Every Chrome deviation and platform rule with its branches, and each registered node's exactness in every case that has it. */
  readonly deviations: readonly { readonly id: string; readonly specSection: string; readonly spec: string; readonly blink: string; readonly fault: string; readonly finding: { readonly kind: 'distinguished' } | { readonly kind: 'contradicted'; readonly detail: string }; readonly branches: readonly { readonly id: string; readonly description: string }[]; readonly nodes: readonly RegistryNode[]; readonly controls: readonly (RegistryNode & { readonly reason: string })[] }[];
  readonly platformRules: readonly { readonly id: string; readonly platform: string; readonly rule: string; readonly source: string; readonly fault: string; readonly branches: readonly { readonly id: string; readonly description: string }[]; readonly nodes: readonly RegistryNode[] }[];
  /** Every committed profile row with the case ids its proofs name, and whether each id is a passing case of this report. */
  readonly profileRows: readonly { readonly target: 'ios' | 'web'; readonly feature: string; readonly context: string; readonly status: string; readonly proofs: readonly { readonly lane: string; readonly aspect: string; readonly cases: readonly string[] }[]; readonly casesPassingInReport: boolean }[];
  /** Per case, the row keys ("<feature>@<context>") whose proofs name it, per target. */
  readonly caseRows: readonly { readonly case: string; readonly ios: readonly string[]; readonly web: readonly string[] }[];
  readonly fixtures: readonly FixtureOutcome[];
};

function registryNodes(outcomes: readonly FixtureOutcome[], nodes: readonly { readonly branch: string; readonly fixture: string; readonly node: string }[]): RegistryNode[] {
  return nodes.map((n) => ({
    ...n,
    results: (outcomes.find((o) => o.id === n.fixture)?.cases ?? []).flatMap((c) => (c.comparison?.nodes ?? []).filter((x) => x.id === n.node).map((x) => ({ case: c.id, exactLu: x.exactLu, pass: x.pass }))),
  }));
}

export function buildReport(outcomes: readonly FixtureOutcome[]): Report {
  const allCases: CaseOutcome[] = outcomes.flatMap((o) => o.cases);
  const nodes = allCases.flatMap((o) => (o.comparison === null ? [] : o.comparison.nodes));
  const duals = allCases.flatMap((o) => (o.dual === null ? [] : [o.dual]));
  const total = (f: (d: (typeof duals)[number]) => number): number => duals.reduce((s, d) => s + f(d), 0);
  const passing = new Set(allCases.filter((c) => c.status === 'pass').map((c) => c.id));
  const rows = [['ios', iosProfile] as const, ['web', webProfile] as const].flatMap(([target, profile]) => profile.rows.map((r) => ({
    target,
    feature: r.feature,
    context: r.context,
    status: r.status,
    proofs: r.proofs.map((p) => ({ lane: p.lane, aspect: p.aspect, cases: p.cases })),
    casesPassingInReport: r.proofs.every((p) => p.cases.length > 0 && p.cases.every((id) => passing.has(id))),
  })));
  const proves = (target: 'ios' | 'web', id: string): string[] => rows.filter((r) => r.target === target && r.proofs.some((p) => p.cases.includes(id))).map((r) => `${r.feature}@${r.context}`);
  const layoutSpecs = FIXTURES.filter((f) => f.kind === 'layout');
  return {
    run: {
      lanes: ['linux-dragon-layout', 'chrome-dual'],
      unavailableLanes: [LINUX_LANE],
      oracleLane: ORACLE_LANE,
      scope: SCOPE,
      chrome: CHROME_VERSION,
      playwright: PLAYWRIGHT_VERSION,
      browser: BROWSER_FLAVOUR,
      platform: hostPlatform(),
      referencePlatform: REFERENCE_PLATFORM,
      flags: CHROME_ARGS,
      rootFont: { default: 'ahem', uaDefault: layoutSpecs.filter((f) => f.kind === 'layout' && f.rootFont === 'ua-default').map((f) => f.id) },
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
      handWrittenLayoutFixtures: outcomes.filter((o) => FIXTURES.some((f) => f.id === o.id && f.kind === 'layout' && f.source === 'hand-written')).length,
      generatedLayoutFixtures: outcomes.filter((o) => FIXTURES.some((f) => f.id === o.id && f.kind === 'layout' && f.source === 'generated')).length,
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
    deviations: chromeDeviations.map((d) => ({ ...d, nodes: registryNodes(outcomes, d.nodes), controls: d.controls.map((c) => ({ ...registryNodes(outcomes, [{ branch: 'control', fixture: c.fixture, node: c.node }])[0] as RegistryNode, reason: c.reason })) })),
    platformRules: platformRules.map((r) => ({ ...r, nodes: registryNodes(outcomes, r.nodes) })),
    profileRows: rows,
    caseRows: allCases.map((c) => ({ case: c.id, ios: proves('ios', c.id), web: proves('web', c.id) })),
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
  parts.push(`<h1>Dragon parity (S5)</h1><p>Scope: ${esc(r.run.scope)} Oracle lane: ${esc(r.run.oracleLane)}. ${r.run.unavailableLanes.map((l) => `${esc(l.lane)} (${esc(l.platform)}): ${esc(l.status)}`).join('; ')}.</p><p>Lanes ${r.run.lanes.join(' and ')}; Chrome ${esc(r.run.chrome)} (${esc(r.run.browser)}) via Playwright ${esc(r.run.playwright)} on ${esc(r.run.platform)} (reference ${esc(r.run.referencePlatform)}); flags ${esc(r.run.flags.join(' '))}; viewport ${r.run.viewport.width}x${r.run.viewport.height} at DPR ${r.run.devicePixelRatio}; root font Ahem (Chrome's UA font in ${esc(r.run.rootFont.uaDefault.join(', '))}); layout gate ${r.run.gateDevicePx} device px per edge (${esc(r.run.gateSource)}); dual rule: ${esc(r.run.dualRule)}. Screenshots are not used; these drawings are evidence, not a gate.</p>`);
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

/** The counts the final audit checks, with the scope wording and the unavailable Linux lane (docs/decisions.md). */
export function renderSummary(r: Report): string {
  const s = r.summary;
  const d = s.dual;
  const exactRows = r.profileRows.filter((x) => x.status === 'exact');
  const lines = [
    '# Dragon parity summary',
    '',
    `Scope (docs/decisions.md): ${r.run.scope}`,
    '',
    `Oracle lane: ${r.run.oracleLane}.`,
    '',
    ...r.run.unavailableLanes.map((l) => `Linux lane (${l.platform}): ${l.status}. The workflow is ${l.workflow}.`),
    '',
    `Run: Chrome ${r.run.chrome} (${r.run.browser}) via Playwright ${r.run.playwright} on ${r.run.platform}; reference platform ${r.run.referencePlatform}; flags ${r.run.flags.join(' ')}; viewport ${r.run.viewport.width}x${r.run.viewport.height}, DPR ${r.run.devicePixelRatio}; root font Ahem (Chrome's UA font in ${r.run.rootFont.uaDefault.join(', ')}).`,
    '',
    '| Count | Value |',
    '|---|---|',
    `| Fixtures | ${s.fixtures} (${s.layoutFixtures} layout, ${s.rejectFixtures} reject) |`,
    `| Layout fixtures | ${s.layoutFixtures} |`,
    `| Hand-written layout fixtures | ${s.handWrittenLayoutFixtures} |`,
    `| Generated layout fixtures | ${s.generatedLayoutFixtures} (${s.generatedFixtures.join(', ')}) |`,
    `| Tree layout fixtures | ${s.treeFixtures} |`,
    `| Passed | ${s.passed} |`,
    `| Failed | ${s.failed} |`,
    `| Cases | ${s.cases} (${s.casesPassed} pass; ${s.casesByDirection.map((x) => `${x.direction} ${x.passed}/${x.cases}`).join(', ')}) |`,
    `| linux-dragon-layout gate | ${r.run.gateDevicePx} device px per edge |`,
    `| Nodes exact at 1/64 px (informational) | ${s.exactLuNodes}/${s.comparedNodes} (text ${s.textNodesExact}/${s.textNodes}, lines ${s.lineNodesExact}/${s.lineNodes}) |`,
    `| Anonymous boxes | ${s.anonymousBoxes.length} |`,
    `| chrome-dual | boxes ${d.boxesEqual}/${d.boxesCompared}, values ${d.valuesEqual}/${d.valuesCompared}, channels ${d.channelsEqual}/${d.channelsCompared} |`,
    `| unsupportedCodes | ${JSON.stringify(s.unsupportedCodes)} |`,
    `| Profile rows | ${r.profileRows.length} (${exactRows.length} exact; ${r.profileRows.filter((x) => !x.casesPassingInReport).length} with a proof case that is not a passing case of this report) |`,
    '',
    '## Chrome deviations and platform rules',
    '',
    '| Entry | Branch | Nodes | Exact at 1/64 px |',
    '|---|---|---|---|',
    ...[...r.deviations, ...r.platformRules].flatMap((e) => e.branches.map((b) => {
      const nodes = e.nodes.filter((n) => n.branch === b.id);
      const results = nodes.flatMap((n) => n.results);
      return `| ${e.id} | ${b.id} | ${nodes.map((n) => `${n.fixture}: ${n.node}`).join(', ')} | ${results.filter((x) => x.exactLu).length}/${results.length} |`;
    })),
    '',
    ...r.deviations.filter((e) => e.finding.kind === 'contradicted').map((e) => `Finding for the final audit: ${e.id} is contradicted by its spec-reading fault ${e.fault}. ${e.finding.kind === 'contradicted' ? e.finding.detail : ''}`),
    '',
    'Screenshots: none. The drawings in index.html are evidence, not a gate, and no assertion reads them.',
    '',
  ];
  return lines.join('\n');
}

export function writeReport(r: Report): void {
  const dir = repoPath('packages/parity/out');
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/report.json`, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(`${dir}/index.html`, renderHtml(r));
  writeFileSync(`${dir}/summary.md`, renderSummary(r));
}
