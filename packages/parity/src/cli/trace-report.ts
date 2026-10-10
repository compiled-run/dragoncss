// The host trace lane (SELD-R2 R14): the TypeScript interaction runtime against Chrome's effective trace (R2) at every step of every
// interaction group's committed capture. A gated mismatch, a style check difference, or a missing or stale capture fails; touch
// :active and keyboard steps are recorded and counted, not gated. The first of each are printed.
// Run with: pnpm run parity:trace-report
import { committedTraces, compareTraces, mismatchText, traceGroups } from '../trace-capture.ts';

const FIRST = 40;
let steps = 0;
const problems: string[] = [];
const failing: string[] = [];
const recorded: string[] = [];
const groups = traceGroups();
for (const g of groups) {
  try {
    const r = compareTraces(g, committedTraces(g.id));
    steps += r.steps;
    problems.push(...r.problems);
    for (const m of r.mismatches) (m.gated ? failing : recorded).push(mismatchText(m));
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
}
for (const p of problems.slice(0, FIRST)) console.log(`problem: ${p}`);
for (const m of failing.slice(0, FIRST)) console.log(`mismatch: ${m}`);
for (const m of recorded.slice(0, FIRST)) console.log(`recorded (not gated): ${m}`);
const failed = problems.length + failing.length;
console.log(`parity:trace-report: ${groups.length} groups, ${steps} steps; mismatches ${failing.length}, recorded ${recorded.length}, problems ${problems.length}; failed ${failed}`);
if (failed > 0) process.exitCode = 1;
