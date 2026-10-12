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
  // A test-files.yml job is judged as its full-test.yml shard is: same environment, runner, setup, vitest command and blocked scan.
  // Only the file list's source and the report's name differ, and the floor-write variables (unset unless floor_write).
  const yml = (file: string): string => readFileSync(repoPath(`.github/workflows/${file}`), 'utf8');
  const jobOf = (text: string, name: string): string => {
    const start = text.indexOf(`\n  ${name}:\n`);
    expect(start, name).toBeGreaterThan(0);
    const end = text.slice(start + 1).search(/\n {2}\S/);
    return end < 0 ? text.slice(start + 1) : text.slice(start + 1, start + 1 + end);
  };
  /** The step of a job that starts at the line matching head, up to the next step. */
  const stepOf = (job: string, head: RegExp): string => {
    const at = job.search(head);
    expect(at, String(head)).toBeGreaterThan(0);
    const end = job.slice(at + 1).search(/\n {6}- /);
    return end < 0 ? job.slice(at + 1) : job.slice(at + 1, at + 1 + end);
  };
  /** A step from its run: line on: what it runs, whatever its name, id and condition. */
  const runOf = (step: string): string => step.slice(step.indexOf('\n        run: |\n'));
  const vitestOf = (step: string): string =>
    runOf(step)
      .replace(/\n {10}list=\$\(node scripts\/test-shards\.ts plan [^\n]+\n {10}files=\(\); while IFS= read -r f; do files\+=\("\$f"\); done <<< "\$list"\n/, '\n<files>\n')
      .replace('\n          read -ra files <<< "$FILES"\n', '\n<files>\n')
      .replace(/--outputFile="\$RUNNER_TEMP\/report\/[^"\n]+\.json"/, '--outputFile=<report>');
  const header = (job: string): string[] => job.slice(0, job.indexOf('\n    steps:\n')).split('\n');

  it('runs each group exactly as full-test.yml runs its shards', () => {
    const [full, files] = [yml('full-test.yml'), yml('test-files.yml')];
    // The workflow environment.
    const envOf = (text: string): string => text.slice(text.indexOf('\nenv:\n'), text.indexOf('\njobs:\n'));
    expect(envOf(files)).toBe(envOf(full));
    // The anchored steps, defined in the platform-free job and used unchanged by the others.
    const defined = jobOf(files, 'platform-free');
    const vitest = stepOf(defined, /\n {6}- &vitest\n/);
    expect(vitest.split('\n').slice(0, 7)).toEqual(['      - &vitest', '        id: vitest', '        name: vitest run (the requested files)', '        env:', "          DRAGON_FLOOR_WRITE: ${{ inputs.floor_write && '1' || '' }}", "          DRAGON_PIN_WRITE: ${{ inputs.floor_write && '1' || '' }}", '        run: |']);
    const blocked = stepOf(defined, /\n {6}- &blocked\n/);
    expect(blocked.split('\n').slice(0, 4)).toEqual(['      - &blocked', '        name: No native run was blocked (owner tooling)', "        if: always() && steps.vitest.outcome != 'skipped'", '        run: |']);
    // vitest list takes the requested files and nothing else: the count every file must run in full.
    expect(runOf(stepOf(defined, /\n {6}- &list\n/))).toBe('\n        run: |\n          read -ra files <<< "$FILES"\n          npx vitest list "${files[@]}" --json="$RUNNER_TEMP/report/$GITHUB_JOB.list.json"');
    const after = ['vitest', 'blocked', 'list', 'ran', 'report', 'floor', 'floor-upload'];
    for (const name of ['platform-free', 'native', 'chrome']) {
      const [a, b] = [jobOf(files, name), jobOf(full, name)];
      // The runner, time limit and job environment (but the requested files).
      const keep = (h: string[]): string[] => {
        const env = h.indexOf('    env:');
        const end = h.slice(env + 1).findIndex((l) => !/^ {6}/.test(l));
        const vars = env < 0 ? [] : h.slice(env + 1, end < 0 ? h.length : env + 1 + end);
        return [...h.filter((l) => /^ {4}(runs-on|timeout-minutes):/.test(l)), ...vars.filter((l) => !l.startsWith('      FILES:'))];
      };
      expect(keep(header(a)), name).toEqual(keep(header(b)));
      // Every step before the test run.
      const setup = (job: string): string => job.slice(job.indexOf('\n    steps:\n'), job.search(/\n {6}- (name: vitest run|[&*]vitest\n)/));
      expect(setup(a), name).toBe(setup(b));
      // The vitest command and the blocked scan.
      const fullVitest = stepOf(b, /\n {6}- name: vitest run/);
      expect(vitestOf(vitest), name).toBe(vitestOf(fullVitest));
      expect(runOf(blocked), name).toBe(runOf(stepOf(b, /\n {6}- name: No native run was blocked/)));
      // Then the shared steps, in order, and nothing else.
      const rest = a.slice(a.search(/\n {6}- [&*]vitest\n/) + 1);
      const steps = rest.split('\n').filter((l) => /^ {6}- /.test(l)).map((l) => l.replace(/^ {6}- [&*]/, ''));
      expect(steps, name).toEqual(after);
      if (name !== 'platform-free') expect(rest.trimEnd(), name).toBe(after.map((x) => `      - *${x}`).join('\n'));
    }
  });
});
