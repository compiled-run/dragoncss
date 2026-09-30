// One shard of the G-P differential test (packages/parity/src/grid-corpus.ts): every horizontal-tb environment of every case in
// the shard's corpus files must match Chrome exactly, be a pinned known mismatch, or be refused for a reason an out-of-scope
// package owns. The shards run as separate test files so vitest runs them in parallel.
import { NO_GRID_FAULTS } from '@dragon/layout';
import type { CorpusCase } from '../../src/grid-corpus.ts';
import { classifyOutcome, readGridCorpus, runGridCase } from '../../src/grid-corpus.ts';

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
      const k = classifyOutcome(key, r);
      if (k.kind === 'match') matched++;
      else if (k.kind === 'known') known.push(key);
      else if (k.kind === 'refused') refused[k.category] = (refused[k.category] ?? 0) + 1;
      else problems.push(k.detail);
    }
  }
  return { cases: cases.length, matched, knownMismatches: known.sort(), refused, problems };
}
