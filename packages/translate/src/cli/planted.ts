// pnpm run native:planted -- --target swift|kotlin: every planted translator fault (EXTENDED_FAULTS: the P1 faults and
// snap-truncating-division) must fail at least one case of the P1 corpus or the extended corpus.
import { expectedFiles, runTarget } from '../check.ts';
import type { Target } from '../check.ts';
import { buildCorpus } from '../corpus.ts';
import { buildExtendedCorpus } from '../corpus-dpr.ts';
import { EXTENDED_FAULTS } from '../faults.ts';
import { lowerAll } from '../generate.ts';
import { failures } from '../native.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const i = args.indexOf('--target');
const target = (i >= 0 ? args[i + 1] : undefined) as Target | undefined;
if (target !== 'swift' && target !== 'kotlin') throw new Error('usage: planted.ts --target swift|kotlin');
const l = lowerAll();
const corpora = [buildCorpus(), buildExtendedCorpus()];
let caught = 0;
let blocked = false;
for (const f of EXTENDED_FAULTS) {
  const files = expectedFiles(target, l, f.id);
  let n = 0;
  const per: string[] = [];
  for (const [k, c] of corpora.entries()) {
    const r = runTarget(target, c, files, `planted-${target}-${f.id}${k === 0 ? '' : '-extended'}`);
    if (r.status === 'blocked (owner tooling)') {
      console.log(`native:planted ${target}: blocked (owner tooling): ${r.reason ?? ''}`);
      blocked = true;
      break;
    }
    n += failures(r.suites);
    per.push(...r.suites.map((s) => `${s.name} ${s.total - s.pass}${s.cause === null ? '' : ` [${s.cause}]`}`));
  }
  if (blocked) break;
  console.log(`${n > 0 ? 'caught' : 'MISSED'} ${f.id} (${target === 'swift' ? f.swift : f.kotlin}): ${n} failing cases (${per.join(', ')})`);
  if (n > 0) caught++;
}
if (!blocked) {
  console.log(`native:planted ${target}: ${caught}/${EXTENDED_FAULTS.length} planted faults fail at least one case`);
  if (caught !== EXTENDED_FAULTS.length) process.exitCode = 1;
}
