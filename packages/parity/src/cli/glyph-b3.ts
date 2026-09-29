// pnpm run parity:glyph-b3 [-- --target ios|android] [-- --before-clearance] (T093 ruling A): the B3 bucket of the committed device
// failure lists (out/device-failures-<target>.json). Every device-pixels pixel failure is put in one bucket by the sample generator
// and the engine's glyph boxes: glyph-centre (the centre check), glyph-ink-edge (a glyph-edge scanline's edge position), fringe (a
// compared pixel within SAMPLE_INSET_DEVICE_PX of a glyph box edge, against each box separately), clear, or dropped (only with
// --before-clearance, which reads a list from a run before the glyph clearance: its pixels are no longer compared). B3 is the fringe
// bucket; the status passes only when it is empty on every target. Also prints the points each target's corpus drops.
import { readFileSync } from 'node:fs';
import type { LaneFailure } from '../device-lanes.ts';
import { BACKEND_OF, nativeCases } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import { caseSamples, glyphLines } from '../pixel-reference.ts';
import type { GlyphBox, SamplePoint } from '../samples.ts';
import { GLYPH_EDGE_RULE, glyphClearance, SAMPLE_INSET_DEVICE_PX } from '../samples.ts';
import type { NativeTarget } from '../targets.ts';
import { deviceDprs } from '../targets.ts';

const args = process.argv.slice(2);
const only = args.includes('--target') ? (args[args.indexOf('--target') + 1] as NativeTarget) : null;
const before = args.includes('--before-clearance');
const log = (s: string): void => console.log(`parity:glyph-b3: ${s}`);
const BUCKETS = ['glyph-centre', 'glyph-ink-edge', 'dropped', 'fringe', 'clear'] as const;
type Bucket = (typeof BUCKETS)[number];

const cases = nativeCases();
let fringeTotal = 0;
for (const target of (['ios', 'android'] as const).filter((t) => only === null || t === only)) {
  const reference = new Map<string, { points: readonly SamplePoint[]; run: readonly SamplePoint[]; glyphs: readonly GlyphBox[] }>();
  const dropped: Record<string, number> = {};
  for (const dpr of deviceDprs(target)) {
    let n = 0;
    for (const c of cases) {
      const p = c.programs[BACKEND_OF[target]];
      const s = caseSamples(p, c.case.environment.viewport, dpr);
      n += s.dropped.length;
      const run = before ? caseSamples(p, c.case.environment.viewport, dpr, false).points : s.points;
      reference.set(`${c.case.id}@${dpr}`, { points: s.points, run, glyphs: glyphLines(p, c.case.environment.viewport, dpr).flatMap((l) => l.glyphs) });
    }
    dropped[String(dpr)] = n;
  }
  log(`${target}: points dropped by the glyph clearance per DPR ${JSON.stringify(dropped)}`);

  const failures = JSON.parse(readFileSync(repoPath(`packages/parity/out/device-failures-${target}.json`), 'utf8')) as LaneFailure[];
  const counts: Record<Bucket, number> = { 'glyph-centre': 0, 'glyph-ink-edge': 0, dropped: 0, fringe: 0, clear: 0 };
  const named: string[] = [];
  let pixel = 0;
  for (const f of failures) {
    if (f.lane !== 'device-pixels' || f.kind !== 'pixel' || f.node === null) continue;
    pixel++;
    const ref = reference.get(`${f.case}@${f.dpr}`);
    if (ref === undefined) throw new Error(`${f.case}@${f.dpr} is not a case of the ${target} corpus`);
    const at = / at (\d+),(\d+):/.exec(f.detail);
    // The pixels the check compares: a glyph-edge scanline Chrome shows no edge across is compared by colour at its two ends only.
    // A run before the clearance compared every pixel of such a scanline.
    const comparedOf = (ps: readonly SamplePoint[], endsOnly: boolean): SamplePoint[] => {
      const line = ps.filter((p) => p.rule === f.node);
      const ends = endsOnly && GLYPH_EDGE_RULE.test(f.node ?? '') && at !== null ? [line[0], line[line.length - 1]].filter((p): p is SamplePoint => p !== undefined) : line;
      return at === null ? ends : ends.filter((p) => p.x === Number(at[1]) && p.y === Number(at[2]));
    };
    const failed = comparedOf(ref.run, !before);
    const now = comparedOf(ref.points, true);
    const key = (ps: readonly SamplePoint[]): string => ps.map((p) => `${p.x},${p.y}`).join(';');
    let bucket: Bucket;
    if (f.node.startsWith('centre:')) bucket = 'glyph-centre';
    else if (failed.length === 0) throw new Error(`${target} ${f.case}@${f.dpr} ${f.node}: the failure names no generated point${before ? '' : '; a list from before the glyph clearance needs --before-clearance'}`);
    else if (key(failed) !== key(now)) bucket = 'dropped';
    else if (at === null && GLYPH_EDGE_RULE.test(f.node)) bucket = 'glyph-ink-edge';
    else bucket = Math.min(...failed.flatMap((p) => ref.glyphs.map((g) => glyphClearance(p.x, p.y, g)))) < SAMPLE_INSET_DEVICE_PX ? 'fringe' : 'clear';
    counts[bucket]++;
    if (process.env.B3_ALL === '1' || (bucket !== 'clear' && bucket !== 'dropped')) named.push(`${bucket} ${f.case}@${f.dpr} ${f.detail}`);
  }
  fringeTotal += counts.fringe;
  log(`${target}: ${pixel} device-pixels pixel failures: ${BUCKETS.map((b) => `${b} ${counts[b]}`).join(', ')}; B3 (fringe) ${counts.fringe}`);
  for (const l of named) log(`${target}: ${l}`);
}
log(`status ${fringeTotal === 0 ? 'pass' : 'fail'} (B3 fringe ${fringeTotal})`);
process.exit(fringeTotal === 0 ? 0 : 1);
