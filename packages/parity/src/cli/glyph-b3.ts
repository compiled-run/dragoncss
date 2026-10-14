// pnpm run parity:glyph-b3 [-- --target ios|android] [-- --before-clearance] [-- --itemise] (T093 ruling A and addendum): the B3
// bucket of the committed device failure lists (out/device-failures-<target>.json). Every device-pixels pixel failure is put in one
// bucket by the sample generator and the engine's glyph boxes: glyph-position (the x centre or bottom edge check), glyph-ink-edge (a
// glyph-edge scanline's edge position), fringe (a compared pixel within SAMPLE_INSET_DEVICE_PX of a glyph box edge, against each
// box separately), clear, or dropped. --before-clearance reads a list from a run before the glyph clearance: a failure whose pixels
// are no longer compared is dropped, and one whose pixel is kept by the pixel-level fallback ("<rule>:clear", addendum F2) is
// restored and bucketed by its clearance. B3 is the fringe bucket; the status passes only when it is empty on every target.
// --itemise prints every dropped and restored failure. Also prints the points each target's corpus drops and rescues.
// --write-bottom-pins writes packages/parity/expected-glyphs/bottom-scanlines.json, the per-case glyph-bottom scanline counts that
// pixel-reference.test.ts pins, and exits.
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { LaneFailure } from '../device-lanes.ts';
import type { B3Reference, Bucket } from '../glyph-b3.ts';
import { b3Bucket, BUCKETS } from '../glyph-b3.ts';
import { BACKEND_OF, nativeCases } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import type { BottomScanlines } from '../pixel-reference.ts';
import { BOTTOM_SCANLINES_PATH, caseSamples, glyphLines } from '../pixel-reference.ts';
import type { NativeTarget } from '../targets.ts';
import type { PinItem } from './glyph-b3-worker.ts';
import { deviceDprs } from '../targets.ts';

const args = process.argv.slice(2);
const targetAt = args.indexOf('--target');
const onlyArg = targetAt < 0 ? null : (args[targetAt + 1] ?? '');
if (onlyArg !== null && onlyArg !== 'ios' && onlyArg !== 'android') {
  console.error(`parity:glyph-b3: --target takes ios or android, not ${JSON.stringify(onlyArg)}`);
  process.exit(2);
}
const only: NativeTarget | null = onlyArg;
const before = args.includes('--before-clearance');
const itemise = args.includes('--itemise');
const log = (s: string): void => console.log(`parity:glyph-b3: ${s}`);

const cases = nativeCases();
if (args.includes('--write-bottom-pins')) {
  // Every (target, DPR, case) item, interleaved over worker threads (glyph-b3-worker.ts) so each gets a like share of the costly
  // shadowed cases; the counts come back in item order.
  const items: { readonly target: NativeTarget; readonly dpr: number; readonly id: string; readonly item: PinItem }[] = [];
  for (const target of ['ios', 'android'] as const) {
    for (const dpr of deviceDprs(target)) for (const c of cases) items.push({ target, dpr, id: c.case.id, item: { program: c.programs[BACKEND_OF[target]], viewport: c.case.environment.viewport, dpr } });
  }
  const n = Math.max(1, Math.min(availableParallelism(), items.length));
  const shares = Array.from({ length: n }, (_, w) => items.filter((_, i) => i % n === w));
  const counted = await Promise.all(shares.map((share) => new Promise<[number, number][]>((resolve, reject) => {
    const w = new Worker(new URL('./glyph-b3-worker.ts', import.meta.url), { workerData: share.map((x) => x.item) });
    let out: [number, number][] | null = null;
    w.once('message', (m: [number, number][]) => (out = m));
    w.once('error', reject);
    w.once('exit', (code) => (code === 0 && out !== null && out.length === share.length ? resolve(out) : reject(new Error(`parity:glyph-b3: a bottom-pin worker exited with ${code}`))));
  })));
  const pins: { [t: string]: { [d: string]: { [c: string]: readonly [number, number] } } } = {};
  items.forEach((x, i) => {
    const count = (counted[i % shares.length] as [number, number][])[Math.floor(i / shares.length)] as [number, number];
    const at = ((pins[x.target] ??= {})[String(x.dpr)] ??= {});
    if (count[1] > 0) at[x.id] = count;
  });
  const text = (p: BottomScanlines): string => `{\n${Object.entries(p).map(([t, ds]) => `  ${JSON.stringify(t)}: {\n${Object.entries(ds).map(([d, cs]) => `    ${JSON.stringify(d)}: {\n${Object.entries(cs).map(([c, n]) => `      ${JSON.stringify(c)}: ${JSON.stringify(n)}`).join(',\n')}\n    }`).join(',\n')}\n  }`).join(',\n')}\n}\n`;
  writeFileSync(BOTTOM_SCANLINES_PATH(), text(pins));
  log(`wrote ${BOTTOM_SCANLINES_PATH()}`);
  process.exit(0);
}
let fringeTotal = 0;
for (const target of (['ios', 'android'] as const).filter((t) => only === null || t === only)) {
  const reference = new Map<string, B3Reference>();
  const dropped: Record<string, number> = {};
  const rescued: Record<string, number> = {};
  for (const dpr of deviceDprs(target)) {
    let n = 0;
    let r = 0;
    for (const c of cases) {
      const p = c.programs[BACKEND_OF[target]];
      const s = caseSamples(p, c.case.environment.viewport, dpr);
      n += s.dropped.length;
      r += s.rescued.length;
      const run = before ? caseSamples(p, c.case.environment.viewport, dpr, false).points : s.points;
      reference.set(`${c.case.id}@${dpr}`, { points: s.points, run, glyphs: glyphLines(p, c.case.environment.viewport, dpr).flatMap((l) => l.glyphs) });
    }
    dropped[String(dpr)] = n;
    rescued[String(dpr)] = r;
  }
  log(`${target}: rules dropped by the glyph clearance per DPR ${JSON.stringify(dropped)}; of those, kept pixel by pixel ${JSON.stringify(rescued)}`);

  const failures = JSON.parse(readFileSync(repoPath(`packages/parity/out/device-failures-${target}.json`), 'utf8')) as LaneFailure[];
  const counts: Record<Bucket, number> = { 'glyph-position': 0, 'glyph-ink-edge': 0, dropped: 0, fringe: 0, clear: 0 };
  const named: string[] = [];
  let pixel = 0;
  for (const f of failures) {
    if (f.lane !== 'device-pixels' || f.kind !== 'pixel') continue;
    pixel++;
    const ref = reference.get(`${f.case}@${f.dpr}`);
    if (ref === undefined) throw new Error(`${f.case}@${f.dpr} is not a case of the ${target} corpus`);
    const { bucket, restored } = b3Bucket(f, ref, before);
    counts[bucket]++;
    if ((bucket !== 'clear' && bucket !== 'dropped') || (itemise && (bucket === 'dropped' || restored))) named.push(`${bucket}${restored ? ' (restored)' : ''} ${f.case}@${f.dpr} ${f.detail}`);
  }
  fringeTotal += counts.fringe;
  log(`${target}: ${pixel} device-pixels pixel failures: ${BUCKETS.map((b) => `${b} ${counts[b]}`).join(', ')}; B3 (fringe) ${counts.fringe}`);
  for (const l of named) log(`${target}: ${l}`);
}
log(`status ${fringeTotal === 0 ? 'pass' : 'fail'} (B3 fringe ${fringeTotal})`);
process.exit(fringeTotal === 0 ? 0 : 1);
