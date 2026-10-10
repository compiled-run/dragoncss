// TXT1a-2 phase R: the device apps' shaped measurer (platform.ts deviceShapedMeasurer) and line piece glyphs (shaping.ts pieceGlyphs)
// are engine roots, so both apps get them translated; deviceShapedMeasurer reaches shapedText, which hands its local functions on
// as values, which Kotlin names with a callable reference (::f) and Swift by name.
import { describe, expect, it } from 'vitest';
import { engineFiles, engineRoots, kotlinFiles, LAYOUT_SRC, lowerAll, swiftFiles } from '../src/generate.ts';

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
    // A local function that is called, and a local value that is not a function, keep their names.
    const engine = [...kotlin.entries()].filter(([p]) => p.includes('/dev/dragon/layout/') && !p.endsWith('/Prelude.kt')).map(([, t]) => t).join('\n');
    // Every other callable reference in the translated engine names a top-level function (file_name).
    expect((engine.match(/::\w+/g) ?? []).filter((r) => !r.includes('_'))).toEqual(['::item', '::line']);
    expect(file(kotlin, '/Shaping.kt')).toContain('val s: U_ShapedItem_okFalse_ShapedItem_okTrue = itemFor(text, font)');
  });
});
