// EMS (notes/T046-paint-spec.md §3 item 5): every exported function of the paint seam files is an engine root, and the paint
// vectors (packages/layout/paint-vectors/<feature>/vectors.json) are the TypeScript harness's results, reproduced by the native
// harness bit for bit whenever a suite has cases.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { runUnitsCase } from '../harness/harness.ts';
import { committedFiles, runTarget } from '../src/check.ts';
import type { Corpus, Suite } from '../src/corpus.ts';
import { digestsOf, split } from '../src/corpus.ts';
import { engineFiles, engineRoots, LAYOUT_SRC, PAINT_ROOT_FILES, ROOT } from '../src/generate.ts';

const features = PAINT_ROOT_FILES.filter((f) => f.startsWith('paint-')).map((f) => f.slice('paint-'.length, -'.ts'.length));
type Vectors = { readonly feature: string; readonly cases: number; readonly lines: readonly string[]; readonly expected: readonly string[] };
const vectors = (f: string): Vectors => JSON.parse(readFileSync(join(ROOT, 'packages/layout/paint-vectors', f, 'vectors.json'), 'utf8')) as Vectors;

describe('paint roots (EMS)', () => {
  it('names paint.ts and the six paint seam files, each an engine file', () => {
    expect(PAINT_ROOT_FILES).toEqual(['paint.ts', 'paint-radius.ts', 'paint-shadow.ts', 'paint-gradient.ts', 'paint-transform.ts', 'paint-dash.ts', 'paint-scrollbar.ts']);
    const files = engineFiles();
    for (const f of PAINT_ROOT_FILES) expect(files, f).toContain(join(LAYOUT_SRC, f));
  });
  it('refuses a file list without one of the rt or paint root files, naming it', () => {
    // layout.ts alone imports neither the rt files nor the paint seam files, so the first root file is missing from the program.
    expect(() => engineRoots([join(LAYOUT_SRC, 'layout.ts')])).toThrow('the root file rt-easing.ts is not an engine file');
    const allButPaint = [join(LAYOUT_SRC, 'layout.ts'), ...['rt-easing.ts', 'rt-timing.ts', 'rt-interpolate.ts'].map((f) => join(LAYOUT_SRC, f))];
    expect(() => engineRoots(allButPaint)).toThrow('the root file paint.ts is not an engine file');
  });
  it('makes every exported function of the paint seam files a root, and nothing else of them', () => {
    const roots = engineRoots(engineFiles());
    for (const f of PAINT_ROOT_FILES) {
      const src = ts.createSourceFile(f, readFileSync(join(LAYOUT_SRC, f), 'utf8'), ts.ScriptTarget.ES2022);
      const exported = src.statements.flatMap((st) => (ts.isFunctionDeclaration(st) && st.name !== undefined && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? [st.name.text] : []));
      expect(roots.filter((r) => r.file === join(LAYOUT_SRC, f)).map((r) => r.name), f).toEqual(exported);
    }
  });
  it('keeps the Skia references unrooted until a paint seam file imports them', () => {
    const roots = engineRoots(engineFiles());
    for (const f of ['paint-blur.ts', 'paint-dither.ts']) expect(roots.filter((r) => r.file === join(LAYOUT_SRC, f))).toEqual([]);
  });
});

describe('paint vectors (EMS)', () => {
  it('hold one suite per feature, each the TypeScript harness results of its lines', () => {
    for (const f of features) {
      const v = vectors(f);
      expect(v.feature).toBe(f);
      expect(v.cases).toBe(v.lines.length);
      expect(v.lines.map(runUnitsCase), f).toEqual(v.expected);
      const inputs = join(ROOT, 'packages/layout/paint-vectors', f, 'inputs.jsonl');
      expect(v.lines).toEqual(existsSync(inputs) ? readFileSync(inputs, 'utf8').split('\n').filter((l) => l.length > 0) : []);
    }
  });
  it('are routed through the translated harness (units mode) on both targets', () => {
    for (const [target, file] of [['swift', 'Sources/DragonLayoutHarness/Harness.swift'], ['kotlin', 'harness/dev/dragon/layout/Harness.kt']] as const) {
      expect(committedFiles(target).get(file), target).toContain('harness_paintResult(name, a)');
    }
    expect(runUnitsCase('["paint:none:none"]')).toBe('["harness-error","unknown function paint:none:none"]');
  });
  it('run natively bit for bit, with a routing probe that reaches paintResult on every target', () => {
    const probe = ['["paint:none:none"]'];
    const suites: Suite[] = [
      { name: 'paint-routing', mode: 'units', lines: probe, expected: probe.map(runUnitsCase) },
      ...features.map((f): Suite => ({ name: `paint-${f}`, mode: 'units', lines: vectors(f).lines, expected: vectors(f).expected })),
    ];
    const d = digestsOf(suites);
    const corpus: Corpus = { suites, vectors: [], engineSplit: split([]), digest: d.digest, digests: d.digests };
    for (const target of ['swift', 'kotlin'] as const) {
      const r = runTarget(target, corpus, committedFiles(target), `test-paint-${target}`);
      if (r.status === 'blocked (owner tooling)') continue;
      expect(r.suites.map((s) => `${s.name} ${s.pass}/${s.total}`)).toEqual(suites.map((s) => `${s.name} ${s.lines.length}/${s.lines.length}`));
      expect(r.status).toBe('pass');
    }
  }, 1_200_000);
});
