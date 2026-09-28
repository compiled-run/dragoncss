// pnpm wpt:check --target web [--filter <prefix>] [--expectations <file>]: recomputes Dragon's result for every CSS WPT file and
// fails on any difference from the committed expectations, including an unexpected pass, and on any invalid fail entry.
import { existsSync, readFileSync } from 'node:fs';
import { compareExpectations, expectationsPath, readExpectations } from '../expectations.ts';
import { compareInteropScores } from '../interop.ts';
import { lockedCommit } from '../paths.ts';
import { runTarget, summarize } from '../run.ts';
import type { ReftestLayoutReport } from '../reftest.ts';
import { compareReftestLayout, reftestLayoutPath } from '../reftest.ts';
import { listSnapshots, SNAPSHOT_DIR } from '../snapshot.ts';
import { parseArgs } from './args.ts';

const args = parseArgs(process.argv.slice(2));
const file = args.expectations ?? expectationsPath(args.target);
if (!existsSync(file)) {
  console.error(`no expectations file ${file}: run pnpm wpt:run --target ${args.target}, then pnpm wpt:update-expectations --target ${args.target}`);
  process.exit(1);
}
const expected = readExpectations(file);
const problems: string[] = [];
if (expected.wpt !== lockedCommit()) problems.push(`expectations pin WPT ${expected.wpt}, packages/wpt/wpt.lock pins ${lockedCommit()}`);
const result = await runTarget({ target: args.target, filter: args.filter, chrome: 'none', reftestLayout: args.reftestLayout, ...(args.snapshots === null ? {} : { snapshotDir: args.snapshots }) });
problems.push(...compareExpectations(expected, result.expectations, args.filter));
if (args.filter === null) {
  problems.push(...compareInteropScores(expected, result.expectations, result.interop));
  // The committed snapshot store holds exactly the script-driven tests: a missing one already shows as snapshot:missing.
  const used = new Set(result.snapshotPaths);
  for (const p of listSnapshots(args.snapshots ?? SNAPSHOT_DIR)) if (!used.has(p)) problems.push(`${p}: committed snapshot, but the file does not take the snapshot path`);
}
console.log(summarize(result).line);
// reftest-layout is experimental and report-only: its differences are printed, never counted as problems.
if (result.reftestLayout !== null) {
  const file2 = reftestLayoutPath(args.target);
  const diffs = existsSync(file2) ? compareReftestLayout(JSON.parse(readFileSync(file2, 'utf8')) as ReftestLayoutReport, result.reftestLayout) : [`no ${file2}`];
  for (const d of diffs.slice(0, 50)) console.log(`reftest-layout (report-only): ${d}`);
  console.log(`reftest-layout (report-only): ${diffs.length} difference(s) from ${file2}`);
}
if (problems.length > 0) {
  for (const p of problems.slice(0, 200)) console.error(p);
  if (problems.length > 200) console.error(`... and ${problems.length - 200} more`);
  console.error(`wpt:check ${args.target}: ${problems.length} difference(s) from ${file}`);
  process.exit(1);
}
console.log(`wpt:check ${args.target}: every entry matches ${file}`);
