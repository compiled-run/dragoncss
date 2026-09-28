// Shared flags: --target <web>, --filter <path prefix>, --expectations <file>, --no-chrome, --chrome-all, --reftest-layout,
// --snapshots <dir> (wpt:check: read the script-driven tests' snapshots from dir instead of packages/wpt/snapshots; for the planted-fault tests).
import type { Target } from '../dragon.ts';
import { TARGETS } from '../dragon.ts';

export type Args = { readonly target: Target; readonly filter: string | null; readonly expectations: string | null; readonly chrome: 'none' | 'runnable' | 'translated'; readonly reftestLayout: boolean; readonly snapshots: string | null };

export function parseArgs(argv: readonly string[]): Args {
  let target: string | null = null;
  let filter: string | null = null;
  let expectations: string | null = null;
  let chrome: Args['chrome'] = 'runnable';
  let reftestLayout = false;
  let snapshots: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--target') target = argv[++i] ?? null;
    else if (a === '--filter') filter = argv[++i] ?? null;
    else if (a === '--expectations') expectations = argv[++i] ?? null;
    else if (a === '--no-chrome') chrome = 'none';
    else if (a === '--chrome-all') chrome = 'translated';
    else if (a === '--reftest-layout') reftestLayout = true;
    else if (a === '--snapshots') snapshots = argv[++i] ?? null;
    else throw new Error(`unknown argument ${a}`);
  }
  if (target === null || !(TARGETS as readonly string[]).includes(target)) throw new Error(`--target must be one of ${TARGETS.join(', ')}`);
  return { target: target as Target, filter, expectations, chrome, reftestLayout, snapshots };
}
