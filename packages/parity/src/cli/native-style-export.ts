// pnpm run native:style-export [-- <fixture>...]: for each Markless ladder fixture (default: every layout fixture of
// fixture-groups/markless-styles.ts without interaction states), compiles it through compileNativeStyles, writes its
// dragon.native-style-export/1 file, and compares every frame of every state assignment with Chrome's boxes at each proof
// device's viewport and DPR under the device lanes' gate. Writes examples/markless-styles/out/<fixture>.native-style.json and
// <fixture>.chrome-compare.json; exits 1 when any box is outside the gate.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Assignment, NativeStylesConfig } from 'dragon';
import { compileNativeStyles } from 'dragon';
import { captureFixture } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { GATE_DEVICE_PX } from '../compare.ts';
import { PROJECT_ID } from '../fixture-reader.ts';
import { MARKLESS_STYLES } from '../fixture-groups/markless-styles.ts';
import type { ExportNode } from '../native-style-export.ts';
import { nativeStyleExport } from '../native-style-export.ts';
import { repoPath } from '../paths.ts';
import { authoredModel } from '../render.ts';
import { readTreeFixture } from '../tree-fixture.ts';

const DEFAULT = ['ms-box', 'ms-text', 'ms-flex', 'ms-toggle'];
const ids = process.argv.slice(2).filter((a) => a !== '--');
for (const id of ids) if (!MARKLESS_STYLES.some((f) => f.id === id && f.kind === 'layout')) throw new Error(`${id} is not a layout fixture of the Markless ladder`);
const outDir = repoPath('examples/markless-styles/out');
mkdirSync(outDir, { recursive: true });

const key = (values: Readonly<Record<string, unknown>>): string => JSON.stringify(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1)));
const valuesOf = (a: Assignment): Record<string, unknown> => Object.fromEntries(a.map((x) => [`${x.state.instance}#${x.state.state}`, x.value]));
type Frame = { x: number; y: number; width: number; height: number };

let failed = 0;
for (const id of ids.length === 0 ? DEFAULT : ids) {
  const input = readTreeFixture(id);
  const name = id.replace(/^ms-/, '').replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase());
  const config: NativeStylesConfig = { projectId: PROJECT_ID, name, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, viewport: { width: 402, height: 778 } };
  const exported = nativeStyleExport(compileNativeStyles(config, input), name, `packages/parity/fixtures/${id}`);
  writeFileSync(`${outDir}/${id}.native-style.json`, `${JSON.stringify(exported, null, 1)}\n`);
  const model = authoredModel(input);
  const report: Record<string, unknown> = {};
  for (const [target, t] of Object.entries(exported.targets)) {
    const browser = await launchChrome(t.dpr);
    try {
      const sets = [];
      for (const a of t.assignments) {
        const authored = model.assignments.find((m) => key(valuesOf(m)) === key(a.values));
        if (authored === undefined) throw new Error(`${id}: the reference renderer has no assignment ${key(a.values)}`);
        const byId = new Map(a.nodes.map((n) => [n.id, n]));
        const absolute = (n: ExportNode): Frame => {
          if (n.frame === null) throw new Error(`${id}: ${n.id} has no frame`);
          const p = n.parent === null ? { x: 0, y: 0 } : absolute(byId.get(n.parent) as ExportNode);
          return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
        };
        const capture = await captureFixture(browser, id, model.render(authored, { kind: 'authored' }), { viewport: t.viewport, devicePixelRatio: t.dpr, direction: 'ltr', rootFont: 'ahem' });
        const boxes = capture.nodes.filter((c) => c.hasBox && c.kind !== 'line' && byId.has(c.id));
        if (boxes.length !== a.nodes.filter((n) => n.frame !== null).length) {
          failed++;
          console.log(`${id} ${target} ${key(a.values)}: Chrome has ${boxes.length} of the ${a.nodes.length} exported boxes`);
        }
        const rows = boxes.map((c) => {
          const d = absolute(byId.get(c.id) as ExportNode);
          const chrome = { x: c.x * t.dpr, y: c.y * t.dpr, width: c.width * t.dpr, height: c.height * t.dpr };
          const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(chrome[k] - d[k])));
          if (!(delta <= GATE_DEVICE_PX)) failed++;
          return { id: c.id, chrome, dragon: d, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX };
        });
        sets.push({ values: a.values, rows });
        const worst = Math.max(...rows.map((r) => r.maxDeltaDevicePx));
        console.log(`${id} ${target} ${key(a.values)}: ${rows.length} boxes, largest difference ${worst} device px, ${rows.every((r) => r.pass) ? 'pass' : 'FAIL'}`);
      }
      report[target] = { viewport: t.viewport, dpr: t.dpr, assignments: sets };
    } finally {
      await browser.close();
    }
  }
  writeFileSync(`${outDir}/${id}.chrome-compare.json`, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, targets: report }, null, 1)}\n`);
}
if (failed > 0) {
  console.log(`${failed} boxes outside ${GATE_DEVICE_PX} device px, or missing`);
  process.exit(1);
}
console.log(`every box of every assignment within ${GATE_DEVICE_PX} device px of Chrome`);
