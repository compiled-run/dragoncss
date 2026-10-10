// The one-pass absence checks give exactly the answers of the per-needle scans they replace (native-host.test.ts).
import { describe, expect, it } from 'vitest';
import { containedNeedles, dotNames } from '../src/text-search.ts';

/** A deterministic generator (mulberry32), so a failure reproduces. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ['a', 'b', 'c', '.', '-', '_', ' ', '\n', '{', '}', '\ud83d', '\ude00', 'é'];
const draw = (r: () => number, max: number): string => {
  let s = '';
  for (let n = Math.floor(r() * (max + 1)); n > 0; n--) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return s;
};

describe('containedNeedles', () => {
  it('is text.includes(needle) for every needle, over 3000 random texts and needle sets', () => {
    const r = random(1);
    let present = 0;
    let absent = 0;
    for (let k = 0; k < 3000; k++) {
      const text = draw(r, 60);
      const needles = Array.from({ length: 1 + Math.floor(r() * 12) }, () => (r() < 0.3 && text.length > 0 ? text.slice(Math.floor(r() * text.length), Math.floor(r() * text.length) + 1 + Math.floor(r() * 6)) : draw(r, 6)));
      const found = containedNeedles(text, needles);
      for (const n of needles) {
        expect(found.has(n), JSON.stringify({ text, n })).toBe(text.includes(n));
        if (text.includes(n)) present++;
        else absent++;
      }
      expect([...found].every((n) => needles.includes(n))).toBe(true);
    }
    expect(present).toBeGreaterThan(1000);
    expect(absent).toBeGreaterThan(1000);
  });
  it('finds needles that share prefixes, end inside one another or overlap, and the empty needle', () => {
    expect([...containedNeedles('ushers', ['he', 'she', 'his', 'hers', 'sh', 'r', 'rs!', ''])].sort()).toEqual(['', 'he', 'hers', 'r', 'sh', 'she']);
    expect([...containedNeedles('aaab', ['aab', 'ab', 'aaaa', 'b'])].sort()).toEqual(['aab', 'ab', 'b']);
    expect(containedNeedles('', ['a']).size).toBe(0);
  });
});

describe('dotNames', () => {
  it('holds name exactly when /\\.name(?![\\w-])/ matches, over 3000 random texts', () => {
    const r = random(2);
    let hits = 0;
    for (let k = 0; k < 3000; k++) {
      const text = draw(r, 60);
      const names = dotNames(text);
      for (let j = 0; j < 8; j++) {
        const name = ['a', 'b', '_'][Math.floor(r() * 3)] + draw(random(k * 8 + j), 3).replace(/[^\w-]/g, '');
        const want = new RegExp(`\\.${name}(?![\\w-])`).test(text);
        expect(names.has(name), JSON.stringify({ text, name })).toBe(want);
        if (want) hits++;
      }
    }
    expect(hits).toBeGreaterThan(200);
  });
  it('names the class of a compound selector, after a word character or a dot too', () => {
    expect([...dotNames('div.box li.item .a.b')].sort()).toEqual(['a', 'b', 'box', 'item']);
  });
});
