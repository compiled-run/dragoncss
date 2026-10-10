// R1 on Node (notes/T056-txt1a-spec.md §2): the engine's GlyphShaper over dragon_hb.wasm, one instance per process, and the bundled
// faces as the engine reads them (ShapedFace), keyed by face id: Ahem for the bundled Ahem, else sha256:<hex> of the bytes, as the
// font manifest names a face.
// packages/text-shaper is loaded by path at run time, as packages/layout/test/shaping-gate.test.ts loads it (no package.json change).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { EngineFaults, FontData, GlyphShaper, HanKerningFontData, ShapedFace, TextMeasurer } from '@dragon/layout';
import { AHEM_FACE_ID, AHEM_SHA256, FEATURE_STRIDE, HK_CLOSE, HK_MIDDLE, HK_OPEN, HK_OTHER, NO_ENGINE_FAULTS, NO_HAN_KERNING, REFERENCE_LANGUAGE, shapedMeasurerFor } from '@dragon/layout';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';

type Feature = { readonly tag: string; readonly value: number; readonly start: number; readonly end: number };
type HB = {
  createFace(bytes: Uint8Array): number;
  faceUpem(face: number): number;
  createFont(face: number, o: { size: number }): number;
  shape(font: number, text: string, offset: number, length: number, o: { script: string; language: string; direction: 'ltr' | 'rtl'; features: readonly Feature[] }): Int32Array;
  faceFeatureTags(face: number, table: 'GPOS'): string[];
  glyphExtents(font: number, glyph: number): [number, number, number, number] | undefined;
  glyphUnits(font: number, glyph: number): number;
  nominalGlyph(font: number, cp: number): number;
};
const wasm = (await import(new URL('../../text-shaper/src/wasm.ts', import.meta.url).href)) as { DragonHB: { load(): HB }; tagToString(tag: number): string };

/** The language HarfBuzz shapes with when no lang attribute applies (platform.ts), which the device apps shape with too. */
export { REFERENCE_LANGUAGE };

/** The repo file of the bundled Ahem, whose sha256 is AHEM_SHA256. */
export const AHEM_FILE = 'vendor/fonts/Ahem.ttf';

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The face id of a bundled face's bytes: Ahem for the bundled Ahem, else sha256:<hex>. */
export const faceIdOf = (bytes: Uint8Array): string => {
  const sha = sha256Of(bytes);
  return sha === AHEM_SHA256 ? AHEM_FACE_ID : `sha256:${sha}`;
};

let hbInstance: HB | null = null;
const hb = (): HB => {
  if (hbInstance === null) hbInstance = wasm.DragonHB.load();
  return hbInstance;
};

/** A face's bytes, its HarfBuzz face, and the HarfBuzz fonts made of it per size. */
type HostFace = { readonly bytes: Uint8Array; readonly hb: number; readonly fonts: Map<number, number> };
const hostFaces = new Map<string, HostFace>();
const shapedFaces = new Map<string, ShapedFace>();

/** Registers a face by its bytes and returns its id; a face registered twice is the same face. */
export function registerFace(bytes: Uint8Array): string {
  const id = faceIdOf(bytes);
  if (!hostFaces.has(id)) hostFaces.set(id, { bytes, hb: hb().createFace(bytes), fonts: new Map() });
  return id;
}

function hostFace(id: string): HostFace {
  const f = hostFaces.get(id);
  if (f === undefined) throw new Error(`face ${id} is not registered with the host shaper`);
  return f;
}

function fontAt(id: string, size: number): number {
  const f = hostFace(id);
  let font = f.fonts.get(size);
  if (font === undefined) {
    font = hb().createFont(f.hb, { size });
    f.fonts.set(size, font);
  }
  return font;
}

/** The host side of R1: shapes with the registered face at the size, with the engine's integer feature records. */
export const hostShaper: GlyphShaper = {
  shape(face: string, size: number, text: string, start: number, end: number, script: string, rtl: boolean, language: string, features: readonly number[]): readonly number[] {
    if (features.length % FEATURE_STRIDE !== 0) throw new Error(`a feature list of ${features.length} integers is not whole records of ${FEATURE_STRIDE}`);
    const fs: Feature[] = [];
    for (let i = 0; i < features.length; i += FEATURE_STRIDE) {
      fs.push({ tag: wasm.tagToString(features[i] as number), value: features[i + 1] as number, start: features[i + 2] as number, end: features[i + 3] as number });
    }
    return Array.from(hb().shape(fontAt(face, size), text, start, end - start, { script, direction: rtl ? 'rtl' : 'ltr', language, features: fs }));
  },
};

/** The sfnt table directory: tag to offset. */
function tables(bytes: Uint8Array): Map<string, { readonly offset: number; readonly length: number }> {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, { offset: number; length: number }>();
  const n = d.getUint16(4);
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));
    out.set(tag, { offset: d.getUint32(at + 8), length: d.getUint32(at + 12) });
  }
  return out;
}

/**
 * The FontData a device host reads from the bundled bytes (text.ts FontData): head unitsPerEm, hhea ascender, descender and
 * lineGap, glyph x's glyf yMax, OS/2 sCapHeight and the advance of glyph 0. The shaped measurer reads no per-code-point advances.
 */
export function fontDataOf(id: string): FontData {
  const f = hostFace(id);
  const t = tables(f.bytes);
  const d = new DataView(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
  const need = (tag: string): number => {
    const e = t.get(tag);
    if (e === undefined) throw new Error(`face ${id} has no ${tag} table`);
    return e.offset;
  };
  const upem = d.getUint16(need('head') + 18);
  if (upem !== hb().faceUpem(f.hb)) throw new Error(`face ${id}: head unitsPerEm ${upem}, HarfBuzz ${hb().faceUpem(f.hb)}`);
  const hhea = need('hhea');
  const os2 = need('OS/2');
  if (d.getUint16(os2) < 2) throw new Error(`face ${id}: OS/2 version ${d.getUint16(os2)} has no sCapHeight`);
  // At a size of upem px a font unit is one px, so 16.16 extents and advances divided by 65536 are font units.
  const unitFont = fontAt(id, upem);
  const x = hb().nominalGlyph(unitFont, 0x78);
  const zero = hb().nominalGlyph(unitFont, 0x30);
  if (x === 0 || zero === 0) throw new Error(`face ${id} maps no glyph to x or 0`);
  const extents = hb().glyphExtents(unitFont, x);
  if (extents === undefined) throw new Error(`face ${id}: glyph x has no extents`);
  if (extents[1] % 65536 !== 0) throw new Error(`face ${id}: glyph x's top ${extents[1]} is not a whole font unit`);
  return {
    unitsPerEm: upem,
    ascent: d.getInt16(hhea + 4),
    descent: -d.getInt16(hhea + 6),
    lineGap: d.getInt16(hhea + 8),
    advances: [],
    xHeight: extents[1] / 65536,
    capHeight: d.getInt16(os2 + 88),
    zeroAdvance: hb().glyphUnits(unitFont, zero),
  };
}

/**
 * HanKerning::FontData as a host derives it (han_kerning.cc; packages/text-shaper/src/han-kerning.ts): GPOS halt and chws, and
 * the char types of the fullwidth punctuation from their shaped glyph bounds. Only Chinese and Japanese text reads it.
 */
export function hanKerningOf(id: string, language: string): HanKerningFontData {
  if (!/^(ja|zh)\b/i.test(language)) return NO_HAN_KERNING;
  const face = hostFace(id).hb;
  const gpos = new Set(hb().faceFeatureTags(face, 'GPOS'));
  if (!gpos.has('halt')) return NO_HAN_KERNING;
  const font = fontAt(id, 16);
  const chars = '、。，．：；“‘”’';
  const g = hb().shape(font, chars, 0, chars.length, { script: language.startsWith('ja') ? 'Hrkt' : 'Hani', language, direction: 'ltr', features: [] });
  const none = { ...NO_HAN_KERNING, hasContextualSpacing: gpos.has('chws') };
  if (g.length / 7 !== chars.length) return none;
  const glyphs: { glyph: number; advance: number; left: number; right: number }[] = [];
  for (let i = 0; i < chars.length; i++) {
    const o = i * 7;
    if (g[o + 1] !== i) return none;
    const e = hb().glyphExtents(font, g[o] as number);
    const dx = (g[o + 4] as number) / 65536;
    glyphs.push({ glyph: g[o] as number, advance: Math.fround((g[o + 2] as number) / 65536), left: (e === undefined ? 0 : e[0] / 65536) + dx, right: (e === undefined ? 0 : (e[0] + e[2]) / 65536) + dx });
  }
  const typeOne = (half: number, b: { left: number; right: number }): number =>
    b.right <= half ? HK_CLOSE : b.left >= half ? HK_OPEN : b.right - b.left <= half && b.left >= half / 2 ? HK_MIDDLE : HK_OTHER;
  const typeOf = (gs: typeof glyphs): number => {
    const live = gs.filter((v) => v.glyph !== 0);
    const first = live[0];
    if (first === undefined) return HK_OTHER;
    const t0 = typeOne(first.advance / 2, first);
    return live.every((v) => v.advance === first.advance && typeOne(first.advance / 2, v) === t0) ? t0 : HK_OTHER;
  };
  return {
    hasAlternateSpacing: true,
    hasContextualSpacing: gpos.has('chws'),
    typeForDot: typeOf(glyphs.slice(0, 4)),
    typeForColon: typeOf(glyphs.slice(4, 5)),
    typeForSemicolon: typeOf(glyphs.slice(5, 6)),
    isQuoteFullwidth: typeOf(glyphs.slice(6, 8)) === HK_OPEN && typeOf(glyphs.slice(8, 10)) === HK_CLOSE,
  };
}

/** The engine's record of a registered face for one language. */
export function shapedFaceOf(id: string, language: string): ShapedFace {
  const key = `${id}\n${language}`;
  let f = shapedFaces.get(key);
  if (f === undefined) {
    f = { id, data: fontDataOf(id), hanKerning: hanKerningOf(id, language) };
    shapedFaces.set(key, f);
  }
  return f;
}

/** The bundled Ahem, registered once; its bytes must be the ones whose sha256 the engine names. */
export function ahemFaceId(): string {
  const bytes = new Uint8Array(readFileSync(repoPath(AHEM_FILE)));
  if (sha256Of(bytes) !== AHEM_SHA256) throw new Error(`${AHEM_FILE} has sha256 ${sha256Of(bytes)}, but the engine's AHEM_SHA256 is ${AHEM_SHA256}`);
  return registerFace(bytes);
}

/** Every vendored font file (vendor/fonts/<family>/<file>.ttf), the faces a fixture or the north star can bundle. */
function vendoredFaceFiles(): string[] {
  const root = repoPath('vendor/fonts');
  const out: string[] = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(`${root}/${dir.name}`)) if (f.endsWith('.ttf')) out.push(`${root}/${dir.name}/${f}`);
  }
  return out.sort();
}

let vendoredIds: string[] | null = null;
const vendoredFaceIds = (): string[] => {
  if (vendoredIds === null) vendoredIds = vendoredFaceFiles().map((f) => registerFace(new Uint8Array(readFileSync(f))));
  return vendoredIds;
};

/**
 * The reference measurer through HarfBuzz (shapedMeasurerFor): Ahem, every vendored face and the given face bytes, at the
 * reference platform and language, with the engine's shaping plants. A fresh measurer per call: its shaped items are cached per
 * layout. An input naming any other face is refused by the measurer (no bundled face).
 */
export function referenceShapedMeasurer(faults: EngineFaults = NO_ENGINE_FAULTS, faces: readonly Uint8Array[] = []): TextMeasurer {
  const ids = [ahemFaceId(), ...vendoredFaceIds(), ...faces.map(registerFace)];
  const map = new Map(ids.map((id) => [id, shapedFaceOf(id, REFERENCE_LANGUAGE)] as const));
  const m = shapedMeasurerFor(REFERENCE_PLATFORM, map, hostShaper, REFERENCE_LANGUAGE, faults);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}
