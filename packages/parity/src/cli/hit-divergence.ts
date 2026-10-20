// The reviewed known divergences of the hit lane (packages/parity/src/hit-divergence.ts) against the committed captures at every
// device DPR: prints every difference, and exits 1 if there is any without --write; with --write, rewrites the file's points from
// the captures (hit-capture.ts rewrittenDivergence: a case that is new or whose pinned points grow gets 'TODO reason', which
// hit-report.test fails until it is written; one whose points only stay or shrink keeps its reason). A stale or
// missing capture fails either way: recapture first (pnpm run parity:hit-capture).
// Run with: pnpm run parity:hit-divergence [-- --write]
import { writeFileSync } from 'node:fs';
import { committedHitsAt, type ComparedAt, compareHitsAt, divergenceSource, HIT_DIVERGENCE_PATH, hitCases, hitDivergenceDeltas, hitDprCaptures, reasonText, rewrittenFrom, TODO_REASON } from '../hit-capture.ts';
import { HIT_DIVERGENCE } from '../hit-divergence.ts';
import { repoPath } from '../paths.ts';

// pnpm passes the -- before the flags through.
const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.some((a) => a !== '--write')) throw new Error(`parity:hit-divergence takes only --write, not ${args.filter((a) => a !== '--write').join(' ')}`);
const write = args.includes('--write');
const cases = hitCases();
const byId = new Map(cases.map((n) => [n.case.id, n]));
const compared: ComparedAt[] = [];
for (const { dpr, ids } of hitDprCaptures(cases)) {
  for (const id of ids) {
    const n = byId.get(id);
    if (n === undefined) throw new Error(`hitDprCaptures names ${id}, which is not a hit case`);
    compared.push({ case: id, dpr, ...compareHitsAt(n, committedHitsAt(id, dpr), dpr) });
  }
}
const stale = compared.filter((c) => c.stale).map((c) => `${c.case} at DPR ${c.dpr}`);
if (stale.length > 0) throw new Error(`stale captures, run pnpm run parity:hit-capture first: ${stale.join(', ')}`);
const deltas = hitDivergenceDeltas(HIT_DIVERGENCE, compared);
if (deltas.length > 0) console.error(`parity:hit-divergence: ${deltas.length} differences from ${HIT_DIVERGENCE_PATH}:\n  ${deltas.join('\n  ')}`);
if (write) {
  const next = rewrittenFrom(HIT_DIVERGENCE, compared);
  writeFileSync(repoPath(HIT_DIVERGENCE_PATH), divergenceSource(next));
  const todo = next.filter((e) => reasonText(e.reason) === TODO_REASON).map((e) => e.case);
  console.log(`parity:hit-divergence: ${next.length} cases into ${HIT_DIVERGENCE_PATH}; write a reason for ${todo.length === 0 ? 'none' : todo.join(', ')}`);
} else if (deltas.length > 0) {
  process.exit(1);
} else {
  console.log(`parity:hit-divergence: the committed captures diverge exactly where ${HIT_DIVERGENCE_PATH} says (${HIT_DIVERGENCE.length} cases)`);
}
