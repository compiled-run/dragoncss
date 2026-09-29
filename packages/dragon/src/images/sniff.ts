// Image format by magic bytes, as Blink's ImageDecoder::SniffMimeType decides it (R2): the URL and the declared type do not
// matter for raster formats. SVG has no signature; Blink takes the SVG path only for the image/svg+xml type, so that one
// format is decided by the declared type.

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'bmp' | 'ico' | 'svg';

/** Blink needs this many bytes before it sniffs (the length of "RIFF????WEBPVP"). */
export const SNIFF_LENGTH = 14;

const startsWith = (b: Uint8Array, at: number, sig: readonly number[]): boolean => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const be32 = (b: Uint8Array, at: number): number => (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
const tag = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);

/** An ISO-BMFF ftyp box whose major or a compatible brand is avif or avis (AVIFImageDecoder::MatchesAVIFSignature). */
function isAvif(b: Uint8Array): boolean {
  if (tag(b, 4) !== 'ftyp') return false;
  const size = be32(b, 0);
  if (size < 16 || size > b.length) return false;
  const brands = [tag(b, 8)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(tag(b, at));
  return brands.some((x) => x === 'avif' || x === 'avis');
}

/** The MIME type essence of a declared type: lower case, parameters dropped. */
export const typeEssence = (type: string | null): string | null => (type === null ? null : (type.split(';')[0] ?? '').trim().toLowerCase());

/** The format Chrome decodes the bytes as, or null when none applies (Chrome shows a broken image). */
export function sniffImage(bytes: Uint8Array, declaredType: string | null): ImageFormat | null {
  if (typeEssence(declaredType) === 'image/svg+xml') return 'svg';
  if (bytes.length < SNIFF_LENGTH) return null;
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBPVP'))) return 'webp';
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, 0, [0, 0, 1, 0]) || startsWith(bytes, 0, [0, 0, 2, 0])) return 'ico';
  if (startsWith(bytes, 0, ascii('BM'))) return 'bmp';
  if (isAvif(bytes)) return 'avif';
  return null;
}
