// TXT1-N (T056 R3): the committed gate transcript is what the WASM does now, byte for byte, and a replay catches a
// changed integer. The Swift and Kotlin host replays (scripts/replay.ts --swift, --kotlin) compare against this file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_TRANSCRIPT_PATH, REPO_ROOT, recordGate } from '../scripts/replay.ts';
import {
  DEFAULT_WASM_PATH, DragonHB, GLYPH_STRIDE, parseTranscript, plantTranscript, recordTranscript, replayTranscript, serializeTranscript, sha256Hex, tagFromString,
  wasmBackend, withoutFeatures,
} from '../src/index.ts';

const committed = readFileSync(GATE_TRANSCRIPT_PATH, 'utf8');
const transcript = parseTranscript(committed);
const readFace = (f: { readonly file: string }): Uint8Array => readFileSync(join(REPO_ROOT, f.file));

describe('shape transcript of the TXT1-0 gate', () => {
  it('equals a fresh recording of all 1260 cases, byte for byte', () => {
    const { transcript: fresh, cases } = recordGate();
    expect(cases).toBe(1260);
    expect(serializeTranscript(fresh) === committed).toBe(true);
  });

  it('names the committed WASM and every face by sha256', () => {
    expect(transcript.wasmSha256).toBe(sha256Hex(readFileSync(DEFAULT_WASM_PATH)));
    expect(transcript.faces.length).toBe(7);
    for (const f of transcript.faces) expect(sha256Hex(readFace(f)), f.file).toBe(f.sha256);
  });

  it('covers shape, nominal glyph and glyph advance calls', () => {
    const ops = new Map<string, number>();
    for (const c of transcript.calls) ops.set(c.op, (ops.get(c.op) ?? 0) + 1);
    expect(ops.get('shape')).toBe(1100);
    expect(ops.get('nominal')).toBeGreaterThan(0);
    expect(ops.get('advance')).toBeGreaterThan(0);
    for (const c of transcript.calls) if (c.op === 'shape') expect(c.glyphs.length % GLYPH_STRIDE).toBe(0);
  });

  it('captures features as integer records, including HanKerning ranges, and the recorded calls depend on them', () => {
    const tags = new Set<number>();
    let ranged = 0;
    for (const c of transcript.calls) {
      if (c.op !== 'shape') continue;
      for (const f of c.features) {
        expect(f.every((v) => Number.isInteger(v))).toBe(true);
        tags.add(f[0]);
        if (f[2] !== 0 || f[3] !== 0xffffffff) ranged++;
      }
    }
    expect(tags.has(tagFromString('chws') | 0)).toBe(true);
    expect(tags.has(tagFromString('halt') | 0)).toBe(true);
    expect(ranged).toBeGreaterThan(0);
    // A bridge that dropped the features would not reproduce the transcript.
    const r = replayTranscript(transcript, withoutFeatures(wasmBackend(DragonHB.load())), readFace);
    expect(r.mismatches.length).toBeGreaterThan(0);
  });

  it('replays through a fresh WASM instance with 0 mismatches', () => {
    const r = replayTranscript(transcript, wasmBackend(DragonHB.load()), readFace);
    expect([r.calls, r.shapeCalls, r.mismatches.length]).toEqual([transcript.calls.length, 1100, 0]);
  });

  it('planted off-by-one: the replay reports exactly the changed integer', () => {
    const r = replayTranscript(plantTranscript(transcript, 'off-by-one'), wasmBackend(DragonHB.load()), readFace);
    expect(r.mismatches.map((m) => [m.op, m.detail.startsWith('int 2:')])).toEqual([['shape', true]]);
  });

  it('planted bad index: the replay refuses the transcript instead of shaping through a missing font', () => {
    expect(() => replayTranscript(plantTranscript(transcript, 'bad-index'), wasmBackend(DragonHB.load()), readFace)).toThrow(
      `bad transcript: call.font ${transcript.fonts.length} of ${transcript.fonts.length}`,
    );
  });

  it('planted fractional index: the replay refuses it instead of truncating to a valid font', () => {
    const font = (transcript.calls[0] as (typeof transcript.calls)[number]).font;
    expect(() => replayTranscript(plantTranscript(transcript, 'fractional-index'), wasmBackend(DragonHB.load()), readFace)).toThrow(
      `bad transcript: call.font ${font + 0.5} of ${transcript.fonts.length}`,
    );
  });

  it('refuses out-of-range face, text, range, codepoint and glyph values', () => {
    const replay = (t: typeof transcript) => () => replayTranscript(t, wasmBackend(DragonHB.load()), readFace);
    const si = transcript.calls.findIndex((c) => c.op === 'shape');
    const ni = transcript.calls.findIndex((c) => c.op === 'nominal');
    const ai = transcript.calls.findIndex((c) => c.op === 'advance');
    const withCall = (i: number, patch: Record<string, unknown>): typeof transcript => ({ ...transcript, calls: transcript.calls.map((c, j) => (j === i ? { ...c, ...patch } as typeof c : c)) });
    expect(replay({ ...transcript, fonts: transcript.fonts.map((f, j) => (j === 0 ? { ...f, face: -1 } : f)) })).toThrow('bad transcript: font.face -1 of 7');
    expect(replay(withCall(si, { font: -1 }))).toThrow('bad transcript: call.font -1');
    expect(replay(withCall(si, { text: transcript.texts.length }))).toThrow('bad transcript: call.text');
    expect(replay(withCall(si, { start: -1 }))).toThrow('bad transcript: call.start -1');
    expect(replay(withCall(si, { end: 1e6 }))).toThrow('bad transcript: call.start');
    expect(replay(withCall(ni, { codepoint: -1 }))).toThrow('bad transcript: codepoint -1');
    expect(replay(withCall(ni, { codepoint: 65.5 }))).toThrow('bad transcript: codepoint 65.5');
    expect(replay(withCall(ai, { glyph: 2 ** 32 }))).toThrow(`bad transcript: glyph ${2 ** 32}`);
  });

  it('a second finish returns the first transcript unchanged', () => {
    const face = readFace(transcript.faces[0] as (typeof transcript.faces)[number]);
    const hb = DragonHB.load();
    const recorder = recordTranscript(hb, 'finish twice', 'none', () => 'face');
    const font = hb.createFont(hb.createFace(face), { size: 16 });
    hb.shape(font, 'ab', 0, 2, { script: 'Latn', direction: 'ltr', language: 'en' });
    const first = recorder.finish();
    const firstJson = serializeTranscript(first);
    expect(first.calls.some((c) => c.op === 'advance')).toBe(true);
    const second = recorder.finish();
    expect(second).toBe(first);
    expect(serializeTranscript(first)).toBe(firstJson);
  });

  it('refuses a face whose bytes do not match the transcript sha256', () => {
    expect(() => replayTranscript(transcript, wasmBackend(DragonHB.load()), () => new Uint8Array([0]))).toThrow(/sha256/);
  });
});
