// pnpm wpt:update-expectations --target web: merges the last full wpt:run (out/<target>.json) into expectations/<target>.json.
// Pass and not-runnable entries follow the run; existing fail entries keep their reason, deviation and issue; a new failure gets
// the TODO placeholder, which wpt:check rejects until a person replaces it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Expectations } from '../expectations.ts';
import { expectationsPath, mergeExpectations, readExpectations, serializeExpectations } from '../expectations.ts';
import { lockedCommit, packagePath } from '../paths.ts';
import { parseArgs } from './args.ts';

const args = parseArgs(process.argv.slice(2));
const runFile = packagePath(`out/${args.target}.json`);
if (!existsSync(runFile)) throw new Error(`no ${runFile}: run pnpm wpt:run --target ${args.target} first`);
const run = JSON.parse(readFileSync(runFile, 'utf8')) as { wpt: string; filter: string | null; chrome: string; expectations: Expectations };
if (run.filter !== null) throw new Error(`${runFile} is a filtered run (${run.filter}); expectations are updated only from a full run`);
if (run.chrome === 'none') throw new Error(`${runFile} was run with --no-chrome; failures need Chrome's result on the same checks`);
if (run.wpt !== lockedCommit()) throw new Error(`${runFile} is at WPT ${run.wpt}, packages/wpt/wpt.lock pins ${lockedCommit()}`);
const file = expectationsPath(args.target);
const merged = mergeExpectations(existsSync(file) ? readExpectations(file) : null, run.expectations);
writeFileSync(file, serializeExpectations(merged));
const todo = Object.entries(merged.tests).filter(([, e]) => e.status === 'fail' && e.reason === 'TODO').map(([p]) => p);
console.log(`wrote ${file}: ${Object.keys(merged.tests).length} files`);
for (const p of todo) console.log(`new failure needs a reason and a deviation or issue: ${p}`);
