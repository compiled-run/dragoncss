// pnpm run markless:style-compare -- <native-style-input.json> <native-style.json> <report.json>: the export's frames against
// Chrome's boxes per assignment (packages/parity/src/markless-style-compare.ts). Exits 1 when a box is outside the gate or only one side has it, or the export is malformed or leaves out a target or a state.
// `--screenshots <dir>` also saves Chrome's rendering of each assignment there. The font mode is the export's (`--fonts`, when given,
// must match it); with system fonts Chrome draws Android's system faces from the SDK image's files; iOS's are compared with Safari
// (markless:style-web-column). Each assignment's canvas, body background and colour scheme are compared with Chrome's too.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GATE_DEVICE_PX } from '../compare.ts';
import { compareMarklessExport } from '../markless-style-compare.ts';
import { marklessFontFiles, parseMarklessStyleInput } from '../markless-style-input.ts';
import { parseNativeStyleExport } from '../native-style-export.ts';

const rest = process.argv.slice(2).filter((a) => a !== '--');
const option = (name: string): string | undefined => {
  const at = rest.indexOf(name);
  if (at < 0) return undefined;
  const v = rest[at + 1];
  rest.splice(at, 2);
  return v ?? '';
};
const shots = option('--screenshots');
const mode = option('--fonts') ?? null;
const only = option('--targets');
const args = rest;
if (args.length !== 3 || shots === '' || (mode !== null && mode !== 'system' && mode !== 'pinned') || only === '') {
  console.error('usage: pnpm run markless:style-compare -- <native-style-input.json> <native-style.json> <report.json> [--screenshots <dir>] [--fonts system|pinned] [--targets ios,android]');
  process.exit(2);
}
const caller = (a: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), a);
const [inputPath, exportPath, reportPath] = args.map(caller) as [string, string, string];
const shotDir = shots === undefined ? undefined : caller(shots);
if (shotDir !== undefined) mkdirSync(shotDir, { recursive: true });
let report: Awaited<ReturnType<typeof compareMarklessExport>>;
try {
  const input = parseMarklessStyleInput(readFileSync(inputPath, 'utf8'));
  const fonts = marklessFontFiles(input, (file) => readFileSync(resolve(dirname(inputPath), file)));
  report = await compareMarklessExport(input, parseNativeStyleExport(readFileSync(exportPath, 'utf8')), shotDir, 'light', fonts, mode, only === undefined ? null : only.split(','));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
writeFileSync(reportPath, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, fonts: report.fontMode, ...(only === undefined ? {} : { targets: only.split(',') }), ...report }, null, 1)}
`);
console.log(`${report.compared} boxes and ${report.paint.length} page paint fields compared, ${report.failed} failed (outside ${GATE_DEVICE_PX} device px, a box only Chrome or the export has, or a canvas, body background or colour scheme unlike Chrome's)`);
if (report.failed > 0 || report.compared === 0) process.exit(1);
