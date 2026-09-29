// A cross-process lock on a file (a mkdir lock directory holding the owner's pid) and an atomic replace, so two parity:lanes runs of
// different targets can each re-read out/lanes.json and write back only their own records. A lock whose owner has died is an error
// naming the lock to remove, never taken over (two waiters taking over the same dead lock could both hold it).
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type LockOptions = { readonly timeoutMs?: number; readonly pollMs?: number };

const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const PID_GRACE_MS = 30_000;
const holder = (lock: string): string => {
  try {
    return readFileSync(`${lock}/pid`, 'utf8').trim();
  } catch {
    return 'unknown';
  }
};

function ownerAlive(lock: string): boolean {
  let text: string;
  try {
    text = readFileSync(`${lock}/pid`, 'utf8').trim();
  } catch {
    // The owner has made the directory but not yet written its pid: alive unless that was long ago (it died in between).
    try {
      return Date.now() - statSync(lock).mtimeMs < PID_GRACE_MS;
    } catch {
      return false;
    }
  }
  const pid = Number(text);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Runs fn holding `${path}.lock`; waits for a live holder, and throws after timeoutMs or when the holder has died. */
export function withFileLock<T>(path: string, fn: () => T, opts: LockOptions = {}): T {
  const lock = `${path}.lock`;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const pollMs = opts.pollMs ?? 100;
  mkdirSync(dirname(path), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    if (!ownerAlive(lock)) throw new Error(`the lock ${lock} is held by pid ${holder(lock)}, which is no longer running; remove the directory once no run is writing ${path}`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000} s waiting for the lock ${lock} (held by pid ${holder(lock)})`);
    sleepSync(pollMs);
  }
  try {
    writeFileSync(`${lock}/pid`, String(process.pid));
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Replaces path with text in one rename, so a reader never sees a half-written file. */
export function writeFileAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
