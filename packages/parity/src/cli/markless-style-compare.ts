// pnpm run markless:style-compare -- <native-style-input.json> <native-style.json> <report.json>: the export's frames against
// Chrome's boxes per assignment (packages/parity/src/markless-style-compare.ts). Exits 1 when a box is outside the gate or only one side has it.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GATE_DEVICE_PX } from '../compare.ts';
import { compareMarklessExport } from '../markless-style-compare.ts';
import { parseMarklessStyleInput } from '../markless-style-input.ts';
import type { NativeStyleExport } from '../native-style-export.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.length !== 3) {
  console.error('usage: pnpm run markless:style-compare -- <native-style-input.json> <native-style.json> <report.json>');
  process.exit(2);
}
const [inputPath, exportPath, reportPath] = args.map((a) => resolve(process.env['INIT_CWD'] ?? process.cwd(), a)) as [string, string, string];
const report = await compareMarklessExport(parseMarklessStyleInput(readFileSync(inputPath, 'utf8')), JSON.parse(readFileSync(exportPath, 'utf8')) as NativeStyleExport);
writeFileSync(reportPath, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, ...report }, null, 1)}\n`);
console.log(`${report.compared} boxes compared, ${report.failed} failed (outside ${GATE_DEVICE_PX} device px, or a box only Chrome or the export has)`);
if (report.failed > 0 || report.compared === 0) process.exit(1);
