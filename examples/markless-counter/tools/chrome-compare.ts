// Compares the exported frames (out/counter.native-style.json, Dragon's reference engine) with Chrome's boxes for the same page at
// each proof device's viewport and DPR, under the device lanes' gate: every element and text box within 1 device px.
import { readFileSync, writeFileSync } from 'node:fs';
import { captureFixture } from '../../../packages/parity/src/capture.ts';
import { launchChrome } from '../../../packages/parity/src/chrome.ts';
import { authoredFontHtml } from '../../../packages/parity/src/cases.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from '../../../packages/parity/src/font-reference.ts';
import { GATE_DEVICE_PX } from '../../../packages/parity/src/compare.ts';

type Frame = { x: number; y: number; width: number; height: number };
type Node = { id: string; parent: string | null; frame: Frame | null };
const exported = JSON.parse(readFileSync(new URL('../out/counter.native-style.json', import.meta.url), 'utf8')) as { targets: Record<string, { viewport: { width: number; height: number }; dpr: number; nodes: Node[] }> };
const gate = GATE_DEVICE_PX;
const html = authoredFontHtml(readFileSync(new URL('../counter.html', import.meta.url), 'utf8'));
const report: Record<string, unknown> = {};
let failed = 0;
for (const [target, t] of Object.entries(exported.targets)) {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const absolute = (n: Node): Frame => {
    if (n.frame === null) throw new Error(`${n.id} has no frame`);
    const p = n.parent === null ? { x: 0, y: 0 } : absolute(byId.get(n.parent) as Node);
    return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
  };
  const browser = await launchChrome(t.dpr);
  try {
    const capture = await captureFixture(browser, 'markless-counter', html, { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], fontReferencePrepare(FONT_REFERENCE_MAP));
    const rows = capture.nodes.filter((c) => c.hasBox && c.kind !== 'line' && byId.has(c.id)).map((c) => {
      const d = absolute(byId.get(c.id) as Node);
      const chrome = { x: c.x * t.dpr, y: c.y * t.dpr, width: c.width * t.dpr, height: c.height * t.dpr };
      const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(chrome[k] - d[k])));
      if (delta > gate) failed++;
      return { id: c.id, chrome, dragon: d, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= gate };
    });
    report[target] = { viewport: t.viewport, dpr: t.dpr, chrome: capture.chrome, rows };
  } finally {
    await browser.close();
  }
}
writeFileSync(new URL('../out/chrome-compare.json', import.meta.url), `${JSON.stringify({ gateDevicePx: gate, failed, targets: report }, null, 1)}\n`);
for (const [target, r] of Object.entries(report)) for (const row of (r as { rows: { id: string; maxDeltaDevicePx: number; pass: boolean }[] }).rows) console.log(target, row.id, row.maxDeltaDevicePx, row.pass ? 'pass' : 'FAIL');
if (failed > 0) { console.log(`${failed} boxes outside ${gate} device px`); process.exit(1); }
console.log(`every box within ${gate} device px of Chrome`);
