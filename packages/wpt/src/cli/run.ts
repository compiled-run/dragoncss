// pnpm wpt:run --target web [--filter <prefix>] [--no-chrome | --chrome-all]: runs every CSS WPT file (Dragon, then Chrome 145 on
// the runnable ones, or on every translated numeric file) and writes packages/wpt/out/<target>.json, out/summary.md and the translated fixtures under generated/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { packagePath } from '../paths.ts';
import { runTarget, summarize, writeGenerated } from '../run.ts';
import { parseArgs } from './args.ts';

const args = parseArgs(process.argv.slice(2));
const result = await runTarget({ target: args.target, filter: args.filter, chrome: args.chrome, log: (l) => console.log(l) });
const { line, markdown } = summarize(result);
mkdirSync(packagePath('out'), { recursive: true });
const out = { wpt: result.expectations.wpt, target: args.target, filter: args.filter, chrome: args.chrome, expectations: result.expectations, records: result.records.filter((r) => r.dragon !== null) };
writeFileSync(packagePath(`out/${args.target}.json`), `${JSON.stringify(out, null, 1)}\n`);
writeFileSync(packagePath('out/summary.md'), markdown);
writeGenerated(result.records);
console.log(line);
