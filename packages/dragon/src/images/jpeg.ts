// JPEG metadata only (REPL-j decodes): the SOFn frame header, the APP1 EXIF orientation, resolution and pixel dimensions the
// way Blink's JPEGImageDecoder reads them, and whether an ICC profile is embedded.

export type ExifFacts = {
  /** Orientation tag 1-8, or null when absent or invalid. */
  readonly orientation: number | null;
  /** ResolutionUnit (2 = inch, 3 = centimetre), or null. */
  readonly resolutionUnit: number | null;
  /** XResolution and YResolution as stored rationals, or null. */
  readonly resolution: { readonly x: readonly [number, number]; readonly y: readonly [number, number] } | null;
  /** PixelXDimension and PixelYDimension of the Exif IFD, or null. */
  readonly pixelSize: { readonly width: number; readonly height: number } | null;
};

export type JpegFacts = {
  readonly width: number;
  readonly height: number;
  /** The SOF marker, 0xc0-0xcf. */
  readonly sof: number;
  readonly progressive: boolean;
  readonly arithmetic: boolean;
  readonly precision: number;
  readonly components: number;
  readonly exif: ExifFacts | null;
  readonly hasIcc: boolean;
  /** Marker segments before SOS, as two-digit hex. */
  readonly markers: readonly string[];
};

export type JpegParse = { readonly ok: true; readonly facts: JpegFacts } | { readonly ok: false; readonly reason: string };

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const hex = (m: number): string => m.toString(16).padStart(2, '0');

function readExif(b: Uint8Array): ExifFacts | null {
  if (b.length < 8) return null;
  const little = b[0] === 0x49 && b[1] === 0x49;
  if (!little && !(b[0] === 0x4d && b[1] === 0x4d)) return null;
  const u16 = (at: number): number => (little ? (b[at] as number) | ((b[at + 1] as number) << 8) : ((b[at] as number) << 8) | (b[at + 1] as number));
  const u32 = (at: number): number => (little ? ((b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16) | ((b[at + 3] as number) << 24)) >>> 0 : (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0);
  if (u16(2) !== 42) return null;
  let orientation: number | null = null;
  let resolutionUnit: number | null = null;
  let xr: [number, number] | null = null;
  let yr: [number, number] | null = null;
  let pw: number | null = null;
  let ph: number | null = null;
  const seen = new Set<number>();
  const directory = (offset: number): void => {
    if (seen.has(offset) || offset + 2 > b.length) return;
    seen.add(offset);
    const count = u16(offset);
    for (let k = 0; k < count; k++) {
      const e = offset + 2 + k * 12;
      if (e + 12 > b.length) return;
      const tagId = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      const value = e + 8;
      const short = type === 3 && n === 1 ? u16(value) : null;
      const long = type === 4 && n === 1 ? u32(value) : null;
      const rational = (): [number, number] | null => {
        if (type !== 5 || n !== 1) return null;
        const at = u32(value);
        return at + 8 <= b.length ? [u32(at), u32(at + 4)] : null;
      };
      if (tagId === 0x0112 && short !== null) orientation = short >= 1 && short <= 8 ? short : null;
      else if (tagId === 0x0128 && short !== null) resolutionUnit = short;
      else if (tagId === 0x011a) xr = rational();
      else if (tagId === 0x011b) yr = rational();
      else if (tagId === 0xa002) pw = short ?? long;
      else if (tagId === 0xa003) ph = short ?? long;
      else if (tagId === 0x8769 && long !== null) directory(long);
    }
  };
  directory(u32(4));
  return {
    orientation,
    resolutionUnit,
    resolution: xr !== null && yr !== null ? { x: xr, y: yr } : null,
    pixelSize: pw !== null && ph !== null ? { width: pw, height: ph } : null,
  };
}

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0, 0];
const ICC_ID = [...'ICC_PROFILE'].map((c) => c.charCodeAt(0)).concat(0);

/** Parses the marker segments up to the first SOS. */
export function parseJpeg(bytes: Uint8Array): JpegParse {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { ok: false, reason: 'no SOI' };
  let at = 2;
  let frame: Omit<JpegFacts, 'exif' | 'hasIcc' | 'markers'> | null = null;
  let exif: ExifFacts | null = null;
  let hasIcc = false;
  const markers: string[] = [];
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return { ok: false, reason: `expected a marker at ${at}` };
    while (bytes[at] === 0xff) at++;
    const m = bytes[at++];
    if (m === undefined) break;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0xd9) break;
    if (at + 2 > bytes.length) return { ok: false, reason: 'truncated segment' };
    const length = ((bytes[at] as number) << 8) | (bytes[at + 1] as number);
    const data = bytes.subarray(at + 2, at + length);
    if (length < 2 || data.length !== length - 2) return { ok: false, reason: `truncated ${hex(m)} segment` };
    markers.push(hex(m));
    if (SOF.has(m)) {
      if (data.length < 6) return { ok: false, reason: 'short SOF' };
      frame = {
        width: ((data[3] as number) << 8) | (data[4] as number),
        height: ((data[1] as number) << 8) | (data[2] as number),
        sof: m,
        progressive: m === 0xc2 || m === 0xc6 || m === 0xca || m === 0xce,
        arithmetic: m >= 0xc9,
        precision: data[0] as number,
        components: data[5] as number,
      };
    } else if (m === 0xe1 && exif === null && EXIF_ID.every((v, i) => data[i] === v)) {
      exif = readExif(data.subarray(6));
    } else if (m === 0xe2 && ICC_ID.every((v, i) => data[i] === v)) {
      hasIcc = true;
    }
    if (m === 0xda) break;
    at += length;
  }
  if (frame === null) return { ok: false, reason: 'no SOF before SOS' };
  if (frame.width === 0 || frame.height === 0) return { ok: false, reason: 'zero frame size' };
  return { ok: true, facts: { ...frame, exif, hasIcc, markers } };
}
