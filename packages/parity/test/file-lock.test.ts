// PR #42 finding 4147492214: a lock is published with its owner already inside, so a waiter never sees a live lock without a pid
// (and never takes it over after the grace); a holder removes only its own lock and fails when it finds another owner's there.
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every call that creates something at a lock path records whether the owner's pid is there the moment the lock exists.
const seen: { readonly path: string; readonly withPid: boolean }[] = [];
const isLock = (p: unknown): p is string => typeof p === 'string' && p.endsWith('.lock');
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const note = (p: string): void => void seen.push({ path: p, withPid: real.existsSync(`${p}/pid`) && real.readFileSync(`${p}/pid`, 'utf8').trim() !== '' });
  return {
    ...real,
    mkdirSync: (p: fs.PathLike, o?: fs.MakeDirectoryOptions) => {
      const r = real.mkdirSync(p, o);
      if (isLock(p)) note(p);
      return r;
    },
    renameSync: (a: fs.PathLike, b: fs.PathLike) => {
      real.renameSync(a, b);
      if (isLock(b)) note(b);
    },
  };
});

const { withFileLock } = await import('../src/file-lock.ts');

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dragon-lock-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  seen.length = 0;
});

describe('the lock is published whole', () => {
  it('the lock path never exists without its owner\'s pid inside', () => {
    const path = join(tmp(), 'lanes.json');
    for (let i = 0; i < 5; i++) expect(withFileLock(path, () => i)).toBe(i);
    expect(seen.length).toBe(5);
    expect(seen.every((s) => s.withPid)).toBe(true);
    expect(readdirSync(join(path, '..'))).toEqual([]);
  });
  it('the pid file names this process', () => {
    const path = join(tmp(), 'lanes.json');
    const pid = withFileLock(path, () => readFileSync(`${path}.lock/pid`, 'utf8').trim().split(/\s+/)[0]);
    expect(pid).toBe(String(process.pid));
  });
  it('a holder whose lock was replaced meanwhile fails, and leaves the other owner\'s lock in place', () => {
    const dir = tmp();
    const path = join(dir, 'lanes.json');
    expect(() =>
      withFileLock(path, () => {
        rmSync(`${path}.lock`, { recursive: true });
        fs.mkdirSync(`${path}.lock`);
        fs.writeFileSync(`${path}.lock/pid`, '4242 other');
      }),
    ).toThrow(/lanes.json.lock was lost while held: it is now held by pid 4242/);
    expect(readFileSync(`${path}.lock/pid`, 'utf8')).toBe('4242 other');
    rmSync(`${path}.lock`, { recursive: true });
    expect(() => withFileLock(path, () => rmSync(`${path}.lock`, { recursive: true }))).toThrow(/was lost while held: it is gone/);
  });
  it('a throw inside still releases the lock, and no staged or removed lock is left behind', () => {
    const dir = tmp();
    const path = join(dir, 'lanes.json');
    expect(() => withFileLock(path, () => { throw new Error('inside'); })).toThrow('inside');
    expect(readdirSync(dir)).toEqual([]);
    expect(withFileLock(path, () => 3)).toBe(3);
  });
});
