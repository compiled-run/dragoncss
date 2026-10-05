// The machine-wide native build cache (#158), shared by the translate harness builds (native.ts) and the device lanes' app
// builds (packages/parity native-host.ts). Node built-ins only, so both packages load it without the translator.
import { existsSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Built harnesses, shared by every worktree on the machine (DRAGON_NATIVE_CACHE overrides; CI points it at a cached path). A build
 * is keyed by its sources, flags and compiler version, and lands in its directory by one rename, so a hit is always a whole build.
 */
export const BUILD_CACHE = process.env['DRAGON_NATIVE_CACHE'] || join(homedir(), '.cache', 'dragon-native');

/** The cache's kinds, one directory each under the cache root; pruneCache judges them together against one size cap. */
export const CACHE_KINDS: readonly string[] = ['swift', 'kotlin', 'ios-app', 'apk'];

/** A cached build exists; its directory's time is refreshed, so pruneCache keeps what is still used. */
export function hit(dir: string, artifact: string): boolean {
  if (!existsSync(artifact)) return false;
  touch(dir);
  return true;
}

/** Marks a cache entry used now; a missing entry is left for the caller's spawn to report. */
export function touch(dir: string): void {
  try {
    const now = new Date();
    utimesSync(dir, now, now);
  } catch {
    // Nothing to mark: the spawn that follows reports the missing artifact loudly.
  }
}

const DAY_MS = 24 * 3600 * 1000;
/** The cache's size cap; past it, the least recently used entries go first. */
export function cacheMaxBytes(env: string | undefined): number {
  if (env === undefined || env === '') return 3072 * 1024 * 1024;
  const mb = Number(env);
  if (env.trim() === '' || !Number.isFinite(mb) || mb < 0) throw new Error(`DRAGON_NATIVE_CACHE_MAX_MB must be a finite number of MB, 0 or more; got ${JSON.stringify(env)}`);
  return mb * 1024 * 1024;
}
export const CACHE_MAX_BYTES = cacheMaxBytes(process.env['DRAGON_NATIVE_CACHE_MAX_MB']);
/** An entry used this recently may have a suite running from it, so the size cap never evicts it. */
export const IN_USE_MS = 2 * 3600 * 1000;

function sizeOf(path: string): number {
  const st = statSync(path, { throwIfNoEntry: false });
  if (st === undefined) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((n, c) => n + sizeOf(join(path, c)), 0);
}

/** Moves an entry out of every reader's way in one rename, then deletes it, so a killed prune never leaves a half-removed entry. */
function evict(root: string, name: string): void {
  const trash = join(root, `${name}.trash-${process.pid}`);
  try {
    renameSync(join(root, name), trash);
  } catch {
    return;
  }
  rmSync(trash, { recursive: true, force: true });
}

/**
 * Prunes each language directory under cacheRoot: entries unused for 14 days, work directories a killed build left over a day
 * ago and trash a killed prune left; then, while the cache is over maxBytes, the least recently used entries except keep.
 */
export function pruneCache(cacheRoot: string, keep: string | null, now = Date.now(), maxBytes = CACHE_MAX_BYTES): void {
  const entries: { root: string; name: string; mtimeMs: number; bytes: number }[] = [];
  for (const lang of CACHE_KINDS) {
    const root = join(cacheRoot, lang);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const st = statSync(join(root, name), { throwIfNoEntry: false });
      if (st === undefined) continue;
      const age = now - st.mtimeMs;
      if (name.includes('.trash-')) rmSync(join(root, name), { recursive: true, force: true });
      else if (name.includes('.build-')) {
        if (age > DAY_MS) rmSync(join(root, name), { recursive: true, force: true });
      } else if (age > 14 * DAY_MS) evict(root, name);
      else entries.push({ root, name, mtimeMs: st.mtimeMs, bytes: sizeOf(join(root, name)) });
    }
  }
  let total = entries.reduce((n, e) => n + e.bytes, 0);
  for (const e of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break;
    if (join(e.root, e.name) === keep || now - e.mtimeMs < IN_USE_MS) continue;
    evict(e.root, e.name);
    total -= e.bytes;
  }
  if (total > maxBytes) console.warn(`native build cache ${cacheRoot}: ${(total / 1048576).toFixed(0)} MB, over its ${(maxBytes / 1048576).toFixed(0)} MB cap; every remaining entry was used in the last 2 hours, so none was evicted`);
}

/**
 * Moves a finished build into its cache directory. A concurrent build of the same key may have won, which is equivalent. A
 * directory that lacks the build's artifacts is a stale entry (something deleted files under out/ and left the directories),
 * which would otherwise block every later publish of the key while the caller runs an artifact that is not there: it is replaced.
 */
export function publish(work: string, dir: string): void {
  try {
    renameSync(work, dir);
    return;
  } catch {
    // The directory exists: a concurrent winner, or a stale entry.
  }
  const artifacts = readdirSync(work).filter((n) => n !== 'src');
  if (artifacts.every((n) => existsSync(join(dir, n)))) {
    rmSync(work, { recursive: true, force: true });
    return;
  }
  rmSync(dir, { recursive: true, force: true });
  try {
    renameSync(work, dir);
  } catch (e) {
    // A concurrent build may have published between the removal and this rename.
    if (!artifacts.every((n) => existsSync(join(dir, n)))) throw new Error(`could not publish the build ${work} to ${dir}: ${(e as Error).message}`);
    rmSync(work, { recursive: true, force: true });
  }
}

