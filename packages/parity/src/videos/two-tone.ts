// MEDIA-EL slice 2: the video streams of the parity fixtures, whose first frame the sample rules know exactly. Each is one H.264
// Constrained Baseline IDR picture of I_PCM macroblocks (ITU-T H.264 §7.3.5: the samples stored raw), so the decoded picture is the
// stored one on every decoder, in an MP4 every target plays. Its luma is two-tone, below black (16) or above white (235) of the
// limited range the stream is tagged with by default (§E.2.1 video_full_range_flag 0), and its chroma is neutral (128): every
// YCbCr to RGB matrix (BT.601, BT.709) and every rounding clamps such a sample to black or white exactly, so a frame point is
// compared strictly, with no allowance. decodeTwoTone reads the frame back from the bytes for the sample rules
// (paint-samples/image.ts) and refuses any other stream.
import type { RgbaImage } from '../native-compare.ts';

/** The luma of a black and a white sample: clear of the limited range's ends, and never 0 (H.264 (2003) §7.4.5 forbade a 0 PCM sample). */
export const TWO_TONE_LUMA = { black: 4, white: 251 } as const;
const NEUTRAL_CHROMA = 128;

// ---------------------------------------------------------------- writing

class BitWriter {
  private readonly bytes: number[] = [];
  private cur = 0;
  private n = 0;
  bit(v: number): void {
    this.cur = (this.cur << 1) | (v & 1);
    if (++this.n === 8) this.flush();
  }
  bits(v: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bit(Math.floor(v / 2 ** i) & 1);
  }
  /** ue(v), H.264 §9.1. */
  ue(v: number): void {
    const len = Math.floor(Math.log2(v + 1));
    this.bits(0, len);
    this.bits(v + 1, len + 1);
  }
  /** se(v), H.264 §9.1.1. */
  se(v: number): void {
    this.ue(v > 0 ? 2 * v - 1 : -2 * v);
  }
  aligned(): boolean {
    return this.n === 0;
  }
  byte(v: number): void {
    if (!this.aligned()) throw new Error('a raw byte off a byte boundary');
    this.bytes.push(v);
  }
  /** rbsp_trailing_bits (§7.3.2.11): a 1, then zeros to the byte boundary. */
  trailing(): Uint8Array {
    this.bit(1);
    while (!this.aligned()) this.bit(0);
    return Uint8Array.from(this.bytes);
  }
  private flush(): void {
    this.bytes.push(this.cur);
    this.cur = 0;
    this.n = 0;
  }
}

/** A NAL unit from its header byte and RBSP, with emulation prevention bytes inserted (§7.4.1). */
function nal(header: number, payload: Uint8Array): Uint8Array {
  const out = [header];
  let zeros = 0;
  for (const v of payload) {
    if (zeros >= 2 && v <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(v);
    zeros = v === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

const PROFILE_BASELINE = 66;
/** constraint_set0_flag and constraint_set1_flag: Constrained Baseline (§A.2.1.1). */
const CONSTRAINTS = 0xc0;
const LEVEL = 30;

function sps(mbw: number, mbh: number): Uint8Array {
  const w = new BitWriter();
  w.bits(PROFILE_BASELINE, 8);
  w.bits(CONSTRAINTS, 8);
  w.bits(LEVEL, 8);
  w.ue(0); // seq_parameter_set_id
  w.ue(0); // log2_max_frame_num_minus4
  w.ue(2); // pic_order_cnt_type: output order is decoding order
  w.ue(0); // max_num_ref_frames
  w.bit(0); // gaps_in_frame_num_value_allowed_flag
  w.ue(mbw - 1);
  w.ue(mbh - 1);
  w.bit(1); // frame_mbs_only_flag
  w.bit(1); // direct_8x8_inference_flag
  w.bit(0); // frame_cropping_flag
  w.bit(0); // vui_parameters_present_flag: limited range, unspecified matrix, square pixels
  return nal(0x67, w.trailing());
}

function pps(): Uint8Array {
  const w = new BitWriter();
  w.ue(0); // pic_parameter_set_id
  w.ue(0); // seq_parameter_set_id
  w.bit(0); // entropy_coding_mode_flag: CAVLC
  w.bit(0); // bottom_field_pic_order_in_frame_present_flag
  w.ue(0); // num_slice_groups_minus1
  w.ue(0); // num_ref_idx_l0_default_active_minus1
  w.ue(0); // num_ref_idx_l1_default_active_minus1
  w.bit(0); // weighted_pred_flag
  w.bits(0, 2); // weighted_bipred_idc
  w.se(0); // pic_init_qp_minus26
  w.se(0); // pic_init_qs_minus26
  w.se(0); // chroma_qp_index_offset
  w.bit(1); // deblocking_filter_control_present_flag
  w.bit(0); // constrained_intra_pred_flag
  w.bit(0); // redundant_pic_cnt_present_flag
  return nal(0x68, w.trailing());
}

/** mb_type I_PCM in an I slice (§7.4.5 Table 7-11). */
const MB_I_PCM = 25;

function idr(mbw: number, mbh: number, luma: (x: number, y: number) => number): Uint8Array {
  const w = new BitWriter();
  w.ue(0); // first_mb_in_slice
  w.ue(7); // slice_type: I, as every slice of the picture
  w.ue(0); // pic_parameter_set_id
  w.bits(0, 4); // frame_num
  w.ue(0); // idr_pic_id
  w.bit(0); // no_output_of_prior_pics_flag
  w.bit(0); // long_term_reference_flag
  w.se(0); // slice_qp_delta
  w.ue(1); // disable_deblocking_filter_idc: off
  for (let my = 0; my < mbh; my++) {
    for (let mx = 0; mx < mbw; mx++) {
      w.ue(MB_I_PCM);
      while (!w.aligned()) w.bit(0); // pcm_alignment_zero_bit
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) w.byte(luma(mx * 16 + x, my * 16 + y));
      for (let i = 0; i < 2 * 64; i++) w.byte(NEUTRAL_CHROMA);
    }
  }
  return nal(0x65, w.trailing());
}

const be32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const be16 = (v: number): number[] => [(v >>> 8) & 255, v & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...parts: (readonly number[] | Uint8Array)[]): number[] => {
  const body = parts.flatMap((p) => [...p]);
  return [...be32(8 + body.length), ...ascii(type), ...body];
};
const full = (type: string, version: number, flags: number, ...parts: (readonly number[] | Uint8Array)[]): number[] => box(type, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...parts);
const zeros = (n: number): number[] => new Array<number>(n).fill(0);
/** The identity matrix of a movie or track header (ISO/IEC 14496-12 §8.2.2: 16.16 a, d and 2.30 w). */
const IDENTITY = [...be32(0x00010000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x00010000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x40000000)];
const TIMESCALE = 1000;
const DURATION = 1000;

/**
 * A one-frame MP4 (ISO/IEC 14496-12 and -15) of a two-tone frame: width and height whole macroblocks, white(x, y) the samples
 * that are white.
 */
export function twoToneMp4(width: number, height: number, white: (x: number, y: number) => boolean): Uint8Array {
  if (width % 16 !== 0 || height % 16 !== 0 || width <= 0 || height <= 0) throw new Error(`a two-tone frame is whole macroblocks, not ${width}x${height}`);
  const mbw = width / 16;
  const mbh = height / 16;
  const s = sps(mbw, mbh);
  const p = pps();
  const slice = idr(mbw, mbh, (x, y) => (white(x, y) ? TWO_TONE_LUMA.white : TWO_TONE_LUMA.black));
  const sample = [...be32(slice.length), ...slice];
  const ftyp = box('ftyp', ascii('isom'), be32(0x200), ascii('isomiso2avc1mp41'));
  const avcC = box('avcC', [1, s[1] as number, s[2] as number, s[3] as number, 0xff, 0xe1], be16(s.length), s, [1], be16(p.length), p);
  const avc1 = box('avc1', zeros(6), be16(1), zeros(16), be16(width), be16(height), be32(0x00480000), be32(0x00480000), be32(0), be16(1), zeros(32), be16(0x18), be16(0xffff), avcC);
  const stbl = (offset: number): number[] => box('stbl',
    full('stsd', 0, 0, be32(1), avc1),
    full('stts', 0, 0, be32(1), be32(1), be32(DURATION)),
    full('stsc', 0, 0, be32(1), be32(1), be32(1), be32(1)),
    full('stsz', 0, 0, be32(0), be32(1), be32(sample.length)),
    full('stco', 0, 0, be32(1), be32(offset)));
  const moov = (offset: number): number[] => box('moov',
    full('mvhd', 0, 0, be32(0), be32(0), be32(TIMESCALE), be32(DURATION), be32(0x00010000), be16(0x0100), zeros(10), IDENTITY, zeros(24), be32(2)),
    box('trak',
      full('tkhd', 0, 3, be32(0), be32(0), be32(1), be32(0), be32(DURATION), zeros(8), be16(0), be16(0), be16(0), be16(0), IDENTITY, be32(width * 65536), be32(height * 65536)),
      box('mdia',
        full('mdhd', 0, 0, be32(0), be32(0), be32(TIMESCALE), be32(DURATION), be16(0x55c4), be16(0)),
        full('hdlr', 0, 0, be32(0), ascii('vide'), zeros(12), ascii('VideoHandler'), [0]),
        box('minf',
          full('vmhd', 0, 1, zeros(8)),
          box('dinf', full('dref', 0, 0, be32(1), full('url ', 0, 1))),
          stbl(offset)))));
  // The sample sits in the mdat after ftyp and moov; moov's size does not depend on the offset's value.
  const offset = ftyp.length + moov(0).length + 8;
  return Uint8Array.from([...ftyp, ...moov(offset), ...box('mdat', sample)]);
}

/** A data:video/mp4 URL of an MP4. */
export function mp4DataUrl(bytes: Uint8Array): string {
  return `data:video/mp4;base64,${Buffer.from(bytes).toString('base64')}`;
}

// ---------------------------------------------------------------- reading

const u32 = (b: Uint8Array, at: number): number => (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0;
const fourcc = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] as number, b[at + 1] as number, b[at + 2] as number, b[at + 3] as number);

/** The body [start, end) of the first box of a type on a path from the top level, the container boxes' children walked. */
function find(b: Uint8Array, path: readonly string[], from = 0, to = b.length): readonly [number, number] | null {
  let at = from;
  while (at + 8 <= to) {
    const size = u32(b, at);
    if (size < 8 || at + size > to) return null;
    if (fourcc(b, at + 4) === path[0]) {
      if (path.length === 1) return [at + 8, at + size];
      // stsd is a full box with an entry count; avc1 is a sample entry of 78 bytes before its child boxes.
      const skip = path[0] === 'stsd' ? 8 : path[0] === 'avc1' ? 78 : 0;
      return find(b, path.slice(1), at + 8 + skip, at + size);
    }
    at += size;
  }
  return null;
}

class BitReader {
  private at = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  bit(): number {
    const byte = this.b[this.at >> 3];
    if (byte === undefined) throw new Error('the slice ends early');
    const v = (byte >> (7 - (this.at & 7))) & 1;
    this.at++;
    return v;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 2 + this.bit();
    return v;
  }
  ue(): number {
    let z = 0;
    while (this.bit() === 0) z++;
    return 2 ** z - 1 + this.bits(z);
  }
  se(): number {
    const k = this.ue();
    return k % 2 === 1 ? (k + 1) / 2 : -k / 2;
  }
  align(): void {
    while ((this.at & 7) !== 0) if (this.bit() !== 0) throw new Error('a pcm_alignment_zero_bit is 1');
  }
  byte(): number {
    return this.bits(8);
  }
}

function unescape(n: Uint8Array): Uint8Array {
  const out: number[] = [];
  let z = 0;
  for (const v of n) {
    if (z >= 2 && v === 3) {
      z = 0;
      continue;
    }
    out.push(v);
    z = v === 0 ? z + 1 : 0;
  }
  return Uint8Array.from(out);
}

/**
 * The first frame of a two-tone stream as an RGBA image (black or white, opaque), read from the MP4's bytes: the one sample of the
 * one track, one IDR slice of I_PCM macroblocks with the SPS and PPS twoToneMp4 writes. Throws for any other stream.
 */
export function decodeTwoTone(b: Uint8Array): RgbaImage {
  const fail = (why: string): never => {
    throw new Error(`not a two-tone stream: ${why}`);
  };
  const avcC = find(b, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC']) ?? fail('no avcC');
  const spsLen = ((b[avcC[0] + 6] as number) << 8) | (b[avcC[0] + 7] as number);
  const s = new BitReader(unescape(b.subarray(avcC[0] + 9, avcC[0] + 8 + spsLen)));
  if (s.bits(8) !== PROFILE_BASELINE) fail('its profile is not Baseline');
  s.bits(16);
  if (s.ue() !== 0 || s.ue() !== 0 || s.ue() !== 2 || s.ue() !== 0 || s.bit() !== 0) fail('its SPS is not the one twoToneMp4 writes');
  const mbw = s.ue() + 1;
  const mbh = s.ue() + 1;
  if (s.bit() !== 1 || s.bit() !== 1 || s.bit() !== 0 || s.bit() !== 0) fail('its SPS has fields, cropping or VUI');
  const stco = find(b, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco']) ?? fail('no stco');
  const stsz = find(b, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz']) ?? fail('no stsz');
  if (u32(b, stco[0] + 4) !== 1 || u32(b, stsz[0] + 8) !== 1) fail('it has more than one sample');
  const at = u32(b, stco[0] + 8);
  const size = u32(b, stsz[0] + 12);
  const len = u32(b, at);
  if (len + 4 !== size) fail('its sample holds more than one NAL unit');
  if (b[at + 4] !== 0x65) fail('its sample is not an IDR slice');
  const r = new BitReader(unescape(b.subarray(at + 5, at + 4 + len)));
  if (r.ue() !== 0 || r.ue() !== 7 || r.ue() !== 0 || r.bits(4) !== 0 || r.ue() !== 0 || r.bit() !== 0 || r.bit() !== 0 || r.se() !== 0 || r.ue() !== 1) fail('its slice header is not the one twoToneMp4 writes');
  const width = mbw * 16;
  const height = mbh * 16;
  const data = new Uint8Array(width * height * 4);
  for (let my = 0; my < mbh; my++) {
    for (let mx = 0; mx < mbw; mx++) {
      if (r.ue() !== MB_I_PCM) fail(`macroblock ${mx},${my} is not I_PCM`);
      r.align();
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const v = r.byte();
          const tone = v <= 16 ? 0 : v >= 235 ? 255 : fail(`luma ${v} at ${mx * 16 + x},${my * 16 + y} is neither below black nor above white`);
          data.set([tone, tone, tone, 255], ((my * 16 + y) * width + mx * 16 + x) * 4);
        }
      }
      for (let i = 0; i < 128; i++) if (r.byte() !== NEUTRAL_CHROMA) fail(`macroblock ${mx},${my} has chroma`);
    }
  }
  return { width, height, data };
}

// ---------------------------------------------------------------- the fixture streams

/**
 * The streams of replaced-video-frame, by name: quadrant is 64x48 with its top-left quadrant white, third 48x32 with its left
 * third white. Neither is symmetric under a flip or a turn, so a frame drawn mirrored or rotated shows the wrong tone.
 */
export const FIXTURE_STREAMS: { readonly [name: string]: Uint8Array } = {
  quadrant: twoToneMp4(64, 48, (x, y) => x < 32 && y < 24),
  third: twoToneMp4(48, 32, (x) => x < 16),
};
