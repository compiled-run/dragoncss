// T007 must-fixes folded into P2b (notes/T007-p1-review-p2-plan.md item 7, notes/T010-p2-triage.md): freshness ignores only the
// build folders at a generated package root; the subset checker rejects closures that capture a for-loop binding; a failed Kotlin
// tool lookup reports blocked (owner tooling) with no suites; native reports name a suite timeout or crash.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { committedFiles, diffFiles, runTarget } from '../src/check.ts';
import type { Corpus } from '../src/corpus.ts';
import { KOTLIN_DIR, listTree, rootBuildDirs, SWIFT_DIR } from '../src/generate.ts';
import type { KotlinLookup, RunResult } from '../src/native.ts';
import { describe as describeRun, execSuite, kotlinTool } from '../src/native.ts';
import { checkSubset } from '../src/subset.ts';

function tree(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-listtree-'));
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), '// by hand\n');
  }
  return dir;
}

describe('must-fix: listTree ignores only the root build folders', () => {
  it('the Swift root ignores .build and .swiftpm, the Kotlin root ignores build, and nothing else is ignored', () => {
    expect(rootBuildDirs(SWIFT_DIR)).toEqual(['.build', '.swiftpm']);
    expect(rootBuildDirs(KOTLIN_DIR)).toEqual(['build']);
    const dir = tree(['Package.swift', '.build/out.o', '.swiftpm/x.json', 'Sources/DragonLayout/Ok.swift', 'Sources/DragonLayout/build/Hand.swift', 'Sources/DragonLayout/.Hidden.swift', '.gitignore', 'build/Root.swift']);
    try {
      expect(listTree(dir, ['.build', '.swiftpm'])).toEqual(['.gitignore', 'Package.swift', 'Sources/DragonLayout/.Hidden.swift', 'Sources/DragonLayout/Ok.swift', 'Sources/DragonLayout/build/Hand.swift', 'build/Root.swift']);
      expect(listTree(dir, ['build'])).toContain('.build/out.o');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a hand-written file in a nested build folder or a dot-file is caught by the freshness comparison', () => {
    for (const target of ['swift', 'kotlin'] as const) {
      const want = committedFiles(target);
      const src = target === 'swift' ? 'Sources/DragonLayout' : 'src/main/kotlin/dev/dragon/layout';
      const hand = target === 'swift' ? 'Hand.swift' : 'Hand.kt';
      for (const extra of [`${src}/build/${hand}`, `${src}/.${hand}`]) {
        const have = new Map(want);
        have.set(extra, '// by hand\n');
        expect(diffFiles(want, have), extra).toEqual([extra]);
      }
    }
  });
});

describe('must-fix: the subset checker rejects closures that capture a for-loop binding', () => {
  it('for...of and for (let ...) bindings captured by an arrow are violations; a copy inside the body and a callback parameter are not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dragon-subset-'));
    const file = join(dir, 'loop.ts');
    writeFileSync(file, [
      'export function a(xs: readonly number[]): (() => number)[] {',
      '  const out: (() => number)[] = [];',
      '  for (const x of xs) out.push(() => x);',
      '  return out;',
      '}',
      'export function b(n: number): (() => number)[] {',
      '  const out: (() => number)[] = [];',
      '  for (let i = 0; i < n; i++) out.push(() => i * 2);',
      '  return out;',
      '}',
      'export type P = { readonly v: number };',
      'export function c(xs: readonly number[]): (() => P)[] {',
      '  const out: (() => P)[] = [];',
      '  for (const v of xs) out.push((): P => ({ v }));',
      '  return out;',
      '}',
      'export function ok(xs: readonly number[]): number[] {',
      '  const out: number[] = [];',
      '  for (const x of xs) out.push(x);',
      '  return xs.map((x) => x + 1);',
      '}',
      '',
    ].join('\n'));
    try {
      const v = checkSubset([file]).filter((x) => x.message.includes('for-loop binding'));
      expect(v.map((x) => [x.line, x.message.match(/binding (\w+)/)?.[1]])).toEqual([[3, 'x'], [8, 'i'], [14, 'v']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('must-fix: a failed Kotlin tool lookup is blocked (owner tooling), never passed', () => {
  it('no JDK and no kotlinc: kotlinTool is null and runTarget reports blocked with no suites', () => {
    const none: KotlinLookup = { javaHomeEnv: '/nonexistent/jdk', javaHomeCommand: '/nonexistent/java_home', jdkHomes: ['/nonexistent/openjdk@17'], kotlincs: ['/nonexistent/kotlinc'] };
    expect(kotlinTool(none)).toBeNull();
    const corpus: Corpus = { suites: [{ name: 'vectors', mode: 'engine', lines: ['{}'], expected: ['["ok"]'] }], vectors: [], engineSplit: { ok: 0, unsupported: 0, refused: 0, threw: 0, harnessError: 0 }, digest: 'x', digests: {} };
    const r = runTarget('kotlin', corpus, committedFiles('kotlin'), 'test-kotlin-blocked', false, none);
    expect([r.status, r.suites.length, r.reason]).toEqual(['blocked (owner tooling)', 0, 'install JDK 17 and kotlinc (docs/decisions.md, Native lanes, milestone 2)']);
    expect(describeRun(r, corpus)).toContain('status blocked (owner tooling)');
  });

  it('a JDK without kotlinc is blocked too', () => {
    const tool = kotlinTool();
    if (tool === null) return;
    expect(kotlinTool({ javaHomeEnv: tool.javaHome, javaHomeCommand: '/nonexistent/java_home', jdkHomes: [], kotlincs: ['/nonexistent/kotlinc'] })).toBeNull();
  });
});

describe('must-fix: native reports name a suite timeout or crash', () => {
  it('execSuite returns the cause: timeout, crash by signal, non-zero exit, or null', () => {
    expect(execSuite('sleep', ['5'], 300)).toBe('timeout: killed after 0.3 s');
    expect(execSuite('sh', ['-c', 'kill -SEGV $$'])).toBe('crash: signal SIGSEGV');
    expect(execSuite('sh', ['-c', 'exit 3'])).toBe('crash: exit status 3');
    expect(execSuite('sh', ['-c', 'exit 0'])).toBeNull();
    expect(execSuite('/nonexistent/harness', [])).toMatch(/^could not run: /);
  });

  it('describe prints the cause next to the suite count', () => {
    const corpus: Corpus = { suites: [], vectors: [], engineSplit: { ok: 0, unsupported: 0, refused: 0, threw: 0, harnessError: 0 }, digest: 'd', digests: {} };
    const r: RunResult = { target: 'swift', status: 'fail', toolchain: 't', reason: null, buildSeconds: 0, runSeconds: 0, suites: [{ name: 'snap', total: 10, pass: 4, mismatches: [], split: corpus.engineSplit, cause: 'timeout: killed after 180 s' }] };
    expect(describeRun(r, corpus)).toContain('snap 4/10 (timeout: killed after 180 s)');
  });
});
