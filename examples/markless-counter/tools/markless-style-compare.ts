// Compares every frame of every assignment in a Markless style export with Chrome's boxes for the same element tree, at
// each proof device's viewport and ratio, under the device lanes' gate. Usage: <input.json> <export.json> <report.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { captureFixture } from '../../../packages/parity/src/capture.ts';
import { launchChrome } from '../../../packages/parity/src/chrome.ts';
import { authoredFontHtml } from '../../../packages/parity/src/cases.ts';
import { FONT_REFERENCE_MAP, fontReferencePrepare } from '../../../packages/parity/src/font-reference.ts';
import { GATE_DEVICE_PX } from '../../../packages/parity/src/compare.ts';
import { documentHtml, readStyleInput } from './markless-style.ts';

type Frame = { x: number; y: number; width: number; height: number };
type Node = { id: string; parent: string | null; kind: string; frame: Frame | null };
type Target = { viewport: { width: number; height: number }; dpr: number; assignments: { values: Record<string, boolean>; nodes: Node[] }[] };
const [inputPath, exportPath, reportPath] = process.argv.slice(2);
if (!inputPath || !exportPath || !reportPath) throw new Error('usage: markless-style-compare.ts <input.json> <export.json> <report.json>');
const input = readStyleInput(inputPath);
const exported = JSON.parse(readFileSync(exportPath, 'utf8')) as { targets: Record<string, Target> };
let failed = 0;
let compared = 0;
const report: unknown[] = [];
for (const [target, t] of Object.entries(exported.targets)) {
  const browser = await launchChrome(t.dpr);
  try {
    for (const assignment of t.assignments) {
      const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
      const absolute = (n: Node): Frame => {
        if (n.frame === null) throw new Error(`${n.id} has no frame`);
        const p = n.parent === null ? { x: 0, y: 0 } : absolute(byId.get(n.parent) as Node);
        return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
      };
      const capture = await captureFixture(browser, `markless-${input.component}`, authoredFontHtml(documentHtml(input, assignment.values)), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ua-default' }, [], fontReferencePrepare(FONT_REFERENCE_MAP));
      for (const c of capture.nodes) {
        const node = byId.get(c.id);
        if (!c.hasBox || c.kind === 'line' || !node || node.frame === null) continue;
        const d = absolute(node);
        const chrome = { x: c.x * t.dpr, y: c.y * t.dpr, width: c.width * t.dpr, height: c.height * t.dpr };
        const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(chrome[k] - d[k])));
        compared++;
        if (delta > GATE_DEVICE_PX) failed++;
        report.push({ target, values: assignment.values, id: c.id, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX });
      }
    }
  } finally {
    await browser.close();
  }
}
writeFileSync(reportPath, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, compared, failed, rows: report }, null, 1)}\n`);
console.log(`${compared} boxes compared, ${failed} outside ${GATE_DEVICE_PX} device px`);
if (failed > 0 || compared === 0) process.exit(1);
