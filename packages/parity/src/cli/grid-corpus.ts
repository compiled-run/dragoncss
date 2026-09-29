// Runs the G-P differential test and prints a summary: matches, mismatches and refusals by reason.
// Run with: node --conditions=dragon-internal packages/parity/src/cli/grid-corpus.ts [--family=<name>] [--case=<id>] [--show=<n>]
import { NO_GRID_FAULTS } from '@dragon/layout';
import type { CaseOutcome } from '../grid-corpus.ts';
import { readGridCorpus, runGridCase } from '../grid-corpus.ts';

const arg = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a === undefined ? null : a.slice(name.length + 3);
};
const family = arg('family');
const only = arg('case');
const show = Number(arg('show') ?? '20');
if (!Number.isInteger(show) || show < 0) throw new Error('--show takes a non-negative integer');

const cases = readGridCorpus().filter((c) => (family === null || c.family === family) && (only === null || c.id === only));
if (cases.length === 0) throw new Error('no corpus case matches');
const outcomes: CaseOutcome[] = cases.map((c) => runGridCase(c, NO_GRID_FAULTS));
let match = 0;
let mismatch = 0;
let refused = 0;
const reasons = new Map<string, number>();
const failures: string[] = [];
for (const o of outcomes) {
  for (const [env, r] of o.envs) {
    if (r.kind === 'match') match++;
    else if (r.kind === 'mismatch') {
      mismatch++;
      failures.push(`${o.family}/${o.id} ${env}: ${r.detail}`);
    } else {
      refused++;
      reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    }
  }
}
console.log(`${cases.length} cases: ${match} environments match, ${mismatch} mismatch, ${refused} refused`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, show)) console.log(`  refused ${n}: ${r}`);
for (const f of failures.slice(0, show)) console.log(`  MISMATCH ${f}`);
process.exitCode = mismatch === 0 ? 0 : 1;
