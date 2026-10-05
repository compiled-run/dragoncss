// The CI full test's split (scripts/test-shards.ts): the runner group of every file, and shards balanced by recorded durations
// that hold every file of their group exactly once.
import { describe, expect, it } from 'vitest';
import { durationsOf, groupOf, parseDurations, plan, testFiles } from '../../../scripts/test-shards.ts';

describe('test shards', () => {
  it('puts the swiftc and kotlinc builds on the native group, whatever their split into files', () => {
    for (const f of ['packages/translate/test/planted-swift.test.ts', 'packages/translate/test/planted-kotlin-unit-scale.test.ts', 'packages/translate/test/native-dpr-swift.test.ts', 'packages/translate/test/calc-probe.test.ts', 'packages/dragon/test/native-backends.test.ts']) expect(groupOf(f), f).toBe('native');
    expect(groupOf('packages/dragon/test/native-projection.test.ts')).toBe('platform-free');
    expect(groupOf('packages/layout/test/units.test.ts')).toBe('platform-free');
    expect(groupOf('packages/parity/test/native-host.test.ts')).toBe('chrome');
    expect(groupOf('packages/parity/test/parity-determinism-1.test.ts')).toBe('chrome');
  });
  it('splits longest first onto the least loaded shard, every file once, unknown files at the median', () => {
    const d = { a: 10, b: 7, c: 5, d: 4, e: 1 };
    expect(plan(['a', 'b', 'c', 'd', 'e'], d, 2)).toEqual([['a', 'd'], ['b', 'c', 'e']]);
    const shards = plan(['a', 'b', 'c', 'd', 'e', 'new'], d, 3);
    expect(shards.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'new']);
    expect(() => plan(['a'], d, 0)).toThrow('shard count must be a positive whole number');
  });
  it('lists every test file vitest runs', () => {
    const files = testFiles();
    expect(files).toContain('packages/parity/test/test-shards.test.ts');
    expect(files.every((f) => /^packages\/[^/]+\/test\/.+\.test\.ts$/.test(f))).toBe(true);
  });
  it('reads durations strictly and takes them from vitest JSON reports', () => {
    expect(parseDurations('{"files":{"a":1.5}}')).toEqual({ a: 1.5 });
    expect(() => parseDurations('{"files":{"a":-1}}')).toThrow('a has no duration');
    expect(() => parseDurations('[]')).toThrow('is not an object');
    expect(durationsOf([{ testResults: [{ name: '/w/r/packages/x/test/a.test.ts', startTime: 1000, endTime: 3550 }] }], '/w/r')).toEqual({ 'packages/x/test/a.test.ts': 2.6 });
    expect(() => durationsOf([{ testResults: [{ name: 'packages/x/test/a.test.ts', startTime: 5, endTime: 1 }] }], '/w')).toThrow('no start and end time');
  });
});
