// Regenerates packages/parity/expected-hit/<case>.hit.json from live Chrome: document.elementFromPoint at every point of each
// layout case's derived hit grid, on its authored rendering (SELD-R1b). Files of cases that no longer exist are removed.
// Run with: pnpm run parity:hit-capture
// pnpm run parity:hit-capture -- --identity-base <rev> instead writes expected-hit/identity-base.json: the sha256 of every capture
// and emitted file of <rev> with the pointer-events key removed, which hit-capture-identity.test.ts holds the outputs to.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { launchChrome } from '../chrome.ts';
import { zoomGuard } from '../dpr.ts';
import { CHROME_PAGES, inOrder } from '../chrome-pool.ts';
import { captureHits, captureHitsAt, compareHitsAt, expectedHitDir, expectedHitDprDir, hitCaptureFile, HIT_DIVERGENCE_PATH, hitDivergenceDeltas, type HitMismatch, hitDprCaptures, HIT_MEMO, expectedHitPath, HIT_FACTS_PATH, hitCaptureJson, hitCases, hitFactsJson, IDENTITY_MANIFEST, IDENTITY_ROOTS, parseHitCaptureArgs, replaceDirWhenFilled, staleDprDirs, withoutPointerEvents } from '../hit-capture.ts';
import type { NativeCase } from '../native-host.ts';
import { HIT_DIVERGENCE } from '../hit-divergence.ts';
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
  // Each case in its own context (captureHits), CHROME_PAGES at a time.
  for (const c of await inOrder(cases, CHROME_PAGES, (n) => captureHits(browser, n))) {
    points += c.points;
    writeFileSync(expectedHitPath(c.case), hitCaptureJson(c));
  }
} finally {
  await browser.close();
}
// The DPR captures (hitDprCaptures): one launch per DPR at that forced device scale factor, behind the zoom guard, each DPR's folder
// replaced only once all its captures are written.
const byId = new Map(cases.map((n) => [n.case.id, n]));
const dprCaptures = hitDprCaptures(cases);
const folders = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isDirectory()).map((f) => f.name);
for (const name of staleDprDirs(folders, dprCaptures.map((d) => d.dpr))) rmSync(`${dir}/${name}`, { recursive: true });
const compared: { readonly case: string; readonly dpr: number; readonly grid: readonly (readonly [number, number])[]; readonly stale: boolean; readonly mismatches: readonly HitMismatch[] }[] = [];
for (const { dpr, ids } of dprCaptures) {
  const own = ids.map((id) => {
    const n = byId.get(id);
    if (n === undefined) throw new Error(`hitDprCaptures names ${id} at DPR ${dpr}, which is not a hit case`);
    return n;
  });
  await replaceDirWhenFilled(expectedHitDprDir(dpr), async (into) => {
    const b = await launchChrome(dpr);
    try {
      await zoomGuard(b, dpr);
      const caps = await inOrder(own, CHROME_PAGES, (n) => captureHitsAt(b, n, dpr));
      caps.forEach((c, i) => {
        points += c.points;
        writeFileSync(`${into}/${hitCaptureFile(c.case)}`, hitCaptureJson(c));
        compared.push({ case: c.case, dpr, ...compareHitsAt(own[i] as NativeCase, c, dpr) });
      });
    } finally {
      await b.close();
    }
  });
}
console.log(`parity:hit-capture: ${cases.length} cases and ${dprCaptures.reduce((k, d) => k + d.ids.length, 0)} DPR captures (${HIT_MEMO.hits} remembered, ${HIT_MEMO.misses} read; chrome-memo.ts), ${points} points into packages/parity/expected-hit`);
// The captures are written; regen fails unless every case's mismatches at every device DPR are exactly its reviewed points.
const deltas = hitDivergenceDeltas(HIT_DIVERGENCE, compared);
if (deltas.length > 0) {
  console.error(`parity:hit-capture: ${deltas.length} differences from the reviewed known divergences (${HIT_DIVERGENCE_PATH}):\n  ${deltas.join('\n  ')}`);
  console.error('Run pnpm run parity:hit-divergence -- --write, review the diff, write a reason for every TODO reason, commit, and re-run.');
  process.exit(1);
}
