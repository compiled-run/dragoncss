// TMP-LEAK: every vitest run gets its own TMPDIR (scripts/vitest-tmpdir.ts) and fails if a test leaves anything in it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import ts from 'typescript';
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

  it('PLANTED: a temp folder made in a describe body leaks when `vitest list` collects the file without its hooks', () => {
    const outer = fresh();
    const r = list('describe-scope.planted.ts', outer);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toMatch(/tests left 1 entry in TMPDIR; .*: dragon-planted-describe-\w+/);
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

/** The base name of a callee: `describe` for describe, describe.each(x), describe.skip; `it` for it.each(x), and so on. */
function calleeRoot(e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return calleeRoot(e.expression);
  if (ts.isCallExpression(e)) return calleeRoot(e.expression);
  return undefined;
}

/** A call's own function name: mkdtempSync for fs.mkdtempSync(...) and mkdtempSync(...). */
function calledName(c: ts.CallExpression): string | undefined {
  const e = c.expression;
  return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : undefined;
}

const DEFERRING = new Set(['it', 'test', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach', 'onTestFinished', 'onTestFailed']);
const TEMP_DIR = new Set(['mkdtemp', 'mkdtempSync']);

/** The name a helper function is called by: a function declaration, or a function bound to a const. */
function helperName(f: ts.FunctionLikeDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(f)) return f.name?.text;
  const p = f.parent;
  return p !== undefined && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer === f ? p.name.text : undefined;
}

/**
 * Where a node runs: 'collect' when vitest's collection (`vitest list`) runs it (module scope, describe bodies, callbacks they
 * call inline), 'deferred' inside a hook or test callback, or the name of the helper function whose body holds it.
 */
function context(n: ts.Node): 'collect' | 'deferred' | { helper: string } {
  for (let at = n.parent; at !== undefined; at = at.parent) {
    if (!ts.isFunctionLike(at)) continue;
    const f = at as ts.FunctionLikeDeclaration;
    const name = helperName(f);
    if (name !== undefined) return { helper: name };
    const call = f.parent;
    if (call !== undefined && ts.isCallExpression(call) && call.arguments.includes(f as ts.Expression)) {
      if (DEFERRING.has(calleeRoot(call.expression) ?? '')) return 'deferred';
      continue; // describe bodies and inline callbacks (map, forEach) run where their call runs
    }
    return 'deferred'; // a method or another function value: not run by collection on its own
  }
  return 'collect';
}

/** Every line (1-based) of a test source that makes a temp folder while vitest collects it, directly or through a local helper. */
function collectionTempDirs(file: string, text: string): number[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) calls.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  // The local helpers that make a temp folder when called, to a fixed point (a helper of a helper).
  const makers = new Set(TEMP_DIR);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of calls) {
      const ctx = context(c);
      if (typeof ctx === 'object' && makers.has(calledName(c) ?? '') && !makers.has(ctx.helper)) {
        makers.add(ctx.helper);
        grew = true;
      }
    }
  }
  const lines = calls.filter((c) => makers.has(calledName(c) ?? '') && context(c) === 'collect').map((c) => sf.getLineAndCharacterOfPosition(c.getStart(sf)).line + 1);
  return [...new Set(lines)].sort((a, b) => a - b);
}

describe('no test file makes a temp folder while vitest collects it', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []));
  const roots = ['packages', 'scripts'].map((r) => repoPath(r));
  const planted = (name: string): { file: string; text: string } => {
    const file = repoPath(`packages/parity/test/planted/tmp-guard/${name}`);
    return { file, text: readFileSync(file, 'utf8') };
  };

  it('PLANTED: the scan reports every collection-time temp folder (module scope, describe bodies, helpers, inline callbacks) and no hook or test one', () => {
    const { file, text } = planted('scan-cases.planted.ts');
    const marked = (tag: string): number[] => text.split('\n').flatMap((l, i) => (l.includes(`// ${tag} `) ? [i + 1] : []));
    expect(marked('BAD').length).toBe(7);
    expect(marked('OK').length).toBeGreaterThanOrEqual(8);
    expect(collectionTempDirs(file, text)).toEqual(marked('BAD'));
    const d = planted('describe-scope.planted.ts');
    expect(collectionTempDirs(d.file, d.text)).toEqual([d.text.split('\n').findIndex((l) => l.includes('mkdtempSync(')) + 1]);
    for (const ok of ['hooked.planted.ts', 'cleans.planted.ts']) expect(collectionTempDirs(ok, planted(ok).text), ok).toEqual([]);
  });

  it('every *.test.ts makes its temp folders in a hook or a test (`vitest list` runs module scope and describe bodies, not hooks)', () => {
    const all = roots.flatMap(files);
    expect(all.length).toBeGreaterThan(100);
    const offenders = all.flatMap((f) => collectionTempDirs(f, readFileSync(f, 'utf8')).map((l) => `${relative(repoPath('.'), f)}:${l}`));
    expect(offenders).toEqual([]);
  });
});
