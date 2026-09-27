// pnpm run native:swift and pnpm run native:kotlin: the committed generated engine against the vectors and both corpora.
import { LOCK, lockedDigest, runTarget, staleFiles, committedFiles } from '../check.ts';
import type { Target } from '../check.ts';
import { buildCorpus } from '../corpus.ts';
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
const r = runTarget(target, c, committedFiles(target), target);
writeReport(r, c);
console.log(describe(r, c));
if (r.status === 'fail') process.exitCode = 1;
