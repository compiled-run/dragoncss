import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitCommonDir, memoizedIn, memoKey } from '../src/chrome-memo.ts';

const CODE = ['packages/parity/src/chrome.ts'];
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'chrome-memo-'));
  dirs.push(d);
  return d;
};
const before = process.env['DRAGON_CHROME_MEMO'];
beforeEach(() => {
  process.env['DRAGON_CHROME_MEMO'] = '1';
});
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  if (before === undefined) delete process.env['DRAGON_CHROME_MEMO'];
  else process.env['DRAGON_CHROME_MEMO'] = before;
});

describe('chrome-memo', () => {
  it('produces once per key and returns the remembered bytes after', async () => {
    const d = tmp();
    const stats = { hits: 0, misses: 0 };
    let n = 0;
    const produce = async () => Buffer.from(`shot ${++n}`);
    expect((await memoizedIn(d, 'pixel', { html: 'a' }, CODE, stats, produce)).toString()).toBe('shot 1');
    expect((await memoizedIn(d, 'pixel', { html: 'a' }, CODE, stats, produce)).toString()).toBe('shot 1');
    expect((await memoizedIn(d, 'pixel', { html: 'b' }, CODE, stats, produce)).toString()).toBe('shot 2');
    expect(stats).toEqual({ hits: 1, misses: 2 });
    expect(readdirSync(d).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('keys by kind, parts and the driving code, never by object key order alone', () => {
    const k = memoKey('pixel', { html: 'a', dpr: 2 }, CODE);
    expect(memoKey('pixel', { html: 'a', dpr: 2 }, CODE)).toBe(k);
    expect(memoKey('frames', { html: 'a', dpr: 2 }, CODE)).not.toBe(k);
    expect(memoKey('pixel', { html: 'a', dpr: 3 }, CODE)).not.toBe(k);
    expect(memoKey('pixel', { html: 'a', dpr: 2 }, [...CODE, 'packages/parity/src/dpr.ts'])).not.toBe(k);
  });
  it('renders everything afresh unless DRAGON_CHROME_MEMO is 1 (pnpm regen sets it for its steps)', async () => {
    for (const v of ['0', '', undefined]) {
      const d = tmp();
      const stats = { hits: 0, misses: 0 };
      if (v === undefined) delete process.env['DRAGON_CHROME_MEMO'];
      else process.env['DRAGON_CHROME_MEMO'] = v;
      let n = 0;
      await memoizedIn(d, 'pixel', { html: 'a' }, CODE, stats, async () => Buffer.from(`${++n}`));
      await memoizedIn(d, 'pixel', { html: 'a' }, CODE, stats, async () => Buffer.from(`${++n}`));
      expect(n, String(v)).toBe(2);
      expect(readdirSync(d)).toEqual([]);
    }
  });
  it('remembers a JSON value as its JSON', async () => {
    const d = tmp();
    const stats = { hits: 0, misses: 0 };
    const v = await memoizedIn(d, 'capture', { html: 'a' }, CODE, stats, async () => Buffer.from(JSON.stringify([{ id: 'a', x: 1.5, computed: null }])));
    expect(JSON.parse(v.toString('utf8'))).toEqual([{ id: 'a', x: 1.5, computed: null }]);
  });
  it('remembers nothing when producing fails', async () => {
    const d = tmp();
    const stats = { hits: 0, misses: 0 };
    await expect(memoizedIn(d, 'pixel', { html: 'a' }, CODE, stats, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(readdirSync(d)).toEqual([]);
  });
  it('does not remember a result keep refuses, so the next run produces it again', async () => {
    const d = tmp();
    const stats = { hits: 0, misses: 0 };
    let n = 0;
    const produce = async () => Buffer.from(`${++n}`);
    const keep = (b: Buffer) => b.toString() !== '1';
    expect((await memoizedIn(d, 'capture', { html: 'a' }, CODE, stats, produce, keep)).toString()).toBe('1');
    expect(readdirSync(d)).toEqual([]);
    expect((await memoizedIn(d, 'capture', { html: 'a' }, CODE, stats, produce, keep)).toString()).toBe('2');
    expect((await memoizedIn(d, 'capture', { html: 'a' }, CODE, stats, produce, keep)).toString()).toBe('2');
    expect(stats).toEqual({ hits: 1, misses: 2 });
  });
  it('finds the git common directory of a checkout and of a worktree', () => {
    const d = tmp();
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    const main = join(d, 'main');
    git(d, 'init', '-q', main);
    writeFileSync(join(main, 'f'), 'x');
    git(main, 'add', '.');
    git(main, 'commit', '-q', '-m', 'f');
    git(main, 'worktree', 'add', '-q', join(d, 'wt'));
    expect(gitCommonDir(main)).toBe(join(main, '.git'));
    expect(gitCommonDir(join(d, 'wt'))).toBe(join(main, '.git'));
  });
});
