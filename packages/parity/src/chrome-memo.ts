// Chrome's output for one capture, remembered by everything that decides it: the page sent to Chrome, the code that drives the
// page, the pinned Chrome and the machine. A regen step re-run for a compiler change its pages do not show reuses the bytes
// instead of rendering again. The memo lives beside regen's cache (.git/dragon-regen/v2), which CI carries between rounds and
// prunes after 30 days unused. DRAGON_CHROME_MEMO=0 renders everything afresh.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join, resolve } from 'node:path';
import { CHROME_VERSION, PLAYWRIGHT_VERSION } from './chrome.ts';
import { repoPath } from './paths.ts';
import { hostPlatform } from './platform.ts';

let dir: string | null = null;

/** The git common directory of a checkout: .git itself, or for a worktree the commondir its .git file leads to. */
export function gitCommonDir(root: string): string {
  const dotGit = join(root, '.git');
  if (statSync(dotGit).isDirectory()) return dotGit;
  const m = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'));
  if (m === null) throw new Error(`${dotGit} names no gitdir`);
  const gitDir = resolve(root, m[1]!.trim());
  const common = join(gitDir, 'commondir');
  return existsSync(common) ? resolve(gitDir, readFileSync(common, 'utf8').trim()) : gitDir;
}

/** The memo directory of a capture kind, beside regen's cache in the git common directory (shared by every worktree). */
export function memoDir(kind: string): string {
  dir ??= gitCommonDir(repoPath('.'));
  return join(dir, 'dragon-regen', 'v2', `chrome-memo-${kind}`);
}

/**
 * The memo key: kind, the JSON of parts (everything sent to Chrome), the content of code (repo paths of the modules that drive
 * the page, which must be in the capture's own import closure so regen keys them), the pinned Chrome and this machine.
 */
export function memoKey(kind: string, parts: unknown, code: readonly string[]): string {
  const h = createHash('sha256');
  h.update(JSON.stringify({ kind, chrome: CHROME_VERSION, playwright: PLAYWRIGHT_VERSION, platform: hostPlatform(), os: release(), parts }));
  for (const p of [...code].sort()) h.update('\0').update(p).update('\0').update(readFileSync(repoPath(p)));
  return h.digest('hex');
}

export type MemoStats = { hits: number; misses: number };

/** produce()'s bytes for this key: the remembered ones when present, else produced now and remembered. */
export function memoized(kind: string, parts: unknown, code: readonly string[], stats: MemoStats, produce: () => Promise<Buffer>): Promise<Buffer> {
  return memoizedIn(memoDir(kind), kind, parts, code, stats, produce);
}

/** memoized with the memo in directory d. */
export async function memoizedIn(d: string, kind: string, parts: unknown, code: readonly string[], stats: MemoStats, produce: () => Promise<Buffer>): Promise<Buffer> {
  if (process.env['DRAGON_CHROME_MEMO'] === '0') return produce();
  const file = join(d, memoKey(kind, parts, code));
  if (existsSync(file)) {
    stats.hits++;
    const now = new Date();
    utimesSync(file, now, now);
    return readFileSync(file);
  }
  stats.misses++;
  const bytes = await produce();
  mkdirSync(d, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
  return bytes;
}
