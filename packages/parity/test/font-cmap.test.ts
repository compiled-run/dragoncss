// Which glyph a font's cmap gives each code point, judged against Chrome: for Lato Regular with each cmap below, Dragon's
// glyphForCodePoint has the advance canvas measureText gives that character in Chrome, or, where Dragon finds no glyph, Chrome
// falls back exactly as it does for a font that maps nothing.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSfnt } from '../../dragon/src/fonts/sfnt.ts';
import { launchChrome } from '../src/chrome.ts';
import { repoPath } from '../src/paths.ts';
import { cat, type Field, fields, replaced, sfntOf, sfntTables, tableOf, view } from './font-table-cases.ts';

const lato = sfntTables(new Uint8Array(readFileSync(repoPath('vendor/fonts/Lato/Lato-Regular.ttf'))));

type Rec = [platform: number, encoding: number, subtable: Uint8Array];

const cmapOf = (recs: readonly Rec[]): Uint8Array => {
  let at = 4 + 8 * recs.length;
  const offsets = recs.map(([, , s]) => ((at += s.length), at - s.length));
  return cat(fields([[2, 0], [2, recs.length], ...recs.flatMap(([p, e], i): Field[] => [[2, p], [2, e], [4, offsets[i] as number]])]), ...recs.map(([, , s]) => s));
};

/** Format 4 mapping each run of code points from `start` to consecutive glyphs from `glyph`, plus the closing 0xFFFF segment. */
const f4 = (runs: readonly [start: number, count: number, glyph: number][]): Uint8Array => {
  const segs = [...runs.map(([s, n, g]) => ({ start: s, end: s + n - 1, delta: g - s })), { start: 0xffff, end: 0xffff, delta: 1 }];
  let log2 = 0;
  while (1 << (log2 + 1) <= segs.length) log2++;
  const search = 2 << log2;
  const body: Field[] = [
    [2, 2 * segs.length], [2, search], [2, log2], [2, 2 * segs.length - search],
    ...segs.map((s): Field => [2, s.end]), [2, 0], ...segs.map((s): Field => [2, s.start]), ...segs.map((s): Field => [2, s.delta]),
    ...segs.map((): Field => [2, 0]),
  ];
  return fields([[2, 4], [2, 6 + 2 * body.length], [2, 0], ...body]);
};

const groups = (format: 12 | 13, gs: readonly [start: number, count: number, glyph: number][]): Uint8Array =>
  fields([[2, format], [2, 0], [4, 16 + 12 * gs.length], [4, 0], [4, gs.length], ...gs.flatMap(([s, n, g]): Field[] => [[4, s], [4, s + n - 1], [4, g]])]);

/** Lato's OS/2 cut to its 78-byte version 0 form, or kept at its own version, with fsSelection's high byte set to `page`. */
const os2 = (version: 0 | 1, page: number): Uint8Array => {
  const own = tableOf(lato, 'OS/2');
  const b = version === 0 ? own.slice(0, 78) : own.slice(0, 86);
  view(b).setUint16(0, version);
  view(b).setUint16(62, (view(b).getUint16(62) & 0xff) | page);
  return b;
};

const fontOf = (recs: readonly Rec[], os2Table?: Uint8Array): Uint8Array =>
  sfntOf(replaced(lato, { tag: 'cmap', data: cmapOf(recs) }, ...(os2Table ? [{ tag: 'OS/2', data: os2Table }] : [])));

// Lato glyphs with five different advances, so each subtable below maps a character to a width of its own.
const [G1, G2, G3, G4, G5] = [36, 68, 50, 17, 1000];

const symbolAt = (base: number, glyph: number): Uint8Array => f4([[base + 0x41, 4, glyph]]);
const SYM = symbolAt(0xf000, G1);
const BMP = (glyph: number): Uint8Array => f4([[0x41, 4, glyph]]);
const ABOVE = [0x41, 0x42, 0x44, 0xf041, 0xf044, 0x141, 0x1f600];

type Case = { name: string; font: Uint8Array; codePoints: readonly number[] };
const cases: Case[] = [
  { name: 'only a 3-0-4 symbol subtable at U+F041', font: fontOf([[3, 0, SYM]]), codePoints: ABOVE },
  { name: 'a 3-0-4 symbol subtable mapping both U+0041 and U+F041', font: fontOf([[3, 0, f4([[0x41, 2, G2], [0xf041, 4, G1]])]]), codePoints: ABOVE },
  { name: 'a 3-0-4 symbol subtable at U+F141 (outside the U+F000 page Chrome retries)', font: fontOf([[3, 0, symbolAt(0xf100, G1)]]), codePoints: [0x41, 0x141, 0xf141] },
  { name: 'a 3-0-4 symbol subtable beside a 3-10-12', font: fontOf([[3, 0, SYM], [3, 10, groups(12, [[0x41, 4, G3], [0x1f600, 1, G4]])]]), codePoints: ABOVE },
  { name: 'a 3-0-4 symbol subtable beside a 0-3-4 and a 0-3-12', font: fontOf([[0, 3, BMP(G2)], [0, 3, groups(12, [[0x41, 4, G3]])], [3, 0, SYM]]), codePoints: ABOVE },
  { name: 'a 3-0-4 symbol subtable beside a 3-1-4', font: fontOf([[3, 0, SYM], [3, 1, BMP(G2)]]), codePoints: ABOVE },
  { name: 'a symbol subtable, OS/2 version 0, font page 0xB200 (Arabic)', font: fontOf([[3, 0, SYM]], os2(0, 0xb200)), codePoints: ABOVE },
  { name: 'a symbol subtable, OS/2 version 0, font page 0xB100 (Hebrew)', font: fontOf([[3, 0, SYM]], os2(0, 0xb100)), codePoints: ABOVE },
  { name: 'a symbol subtable, OS/2 version 0, fsSelection high byte 0xFC', font: fontOf([[3, 0, SYM]], os2(0, 0xfc00)), codePoints: ABOVE },
  { name: 'a symbol subtable, OS/2 version 0, font page 0', font: fontOf([[3, 0, SYM]], os2(0, 0)), codePoints: ABOVE },
  { name: 'a symbol subtable, OS/2 version 1, fsSelection high byte 0xB2', font: fontOf([[3, 0, SYM]], os2(1, 0xb200)), codePoints: ABOVE },
  { name: '0-0-4, 0-1-4 and 3-1-4', font: fontOf([[0, 0, BMP(G1)], [0, 1, BMP(G2)], [3, 1, BMP(G3)]]), codePoints: [0x41, 0x44] },
  { name: '3-1-4 then 0-0-4, out of order', font: fontOf([[3, 1, BMP(G3)], [0, 0, BMP(G1)]]), codePoints: [0x41, 0x44] },
  { name: '0-0-4 then 0-1-4', font: fontOf([[0, 0, BMP(G1)], [0, 1, BMP(G2)]]), codePoints: [0x41, 0x44] },
  { name: '0-3-4 and 3-1-4', font: fontOf([[0, 3, BMP(G1)], [3, 1, BMP(G3)]]), codePoints: [0x41, 0x44] },
  { name: '0-1-4 and 0-3-4', font: fontOf([[0, 1, BMP(G2)], [0, 3, BMP(G1)]]), codePoints: [0x41, 0x44] },
  { name: 'two 0-3-4', font: fontOf([[0, 3, BMP(G1)], [0, 3, BMP(G2)]]), codePoints: [0x41, 0x44] },
  { name: '3-1-4 and 3-10-12', font: fontOf([[3, 1, BMP(G1)], [3, 10, groups(12, [[0x41, 2, G3]])]]), codePoints: [0x41, 0x42, 0x43] },
  { name: '3-1-4 and 3-10-13', font: fontOf([[3, 1, BMP(G1)], [3, 10, groups(13, [[0x41, 2, G4]])]]), codePoints: [0x41, 0x42, 0x43] },
  { name: '3-1-4, 3-10-12 and 3-10-13', font: fontOf([[3, 1, BMP(G1)], [3, 10, groups(12, [[0x41, 1, G3]])], [3, 10, groups(13, [[0x41, 2, G4]])]]), codePoints: [0x41, 0x42, 0x43] },
  { name: '0-3-12 and 3-10-12', font: fontOf([[0, 3, groups(12, [[0x41, 2, G3]])], [3, 1, BMP(G1)], [3, 10, groups(12, [[0x42, 2, G5]])]]), codePoints: [0x41, 0x42, 0x43, 0x44] },
  { name: '3-10-12 then 0-4-12, out of order', font: fontOf([[3, 1, BMP(G1)], [3, 10, groups(12, [[0x42, 2, G5]])], [0, 4, groups(12, [[0x41, 2, G3]])]]), codePoints: [0x41, 0x42, 0x43, 0x44] },
  { name: 'only 0-3-4', font: fontOf([[0, 3, BMP(G2)]]), codePoints: [0x41, 0xf041] },
];

/** The same Lato with a cmap that maps nothing, so every character falls back. */
const EMPTY = fontOf([[3, 1, f4([])]]);

describe("Dragon's cmap gives each character the glyph Chrome draws", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await launchChrome();
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body></body></html>');
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  const UPM = 2000;
  /** Chrome's canvas width of each character alone, at one em of UPM px, in the font's family and then monospace. */
  const measure = (font: Uint8Array, codePoints: readonly number[]): Promise<{ status: string; widths: number[] }> =>
    page.evaluate(async ([b64, cps, size]) => {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const face = new FontFace('cmap-probe', bytes.buffer);
      document.fonts.add(face);
      await face.load().catch(() => null);
      const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      ctx.font = `${size}px "cmap-probe", monospace`;
      const widths = cps.map((cp) => ctx.measureText(String.fromCodePoint(cp)).width);
      document.fonts.delete(face);
      return { status: face.status, widths };
    }, [Buffer.from(font).toString('base64'), codePoints, UPM] as const);

  it('for every case, character by character', async () => {
    const mismatches: string[] = [];
    for (const { name, font, codePoints } of cases) {
      const read = readSfnt(font);
      if (!read.ok) throw new Error(`${name}: Dragon refuses it: ${JSON.stringify(read.refusal)}`);
      expect(read.font.head.unitsPerEm).toBe(UPM);
      const chrome = await measure(font, codePoints);
      expect(chrome.status, name).toBe('loaded');
      const fallback = await measure(EMPTY, codePoints);
      codePoints.forEach((cp, i) => {
        const glyph = read.font.glyphForCodePoint(cp);
        const want = glyph === 0 ? (fallback.widths[i] as number) : read.font.advance(glyph);
        const got = chrome.widths[i] as number;
        if (Math.abs(got - want) > 0.01) {
          mismatches.push(`${name}: U+${cp.toString(16).toUpperCase().padStart(4, '0')} Dragon glyph ${glyph} (width ${want}), Chrome width ${got}`);
        }
      });
    }
    expect(mismatches).toEqual([]);
  }, 120_000);

  it('the glyphs the cases use differ in advance from each other and from every fallback width', async () => {
    const read = readSfnt(fontOf([[3, 1, BMP(G1)]]));
    if (!read.ok) throw new Error('Dragon refuses Lato with a plain 3-1-4');
    const advances = [G1, G2, G3, G4, G5].map((g) => read.font.advance(g));
    expect(new Set(advances).size).toBe(5);
    const fallback = await measure(EMPTY, [...new Set(cases.flatMap((c) => c.codePoints))]);
    expect(fallback.widths.filter((w) => advances.includes(w))).toEqual([]);
  });
});
