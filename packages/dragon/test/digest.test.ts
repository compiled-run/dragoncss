// The core's own SHA-256 and UTF-8 (digest.ts) against node:crypto, and the pre-serialized profile text (CanonicalText) against a
// fresh canonicalJson. The digest bytes must never change: compiled digests are carried in device evidence.
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CanonicalText, canonicalJson, sha256Hex, sha256HexBytes, utf8 } from '../src/digest.ts';
import { COMMITTED_PROFILES, createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { SupportProfiles } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const nodeSha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The encoding digest.ts has always used: each code point of the string, a lone surrogate as its three bytes. */
function codePointBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

describe('digest.ts', () => {
  it('sha256HexBytes equals node:crypto at every length around the 64-byte block and padding boundaries, and on 1 MB', () => {
    for (let n = 0; n <= 200; n++) {
      const b = new Uint8Array(randomBytes(n));
      expect(sha256HexBytes(b), `${n} bytes`).toBe(nodeSha(b));
    }
    const big = new Uint8Array(randomBytes(1 << 20));
    expect(sha256HexBytes(big)).toBe(nodeSha(big));
  });

  it('utf8 encodes each code point, surrogate pairs as four bytes and lone surrogates as three, like iterating by code point', () => {
    for (const s of ['', 'abc', 'é', '€', '日本語', '😀', 'a😀b', '\ud800', '\udc00', '\ud800\ud800', '\udc00\ud800', 'x\ud83d', '\ud83dx', 'a'.repeat(1000)]) {
      expect(Array.from(utf8(s)), JSON.stringify(s)).toEqual(Array.from(codePointBytes(s)));
      expect(sha256Hex(s), JSON.stringify(s)).toBe(nodeSha(codePointBytes(s)));
    }
    let random = '';
    for (let i = 0; i < 5000; i++) random += String.fromCharCode(Math.floor(Math.random() * 0x10000));
    expect(Array.from(utf8(random))).toEqual(Array.from(codePointBytes(random)));
  });

  it('a CanonicalText is copied as written, so a pre-serialized profile gives the same canonical JSON and digest', () => {
    const value = { b: [1, { d: 2, c: 'x' }], a: COMMITTED_PROFILES.android };
    const direct = canonicalJson(value);
    const viaText = canonicalJson({ ...value, a: new CanonicalText(canonicalJson(COMMITTED_PROFILES.android)) });
    expect(viaText).toBe(direct);
    expect(sha256Hex(viaText)).toBe(sha256Hex(direct));
  });

  it('a profile is frozen once its text is cached, so an edit throws instead of leaving the compiled digest stale', () => {
    const copy = (): SupportProfiles => ({ web: { ...COMMITTED_PROFILES.web, rows: [...COMMITTED_PROFILES.web.rows] }, ios: COMMITTED_PROFILES.ios });
    const input = inputFor('.c { display: flex; }', (r) => [div(r, 'c', ['c'])]);
    const digestWith = (supportProfiles: SupportProfiles): string => {
      const out = createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles }).compile(input).outputs.web;
      return out.kind === 'blocked' ? '' : out.digest;
    };
    const profiles = copy();
    const before = digestWith(profiles);
    expect(before).not.toBe('');
    const rows = profiles.web.rows as unknown[];
    expect(() => rows.pop()).toThrow(TypeError);
    expect(() => Object.assign(profiles.web, { revision: 'edited' })).toThrow(TypeError);
    expect(digestWith(profiles)).toBe(before);
    const edited = copy();
    (edited.web as { revision: string }).revision = 'edited';
    expect(digestWith(edited)).not.toBe(before);
  });
});
