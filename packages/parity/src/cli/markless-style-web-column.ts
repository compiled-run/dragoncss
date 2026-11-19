// pnpm run markless:style-web-column -- <native-style-input.json> <native-style.json> <report.json> (--ios <udid> | --android <serial>)
// [--screenshots <dir>]: the export's frames against the boxes the phone's own browser lays the page out at (Safari in a booted
// iOS simulator, Chrome on a booted Android emulator; packages/parity/src/markless-web-column.ts). Exits 1 when a box is outside
// the gate.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GATE_DEVICE_PX } from '../compare.ts';
import { marklessFontFiles, parseMarklessStyleInput } from '../markless-style-input.ts';
import { parseNativeStyleExport } from '../native-style-export.ts';
import { webColumn } from '../markless-web-column.ts';
import type { WebColumnDevice } from '../markless-web-column.ts';

const rest = process.argv.slice(2).filter((a) => a !== '--');
const option = (name: string): string | undefined => {
  const at = rest.indexOf(name);
  if (at < 0) return undefined;
  const v = rest[at + 1];
  rest.splice(at, 2);
  return v ?? '';
};
const ios = option('--ios');
const android = option('--android');
const shots = option('--screenshots');
if (rest.length !== 3 || (ios === undefined) === (android === undefined) || ios === '' || android === '' || shots === '') {
  console.error('usage: pnpm run markless:style-web-column -- <native-style-input.json> <native-style.json> <report.json> (--ios <udid> | --android <serial>) [--screenshots <dir>]');
  process.exit(2);
}
const caller = (a: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), a);
const [inputPath, exportPath, reportPath] = rest.map(caller) as [string, string, string];
const shotDir = shots === undefined ? undefined : caller(shots);
if (shotDir !== undefined) mkdirSync(shotDir, { recursive: true });
const device: WebColumnDevice = ios !== undefined ? { target: 'ios', udid: ios } : { target: 'android', serial: android as string };
let report: Awaited<ReturnType<typeof webColumn>>;
try {
  const input = parseMarklessStyleInput(readFileSync(inputPath, 'utf8'));
  const fonts = marklessFontFiles(input, (file) => readFileSync(resolve(dirname(inputPath), file)));
  report = await webColumn(input, parseNativeStyleExport(readFileSync(exportPath, 'utf8')), device, fonts, shotDir);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
writeFileSync(reportPath, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, target: device.target, ...report }, null, 1)}\n`);
console.log(`${device.target} (${report.browser}): ${report.compared} boxes compared, ${report.failed} outside ${GATE_DEVICE_PX} device px`);
if (report.failed > 0 || report.compared === 0) process.exit(1);
