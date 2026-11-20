// pnpm run markless:style-export -- <native-style-input.json> <native-style.json>: a Markless component's style input
// (markless.native-style-input/0) to its dragon.native-style-export/1, compiled as the device lanes compile
// (docs/markless-native-styles.md "From a Markless style input"), and the decoded sfnt of each WOFF or WOFF2 author font beside the
// (docs/system-fonts.md; `--fonts pinned` for the stated reference's pinned faces). Exits 1 naming every error.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { marklessStyleExport } from '../markless-style-input.ts';

const all = process.argv.slice(2).filter((a) => a !== '--');
const at = all.indexOf('--fonts');
const mode = at < 0 ? 'system' : all[at + 1];
const args = at < 0 ? all : all.filter((_, i) => i !== at && i !== at + 1);
if (args.length !== 2 || (mode !== 'system' && mode !== 'pinned')) {
  console.error('usage: pnpm run markless:style-export -- <native-style-input.json> <native-style.json> [--fonts system|pinned]');
  process.exit(2);
}
// pnpm runs a script in the repository root; relative paths are the caller's.
const [inputPath, outputPath] = args.map((a) => resolve(process.env['INIT_CWD'] ?? process.cwd(), a)) as [string, string];
try {
  const { exported, decoded } = marklessStyleExport(readFileSync(inputPath, 'utf8'), args[0] as string, (file) => readFileSync(resolve(dirname(inputPath), file)), mode);
  for (const f of decoded) {
    const path = resolve(dirname(inputPath), f.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.bytes);
  }
  writeFileSync(outputPath, `${JSON.stringify(exported, null, 1)}\n`);
  const t = exported.targets.ios ?? exported.targets.android;
  console.log(`${outputPath}: ${exported.schema}, ${t?.assignments.length ?? 0} assignment(s) per target, readiness ${t?.readiness.kind ?? 'none'}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
