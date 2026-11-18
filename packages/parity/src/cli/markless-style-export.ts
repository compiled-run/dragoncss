// pnpm run markless:style-export -- <native-style-input.json> <native-style.json>: a Markless component's style input
// (markless.native-style-input/0) to its dragon.native-style-export/1, compiled as the device lanes compile
// (docs/markless-native-styles.md "From a Markless style input"). Exits 1 naming every error when the input does not compile.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { marklessStyleExport } from '../markless-style-input.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.length !== 2) {
  console.error('usage: pnpm run markless:style-export -- <native-style-input.json> <native-style.json>');
  process.exit(2);
}
// pnpm runs a script in the repository root; relative paths are the caller's.
const [inputPath, outputPath] = args.map((a) => resolve(process.env['INIT_CWD'] ?? process.cwd(), a)) as [string, string];
try {
  const { exported } = marklessStyleExport(readFileSync(inputPath, 'utf8'), args[0] as string, (file) => readFileSync(resolve(dirname(inputPath), file)));
  writeFileSync(outputPath, `${JSON.stringify(exported, null, 1)}\n`);
  const t = exported.targets.ios ?? exported.targets.android;
  console.log(`${outputPath}: ${exported.schema}, ${t?.assignments.length ?? 0} assignment(s) per target, readiness ${t?.readiness.kind ?? 'none'}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
