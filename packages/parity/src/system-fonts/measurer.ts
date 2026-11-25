// The engine's measurer for a target with system faces: the bundled faces through the host's HarfBuzz, as referenceMeasurer has
// them, and each system face the program names through its target's provider (Core Text on iOS, the image's file on Android).
import type { FontData, FontLengths, FontMetrics, GlyphShaper, TextMeasurer } from '@dragon/layout';
import { deviceShapedMeasurer, platformFontSize } from '@dragon/layout';
import { shimFaces } from '../native-shim.ts';
import { fontDataOf, hostShaper } from '../text-shaper-host.ts';
import type { SystemFonts } from './provider.ts';
import { systemRequestOf } from './provider.ts';

/** Every font family a program value names (its font writes and text leaves), by walking it. */
export function fontFamiliesOf(program: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'font' && x !== null && typeof x === 'object' && typeof (x as { family?: unknown }).family === 'string') out.add((x as { family: string }).family);
      visit(x);
    }
  };
  visit(program);
  return out;
}

/** What a measurer was asked, for a device to replay: every shaper call with its glyphs, every fallback call with its face, and each face's metrics (null: the engine's own) and lengths. */
export type MeasurerRecorder = {
  shape(call: readonly unknown[], glyphs: readonly number[]): void;
  fallback(call: readonly unknown[], face: string): void;
  metrics(family: string, size: number, metrics: FontMetrics | null): void;
  lengths(family: string, size: number, lengths: FontLengths): void;
};

/**
 * `fallbacks` is the compile's (NativeStyleOutput.fontFallbacks): a bundled face's code point that no listed face draws goes on to
 * that system face, or the platform's fallback from it.
 */
export function systemMeasurer(system: SystemFonts, program: unknown, bundled: readonly string[], dpr: number, authorFiles: ReadonlyMap<string, Uint8Array> = new Map(), recorder: MeasurerRecorder | null = null, fallbacks: Readonly<Record<string, string>> = {}): TextMeasurer {
  const used = [...fontFamiliesOf(program)].filter((f) => systemRequestOf(f) !== null);
  const faces = new Map<string, FontData>([...shimFaces().map((f) => f.id), ...bundled].map((id) => [id, fontDataOf(id)] as const));
  for (const id of used) faces.set(id, system.fontData(id));
  const platform = new Set(used);
  for (const [id, bytes] of authorFiles) if (system.authorFace(id, bytes)) platform.add(id);
  const shaper: GlyphShaper = {
    fallback: (face, ...rest) => {
      const next = Object.hasOwn(fallbacks, face) ? (fallbacks[face] as string) : null;
      const got = next === '' ? '' : next !== null ? system.shaper.fallback(next, ...rest) : platform.has(face) ? system.shaper.fallback(face, ...rest) : hostShaper.fallback(face, ...rest);
      if (got !== '') platform.add(got);
      recorder?.fallback([face, ...rest], got);
      return got;
    },
    shape: (face, ...rest) => {
      const glyphs = platform.has(face) ? system.shaper.shape(face, ...rest) : hostShaper.shape(face, ...rest);
      recorder?.shape([face, ...rest], glyphs);
      return glyphs;
    },
  };
  const m = deviceShapedMeasurer(faces, shaper);
  // A face's metrics and lengths at a size depend on nothing else, and the recorder keeps one entry per face and size.
  const metricsOf = new Map<string, Map<number, FontMetrics>>();
  const lengthsOf = new Map<string, Map<number, FontLengths>>();
  return {
    ...m,
    metrics: (font) => {
      const hit = metricsOf.get(font.family)?.get(font.size);
      if (hit !== undefined) return hit;
      let out: FontMetrics;
      if (!platform.has(font.family)) {
        recorder?.metrics(font.family, font.size, null);
        out = m.metrics(font);
      } else {
        const own = system.metrics(font.family, platformFontSize(font.size), dpr);
        recorder?.metrics(font.family, font.size, own);
        out = own ?? m.metrics(font);
      }
      atSize(metricsOf, font.family).set(font.size, out);
      return out;
    },
    lengths: (font) => {
      const hit = lengthsOf.get(font.family)?.get(font.size);
      if (hit !== undefined) return hit;
      let out: FontLengths;
      if (!platform.has(font.family)) {
        out = m.lengths(font);
        recorder?.lengths(font.family, font.size, out);
      } else {
        out = system.lengths(font.family, platformFontSize(font.size));
        recorder?.lengths(font.family, font.size, out);
      }
      atSize(lengthsOf, font.family).set(font.size, out);
      return out;
    },
  };
}

function atSize<T>(byFamily: Map<string, Map<number, T>>, family: string): Map<number, T> {
  let bySize = byFamily.get(family);
  if (bySize === undefined) {
    bySize = new Map();
    byFamily.set(family, bySize);
  }
  return bySize;
}

/** The FontData of every face a measurer built by systemMeasurer reads, by id: what a device's replay of it needs. */
export function systemFaceData(system: SystemFonts, program: unknown, bundled: readonly string[]): Map<string, FontData> {
  const used = [...fontFamiliesOf(program)].filter((f) => systemRequestOf(f) !== null);
  const faces = new Map<string, FontData>([...shimFaces().map((f) => f.id), ...bundled].map((id) => [id, fontDataOf(id)] as const));
  for (const id of used) faces.set(id, system.fontData(id));
  return faces;
}
