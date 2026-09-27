// Writes the DPR vectors of every milestone-1 layout case at DPR 2, 3 and 2.625 (the Android extra): packages/layout/vectors/dpr-<N>/
// <case>.json in the four-key vector format, and the snap vectors packages/layout/vectors/dpr-<N>/snap/<case>.json (the engine rects
// and their snapped device-px edges, vectors/README.md). Each case must pass the DPR lane against its committed DPR capture with
// every node exact in zoomed LU; a failing case stops the run. No browser runs and nothing at DPR 1 is touched.
// Run with: pnpm run layout:dpr-vectors
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DPRS, dprSnapDir, dprSnapPath, dprVectorDir, dprVectorPath, dprVectorText, EXTRA_DPRS, runDprLane, snapVectorText } from '../dpr.ts';

const lane = runDprLane();
const problems: string[] = [];
for (const s of lane) {
  for (const o of s.outcomes) if (o.status !== 'pass' || o.vector === null || o.exact !== o.nodes) problems.push(`${o.id} @${o.dpr}: ${o.reason ?? 'not exact'}`);
}
if (problems.length > 0) {
  console.log(`layout:dpr-vectors: ${problems.length} DPR cases do not pass exactly; nothing written:\n  ${problems.join('\n  ').slice(0, 4000)}`);
  process.exit(1);
}
for (const s of lane) {
  for (const dir of [dprVectorDir(s.dpr), dprSnapDir(s.dpr)]) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
  }
  for (const o of s.outcomes) {
    const v = o.vector;
    if (v === null) throw new Error(`${o.id} @${o.dpr} has no vector`);
    writeFileSync(dprVectorPath(o.id, s.dpr), dprVectorText(v));
    writeFileSync(dprSnapPath(o.id, s.dpr), snapVectorText(s.dpr, v.output));
  }
  const extra = EXTRA_DPRS.find((e) => e.dpr === s.dpr);
  console.log(`DPR ${s.dpr}${extra === undefined ? '' : ` (${extra.platform} extra ${extra.name})`}: ${s.outcomes.length} vectors and ${s.outcomes.length} snap vectors -> packages/layout/vectors/dpr-${s.dpr}`);
}
console.log(`layout:dpr-vectors: ${lane.reduce((n, s) => n + s.outcomes.length, 0)} DPR vectors and as many snap vectors at DPR ${DPRS.join(', ')}`);
