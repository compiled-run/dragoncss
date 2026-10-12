// Runs the G-P differential test and prints a summary: matches, mismatches and refusals by reason.
// Run with: node --conditions=dragon-internal packages/parity/src/cli/grid-corpus.ts [--family=<name>] [--case=<id>] [--show=<n>]
import { NO_GRID_FAULTS } from '@dragon/layout';
import type { CaseOutcome } from '../grid-corpus.ts';
import { classifyOutcome, readGridCorpus, runGridCase } from '../grid-corpus.ts';

const unknownArgs = process.argv.slice(2).filter((a) => !/^--(family|case|show)=/.test(a));
if (unknownArgs.length > 0) throw new Error(`unknown arguments ${unknownArgs.join(' ')}: expected --family=<name>, --case=<id>, --show=<n>`);
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
let known = 0;
let mismatch = 0;
let refused = 0;
const reasons = new Map<string, number>();
const problems: string[] = [];
for (const o of outcomes) {
  for (const [env, r] of o.envs) {
    const k = classifyOutcome(`${o.family}/${o.id} ${env}`, r);
    if (r.kind === 'match') match++;
    else if (r.kind === 'mismatch') {
      if (k.kind === 'known') known++;
      else mismatch++;
    } else {
      refused++;
      for (const reason of r.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    if (k.kind === 'problem') problems.push(k.detail);
  }
}
console.log(`${cases.length} cases: ${match} environments match, ${known} pinned mismatches, ${mismatch} other mismatches, ${refused} refused`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, show)) console.log(`  refused ${n}: ${r}`);
for (const f of problems.slice(0, show)) console.log(`  PROBLEM ${f}`);
// A problem is an unpinned or changed mismatch, a pinned mismatch that now matches, or a refusal no out-of-scope package owns.
process.exitCode = problems.length === 0 ? 0 : 1;
