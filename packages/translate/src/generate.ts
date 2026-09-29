// Lowers the engine and the harness, and renders every generated native file in memory, in sorted order.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { KotlinEmitter } from './emit-kotlin.ts';
import { stringNames, SwiftEmitter, swiftStringLiteral } from './emit-swift.ts';
import type { Fault } from './faults.ts';
import { plantIr, preludeFault } from './faults.ts';
import type { ClassDecl, Decl, Program, UnionDecl } from './ir.ts';
import type { Violation } from './lower.ts';
import { cmp, createProgram, Lowerer, stemOf } from './lower.ts';
import { kotlinHost, kotlinPrelude } from './prelude-kotlin.ts';
import { swiftHost, swiftPrelude } from './prelude-swift.ts';
import { kotlinMain, swiftMain, swiftPackage } from './templates.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const LAYOUT_SRC = join(ROOT, 'packages/layout/src');
export const HARNESS_FILE = join(ROOT, 'packages/translate/harness/harness.ts');
export const HOST_FILE = join(ROOT, 'packages/translate/harness/host.ts');
export const SWIFT_DIR = join(ROOT, 'packages/layout/generated/swift');
export const KOTLIN_DIR = join(ROOT, 'packages/layout/generated/kotlin');

/** The only engine file the subset exempts: devices get typed input, and every input passes it in TypeScript first. */
export const EXEMPT = ['validate.ts'];

export function engineFiles(): string[] {
  return readdirSync(LAYOUT_SRC).filter((f) => f.endsWith('.ts') && !EXEMPT.includes(f)).sort().map((f) => join(LAYOUT_SRC, f));
}

/** Translator sources whose text decides the output; their digest is in every generated header. */
const TRANSLATOR_FILES = ['ir.ts', 'lower.ts', 'walk.ts', 'emit-swift.ts', 'emit-kotlin.ts', 'prelude-swift.ts', 'prelude-kotlin.ts', 'faults.ts', 'generate.ts', 'templates.ts'];

export function translatorDigest(): string {
  const h = createHash('sha256');
  for (const f of TRANSLATOR_FILES) h.update(f).update('\0').update(readFileSync(join(ROOT, 'packages/translate/src', f)));
  return h.digest('hex').slice(0, 16);
}

/**
 * The paint seam files (EMS, notes/T046-paint-spec.md §3 item 5): every exported function in them is an engine root. The Skia
 * references (paint-blur.ts, paint-dither.ts, paint-aa.ts) are reached through them once a paint package imports them.
 */
export const PAINT_ROOT_FILES = ['paint.ts', 'paint-radius.ts', 'paint-shadow.ts', 'paint-gradient.ts', 'paint-transform.ts', 'paint-dash.ts', 'paint-scrollbar.ts'];

/** The engine roots (native-strategy.md section 1.3): everything they reach is translated. */
export function engineRoots(files: readonly string[]): { file: string; name: string }[] {
  const at = (f: string): string => join(LAYOUT_SRC, f);
  const roots = [
    { file: at('layout.ts'), name: 'layout' },
    { file: at('layout.ts'), name: 'layoutWithFaults' },
    { file: at('layout.ts'), name: 'absoluteRects' },
    { file: at('platform.ts'), name: 'measurerFor' },
    { file: at('text.ts'), name: 'ahemMeasurer' },
    // The one pixel-snap rule (native-strategy.md section 3.3): native lanes snap engine rects to device px with it.
    { file: at('snap.ts'), name: 'snapEdges' },
    { file: at('snap.ts'), name: 'snapRect' },
  ];
  const program = createProgram(files);
  const units = program.getSourceFile(at('units.ts')) as ts.SourceFile;
  for (const st of units.statements) {
    if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) roots.push({ file: at('units.ts'), name: st.name.text });
  }
  // Paint roots (EMS, RT-13 style): every exported function of the paint seam files.
  for (const f of PAINT_ROOT_FILES) {
    const paint = program.getSourceFile(at(f));
    if (paint === undefined) throw new Error(`the paint seam file ${f} is not an engine file`);
    for (const st of paint.statements) {
      if (ts.isFunctionDeclaration(st) && st.name !== undefined && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) roots.push({ file: at(f), name: st.name.text });
    }
  }
  return roots;
}

export type Lowered = { readonly engine: Program; readonly harness: Program };

export class TranslateError extends Error {
  readonly violations: readonly Violation[];
  constructor(violations: readonly Violation[]) {
    super(`translation failed:\n${violations.map((v) => `${v.file}:${v.line} ${v.message}`).join('\n')}`);
    this.violations = violations;
  }
}

export function lowerAll(): Lowered {
  const files = engineFiles();
  const roots = engineRoots(files);
  const eProgram = createProgram(files);
  const el = new Lowerer(eProgram, { files, hostFile: null, root: ROOT, collect: true, roots });
  const engine = el.lower();
  if (el.violations.length > 0) throw new TranslateError(el.violations);
  const hFiles = [...files, HARNESS_FILE];
  const hProgram = createProgram([...hFiles, HOST_FILE]);
  const hl = new Lowerer(hProgram, { files: hFiles, hostFile: HOST_FILE, root: ROOT, collect: true, roots: [...roots, { file: HARNESS_FILE, name: 'runEngineCase' }, { file: HARNESS_FILE, name: 'runUnitsCase' }, { file: HARNESS_FILE, name: 'runLibraryCase' }, { file: HARNESS_FILE, name: 'runSnapCase' }] });
  const harness = hl.lower();
  if (hl.violations.length > 0) throw new TranslateError(hl.violations);
  // The harness may use only the engine as translated for the roots: no extra engine declaration, no new union of engine classes.
  const engineNames = new Set(engine.decls.map((d) => d.name));
  const harnessRel = relative(ROOT, HARNESS_FILE);
  for (const d of harness.decls) {
    if (d.kind === 'union') {
      const harnessOnly = d.members.every((m) => classFile(harness, m) === harnessRel);
      if (!harnessOnly && !engineNames.has(d.name)) throw new Error(`the harness introduces union ${d.name} over engine classes`);
    } else if (d.loc.file !== harnessRel && !engineNames.has(d.name)) throw new Error(`the harness reaches ${d.name}, which the engine roots do not`);
  }
  return { engine, harness };
}

function classFile(p: Program, name: string): string {
  const d = p.decls.find((x) => x.kind === 'class' && x.name === name) as ClassDecl | undefined;
  return d === undefined ? '' : d.loc.file;
}

function fileOf(d: Decl): string {
  return d.kind === 'union' ? '' : d.loc.file;
}

/** Declarations of one source file, classes first, each group in source order. */
function declsIn(p: Program, file: string): Decl[] {
  const ds = p.decls.filter((d) => fileOf(d) === file);
  const line = (d: Decl): number => (d.kind === 'union' ? 0 : d.loc.line);
  const rank = (d: Decl): number => (d.kind === 'class' ? 0 : d.kind === 'const' ? 1 : 2);
  return ds.sort((a, b) => rank(a) - rank(b) || line(a) - line(b) || cmp(a.name, b.name));
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function header(comment: string, what: string, digest: string): string {
  return `${comment} GENERATED by @dragon/translate from ${what}, translator ${digest}. Do not edit.\n`;
}

function sourceWhat(p: Program, file: string): string {
  const s = p.sources.find((x) => x.file === file);
  return `${file} (sha256 ${s === undefined ? sha(readFileSync(join(ROOT, file), 'utf8')) : s.sha256})`;
}

function sourcesDigest(p: Program): string {
  return sha(p.sources.map((s) => `${s.file} ${s.sha256}`).join('\n')).slice(0, 16);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type Files = Map<string, string>;

/** Every generated Swift file, relative to packages/layout/generated/swift. */
export function swiftFiles(l: Lowered, fault: Fault | null = null): Files {
  const digest = translatorDigest();
  const engine = plantIr(l.engine, fault);
  const harness = plantIr(l.harness, fault);
  const out: Files = new Map();
  const classes = new Map<string, ClassDecl>();
  for (const d of harness.decls) if (d.kind === 'class') classes.set(d.name, d);
  const engineUnions = new Map<string, UnionDecl>();
  for (const d of engine.decls) if (d.kind === 'union') engineUnions.set(d.name, d);
  const S = stringNames(engine.strings);
  const em = new SwiftEmitter({ access: 'public', stringsEnum: 'S', strings: S }, classes);
  const src = 'Sources/DragonLayout';
  out.set('Package.swift', `// swift-tools-version:5.9\n${header('//', 'the translator templates', digest)}${swiftPackage()}`);
  out.set(`${src}/Prelude.swift`, header('//', 'the Swift prelude (native-strategy.md 1.4-1.6)', digest) + swiftPrelude(preludeFault(fault)));
  out.set(`${src}/Strings.swift`, header('//', `the string literals of packages/layout/src (sources ${sourcesDigest(engine)})`, digest)
    + `public enum S {\n${[...S.entries()].map(([s, n]) => `  public static let ${n} = JsString(${swiftStringLiteral(s)})`).join('\n')}\n}\n`);
  out.set(`${src}/Unions.swift`, header('//', `the union types of packages/layout/src (sources ${sourcesDigest(engine)})`, digest)
    + [...engineUnions.values()].map((u) => em.unionDecl(u)).join('\n\n') + '\n');
  for (const s of engine.sources) {
    const ds = declsIn(engine, s.file);
    if (ds.length === 0) continue;
    const body = ds.map((d) => (d.kind === 'class' ? em.classDecl(harnessClass(classes, d), engineUnions) : d.kind === 'func' ? em.funcDecl(d) : d.kind === 'const' ? em.constDecl(d) : '')).join('\n\n');
    out.set(`${src}/${cap(stemOf(s.file))}.swift`, header('//', sourceWhat(engine, s.file), digest) + body + '\n');
  }
  // Harness: translated like the engine, internal to the harness executable.
  const harnessRel = relative(ROOT, HARNESS_FILE);
  const HS = stringNames(harness.strings);
  const hem = new SwiftEmitter({ access: '', stringsEnum: 'HS', strings: HS }, classes);
  const hsrc = 'Sources/DragonLayoutHarness';
  const hUnions = harness.decls.filter((d): d is UnionDecl => d.kind === 'union' && !engineUnions.has(d.name));
  const hDecls = declsIn(harness, harnessRel);
  const importLine = '#if canImport(DragonLayout)\nimport DragonLayout\n#endif\n\n';
  out.set(`${hsrc}/Harness.swift`, header('//', sourceWhat(harness, harnessRel), digest) + importLine
    + `enum HS {\n${[...HS.entries()].map(([s, n]) => `  static let ${n} = JsString(${swiftStringLiteral(s)})`).join('\n')}\n}\n\n`
    + [...hUnions.map((u) => hem.unionDecl(u)), ...hDecls.map((d) => (d.kind === 'class' ? hem.classDecl(d, new Map(hUnions.map((u) => [u.name, u]))) : d.kind === 'func' ? hem.funcDecl(d) : d.kind === 'const' ? hem.constDecl(d) : ''))].join('\n\n') + '\n');
  out.set(`${hsrc}/Host.swift`, header('//', `${relative(ROOT, HOST_FILE)} (sha256 ${sha(readFileSync(HOST_FILE, 'utf8'))}), host helpers`, digest) + importLine + swiftHost());
  out.set(`${hsrc}/main.swift`, header('//', 'the translator templates', digest) + importLine + swiftMain());
  return new Map([...out.entries()].sort((a, b) => cmp(a[0], b[0])));
}

function harnessClass(classes: ReadonlyMap<string, ClassDecl>, d: ClassDecl): ClassDecl {
  return classes.get(d.name) ?? d;
}

/** Every generated Kotlin file, relative to packages/layout/generated/kotlin. */
export function kotlinFiles(l: Lowered, fault: Fault | null = null): Files {
  const digest = translatorDigest();
  const engine = plantIr(l.engine, fault);
  const harness = plantIr(l.harness, fault);
  const out: Files = new Map();
  const engineUnions = new Map<string, UnionDecl>();
  for (const d of engine.decls) if (d.kind === 'union') engineUnions.set(d.name, d);
  const harnessRel = relative(ROOT, HARNESS_FILE);
  const hUnions = harness.decls.filter((d): d is UnionDecl => d.kind === 'union' && !engineUnions.has(d.name));
  const allUnions = new Map<string, UnionDecl>([...engineUnions, ...hUnions.map((u) => [u.name, u] as const)]);
  const em = new KotlinEmitter(allUnions);
  const pkg = 'src/main/kotlin/dev/dragon/layout';
  out.set(`${pkg}/Prelude.kt`, header('//', 'the Kotlin prelude (native-strategy.md 1.4-1.6)', digest) + kotlinPrelude(preludeFault(fault)));
  out.set(`${pkg}/Unions.kt`, header('//', `the union types of packages/layout/src (sources ${sourcesDigest(engine)})`, digest)
    + 'package dev.dragon.layout\n\n' + [...engineUnions.values()].map((u) => em.unionDecl(u)).join('\n\n') + '\n');
  for (const s of engine.sources) {
    const ds = declsIn(engine, s.file);
    if (ds.length === 0) continue;
    const body = ds.map((d) => em.decl(d)).join('\n\n');
    out.set(`${pkg}/${cap(stemOf(s.file))}.kt`, header('//', sourceWhat(engine, s.file), digest) + em.fileHeader() + body + '\n');
  }
  const hpkg = 'harness/dev/dragon/layout';
  const hDecls = declsIn(harness, harnessRel);
  out.set(`${hpkg}/Harness.kt`, header('//', sourceWhat(harness, harnessRel), digest) + em.fileHeader()
    + [...hUnions.map((u) => em.unionDecl(u)), ...hDecls.map((d) => em.decl(d))].join('\n\n') + '\n');
  out.set(`${hpkg}/Host.kt`, header('//', `${relative(ROOT, HOST_FILE)} (sha256 ${sha(readFileSync(HOST_FILE, 'utf8'))}), host helpers`, digest) + kotlinHost());
  out.set(`${hpkg}/Main.kt`, header('//', 'the translator templates', digest) + kotlinMain());
  return new Map([...out.entries()].sort((a, b) => cmp(a[0], b[0])));
}

/** Writes files under dir and removes any other file there, so the directory holds exactly the generated set. */
export function writeTree(dir: string, files: Files): void {
  const existing = listTree(dir);
  for (const f of existing) if (!files.has(f)) rmSync(join(dir, f));
  for (const [f, text] of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    const path = join(dir, f);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
  }
}

/**
 * The build output folders of a generated package root, which are not generated source: .build and .swiftpm of the SwiftPM package
 * and build of the Kotlin tree. They are ignored only at that root; a dot-file or a build folder anywhere else is listed, so a
 * hand-written file there fails the freshness comparison (T007 must-fix).
 */
export function rootBuildDirs(dir: string): readonly string[] {
  if (dir === SWIFT_DIR) return ['.build', '.swiftpm'];
  if (dir === KOTLIN_DIR) return ['build'];
  return [];
}

export function listTree(dir: string, ignoredAtRoot: readonly string[] = rootBuildDirs(dir)): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (d === dir && e.isDirectory() && ignoredAtRoot.includes(e.name)) continue;
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort(cmp);
}
