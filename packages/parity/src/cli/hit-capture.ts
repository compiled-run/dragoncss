// Regenerates packages/parity/expected-hit/<case>.hit.json from live Chrome: document.elementFromPoint at every point of each
// layout case's derived hit grid, on its authored rendering (SELD-R1b). Files of cases that no longer exist are removed.
// Run with: pnpm run parity:hit-capture
// pnpm run parity:hit-capture -- --identity-base <rev> instead writes expected-hit/identity-base.json: the sha256 of every capture
// and emitted file of <rev> with the pointer-events key removed, which hit-capture-identity.test.ts holds the outputs to.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { launchChrome } from '../chrome.ts';
import { captureHits, expectedHitDir, expectedHitPath, HIT_FACTS_PATH, hitCaptureJson, hitCases, hitFactsJson, IDENTITY_MANIFEST, IDENTITY_ROOTS, parseHitCaptureArgs, withoutPointerEvents } from '../hit-capture.ts';
import { repoPath } from '../paths.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';

const git = (args: readonly string[]): string => {
  const r = spawnSync('git', args, { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};
// pnpm run parity:hit-capture -- --vectors writes packages/layout/rt-vectors/hit/facts.json instead: every layout case's hit facts,
// which the P1 corpus hit suite pairs with the layout vectors (no Chrome).
const args = parseHitCaptureArgs(process.argv.slice(2));
if (args.mode === 'vectors') {
  const cases = hitCases();
  mkdirSync(repoPath('packages/layout/rt-vectors/hit'), { recursive: true });
  writeFileSync(repoPath(HIT_FACTS_PATH), hitFactsJson(cases));
  console.log(`parity:hit-capture: hit facts of ${cases.length} cases into ${HIT_FACTS_PATH}`);
  process.exit(0);
}
if (args.mode === 'identity-base') {
  const sha = git(['rev-parse', '--verify', `${args.rev}^{commit}`]).trim();
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
