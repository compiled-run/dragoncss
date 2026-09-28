// TXT1-C proof against Chrome 145 (notes/T004-txt1c-spec.md §3): every capture case exact, every planted fault caught.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPTURE_FAULTS, hasItalicTrait, readSfnt, withFault } from '../../src/fonts/index.ts';
import { chromeVersion } from '../../src/ua/chrome-145.darwin-arm64.generated.ts';
import { allComparisons, capture, same, vendorBytes } from './compare.ts';

const FILES = ['matching.json', 'metrics.json', 'parsing.json', 'pinned.json', 'platform.json'];
const unfaulted = allComparisons();

/**
 * ch of italic-trait faces is labelled caveat (PM ruling on T005 B1). These are the captured rows where it differs from Chrome;
 * every other ch row, italic or upright, must equal Chrome, and each of these must still differ.
 */
const CH_CAVEAT_MISMATCHES = [
  'plain/Inter/Inter-Italic.ttf/dpr 1/23.3px',
  'plain/Inter/Inter-BoldItalic.ttf/dpr 1/23.3px',
  'plain/Inter/Inter-Italic.ttf/dpr 2/23.3px',
  'plain/Inter/Inter-BoldItalic.ttf/dpr 2/23.3px',
];
const isExpected = (c: { group: string; id: string }): boolean => c.group === 'metrics.ch.caveat' && CH_CAVEAT_MISMATCHES.includes(c.id);
const italicFile = (id: string): boolean => {
  const r = readSfnt(vendorBytes(id.split('/').slice(1, 3).join('/')));
  return r.ok && hasItalicTrait(r.font);
};
const groups = [...new Set(unfaulted.map((c) => c.group))];

describe('font captures', () => {
  it.each(FILES)('%s records Chrome 145 on darwin-arm64 with the current font bytes', (file) => {
    const h = capture<{ chrome: string; platform: string; fonts: Record<string, string>; launches: { dpr: number; flags: string[] }[] }>(file);
    expect(h.chrome).toBe(chromeVersion);
    expect(h.platform).toBe('darwin-arm64');
    for (const l of h.launches) expect(l.flags).toContain(`--force-device-scale-factor=${l.dpr}`);
    for (const [f, sha] of Object.entries(h.fonts)) {
      expect(createHash('sha256').update(readFileSync(new URL(`../../../../vendor/fonts/${f}`, import.meta.url))).digest('hex')).toBe(sha);
    }
  });

  it('covers every group with cases derived from the capture files', () => {
    const m = capture<{ cases: { requests: unknown[] }[] }>('matching.json');
    const metrics = capture<{ rows: unknown[] }>('metrics.json');
    const p = capture<{ rules: unknown[]; families: unknown[] }>('parsing.json');
    const pinned = capture<{ requests: unknown[] }>('pinned.json');
    const count = (g: string): number => unfaulted.filter((c) => c.group === g).length;
    expect(count('matching')).toBe(m.cases.reduce((n, c) => n + c.requests.length, 0));
    expect(count('metrics.ch') + count('metrics.ch.caveat')).toBe(metrics.rows.length);
    for (const g of ['metrics.ex', 'metrics.cap', 'metrics.line-height-normal', 'metrics.baseline']) expect(count(g)).toBe(metrics.rows.length);
    expect(count('parsing.font-face')).toBe(p.rules.length);
    expect(count('parsing.font-family')).toBe(p.families.length);
    expect(count('pinned.face')).toBe(pinned.requests.length);
  });

  it('ch caveat set: exactly the listed italic-trait rows differ from Chrome', () => {
    expect(CH_CAVEAT_MISMATCHES.every(italicFile)).toBe(true);
    const caveat = unfaulted.filter((c) => c.group === 'metrics.ch.caveat');
    expect(caveat.every((c) => italicFile(c.id))).toBe(true);
    expect(unfaulted.filter((c) => c.group === 'metrics.ch').every((c) => !italicFile(c.id))).toBe(true);
    expect(caveat.filter((c) => !same(c)).map((c) => c.id).sort()).toEqual([...CH_CAVEAT_MISMATCHES].sort());
  });

  it.each(groups)('%s: Dragon equals Chrome in every case not in the caveat set', (group) => {
    const failing = unfaulted.filter((c) => c.group === group && !same(c) && !isExpected(c));
    expect(failing.map((c) => ({ id: c.id, dragon: c.dragon, chrome: c.chrome }))).toEqual([]);
  });

  it.each(CAPTURE_FAULTS)('planted fault %s flips at least one capture comparison', (fault) => {
    const broken = allComparisons(withFault(fault)).filter((c) => !same(c) && !isExpected(c));
    expect(broken.length).toBeGreaterThan(0);
  });
});
