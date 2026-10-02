// zlib inflate (RFC 1950 wrapper, RFC 1951 DEFLATE), so the compiler can check that an accepted PNG's image data decodes
// without Node built-ins. Every malformed stream throws: a bad header, a preset dictionary, an invalid code or block, a
// distance before the start of the output, a truncated stream, or an Adler-32 mismatch.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const bad = (why: string): never => {
  throw new Error(`the zlib stream is invalid: ${why}`);
};

/** A canonical Huffman code (RFC 1951 §3.2.2): symbol counts per length and the symbols in code order. */
type Huffman = { readonly counts: Uint16Array; readonly symbols: Uint16Array };

function huffman(lengths: ArrayLike<number>, what: string): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < lengths.length; i++) counts[lengths[i] as number]!++;
  counts[0] = 0;
  // Over-subscribed codes are invalid; incomplete ones are allowed (zlib allows a single distance code).
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left = (left << 1) - (counts[len] as number);
    if (left < 0) bad(`over-subscribed ${what} code`);
  }
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = (offs[len] as number) + (counts[len] as number);
  const symbols = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s] !== 0) symbols[offs[lengths[s] as number]!++] = s;
  return { counts, symbols };
}

const FIXED_LIT = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)), 'fixed literal');
const FIXED_DIST = huffman(Array.from({ length: 30 }, () => 5), 'fixed distance');

/**
 * Inflates a zlib stream; throws on any malformed or truncated input, a checksum mismatch, or output past `limit` bytes (so a
 * small expansion bomb stops at the size the caller expects instead of exhausting memory).
 */
export function zlibInflate(data: Uint8Array, limit = Number.POSITIVE_INFINITY): Uint8Array {
  if (data.length < 6) bad('shorter than a header and a checksum');
  const cmf = data[0] as number;
  const flg = data[1] as number;
  if ((cmf & 0x0f) !== 8 || cmf >>> 4 > 7) bad('the compression method is not deflate with a window of at most 32 KB');
  if (((cmf << 8) | flg) % 31 !== 0) bad('the header check bits are wrong');
  if (flg & 0x20) bad('a preset dictionary is not allowed in PNG');
  let pos = 2;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.min(Math.max(1024, data.length * 4), Math.max(0, limit)));
  let n = 0;
  const ensure = (more: number): void => {
    if (n + more > limit) bad(`it inflates past ${limit} bytes`);
    if (n + more <= out.length) return;
    let size = Math.max(1, out.length * 2);
    while (size < n + more) size *= 2;
    size = Math.min(size, limit);
    const grown = new Uint8Array(size);
    grown.set(out.subarray(0, n));
    out = grown;
  };
  const bits = (need: number): number => {
    while (bitCnt < need) {
      if (pos >= data.length) bad('it is truncated');
      bitBuf |= (data[pos++] as number) << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << need) - 1);
    bitBuf >>>= need;
    bitCnt -= need;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len] as number;
      if (code - first < count) return h.symbols[index + code - first] as number;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return bad('an invalid Huffman code');
  };
  const codes = (lit: Huffman, dist: Huffman): void => {
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[n++] = sym;
      } else if (sym === 256) return;
      else {
        const li = sym - 257;
        if (li >= 29) bad(`literal/length symbol ${sym}`);
        const len = (LENGTH_BASE[li] as number) + bits(LENGTH_EXTRA[li] as number);
        const ds = decode(dist);
        if (ds >= 30) bad(`distance symbol ${ds}`);
        const d = (DIST_BASE[ds] as number) + bits(DIST_EXTRA[ds] as number);
        if (d > n) bad('a distance before the start of the output');
        ensure(len);
        for (let i = 0; i < len; i++, n++) out[n] = out[n - d] as number;
      }
    }
  };
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      if (pos + 4 > data.length) bad('it is truncated');
      const len = (data[pos] as number) | ((data[pos + 1] as number) << 8);
      const nlen = (data[pos + 2] as number) | ((data[pos + 3] as number) << 8);
      pos += 4;
      if (len !== (~nlen & 0xffff)) bad('a stored block length does not match its complement');
      if (pos + len > data.length) bad('it is truncated');
      ensure(len);
      out.set(data.subarray(pos, pos + len), n);
      n += len;
      pos += len;
    } else if (type === 1) codes(FIXED_LIT, FIXED_DIST);
    else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) bad('too many length or distance codes');
      const clen = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) clen[CLEN_ORDER[i] as number] = bits(3);
      const lencode = huffman(clen, 'code length');
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(lencode);
        if (sym < 16) lengths[i++] = sym;
        else {
          let value = 0;
          let repeat: number;
          if (sym === 16) {
            if (i === 0) bad('a repeat with no previous length');
            value = lengths[i - 1] as number;
            repeat = 3 + bits(2);
          } else repeat = sym === 17 ? 3 + bits(3) : 11 + bits(7);
          if (i + repeat > nlen + ndist) bad('code lengths overrun');
          for (; repeat > 0; repeat--) lengths[i++] = value;
        }
      }
      if (lengths[256] === 0) bad('no end-of-block code');
      codes(huffman(lengths.subarray(0, nlen), 'literal/length'), huffman(lengths.subarray(nlen), 'distance'));
    } else bad('block type 3');
  }
  // The Adler-32 of the output follows on the next byte boundary, big-endian.
  if (pos + 4 > data.length) bad('the Adler-32 checksum is missing');
  const want = (((data[pos] as number) << 24) | ((data[pos + 1] as number) << 16) | ((data[pos + 2] as number) << 8) | (data[pos + 3] as number)) >>> 0;
  let a = 1;
  let b = 0;
  for (let i = 0; i < n; i++) {
    a = (a + (out[i] as number)) % 65521;
    b = (b + a) % 65521;
  }
  if ((((b << 16) | a) >>> 0) !== want) bad('the Adler-32 checksum does not match');
  return out.slice(0, n);
}
