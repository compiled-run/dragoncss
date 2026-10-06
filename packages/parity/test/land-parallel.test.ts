// Parallel position builds (land-lib buildPositionsParallel, prepareRound's buildAll): every position prepared at once, then
// assembled in order on the actual chain; an ejected PR or a failed preparation ends the speculation, and the positions above
// it are built one by one without it. The chain, and every result, equals the one-by-one build's.
import { describe, expect, it } from 'vitest';
import { buildPositionsParallel, type Entry, Fatal, LandFailure, type ParallelHooks, prepareRound } from '../../../scripts/land-lib.ts';

const entry = (pr: number): Entry => ({ branch: `b${pr}`, pr, clean: 'c'.repeat(40) });
type Pos = { head: string };
type Item = { entry: Entry; ticket: { pr: number } };
const items = (...prs: number[]): Item[] => prs.map((pr) => ({ entry: entry(pr), ticket: { pr } }));

/** A fake build: a position's head names its PRs in order ("m+1+2"); `regenFails`/`assembleFails` eject a PR at that stage. */
function world(o: { regenFails?: number[]; assembleFails?: number[]; speculateFails?: number[] } = {}) {
  const calls: string[] = [];
  const hooks: ParallelHooks<{ pr: number }, Pos, { k: number; prs: number[] }> = {
    speculate: (k, its) => {
      const prs = its.map((i) => i.entry.pr);
      calls.push(`speculate ${k} [${prs.join(',')}]`);
      if (o.speculateFails?.includes(prs.at(-1)!)) throw new Error('merge conflict in preparation');
      return { k, prs };
    },
    await: (h) => {
      calls.push(`await ${h.k}`);
      if (o.regenFails?.includes(h.prs.at(-1)!)) throw new LandFailure('regen', `regen of #${h.prs.at(-1)} failed`);
    },
    assemble: (prev, it, k, h) => {
      calls.push(`assemble ${k} #${it.entry.pr} on ${prev}`);
      // The prepared tree is of the chain [prs]; on the actual chain prev+pr it must be the same chain.
      expect(`m+${h.prs.join('+')}`).toBe(`${prev}+${it.entry.pr}`);
      if (o.assembleFails?.includes(it.entry.pr)) throw new LandFailure('judge-devices', `#${it.entry.pr} fails its devices`);
      return { head: `${prev}+${it.entry.pr}` };
    },
    sequential: (prev, it, k) => {
      calls.push(`sequential ${k} #${it.entry.pr} on ${prev}`);
      if (o.assembleFails?.includes(it.entry.pr) || o.regenFails?.includes(it.entry.pr)) throw new LandFailure('regen', `#${it.entry.pr} fails`);
      return { head: `${prev}+${it.entry.pr}` };
    },
    abandon: (h) => void calls.push(`abandon ${h.k}`),
    log: () => {},
  };
  return { hooks, calls };
}
const heads = (slots: readonly ({ position: Pos } | { error: unknown })[]): string[] => slots.map((s) => ('position' in s ? s.position.head : `ejected: ${(s.error as Error).message}`));

describe('parallel position builds', () => {
  it('prepares every position at once, then assembles each on the actual position below it, in order', () => {
    const w = world();
    expect(heads(buildPositionsParallel('m', items(1, 2, 3, 4), w.hooks))).toEqual(['m+1', 'm+1+2', 'm+1+2+3', 'm+1+2+3+4']);
    expect(w.calls).toEqual([
      'speculate 1 [1]', 'speculate 2 [1,2]', 'speculate 3 [1,2,3]', 'speculate 4 [1,2,3,4]',
      'await 1', 'assemble 1 #1 on m', 'await 2', 'assemble 2 #2 on m+1', 'await 3', 'assemble 3 #3 on m+1+2', 'await 4', 'assemble 4 #4 on m+1+2+3',
    ]);
  });
  it('an ejected PR (its device run fails) ends the speculation: the positions above are abandoned and built one by one without it', () => {
    const w = world({ assembleFails: [2] });
    expect(heads(buildPositionsParallel('m', items(1, 2, 3, 4), w.hooks))).toEqual(['m+1', 'ejected: #2 fails its devices', 'm+1+3', 'm+1+3+4']);
    expect(w.calls.slice(6)).toEqual(['await 2', 'assemble 2 #2 on m+1', 'abandon 3', 'abandon 4', 'sequential 2 #3 on m+1', 'sequential 3 #4 on m+1+3']);
  });
  it('a failed prepared regen ejects that PR, as the one-by-one regen failure does, and the rest build one by one', () => {
    const w = world({ regenFails: [1] });
    expect(heads(buildPositionsParallel('m', items(1, 2, 3), w.hooks))).toEqual(['ejected: regen of #1 failed', 'm+2', 'm+2+3']);
    expect(w.calls.slice(3)).toEqual(['await 1', 'abandon 2', 'abandon 3', 'sequential 1 #2 on m', 'sequential 2 #3 on m+2']);
  });
  it('a preparation that could not start builds that position and the ones above one by one, on the actual chain', () => {
    const w = world({ speculateFails: [3] });
    expect(heads(buildPositionsParallel('m', items(1, 2, 3, 4), w.hooks))).toEqual(['m+1', 'm+1+2', 'm+1+2+3', 'm+1+2+3+4']);
    expect(w.calls.slice(4)).toEqual(['await 1', 'assemble 1 #1 on m', 'await 2', 'assemble 2 #2 on m+1', 'sequential 3 #3 on m+1+2', 'abandon 4', 'sequential 4 #4 on m+1+2+3']);
  });
  it('a Fatal stops the build at once', () => {
    const w = world();
    expect(() => buildPositionsParallel('m', items(1, 2), { ...w.hooks, assemble: () => { throw new Fatal('chain broken'); } })).toThrow('chain broken');
  });
  it('prepareRound takes the parallel build\'s slots exactly as the one-by-one loop\'s results', () => {
    const w = world({ assembleFails: [2] });
    const built: string[] = [];
    const round = prepareRound<{ pr: number }, Pos>([entry(1), entry(2), entry(3)], 4, () => 'm', {
      admit: (e) => ({ ticket: { pr: e.pr } }),
      build: () => {
        throw new Error('the one-by-one build is not used');
      },
      buildAll: (base, its) => buildPositionsParallel(base, its, w.hooks),
      verify: (b) => void built.push(...b.map((x) => x.position.head)),
      prove: () => {},
      proveMaster: () => {},
      log: () => {},
    });
    expect(built).toEqual(['m+1', 'm+1+3']);
    expect(round.results.map((r) => ('failure' in r ? `#${r.entry.pr} ${r.failure.step}` : ''))).toEqual(['#2 judge-devices']);
    expect(round.good).toBe(2);
  });
});
