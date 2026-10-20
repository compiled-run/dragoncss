// MEDIA-EL: <video> on web, iOS and Android. The natural size Chrome 145 reads from an MP4's H.264 stream (videos/mp4.ts), the src
// rules (videos/compile.ts, iOS and Android refusing a stream until a lane proves its first frame), the attribute and hint rules,
// and the emission of the platform player. The streams (ffmpeg 6.1 libx264, one frame) are a 64x48 Baseline stream and a 66x50 High
// stream whose SPS crops 80x64 macroblocks; Chrome 145 gives them those sizes, and the patched ones the sizes the cases name.
import { describe, expect, it } from 'vitest';
import { presentationalHints } from '../src/analysis/elements/replaced.ts';
import { attributeRefusal } from '../src/attributes.ts';
import { streamLit } from '../src/emit/paint/foreign-view.ts';
import { emitNativeSupport } from '../src/emit/native-support.ts';
import type { ElementNode } from '../src/internal.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { parseMp4, parseSps } from '../src/videos/mp4.ts';
import { NATIVE_FRAME_UNPROVEN, readVideoSource } from '../src/videos/compile.ts';
import { always, div, inputFor } from './helpers.ts';

const B64_64X48 = [
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAp1tZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCBy',
  'MzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQu',
  'aHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9',
  'MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0',
  'X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9',
  'MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9t',
  'aW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWlu',
  'PTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAB1liIQFfEYoAAoWxwABUGjgACWnJycnXXXXXXXXgAAAAxBtb292AAAA',
  'bG12aGQAAAAAAAAAAAAAAAAAAAPoAAAD6AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAACAAACOnRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEA',
  'AAAAAAAAAAAAAAAAAEAAAAAAQAAAADAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAA+gAAAAAAAEAAAAAAbJtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAA',
  'AEAAAABAAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAFdbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRp',
  'bmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABHXN0YmwAAAC5c3RzZAAAAAAAAAABAAAAqWF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAQAAw',
  'AEgAAABIAAAAAAAAAAEVTGF2YzYwLjMxLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAY//8AAAAvYXZjQwFCwAr/4QAXZ0LACtkEewEQAAADABAAAAMAIPEiZIAB',
  'AAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABSoAAAUqAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAA',
  'AQAAAAEAAAAUc3RzegAAAAAAAAKVAAAAAQAAABRzdGNvAAAAAAAAAAEAAAAwAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwA',
  'AAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2MC4xNi4xMDA=',
].join('');
const B64_66X50 = [
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAudtZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCBy',
  'MzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQu',
  'aHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9',
  'MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0',
  'X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTIgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9',
  'MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9',
  'MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVz',
  'aD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlv',
  'PTEuNDAgYXE9MToxLjAwAIAAAAAqZYiEABX//uzPfgUXWC/D8UVjujHXjmNOmhniYbXR+SWMs2NRK00s3g5hAAADGG1vb3YAAABsbXZoZAAAAAAAAAAAAAAA',
  'AAAAA+gAAAPoAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA',
  'AAJCdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAPoAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAA',
  'AABCAAAAMgAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAAD6AAAAAAAAQAAAAABum1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAQAAAAEAAVcQAAAAAAC1o',
  'ZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAWVtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAA',
  'AAEAAAAMdXJsIAAAAAEAAAElc3RibAAAAMFzdHNkAAAAAAAAAAEAAACxYXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAABCADIASAAAAEgAAAAAAAAAARVM',
  'YXZjNjAuMzEuMTAyIGxpYngyNjQAAAAAAAAAAAAAABj//wAAADdhdmNDAWQACv/hABpnZAAKrNlFJ4iIwEQAAAMABAAAAwAIPEiWWAEABmjr48siwP34+AAA',
  'AAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAW+AAAFvgAAAAYc3R0cwAAAAAAAAABAAAAAQAAQAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAA',
  'FHN0c3oAAAAAAAAC3wAAAAEAAAAUc3RjbwAAAAAAAAABAAAAMAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAA',
  'AAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAw',
].join('');
const bytes = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, 'base64'));
const SRC_64 = `data:video/mp4;base64,${B64_64X48}`;

/** The offset of a box's fourcc in an MP4. */
const at = (b: Uint8Array, fourcc: string): number => Buffer.from(b).indexOf(fourcc, 0, 'latin1');
// (The ftyp's brands name avc1 and the stream's SEI text names vide, so a sample entry and a handler are found by their parent.)
/** The offset of the stsd's one sample entry fourcc: after stsd's fourcc, its version and flags, entry_count and the entry's size. */
const entryAt = (b: Uint8Array): number => at(b, 'stsd') + 4 + 4 + 4 + 4;
const patched = (b64: string, f: (b: Uint8Array, view: DataView) => void): Uint8Array => {
  const b = bytes(b64);
  f(b, new DataView(b.buffer, b.byteOffset, b.byteLength));
  return b;
};

/** H.264 §7.3.2.1.1 SPS bits, written MSB first: u(n), ue(v) and se(v). */
class SpsWriter {
  private bits: number[] = [];
  u(n: number, v: number): this {
    for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) % 2);
    return this;
  }
  ue(v: number): this {
    const len = Math.floor(Math.log2(v + 1));
    this.u(len, 0);
    return this.u(len + 1, v + 1);
  }
  se(v: number): this {
    return this.ue(v > 0 ? 2 * v - 1 : -2 * v);
  }
  nal(): Uint8Array {
    const bits = [...this.bits, 1];
    while (bits.length % 8 !== 0) bits.push(0);
    const out = [0x67];
    for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, x) => a * 2 + x, 0));
    return Uint8Array.from(out);
  }
}

/** An SPS of the given profile, macroblock counts, frame cropping and VUI aspect ratio (null: no VUI). */
function sps(o: { profile: number; mbs: [number, number]; crop?: [number, number, number, number]; frameMbsOnly?: boolean; sar?: [number, number] | number | null; scaling?: boolean }): Uint8Array {
  const w = new SpsWriter().u(8, o.profile).u(8, 0).u(8, 30).ue(0);
  if (o.profile === 100) {
    w.ue(1).ue(0).ue(0).u(1, 0).u(1, o.scaling === true ? 1 : 0);
    // seq_scaling_list_present_flag for the 8 lists: the first one present, with a delta_scale run that ends on nextScale 0.
    if (o.scaling === true) {
      w.u(1, 1).se(8).se(-16);
      for (let i = 1; i < 8; i++) w.u(1, 0);
    }
  }
  w.ue(0).ue(0).ue(4).ue(1).u(1, 0).ue(o.mbs[0] - 1).ue(o.mbs[1] - 1).u(1, o.frameMbsOnly === false ? 0 : 1);
  if (o.frameMbsOnly === false) w.u(1, 0);
  w.u(1, 1);
  if (o.crop === undefined) w.u(1, 0);
  else w.u(1, 1).ue(o.crop[0]).ue(o.crop[1]).ue(o.crop[2]).ue(o.crop[3]);
  if (o.sar === undefined || o.sar === null) w.u(1, 0);
  else if (typeof o.sar === 'number') w.u(1, 1).u(1, 1).u(8, o.sar);
  else w.u(1, 1).u(1, 1).u(8, 255).u(16, o.sar[0]).u(16, o.sar[1]);
  return w.nal();
}

describe('MEDIA-EL: an MP4 natural size as Chrome 145 reads it', () => {
  it('reads the sample entry size, which the H.264 stream (its SPS frame cropping included) agrees with', () => {
    expect(parseMp4(bytes(B64_64X48))).toEqual({ ok: true, facts: { width: 64, height: 48, profile: 66 } });
    expect(parseMp4(bytes(B64_66X50))).toEqual({ ok: true, facts: { width: 66, height: 50, profile: 100 } });
  });

  it('ignores the tkhd width and height, as Chrome does, and refuses a sample entry size the stream does not have', () => {
    const tkhd = patched(B64_64X48, (b, v) => {
      // tkhd v0: size, type, version and flags, two times, track_ID, reserved, duration, 8 reserved, four 16-bit fields, matrix.
      const o = at(b, 'tkhd') - 4 + 8 + 4 + 20 + 8 + 8 + 36;
      v.setUint32(o, 100 * 0x10000);
      v.setUint32(o + 4, 30 * 0x10000);
    });
    const stsd = patched(B64_64X48, (b, v) => {
      const o = entryAt(b) - 4 + 8 + 6 + 2 + 16;
      v.setUint16(o, 100);
      v.setUint16(o + 2, 30);
    });
    expect(parseMp4(tkhd)).toMatchObject({ ok: true, facts: { width: 64, height: 48 } });
    // Chrome 145 lays this one out at 100x30, the decoders draw 64x48 frames.
    expect(parseMp4(stsd)).toEqual({ ok: false, reason: 'its sample entry says 100x30 and its stream 64x48; Chrome sizes the video by the first and the platform decoders by the second' });
  });

  it('refuses a rotated track, another codec, a stream that is not an MP4 and an MP4 without video', () => {
    const rotated = patched(B64_64X48, (b, v) => {
      const o = at(b, 'tkhd') - 4 + 8 + 4 + 20 + 8 + 8;
      // A 90-degree matrix: [0, 1, 0, -1, 0, 0, 0, 0, 1] in 16.16 (and 2.30 for the last column).
      [0, 0x10000, 0, -0x10000 >>> 0, 0, 0, 0, 0, 0x40000000].forEach((x, i) => v.setUint32(o + 4 * i, x));
    });
    expect(parseMp4(rotated)).toEqual({ ok: false, reason: 'its video track has a rotation or scale matrix, which Dragon does not apply yet' });
    const hevc = patched(B64_64X48, (b) => b.set([0x68, 0x76, 0x63, 0x31], entryAt(b)));
    expect(parseMp4(hevc)).toMatchObject({ ok: false, reason: 'its video is "hvc1"; Dragon draws H.264 (avc1) only, which every target decodes' });
    expect(parseMp4(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toMatchObject({ ok: false, reason: expect.stringContaining('not an MP4') });
    // hdlr: version and flags, pre_defined, then handler_type ('vide' to 'soun').
    const audio = patched(B64_64X48, (b) => b.set([0x73, 0x6f, 0x75, 0x6e], at(b, 'hdlr') + 12));
    expect(parseMp4(audio)).toMatchObject({ ok: false, reason: 'the MP4 has 0 video tracks; Dragon draws a video with exactly one' });
  });

  it('refuses a rotated movie, in-band parameter sets, a clean aperture and a 0:0 pasp (Chrome 145: a 90-degree mvhd makes 64x48 48x64)', () => {
    const movie = patched(B64_64X48, (b, v) => {
      // mvhd v0: after its fourcc, version and flags, two times, timescale, duration, rate, volume and 10 reserved bytes.
      const o = at(b, 'mvhd') + 4 + 4 + 16 + 4 + 2 + 2 + 8;
      [0, 0x10000, 0, -0x10000 >>> 0, 0, 0, 0, 0, 0x40000000].forEach((x, i) => v.setUint32(o + 4 * i, x));
    });
    expect(parseMp4(movie)).toEqual({ ok: false, reason: 'its movie has a rotation or scale matrix (mvhd), which Dragon does not apply yet' });
    const avc3 = patched(B64_64X48, (b) => b.set([0x61, 0x76, 0x63, 0x33], entryAt(b)));
    expect(parseMp4(avc3)).toEqual({ ok: false, reason: 'its H.264 sample entry is avc3, whose parameter sets may come in band; Dragon reads avc1, whose one SPS is in its avcC box' });
    // The sample entry's btrt box renamed clap: AVFoundation would crop to it.
    const clap = patched(B64_64X48, (b) => b.set([0x63, 0x6c, 0x61, 0x70], at(b, 'btrt')));
    expect(parseMp4(clap)).toEqual({ ok: false, reason: 'its sample entry has a clean aperture (clap), which not every target applies' });
    const zero = patched(B64_64X48, (b) => b.fill(0, at(b, 'pasp') + 4, at(b, 'pasp') + 12));
    expect(parseMp4(zero)).toEqual({ ok: false, reason: 'its pixels are not square (pasp), which Dragon does not scale yet' });
  });

  it('parses the SPS size: macroblocks less the 4:2:0 crop units, field pairs, scaling lists and the VUI aspect ratio', () => {
    expect(parseSps(sps({ profile: 66, mbs: [4, 3] }))).toMatchObject({ width: 64, height: 48, progressive: true, sar: null });
    expect(parseSps(sps({ profile: 100, mbs: [5, 4], crop: [0, 7, 0, 7] }))).toMatchObject({ width: 66, height: 50, chromaFormat: 1, bitDepth: 8 });
    expect(parseSps(sps({ profile: 100, mbs: [5, 4], crop: [0, 7, 0, 7], scaling: true }))).toMatchObject({ width: 66, height: 50 });
    // frame_mbs_only_flag 0: map units are macroblock pairs, and the vertical crop unit doubles.
    expect(parseSps(sps({ profile: 77, mbs: [4, 2], crop: [0, 0, 0, 1], frameMbsOnly: false }))).toMatchObject({ width: 64, height: 60, progressive: false });
    expect(parseSps(sps({ profile: 66, mbs: [4, 3], sar: 1 })).sar).toEqual([1, 1]);
    expect(parseSps(sps({ profile: 66, mbs: [4, 3], sar: 16 })).sar).toEqual([2, 1]);
    expect(parseSps(sps({ profile: 66, mbs: [4, 3], sar: [3, 2] })).sar).toEqual([3, 2]);
    expect(parseSps(sps({ profile: 66, mbs: [4, 3], sar: 0 })).sar).toEqual([0, 0]);
    // Table E-1: 17 to 254 are reserved, so no sample aspect ratio is known.
    for (const idc of [17, 254]) expect(() => parseSps(sps({ profile: 66, mbs: [4, 3], sar: idc })), String(idc)).toThrow(`its aspect_ratio_idc ${idc} is reserved`);
  });
});

describe('MEDIA-EL: the video src', () => {
  it('reads a data:video/mp4 URL and refuses any other src or type', () => {
    expect(readVideoSource(SRC_64)).toMatchObject({ ok: true, natural: { width: 64, height: 48 } });
    expect(readVideoSource(`DATA:Video/MP4;codecs="avc1.42E01E";base64,${B64_64X48}`)).toMatchObject({ ok: true });
    expect(readVideoSource('a.mp4')).toMatchObject({ ok: false, reason: 'its src a.mp4 is not a data: URL; Dragon reads every video at build time to size it as Chrome does from its stream' });
    expect(readVideoSource(`data:text/plain;base64,${B64_64X48}`)).toMatchObject({ ok: false, reason: 'its src is a data: URL of type text/plain; Dragon reads video/mp4 only' });
    expect(readVideoSource(`data:;base64,${B64_64X48}`)).toMatchObject({ ok: false, reason: 'its src is a data: URL of type text/plain (none given); Dragon reads video/mp4 only' });
  });

  it('takes src, width, height and preload, and names MEDIA-EL for playback, controls and the poster', () => {
    for (const a of ['src', 'width', 'height', 'preload']) expect(attributeRefusal('video', a), a).toBeNull();
    for (const a of ['controls', 'autoplay', 'muted', 'loop', 'playsinline']) expect(attributeRefusal('video', a), a).toBe('its rendering effect belongs to the media-element package MEDIA-EL (controls and playback)');
    expect(attributeRefusal('video', 'poster')).toBe('its rendering effect belongs to the media-element package MEDIA-EL (the poster frame)');
  });

  it('maps width and height to the dimension properties and an auto aspect-ratio, as on img (Chrome 145: auto 200 / 100)', () => {
    expect([...presentationalHints('video', new Map([['width', '200'], ['height', '100']]))]).toEqual([
      ['width', { kind: 'length', value: 200, unit: 'px' }],
      ['height', { kind: 'length', value: 100, unit: 'px' }],
      ['aspect-ratio', { kind: 'ratio', auto: true, width: 200, height: 100 }],
    ]);
  });
});

describe('MEDIA-EL: the platform player', () => {
  const css = 'body { margin: 0; } .v { display: block; width: 200px; height: 100px; } .n { display: block; }';
  const video = (r: Parameters<typeof div>[0], id: string, attributes: Record<string, string>): ElementNode => {
    const el = div(r, id, ['v']);
    return { ...el, tag: 'video', attributes: Object.entries(attributes).map(([name, value]) => ({ name, value: [{ when: always, value }], origin: el.origin })) } as ElementNode;
  };
  const compile = (attributes: Record<string, string>) =>
    createProjectWith({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [video(r, 'v', attributes)]));
  const programs = (attributes: Record<string, string>) => {
    const c = compile(attributes);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };

  it('refuses a stream on iOS and Android until a lane proves the first frame, and keeps web ready', () => {
    const c = compile({ src: SRC_64 });
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => [d.code, d.target, d.message])).toEqual(['ios', 'android'].map((t) => [
      'DRAGON_UNSUPPORTED_ATTRIBUTE', t, `attribute src on v is not supported on ${t}: ${NATIVE_FRAME_UNPROVEN}`,
    ]));
    expect(c.outputs.web.kind).toBe('ready');
    expect(c.outputs.ios.kind).toBe('blocked');
    expect(c.outputs.android.kind).toBe('blocked');
  });

  it('gives a video without a stream no player: no src, or preload none (ASCII case-insensitive) with any src', () => {
    for (const attributes of [{}, { src: 'https://example.com/a.mp4', preload: 'NONE' }, { src: 'a.mp4', preload: 'none' }]) {
      const p = programs(attributes);
      expect(p.uikit.nodes.find((n) => n.id === 'v')?.writes.some((w) => w.kind === 'video-view'), JSON.stringify(attributes)).toBe(false);
    }
  });

  it('refuses a src it cannot read on every target, preload metadata and an invalid preload included', () => {
    for (const preload of [undefined, 'metadata', 'bogus', '']) {
      const d = compile({ src: 'https://example.com/a.mp4', ...(preload === undefined ? {} : { preload }) }).diagnostics.filter((x) => x.severity === 'error');
      expect(d.map((x) => [x.code, x.target]), String(preload)).toEqual([['DRAGON_UNSUPPORTED_ATTRIBUTE', null]]);
    }
  });

  it('joins a stream past one JVM string constant from chunk literals', () => {
    const long = 'A'.repeat(32768 * 2 + 4);
    expect(streamLit('QUJD', 'uikit')).toBe('"QUJD"');
    expect(streamLit(long, 'uikit')).toBe(`["${'A'.repeat(32768)}", "${'A'.repeat(32768)}", "AAAA"].joined()`);
    expect(streamLit(long, 'android-views')).toBe(`arrayOf("${'A'.repeat(32768)}", "${'A'.repeat(32768)}", "AAAA").joinToString("")`);
    expect(() => streamLit('a"b', 'uikit')).toThrow('video data is not base64');
  });

  it('opens the stream in a production build: only a lane host clears dragonVideoViewLoadsStream', () => {
    const swift = emitNativeSupport('uikit').map((f) => f.text).join('\n');
    const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    expect(swift.match(/dragonVideoViewLoadsStream\s*=/g)).toEqual(['dragonVideoViewLoadsStream =']);
    expect(kotlin.match(/dragonVideoViewLoadsStream\s*=/g)).toEqual(['dragonVideoViewLoadsStream =']);
    expect(swift).toContain('\npublic var dragonVideoViewLoadsStream = true\n');
    expect(kotlin).toContain('\nvar dragonVideoViewLoadsStream = true\n');
    expect(swift).toContain('video.playerLayer.videoGravity = .resize');
    expect(swift).toContain('video.playerLayer.player = AVPlayer(url: url)');
    expect(kotlin).toContain('player.setDataSource(file.path)');
  });
});
