// The host hit lane (SELD-R1b): the TypeScript hit test over the engine's boxes against Chrome's elementFromPoint at every point
// of every layout case's committed capture. Any mismatch, missing or stale capture fails; the first mismatches are printed.
// Run with: pnpm run parity:hit-report
import { committedHits, compareHits, hitCases } from '../hit-capture.ts';

const FIRST = 40;
let points = 0;
const problems: string[] = [];
const mismatches: string[] = [];
const cases = hitCases();
for (const n of cases) {
  try {
    const r = compareHits(n, committedHits(n.case.id));
    points += r.points;
    if (r.stale) problems.push(`${n.case.id}: the capture's grid is not the grid the hit table derives now; run pnpm run parity:hit-capture`);
    for (const m of r.mismatches) mismatches.push(`${m.case} (${m.x / 64}, ${m.y / 64}): Chrome ${m.chrome}, Dragon ${m.dragon}`);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
}
for (const p of problems.slice(0, FIRST)) console.log(`problem: ${p}`);
for (const m of mismatches.slice(0, FIRST)) console.log(`mismatch: ${m}`);
const failed = problems.length + mismatches.length;
console.log(`parity:hit-report: ${cases.length} cases, ${points} points; mismatches ${mismatches.length}, problems ${problems.length}; failed ${failed}`);
if (failed > 0) process.exitCode = 1;
