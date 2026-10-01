import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compilePattern, matchSegments, parseIgnoreFile } from '../../../scripts/macroscope-ignore.ts';
import { type Cache, MANUAL, MERGE_BY_HAND, parseCache, regen, STEPS, type Step, stepDigests, type Tree } from '../../../scripts/regen.ts';
import { repoPath } from '../src/paths.ts';

const matches = (glob: string, path: string): boolean => matchSegments(compilePattern(glob), path.split('/'));

// A fake repository: each step maps the tree to its new contents.
function fake(steps: Record<string, (t: Map<string, string>) => void>, tree: Record<string, string>) {
  const t = new Map(Object.entries(tree));
  const ran: string[] = [];
  const io = {
    snapshot: (): Tree => new Map(t),
    run: async (s: Step) => {
      ran.push(s.name);
      if (s.name === 'fails') return { code: 3, log: 'one\ntwo' };
      if (s.name === 'judge') return { code: 1, log: t.get('src/a') === 'verdict' ? 'all written\n' : 'crashed\n' };
      steps[s.name]!(t);
      return { code: 0, log: '' };
    },
    saveCache: () => {},
    log: () => {},
    now: () => 0,
    env: {},
  };
  return { t, ran, io };
}

const step = (name: string, outputs: string[]): Step => ({ name, argv: [name], outputs });
const opts = { force: false, check: false, from: null };

describe('pnpm regen chain', () => {
  // gen writes out/a from src/a; rows reads out/a and writes out/b; a cache from a finished run skips both.
  const chain = [step('gen', ['out/a']), step('rows', ['out/b'])];
  const impl = { gen: (t: Map<string, string>) => void t.set('out/a', `A(${t.get('src/a')})`), rows: (t: Map<string, string>) => void t.set('out/b', `B(${t.get('out/a')})`) };

  it('runs to a fixed point, then a second run has nothing to do', async () => {
    const f = fake(impl, { 'src/a': '1' });
    const cache: Cache = {};
    const r1 = await regen(chain, cache, opts, f.io);
    expect(r1).toMatchObject({ ok: true, changed: ['out/a', 'out/b'], error: null });
    expect(f.t.get('out/b')).toBe('B(A(1))');
    const g = fake(impl, Object.fromEntries(f.t));
    const r2 = await regen(chain, cache, opts, g.io);
    expect(r2).toMatchObject({ ok: true, changed: [], ran: 0, passes: 1 });
    expect(g.ran).toEqual([]);
  });

  it('reruns only the steps whose inputs changed, and names a planted stale output', async () => {
    const f = fake(impl, { 'src/a': '1' });
    const cache: Cache = {};
    await regen(chain, cache, opts, f.io);
    const g = fake(impl, { ...Object.fromEntries(f.t), 'out/b': 'stale' });
    const r = await regen(chain, cache, opts, g.io);
    expect(g.ran).toEqual(['rows']);
    expect(r).toMatchObject({ ok: true, changed: ['out/b'] });
    const h = fake(impl, { ...Object.fromEntries(f.t), 'src/a': '2' });
    expect((await regen(chain, cache, opts, h.io)).changed).toEqual(['out/a', 'out/b']);
    expect(h.ran).toEqual(['gen', 'rows']);
  });

  it('repeats the chain while a later step feeds an earlier one, and fails loudly at the pass cap', async () => {
    // rows reads out/c, which the last step writes from out/b: two passes change files, the third changes nothing.
    const loop = [step('gen', ['out/a']), { ...step('rows', ['out/b']), readsLater: ['lanes'] }, step('lanes', ['out/c'])];
    const loopImpl = { ...impl, rows: (t: Map<string, string>) => void t.set('out/b', `B(${t.get('out/a')},${t.get('out/c') ?? '-'})`), lanes: (t: Map<string, string>) => void t.set('out/c', t.get('out/b')!.length > 12 ? 'C' : 'c') };
    const f = fake(loopImpl, { 'src/a': '1' });
    expect(await regen(loop, {}, opts, f.io)).toMatchObject({ ok: true, passes: 3 });
    const g = fake(loopImpl, { 'src/a': '1' });
    const r = await regen(loop, {}, opts, g.io, 2);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no fixed point after 2 passes/);
    // A feedback loop that never settles hits the cap too.
    const grow = { a: (t: Map<string, string>) => void t.set('out/a', `A${t.get('out/b') ?? ''}`), b: (t: Map<string, string>) => void t.set('out/b', t.get('out/a')!) };
    const h = fake(grow, {});
    expect((await regen([{ ...step('a', ['out/a']), readsLater: ['b'] }, step('b', ['out/b'])], {}, opts, h.io)).error).toBe('no fixed point after 5 passes; the last pass changed out/a, out/b');
  });

  it('does not take a pass whose steps changed a file and then changed it back for a fixed point', async () => {
    const flip = { set: (t: Map<string, string>) => void t.set('out/x', 'set'), reset: (t: Map<string, string>) => void t.set('out/x', 'base') };
    const f = fake(flip, { 'out/x': 'base' });
    expect((await regen([step('set', ['out/x']), step('reset', ['out/x'])], {}, opts, f.io)).error).toBe('no fixed point after 5 passes; the last pass changed out/x');
  });

  it('never reruns a step for a change under NOT_READ', () => {
    const s = step('s', ['out/a']);
    const d = (p: string) => stepDigests([s], s, new Map([['src/a', '1'], [p, '2']]), {}).inputs;
    const none = stepDigests([s], s, new Map([['src/a', '1']]), {}).inputs;
    for (const p of ['docs/goals/x/state.yaml', 'AGENTS.md', 'packages/parity/test/regen.test.ts', 'scripts/regen.ts']) expect(d(p), p).toBe(none);
    expect(d('packages/parity/src/x.ts')).not.toBe(none);
  });

  it('fails a step that writes outside its declared outputs, and one that exits non-zero, keeping no cache entry for it', async () => {
    const f = fake({ gen: (t) => void t.set('src/a', 'edited') }, { 'src/a': '1' });
    const r = await regen([step('gen', ['out/a'])], {}, opts, f.io);
    expect(r).toMatchObject({ ok: false, error: 'gen changed files outside its declared outputs: src/a' });
    const cache: Cache = { fails: { inputs: 'x', outputs: 'y' } };
    const g = fake({}, {});
    const r2 = await regen([step('fails', ['out/a'])], cache, opts, g.io);
    expect(r2).toMatchObject({ ok: false, error: 'fails exited 3; the last lines of its output:\none\ntwo' });
    expect(cache.fails).toBeUndefined();
  });

  it('accepts a non-zero exit only when the step judges it a recorded verdict', async () => {
    const judge: Step = { ...step('judge', ['out/a']), verdict: (code, log) => code === 1 && log === 'all written\n' };
    expect(await regen([judge], {}, opts, fake({}, { 'src/a': 'verdict' }).io)).toMatchObject({ ok: true, error: null });
    expect((await regen([judge], {}, opts, fake({}, { 'src/a': 'other' }).io)).error).toBe('judge exited 1; the last lines of its output:\ncrashed\n');
  });

  it('reruns a step for a later step\'s outputs only when it names that step in readsLater, and refuses a bad name', async () => {
    // first reads nothing generated; last writes out/z from src/a on every source change.
    const make = (readsLater: string[]): Step[] => [{ ...step('first', ['out/a']), readsLater }, step('last', ['out/z'])];
    const impl2 = { first: (t: Map<string, string>) => void t.set('out/a', 'A'), last: (t: Map<string, string>) => void t.set('out/z', `Z${t.get('src/a')}`) };
    const f = fake(impl2, { 'src/a': '1' });
    await regen(make([]), {}, opts, f.io);
    expect(f.ran).toEqual(['first', 'last']);
    const g = fake(impl2, { 'src/a': '1' });
    await regen(make(['last']), {}, opts, g.io);
    expect(g.ran).toEqual(['first', 'last', 'first']);
    expect((await regen(make(['nope']), {}, opts, g.io)).error).toBe('step first is named twice or reads no later step nope');
    expect((await regen([step('a', ['x']), step('a', ['y'])], {}, opts, g.io)).error).toMatch(/step a is named twice/);
  });

  it('--force reruns cached steps, --from starts at a step and still ends on a full pass, an unknown step is refused', async () => {
    const f = fake(impl, { 'src/a': '1' });
    const cache: Cache = {};
    await regen(chain, cache, opts, f.io);
    const g = fake(impl, Object.fromEntries(f.t));
    expect(await regen(chain, cache, { ...opts, force: true }, g.io)).toMatchObject({ ok: true, ran: 2, passes: 1 });
    const h = fake(impl, Object.fromEntries(f.t));
    expect(await regen(chain, {}, { ...opts, from: 'rows' }, h.io)).toMatchObject({ ok: true, passes: 2 });
    expect(h.ran).toEqual(['rows', 'gen']);
    expect((await regen(chain, {}, { ...opts, from: 'nope' }, h.io)).error).toBe('unknown step nope; the steps are gen, rows');
  });

  it('keys a step on its command and environment, not on its own outputs or ignored paths', () => {
    const s: Step = { name: 's', argv: ['a'], outputs: ['out/**'], env: ['E'] };
    const later = step('later', ['other/x']);
    const d = (st: Step, tree: [string, string][], env: Record<string, string>) => stepDigests([st, later], st, new Map(tree), env);
    const base = d(s, [['src/a', '1'], ['out/o', '1'], ['other/x', '1']], { E: '1' });
    expect(d(s, [['src/a', '1'], ['out/o', '2'], ['other/x', '2']], { E: '1' }).inputs).toBe(base.inputs);
    expect(d(s, [['src/a', '1'], ['out/o', '2'], ['other/x', '1']], { E: '1' }).outputs).not.toBe(base.outputs);
    expect(d(s, [['src/a', '2'], ['out/o', '1'], ['other/x', '1']], { E: '1' }).inputs).not.toBe(base.inputs);
    expect(d(s, [['src/a', '1'], ['out/o', '1'], ['other/x', '1']], { E: '2' }).inputs).not.toBe(base.inputs);
    expect(d({ ...s, argv: ['b'] }, [['src/a', '1'], ['out/o', '1'], ['other/x', '1']], { E: '1' }).inputs).not.toBe(base.inputs);
    expect(d({ ...s, readsLater: ['later'] }, [['src/a', '1'], ['out/o', '1'], ['other/x', '2']], { E: '1' }).inputs).not.toBe(d({ ...s, readsLater: ['later'] }, [['src/a', '1'], ['out/o', '1'], ['other/x', '1']], { E: '1' }).inputs);
  });

  it('reads a malformed cache as empty and says why', () => {
    expect(parseCache(null)).toEqual({ cache: {}, problem: null });
    expect(parseCache('{')).toEqual({ cache: {}, problem: 'not JSON' });
    expect(parseCache('{"version":2,"steps":{}}')).toEqual({ cache: {}, problem: 'not a version 1 cache' });
    expect(parseCache('{"version":1,"steps":{"a":{"inputs":"x"}}}')).toEqual({ cache: {}, problem: 'step a has no digests' });
    expect(parseCache('{"version":1,"steps":{"a":{"inputs":"x","outputs":"y"}}}')).toEqual({ cache: { a: { inputs: 'x', outputs: 'y' } }, problem: null });
  });
});

describe('merge policy (.gitattributes)', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p !== '');
  const policy = new Set(execFileSync('git', ['ls-files', '-z', ':(attr:merge=dragon-generated)'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p !== ''));
  const lines = readFileSync(repoPath('.gitattributes'), 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const written = (p: string): boolean => STEPS.some((s) => s.outputs.some((g) => matches(g, p)));
  const byHand = (p: string): boolean => MERGE_BY_HAND.some((h) => matches(h.path, p));

  it('covers every tracked file a regen step writes, except the listed merge-by-hand files', () => {
    for (const s of STEPS) for (const g of s.outputs) expect(tracked.filter((p) => matches(g, p)), `${s.name} output ${g} matches no tracked file`).not.toEqual([]);
    expect(tracked.filter((p) => written(p) && !byHand(p) && !policy.has(p))).toEqual([]);
    for (const h of MERGE_BY_HAND) expect(tracked.filter((p) => matches(h.path, p) && written(p)), h.path).not.toEqual([]);
  });

  it('covers only files regen rebuilds and review skips, so it never hides a source conflict', () => {
    const ignore = parseIgnoreFile(readFileSync(repoPath('.macroscope/ignore.md'), 'utf8'));
    expect([...policy].filter((p) => !written(p) || byHand(p))).toEqual([]);
    expect([...policy].filter((p) => !ignore.matches(p))).toEqual([]);
  });

  it('lists exactly the regen steps\' outputs, one pattern per line, each matching a tracked file (a pattern without "/" only at the root)', () => {
    const outputs = STEPS.flatMap((s) => s.outputs).filter((o) => !MERGE_BY_HAND.some((h) => h.path === o));
    expect(lines).toEqual(outputs.map((o) => `${o} merge=dragon-generated`));
    for (const l of lines) {
      const m = /^(\S+) merge=dragon-generated$/.exec(l);
      expect(m, l).not.toBeNull();
      const hits = tracked.filter((p) => matches(m![1]!, p));
      expect(hits, `${l} matches no tracked file`).not.toEqual([]);
      if (!m![1]!.includes('/')) expect(hits.filter((p) => p.includes('/')), `${l} matches below the root`).toEqual([]);
    }
  });

  it('lists a producer for every tracked file under the generated shapes of .macroscope/ignore.md', () => {
    const text = readFileSync(repoPath('.macroscope/ignore.md'), 'utf8');
    const section = text.split('# === Dragon: generated or captured data')[1]!.split('# === Dragon: not code')[0]!;
    const shapes = parseIgnoreFile(section);
    const manual = (p: string): boolean => MANUAL.some((m) => m.outputs.some((g) => matches(g, p)));
    expect(tracked.filter((p) => shapes.matches(p) && !written(p) && !manual(p))).toEqual([]);
    for (const m of MANUAL) for (const g of m.outputs) expect(tracked.some((p) => matches(g, p)), `${m.command}: ${g}`).toBe(true);
  });
});

// The full chain takes many minutes and needs Chrome, Xcode and the Android SDK: DRAGON_REGEN_CHECK=1 runs it.
describe.runIf(process.env.DRAGON_REGEN_CHECK === '1')('pnpm regen --check on this tree', () => {
  const run = () => spawnSync('pnpm', ['-s', 'regen', '--check'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  it('is at a fixed point, and fails naming a planted stale output', () => {
    const clean = run();
    expect(clean.status, clean.stdout + clean.stderr).toBe(0);
    const file = 'packages/dragon/src/css/grammar.generated.ts';
    const original = readFileSync(repoPath(file), 'utf8');
    try {
      writeFileSync(repoPath(file), `${original}// stale\n`);
      const stale = run();
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain(`files were stale:\n${file}`);
    } finally {
      writeFileSync(repoPath(file), original);
    }
  }, 3_600_000);
});
