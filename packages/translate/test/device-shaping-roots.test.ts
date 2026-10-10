// TXT1a-2 phase R: the device apps' shaped measurer (platform.ts deviceShapedMeasurer) and line piece glyphs (shaping.ts pieceGlyphs)
// are engine roots, so both apps get them translated; deviceShapedMeasurer reaches shapedText, which hands its local functions on
// as values, which Kotlin names with a callable reference (::f) and Swift by name.
import { describe, expect, it } from 'vitest';
import { KotlinEmitter } from '../src/emit-kotlin.ts';
import { engineFiles, engineRoots, kotlinFiles, LAYOUT_SRC, lowerAll, swiftFiles } from '../src/generate.ts';
import type { Expr, FuncDecl, Stmt, Ty } from '../src/ir.ts';
import { NUM } from '../src/ir.ts';

const lowered = lowerAll();
const kotlin = kotlinFiles(lowered);
const swift = swiftFiles(lowered);
const file = (files: ReadonlyMap<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (hit === undefined) throw new Error(`no generated ${suffix}`);
  return hit[1];
};

describe('the device shaping roots', () => {
  it('root deviceShapedMeasurer and pieceGlyphs', () => {
    const roots = engineRoots(engineFiles()).map((r) => `${r.file.slice(LAYOUT_SRC.length + 1)} ${r.name}`);
    expect(roots).toEqual(expect.arrayContaining(['platform.ts deviceShapedMeasurer', 'shaping.ts pieceGlyphs', 'shaping.ts latinScopedMeasurer']));
  });
  it('are translated to Swift and Kotlin with the signatures the emitted bridge calls', () => {
    expect(file(swift, '/Platform.swift')).toContain('public func platform_deviceShapedMeasurer(_ faces: JsStringMap<FontData>, _ shaper: GlyphShaper) throws -> TextMeasurer {');
    expect(file(swift, '/Shaping.swift')).toContain('public func shaping_pieceGlyphs(_ measurer: TextMeasurer, _ text: JsString, _ font: TextFont, _ start: Double, _ end: Double) throws -> any U_PieceGlyphs_okFalse_PieceGlyphs_okTrue {');
    expect(file(kotlin, '/Platform.kt')).toContain('fun platform_deviceShapedMeasurer(faces: JsStringMap<FontData>, shaper: GlyphShaper): TextMeasurer {');
    expect(file(kotlin, '/Shaping.kt')).toContain('fun shaping_pieceGlyphs(measurer: TextMeasurer, text: String, font: TextFont, start: Double, end: Double): U_PieceGlyphs_okFalse_PieceGlyphs_okTrue {');
  });
  it('pass a local function on as a value by callable reference in Kotlin, and by name in Swift', () => {
    expect(file(kotlin, '/Shaping.kt')).toContain('  return ShapedText(measurer, ::item, ::line)\n');
    expect(file(swift, '/Shaping.swift')).toContain('  return ShapedText(measurer, item, line)\n');
    // Swift: a function-typed parameter of a stored function type is @escaping, as the local function's own parameter is, so the
    // local function converts to the field's type (parameters are contravariant).
    const swiftShaping = file(swift, '/Shaping.swift');
    expect(swiftShaping).toContain('public let line: (any U_ShapedItem_okFalse_ShapedItem_okTrue, Double, Double, Double, @escaping (Double) throws -> Bool) throws -> any U_LineResult_okFalse_LineResult_okTrue\n');
    expect(swiftShaping).toContain('_ line: @escaping (any U_ShapedItem_okFalse_ShapedItem_okTrue, Double, Double, Double, @escaping (Double) throws -> Bool) throws -> any U_LineResult_okFalse_LineResult_okTrue)');
    expect(swiftShaping).toContain('func line(_ shaped: any U_ShapedItem_okFalse_ShapedItem_okTrue, _ start: Double, _ breakOffset: Double, _ available: Double, _ isBreakable: @escaping (Double) throws -> Bool) throws');
    // No function type anywhere in the Swift takes a function-typed parameter that is not @escaping.
    const all = [...swift.values()].join('\n');
    expect(all.match(/[(,] \((?:[^()]|\([^()]*\))*\) throws ->/g)?.filter((m) => !m.includes('@escaping')) ?? []).toEqual([]);
    // A local function that is called, and a local value that is not a function, keep their names.
    const engine = [...kotlin.entries()].filter(([p]) => p.includes('/dev/dragon/layout/') && !p.endsWith('/Prelude.kt')).map(([, t]) => t).join('\n');
    // Every other callable reference in the translated engine names a top-level function (file_name).
    expect((engine.match(/::\w+/g) ?? []).filter((r) => !r.includes('_'))).toEqual(['::item', '::line']);
    expect(file(kotlin, '/Shaping.kt')).toContain('val s: U_ShapedItem_okFalse_ShapedItem_okTrue = itemFor(text, font)');
  });
});

describe('the Kotlin emitter', () => {
  const loc = { file: 't.ts', line: 1 };
  const fnTy: Ty = { k: 'fn', params: [], ret: NUM };
  const local = (name: string, ty: Ty): Expr => ({ ty, e: 'local', name });
  const use = (name: string, ty: Ty): Stmt => ({ s: 'let', name: `use_${name}_${Math.random().toString(36).slice(2, 6)}`, ty, mutable: false, init: local(name, ty), loc });
  it('names a local function by callable reference only where no block-local value shadows it', () => {
    const body: Stmt[] = [
      { s: 'localFunc', name: 'f', params: [], ret: NUM, body: [{ s: 'return', e: { ty: NUM, e: 'num', value: 1 }, loc }], loc },
      { s: 'if', cond: { ty: { k: 'bool' }, e: 'bool', value: true }, then: [{ s: 'let', name: 'f', ty: NUM, mutable: false, init: { ty: NUM, e: 'num', value: 2 }, loc }, use('f', NUM)], else: null, loc },
      { s: 'forOf', name: 'f', ty: NUM, iter: { ty: { k: 'array', elem: NUM }, e: 'arr', items: [] } as Expr, body: [use('f', NUM)], loc },
      use('f', fnTy),
    ];
    const fn: FuncDecl = { kind: 'func', name: 'g', params: [], ret: { k: 'void' }, body, loc } as FuncDecl;
    const text = new KotlinEmitter(new Map()).funcDecl(fn);
    const refs = [...text.matchAll(/= (::)?f\n/g)].map((m) => m[0].trim());
    expect(refs).toEqual(['= f', '= f', '= ::f']);
  });
});
