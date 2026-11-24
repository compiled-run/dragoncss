// Each target's system faces (dragon fonts/system-faces.ts) at build time: which platform font plays each role at each weight
// and style (web-generics.ts, measured in Safari and the Android WebView), its FontData, and the shaper the engine lays text out
// with (Core Text for iOS, Dragon's HarfBuzz on the image's font file at the fonts.xml instance for Android).
import { createHash } from 'node:crypto';
import type { FontData, FontLengths, FontMetrics, GlyphShaper, LU } from '@dragon/layout';
import { FEATURE_STRIDE, LU_PER_PX } from '@dragon/layout';
import type { NativeStyleTarget, SystemFaceRequest, SystemFaceRole } from 'dragon';
import { SYSTEM_FACES } from 'dragon';
import { AndroidSystemFiles } from './android.ts';
import { coreText, iosRuntimeFont } from './coretext.ts';
import type { CoreTextFace } from './coretext.ts';
import { ANDROID_ROLE_FAMILIES, IOS_ROLE_FACES } from './web-generics.ts';

/** How a host rebuilds a system face: Core Text's (iOS), or a file of /system/fonts at a fonts.xml instance (Android). */
export type SystemFaceDescriptor =
  | { readonly platform: 'ios'; readonly face: CoreTextFace }
  | { readonly platform: 'android'; readonly file: string; readonly index: number; readonly axes: Readonly<Record<string, number>>; readonly sha256: string };

export class SystemFaceRefused extends Error {}

const refuse = (what: string): never => {
  throw new SystemFaceRefused(what);
};

/** The request of a system face id; any other id is not a system face. */
export const systemRequestOf = (id: string): SystemFaceRequest | null => SYSTEM_FACES.get(id) ?? null;

/**
 * css-fonts-4 §5.2 step 4: the face font matching picks for a weight among a family's faces of one style: the weight itself, else
 * for 400 then 500, else (below 400) lighter then heavier, else (above 500) heavier then lighter, else (400 or 500) lighter.
 */
export function matchWeight<T extends { readonly weight: number }>(faces: readonly T[], want: number): T | null {
  const exact = faces.find((f) => f.weight === want);
  if (exact !== undefined) return exact;
  const lighter = faces.filter((f) => f.weight < want).sort((a, b) => b.weight - a.weight);
  const heavier = faces.filter((f) => f.weight > want).sort((a, b) => a.weight - b.weight);
  if (want >= 400 && want <= 500) {
    const upTo500 = heavier.filter((f) => f.weight <= 500);
    return upTo500[0] ?? lighter[0] ?? heavier[0] ?? null;
  }
  return (want < 400 ? (lighter[0] ?? heavier[0]) : (heavier[0] ?? lighter[0])) ?? null;
}

/** The face a request picks, or a refusal where Chrome would synthesize bold or oblique, which native does not draw. */
function pick<T extends { readonly weight: number; readonly style: 'normal' | 'italic' }>(id: string, faces: readonly T[], r: SystemFaceRequest, platform: string): T {
  const styled = faces.filter((f) => f.style === r.style);
  if (styled.length === 0) refuse(`${id}: ${platform} has no ${r.style} face for ${r.role}, and native does not draw a synthetic oblique`);
  const face = matchWeight(styled, r.weight) as T;
  if (r.weight >= 600 && face.weight < 600) refuse(`${id}: ${platform}'s ${r.role} has no face of weight 600 or more, and native does not draw a synthetic bold`);
  return face;
}

/** A target's system faces at build time. */
export type SystemFonts = {
  readonly target: NativeStyleTarget;
  descriptor(id: string): SystemFaceDescriptor;
  fontData(id: string): FontData;
  lengths(id: string, sizePx: number): FontLengths;
  /** The line metrics the target's browser rounds to, where they are not the engine's (Blink's) own; null keeps the engine's. */
  metrics(id: string, sizePx: number, dpr: number): FontMetrics | null;
  /** Takes an author face to measure as the target's browser does; false leaves it to the engine's own (Blink's) rules. */
  authorFace(id: string, bytes: Uint8Array): boolean;
  readonly shaper: GlyphShaper;
};

const tagOf = (n: number): string => String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

function features(ints: readonly number[]): { tag: string; value: number; start: number; end: number }[] {
  const out: { tag: string; value: number; start: number; end: number }[] = [];
  for (let i = 0; i < ints.length; i += FEATURE_STRIDE) out.push({ tag: tagOf(ints[i] as number), value: ints[i + 1] as number, start: ints[i + 2] as number, end: ints[i + 3] as number });
  return out;
}

/**
 * iOS: each role's Core Text face, measured on the build Mac, whose Core Text gives the iOS simulator's glyphs and positions for
 * every role's face; the system font's own vertical metrics differ (the Mac's SFNS against iOS's SFUI), so they are read from the
 * SFUI.ttf of an iOS simulator runtime on the build machine (docs/system-fonts.md).
 */
export function iosSystemFonts(dpr: number): SystemFonts {
  const ct = coreText();
  const authored = new Map<string, { readonly face: CoreTextFace; readonly lineMetrics?: undefined }>();
  const entryOf = (id: string): (typeof IOS_ROLE_FACES)[SystemFaceRole][number] | { readonly face: CoreTextFace; readonly lineMetrics?: undefined } => {
    const author = authored.get(id);
    if (author !== undefined) return author;
    const r = systemRequestOf(id) ?? refuse(`${id} is not a system face`);
    return pick(id, IOS_ROLE_FACES[(r as SystemFaceRequest).role], r as SystemFaceRequest, 'iOS');
  };
  let sfui: { readonly upem: number; readonly ascent: number; readonly descent: number; readonly lineGap: number } | null = null;
  const systemMetrics = (): NonNullable<typeof sfui> => {
    if (sfui === null) {
      const file = iosRuntimeFont('SFUI.ttf');
      const table = sfntTable(file.bytes, 0);
      const hhea = table('hhea');
      sfui = { upem: table('head').getUint16(18), ascent: hhea.getInt16(4), descent: -hhea.getInt16(6), lineGap: hhea.getInt16(8) };
    }
    return sfui;
  };
  /** Core Text's ascent, descent and leading of the face at a size, in px, as iOS gives them. */
  const vertical = (id: string, sizePx: number): { ascent: number; descent: number; leading: number } => {
    const e = entryOf(id);
    if (e.face.kind === 'system') {
      const m = systemMetrics();
      return { ascent: (m.ascent * sizePx) / m.upem, descent: (m.descent * sizePx) / m.upem, leading: (m.lineGap * sizePx) / m.upem };
    }
    const d = ct.describe(e.face, sizePx);
    return { ascent: d.ascent, descent: d.descent, leading: d.leading };
  };
  return {
    target: 'ios',
    descriptor: (id) => ({ platform: 'ios', face: entryOf(id).face }),
    fontData(id) {
      const face = entryOf(id).face;
      const d = ct.describe(face, 17);
      const units = (px: number): number => (px * d.unitsPerEm) / d.size;
      const v = vertical(id, d.size);
      return { unitsPerEm: d.unitsPerEm, ascent: units(v.ascent), descent: units(v.descent), lineGap: units(v.leading), advances: [], xHeight: units(d.xTop), capHeight: units(d.capHeight), zeroAdvance: units(d.zeroAdvance), ellipsisAdvance: d.ellipsisAdvance < 0 ? -1 : units(d.ellipsisAdvance), xAdvance: d.xAdvance < 0 ? -1 : units(d.xAdvance) };
    },
    lengths(id, sizePx) {
      const d = ct.describe(entryOf(id).face, sizePx / dpr);
      return { xHeight: d.xTop * dpr, capHeight: d.capHeight * dpr, zeroWidth: d.zeroAdvance * dpr, xWidth: d.xAdvance * dpr };
    },
    // Safari draws an author font with Core Text too, so the iOS target measures it as it measures a system face.
    authorFace(id, bytes) {
      authored.set(id, { face: ct.register(bytes) });
      return true;
    },
    // Safari lays out in CSS px and rounds each of Core Text's metrics up there (WebKit FontCocoa.mm), measured on iOS 27.2.
    metrics(id, sizePx, dpr) {
      const v = vertical(id, sizePx / dpr);
      const extra = entryOf(id).lineMetrics === 'webkit-15-percent' ? Math.ceil((v.ascent + v.descent) * 0.15) : 0;
      const lu = (cssPx: number): LU => (cssPx * dpr * LU_PER_PX) as LU;
      // With line-height: normal WebKit puts half the leading above the glyphs.
      return { ascent: lu(Math.ceil(v.ascent) + extra), descent: lu(Math.ceil(v.descent)), lineGap: lu(Math.ceil(v.leading)), normalGapAbove: lu(Math.ceil(v.leading) / 2) };
    },
    shaper: {
      shape(face, size, text, start, end, _script, rtl, language, fs) {
        if (rtl) refuse(`${face}: right-to-left text in a system face is not shaped yet`);
        // Safari shapes at the CSS size and scales the page by the device ratio; San Francisco's optical size and tracking follow the size.
        const g = ct.shape(entryOf(face).face, size / dpr, text, start, end, language, features(fs));
        return g.map((v, i) => (i % 7 >= 2 && i % 7 <= 5 ? Math.round(v * dpr) : v));
      },
    },
  };
}

type HB = {
  createFace(bytes: Uint8Array, index?: number): number;
  faceUpem(face: number): number;
  createFont(face: number, o: { size: number; weight?: number; width?: number; slope?: number; opticalSizingAuto?: boolean; variations?: readonly { tag: string; value: number }[] }): number;
  shape(font: number, text: string, offset: number, length: number, o: { script: string; language: string; direction: 'ltr' | 'rtl'; features: readonly { tag: string; value: number; start: number; end: number }[] }): Int32Array;
  glyphExtents(font: number, glyph: number): [number, number, number, number] | undefined;
  glyphUnits(font: number, glyph: number): number;
  nominalGlyph(font: number, cp: number): number;
};
const wasm = (await import(new URL('../../../text-shaper/src/wasm.ts', import.meta.url).href)) as { DragonHB: { load(path?: string, o?: { fenceDisabled?: boolean }): HB } };

/** Android: each role's fonts.xml family, its font file read from the SDK image, shaped with HarfBuzz at the fonts.xml instance. */
export function androidSystemFonts(files: AndroidSystemFiles = new AndroidSystemFiles()): SystemFonts {
  // Its own HarfBuzz: the variable-font fence guards Chrome's Core Text model of bundled faces; Android draws these with HarfBuzz.
  const hb = wasm.DragonHB.load(undefined, { fenceDisabled: true });
  const xml = files.fontsXml();
  const resolved = new Map<string, SystemFaceDescriptor & { platform: 'android' }>();
  const faces = new Map<string, number>();
  const fonts = new Map<string, number>();
  const descriptorOf = (id: string): SystemFaceDescriptor & { platform: 'android' } => {
    const hit = resolved.get(id);
    if (hit !== undefined) return hit;
    const r = systemRequestOf(id) ?? refuse(`${id} is not a system face`);
    const name = ANDROID_ROLE_FAMILIES[(r as SystemFaceRequest).role];
    const family = xml.families.get(name) ?? refuse(`${id}: fonts.xml has no family ${name}`);
    const f = pick(id, family.fonts, r as SystemFaceRequest, 'Android');
    const file = files.read(`/system/fonts/${f.file}`);
    const d = { platform: 'android' as const, file: f.file, index: f.index, axes: f.axes, sha256: file.sha256 };
    resolved.set(id, d);
    if (!faces.has(file.sha256)) faces.set(file.sha256, hb.createFace(file.bytes, f.index));
    return d;
  };
  const fontAt = (id: string, size: number): number => {
    const key = `${id}@${size}`;
    let font = fonts.get(key);
    if (font === undefined) {
      const d = descriptorOf(id);
      const { wght, wdth, slnt, ...rest } = androidInstance(d.axes, fvarAxes(files.read(`/system/fonts/${d.file}`).bytes, d.index));
      font = hb.createFont(faces.get(d.sha256) as number, { size, weight: wght ?? 400, width: wdth ?? 100, slope: -(slnt ?? 0), opticalSizingAuto: false, variations: Object.entries(rest).map(([tag, value]) => ({ tag, value })) });
      fonts.set(key, font);
    }
    return font;
  };
  return {
    target: 'android',
    descriptor: descriptorOf,
    fontData(id) {
      const d = descriptorOf(id);
      const bytes = files.read(`/system/fonts/${d.file}`).bytes;
      const upem = hb.faceUpem(faces.get(d.sha256) as number);
      const font = fontAt(id, upem);
      const table = sfntTable(bytes, d.index);
      const hhea = table('hhea');
      const os2 = table('OS/2');
      const x = hb.nominalGlyph(font, 0x78);
      const zero = hb.nominalGlyph(font, 0x30);
      const ellipsis = hb.nominalGlyph(font, 0x2026);
      const extents = x === 0 ? undefined : hb.glyphExtents(font, x);
      if (zero === 0 || extents === undefined) refuse(`${id}: ${d.file} maps no glyph to x or 0`);
      return {
        unitsPerEm: upem, ascent: hhea.getInt16(4), descent: -hhea.getInt16(6), lineGap: hhea.getInt16(8), advances: [],
        xHeight: (extents as number[])[1] as number / 65536, capHeight: os2.getInt16(88), zeroAdvance: hb.glyphUnits(font, zero), ellipsisAdvance: ellipsis === 0 ? -1 : hb.glyphUnits(font, ellipsis), xAdvance: hb.glyphUnits(font, x),
      };
    },
    metrics: () => null,
    authorFace: () => false,
    lengths(id, sizePx) {
      const data = this.fontData(id);
      const k = sizePx / data.unitsPerEm;
      return { xHeight: data.xHeight * k, capHeight: data.capHeight * k, zeroWidth: data.zeroAdvance * k, xWidth: data.xAdvance * k };
    },
    shaper: {
      shape(face, size, text, start, end, script, rtl, language, fs) {
        return Array.from(hb.shape(fontAt(face, size), text, start, end - start, { script, direction: rtl ? 'rtl' : 'ltr', language, features: features(fs) }));
      },
    },
  };
}

/** A variable font's axes (its fvar table), each with its range and default; none for a static font. */
export type FontAxis = { readonly tag: string; readonly min: number; readonly default: number; readonly max: number };
export function fvarAxes(bytes: Uint8Array, index: number): FontAxis[] {
  const fvar = sfntTable(bytes, index, true)('fvar');
  if (fvar === null) return [];
  const at = fvar.getUint16(4);
  const size = fvar.getUint16(10);
  return Array.from({ length: fvar.getUint16(8) }, (_, i) => {
    const o = at + i * size;
    return { tag: tagOf(fvar.getUint32(o)), min: fvar.getInt32(o + 4) / 65536, default: fvar.getInt32(o + 8) / 65536, max: fvar.getInt32(o + 12) / 65536 };
  });
}

/**
 * The value of every axis of an Android system face as androidSystemFonts shapes it: fonts.xml's value, else the HarfBuzz request's
 * (wght 400, wdth 100, slnt 0) or the axis default, clamped to the axis range.
 */
export function androidInstance(axes: Readonly<Record<string, number>>, fvar: readonly FontAxis[]): Record<string, number> {
  const request: Readonly<Record<string, number>> = { wght: 400, wdth: 100, slnt: 0 };
  return Object.fromEntries(fvar.map((a) => [a.tag, Math.max(a.min, Math.min(a.max, axes[a.tag] ?? request[a.tag] ?? a.default))]));
}

/** A table of an sfnt (or of face `index` of a collection) as a DataView over its bytes. */
function sfntTable(bytes: Uint8Array, index: number): (tag: string) => DataView;
function sfntTable(bytes: Uint8Array, index: number, optional: true): (tag: string) => DataView | null;
function sfntTable(bytes: Uint8Array, index: number, optional = false): (tag: string) => DataView | null {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isCollection = d.getUint32(0) === 0x74746366;
  const at = isCollection ? d.getUint32(12 + 4 * index) : index === 0 ? 0 : refuse(`face index ${index} of a single font`);
  const n = d.getUint16(at + 4);
  return (tag) => {
    for (let i = 0; i < n; i++) {
      const o = at + 12 + i * 16;
      if (String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3)) === tag) return new DataView(bytes.buffer, bytes.byteOffset + d.getUint32(o + 8), d.getUint32(o + 12));
    }
    return optional ? null : refuse(`the font has no ${tag} table`);
  };
}

const providers = new Map<string, SystemFonts>();
/** The target's system faces for the export device's ratio; refused by name where the build machine cannot measure them. */
export function systemFontsFor(target: NativeStyleTarget, dpr: number): SystemFonts {
  const key = `${target}@${dpr}`;
  let p = providers.get(key);
  if (p === undefined) {
    p = target === 'ios' ? iosSystemFonts(dpr) : androidSystemFonts();
    providers.set(key, p);
  }
  return p;
}

/** A stable digest of what a target's provider resolved, for the export: each face id with its descriptor. */
export const descriptorDigest = (d: SystemFaceDescriptor): string => createHash('sha256').update(JSON.stringify(d)).digest('hex');
