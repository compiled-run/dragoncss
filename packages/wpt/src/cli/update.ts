// pnpm wpt:update-expectations --target web: merges the last full wpt:run (out/<target>.json) into expectations/<target>.json.
// Pass and not-runnable entries follow the run; existing fail entries keep their reason, deviation and issue; a new failure gets
// the TODO placeholder, which wpt:check rejects until a person replaces it.
import { existsSync, writeFileSync } from 'node:fs';
import { expectationsPath, mergeExpectations, readExpectations, readRunForUpdate, serializeExpectations } from '../expectations.ts';
import { lockedCommit, packagePath } from '../paths.ts';
import { parseArgs } from './args.ts';

const args = parseArgs(process.argv.slice(2));
const loaded = readRunForUpdate(packagePath(`out/${args.target}.json`), args.target, lockedCommit());
if ('problem' in loaded) {
  console.error(`wpt:update-expectations ${args.target}: ${loaded.problem}`);
  process.exit(1);
}
const { run } = loaded;
const file = expectationsPath(args.target);
const merged = mergeExpectations(existsSync(file) ? readExpectations(file) : null, run.expectations);
writeFileSync(file, serializeExpectations(merged));
const todo = Object.entries(merged.tests).filter(([, e]) => e.status === 'fail' && e.reason === 'TODO').map(([p]) => p);
console.log(`wrote ${file}: ${Object.keys(merged.tests).length} files`);
for (const p of todo) console.log(`new failure needs a reason and a deviation or issue: ${p}`);
