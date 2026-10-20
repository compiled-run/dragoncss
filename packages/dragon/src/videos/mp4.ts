// MEDIA-EL: the natural size of an MP4 (ISO/IEC 14496-12) holding one H.264 video track, as Chrome 145 reads it. Chrome takes the
// size from the sample entry's width and height (stsd), not the tkhd's, scales the width by the pixel aspect ratio and turns it by
// the track matrix (Chrome 145 probes, MEDIA-EL: a 64x48 stream whose tkhd says 100x30 is 64x48, one whose stsd says 100x30 is
// 100x30; pasp 3:2 makes 64x48 96x48; a 90-degree matrix makes it 48x64). The platform decoders size a frame from the stream's
// sequence parameter set (ITU-T H.264 §7.3.2.1.1: the macroblock counts less the frame cropping), so Dragon requires the two to
// agree. It draws only what every target plays the same: progressive 8-bit 4:2:0 H.264 Baseline, Main or High with square pixels
// and an identity matrix; anything else is a refusal naming what differs.

export type Mp4Facts = { readonly width: number; readonly height: number; readonly profile: number };

export type Mp4Parse = { readonly ok: true; readonly facts: Mp4Facts } | { readonly ok: false; readonly reason: string };

type Box = { readonly type: string; readonly start: number; readonly body: number; readonly end: number };

const u16 = (b: Uint8Array, at: number): number => ((b[at] as number) << 8) | (b[at + 1] as number);
const u32 = (b: Uint8Array, at: number): number => (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0;
const fourcc = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] as number, b[at + 1] as number, b[at + 2] as number, b[at + 3] as number);

/** The boxes between from and to (ISO/IEC 14496-12 §4.2: a 32-bit size, 1 for a 64-bit largesize, 0 for to the end), or null. */
function boxes(b: Uint8Array, from: number, to: number): Box[] | null {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    if (to - at < 8) return null;
    let size = u32(b, at);
    let body = at + 8;
    if (size === 1) {
      if (to - at < 16) return null;
      const high = u32(b, at + 8);
      if (high !== 0) return null;
      size = u32(b, at + 12);
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at || at + size > to) return null;
    out.push({ type: fourcc(b, at + 4), start: at, body, end: at + size });
    at += size;
  }
  return out;
}

const childrenOf = (b: Uint8Array, box: Box, skip = 0): Box[] | null => boxes(b, box.body + skip, box.end);

/** Drops the emulation prevention bytes of a NAL unit (H.264 §7.4.1: 00 00 03 stands for 00 00). */
function rbsp(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const v of nal) {
    if (zeros >= 2 && v === 3) {
      zeros = 0;
      continue;
    }
    out.push(v);
    zeros = v === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

class Bits {
  private at = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  bit(): number {
    const byte = this.b[this.at >> 3];
    if (byte === undefined) throw new RangeError('the sequence parameter set ends early');
    const v = (byte >> (7 - (this.at & 7))) & 1;
    this.at++;
    return v;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 2 + this.bit();
    return v;
  }
  /** ue(v), H.264 §9.1. */
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      if (++zeros > 31) throw new RangeError('an Exp-Golomb code is longer than 32 bits');
    }
    return 2 ** zeros - 1 + this.bits(zeros);
  }
  /** se(v), H.264 §9.1.1. */
  se(): number {
    const k = this.ue();
    return k % 2 === 1 ? (k + 1) / 2 : -(k / 2);
  }
}

/** The profiles that carry chroma_format_idc and the scaling matrices (H.264 §7.3.2.1.1). */
const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
/** Baseline (66), Main (77) and High (100): the H.264 profiles Chrome, AVFoundation and Android's MediaCodec all decode. */
const DRAWN_PROFILES = new Set([66, 77, 100]);

export type SpsFacts = { readonly profile: number; readonly width: number; readonly height: number; readonly chromaFormat: number; readonly bitDepth: number; readonly progressive: boolean; readonly sar: readonly [number, number] | null };

/** H.264 §7.3.2.1.1 seq_parameter_set_data up to the VUI aspect ratio, from an SPS NAL unit (its header byte included). */
export function parseSps(nal: Uint8Array): SpsFacts {
  if (nal.length < 4 || ((nal[0] as number) & 0x1f) !== 7) throw new RangeError('the first parameter set is not a sequence parameter set');
  const r = new Bits(rbsp(nal.subarray(1)));
  const profile = r.bits(8);
  r.bits(16); // constraint flags, reserved bits and level_idc
  r.ue(); // seq_parameter_set_id
  let chromaFormat = 1;
  let separatePlanes = false;
  let bitDepth = 8;
  if (HIGH_PROFILES.has(profile)) {
    chromaFormat = r.ue();
    if (chromaFormat === 3) separatePlanes = r.bit() === 1;
    bitDepth = r.ue() + 8;
    const chromaDepth = r.ue() + 8;
    if (chromaDepth !== bitDepth) bitDepth = Math.max(bitDepth, chromaDepth);
    r.bit(); // qpprime_y_zero_transform_bypass_flag
    if (r.bit() === 1) {
      for (let i = 0; i < (chromaFormat !== 3 ? 8 : 12); i++) {
        if (r.bit() === 0) continue;
        // scaling_list (§7.3.2.1.1.1): delta_scale until nextScale is 0.
        let last = 8;
        let next = 8;
        for (let j = 0; j < (i < 6 ? 16 : 64) && next !== 0; j++) {
          next = (last + r.se() + 256) % 256;
          if (next !== 0) last = next;
        }
      }
    }
  }
  r.ue(); // log2_max_frame_num_minus4
  const pocType = r.ue();
  if (pocType === 0) r.ue();
  else if (pocType === 1) {
    r.bit();
    r.se();
    r.se();
    const cycle = r.ue();
    for (let i = 0; i < cycle; i++) r.se();
  }
  r.ue(); // max_num_ref_frames
  r.bit(); // gaps_in_frame_num_value_allowed_flag
  const widthMbs = r.ue() + 1;
  const heightUnits = r.ue() + 1;
  const frameMbsOnly = r.bit();
  if (frameMbsOnly === 0) r.bit();
  r.bit(); // direct_8x8_inference_flag
  let crop = [0, 0, 0, 0];
  if (r.bit() === 1) crop = [r.ue(), r.ue(), r.ue(), r.ue()];
  // §7.4.2.1.1, Table 6-1: the crop unit of the chroma format.
  const chromaArray = separatePlanes ? 0 : chromaFormat;
  const subW = chromaArray === 1 || chromaArray === 2 ? 2 : 1;
  const subH = chromaArray === 1 ? 2 : 1;
  const unitX = chromaArray === 0 ? 1 : subW;
  const unitY = (chromaArray === 0 ? 1 : subH) * (2 - frameMbsOnly);
  const width = widthMbs * 16 - unitX * ((crop[0] as number) + (crop[1] as number));
  const height = (2 - frameMbsOnly) * heightUnits * 16 - unitY * ((crop[2] as number) + (crop[3] as number));
  let sar: readonly [number, number] | null = null;
  if (r.bit() === 1 && r.bit() === 1) {
    // Annex E.2.1, Table E-1: aspect_ratio_idc, 255 for an explicit sar_width and sar_height.
    const idc = r.bits(8);
    sar = idc === 255 ? [r.bits(16), r.bits(16)] : (SAR_TABLE[idc] ?? [0, 0]);
  }
  return { profile, width, height, chromaFormat, bitDepth, progressive: frameMbsOnly === 1, sar };
}

/** H.264 Table E-1 sample aspect ratios by aspect_ratio_idc; 0 is unspecified. */
const SAR_TABLE: { readonly [idc: number]: readonly [number, number] } = {
  0: [0, 0], 1: [1, 1], 2: [12, 11], 3: [10, 11], 4: [16, 11], 5: [40, 33], 6: [24, 11], 7: [20, 11], 8: [32, 11], 9: [80, 33],
  10: [18, 11], 11: [15, 11], 12: [64, 33], 13: [160, 99], 14: [4, 3], 15: [3, 2], 16: [2, 1],
};

/** An unspecified (0:0) or square sample aspect ratio. */
const square = (sar: readonly [number, number] | null): boolean => sar === null || (sar[0] === 0 && sar[1] === 0) || (sar[0] !== 0 && sar[0] === sar[1]);

/** tkhd's unity matrix (ISO/IEC 14496-12 §8.3.2.3): no rotation, mirror or scale. */
const IDENTITY = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

function videoTracks(b: Uint8Array, moov: Box): { readonly tkhd: Box; readonly stsd: Box }[] | null {
  const out: { tkhd: Box; stsd: Box }[] = [];
  const kids = childrenOf(b, moov);
  if (kids === null) return null;
  for (const trak of kids.filter((k) => k.type === 'trak')) {
    const t = childrenOf(b, trak);
    const tkhd = t?.find((k) => k.type === 'tkhd');
    const mdia = t?.find((k) => k.type === 'mdia');
    if (t === null || tkhd === undefined || mdia === undefined) return null;
    const m = childrenOf(b, mdia);
    const hdlr = m?.find((k) => k.type === 'hdlr');
    const minf = m?.find((k) => k.type === 'minf');
    if (m === null || hdlr === undefined || minf === undefined || hdlr.end - hdlr.body < 12) return null;
    // hdlr: version and flags, pre_defined, handler_type (§8.4.3).
    if (fourcc(b, hdlr.body + 8) !== 'vide') continue;
    const stbl = childrenOf(b, minf)?.find((k) => k.type === 'stbl');
    const stsd = stbl === undefined ? undefined : childrenOf(b, stbl)?.find((k) => k.type === 'stsd');
    if (stsd === undefined) return null;
    out.push({ tkhd, stsd });
  }
  return out;
}

/** The tkhd matrix (§8.3.2): after version and flags, two times, track_ID, a reserved word, the duration, 8 reserved bytes and four 16-bit fields. */
function trackMatrix(b: Uint8Array, tkhd: Box): number[] | null {
  const version = b[tkhd.body];
  const at = tkhd.body + 4 + (version === 1 ? 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4) + 8 + 8;
  if (at + 36 > tkhd.end) return null;
  return Array.from({ length: 9 }, (_, i) => u32(b, at + 4 * i));
}

/** The natural size Chrome 145 gives an MP4's video, or why Dragon does not draw it. */
export function parseMp4(b: Uint8Array): Mp4Parse {
  const top = boxes(b, 0, b.length);
  if (top === null || top[0]?.type !== 'ftyp') return { ok: false, reason: 'it is not an MP4 file (ISO/IEC 14496-12: no ftyp box first)' };
  const moov = top.find((x) => x.type === 'moov');
  if (moov === undefined) return { ok: false, reason: 'the MP4 has no moov box' };
  const tracks = videoTracks(b, moov);
  if (tracks === null) return { ok: false, reason: 'the MP4 has a malformed track' };
  if (tracks.length !== 1) return { ok: false, reason: `the MP4 has ${tracks.length} video tracks; Dragon draws a video with exactly one` };
  const { tkhd, stsd } = tracks[0] as { tkhd: Box; stsd: Box };
  const matrix = trackMatrix(b, tkhd);
  if (matrix === null) return { ok: false, reason: 'the MP4 has a malformed tkhd box' };
  if (!matrix.every((v, i) => v === IDENTITY[i])) return { ok: false, reason: 'its video track has a rotation or scale matrix, which Dragon does not apply yet' };
  // stsd: version and flags, entry_count, then one sample entry per box (§8.5.2).
  const entries = childrenOf(b, stsd, 8);
  if (entries === null || entries.length !== 1) return { ok: false, reason: 'its video track does not have exactly one sample description' };
  const entry = entries[0] as Box;
  if (entry.type !== 'avc1' && entry.type !== 'avc3') return { ok: false, reason: `its video is ${JSON.stringify(entry.type)}; Dragon draws H.264 (avc1, avc3) only, which every target decodes` };
  // VisualSampleEntry (§12.1.3): 78 bytes of fields before its boxes.
  const kids = childrenOf(b, entry, 78);
  const avcc = kids?.find((k) => k.type === 'avcC');
  if (kids === null || avcc === undefined) return { ok: false, reason: 'its H.264 sample entry has no avcC box' };
  const pasp = kids.find((k) => k.type === 'pasp');
  if (pasp !== undefined && (pasp.end - pasp.body < 8 || !square([u32(b, pasp.body), u32(b, pasp.body + 4)]))) return { ok: false, reason: 'its pixels are not square (pasp), which Dragon does not scale yet' };
  // AVCDecoderConfigurationRecord (ISO/IEC 14496-15 §5.3.3.1): four bytes, the length size, then the count of SPS units.
  if (avcc.end - avcc.body < 8) return { ok: false, reason: 'its avcC box is truncated' };
  const spsCount = (b[avcc.body + 5] as number) & 0x1f;
  if (spsCount !== 1) return { ok: false, reason: `its avcC box has ${spsCount} sequence parameter sets; Dragon reads a stream with exactly one` };
  const len = u16(b, avcc.body + 6);
  if (avcc.body + 8 + len > avcc.end) return { ok: false, reason: 'its avcC box is truncated' };
  let sps: SpsFacts;
  try {
    sps = parseSps(b.subarray(avcc.body + 8, avcc.body + 8 + len));
  } catch (e) {
    return { ok: false, reason: `its sequence parameter set does not parse (${(e as Error).message})` };
  }
  if (!DRAWN_PROFILES.has(sps.profile)) return { ok: false, reason: `its H.264 profile_idc is ${sps.profile}; Dragon draws Baseline, Main and High (66, 77, 100), which every target decodes` };
  if (sps.chromaFormat !== 1 || sps.bitDepth !== 8) return { ok: false, reason: 'its video is not 8-bit 4:2:0, which not every target decodes' };
  if (!sps.progressive) return { ok: false, reason: 'its video is interlaced, which Dragon does not draw' };
  if (!square(sps.sar)) return { ok: false, reason: 'its pixels are not square (the stream\'s sample aspect ratio), which Dragon does not scale yet' };
  if (sps.width <= 0 || sps.height <= 0) return { ok: false, reason: 'its video crops to nothing' };
  // VisualSampleEntry (§12.1.3): six reserved bytes, data_reference_index, 16 bytes of pre_defined and reserved, width, height.
  const width = u16(b, entry.body + 6 + 2 + 16);
  const height = u16(b, entry.body + 6 + 2 + 16 + 2);
  if (width !== sps.width || height !== sps.height) return { ok: false, reason: `its sample entry says ${width}x${height} and its stream ${sps.width}x${sps.height}; Chrome sizes the video by the first and the platform decoders by the second` };
  return { ok: true, facts: { width, height, profile: sps.profile } };
}
