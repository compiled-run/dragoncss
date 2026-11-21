// pnpm run markless:any-size -- <native-style-input.json> <report.json> (--ios <udid> | --android <serial>) [--screenshots <dir>]:
// how a Markless export looks on a phone of any size. `fixed`: the export laid out for the proof device, as the hosts draw it on
// this device, against the phone's own browser at this device's size. `atSize`: the same input laid out by Dragon for this
// device's size and ratio, against the same browser. Reports both; exits 0 (a measurement, not a gate).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GATE_DEVICE_PX } from '../compare.ts';
import { marklessFontFiles, marklessStyleExport, parseMarklessStyleInput } from '../markless-style-input.ts';
import { webColumn } from '../markless-web-column.ts';
import type { WebColumnDevice, WebColumnRow } from '../markless-web-column.ts';

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
if (rest.length !== 2 || (ios === undefined) === (android === undefined) || ios === '' || android === '' || shots === '') {
  console.error('usage: pnpm run markless:any-size -- <native-style-input.json> <report.json> (--ios <udid> | --android <serial>) [--screenshots <dir>]');
  process.exit(2);
}
const caller = (a: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), a);
const [inputPath, reportPath] = rest.map(caller) as [string, string];
const shotDir = shots === undefined ? undefined : caller(shots);
if (shotDir !== undefined) mkdirSync(shotDir, { recursive: true });
const text = readFileSync(inputPath, 'utf8');
const input = parseMarklessStyleInput(text);
const read = (file: string): Uint8Array => readFileSync(resolve(dirname(inputPath), file));
const fonts = marklessFontFiles(input, read);
const device: WebColumnDevice = ios !== undefined ? { target: 'ios', udid: ios } : { target: 'android', serial: android as string };

const summary = (rows: readonly WebColumnRow[]) => ({
  compared: rows.length,
  failed: rows.filter((r) => !r.pass).length,
  worstDevicePx: rows.reduce((m, r) => Math.max(m, r.maxDeltaDevicePx), 0),
});

const fixed = await webColumn(input, marklessStyleExport(text, inputPath, read, 'system').exported, device, fonts, shotDir, { kind: 'scaled' });
// The width the browser lays the page out at: on a Pixel 7 Chrome lays out 412 CSS px, though 1080 px / 2.625 is 411.43.
// The height is the browser's 100vh (Safari's and Chrome's large viewport, toolbars hidden), not its visible height.
const size = { width: fixed.size.width, height: fixed.size.vh };
const at = { viewport: size, dpr: fixed.size.dpr };
const both = { ios: at, android: at };
const atSize = await webColumn(input, marklessStyleExport(text, inputPath, read, 'system', both).exported, device, fonts, undefined, { kind: 'proof', at: both });
writeFileSync(reportPath, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, target: device.target, browser: fixed.browser, size: fixed.size, fixed: { ...summary(fixed.rows), rows: fixed.rows }, atSize: { ...summary(atSize.rows), rows: atSize.rows } }, null, 1)}\n`);
const line = (name: string, rows: readonly WebColumnRow[]): string => {
  const s = summary(rows);
  return `${name}: ${s.failed} of ${s.compared} boxes outside ${GATE_DEVICE_PX} device px, worst ${s.worstDevicePx.toFixed(2)}`;
};
console.log(`${device.target} ${fixed.size.width}x${fixed.size.vh}@${fixed.size.dpr}: ${line('fixed', fixed.rows)}; ${line('at size', atSize.rows)}`);
