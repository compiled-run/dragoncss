// TXT1a-2 phase R, slice R2a: the device apps measure and draw text through their HarfBuzz shim. The emitted bridge builds the
// translated deviceShapedMeasurer over the shaper the host gives it and draws each line piece's shaped glyphs (pieceGlyphs); the
// host reference the expected dumps are projected with is that measurer over the WASM shim. Ahem has no kerning, so every native
// case lays out exactly as it did with the font-data measurer, and draws one glyph per code point at its old x, to well under a LayoutUnit.
import { describe, expect, it } from 'vitest';
import type { LayoutInput, TextLeaf } from '@dragon/layout';
import { AHEM_FACE_ID, AHEM_FONT_DATA, coveredIndex, layout, measurerFor, NO_ENGINE_FAULTS, pieceGlyphs, platformFontSize, zoomInput } from '@dragon/layout';
import { emitNativeSupport, programInput } from 'dragon';
import { BACKEND_OF, expectedEngine, hostSources, nativeCases, referenceMeasurer } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { deviceDprs } from '../src/targets.ts';

const fontData = (() => {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(m.detail);
  return m.measurer;
})();

/** Every text leaf under a layout tree, in document order. */
function textLeaves(node: unknown, out: TextLeaf[] = []): TextLeaf[] {
  if (typeof node !== 'object' || node === null) return out;
  const n = node as { kind?: unknown; children?: unknown };
  if (n.kind === 'text') out.push(node as TextLeaf);
  if (Array.isArray(n.children)) for (const c of n.children) textLeaves(c, out);
  return out;
}

const source = (target: 'ios' | 'android', path: string): string => {
  const f = hostSources(target, 'x').find((x) => x.path === path);
  if (f === undefined) throw new Error(`${target} has no ${path}`);
  return f.text;
};

describe('the emitted bridge', () => {
  for (const [backend, file] of [['uikit', 'Support/DragonBridge.swift'], ['android-views', 'kotlin/dev/dragon/views/DragonBridge.kt']] as const) {
    it(`${backend}: measures with the translated shaped measurer over the host's shaper, and with font data only without one`, () => {
      const text = emitNativeSupport(backend).find((f) => f.path === file)?.text ?? '';
      expect(text).toMatch(/var shaper: GlyphShaper\? = nil|var shaper: GlyphShaper\? = null/);
      const shaped = text.indexOf('platform_deviceShapedMeasurer(');
      const fallback = text.indexOf('text_fontDataMeasurer(');
      expect(shaped).toBeGreaterThan(0);
      expect(fallback).toBeGreaterThan(shaped);
      expect(text.slice(shaped, fallback)).toContain('shaped = true');
      expect(text.slice(fallback)).toMatch(/shaped = false/);
      // Product code: the bridge never names the parity host's shim.
      expect(text).not.toMatch(/DragonShaper|DragonHB/);
    });
  }
  for (const [backend, file] of [['uikit', 'Support/DragonTree.swift'], ['android-views', 'kotlin/dev/dragon/views/DragonTree.kt']] as const) {
    it(`${backend}: draws each line piece's shaped glyph ids and pen positions when the bridge shapes`, () => {
      const text = emitNativeSupport(backend).find((f) => f.path === file)?.text ?? '';
      const branch = text.indexOf('if (bridge.shaped) {') >= 0 ? text.indexOf('if (bridge.shaped) {') : text.indexOf('if bridge.shaped {');
      expect(branch).toBeGreaterThan(0);
      const call = text.indexOf('shaping_pieceGlyphs(measurer, ', branch);
      const cmap = text.indexOf('bridge.glyph(', branch);
      expect(call).toBeGreaterThan(branch);
      expect(cmap).toBeGreaterThan(call);
      expect(text.slice(call, call + 200)).toContain('piece.start, piece.visibleEnd)');
      expect(text.slice(branch, cmap)).toMatch(/g\.xs/);
    });
  }
});

describe('the host apps', () => {
  it('give the bridge the shim as its shaper after the shim check and before the bridge is first used, and stop unless it shapes', () => {
    const main = source('ios', 'Host/main.swift');
    const order = ['dragonCheckShim()', 'DragonBridge.shaper = dragonGlyphShaper()', 'let bridge = DragonBridge.shared', 'if !bridge.shaped { fatalError(', 'bridge.record(platform: "ios")'].map((s) => main.indexOf(s));
    expect(order.every((i) => i > 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(main.indexOf('DragonBridge.shared')).toBe(order[2] as number + 'let bridge = '.length);
    const activity = source('android', 'kotlin/dev/dragon/host/DragonActivity.kt');
    const korder = ['dragonCheckShim(this)', 'DragonBridge.shaper = dragonGlyphShaper(this)', 'bridge = DragonBridge.shared(this)', 'check(bridge.shaped)', 'bridge.record("android")'].map((s) => activity.indexOf(s));
    expect(korder.every((i) => i > 0), JSON.stringify(korder)).toBe(true);
    expect([...korder].sort((a, b) => a - b)).toEqual(korder);
  });
  it("adapt the host DragonShaper to the engine's GlyphShaper: UTF-16 units on iOS, uint32 feature integers wrapped to the JNI's int on Android", () => {
    const swift = source('ios', 'Host/DragonShaper.swift');
    expect(swift).toContain('func dragonGlyphShaper() -> GlyphShaper {');
    expect(swift).toContain('units: text.u,');
    const kotlin = source('android', 'kotlin/dev/dragon/host/DragonShaper.kt');
    expect(kotlin).toContain('fun dragonGlyphShaper(ctx: Context): GlyphShaper {');
    expect(kotlin).toContain('dragonFeatureInt(features[it])');
    // FEATURE_TO_END (4294967295) is -1 as an int, as the probe passes it.
    expect(kotlin).toContain('v <= 4294967295.0');
  });
});

describe('the native reference measurer', () => {
  const font = { family: AHEM_FACE_ID, size: 16 } as const;
  it('is the shaped measurer: it shapes Ahem, which the font-data measurer does not', () => {
    expect(referenceMeasurer().shaped('Ahem', font as never).ok).toBe(true);
    expect(fontData.shaped('Ahem', font as never).ok).toBe(false);
    expect(expectedEngine().measurer.shaped('Ahem', font as never).ok).toBe(true);
  });
  it('lays out every native case at every device DPR exactly as the font-data measurer', () => {
    let layouts = 0;
    for (const n of nativeCases()) {
      for (const target of ['ios', 'android'] as const) {
        const program = n.programs[BACKEND_OF[target]];
        for (const dpr of deviceDprs(target)) {
          const input: LayoutInput = programInput(program, n.case.environment.viewport, dpr);
          expect(layout(input, referenceMeasurer()), `${n.case.id} ${target} @${dpr}`).toEqual(layout(input, fontData));
          layouts++;
        }
      }
    }
    expect(layouts).toBeGreaterThan(500);
  });
  it("gives every native case's text one glyph per code point, at the font-data pen to within 1/1024 device px", () => {
    // The pens differ only by rounding: 16.16 advances summed exactly against float32 sums (0.00029 device px at worst, 2026-10-10).
    let glyphs = 0;
    for (const n of nativeCases()) {
      for (const target of ['ios', 'android'] as const) {
        for (const dpr of deviceDprs(target)) {
          const zoomed = zoomInput(programInput(n.programs[BACKEND_OF[target]], n.case.environment.viewport, dpr), NO_ENGINE_FAULTS);
          const m = referenceMeasurer();
          for (const leaf of textLeaves(zoomed.root)) {
            const cps = [...leaf.text];
            const f = { family: leaf.font.family, size: leaf.font.size };
            const g = pieceGlyphs(m, leaf.text, f as never, 0, cps.length);
            if (!g.ok) throw new Error(`${n.case.id} ${leaf.id}: ${g.reason}`);
            expect(g.glyphs.length, `${n.case.id} ${leaf.id}`).toBe(cps.length);
            // The emitted font-data pen: float sums of the instance size times each hmtx advance / unitsPerEm.
            const size = platformFontSize(leaf.font.size);
            let pen = 0;
            cps.forEach((ch, k) => {
              expect(Math.abs((g.xs[k] as number) - pen), `${n.case.id} ${leaf.id} glyph ${k} @${dpr}`).toBeLessThan(1 / 1024);
              pen = Math.fround(pen + Math.fround((size * (AHEM_FONT_DATA.advances[coveredIndex(ch.codePointAt(0) as number)] as number)) / AHEM_FONT_DATA.unitsPerEm));
              glyphs++;
            });
          }
        }
      }
    }
    expect(glyphs).toBeGreaterThan(1000);
  });
});
