// pnpm wpt:check --target web [--filter <prefix>] [--expectations <file>]: recomputes Dragon's result for every CSS WPT file and
// fails on any difference from the committed expectations, including an unexpected pass, and on any invalid fail entry.
import { existsSync } from 'node:fs';
import { compareExpectations, expectationsPath, readExpectations } from '../expectations.ts';
import { compareInteropScores } from '../interop.ts';
import { lockedCommit } from '../paths.ts';
import { runTarget, summarize } from '../run.ts';
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
const result = await runTarget({ target: args.target, filter: args.filter, chrome: 'none' });
problems.push(...compareExpectations(expected, result.expectations, args.filter));
if (args.filter === null) problems.push(...compareInteropScores(expected, result.expectations, result.interop));
console.log(summarize(result).line);
if (problems.length > 0) {
  for (const p of problems.slice(0, 200)) console.error(p);
  if (problems.length > 200) console.error(`... and ${problems.length - 200} more`);
  console.error(`wpt:check ${args.target}: ${problems.length} difference(s) from ${file}`);
  process.exit(1);
}
console.log(`wpt:check ${args.target}: every entry matches ${file}`);
