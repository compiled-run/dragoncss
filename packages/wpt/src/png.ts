// A small PNG decoder for Chrome's screenshots: 8-bit greyscale, RGB, RGBA (and their alpha variants), non-interlaced, with the
// five scanline filters. Returns 0xRRGGBB per pixel (alpha dropped; screenshots are opaque).
import { inflateSync } from 'node:zlib';

export type Pixels = { readonly width: number; readonly height: number; readonly rgb: Uint32Array };

export function decodePng(png: Uint8Array): Pixels {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8] as number;
      colorType = data[9] as number;
      if (depth !== 8 || data[12] !== 0) throw new Error(`unsupported PNG: bit depth ${depth}, interlace ${data[12]}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (out[y * stride + x - channels] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] as number) : 0;
      let v = line[x] as number;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  const rgb = new Uint32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = out[o] as number;
    const g = channels >= 3 ? (out[o + 1] as number) : r;
    const b = channels >= 3 ? (out[o + 2] as number) : r;
    rgb[i] = (r << 16) | (g << 8) | b;
  }
  return { width, height, rgb };
}
