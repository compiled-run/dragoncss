// Synchronous SHA-256 (FIPS 180-4) over UTF-8, so the core needs no Node crypto.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text: string): string {
  return sha256HexBytes(utf8(text));
}

/** SHA-256 of raw bytes (assets). */
export function sha256HexBytes(data: Uint8Array): string {
  const bitLength = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (bitLength - (bitLength >>> 0)) / 0x100000000);
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const w = new Int32Array(64);
  let h0 = 0x6a09e667 | 0, h1 = 0xbb67ae85 | 0, h2 = 0x3c6ef372 | 0, h3 = 0xa54ff53a | 0, h4 = 0x510e527f | 0, h5 = 0x9b05688c | 0, h6 = 0x1f83d9ab | 0, h7 = 0x5be0cd19 | 0;
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0, j = off; i < 16; i++, j += 4) w[i] = ((padded[j] as number) << 24) | ((padded[j + 1] as number) << 16) | ((padded[j + 2] as number) << 8) | (padded[j + 3] as number);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + hh) | 0;
  }
  // Int32 arithmetic keeps every value a small integer (no heap numbers); >>> 0 reads each word unsigned for hex.
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** A value already written by canonicalJson, which canonicalJson copies as it is (a large input serialized once). */
export class CanonicalText {
  readonly json: string;
  constructor(json: string) {
    this.json = json;
  }
}

/** Deterministic JSON with sorted object keys, for digests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof CanonicalText) return value.json;
  if (value instanceof Uint8Array) return JSON.stringify(Array.from(value));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** UTF-8 of each code point, a lone surrogate as its own three bytes (as iterating the string by code point gives it). */
export function utf8(text: string): Uint8Array {
  // Every UTF-16 unit gives at most three bytes; a surrogate pair gives four for two units.
  const out = new Uint8Array(text.length * 3);
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      cp = 0x10000 + ((cp - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      i++;
    }
    if (cp < 0x80) out[j++] = cp;
    else if (cp < 0x800) {
      out[j++] = 0xc0 | (cp >> 6);
      out[j++] = 0x80 | (cp & 63);
    } else if (cp < 0x10000) {
      out[j++] = 0xe0 | (cp >> 12);
      out[j++] = 0x80 | ((cp >> 6) & 63);
      out[j++] = 0x80 | (cp & 63);
    } else {
      out[j++] = 0xf0 | (cp >> 18);
      out[j++] = 0x80 | ((cp >> 12) & 63);
      out[j++] = 0x80 | ((cp >> 6) & 63);
      out[j++] = 0x80 | (cp & 63);
    }
  }
  return out.subarray(0, j);
}
