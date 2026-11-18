// The engine's measurer for a target with system faces: the bundled faces through the host's HarfBuzz, as referenceMeasurer has
// them, and each system face the program names through its target's provider (Core Text on iOS, the image's file on Android).
import type { FontData, GlyphShaper, TextMeasurer } from '@dragon/layout';
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

export function systemMeasurer(system: SystemFonts, program: unknown, bundled: readonly string[], dpr: number): TextMeasurer {
  const used = [...fontFamiliesOf(program)].filter((f) => systemRequestOf(f) !== null);
  const faces = new Map<string, FontData>([...shimFaces().map((f) => f.id), ...bundled].map((id) => [id, fontDataOf(id)] as const));
  for (const id of used) faces.set(id, system.fontData(id));
  const shaper: GlyphShaper = {
    shape: (face, ...rest) => (systemRequestOf(face) === null ? hostShaper.shape(face, ...rest) : system.shaper.shape(face, ...rest)),
  };
  const m = deviceShapedMeasurer(faces, shaper);
  return {
    ...m,
    metrics: (font) => (systemRequestOf(font.family) === null ? null : system.metrics(font.family, platformFontSize(font.size), dpr)) ?? m.metrics(font),
    lengths: (font) => (systemRequestOf(font.family) === null ? m.lengths(font) : system.lengths(font.family, platformFontSize(font.size))),
  };
}
