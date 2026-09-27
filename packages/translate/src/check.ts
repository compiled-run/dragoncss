// Freshness, the corpus lock and the per-target runs shared by the CLIs and the tests.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Corpus } from './corpus.ts';
import { CORPUS_SPEC, UNITS_FUNCTIONS } from './corpus.ts';
import type { Fault } from './faults.ts';
import type { Files, Lowered } from './generate.ts';
import { KOTLIN_DIR, kotlinFiles, listTree, ROOT, SWIFT_DIR, swiftFiles } from './generate.ts';
import type { RunResult } from './native.ts';
import { allPass, buildKotlin, buildSwift, kotlinExec, kotlinTool, runSuites, swiftExec, swiftTool } from './native.ts';

export const LOCK = join(ROOT, 'packages/translate/corpus.json');

export type Target = 'swift' | 'kotlin';

export function committedFiles(target: Target): Files {
  const dir = target === 'swift' ? SWIFT_DIR : KOTLIN_DIR;
  return new Map(listTree(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

export function expectedFiles(target: Target, l: Lowered, fault: Fault | null = null): Files {
  return target === 'swift' ? swiftFiles(l, fault) : kotlinFiles(l, fault);
}

/** Paths that differ between the committed tree and a fresh translation (missing, extra or edited). */
export function staleFiles(target: Target, l: Lowered): string[] {
  return diffFiles(expectedFiles(target, l), committedFiles(target));
}

/** Paths missing from have, extra in have, or with different text. */
export function diffFiles(want: Files, have: Files): string[] {
  const out: string[] = [];
  for (const [f, t] of want) if (have.get(f) !== t) out.push(f);
  for (const f of have.keys()) if (!want.has(f)) out.push(f);
  return out.sort();
}

export function lockText(c: Corpus): string {
  const lock = {
    note: 'Written by pnpm run native:gen. The differential corpus: one seed, one size and one generator for every native target (docs/research/native-strategy.md 1.7). Inputs and results are regenerated under packages/translate/out; this digest covers both.',
    seed: CORPUS_SPEC.seed,
    unitsPerFunction: CORPUS_SPEC.unitsPerFunction,
    unitsFunctions: UNITS_FUNCTIONS,
    mutatedVectors: c.vectors.length,
    generatedTrees: CORPUS_SPEC.generatedTrees,
    libraryPerOperation: CORPUS_SPEC.libraryPerOperation,
    cases: Object.fromEntries(c.suites.map((s) => [s.name, s.lines.length])),
    engineSplit: c.engineSplit,
    digests: c.digests,
    digest: c.digest,
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function lockedDigest(): string | null {
  if (!existsSync(LOCK)) return null;
  return (JSON.parse(readFileSync(LOCK, 'utf8')) as { digest: string }).digest;
}

/** Builds and runs one target on the corpus. With a fault, the translation is planted in memory; without, the committed tree runs. */
export function runTarget(target: Target, c: Corpus, files: Files, tag: string, untilFailure = false): RunResult {
  if (target === 'swift') {
    const tool = swiftTool();
    if (tool === null) return { target, status: 'blocked (owner tooling)', toolchain: 'swiftc not found', reason: 'no swiftc on PATH', suites: [], buildSeconds: 0, runSeconds: 0 };
    const b = buildSwift(tool, files);
    const t1 = Date.now();
    const suites = runSuites(c, swiftExec(b.binary), tag, untilFailure);
    return { target, status: allPass(suites) ? 'pass' : 'fail', toolchain: tool.version, reason: null, suites, buildSeconds: b.seconds, runSeconds: (Date.now() - t1) / 1000 };
  }
  const tool = kotlinTool();
  if (tool === null) return { target, status: 'blocked (owner tooling)', toolchain: 'no JDK 17+ or kotlinc', reason: 'install JDK 17 and kotlinc (docs/decisions.md, Native lanes, milestone 2)', suites: [], buildSeconds: 0, runSeconds: 0 };
  const b = buildKotlin(tool, files);
  const t1 = Date.now();
  const suites = runSuites(c, kotlinExec(tool, b.jar), tag, untilFailure);
  return { target, status: allPass(suites) ? 'pass' : 'fail', toolchain: tool.version, reason: null, suites, buildSeconds: b.seconds, runSeconds: (Date.now() - t1) / 1000 };
}
