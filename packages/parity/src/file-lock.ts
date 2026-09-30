// A cross-process lock on a file (a mkdir lock directory holding the owner's pid) and an atomic replace, so two parity:lanes runs of
// different targets can each re-read out/lanes.json and write back only their own records, and device boots can share one memory
// budget (device-slots.ts). A lock whose owner has died is taken over under a second lock (<lock>.takeover), which re-reads the
// owner before removing it: two waiters that both saw the dead owner cannot both remove a lock, nor remove the live one made since.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type LockOptions = { readonly timeoutMs?: number; readonly pollMs?: number };

const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const PID_GRACE_MS = 30_000;
/** A takeover lock older than this was left by a process that died taking over; it is an error naming it. */
const TAKEOVER_STALE_MS = 60_000;
const holder = (lock: string): string => {
  try {
    return readFileSync(`${lock}/pid`, 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * The owner of a lock: 'gone' when the lock was released meanwhile, 'alive', or 'dead' (its pid no longer runs, or it never wrote
 * one in PID_GRACE_MS). A pid file not yet written, or written but still empty, is an owner between mkdir and write: alive.
 */
export function ownerState(lock: string, alive: (pid: number) => boolean = pidRuns): 'alive' | 'dead' | 'gone' {
  let text = '';
  try {
    text = readFileSync(`${lock}/pid`, 'utf8').trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (text === '') {
    try {
      return Date.now() - statSync(lock).mtimeMs < PID_GRACE_MS ? 'alive' : 'dead';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'gone';
      throw e;
    }
  }
  const pid = Number(text);
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? 'alive' : 'dead';
}

function pidRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Removes a lock whose owner is dead, holding the takeover lock and re-reading the owner under it; false when another is at it. */
function takeOver(lock: string): boolean {
  const guard = `${lock}.takeover`;
  try {
    mkdirSync(guard);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    let age = 0;
    try {
      age = Date.now() - statSync(guard).mtimeMs;
    } catch {
      return false;
    }
    if (age > TAKEOVER_STALE_MS) throw new Error(`the takeover lock ${guard} is ${(age / 1000).toFixed(0)} s old, left by a process that died taking over ${lock}; remove it`);
    return false;
  }
  try {
    if (ownerState(lock) === 'dead') rmSync(lock, { recursive: true, force: true });
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
  return true;
}

/** Runs fn holding `${path}.lock`; waits for a live holder, takes over a dead one's, and throws after timeoutMs. */
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
    const owner = ownerState(lock);
    if (owner === 'gone') continue;
    if (owner === 'dead' && takeOver(lock)) continue;
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
