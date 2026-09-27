// pnpm run native:swift and pnpm run native:kotlin: the committed generated engine against the P1 corpus (the milestone-1 vectors
// and the units, engine and library corpora) and the extended corpus (P2b vectors, DPR vectors, engine-dpr, units-m2 and snap).
import { LOCK, lockedDigest, runTarget, staleFiles, committedFiles } from '../check.ts';
import type { Target } from '../check.ts';
import { buildCorpus } from '../corpus.ts';
import { buildExtendedCorpus, EXTENDED_LOCK, extendedLockedDigest } from '../corpus-dpr.ts';
import { lowerAll } from '../generate.ts';
import { describe, writeReport } from '../native.ts';

const target = process.argv[2] as Target;
if (target !== 'swift' && target !== 'kotlin') throw new Error('usage: native.ts swift|kotlin');
const l = lowerAll();
const stale = staleFiles(target, l);
if (stale.length > 0) {
  console.log(`native:${target}: generated files are stale or hand-edited (run pnpm run native:gen):\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
const c = buildCorpus();
if (lockedDigest() !== c.digest) {
  console.log(`native:${target}: corpus digest ${c.digest} differs from ${LOCK} (run pnpm run native:gen)`);
  process.exit(1);
}
const x = buildExtendedCorpus();
if (extendedLockedDigest() !== x.digest) {
  console.log(`native:${target}: extended corpus digest ${x.digest} differs from ${EXTENDED_LOCK} (run pnpm run native:gen)`);
  process.exit(1);
}
const r = runTarget(target, c, committedFiles(target), target);
writeReport(r, c);
console.log(describe(r, c));
const rx = runTarget(target, x, committedFiles(target), `${target}-extended`);
writeReport(rx, x, 'extended');
console.log(`extended corpus:\n${describe(rx, x)}`);
const status = r.status === 'pass' && rx.status === 'pass' ? 'pass' : r.status === 'blocked (owner tooling)' || rx.status === 'blocked (owner tooling)' ? 'blocked (owner tooling)' : 'fail';
console.log(`native:${target}: P1 corpus digest ${c.digest}; extended corpus digest ${x.digest}; status ${status}`);
if (status === 'fail') process.exitCode = 1;
