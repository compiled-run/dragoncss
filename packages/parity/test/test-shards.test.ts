// The CI full test's split (scripts/test-shards.ts): the runner group of every file, and shards balanced by recorded durations
// that hold every file of their group exactly once.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { costs, durationsOf, GROUPS, groupFiles, groupOf, groupOfFile, parseDurations, plan, testFiles } from '../../../scripts/test-shards.ts';
import { repoPath } from '../src/paths.ts';

describe('test shards', () => {
  it('puts the swiftc and kotlinc builds on the native group, whatever their split into files', () => {
    for (const f of ['packages/translate/test/planted-swift.test.ts', 'packages/translate/test/planted-kotlin-unit-scale.test.ts', 'packages/translate/test/native-dpr-swift.test.ts', 'packages/translate/test/calc-probe.test.ts', 'packages/dragon/test/native-backends.test.ts']) expect(groupOf(f), f).toBe('native');
    expect(groupOf('packages/dragon/test/native-projection.test.ts')).toBe('platform-free');
    expect(groupOf('packages/layout/test/units.test.ts')).toBe('platform-free');
    expect(groupOf('packages/parity/test/native-host.test.ts')).toBe('chrome');
    expect(groupOf('packages/parity/test/parity-determinism-1.test.ts')).toBe('chrome');
    expect(groupOf('packages/parity/test/line-breaks-host-swift.test.ts')).toBe('native');
    expect(groupOf('packages/parity/test/line-breaks-host-kotlin.test.ts')).toBe('native');
    expect(groupOf('packages/parity/test/line-breaks.test.ts')).toBe('chrome');
  });
  it('puts every test that uses a native toolchain on the native group by its content, whatever its name', () => {
    expect(groupOf('packages/layout/test/kotlin-snap.test.ts', "const tool = kotlinTool();\n")).toBe('native');
    expect(groupOf('packages/translate/test/engine-swift.test.ts', "spawnSync('swiftc', ['-O'])")).toBe('native');
    expect(groupOf('packages/translate/test/paint-roots.test.ts', 'const r = runTarget(target, corpus, files);')).toBe('native');
    expect(groupOf('packages/parity/test/lanes-x.test.ts', 'await runHostLane(android, {});')).toBe('native');
    expect(groupOf('packages/parity/test/other.test.ts', 'const swiftToolchain = 1; // swiftc is mentioned in prose')).toBe('chrome');
  });
  it('splits longest first onto the least loaded shard, every file once, unknown files at the median', () => {
    const d = { a: 10, b: 7, c: 5, d: 4, e: 1 };
    expect(plan(['a', 'b', 'c', 'd', 'e'], d, 2)).toEqual([['a', 'd'], ['b', 'c', 'e']]);
    const shards = plan(['a', 'b', 'c', 'd', 'e', 'new'], d, 3);
    expect(shards.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'new']);
    expect(() => plan(['a'], d, 0)).toThrow('shard count must be a positive whole number');
  });
  it('costs a file split off a recorded one at its share of the parent, the parent too while it remains', () => {
    const d = { 't/planted-swift.test.ts': 700, 't/parity.test.ts': 400, 't/x.test.ts': 2, 't/y.test.ts': 4, 't/z.test.ts': 6 };
    const c = costs(['t/planted-swift-a.test.ts', 't/planted-swift-b.test.ts', 't/parity.test.ts', 't/parity-determinism-1.test.ts', 't/new.test.ts'], d);
    expect(Object.fromEntries(c)).toEqual({ 't/planted-swift-a.test.ts': 350, 't/planted-swift-b.test.ts': 350, 't/parity.test.ts': 200, 't/parity-determinism-1.test.ts': 200, 't/new.test.ts': 6 });
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

describe('test-files.yml groups (group-files)', () => {
  it('puts every test file of the repository in exactly one group, the group full-test.yml runs it in', () => {
    const all = testFiles();
    const groups = groupFiles(all);
    expect([...groups.keys()]).toEqual([...GROUPS]);
    const placed = [...groups.values()].flat();
    expect(placed.sort()).toEqual(all);
    expect(new Set(placed).size).toBe(all.length);
    for (const [g, files] of groups) for (const f of files) expect(groupOfFile(f), f).toBe(g);
    for (const g of GROUPS) expect(groups.get(g)?.length, g).toBeGreaterThan(0);
  });
  it('refuses anything that is not a test file of the tree, and takes each file once', () => {
    for (const bad of ['packages/parity/test/no-such.test.ts', 'packages/parity/test', 'package.json', '-t', '--reporter=json', '', 'packages/parity/test/chrome-ports.test', '../dragon/packages/parity/test/chrome-ports.test.ts']) {
      expect(() => groupFiles(['packages/layout/test/units.test.ts', bad]), JSON.stringify(bad)).toThrow('not test files of this tree');
    }
    expect(() => groupFiles([])).toThrow('no test files were requested');
    const g = groupFiles(['./packages/parity/test/chrome-ports.test.ts', 'packages/parity/test/chrome-ports.test.ts', 'packages/layout/test/units.test.ts']);
    expect(Object.fromEntries(g)).toEqual({ native: [], 'platform-free': ['packages/layout/test/units.test.ts'], chrome: ['packages/parity/test/chrome-ports.test.ts'] });
  });
  it('reads the tree it is given, by name and content', () => {
    const root = mkdtempSync(join(tmpdir(), 'group-files-'));
    try {
      mkdirSync(join(root, 'packages/x/test'), { recursive: true });
      writeFileSync(join(root, 'packages/x/test/a.test.ts'), "spawnSync('kotlinc', [])\n");
      writeFileSync(join(root, 'packages/x/test/b.test.ts'), '\n');
      expect(Object.fromEntries(groupFiles(['packages/x/test/b.test.ts', 'packages/x/test/a.test.ts'], root))).toEqual({ native: ['packages/x/test/a.test.ts'], 'platform-free': [], chrome: ['packages/x/test/b.test.ts'] });
      expect(() => groupFiles(['packages/parity/test/chrome-ports.test.ts'], root)).toThrow('not test files of this tree');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('sets each group up exactly as full-test.yml sets up its shards', () => {
    const job = (file: string, name: string): string => {
      const yml = readFileSync(repoPath(`.github/workflows/${file}`), 'utf8');
      const start = yml.indexOf(`\n  ${name}:\n`);
      expect(start, `${file} ${name}`).toBeGreaterThan(0);
      const end = yml.slice(start + 1).search(/\n {2}\S/);
      return end < 0 ? yml.slice(start + 1) : yml.slice(start + 1, start + 1 + end);
    };
    // The job's runner, time limit and environment, and every step before the test run.
    const setup = (text: string): string => {
      const keep = text.split('\n').filter((l) => /^ {4}(runs-on|timeout-minutes):|^ {6}DRAGON_WPT_DIR:/.test(l));
      const steps = text.slice(text.indexOf('\n    steps:\n'));
      const run = steps.search(/\n {6}- (name: vitest run|[&*]vitest\n)/);
      expect(run, text.slice(0, 40)).toBeGreaterThan(0);
      return [...keep, steps.slice(0, run)].join('\n');
    };
    for (const name of ['platform-free', 'native', 'chrome']) expect(setup(job('test-files.yml', name)), name).toBe(setup(job('full-test.yml', name)));
  });
});
