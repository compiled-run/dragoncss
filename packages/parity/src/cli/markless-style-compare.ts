// pnpm run markless:style-compare -- <native-style-input.json> <native-style.json> <report.json>: the export's frames against
// Chrome's boxes per assignment (packages/parity/src/markless-style-compare.ts). Exits 1 when a box is outside the gate.
// `--screenshots <dir>` also saves Chrome's rendering of each assignment there.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GATE_DEVICE_PX } from '../compare.ts';
import { compareMarklessExport } from '../markless-style-compare.ts';
import { parseMarklessStyleInput } from '../markless-style-input.ts';
import type { NativeStyleExport } from '../native-style-export.ts';

const all = process.argv.slice(2).filter((a) => a !== '--');
const at = all.indexOf('--screenshots');
const shots = at < 0 ? undefined : all[at + 1];
const args = at < 0 ? all : all.filter((_, i) => i !== at && i !== at + 1);
if (args.length !== 3 || (at >= 0 && shots === undefined)) {
  console.error('usage: pnpm run markless:style-compare -- <native-style-input.json> <native-style.json> <report.json> [--screenshots <dir>]');
  process.exit(2);
}
const caller = (a: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), a);
const [inputPath, exportPath, reportPath] = args.map(caller) as [string, string, string];
const shotDir = shots === undefined ? undefined : caller(shots);
if (shotDir !== undefined) mkdirSync(shotDir, { recursive: true });
const report = await compareMarklessExport(parseMarklessStyleInput(readFileSync(inputPath, 'utf8')), JSON.parse(readFileSync(exportPath, 'utf8')) as NativeStyleExport, shotDir);
writeFileSync(reportPath, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, ...report }, null, 1)}\n`);
console.log(`${report.compared} boxes compared, ${report.failed} outside ${GATE_DEVICE_PX} device px`);
if (report.failed > 0 || report.compared === 0) process.exit(1);
