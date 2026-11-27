// Writes the DPR vectors of every milestone-1 layout case at DPR 2, 3 and 2.625 (the Android extra): packages/layout/vectors/dpr-<N>/
// <case>.json in the four-key vector format, and the snap vectors packages/layout/vectors/dpr-<N>/snap/<case>.json (the engine rects
// and their snapped device-px edges, vectors/README.md). Each case must pass the DPR lane against its committed DPR capture with
// every node exact in zoomed LU; a failing case stops the run. No browser runs and nothing at DPR 1 is touched. A shaped case
// (text-latin-run.ts) writes its vector with the shape transcript to packages/layout/vectors/text-latin/dpr-<N>/ instead, and no
// snap vector.
// Run with: pnpm run layout:dpr-vectors
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isShapedInput, textLatinVector, textLatinVectorDir, textLatinVectorPath, textLatinVectorText } from '../text-latin-run.ts';
import { DPRS, dprSnapDir, dprSnapPath, dprVectorDir, dprVectorPath, dprVectorText, eachDprOutcome, EXTRA_DPRS, snapVectorText } from '../dpr.ts';
import { repoPath } from '../paths.ts';
import { profilePending } from '../profile-pending.ts';

// A case waiting on its iOS support-profile rows (profile-pending.ts) writes no vector this round; any other refusal or a failing
// case still stops the run.
const pending = new Set<string>();
// A fixture at a time, its compile dropped after its cases and their vectors staged: keeping every fixture's compile (the pending
// check's enforcedCompile cache) and every outcome for the whole run outgrew the regen's 2 GB heap.
const staging = repoPath('node_modules/.cache/dpr-vectors-staging');
rmSync(staging, { recursive: true, force: true });
const stage = (target: string, text: string): void => {
  const path = join(staging, relative(repoPath('.'), target));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const problems: string[] = [];
let shaped = 0;
const counts = new Map<number, number>(DPRS.map((dpr) => [dpr, 0]));
eachDprOutcome(DPRS, (o, compiled) => {
  if (profilePending(compiled)) {
    if (!pending.has(o.id)) console.log(`layout:dpr-vectors: ${o.id} waits on its iOS support-profile rows; no DPR vector this round`);
    pending.add(o.id);
    return;
  }
  const dpr = o.dpr;
  counts.set(dpr, (counts.get(dpr) as number) + 1);
  const v = o.vector;
  if (o.status !== 'pass' || v === null || o.exact !== o.nodes) {
    problems.push(`${o.id} @${dpr}: ${o.reason ?? 'not exact'}`);
    return;
  }
  if (isShapedInput(v.input)) {
    stage(textLatinVectorPath(o.id, dpr), textLatinVectorText(textLatinVector(v.input)));
    shaped++;
    return;
  }
  stage(dprVectorPath(o.id, dpr), dprVectorText(v));
  stage(dprSnapPath(o.id, dpr), snapVectorText(dpr, v.output));
});
const done = DPRS.map((dpr) => ({ dpr, vectors: counts.get(dpr) as number }));
if (problems.length > 0) {
  rmSync(staging, { recursive: true, force: true });
  console.log(`layout:dpr-vectors: ${problems.length} DPR cases do not pass exactly; nothing written:\n  ${problems.join('\n  ').slice(0, 4000)}`);
  process.exit(1);
}
for (const { dpr, vectors } of done) {
  for (const dir of [dprVectorDir(dpr), dprSnapDir(dpr), textLatinVectorDir(dpr)]) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
    const from = join(staging, relative(repoPath('.'), dir));
    if (!existsSync(from)) continue;
    for (const f of readdirSync(from, { withFileTypes: true }).filter((e) => e.isFile())) renameSync(join(from, f.name), join(dir, f.name));
  }
  const extra = EXTRA_DPRS.find((e) => e.dpr === dpr);
  console.log(`DPR ${dpr}${extra === undefined ? '' : ` (${extra.platform} extra ${extra.name})`}: ${vectors} vectors (shaped ones under text-latin) -> packages/layout/vectors/dpr-${dpr}`);
}
rmSync(staging, { recursive: true, force: true });
console.log(`layout:dpr-vectors: ${done.reduce((n, d) => n + d.vectors, 0)} DPR vectors at DPR ${DPRS.join(', ')}, ${shaped} of them shaped (packages/layout/vectors/text-latin)`);
