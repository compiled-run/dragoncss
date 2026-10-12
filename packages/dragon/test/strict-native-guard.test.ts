// strict-native-class: a missing native toolchain is handled only by missingToolchain (packages/translate/src/native.ts, with
// blockedRun and isBlocked on it), which throws when DRAGON_REQUIRE_NATIVE=1. This scan of packages/*/src and packages/*/test fails
// on any other code that prints "blocked (owner tooling)", or that finds a toolchain missing and returns, skips or passes.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HELPER = 'packages/translate/src/native.ts';
const SELF = relative(root, fileURLToPath(import.meta.url));

const BLOCKED = 'blocked (owner tooling)';
/** A condition that probes a toolchain: the lookups, the tools by name, their homes, a spawn's ENOENT, or a run's blocked status. */
const PROBE = /\b(swiftTool|kotlinTool)\s*\(|\b(swiftc|kotlinc|javac|xcrun|xcodebuild)\b|JAVA_HOME|ANDROID_HOME|\bjavaHome\b|['"`]which['"`]|\bwhich\.status\b|ENOENT|\.status\s*[!=]==?\s*['"`]blocked \(owner tooling\)|\btools?\.ok\b|\btool\s*[!=]==?\s*(null|undefined)\b/;
/** An early exit that reports a tool missing by hand: names a tool and says it failed or is missing. */
const TOOL = /\b(swiftc|kotlinc|javac|xcrun|xcodebuild|JAVA_HOME|ANDROID_HOME|JDK)\b/;
const MISSING = /\bok:\s*false\b|owner tooling|not found|missing|ENOENT/;
/** Code that honours DRAGON_REQUIRE_NATIVE: the shared handler, or an error. */
const HONOURS = /\b(missingToolchain|blockedRun|isBlocked)\s*\(|\bthrow\b/;
const PRINT = /^(console\.(log|info|warn|error|debug)|process\.(stdout|stderr)\.write)$/;

/** Every source and test file of every package (not generated output or dependencies). */
function files(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'out', 'generated', 'dist'].includes(e.name)) walk(p);
      } else if (/\.(m|c)?[jt]sx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(relative(root, p));
    }
  };
  for (const pkg of readdirSync(join(root, 'packages'))) {
    for (const sub of ['src', 'test']) {
      try {
        walk(join(root, 'packages', pkg, sub));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
  return out.sort();
}

/** The statements a branch runs at its top level. */
const top = (s: ts.Statement): readonly ts.Statement[] => (ts.isBlock(s) ? s.statements : [s]);

/** Whether a top-level statement leaves the test or function early: return, continue, break, or a skip() call. */
function exits(s: ts.Statement): boolean {
  if (ts.isReturnStatement(s) || ts.isContinueStatement(s) || ts.isBreakStatement(s)) return true;
  return ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && /(^|\.)skip$/.test(s.expression.expression.getText());
}

/** What the scan finds in one source text: a line and the reason per finding. */
function findings(name: string, text: string): string[] {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const at = (n: ts.Node, why: string): void => void out.push(`${name}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${why}`);
  const visit = (n: ts.Node): void => {
    if (ts.isIfStatement(n)) {
      const cond = n.expression.getText(sf);
      for (const branch of [n.thenStatement, n.elseStatement]) {
        if (branch === undefined || ts.isIfStatement(branch)) continue;
        const body = top(branch);
        const exit = body.find(exits);
        if (exit === undefined || HONOURS.test(cond) || body.some((s) => HONOURS.test(s.getText(sf)))) continue;
        const said = exit.getText(sf);
        if (PROBE.test(cond) || (TOOL.test(said) && MISSING.test(said))) at(n, `a toolchain check that stops without missingToolchain: if (${cond.slice(0, 80)})`);
      }
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      const args = n.arguments.map((a) => a.getText(sf)).join(', ');
      if (/(^|\.)(skipIf|runIf)$/.test(callee) && PROBE.test(args)) at(n, `${callee} on a toolchain: ${args.slice(0, 80)}`);
      if (PRINT.test(callee) && args.includes('owner tooling')) at(n, `prints ${BLOCKED} itself: ${callee}(${args.slice(0, 80)})`);
    }
    if (ts.isReturnStatement(n) && n.expression !== undefined && ts.isStringLiteralLike(n.expression) && n.expression.text.includes(BLOCKED)) at(n, `returns a ${BLOCKED} line itself`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('a missing native toolchain is handled only by missingToolchain (strict-native-class)', () => {
  it('no package source or test prints blocked (owner tooling) or stops on a missing toolchain outside the helper', () => {
    const all = files();
    expect(all).toContain(HELPER);
    expect(all).toContain('packages/dragon/test/native-backends.test.ts');
    const found = all.filter((f) => f !== HELPER && f !== SELF).flatMap((f) => findings(f, readFileSync(join(root, f), 'utf8')));
    expect(found).toEqual([]);
  });

  it('catches every planted shape of the class, the pre-fix native-backends.test.ts among them, and passes the helper-routed ones', () => {
    const text = readFileSync(join(root, 'packages/dragon/test/planted/strict-native.txt'), 'utf8');
    const sections = text.split(/^\/\/ ==== /m).slice(1).map((s) => {
      const nl = s.indexOf('\n');
      return { title: s.slice(0, nl), body: s.slice(nl + 1) };
    });
    expect(sections.filter((s) => s.title.startsWith('flag:')).length).toBeGreaterThanOrEqual(10);
    expect(sections.filter((s) => s.title.startsWith('clean:')).length).toBeGreaterThanOrEqual(4);
    for (const s of sections) {
      const n = findings('planted.ts', s.body).length;
      if (s.title.startsWith('flag:')) expect(n, s.title).toBeGreaterThan(0);
      else expect(n, s.title).toBe(0);
    }
  });
});
