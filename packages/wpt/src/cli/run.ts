// pnpm wpt:run --target web [--filter <prefix>] [--no-chrome | --chrome-all]: runs every CSS WPT file (Dragon, then Chrome 145 on
// the runnable ones, or on every translated numeric file) and writes packages/wpt/out/<target>.json, out/summary.md and the translated fixtures under generated/.
// Script-driven tests are snapshotted in Chrome into out/snapshots/ (committed ones are read with --no-chrome). --reftest-layout also runs the
// experimental report-only reftest-layout lane into out/<target>.reftest-layout.json and out/reftest-captures/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { packagePath } from '../paths.ts';
import { reftestLayoutPath, serializeReftestLayout } from '../reftest.ts';
import { runTarget, summarize, writeGenerated } from '../run.ts';
import { parseArgs } from './args.ts';

const args = parseArgs(process.argv.slice(2));
const result = await runTarget({ target: args.target, filter: args.filter, chrome: args.chrome, reftestLayout: args.reftestLayout, log: (l) => console.log(l) });
const { line, markdown } = summarize(result);
mkdirSync(packagePath('out'), { recursive: true });
const out = { wpt: result.expectations.wpt, target: args.target, filter: args.filter, chrome: args.chrome, snapshots: args.chrome === 'none' ? 'committed' : 'capture', reftestLayout: args.reftestLayout, expectations: result.expectations, records: result.records.filter((r) => r.dragon !== null) };
writeFileSync(packagePath(`out/${args.target}.json`), `${JSON.stringify(out, null, 1)}\n`);
writeFileSync(packagePath('out/summary.md'), markdown);
writeGenerated(result.records);
if (result.reftestLayout !== null) writeFileSync(packagePath(`out/${reftestLayoutPath(args.target).split('/').pop() as string}`), serializeReftestLayout(result.reftestLayout));
console.log(line);
