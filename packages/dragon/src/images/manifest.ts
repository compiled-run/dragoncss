// The image manifest (R1): an image source is bytes known at build time, a data: URL or a src the project asset map names a
// local file for. A remote or unmapped src never yields an entry; it is a build error. Each entry carries the sha256, the
// sniffed format (R2), the header natural size (R4) and the refusal with the package that owns it (R3), and the manifest
// enters the compilation digest like the font manifest.
import { canonicalJson, sha256HexBytes } from '../digest.ts';
import { NO_IMAGE_FAULTS } from './faults.ts';
import type { ImageFaults } from './faults.ts';
import { parseJpeg } from './jpeg.ts';
import { naturalSize } from './natural-size.ts';
import type { ImageHeader, NaturalSize } from './natural-size.ts';
import { parsePng, pngColourRefusal } from './png.ts';
import { sniffImage } from './sniff.ts';
import type { ImageFormat } from './sniff.ts';

/** The follow-up packages a refused image names (T045 R3, and the REPL-0 ruling for BMP, ICO and SVG). */
export type ImagePackage = 'REPL-c' | 'REPL-j' | 'REPL-g' | 'REPL-an' | 'REPL-svg';

export type ImageRefusal = { readonly package: ImagePackage | null; readonly reason: string };

/** src (as written, or a path) to a project-relative local file. */
export type ImageAssetMap = { readonly [src: string]: string };

export type ImageSource =
  | { readonly kind: 'data'; readonly type: string | null; readonly bytes: Uint8Array }
  | { readonly kind: 'mapped'; readonly path: string; readonly type: string | null; readonly bytes: Uint8Array };

export type ImageSourceProblem = { readonly kind: 'remote-image' | 'unmapped-image' | 'bad-data-url'; readonly src: string };

export type ImageEntry = {
  readonly src: string;
  readonly source: 'data' | 'mapped';
  /** The mapped file, or null for a data: URL. */
  readonly path: string | null;
  /** sha256:<hex> of the bytes. */
  readonly hash: string;
  readonly byteLength: number;
  readonly format: ImageFormat | null;
  readonly naturalSize: NaturalSize | null;
  readonly refusal: ImageRefusal | null;
};

export type ImageManifest = { readonly version: 1; readonly images: readonly ImageEntry[] };

const TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
};

/** The type a local file is served with, by extension; only SVG depends on it (sniff.ts). */
export function typeOfPath(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(text: string): Uint8Array | null {
  const clean = text.replace(/[\t\n\f\r ]/g, '').replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) return null;
  const out = new Uint8Array((clean.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const c of clean) {
    acc = (acc << 6) | B64.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

function percentDecode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x25 && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c < 0x80) out.push(c);
    else {
      // A non-ASCII code unit is UTF-8 encoded, as a URL parser percent-encodes it.
      const cp = text.codePointAt(i) as number;
      if (cp > 0xffff) i++;
      if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return Uint8Array.from(out);
}

/** Bytes to a Latin-1 string in bounded chunks: spreading a whole payload into one call overflows the engine's argument limit. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

/**
 * The URL Chrome's parser fetches for a data: src: leading and trailing C0 controls and spaces stripped (not other Unicode
 * whitespace, which String.prototype.trim would also strip) and the fragment dropped. The query stays in the body, and tabs and
 * newlines inside it stay too: Chrome 145 fetches data:,a?b#c as "a?b" and data:,a<TAB>b as "a<TAB>b".
 */
function dataUrlOf(src: string): string {
  const stripped = src.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  const hash = stripped.indexOf('#');
  return hash < 0 ? stripped : stripped.slice(0, hash);
}

/** A data: URL (RFC 2397, as the fetch standard reads it): its type (null when absent) and its bytes; null when malformed. */
export function parseDataUrl(src: string): { readonly type: string | null; readonly bytes: Uint8Array } | null {
  const m = /^data:([^,]*),(.*)$/is.exec(dataUrlOf(src));
  if (m === null) return null;
  const meta = (m[1] as string).trim();
  const isBase64 = /;\s*base64\s*$/i.test(meta);
  const type = (isBase64 ? meta.replace(/;\s*base64\s*$/i, '') : meta).trim();
  const payload = percentDecode(m[2] as string);
  const bytes = isBase64 ? base64(latin1(payload)) : payload;
  if (bytes === null) return null;
  return { type: type === '' ? null : type, bytes };
}

const REMOTE = /^(https?:)?\/\//i;

/** Resolves a src to build-time bytes: a data: URL, or a src the asset map names; anything else is a problem, never an entry. */
export function resolveImageSource(src: string, assets: ImageAssetMap, read: (path: string) => Uint8Array): ImageSource | ImageSourceProblem {
  if (/^data:/i.test(dataUrlOf(src))) {
    const d = parseDataUrl(src);
    return d === null ? { kind: 'bad-data-url', src } : { kind: 'data', type: d.type, bytes: d.bytes };
  }
  // Own keys only: an inherited name such as toString is not a mapped asset.
  const path = Object.hasOwn(assets, src) ? assets[src] : undefined;
  if (path === undefined) return { kind: REMOTE.test(src.trim()) ? 'remote-image' : 'unmapped-image', src };
  return { kind: 'mapped', path, type: typeOfPath(path), bytes: read(path) };
}

/** The PNG or JPEG header of the bytes, by magic bytes; null for any other format or a header that does not parse. */
export function readImageHeader(bytes: Uint8Array, declaredType: string | null): ImageHeader | null {
  const format = sniffImage(bytes, declaredType);
  if (format === 'png') {
    const p = parsePng(bytes);
    return p.ok ? { format: 'png', facts: p.facts } : null;
  }
  if (format === 'jpeg') {
    const j = parseJpeg(bytes);
    return j.ok ? { format: 'jpeg', facts: j.facts } : null;
  }
  return null;
}

const OTHER_FORMATS: Readonly<Record<Exclude<ImageFormat, 'png' | 'jpeg'>, ImagePackage>> = {
  gif: 'REPL-g', webp: 'REPL-g', avif: 'REPL-g', bmp: 'REPL-g', ico: 'REPL-g', svg: 'REPL-svg',
};

/** Why REPL-a cannot draw these bytes, with the owning package; null for an 8-bit sRGB or untagged PNG. */
export function imageRefusal(bytes: Uint8Array, declaredType: string | null): ImageRefusal | null {
  const format = sniffImage(bytes, declaredType);
  if (format === null) return { package: null, reason: 'the bytes match no image format Chrome decodes' };
  if (format === 'png') {
    const p = parsePng(bytes);
    return p.ok ? pngColourRefusal(p.facts) : { package: null, reason: `the PNG does not parse: ${p.reason}` };
  }
  if (format === 'jpeg') {
    const j = parseJpeg(bytes);
    return j.ok ? { package: 'REPL-j', reason: 'JPEG decodes differ per platform; REPL-j transcodes at build time' } : { package: null, reason: `the JPEG does not parse: ${j.reason}` };
  }
  return { package: OTHER_FORMATS[format], reason: `${format} is not decoded in REPL-a` };
}

export function imageEntry(src: string, source: ImageSource, faults: ImageFaults = NO_IMAGE_FAULTS): ImageEntry {
  const header = readImageHeader(source.bytes, source.type);
  return {
    src,
    source: source.kind,
    path: source.kind === 'mapped' ? source.path : null,
    hash: `sha256:${sha256HexBytes(source.bytes)}`,
    byteLength: source.bytes.length,
    format: sniffImage(source.bytes, source.type),
    naturalSize: header === null ? null : naturalSize(header, faults),
    refusal: imageRefusal(source.bytes, source.type),
  };
}

export type ImageManifestResult =
  | { readonly ok: true; readonly manifest: ImageManifest }
  | { readonly ok: false; readonly problems: readonly ImageSourceProblem[] };

/** The manifest of every src, one entry per distinct src, sorted by src; any remote, unmapped or malformed src means no manifest. */
export function buildImageManifest(
  srcs: readonly string[],
  assets: ImageAssetMap,
  read: (path: string) => Uint8Array,
  faults: ImageFaults = NO_IMAGE_FAULTS,
): ImageManifestResult {
  const problems: ImageSourceProblem[] = [];
  const images: ImageEntry[] = [];
  for (const src of [...new Set(srcs)].sort()) {
    const s = resolveImageSource(src, assets, read);
    if (s.kind === 'data' || s.kind === 'mapped') images.push(imageEntry(src, s, faults));
    else problems.push(s);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, manifest: { version: 1, images } };
}

/** The exact value REPL-a adds to the compilation digest, under the key images. */
export function manifestDigestInput(manifest: ImageManifest): unknown {
  return JSON.parse(canonicalJson(manifest)) as unknown;
}
