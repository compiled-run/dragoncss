// The full `pnpm test` split for CI (.github/workflows/full-test.yml) by recorded file durations, so the shards end together.
//   node scripts/test-shards.ts plan <group> <shard> <count>   the files of one shard (1-based), one per line
//   node scripts/test-shards.ts all                            every test file with its group, tab-separated
//   node scripts/test-shards.ts refresh <vitest-json-report>... rewrites scripts/test-durations.json from CI reports
// Groups decide the runner: native (swiftc or kotlinc builds; xcode-27), platform-free (packages/layout and packages/dragon;
// ubuntu), chrome (everything else; macos-26). A file without a recorded duration counts as the median of the recorded ones.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export type Group = 'native' | 'platform-free' | 'chrome';
export const GROUPS: readonly Group[] = ['native', 'platform-free', 'chrome'];
const ROOT = resolve(import.meta.dirname, '..');
export const DURATIONS_FILE = 'scripts/test-durations.json';

/** The test files that compile the generated engine or a probe with swiftc or kotlinc, whatever their split into files. */
const NATIVE = /^packages\/translate\/test\/(native|planted)-[^/]*\.test\.ts$|^packages\/translate\/test\/calc-probe[^/]*\.test\.ts$|^packages\/dragon\/test\/native-backends[^/]*\.test\.ts$/;

export function groupOf(file: string): Group {
  if (NATIVE.test(file)) return 'native';
  if (/^packages\/(layout|dragon)\//.test(file)) return 'platform-free';
  return 'chrome';
}

/** Every file vitest runs (vitest.config.ts include: packages/*\/test/**\/*.test.ts), sorted. */
export function testFiles(root: string = ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.test.ts')) out.push(relative(root, p).split('\\').join('/'));
    }
  };
  for (const pkg of readdirSync(join(root, 'packages'))) {
    try {
      if (statSync(join(root, 'packages', pkg, 'test')).isDirectory()) walk(join(root, 'packages', pkg, 'test'));
    } catch {
      // A package without tests.
    }
  }
  return out.sort();
}

/** Recorded seconds per file; a malformed file is an error, never an empty record. */
export function parseDurations(text: string): Record<string, number> {
  const v: unknown = JSON.parse(text);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${DURATIONS_FILE} is not an object`);
  const files = (v as { files?: unknown }).files;
  if (typeof files !== 'object' || files === null || Array.isArray(files)) throw new Error(`${DURATIONS_FILE} has no files object`);
  for (const [f, s] of Object.entries(files)) if (typeof s !== 'number' || !(s >= 0)) throw new Error(`${DURATIONS_FILE}: ${f} has no duration`);
  return files as Record<string, number>;
}

/**
 * The files of a group split into count shards by longest-processing-time-first: each file, longest first, goes to the shard with
 * the least total so far (ties to the lowest shard). Every file of the group is in exactly one shard.
 */
export function plan(files: readonly string[], durations: Readonly<Record<string, number>>, count: number): string[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count must be a positive whole number, not ${count}`);
  const known = Object.values(durations).sort((a, b) => a - b);
  const fallback = known.length === 0 ? 1 : (known[Math.floor(known.length / 2)] as number);
  const cost = (f: string): number => durations[f] ?? fallback;
  const shards = Array.from({ length: count }, () => ({ files: [] as string[], total: 0 }));
  for (const f of [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : 1))) {
    const s = shards.reduce((m, x) => (x.total < m.total ? x : m), shards[0]!);
    s.files.push(f);
    s.total += cost(f);
  }
  return shards.map((s) => s.files.sort());
}

type Report = { testResults: { name: string; startTime: number; endTime: number }[] };

/** File durations in seconds from vitest JSON reports (the CI shards'), rounded to 0.1 s. */
export function durationsOf(reports: readonly Report[], root: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reports) {
    for (const t of r.testResults) {
      const rel = t.name.startsWith('/') ? relative(root, t.name).split('\\').join('/') : t.name;
      const file = rel.includes('packages/') ? rel.slice(rel.indexOf('packages/')) : rel;
      if (!(t.endTime >= t.startTime)) throw new Error(`${file}: the report has no start and end time`);
      out[file] = Math.round((t.endTime - t.startTime) / 100) / 10;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function main(): void {
  const [mode, ...rest] = process.argv.slice(2);
  const durations = (): Record<string, number> => parseDurations(readFileSync(join(ROOT, DURATIONS_FILE), 'utf8'));
  if (mode === 'plan' && rest.length === 3) {
    const [group, shard, count] = [rest[0] as Group, Number(rest[1]), Number(rest[2])];
    if (!GROUPS.includes(group)) throw new Error(`unknown group ${group}; the groups are ${GROUPS.join(', ')}`);
    if (!Number.isInteger(shard) || shard < 1 || shard > count) throw new Error(`shard ${rest[1]} is not 1..${rest[2]}`);
    const files = plan(testFiles().filter((f) => groupOf(f) === group), durations(), count)[shard - 1]!;
    if (files.length === 0) throw new Error(`${group} shard ${shard}/${count} has no files; lower the shard count`);
    console.log(files.join('\n'));
  } else if (mode === 'all' && rest.length === 0) {
    for (const f of testFiles()) console.log(`${f}\t${groupOf(f)}`);
  } else if (mode === 'refresh' && rest.length > 0) {
    const files = durationsOf(rest.map((p) => JSON.parse(readFileSync(p, 'utf8')) as Report), ROOT);
    writeFileSync(join(ROOT, DURATIONS_FILE), `${JSON.stringify({ note: 'Seconds per test file on the CI runners (full-test.yml), written by node scripts/test-shards.ts refresh <reports>.', files }, null, 1)}\n`);
    console.log(`${Object.keys(files).length} file durations written to ${DURATIONS_FILE}`);
  } else {
    console.error('usage: test-shards.ts plan <native|platform-free|chrome> <shard> <count> | all | refresh <vitest-json-report>...');
    process.exit(2);
  }
}

if (import.meta.main) main();
