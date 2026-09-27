// pnpm run native:planted -- --target swift|kotlin: every planted translator fault must fail at least one case.
import { expectedFiles, runTarget } from '../check.ts';
import type { Target } from '../check.ts';
import { buildCorpus } from '../corpus.ts';
import { FAULTS } from '../faults.ts';
import { lowerAll } from '../generate.ts';
import { failures } from '../native.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const i = args.indexOf('--target');
const target = (i >= 0 ? args[i + 1] : undefined) as Target | undefined;
if (target !== 'swift' && target !== 'kotlin') throw new Error('usage: planted.ts --target swift|kotlin');
const l = lowerAll();
const c = buildCorpus();
let caught = 0;
let blocked = false;
for (const f of FAULTS) {
  const r = runTarget(target, c, expectedFiles(target, l, f.id), `planted-${target}-${f.id}`);
  if (r.status === 'blocked (owner tooling)') {
    console.log(`native:planted ${target}: blocked (owner tooling): ${r.reason ?? ''}`);
    blocked = true;
    break;
  }
  const n = failures(r.suites);
  const per = r.suites.map((s) => `${s.name} ${s.total - s.pass}`).join(', ');
  console.log(`${n > 0 ? 'caught' : 'MISSED'} ${f.id} (${target === 'swift' ? f.swift : f.kotlin}): ${n} failing cases (${per})`);
  if (n > 0) caught++;
}
if (!blocked) {
  console.log(`native:planted ${target}: ${caught}/${FAULTS.length} planted faults fail at least one case`);
  if (caught !== FAULTS.length) process.exitCode = 1;
}
