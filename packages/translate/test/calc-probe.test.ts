// T009 step 0 (notes/T006-value-model-spec.md §4): a recursive union (the value model's CalcExpr) is inside the subset and
// translates to Swift and Kotlin that compile and compute the TypeScript result bit for bit, before any engine code relies on it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClassDecl, FuncDecl, UnionDecl } from '../src/ir.ts';
import { KotlinEmitter } from '../src/emit-kotlin.ts';
import { stringNames, SwiftEmitter, swiftStringLiteral } from '../src/emit-swift.ts';
import { createProgram, Lowerer } from '../src/lower.ts';
import { kotlinTool } from '../src/native.ts';
import { kotlinPrelude } from '../src/prelude-kotlin.ts';
import { swiftPrelude } from '../src/prelude-swift.ts';
import { checkSubset } from '../src/subset.ts';

const PROBE = `
export type CalcPx = { readonly kind: 'px'; readonly value: number };
export type CalcPercent = { readonly kind: 'percent'; readonly value: number };
export type CalcNumber = { readonly kind: 'number'; readonly value: number };
export type ViewportLength = { readonly kind: 'viewport'; readonly value: number; readonly axis: 'width' | 'height' | 'min' | 'max' };
export type EmLength = { readonly kind: 'em'; readonly value: number; readonly fontSize: CalcExpr };
export type CalcSum = { readonly kind: 'sum'; readonly terms: readonly CalcExpr[] };
export type CalcProduct = { readonly kind: 'product'; readonly terms: readonly CalcExpr[] };
export type CalcInvert = { readonly kind: 'invert'; readonly term: CalcExpr };
export type CalcMin = { readonly kind: 'min'; readonly terms: readonly CalcExpr[] };
export type CalcMax = { readonly kind: 'max'; readonly terms: readonly CalcExpr[] };
export type CalcClamp = { readonly kind: 'clamp'; readonly min: CalcExpr; readonly value: CalcExpr; readonly max: CalcExpr };
export type PixelsAndPercent = { readonly kind: 'pixels-and-percent'; readonly pixels: number; readonly percent: number; readonly explicitPixels: boolean; readonly explicitPercent: boolean };
export type CalcExpr = CalcPx | CalcPercent | CalcNumber | ViewportLength | EmLength | CalcSum | CalcProduct | CalcInvert | CalcMin | CalcMax | CalcClamp | PixelsAndPercent;
export type LengthCalc = { readonly kind: 'calc'; readonly expr: CalcExpr; readonly range: 'all' | 'non-negative' };
export type SizeValue = { readonly kind: 'auto' } | CalcPx | LengthCalc;

export function hasPercent(e: CalcExpr): boolean {
  switch (e.kind) {
    case 'percent':
      return true;
    case 'pixels-and-percent':
      return e.explicitPercent;
    case 'em':
      return hasPercent(e.fontSize);
    case 'invert':
      return hasPercent(e.term);
    case 'clamp':
      return hasPercent(e.min) || hasPercent(e.value) || hasPercent(e.max);
    case 'sum':
    case 'product':
    case 'min':
    case 'max':
      for (const t of e.terms) if (hasPercent(t)) return true;
      return false;
    default:
      return false;
  }
}

export function evaluate(e: CalcExpr, basis: number): number {
  switch (e.kind) {
    case 'px':
    case 'number':
      return Math.fround(e.value);
    case 'percent':
      return Math.fround(Math.fround(e.value / 100) * basis);
    case 'viewport':
      return Math.fround(e.value * (e.axis === 'width' ? 4 : 3));
    case 'em':
      return Math.fround(e.value * evaluate(e.fontSize, basis));
    case 'pixels-and-percent':
      return Math.fround(e.pixels + Math.fround(Math.fround(e.percent / 100) * basis));
    case 'sum': {
      let total = Math.fround(0);
      for (const t of e.terms) total = Math.fround(total + evaluate(t, basis));
      return total;
    }
    case 'product': {
      let total = Math.fround(1);
      for (const t of e.terms) total = Math.fround(total * evaluate(t, basis));
      return total;
    }
    case 'invert':
      return Math.fround(1 / evaluate(e.term, basis));
    case 'min': {
      let best = evaluate(e.terms[0] as CalcExpr, basis);
      for (const t of e.terms) {
        const v = evaluate(t, basis);
        if (v < best) best = v;
      }
      return best;
    }
    case 'max': {
      let best = evaluate(e.terms[0] as CalcExpr, basis);
      for (const t of e.terms) {
        const v = evaluate(t, basis);
        if (best < v) best = v;
      }
      return best;
    }
    case 'clamp':
    {
      const lo = evaluate(e.min, basis);
      const v = evaluate(e.value, basis);
      const hi = evaluate(e.max, basis);
      const capped = hi < v ? hi : v;
      return capped < lo ? lo : capped;
    }
  }
}

export function resolveSize(v: SizeValue, basis: number): number {
  if (v.kind === 'auto') return -1;
  if (v.kind === 'px') return v.value;
  const r = evaluate(v.expr, basis);
  return v.range === 'non-negative' && r < 0 ? 0 : r;
}

export function probeMain(): readonly number[] {
  const px = (value: number): CalcExpr => ({ kind: 'px', value });
  const pct = (value: number): CalcExpr => ({ kind: 'percent', value });
  const em: CalcExpr = { kind: 'em', value: 1.5, fontSize: { kind: 'sum', terms: [px(10.625), { kind: 'viewport', value: 2, axis: 'min' }] } };
  const nested: CalcExpr = { kind: 'clamp', min: px(30), value: { kind: 'sum', terms: [pct(33.333333), px(0.1), em, { kind: 'product', terms: [px(7), { kind: 'invert', term: { kind: 'number', value: 3 } }] }] }, max: { kind: 'max', terms: [px(20), pct(80)] } };
  const sizes: SizeValue[] = [
    { kind: 'auto' },
    { kind: 'px', value: 12.5 },
    { kind: 'calc', expr: nested, range: 'non-negative' },
    { kind: 'calc', expr: { kind: 'sum', terms: [px(-50), { kind: 'pixels-and-percent', pixels: 1, percent: 0, explicitPixels: true, explicitPercent: true }] }, range: 'non-negative' },
    { kind: 'calc', expr: { kind: 'min', terms: [px(-5), pct(-1)] }, range: 'all' },
  ];
  const out: number[] = [];
  for (const b of [0, 100, 333.5, 1e7]) {
    for (const s of sizes) {
      out.push(resolveSize(s, b));
      out.push(s.kind === 'calc' && hasPercent(s.expr) ? 1 : 0);
    }
  }
  return out;
}
`;

function bits(x: number): string {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  return v.getBigUint64(0).toString(16);
}

function sh(cmd: string, args: readonly string[], cwd: string): string {
  const r = spawnSync(cmd, [...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

describe('step 0: the recursive CalcExpr union translates (T009, notes/T006-value-model-spec.md §4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-calc-probe-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'calc-probe.ts');
  writeFileSync(file, PROBE);
  const lowerer = new Lowerer(createProgram([file]), { files: [file], hostFile: null, root: dir, collect: true, roots: null });
  const program = lowerer.lower();
  const unions = program.decls.filter((d): d is UnionDecl => d.kind === 'union');
  const classes = program.decls.filter((d): d is ClassDecl => d.kind === 'class');
  const funcs = program.decls.filter((d): d is FuncDecl => d.kind === 'func');
  const mainName = (funcs.find((f) => f.name.endsWith('probeMain')) as FuncDecl).name;
  let expected: string[] = [];
  beforeAll(async () => {
    const mod = (await import(file)) as { probeMain: () => readonly number[] };
    expected = mod.probeMain().map(bits);
    expect(expected.length).toBe(40);
  });

  it('the subset checker finds 0 violations and the lowering reports none', () => {
    expect(checkSubset([file])).toEqual([]);
    expect(lowerer.violations).toEqual([]);
    const calc = unions.find((u) => u.members.length === 12);
    expect(calc, unions.map((u) => `${u.name}: ${u.members.join(' ')}`).join('\n')).toBeDefined();
    // Recursive members hold the union itself: em.fontSize, invert.term, clamp.min/value/max and the term arrays.
    const em = classes.find((c) => c.fields.some((f) => f.name === 'fontSize')) as ClassDecl;
    expect(JSON.stringify(em.fields.find((f) => f.name === 'fontSize')?.ty)).toContain((calc as UnionDecl).name);
  });

  it('the Swift translation compiles and returns the TypeScript result bit for bit', () => {
    const S = stringNames(program.strings);
    const em = new SwiftEmitter({ access: '', stringsEnum: 'S', strings: S }, new Map(classes.map((c) => [c.name, c])));
    const unionMap = new Map(unions.map((u) => [u.name, u]));
    const src = [
      swiftPrelude(null),
      `enum S {\n${[...S.entries()].map(([s, n]) => `  static let ${n} = JsString(${swiftStringLiteral(s)})`).join('\n')}\n}`,
      ...unions.map((u) => em.unionDecl(u)),
      ...classes.map((c) => em.classDecl(c, unionMap)),
      ...funcs.map((f) => em.funcDecl(f)),
      `let r = try ${mainName}()\nvar i = 0\nwhile Double(i) < jsLength(r) { print(String(r.items[i].bitPattern, radix: 16)); i += 1 }\n`,
    ].join('\n\n');
    const out = join(dir, 'swift');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'main.swift'), src);
    sh('swiftc', ['-O', '-suppress-warnings', '-o', 'probe', 'main.swift'], out);
    expect(sh(join(out, 'probe'), [], out).trim().split('\n')).toEqual(expected);
  }, 300_000);

  it('the Kotlin translation compiles and returns the TypeScript result bit for bit', () => {
    const tool = kotlinTool();
    expect(tool, 'JDK 17+ and kotlinc are required (docs/decisions.md, Native lanes)').not.toBeNull();
    const k = new KotlinEmitter(new Map(unions.map((u) => [u.name, u])));
    const src = [
      k.fileHeader().trimEnd(),
      ...unions.map((u) => k.unionDecl(u)),
      ...program.decls.filter((d) => d.kind !== 'union').map((d) => k.decl(d)),
      `fun main() {\n  val r = ${mainName}()\n  var i = 0\n  while (i < r.size) { println(java.lang.Long.toHexString(java.lang.Double.doubleToRawLongBits(r[i]))); i += 1 }\n}\n`,
    ].join('\n\n');
    const out = join(dir, 'kotlin');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'Probe.kt'), src);
    writeFileSync(join(out, 'Prelude.kt'), kotlinPrelude(null));
    const env = { ...process.env, JAVA_HOME: (tool as { javaHome: string }).javaHome };
    const r = spawnSync((tool as { kotlinc: string }).kotlinc, ['-nowarn', '-include-runtime', '-d', 'probe.jar', 'Prelude.kt', 'Probe.kt'], { cwd: out, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`kotlinc failed:\n${r.stdout}${r.stderr}`);
    const run = spawnSync(join((tool as { javaHome: string }).javaHome, 'bin/java'), ['-jar', 'probe.jar'], { cwd: out, encoding: 'utf8', env });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim().split('\n')).toEqual(expected);
  }, 600_000);
});
