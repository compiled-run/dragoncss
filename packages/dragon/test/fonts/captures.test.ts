// TXT1-C proof against Chrome 145 (notes/T004-txt1c-spec.md §3): every capture case exact, every planted fault caught.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAPTURE_FAULTS, withFault } from '../../src/fonts/index.ts';
import { chromeVersion } from '../../src/ua/chrome-145.darwin-arm64.generated.ts';
import { allComparisons, capture, same } from './compare.ts';

const FILES = ['matching.json', 'metrics.json', 'parsing.json', 'pinned.json', 'platform.json'];
const unfaulted = allComparisons();
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
    for (const g of ['metrics.ex', 'metrics.ch', 'metrics.cap', 'metrics.line-height-normal', 'metrics.baseline']) expect(count(g)).toBe(metrics.rows.length);
    expect(count('parsing.font-face')).toBe(p.rules.length);
    expect(count('parsing.font-family')).toBe(p.families.length);
    expect(count('pinned.face')).toBe(pinned.requests.length);
  });

  it.each(groups)('%s: Dragon equals Chrome in every case', (group) => {
    const failing = unfaulted.filter((c) => c.group === group && !same(c));
    expect(failing.map((c) => ({ id: c.id, dragon: c.dragon, chrome: c.chrome }))).toEqual([]);
  });

  it.each(CAPTURE_FAULTS)('planted fault %s flips at least one capture comparison', (fault) => {
    const broken = allComparisons(withFault(fault)).filter((c) => !same(c));
    expect(broken.length).toBeGreaterThan(0);
  });
});
