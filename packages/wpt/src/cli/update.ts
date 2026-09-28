// pnpm wpt:update-expectations --target web: merges the last full wpt:run (out/<target>.json) into expectations/<target>.json.
// Pass and not-runnable entries follow the run; existing fail entries keep their reason, deviation and issue; a new failure gets
// the TODO placeholder, which wpt:check rejects until a person replaces it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expectationsPath, mergeExpectations, readExpectations, readRunForUpdate, serializeExpectations } from '../expectations.ts';
import { lockedCommit, packagePath } from '../paths.ts';
import { REFTEST_CAPTURE_DIR, reftestLayoutPath, replaceReftestCaptures, RUN_REFTEST_CAPTURE_DIR } from '../reftest.ts';
import { replaceSnapshots, RUN_SNAPSHOT_DIR, SNAPSHOT_DIR } from '../snapshot.ts';
import { parseArgs } from './args.ts';

const args = parseArgs(process.argv.slice(2));
const runFile = packagePath(`out/${args.target}.json`);
const loaded = readRunForUpdate(runFile, args.target, lockedCommit());
if ('problem' in loaded) {
  console.error(`wpt:update-expectations ${args.target}: ${loaded.problem}`);
  process.exit(1);
}
const { run } = loaded;
if (run.snapshots !== 'capture') {
  console.error(`wpt:update-expectations ${args.target}: ${runFile} did not capture snapshots of the script-driven tests; run pnpm wpt:run --target ${args.target} with Chrome`);
  process.exit(1);
}
// The run's Chrome snapshots of the script-driven tests replace the committed store, so wpt:check reads what this run read.
const snapshots = replaceSnapshots(RUN_SNAPSHOT_DIR, SNAPSHOT_DIR);
console.log(`wrote ${SNAPSHOT_DIR}: ${snapshots} snapshot files`);
// The experimental reftest-layout report (report-only) and its Chrome captures, when the run included the lane.
if (run.reftestLayout === true) {
  const report = packagePath(`out/${reftestLayoutPath(args.target).split('/').pop() as string}`);
  writeFileSync(reftestLayoutPath(args.target), readFileSync(report, 'utf8'));
  console.log(`wrote ${reftestLayoutPath(args.target)} and ${REFTEST_CAPTURE_DIR}: ${replaceReftestCaptures(RUN_REFTEST_CAPTURE_DIR, REFTEST_CAPTURE_DIR)} captures (report-only)`);
}
const file = expectationsPath(args.target);
const merged = mergeExpectations(existsSync(file) ? readExpectations(file) : null, run.expectations);
writeFileSync(file, serializeExpectations(merged));
const todo = Object.entries(merged.tests).filter(([, e]) => e.status === 'fail' && e.reason === 'TODO').map(([p]) => p);
console.log(`wrote ${file}: ${Object.keys(merged.tests).length} files`);
for (const p of todo) console.log(`new failure needs a reason and a deviation or issue: ${p}`);
