// Loads dragon_hb.wasm (build.zig, `zig build wasm`) and exposes the shim's integer-only API.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VariableFontRefused, faceFacts, fenceFace, fenceInstance, loadValidatedVariableFonts } from './fence.ts';
import type { FaceFacts, ValidatedVariableFonts, VariableFontRefusal } from './fence.ts';

/** Integers per shaped glyph: glyph id, cluster, x advance, y advance, x offset, y offset, flags (16.16 for positions). */
export const GLYPH_STRIDE = 7;
export const GLYPH_FLAG_UNSAFE_TO_BREAK = 1;

export const DEFAULT_WASM_PATH = fileURLToPath(new URL('../wasm/dragon_hb.wasm', import.meta.url));

export interface Feature {
  readonly tag: string;
  readonly value: number;
  readonly start?: number;
  readonly end?: number;
}

export interface Variation {
  readonly tag: string;
  readonly value: number;
}

export interface FontOptions {
  /** FontPlatformData::size: the computed pixel size. */
  readonly size: number;
  /** The CSS specified size; drives automatic `opsz` and ptem. Defaults to size. */
  readonly specifiedSize?: number;
  readonly weight?: number;
  readonly width?: number;
  readonly slope?: number;
  readonly opticalSizingAuto?: boolean;
  readonly variations?: readonly Variation[];
}

export interface LoadOptions {
  /** Planted fault: the variable-font fence lets every face and instance through. */
  readonly fenceDisabled?: boolean;
}

export interface ShapeOptions {
  /** ISO 15924 script tag, e.g. 'Latn', 'Hani', 'Hira', 'Zyyy'. */
  readonly script: string;
  readonly direction?: 'ltr' | 'rtl';
  /** BCP 47 language, e.g. 'en', 'ja'. */
  readonly language: string;
  readonly features?: readonly Feature[];
}

interface Exports {
  readonly memory: WebAssembly.Memory;
  _initialize(): void;
  dhb_alloc(size: number): number;
  dhb_free(ptr: number): void;
  dhb_face_create(data: number, length: number, index: number): number;
  dhb_face_destroy(face: number): void;
  dhb_face_upem(face: number): number;
  dhb_face_has_table(face: number, tag: number): number;
  dhb_face_feature_tags(face: number, table: number, out: number, capacity: number): number;
  dhb_font_create(face: number, size: number, specified: number, weight: number, width: number, slope: number, opszAuto: number, settings: number, count: number): number;
  dhb_font_destroy(font: number): void;
  dhb_font_glyph_advance(font: number, glyph: number): number;
  dhb_font_glyph_units(font: number, glyph: number): number;
  dhb_font_glyph_extents(font: number, glyph: number, out: number): number;
  dhb_font_nominal_glyph(font: number, codepoint: number): number;
  dhb_shaper_create(): number;
  dhb_shaper_destroy(shaper: number): void;
  dhb_shape(shaper: number, font: number, text: number, textLength: number, offset: number, length: number, script: number, direction: number, lang: number, langLength: number, features: number, featureCount: number): number;
  dhb_shaper_glyphs(shaper: number): number;
}

export function tagFromString(tag: string): number {
  if (tag.length !== 4) throw new Error(`OpenType tag must have 4 characters: ${JSON.stringify(tag)}`);
  return ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) >>> 0;
}

export function tagToString(tag: number): string {
  return String.fromCharCode((tag >>> 24) & 255, (tag >>> 16) & 255, (tag >>> 8) & 255, tag & 255);
}

class WasiExit extends Error {}

/** The shim needs only these WASI imports (wasi-libc start-up); none is expected to be called. */
function wasiImports(): WebAssembly.ModuleImports {
  let memory: WebAssembly.Memory | undefined;
  const view = (): DataView => new DataView((memory as WebAssembly.Memory).buffer);
  return {
    environ_sizes_get: (count: number, size: number) => {
      view().setUint32(count, 0, true);
      view().setUint32(size, 0, true);
      return 0;
    },
    environ_get: () => 0,
    proc_exit: (code: number) => {
      throw new WasiExit(`dragon_hb called proc_exit(${code})`);
    },
    // Set after instantiation.
    __setMemory: (m: WebAssembly.Memory) => {
      memory = m;
    },
  } as unknown as WebAssembly.ModuleImports;
}

export class DragonHB {
  private readonly x: Exports;
  private readonly shaper: number;
  private textPtr = 0;
  private textCap = 0;
  private textKey: string | undefined;
  private readonly faces = new Map<number, FaceFacts>();
  private readonly validated: ValidatedVariableFonts;
  private readonly fenceDisabled: boolean;

  private constructor(x: Exports, options: LoadOptions) {
    this.x = x;
    this.validated = loadValidatedVariableFonts();
    this.fenceDisabled = options.fenceDisabled === true;
    this.shaper = x.dhb_shaper_create();
    if (this.shaper === 0) throw new Error('dhb_shaper_create failed');
  }

  static load(path: string = DEFAULT_WASM_PATH, options: LoadOptions = {}): DragonHB {
    return DragonHB.fromBytes(readFileSync(path), options);
  }

  static fromBytes(bytes: Uint8Array, options: LoadOptions = {}): DragonHB {
    const module = new WebAssembly.Module(bytes);
    const wasi = wasiImports();
    const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi });
    const x = instance.exports as unknown as Exports;
    (wasi as unknown as { __setMemory(m: WebAssembly.Memory): void }).__setMemory(x.memory);
    x._initialize();
    return new DragonHB(x, options);
  }

  private u8(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer);
  }

  private alloc(size: number): number {
    const p = this.x.dhb_alloc(Math.max(size, 1));
    if (p === 0) throw new Error(`dhb_alloc(${size}) failed`);
    return p;
  }

  /** Throws VariableFontRefused for a variable font without HVAR or outside validated-variable-fonts.json. */
  createFace(bytes: Uint8Array, index = 0): number {
    const facts = faceFacts(bytes);
    const refusal = this.fenceDisabled ? null : fenceFace(facts, this.validated);
    if (refusal !== null) throw new VariableFontRefused(refusal);
    const p = this.alloc(bytes.length);
    this.u8().set(bytes, p);
    const face = this.x.dhb_face_create(p, bytes.length, index);
    this.x.dhb_free(p);
    if (face === 0) throw new Error('dhb_face_create failed');
    this.faces.set(face, facts);
    return face;
  }

  faceUpem(face: number): number {
    return this.x.dhb_face_upem(face);
  }

  faceHasTable(face: number, tag: string): boolean {
    return this.x.dhb_face_has_table(face, tagFromString(tag)) !== 0;
  }

  /** GSUB or GPOS feature tags across all scripts (with repeats, as the table lists them). */
  faceFeatureTags(face: number, table: 'GSUB' | 'GPOS'): string[] {
    const cap = 1024;
    const p = this.alloc(cap * 4);
    const n = Math.min(this.x.dhb_face_feature_tags(face, tagFromString(table), p, cap), cap);
    const out = Array.from(new Uint32Array(this.x.memory.buffer, p, n), tagToString);
    this.x.dhb_free(p);
    return out;
  }

  /** The fence's typed refusal for a font of this face with these options, or null when it may be created. */
  checkFont(face: number, o: FontOptions): VariableFontRefusal | null {
    const facts = this.faces.get(face);
    if (facts === undefined) throw new Error(`unknown face ${face}`);
    return this.fenceDisabled ? null : fenceInstance(facts, o, this.validated);
  }

  /** Throws VariableFontRefused for a variable instance outside validated-variable-fonts.json. */
  createFont(face: number, o: FontOptions): number {
    const refusal = this.checkFont(face, o);
    if (refusal !== null) throw new VariableFontRefused(refusal);
    const vars = o.variations ?? [];
    const p = vars.length > 0 ? this.alloc(vars.length * 8) : 0;
    if (p !== 0) {
      const dv = new DataView(this.x.memory.buffer);
      vars.forEach((v, i) => {
        dv.setUint32(p + i * 8, tagFromString(v.tag), true);
        dv.setFloat32(p + i * 8 + 4, v.value, true);
      });
    }
    const font = this.x.dhb_font_create(face, o.size, o.specifiedSize ?? o.size, o.weight ?? 400, o.width ?? 100, o.slope ?? 0, o.opticalSizingAuto === false ? 0 : 1, p, vars.length);
    if (p !== 0) this.x.dhb_free(p);
    if (font === 0) throw new Error('dhb_font_create failed');
    return font;
  }

  /** The 16.16 advance HarfBuzz gets from the shim's advance function. */
  glyphAdvance(font: number, glyph: number): number {
    return this.x.dhb_font_glyph_advance(font, glyph);
  }

  glyphUnits(font: number, glyph: number): number {
    return this.x.dhb_font_glyph_units(font, glyph);
  }

  /** [x bearing, y bearing, width, height] in 16.16, y up (height negative), or undefined. */
  glyphExtents(font: number, glyph: number): [number, number, number, number] | undefined {
    const p = this.alloc(16);
    const ok = this.x.dhb_font_glyph_extents(font, glyph, p);
    const e = Array.from(new Int32Array(this.x.memory.buffer, p, 4)) as [number, number, number, number];
    this.x.dhb_free(p);
    return ok ? e : undefined;
  }

  nominalGlyph(font: number, codepoint: number): number {
    return this.x.dhb_font_nominal_glyph(font, codepoint);
  }

  private putText(text: string): number {
    if (this.textKey === text) return this.textPtr;
    const need = text.length * 2;
    if (need > this.textCap) {
      if (this.textPtr !== 0) this.x.dhb_free(this.textPtr);
      this.textPtr = this.alloc(need);
      this.textCap = need;
    }
    const u16 = new Uint16Array(this.x.memory.buffer, this.textPtr, text.length);
    for (let i = 0; i < text.length; i++) u16[i] = text.charCodeAt(i);
    this.textKey = text;
    return this.textPtr;
  }

  /** Shapes text[offset, offset + length) with the whole text as context. Returns GLYPH_STRIDE ints per glyph. */
  shape(font: number, text: string, offset: number, length: number, o: ShapeOptions): Int32Array {
    const tp = this.putText(text);
    const lang = new TextEncoder().encode(o.language);
    const features = o.features ?? [];
    const lp = this.alloc(lang.length);
    this.u8().set(lang, lp);
    const fp = features.length > 0 ? this.alloc(features.length * 16) : 0;
    if (fp !== 0) {
      const dv = new DataView(this.x.memory.buffer);
      features.forEach((f, i) => {
        dv.setUint32(fp + i * 16, tagFromString(f.tag), true);
        dv.setUint32(fp + i * 16 + 4, f.value >>> 0, true);
        dv.setUint32(fp + i * 16 + 8, (f.start ?? 0) >>> 0, true);
        dv.setUint32(fp + i * 16 + 12, (f.end ?? 0xffffffff) >>> 0, true);
      });
    }
    const dir = o.direction === 'rtl' ? 5 : 4;
    const n = this.x.dhb_shape(this.shaper, font, tp, text.length, offset, length, tagFromString(o.script), dir, lp, lang.length, fp, features.length) >>> 0;
    this.x.dhb_free(lp);
    if (fp !== 0) this.x.dhb_free(fp);
    if (n === 0xffffffff) throw new Error('dhb_shape: out of memory');
    const gp = this.x.dhb_shaper_glyphs(this.shaper);
    return n === 0 ? new Int32Array(0) : new Int32Array(this.x.memory.buffer.slice(gp, gp + n * GLYPH_STRIDE * 4));
  }
}
