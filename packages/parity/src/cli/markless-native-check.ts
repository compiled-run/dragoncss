// pnpm run markless:native-check -- <native-style-input.json> <layout-dump.json> <report.json> (--ios <udid> | --android <serial>):
// the boxes a phone drew for a Markless page (a host's layout dump: one assignment's boxes in points or dp from the page's top left)
// against the boxes that phone's own browser lays the same page out at, at the same width. Exits 1 when a box is outside the gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GATE_DEVICE_PX } from '../compare.ts';
import { marklessFontFiles, marklessStyleExport, parseMarklessStyleInput } from '../markless-style-input.ts';
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
if (rest.length !== 3 || (ios === undefined) === (android === undefined) || ios === '' || android === '') {
  console.error('usage: pnpm run markless:native-check -- <native-style-input.json> <layout-dump.json> <report.json> (--ios <udid> | --android <serial>)');
  process.exit(2);
}
const caller = (a: string): string => resolve(process.env['INIT_CWD'] ?? process.cwd(), a);
const [inputPath, dumpPath, reportPath] = rest.map(caller) as [string, string, string];
const text = readFileSync(inputPath, 'utf8');
const input = parseMarklessStyleInput(text);
const read = (file: string): Uint8Array => readFileSync(resolve(dirname(inputPath), file));
const device: WebColumnDevice = ios !== undefined ? { target: 'ios', udid: ios } : { target: 'android', serial: android as string };

type Dump = { readonly viewport: { readonly width: number; readonly height: number }; readonly scale: number; readonly assignment: number; readonly nodes: readonly (readonly [string, number, number, number, number])[] };
const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as Dump;
const okNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
if (!okNumber(dump.scale) || !okNumber(dump.assignment) || !okNumber(dump.viewport?.width) || !okNumber(dump.viewport?.height) || !Array.isArray(dump.nodes)) throw new Error(`${dumpPath}: not a layout dump`);
const boxes = new Map(dump.nodes.map((n) => {
  if (!Array.isArray(n) || n.length !== 5 || typeof n[0] !== 'string' || !n.slice(1).every(okNumber)) throw new Error(`${dumpPath}: ${JSON.stringify(n)} is not [id, x, y, width, height]`);
  return [n[0], { x: n[1], y: n[2], width: n[3], height: n[4] }] as const;
}));
const exported = marklessStyleExport(text, inputPath, read, 'system').exported;
const report = await webColumn(input, exported, device, marklessFontFiles(input, read), undefined, { kind: 'native', layout: { assignment: dump.assignment, viewport: dump.viewport, scale: dump.scale, boxes } });
if (Math.abs(report.size.dpr - dump.scale) > 1e-6) throw new Error(`the browser draws at ${report.size.dpr}x, the phone at ${dump.scale}x`);
if (Math.abs(report.size.width - dump.viewport.width) > 1e-6) throw new Error(`the browser lays the page out ${report.size.width} CSS px wide, the phone ${dump.viewport.width}`);
writeFileSync(reportPath, `${JSON.stringify({ gateDevicePx: GATE_DEVICE_PX, target: device.target, browser: report.browser, size: report.size, phone: { viewport: dump.viewport, scale: dump.scale, assignment: dump.assignment }, compared: report.compared, failed: report.failed, rows: report.rows }, null, 1)}\n`);
const worst = report.rows.reduce((m, r) => Math.max(m, r.maxDeltaDevicePx), 0);
console.log(`${device.target} ${report.size.width}x${report.size.vh}@${report.size.dpr} assignment ${dump.assignment}: ${report.failed} of ${report.compared} boxes outside ${GATE_DEVICE_PX} device px, worst ${worst.toFixed(2)}`);
if (report.failed > 0 || report.compared === 0) process.exit(1);
