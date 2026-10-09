// TMP-LEAK: every vitest run gets its own TMPDIR (scripts/vitest-tmpdir.ts) and fails if a test leaves anything in it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { isolateTmpdir, leftovers } from '../../../scripts/vitest-tmpdir.ts';
import { repoPath } from '../src/paths.ts';

const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dragon-tmp-guard-'));
  onTestFinished(() => rmSync(d, { recursive: true, force: true }));
  return d;
};

describe('isolateTmpdir', () => {
  it('points TMPDIR at a new folder under the old one, and the teardown restores TMPDIR and removes the folder', () => {
    const outer = fresh();
    const env: NodeJS.ProcessEnv = { TMPDIR: outer };
    const teardown = isolateTmpdir(env);
    const run = env['TMPDIR'] as string;
    expect(run).not.toBe(outer);
    expect(readdirSync(outer)).toEqual([run.slice(outer.length + 1)]);
    mkdirSync(join(run, 'node-compile-cache'));
    teardown();
    expect(env['TMPDIR']).toBe(outer);
    expect(readdirSync(outer)).toEqual([]);
  });

  it('a leftover file or folder fails the teardown, naming every one, and the folder is still removed', () => {
    const outer = fresh();
    const env: NodeJS.ProcessEnv = { TMPDIR: outer };
    const teardown = isolateTmpdir(env);
    const run = env['TMPDIR'] as string;
    mkdirSync(join(run, 'dragon-wpt-update-x'));
    writeFileSync(join(run, 'stray.json'), '{}');
    expect(leftovers(run)).toEqual(['dragon-wpt-update-x', 'stray.json']);
    expect(teardown).toThrow(/tests left 2 entries in TMPDIR; .*: dragon-wpt-update-x, stray\.json$/);
    expect(existsSync(run)).toBe(false);
    expect(env['TMPDIR']).toBe(outer);
  });
});

describe('a vitest run under the guard', () => {
  const config = repoPath('packages/parity/test/planted/tmp-guard/vitest.config.ts');
  const vitest = (file: string, outer: string) =>
    spawnSync(process.execPath, [repoPath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], { encoding: 'utf8', env: { ...process.env, TMPDIR: outer, DRAGON_TMP_GUARD_FILE: file } });

  it('PLANTED: a passing test that leaves a temp folder fails the run, and nothing is left behind', () => {
    const outer = fresh();
    const r = vitest('leaks.planted.ts', outer);
    expect(r.stdout).toContain('1 passed');
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toMatch(/tests left 1 entry in TMPDIR; .*: dragon-planted-leak-\w+/);
    expect(leftovers(outer)).toEqual([]);
  }, 60_000);

  const list = (file: string, outer: string) =>
    spawnSync(process.execPath, [repoPath('node_modules/vitest/vitest.mjs'), 'list', '--config', config], { encoding: 'utf8', env: { ...process.env, TMPDIR: outer, DRAGON_TMP_GUARD_FILE: file } });

  it('PLANTED: a temp folder made at module scope leaks when `vitest list` collects the file without its hooks', () => {
    const outer = fresh();
    const r = list('module-scope.planted.ts', outer);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toMatch(/tests left 1 entry in TMPDIR; .*: dragon-planted-module-\w+/);
    expect(leftovers(outer)).toEqual([]);
  }, 60_000);

  it('a temp folder made in beforeAll passes `vitest list` and `vitest run`, and nothing is left behind', () => {
    const outer = fresh();
    const l = list('hooked.planted.ts', outer);
    expect(l.status, l.stdout + l.stderr).toBe(0);
    const r = vitest('hooked.planted.ts', outer);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('1 passed');
    expect(leftovers(outer)).toEqual([]);
  }, 60_000);

  it('a test that removes its temp folder passes the run, and nothing is left behind', () => {
    const outer = fresh();
    const r = vitest('cleans.planted.ts', outer);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('1 passed');
    expect(leftovers(outer)).toEqual([]);
  }, 60_000);
});

describe('no test file makes a temp folder at module scope', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []));
  const roots = ['packages', 'scripts'].map((r) => repoPath(r));

  it('every *.test.ts makes its temp folders in a hook or a test (`vitest list` runs module scope, not hooks)', () => {
    const all = roots.flatMap(files);
    expect(all.length).toBeGreaterThan(100);
    const offenders = all.flatMap((f) =>
      readFileSync(f, 'utf8').split('\n').flatMap((line, i) => (/^\S/.test(line) && /\bmkdtemp(Sync)?\(/.test(line) && !/=>/.test(line.slice(0, line.search(/\bmkdtemp/))) ? [`${relative(repoPath('.'), f)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
