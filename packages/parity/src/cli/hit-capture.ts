// Regenerates packages/parity/expected-hit/<case>.hit.json from live Chrome: document.elementFromPoint at every point of each
// layout case's derived hit grid, on its authored rendering (SELD-R1b). Files of cases that no longer exist are removed.
// Run with: pnpm run parity:hit-capture
// pnpm run parity:hit-capture -- --identity-base <rev> instead writes expected-hit/identity-base.json: the sha256 of every capture
// and emitted file of <rev> with the pointer-events key removed, which hit-capture-identity.test.ts holds the outputs to.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { launchChrome } from '../chrome.ts';
import { captureHits, expectedHitDir, expectedHitPath, hitCaptureJson, hitCases, IDENTITY_MANIFEST, IDENTITY_ROOTS, withoutPointerEvents } from '../hit-capture.ts';
import { hitFacts } from 'dragon';
import { repoPath } from '../paths.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';

const git = (args: readonly string[]): string => {
  const r = spawnSync('git', args, { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
// pnpm run parity:hit-capture -- --vectors writes packages/layout/rt-vectors/hit/facts.json instead: every layout case's hit facts,
// which the P1 corpus hit suite pairs with the layout vectors (no Chrome).
if (process.argv.includes('--vectors')) {
  const cases: Record<string, (string | boolean)[][]> = {};
  for (const n of hitCases()) {
    const facts = hitFacts(n.compiled, n.case.assignment);
    if (facts === null) throw new Error(`${n.case.id}: no hit facts`);
    cases[n.case.id] = [...facts].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([id, f]) => [id, f.pointerEvents, f.inherited, f.activation]);
  }
  mkdirSync(repoPath('packages/layout/rt-vectors/hit'), { recursive: true });
  writeFileSync(repoPath('packages/layout/rt-vectors/hit/facts.json'), `{\n  "cases": {\n${Object.entries(cases).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n  }\n}\n`);
  console.log(`parity:hit-capture: hit facts of ${Object.keys(cases).length} cases into packages/layout/rt-vectors/hit/facts.json`);
  process.exit(0);
}
const at = process.argv.indexOf('--identity-base');
if (at >= 0) {
  const rev = process.argv[at + 1];
  if (rev === undefined || rev.startsWith('--')) throw new Error('--identity-base needs a revision');
  const sha = git(['rev-parse', '--verify', `${rev}^{commit}`]).trim();
  const paths = git(['ls-tree', '-r', '--name-only', sha, '--', ...IDENTITY_ROOTS]).split('\n').filter((p) => p.endsWith('.json') || p.endsWith('.css')).sort();
  if (paths.length === 0) throw new Error(`${sha} holds no captures or emitted files under ${IDENTITY_ROOTS.join(', ')}`);
  const files: Record<string, string> = {};
  for (const p of paths) files[p] = createHash('sha256').update(withoutPointerEvents(p, git(['cat-file', 'blob', `${sha}:${p}`])), 'utf8').digest('hex');
  mkdirSync(expectedHitDir(), { recursive: true });
  writeFileSync(repoPath(IDENTITY_MANIFEST), `${JSON.stringify({ base: sha, files }, null, 2)}\n`);
  console.log(`parity:hit-capture: ${paths.length} base files of ${sha} into ${IDENTITY_MANIFEST}`);
  process.exit(0);
}

requireReferencePlatform(hostPlatform());
const dir = expectedHitDir();
mkdirSync(dir, { recursive: true });
const cases = hitCases();
const keep = new Set(cases.map((n) => expectedHitPath(n.case.id).slice(dir.length + 1)));
for (const f of readdirSync(dir)) if (f.endsWith('.hit.json') && !keep.has(f)) rmSync(`${dir}/${f}`);
const browser = await launchChrome();
let points = 0;
try {
  for (const n of cases) {
    const c = await captureHits(browser, n);
    points += c.points;
    writeFileSync(expectedHitPath(n.case.id), hitCaptureJson(c));
  }
} finally {
  await browser.close();
}
console.log(`parity:hit-capture: ${cases.length} cases, ${points} points into packages/parity/expected-hit`);
