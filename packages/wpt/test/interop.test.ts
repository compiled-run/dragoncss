import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Entry, Expectations } from '../src/expectations.ts';
import { expectationsPath, readExpectations } from '../src/expectations.ts';
import { compareInteropScores, interopLabelsPath, interopScores, labelsByPath, loadInteropLabels, readMetaYml, serializeInteropLabels, testFileOf } from '../src/interop.ts';
import { lockedMetadataCommit } from '../src/paths.ts';

const labels = loadInteropLabels();
const committed = readExpectations(expectationsPath('web'));

describe('reading wpt-metadata META.yml', () => {
  it('takes the tests of labelled link items, whatever the key order or indentation, and ignores product links', () => {
    const top = ['links:', '- product: chrome', '  results:', '  - test: a.html', '- label: interop-2022-color', '  results:', '  - test: b.html', "  - test: 'c.html'", '    subtest: one', '  url: https://example.com'].join('\n');
    expect(readMetaYml(top)).toEqual([{ label: 'interop-2022-color', test: 'b.html' }, { label: 'interop-2022-color', test: 'c.html' }]);
    const nested = ['links:', '    - product: safari', '      results:', '        - test: x.html', '    - url: ""', '      label: interop-2021-grid', '      results:', '        - test: y.html', '    - label: other', '      results:', '        - test: z.html'].join('\n');
    expect(readMetaYml(nested)).toEqual([{ label: 'interop-2021-grid', test: 'y.html' }, { label: 'other', test: 'z.html' }]);
  });

  it('maps test ids to their files', () => {
    expect(testFileOf('css/a/b.html?variant=1')).toBe('css/a/b.html');
    expect(testFileOf('css/a/b.any.worker.html')).toBe('css/a/b.any.js');
    expect(testFileOf('css/a/b.any.html')).toBe('css/a/b.any.js');
    expect(testFileOf('css/a/b.window.html')).toBe('css/a/b.window.js');
  });
});

describe('the committed label map (interop-labels.json)', () => {
  it('is pinned to the wpt-metadata commit in wpt.lock, deterministic, sorted and CSS-only', () => {
    expect(labels.wptMetadata).toBe(lockedMetadataCommit());
    expect(serializeInteropLabels(labels)).toBe(readFileSync(interopLabelsPath(), 'utf8'));
    const names = Object.keys(labels.labels);
    expect(names).toEqual([...names].sort());
    for (const n of names) {
      const files = labels.labels[n] as readonly string[];
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f) => f.startsWith('css/'))).toBe(true);
      expect(files).toEqual([...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(n in labels.excluded).toBe(false);
    }
    expect(Object.keys(labels.excluded)).toContain('interop-2024-indexeddb');
  });

  it('tags every expectations entry with exactly its labels', () => {
    const byPath = labelsByPath(labels);
    for (const [p, e] of Object.entries(committed.tests)) expect(e.interop ?? []).toEqual(byPath.get(p) ?? []);
  });
});

describe('Interop scores', () => {
  it('are derived from the expectations alone, and a changed entry changes its areas and the overall line', () => {
    const scores = interopScores(committed, labels);
    expect(scores.areas.map((a) => a.label)).toEqual(Object.keys(labels.labels));
    expect(interopScores(JSON.parse(JSON.stringify(committed)) as Expectations, labels)).toEqual(scores);
    expect(compareInteropScores(committed, committed, labels)).toEqual([]);
    const passing = Object.entries(committed.tests).find(([, e]) => e.status === 'pass' && (e.interop ?? []).length > 0);
    if (passing === undefined) throw new Error('no passing Interop-labelled file to plant a fault in');
    const [path, entry] = passing;
    const planted: Expectations = { ...committed, tests: { ...committed.tests, [path]: { status: 'not-runnable', missing: 'planted', ...(entry.interop === undefined ? {} : { interop: entry.interop }) } as Entry } };
    const problems = compareInteropScores(committed, planted, labels);
    expect(problems.length).toBe((entry.interop ?? []).length + 1);
    expect(problems.at(-1)).toMatch(/^Interop Interop CSS \(\d+ areas, 2021-2026\): Dragon web expected \d+\/\d+, got/);
  });
});
