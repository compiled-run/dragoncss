// GEN-P (T151 R14): Dragon's Skia paint port (packages/layout/src/paint-aa.ts) against Chrome 145's list-marker symbols. Reads the
// crops scripts/capture-gen-probe.ts stored in docs/research/gen-spike/probe/family7-symbol-oracle.json and redraws each one as
// TextFragmentPainter::PaintSymbol does (blink-notes.md "Marker paint"): disc is a filled oval (SkPath::Oval through AntiFillPath),
// circle an oval stroked at 1 device px, square a fill of the pixel-snapped rect. Prints equal/total pixels per symbol, font size
// and DPR, then each planted AaFaults fault per symbol. Without --claim it only reports; --claim=<symbol,...> exits 1 unless every
// crop of each claimed symbol is equal at every pixel (GEN-c's gate). Malformed or incomplete oracle data always exits 1.
// Run with: node --conditions=dragon-internal scripts/check-marker-paint-oracle.ts [--claim=disc,square]
import { readFileSync } from 'node:fs';
import { CHROME_VERSION } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { AaFaults, Device, FRect, IRect } from '../packages/layout/src/paint-aa.ts';
import { antiFillPath, devicePixels, drawRRect, NO_AA_FAULTS, ovalPath, setRectRadii, strokeRRect, whiteDevice } from '../packages/layout/src/paint-aa.ts';
import { DPRS, MARKER_SIZES, ORACLE_FILE, snappedSymbolRect, SYMBOLS } from './capture-gen-probe.ts';
import type { OracleCrop, OracleFile } from './capture-gen-probe.ts';
import { parseProbeArgs } from './probe-common.ts';

type Symbol = (typeof SYMBOLS)[number];
export type CropResult = { readonly id: string; readonly symbol: Symbol; readonly fontSize: number; readonly dpr: number; readonly pixels: number; readonly equal: number; readonly first: string | null };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isQuad = (v: unknown): v is [number, number, number, number] => Array.isArray(v) && v.length === 4 && v.every(isNum);

/** Validates the oracle file and returns its crops; throws on anything missing, extra, inconsistent or malformed. */
export function readOracle(json: unknown): OracleCrop[] {
  const f = json as Partial<OracleFile> | null;
  if (f === null || typeof f !== 'object' || !Array.isArray(f.crops)) throw new Error('oracle: no crops array');
  if (f.chrome !== CHROME_VERSION) throw new Error(`oracle: captured with Chrome ${String(f.chrome)}, not ${CHROME_VERSION}`);
  const want = new Set<string>();
  for (const dpr of DPRS) for (const s of SYMBOLS) for (const size of MARKER_SIZES) want.add(`${s}-${size}-dpr${dpr}`);
  const seen = new Set<string>();
  for (const c of f.crops as unknown[]) {
    const k = c as Partial<OracleCrop>;
    const id = String(k.id);
    if (!want.has(id)) throw new Error(`oracle: unexpected crop ${id}`);
    if (seen.has(id)) throw new Error(`oracle: crop ${id} repeats`);
    seen.add(id);
    if (`${k.symbol}-${k.fontSize}-dpr${k.dpr}` !== id) throw new Error(`oracle ${id}: symbol, fontSize and dpr disagree with the id`);
    if (!isQuad(k.rect) || !isQuad(k.crop) || !Array.isArray(k.fragment) || k.fragment.length !== 2 || !k.fragment.every(isNum) || !isNum(k.tileSize)) throw new Error(`oracle ${id}: malformed geometry`);
    const [fx, fy] = k.fragment as [number, number];
    const rect = snappedSymbolRect(k.fontSize as number, k.dpr as number, fx, fy);
    if (rect.some((v, i) => v !== (k.rect as readonly number[])[i])) throw new Error(`oracle ${id}: stored rect ${k.rect} is not the snapped symbol rect ${rect} of its fragment`);
    const [l, t, r, b] = k.crop;
    if (l !== rect[0] - 2 || t !== rect[1] - 2 || r !== rect[2] + 2 || b !== rect[3] + 2) throw new Error(`oracle ${id}: crop ${k.crop} is not the rect plus 2 device px`);
    if (l < 0 || t < 0 || r > k.tileSize || b > k.tileSize) throw new Error(`oracle ${id}: crop leaves cc tile 0`);
    const rows = k.rows;
    if (!Array.isArray(rows) || rows.length !== b - t || !rows.every((row) => typeof row === 'string' && row.length === 2 * (r - l) && /^[0-9a-f]*$/.test(row))) throw new Error(`oracle ${id}: rows are not ${b - t} hex rows of ${r - l} pixels`);
  }
  const missing = [...want].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`oracle: missing crops ${missing.join(', ')}`);
  return f.crops as OracleCrop[];
}

function chromePixels(c: OracleCrop): number[] {
  const out: number[] = [];
  for (const row of c.rows) for (let i = 0; i < row.length; i += 2) out.push(Number.parseInt(row.slice(i, i + 2), 16));
  return out;
}

/** The crop as Dragon's paint port draws the symbol: PaintSymbol's three branches on a white device. */
export function referencePixels(c: OracleCrop, faults: AaFaults): number[] {
  const [l, t, r, b] = c.crop;
  const dev: Device = whiteDevice({ left: l, top: t, right: r, bottom: b });
  const tile: IRect = { left: 0, top: 0, right: c.tileSize, bottom: c.tileSize };
  const rect: FRect = { left: c.rect[0], top: c.rect[1], right: c.rect[2], bottom: c.rect[3] };
  if (c.symbol === 'disc') antiFillPath(dev, ovalPath(rect), tile, faults);
  else if (c.symbol === 'circle') {
    const half = { x: (rect.right - rect.left) / 2, y: (rect.bottom - rect.top) / 2 };
    strokeRRect(dev, setRectRadii(rect, [half, half, half, half], faults), 1, tile, faults);
  } else drawRRect(dev, setRectRadii(rect, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], faults), tile, faults);
  return devicePixels(dev);
}

export function compareCrop(c: OracleCrop, faults: AaFaults = NO_AA_FAULTS): CropResult {
  const chrome = chromePixels(c);
  const base = { id: c.id, symbol: c.symbol, fontSize: c.fontSize, dpr: c.dpr, pixels: chrome.length };
  let ref: number[];
  try {
    ref = referencePixels(c, faults);
  } catch (e) {
    return { ...base, equal: 0, first: `not drawn: ${(e as Error).message}` };
  }
  const w = c.crop[2] - c.crop[0];
  let equal = 0;
  let first: string | null = null;
  chrome.forEach((v, i) => {
    if (v === ref[i]) equal++;
    else if (first === null) first = `(${c.crop[0] + (i % w)},${c.crop[1] + Math.floor(i / w)}) chrome ${v} dragon ${ref[i]}`;
  });
  return { ...base, equal, first };
}

const PLANTS: readonly (keyof AaFaults)[] = ['supersampleInsteadOfAAA', 'conicNotQuadded', 'edgeFixedPointRounding', 'rrectRadiiUnclamped', 'coverageNotAccumulated'];

function main(): void {
  const args = parseProbeArgs(process.argv.slice(2), [], ['--claim']);
  const claimed = (args.values.get('--claim') ?? '').split(',').filter((s) => s !== '');
  for (const s of claimed) if (!(SYMBOLS as readonly string[]).includes(s)) throw new Error(`--claim: ${s} is not one of ${SYMBOLS.join(', ')}`);
  const crops = readOracle(JSON.parse(readFileSync(repoPath(ORACLE_FILE), 'utf8')));
  const results = crops.map((c) => compareCrop(c));
  for (const r of results) console.log(`${r.symbol} ${r.fontSize}px dpr ${r.dpr}: ${r.equal}/${r.pixels} pixels equal${r.first === null ? '' : `; first ${r.first}`}`);
  const exact = new Map<Symbol, boolean>();
  for (const s of SYMBOLS) {
    const rs = results.filter((r) => r.symbol === s);
    const n = rs.filter((r) => r.equal === r.pixels).length;
    const px = rs.reduce((a, r) => a + r.equal, 0);
    const total = rs.reduce((a, r) => a + r.pixels, 0);
    exact.set(s, n === rs.length);
    console.log(`${s}: ${n}/${rs.length} crops exact, ${px}/${total} pixels equal at channel delta 0`);
  }
  // A plant is caught on a crop the unplanted port draws exactly when the planted port no longer does.
  for (const s of SYMBOLS) {
    const own = crops.filter((c) => c.symbol === s && results.find((r) => r.id === c.id)?.equal === c.rows.length * (c.crop[2] - c.crop[0]));
    const caught = PLANTS.map((p) => {
      const faults: AaFaults = { ...NO_AA_FAULTS, [p]: true };
      const wrong = own.filter((c) => {
        const r = compareCrop(c, faults);
        return r.equal !== r.pixels;
      }).length;
      return `${p} ${wrong}/${own.length}`;
    });
    console.log(`${s} plants caught on its exact crops: ${caught.join(', ')}`);
  }
  const failed = claimed.filter((s) => exact.get(s as Symbol) !== true);
  if (failed.length > 0) {
    console.log(`claimed symbols not exact: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('check-marker-paint-oracle.ts')) main();
