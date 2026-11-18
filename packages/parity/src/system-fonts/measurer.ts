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

export function systemMeasurer(system: SystemFonts, program: unknown, bundled: readonly string[], dpr: number, authorFiles: ReadonlyMap<string, Uint8Array> = new Map()): TextMeasurer {
  const used = [...fontFamiliesOf(program)].filter((f) => systemRequestOf(f) !== null);
  const faces = new Map<string, FontData>([...shimFaces().map((f) => f.id), ...bundled].map((id) => [id, fontDataOf(id)] as const));
  for (const id of used) faces.set(id, system.fontData(id));
  const platform = new Set(used);
  for (const [id, bytes] of authorFiles) if (system.authorFace(id, bytes)) platform.add(id);
  const shaper: GlyphShaper = {
    shape: (face, ...rest) => (platform.has(face) ? system.shaper.shape(face, ...rest) : hostShaper.shape(face, ...rest)),
  };
  const m = deviceShapedMeasurer(faces, shaper);
  return {
    ...m,
    metrics: (font) => (platform.has(font.family) ? system.metrics(font.family, platformFontSize(font.size), dpr) : null) ?? m.metrics(font),
    lengths: (font) => (platform.has(font.family) ? system.lengths(font.family, platformFontSize(font.size)) : m.lengths(font)),
  };
}
