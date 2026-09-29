// One shard of the G-P differential test (packages/parity/src/grid-corpus.ts): every horizontal-tb environment of every case in
// the shard's corpus files must match Chrome exactly, be a pinned known mismatch, or be refused for a reason an out-of-scope
// package owns. The shards run as separate test files so vitest runs them in parallel.
import { NO_GRID_FAULTS } from '@dragon/layout';
import type { CorpusCase } from '../../src/grid-corpus.ts';
import { KNOWN_MISMATCHES, readGridCorpus, REFUSAL_CATEGORIES, runGridCase } from '../../src/grid-corpus.ts';

export type ShardResult = {
  readonly cases: number;
  readonly matched: number;
  readonly knownMismatches: readonly string[];
  readonly refused: Readonly<Record<string, number>>;
  /** Mismatches not pinned, pinned mismatches whose detail changed, and refusals no category owns. */
  readonly problems: readonly string[];
};

let corpus: CorpusCase[] | null = null;
const allCases = (): CorpusCase[] => {
  if (corpus === null) corpus = readGridCorpus();
  return corpus;
};

export function runShard(families: readonly string[]): ShardResult {
  const cases = allCases().filter((c) => families.includes(c.family));
  const present = new Set(allCases().map((c) => c.family));
  const problems: string[] = families.filter((f) => !present.has(f)).map((f) => `no corpus file ${f}.json`);
  let matched = 0;
  const known: string[] = [];
  const refused: Record<string, number> = {};
  for (const c of cases) {
    for (const [env, r] of runGridCase(c, NO_GRID_FAULTS).envs) {
      const key = `${c.family}/${c.id} ${env}`;
      if (r.kind === 'match') {
        matched++;
        if (KNOWN_MISMATCHES.has(key)) problems.push(`${key}: a pinned mismatch now matches; remove it from KNOWN_MISMATCHES`);
      } else if (r.kind === 'mismatch') {
        const pinned = KNOWN_MISMATCHES.get(key);
        if (pinned === undefined) problems.push(`${key}: ${r.detail}`);
        else if (pinned !== r.detail) problems.push(`${key}: the pinned mismatch changed to ${r.detail}`);
        else known.push(key);
      } else {
        const category = REFUSAL_CATEGORIES.find((k) => k.pattern.test(r.reason));
        if (category === undefined) problems.push(`${key}: refused for a reason no out-of-scope package owns: ${r.reason}`);
        else refused[category.id] = (refused[category.id] ?? 0) + 1;
      }
    }
  }
  return { cases: cases.length, matched, knownMismatches: known.sort(), refused, problems };
}
