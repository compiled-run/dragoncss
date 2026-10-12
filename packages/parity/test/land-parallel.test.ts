// Parallel position builds (land-lib buildPositionsParallel, prepareRound's buildAll): every position prepared at once, then
// assembled in order on the actual chain; an ejected PR or a failed preparation ends the speculation, and the positions above
// it are built one by one without it. The chain, and every result, equals the one-by-one build's.
import { describe, expect, it } from 'vitest';
import { buildPositionsParallel, type Entry, Fatal, LandFailure, type ParallelHooks, preparedDifference, preparedFits, prepareRound, stopProcessGroup } from '../../../scripts/land-lib.ts';
import { matcher, STEPS } from '../../../scripts/regen.ts';

const entry = (pr: number): Entry => ({ branch: `b${pr}`, pr, clean: 'c'.repeat(40) });
type Pos = { head: string };
type Item = { entry: Entry; ticket: { pr: number } };
const items = (...prs: number[]): Item[] => prs.map((pr) => ({ entry: entry(pr), ticket: { pr } }));

/** A fake build: a position's head names its PRs in order ("m+1+2"); `regenFails`/`assembleFails` eject a PR at that stage. */
function world(o: { regenFails?: number[]; assembleFails?: number[]; speculateFails?: number[]; sequentialFails?: number[] } = {}) {
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
      if (o.assembleFails?.includes(it.entry.pr) || o.sequentialFails?.includes(it.entry.pr)) throw new LandFailure('regen', `#${it.entry.pr} fails`);
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
  it('a failed prepared regen (the parallel load\'s, perhaps) does not eject: that position is built one by one, and the preparations above still hold', () => {
    const w = world({ regenFails: [2] });
    expect(heads(buildPositionsParallel('m', items(1, 2, 3), w.hooks))).toEqual(['m+1', 'm+1+2', 'm+1+2+3']);
    expect(w.calls.slice(3)).toEqual(['await 1', 'assemble 1 #1 on m', 'await 2', 'sequential 2 #2 on m+1', 'await 3', 'assemble 3 #3 on m+1+2']);
  });
  it('only the one-by-one rebuild\'s failure ejects a PR whose prepared regen failed; the positions above are then built without it', () => {
    const w = world({ regenFails: [1], sequentialFails: [1] });
    expect(heads(buildPositionsParallel('m', items(1, 2, 3), w.hooks))).toEqual(['ejected: #1 fails', 'm+2', 'm+2+3']);
    expect(w.calls.slice(3)).toEqual(['await 1', 'sequential 1 #1 on m', 'abandon 2', 'abandon 3', 'sequential 1 #2 on m', 'sequential 2 #3 on m+2']);
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
      buildAll: (base, its, failed) => buildPositionsParallel(base, its, w.hooks, failed),
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

describe('ejections in a parallel build are reported as they happen', () => {
  // Queue 58: #198 failed its merge on position 1 during the parallel build, and nothing was logged, labelled or commented until the
  // whole batch had built (another PR's half-hour build later); an interrupted driver would never have reported it.
  const round = (o: Parameters<typeof world>[0], prs: number[]) => {
    const w = world(o);
    prepareRound<{ pr: number }, Pos>(prs.map(entry), prs.length, () => 'm', {
      admit: (e) => ({ ticket: { pr: e.pr } }),
      build: () => {
        throw new Error('the one-by-one build is not used');
      },
      buildAll: (base, its, failed) => buildPositionsParallel(base, its, w.hooks, failed),
      verify: () => {},
      prove: () => {},
      proveMaster: () => {},
      log: () => {},
    }, { report: (r) => void w.calls.push('failure' in r ? `FAILED #${r.entry.pr} at ${r.failure.step}: ${r.failure.message}` : `result #${r.entry.pr}`) });
    return w.calls;
  };
  it('a PR that fails on the actual chain after the speculation ended is reported before the next position builds, once', () => {
    const calls = round({ speculateFails: [1], sequentialFails: [3] }, [1, 2, 3, 4]);
    expect(calls.filter((c) => !c.startsWith('speculate') && !c.startsWith('abandon'))).toEqual([
      'sequential 1 #1 on m',
      'sequential 2 #2 on m+1',
      'sequential 3 #3 on m+1+2',
      'FAILED #3 at regen: #3 fails',
      'sequential 3 #4 on m+1+2',
    ]);
  });
  it('an ejection while assembling is reported before the positions above are built', () => {
    const calls = round({ assembleFails: [2] }, [1, 2, 3]);
    expect(calls.slice(calls.indexOf('assemble 2 #2 on m+1'))).toEqual(['assemble 2 #2 on m+1', 'FAILED #2 at judge-devices: #2 fails its devices', 'abandon 3', 'sequential 2 #3 on m+1']);
  });
});

describe('assembling a prepared tree', () => {
  const isOutput = matcher(STEPS.flatMap((s) => s.outputs));
  const isRecord = matcher(['packages/parity/out/device-failures-*.json']);
  it('checks every path that is not a regen step\'s declared output, the hand-written ones the review-ignore list skips included', () => {
    const handWritten = ['package.json', 'pnpm-lock.yaml', 'packages/dragon/src/css/css-tree.d.ts', 'vendor/harfbuzz/COPYING', 'packages/x/third_party/a.c', 'packages/layout/src/script-data.ts'];
    expect(preparedDifference(handWritten, isOutput, isRecord)).toEqual({ sources: handWritten, records: [] });
  });
  it('lets the prepared regen set the declared outputs, and takes the device records from the merge', () => {
    const paths = ['packages/parity/expected/darwin-arm64/a.json', 'packages/parity/out/lanes.json', 'packages/dragon/src/css/grammar.generated.ts', 'packages/parity/out/device-failures-ios.json'];
    expect(preparedDifference(paths, isOutput, isRecord)).toEqual({ sources: [], records: ['packages/parity/out/device-failures-ios.json'] });
  });
  it('prepares in parallel only while the disk keeps its floor after the worktrees it adds', () => {
    expect(preparedFits(60, 4, { floorGb: 40, perGb: 4 })).toBe(true);
    expect(preparedFits(55, 4, { floorGb: 40, perGb: 4 })).toBe(false);
    expect(preparedFits(41, 0, { floorGb: 40, perGb: 4 })).toBe(true);
  });
});

describe('stopping an abandoned preparation', () => {
  const group = (lifeMs: number, o: { killable?: boolean; startNow?: string | null } = {}) => {
    let t = 0;
    let termAt: number | null = null;
    let killed = false;
    const signals: string[] = [];
    const ops = {
      startOf: () => (o.startNow === undefined ? 'S' : o.startNow),
      members: () => (killed || (termAt !== null && t >= termAt + lifeMs) ? [] : [7, 8]),
      signal: (sig: 'SIGTERM' | 'SIGKILL') => {
        signals.push(sig);
        if (sig === 'SIGTERM') termAt = t;
        if (sig === 'SIGKILL' && o.killable !== false) killed = true;
      },
      sleep: (ms: number) => void (t += ms),
    };
    return { ops, signals, waited: () => t };
  };
  it('waits for the group to exit after SIGTERM before its worktree is reused', () => {
    const g = group(5000);
    expect(stopProcessGroup(7, 'S', g.ops)).toBe(true);
    expect(g.signals).toEqual(['SIGTERM']);
    expect(g.waited()).toBe(5000);
  });
  it('kills a group that outlives SIGTERM, and reports one that outlives SIGKILL as still running', () => {
    const g = group(Infinity);
    expect(stopProcessGroup(7, 'S', g.ops)).toBe(true);
    expect(g.signals).toEqual(['SIGTERM', 'SIGKILL']);
    const stuck = group(Infinity, { killable: false });
    expect(stopProcessGroup(7, 'S', stuck.ops)).toBe(false);
  });
  it('signals nothing when the pid now belongs to another process', () => {
    const g = group(0, { startNow: 'T' });
    expect(stopProcessGroup(7, 'S', g.ops)).toBe(true);
    expect(g.signals).toEqual([]);
  });
});
