// Shape transcripts (T056 R3): the faces (by sha256), fonts and every shim call a run made, with the integers it
// returned. A transcript recorded through the WASM is the reference the Swift, Kotlin and device replays must equal.
import { createHash } from 'node:crypto';
import { GLYPH_STRIDE, tagFromString, tagToString } from './wasm.ts';
import type { DragonHB, FontOptions, ShapeOptions } from './wasm.ts';

export const TRANSCRIPT_FORMAT = 'dragon-shape-transcript/1';

export interface TranscriptFace {
  readonly id: number;
  /** Repo-relative path of the font file. */
  readonly file: string;
  readonly sha256: string;
}

/** dhb_font_create's arguments, defaults resolved (sizes are passed to the shim as f32). */
export interface TranscriptFont {
  readonly id: number;
  readonly face: number;
  readonly size: number;
  readonly specifiedSize: number;
  readonly weight: number;
  readonly width: number;
  readonly slope: number;
  readonly opticalSizingAuto: boolean;
}

/**
 * An integer feature record as GlyphShaper passes it (PM ruling, T082): [OpenType tag as int32, value, start, end],
 * defaults resolved (start 0, end 0xffffffff). The C ABI's dhb_feature takes the same four integers.
 */
export type TranscriptFeature = readonly [number, number, number, number];

export interface ShapeCall {
  readonly op: 'shape';
  readonly font: number;
  /** Index into Transcript.texts: the whole text is the shaping context. */
  readonly text: number;
  readonly start: number;
  readonly end: number;
  readonly script: string;
  readonly rtl: boolean;
  readonly language: string;
  readonly features: readonly TranscriptFeature[];
  /** GLYPH_STRIDE int32 per glyph: glyph id, cluster, x advance, y advance, x offset, y offset, flags. */
  readonly glyphs: readonly number[];
}

export interface NominalCall {
  readonly op: 'nominal';
  readonly font: number;
  readonly codepoint: number;
  readonly glyph: number;
}

export interface AdvanceCall {
  readonly op: 'advance';
  readonly font: number;
  readonly glyph: number;
  /** 16.16. */
  readonly advance: number;
}

export type TranscriptCall = ShapeCall | NominalCall | AdvanceCall;

export interface Transcript {
  readonly format: typeof TRANSCRIPT_FORMAT;
  /** What produced the calls. */
  readonly source: string;
  /** sha256 of the dragon_hb.wasm that recorded it. */
  readonly wasmSha256: string;
  readonly faces: readonly TranscriptFace[];
  readonly fonts: readonly TranscriptFont[];
  readonly texts: readonly string[];
  readonly calls: readonly TranscriptCall[];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** One JSON value per line for calls and texts, so diffs stay readable; the bytes are deterministic. */
export function serializeTranscript(t: Transcript): string {
  const list = (xs: readonly unknown[]): string => (xs.length === 0 ? '[]' : `[\n${xs.map((x) => JSON.stringify(x)).join(',\n')}\n]`);
  return `{"format":${JSON.stringify(t.format)},"source":${JSON.stringify(t.source)},"wasmSha256":${JSON.stringify(t.wasmSha256)},\n`
    + `"faces":${list(t.faces)},\n"fonts":${list(t.fonts)},\n"texts":${list(t.texts)},\n"calls":${list(t.calls)}}\n`;
}

export function parseTranscript(json: string): Transcript {
  const t = JSON.parse(json) as Transcript;
  if (t.format !== TRANSCRIPT_FORMAT) throw new Error(`not a ${TRANSCRIPT_FORMAT}: ${String(t.format)}`);
  return t;
}

export interface Recorder {
  /** Stops recording (the DragonHB gets its own methods back) and returns the transcript. */
  finish(): Transcript;
}

/**
 * Records every createFace, createFont, shape and nominalGlyph call made on hb until finish(). Identical calls are
 * kept once, in first-use order. At finish, the 16.16 advance of every glyph id the shape calls returned is added
 * per font, so the bridges' glyph_advance is replayed too. fileOf maps a face's sha256 to its repo-relative path.
 */
export function recordTranscript(hb: DragonHB, source: string, wasmSha256: string, fileOf: (sha256: string) => string): Recorder {
  const faces: TranscriptFace[] = [];
  const fonts: TranscriptFont[] = [];
  const texts: string[] = [];
  const textIds = new Map<string, number>();
  const calls: TranscriptCall[] = [];
  const seen = new Set<string>();
  const faceIds = new Map<number, number>();
  const fontIds = new Map<number, number>();
  const fontKeys = new Map<string, number>();
  const glyphsOf = new Map<number, Set<number>>();
  const orig = { createFace: hb.createFace, createFont: hb.createFont, shape: hb.shape, nominalGlyph: hb.nominalGlyph };
  const push = (c: TranscriptCall, key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    calls.push(c);
  };
  const fontId = (font: number): number => {
    const id = fontIds.get(font);
    if (id === undefined) throw new Error(`transcript: font ${font} was created before recording`);
    return id;
  };

  hb.createFace = (bytes: Uint8Array, index = 0): number => {
    if (index !== 0) throw new Error('transcript: only face index 0 is recorded');
    const face = orig.createFace.call(hb, bytes, index);
    const sha256 = sha256Hex(bytes);
    const known = faces.find((f) => f.sha256 === sha256);
    if (known !== undefined) faceIds.set(face, known.id);
    else {
      faces.push({ id: faces.length, file: fileOf(sha256), sha256 });
      faceIds.set(face, faces.length - 1);
    }
    return face;
  };
  hb.createFont = (face: number, o: FontOptions): number => {
    if ((o.variations ?? []).length > 0) throw new Error('transcript: explicit variations are not recorded');
    const font = orig.createFont.call(hb, face, o);
    const faceId = faceIds.get(face);
    if (faceId === undefined) throw new Error(`transcript: face ${face} was created before recording`);
    const f32 = Math.fround;
    const entry = {
      face: faceId,
      size: f32(o.size),
      specifiedSize: f32(o.specifiedSize ?? o.size),
      weight: f32(o.weight ?? 400),
      width: f32(o.width ?? 100),
      slope: f32(o.slope ?? 0),
      opticalSizingAuto: o.opticalSizingAuto !== false,
    };
    const key = JSON.stringify(entry);
    const known = fontKeys.get(key);
    if (known !== undefined) fontIds.set(font, known);
    else {
      fontKeys.set(key, fonts.length);
      fonts.push({ id: fonts.length, ...entry });
      fontIds.set(font, fonts.length - 1);
    }
    return font;
  };
  hb.shape = (font: number, text: string, offset: number, length: number, o: ShapeOptions): Int32Array => {
    const g = orig.shape.call(hb, font, text, offset, length, o);
    let ti = textIds.get(text);
    if (ti === undefined) {
      ti = texts.length;
      texts.push(text);
      textIds.set(text, ti);
    }
    const call: ShapeCall = {
      op: 'shape',
      font: fontId(font),
      text: ti,
      start: offset,
      end: offset + length,
      script: o.script,
      rtl: o.direction === 'rtl',
      language: o.language,
      features: (o.features ?? []).map((f) => [tagFromString(f.tag) | 0, f.value >>> 0, (f.start ?? 0) >>> 0, (f.end ?? 0xffffffff) >>> 0] as const),
      glyphs: Array.from(g),
    };
    const { glyphs: _, ...inputs } = call;
    push(call, JSON.stringify(inputs));
    let set = glyphsOf.get(call.font);
    if (set === undefined) glyphsOf.set(call.font, (set = new Set()));
    for (let i = 0; i < g.length; i += GLYPH_STRIDE) set.add(g[i] as number);
    return g;
  };
  hb.nominalGlyph = (font: number, codepoint: number): number => {
    const glyph = orig.nominalGlyph.call(hb, font, codepoint);
    push({ op: 'nominal', font: fontId(font), codepoint, glyph }, `nominal/${fontId(font)}/${codepoint}`);
    return glyph;
  };

  return {
    finish(): Transcript {
      // The recording methods are own properties shadowing the prototype's; dropping them restores hb.
      for (const k of Object.keys(orig)) delete (hb as unknown as Record<string, unknown>)[k];
      const reverse = new Map([...fontIds].map(([handle, id]) => [id, handle]));
      for (const [id, set] of [...glyphsOf].sort((a, b) => a[0] - b[0])) {
        const handle = reverse.get(id) as number;
        for (const glyph of [...set].sort((a, b) => a - b)) calls.push({ op: 'advance', font: id, glyph, advance: hb.glyphAdvance(handle, glyph) });
      }
      return { format: TRANSCRIPT_FORMAT, source, wasmSha256, faces, fonts, texts, calls };
    },
  };
}

/** The shim calls a replay needs; the WASM (DragonHB), Swift and Kotlin bridges each provide them. */
export interface ReplayBackend {
  createFace(bytes: Uint8Array): number;
  createFont(face: number, f: TranscriptFont): number;
  shape(font: number, text: string, c: ShapeCall): ArrayLike<number>;
  nominalGlyph(font: number, codepoint: number): number;
  glyphAdvance(font: number, glyph: number): number;
}

export interface ReplayMismatch {
  readonly call: number;
  readonly op: TranscriptCall['op'];
  readonly detail: string;
}

export interface ReplayReport {
  readonly calls: number;
  readonly shapeCalls: number;
  readonly glyphs: number;
  readonly mismatches: readonly ReplayMismatch[];
}

/** Replays every call and compares each integer. readFace returns a face's bytes; their sha256 must match. */
export function replayTranscript(t: Transcript, backend: ReplayBackend, readFace: (face: TranscriptFace) => Uint8Array): ReplayReport {
  const faces = t.faces.map((f) => {
    const bytes = readFace(f);
    const sha = sha256Hex(bytes);
    if (sha !== f.sha256) throw new Error(`face ${f.id} (${f.file}): sha256 ${sha}, transcript ${f.sha256}`);
    return backend.createFace(bytes);
  });
  const fonts = t.fonts.map((f) => backend.createFont(faces[f.face] as number, f));
  const mismatches: ReplayMismatch[] = [];
  let shapeCalls = 0;
  let glyphs = 0;
  t.calls.forEach((c, i) => {
    const font = fonts[c.font] as number;
    if (c.op === 'shape') {
      shapeCalls++;
      const got = Array.from(backend.shape(font, t.texts[c.text] as string, c));
      glyphs += got.length / GLYPH_STRIDE;
      const at = got.length !== c.glyphs.length ? -1 : got.findIndex((v, j) => v !== c.glyphs[j]);
      if (got.length !== c.glyphs.length || at >= 0) mismatches.push({ call: i, op: c.op, detail: at < 0 ? `length ${got.length}, expected ${c.glyphs.length}` : `int ${at}: ${got[at]}, expected ${c.glyphs[at]}` });
    } else if (c.op === 'nominal') {
      const got = backend.nominalGlyph(font, c.codepoint);
      if (got !== c.glyph) mismatches.push({ call: i, op: c.op, detail: `U+${c.codepoint.toString(16)}: ${got}, expected ${c.glyph}` });
    } else {
      const got = backend.glyphAdvance(font, c.glyph);
      if (got !== c.advance) mismatches.push({ call: i, op: c.op, detail: `glyph ${c.glyph}: ${got}, expected ${c.advance}` });
    }
  });
  return { calls: t.calls.length, shapeCalls, glyphs, mismatches };
}

/** The WASM as a replay backend. */
export function wasmBackend(hb: DragonHB): ReplayBackend {
  return {
    createFace: (bytes) => hb.createFace(bytes),
    createFont: (face, f) => hb.createFont(face, { size: f.size, specifiedSize: f.specifiedSize, weight: f.weight, width: f.width, slope: f.slope, opticalSizingAuto: f.opticalSizingAuto }),
    shape: (font, text, c) => hb.shape(font, text, c.start, c.end - c.start, {
      script: c.script,
      direction: c.rtl ? 'rtl' : 'ltr',
      language: c.language,
      features: c.features.map(([tag, value, start, end]) => ({ tag: tagToString(tag >>> 0), value, start, end })),
    }),
    nominalGlyph: (font, codepoint) => hb.nominalGlyph(font, codepoint),
    glyphAdvance: (font, glyph) => hb.glyphAdvance(font, glyph),
  };
}

/** A backend that drops every feature: replaying the gate through it must mismatch, so the calls depend on features. */
export function withoutFeatures(backend: ReplayBackend): ReplayBackend {
  return { ...backend, shape: (font, text, c) => backend.shape(font, text, { ...c, features: [] }) };
}

export type TranscriptPlant = 'off-by-one';

/** Planted fault: one expected integer (the first shape call's first x advance) is off by one. */
export function plantTranscript(t: Transcript, plant: TranscriptPlant): Transcript {
  if (plant !== 'off-by-one') throw new Error(`unknown plant ${String(plant)}`);
  const i = t.calls.findIndex((c) => c.op === 'shape' && c.glyphs.length >= GLYPH_STRIDE);
  if (i < 0) throw new Error('plant off-by-one: no shape call with a glyph');
  const c = t.calls[i] as ShapeCall;
  const glyphs = [...c.glyphs];
  glyphs[2] = (glyphs[2] as number) + 1;
  return { ...t, calls: t.calls.map((x, j) => (j === i ? { ...c, glyphs } : x)) };
}

