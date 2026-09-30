// A cross-process lock on a file (a mkdir lock directory holding the owner's pid) and an atomic replace, so two parity:lanes runs of
// different targets can each re-read out/lanes.json and write back only their own records, and device boots can share one memory
// budget (device-slots.ts). A lock whose owner has died is taken over under a second lock (<lock>.takeover), which re-reads the
// owner before removing it: two waiters that both saw the dead owner cannot both remove a lock, nor remove the live one made since.
// A lock is published whole (PR #42 finding 4147492214): its directory is staged with the owner's pid and token inside, then renamed
// into place, so no waiter ever sees a live lock without its owner; a lock is removed by renaming it away first, so it never stands
// empty for another process to rename over; and a holder removes only its own lock, failing when it finds another owner's there.
import { randomBytes } from 'node:crypto';
import { constants, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export type LockOptions = { readonly timeoutMs?: number; readonly pollMs?: number };

const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const PID_GRACE_MS = 30_000;
/** A takeover lock older than this was left by a process that died taking over; it is an error naming it. */
const TAKEOVER_STALE_MS = 60_000;
const holder = (lock: string): string => {
  try {
    return readFileSync(`${lock}/pid`, 'utf8').trim().split(/\s+/)[0] || 'unknown';
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
  // The pid file holds the owner's pid and its token ("<pid> <token>"); a pid alone (a lock made by hand, older runs) is read too.
  const pid = Number(text.split(/\s+/)[0]);
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
    if (ownerState(lock) === 'dead') removeLock(lock);
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
  return true;
}

/**
 * Removes a lock directory without it ever standing empty at its path: renamed away (atomically) first, then deleted. An empty
 * directory at the lock path could be renamed over by a waiter publishing its lock, which a recursive delete would then remove.
 */
function removeLock(lock: string): void {
  const away = `${lock}.gone-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    renameSync(lock, away);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  rmSync(away, { recursive: true, force: true });
}

/** Publishes the lock with its owner already inside: a staged directory holding the pid file, renamed to the lock path; false when taken. */
function publishLock(lock: string, owner: string): boolean {
  const stage = `${lock}.stage-${process.pid}-${randomBytes(6).toString('hex')}`;
  mkdirSync(stage);
  try {
    writeExclusive(`${stage}/pid`, owner);
    // An existing lock holds its pid file, so the rename fails rather than replace it.
    renameSync(stage, lock);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return false;
    throw e;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Runs fn holding `${path}.lock`; waits for a live holder, takes over a dead one's, and throws after timeoutMs. */
export function withFileLock<T>(path: string, fn: () => T, opts: LockOptions = {}): T {
  const lock = `${path}.lock`;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const pollMs = opts.pollMs ?? 100;
  const owner = `${process.pid} ${randomBytes(8).toString('hex')}`;
  mkdirSync(dirname(path), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    if (publishLock(lock, owner)) break;
    const state = ownerState(lock);
    if (state === 'gone') continue;
    if (state === 'dead' && takeOver(lock)) continue;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000} s waiting for the lock ${lock} (held by pid ${holder(lock)})`);
    sleepSync(pollMs);
  }
  let result: T;
  try {
    result = fn();
  } catch (e) {
    releaseLock(lock, owner);
    throw e;
  }
  const lost = releaseLock(lock, owner);
  if (lost !== null) throw new Error(lost);
  return result;
}

/** Removes the lock when it is still this owner's; else leaves it and returns the problem (another owner took it meanwhile). */
function releaseLock(lock: string, owner: string): string | null {
  let now: string | null = null;
  try {
    now = readFileSync(`${lock}/pid`, 'utf8').trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (now === owner) {
    removeLock(lock);
    return null;
  }
  return `the lock ${lock} was lost while held: it ${now === null ? 'is gone' : `is now held by pid ${now.split(/\s+/)[0] || 'unknown'}`}, so the work done under it was not exclusive`;
}

/** Creates path with text, failing if anything (a file or a symlink) is already there: never follows a link planted at path. */
function writeExclusive(path: string, text: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/**
 * Replaces path with text in one rename, so a reader never sees a half-written file. The temporary file has an unpredictable name
 * and is created exclusively without following links (PR #42 finding 4147492181), so a link planted beside path is never written through.
 */
export function writeFileAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  try {
    writeExclusive(tmp, text);
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
