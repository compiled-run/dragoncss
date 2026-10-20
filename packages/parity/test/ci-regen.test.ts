// pnpm ci:regen (scripts/ci-regen.ts) against a fake gh: its arguments, the run-name, finding and reusing the run, the exit codes
// and the pushed-head check. Then regen-on-ci.yml's own shell, run locally with a stub gh: branch mode's head check, master's warm
// run still yielding to branch regens but never to patch-mode runs, and the push refusing a branch that moved.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMIT_SUBJECT, type Deps, EXIT, FIXED_STEP, findReusable, DEVICE_YIELD_S, main, parseArgs, parseCommits, parseRun, parseTitle, PLACEHOLDER, PUSH_STEP, pushedCommit, REGEN_BRANCH_SLOTS, type Run, runTitle, SLOT_POLL_S } from '../../../scripts/ci-regen.ts';
import { regenTitle } from '../../../scripts/land-devices-ci.ts';
import { MERGE_BY_HAND } from '../../../scripts/regen.ts';
import { repoPath } from '../src/paths.ts';

const REPO = 'o/r';
const BR = 'lane/x';
const HEAD = 'a'.repeat(40);
const NEW = 'c'.repeat(40);
const NONCE = '0123456789ab';
const URL = 'https://github.com/o/r/actions/runs/77';
const rawRun = (o: Partial<{ id: number; display_title: string; event: string; path: string; status: string; conclusion: string | null; html_url: string }> = {}) => ({ id: 77, display_title: runTitle(BR, HEAD, NONCE), event: 'workflow_dispatch', path: '.github/workflows/regen-on-ci.yml', status: 'completed', conclusion: 'success', html_url: URL, ...o });
const regenCommit = (o: { sha?: string; parent?: string; url?: string; base?: string; subject?: string } = {}) => ({ sha: o.sha ?? NEW, parents: [{ sha: o.parent ?? HEAD }], commit: { message: `${o.subject ?? COMMIT_SUBJECT}\n\nCommands: pnpm regen ...\nBase: ${o.base ?? HEAD}\nRun: ${o.url ?? URL}\n` } });
const pushJob = (pushed: boolean) => ({ id: 9, name: 'push', status: 'completed', conclusion: 'success', steps: [{ name: PUSH_STEP, status: 'completed', conclusion: 'success' }, { name: FIXED_STEP, status: 'completed', conclusion: pushed ? 'skipped' : 'success' }] });

/** A fake gh: the run moves through the given states, one per view. */
function fake(o: { states?: object[]; jobs?: object[]; commits?: object[]; head?: string; listed?: object[]; devices?: object[]; dispatchAnswer?: string; annotations?: object[] | 'fail' } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  let views = 0;
  let clock = 0;
  const states = o.states ?? [{}];
  const deps: Deps = {
    gh: (args) => {
      calls.push(args.join(' '));
      const path = args[1] === '-X' ? args[3] : args[1];
      if (args[2] === 'POST') return o.dispatchAnswer ?? JSON.stringify({ workflow_run_id: 77 });
      if (path === `repos/${REPO}/branches/${BR}`) return JSON.stringify({ name: BR, commit: { sha: o.head ?? HEAD } });
      // Like GitHub, a status= filter lists only the runs in that status.
      const only = (runs: object[]) => {
        const st = /[?&]status=([a-z_]+)/.exec(path ?? '')?.[1];
        return st === undefined ? runs : runs.filter((r) => (r as { status?: string }).status === st);
      };
      if (path?.startsWith(`repos/${REPO}/actions/workflows/regen-on-ci.yml/runs?`)) return JSON.stringify({ workflow_runs: only(o.listed ?? []) });
      if (path?.startsWith(`repos/${REPO}/actions/workflows/device-lanes.yml/runs?`)) return JSON.stringify({ workflow_runs: only(o.devices ?? []) });
      if (path === `repos/${REPO}/actions/runs/77`) return JSON.stringify(rawRun(states[Math.min(views++, states.length - 1)] as object));
      if (path === `repos/${REPO}/actions/runs/77/jobs?filter=latest&per_page=100`) return JSON.stringify({ jobs: o.jobs ?? [pushJob(false)] });
      if (path === `repos/${REPO}/commits?sha=${BR}&per_page=100`) return JSON.stringify(o.commits ?? []);
      if (path?.startsWith(`repos/${REPO}/check-runs/`)) {
        if (o.annotations === 'fail') throw new Error('HTTP 502');
        return JSON.stringify(o.annotations ?? []);
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    sleep: (ms) => void (clock += ms),
    now: () => clock,
    log: (l) => void logs.push(l),
    nonce: () => NONCE,
  };
  return { deps, calls, logs, run: (argv: string[]) => main(argv, deps, () => REPO) };
}

describe('pnpm ci:regen arguments and run-name', () => {
  it('takes one branch and --once, --run, --head and --from, and refuses the rest', () => {
    expect(parseArgs([BR])).toEqual({ branch: BR, head: null, from: 'master', runId: null, once: false });
    expect(parseArgs([BR, '--once', '--head', HEAD, '--from', 'x'])).toEqual({ branch: BR, head: HEAD, from: 'x', runId: null, once: true });
    expect(parseArgs([BR, '--run', '12', '--once'])).toMatchObject({ runId: 12, once: true });
    expect(() => parseArgs([])).toThrow('usage');
    expect(() => parseArgs([BR, 'other'])).toThrow('usage');
    expect(() => parseArgs(['master'])).toThrow('never pushes master');
    expect(() => parseArgs(['a..b'])).toThrow('not a branch name');
    expect(() => parseArgs(['-x'])).toThrow('unknown option');
    expect(() => parseArgs([BR, '--run'])).toThrow('--run needs a value');
    expect(() => parseArgs([BR, '--run', '1x'])).toThrow('not a run id');
    expect(() => parseArgs([BR, '--run', '1', '--from', 'y'])).toThrow('--run takes no --from');
    expect(() => parseArgs([BR, '--head', HEAD.slice(0, 12)])).toThrow('not a full commit sha');
    expect(() => parseArgs([BR, '--head', HEAD, '--head', HEAD])).toThrow('given twice');
  });
  it('names the branch, the full head and the nonce, and parses only branch-mode run-names', () => {
    expect(runTitle(BR, HEAD, NONCE)).toBe(`regen of branch ${BR} at ${HEAD} (${NONCE})`);
    expect(parseTitle(runTitle(BR, HEAD, NONCE))).toEqual({ branch: BR, head: HEAD, nonce: NONCE });
    for (const t of [regenTitle(HEAD), `regen of branch ${BR} at its head (${NONCE})`, `regen of branch ${BR} at ${HEAD} (no nonce)`, `regen of branch ${BR} at ${HEAD.slice(0, 12)} (${NONCE})`, 'Some PR title', 'regen-on-ci', `${runTitle(BR, HEAD, NONCE)} `]) expect(parseTitle(t), t).toBeNull();
  });
  it('reads runs and commits strictly', () => {
    expect(parseRun(JSON.stringify(rawRun())).title).toBe(runTitle(BR, HEAD, NONCE));
    expect(() => parseRun(JSON.stringify({ ...rawRun(), id: '77' }))).toThrow('unexpected workflow run');
    expect(() => parseRun('<html>')).toThrow('unexpected workflow run');
    expect(parseCommits(JSON.stringify([regenCommit()]))).toEqual([{ sha: NEW, parents: [HEAD], message: expect.stringContaining(`Run: ${URL}`) }]);
    expect(() => parseCommits(JSON.stringify([{ ...regenCommit(), parents: [{ sha: 'x' }] }]))).toThrow('unexpected commit');
    expect(() => parseCommits('{}')).toThrow('unexpected commit list');
  });
});

describe('pnpm ci:regen finding the run', () => {
  it('dispatches over REST with the branch, its head and a nonce from master, and takes the run from the answer', () => {
    const f = fake({ states: [{ status: 'queued', conclusion: null }] });
    expect(f.run([BR, '--once'])).toBe(EXIT.pending);
    expect(f.calls).toContain(`api -X POST repos/${REPO}/actions/workflows/regen-on-ci.yml/dispatches -f ref=master -f inputs[branch]=${BR} -f inputs[head]=${HEAD} -f inputs[nonce]=${NONCE} -F return_run_details=true`);
    expect(f.logs.at(-1)).toBe(`PENDING (queued) ${URL}: regen of ${BR} at ${HEAD}; poll again with: pnpm ci:regen ${BR} --run 77 --once`);
  });
  it('finds the run by its exact run-name when the answer has no run id, never another nonce or head of the branch', () => {
    const others = [rawRun({ id: 5, display_title: runTitle(BR, HEAD, 'ffffffffffff'), conclusion: 'failure' }), rawRun({ id: 6, display_title: runTitle(BR, NEW, NONCE) })];
    let lists = 0;
    const f = fake({ dispatchAnswer: '', states: [{ status: 'in_progress', conclusion: null }] });
    const gh = f.deps.gh;
    const deps: Deps = { ...f.deps, gh: (a) => (a[1]?.includes('/runs?status=') ? JSON.stringify({ workflow_runs: [] }) : a[1]?.includes('regen-on-ci.yml/runs?') ? JSON.stringify({ workflow_runs: ++lists > 2 ? [rawRun({ status: 'queued', conclusion: null }), ...others] : others }) : gh(a)) };
    expect(main([BR, '--once'], deps, () => REPO)).toBe(EXIT.pending);
    expect(f.logs).toContain(`dispatched regen-on-ci.yml from master for ${BR} at ${HEAD} (${NONCE}): run 77`);
    // The first list is the reuse check (the slot check's lists, by status, find nothing running); the dispatch's own lookup waits until its run-name appears.
    expect(lists).toBe(3);
  });
  it('reuses the newest run of this branch and head while it runs or after it succeeded, and dispatches again after a failure', () => {
    const r = (o: Partial<Run> & { title: string }): Run => ({ id: 1, event: 'workflow_dispatch', path: '.github/workflows/regen-on-ci.yml', status: 'completed', conclusion: 'success', url: 'u', ...o });
    const mine = runTitle(BR, HEAD, NONCE);
    expect(findReusable([r({ id: 1, title: runTitle(BR, NEW, NONCE) }), r({ id: 2, title: mine, status: 'in_progress', conclusion: null })], BR, HEAD)?.id).toBe(2);
    expect(findReusable([r({ id: 3, title: mine })], BR, HEAD)?.id).toBe(3);
    expect(findReusable([r({ id: 4, title: mine, conclusion: 'failure' }), r({ id: 3, title: mine })], BR, HEAD)).toBeNull();
    expect(findReusable([r({ id: 5, title: runTitle('lane/y', HEAD, NONCE) }), r({ id: 6, title: regenTitle(HEAD) })], BR, HEAD)).toBeNull();
    const f = fake({ listed: [rawRun({ status: 'in_progress', conclusion: null })], states: [{ status: 'in_progress', conclusion: null }] });
    expect(f.run([BR, '--once'])).toBe(EXIT.pending);
    expect(f.calls.some((c) => c.includes('POST'))).toBe(false);
    expect(f.logs[0]).toBe(`run 77 already regenerates ${BR} at ${HEAD}: ${URL}`);
  });
  it('refuses a branch not at --head, and a run that is not a branch regen of this branch (and head and nonce), as errors', () => {
    const moved = fake({ head: NEW });
    expect(moved.run([BR, '--head', HEAD])).toBe(EXIT.error);
    expect(moved.logs.at(-1)).toBe(`ERROR ${BR} is at ${NEW}, not --head ${HEAD}; push it first`);
    expect(moved.calls.some((c) => c.includes('POST'))).toBe(false);
    for (const [state, msg] of [
      [{ display_title: runTitle('lane/y', HEAD, NONCE) }, `regenerates lane/y at ${HEAD}`],
      [{ display_title: runTitle(BR, HEAD, 'ffffffffffff') }, 'not lane/x at'],
      [{ display_title: regenTitle(HEAD) }, 'is not a branch regen'],
      [{ event: 'push' }, 'not a dispatched regen-on-ci.yml run'],
      [{ path: '.github/workflows/test-files.yml' }, 'not a dispatched regen-on-ci.yml run'],
    ] as const) {
      const f = fake({ states: [state] });
      expect(f.run([BR]), msg).toBe(EXIT.error);
      expect(f.logs.at(-1)).toContain(msg);
    }
    // The same --head command finds its run after the run's regen commit moved the branch on, and dispatches nothing.
    const after = fake({ head: NEW, listed: [rawRun()], jobs: [pushJob(true)], commits: [regenCommit()] });
    expect(after.run([BR, '--head', HEAD, '--once'])).toBe(EXIT.done);
    expect(after.logs.at(-1)).toBe(`regen commit ${NEW}`);
    expect(after.calls.some((c) => c.includes('POST') || c.includes('/branches/'))).toBe(false);
    const other = fake();
    expect(other.run([BR, '--run', '77', '--head', NEW])).toBe(EXIT.error);
    expect(other.logs.at(-1)).toContain(`not ${BR} at ${NEW}`);
  });
});

describe('pnpm ci:regen waiting for a slot before it dispatches', () => {
  const other = (id: number, o: object = {}) => rawRun({ id, display_title: runTitle(`lane/o${id}`, NEW, NONCE), status: 'in_progress', conclusion: null, ...o });
  const posted = (calls: string[]) => calls.some((c) => c.includes('/dispatches'));
  const deviceRun = rawRun({ id: 3, path: '.github/workflows/device-lanes.yml', display_title: 'device lanes', status: 'in_progress', conclusion: null });
  it('dispatches at once when no device lanes run and a branch slot is free', () => {
    const f = fake({ listed: [other(1), other(2), other(3, { status: 'completed', conclusion: 'success' })], states: [{ status: 'queued', conclusion: null }] });
    expect(f.run([BR, '--once'])).toBe(EXIT.pending);
    expect(posted(f.calls)).toBe(true);
    expect(f.logs.some((l) => l.startsWith('waiting to dispatch'))).toBe(false);
  });
  it('with --once does not dispatch while every slot is taken, and says to poll again', () => {
    const f = fake({ listed: [other(1), other(2), other(3, { status: 'queued' })] });
    expect(f.run([BR, '--once'])).toBe(EXIT.pending);
    expect(posted(f.calls)).toBe(false);
    expect(f.logs.at(-1)).toBe(`PENDING (not dispatched): 3 branch regens are queued or running (${REGEN_BRANCH_SLOTS} at once); run the same command again (it dispatches anyway ${DEVICE_YIELD_S / 60} minutes after the first wait)`);
  });
  it('waits while a device lanes run is queued or running, then dispatches', () => {
    const f = fake({ devices: [deviceRun], states: [{ status: 'queued', conclusion: null }] });
    let polls = 0;
    const gh = f.deps.gh;
    const deps: Deps = { ...f.deps, gh: (a) => (a[1]?.includes('/runs?') && ++polls > 18 ? JSON.stringify({ workflow_runs: [] }) : gh(a)) };
    expect(main([BR, '--once'], { ...deps }, () => REPO)).toBe(EXIT.pending);
    expect(posted(f.calls)).toBe(false);
    expect(main([BR], deps, () => REPO)).not.toBe(EXIT.error);
    expect(f.logs).toContain('waiting to dispatch: 1 device lanes run(s) are queued or running');
    expect(posted(f.calls)).toBe(true);
    expect(f.deps.now()).toBeGreaterThanOrEqual(SLOT_POLL_S * 1000);
  });
  it('dispatches at once beside the landing\'s regens (a label run, a patch-mode regen) while a slot is free', () => {
    for (const run of [rawRun({ id: 3, event: 'pull_request', display_title: 'Land #1', status: 'in_progress', conclusion: null }), rawRun({ id: 3, display_title: `regen of ${NEW}`, status: 'queued', conclusion: null })]) {
      const f = fake({ listed: [run, other(4), other(5)], states: [{ status: 'queued', conclusion: null }] });
      expect(f.run([BR, '--once'])).toBe(EXIT.pending);
      expect(posted(f.calls)).toBe(true);
      expect(f.logs.some((l) => l.startsWith('waiting to dispatch') || l.startsWith('PENDING (not dispatched)'))).toBe(false);
    }
  });
  it('stops waiting for device lanes after DEVICE_YIELD_S and dispatches; the run waits for its slot itself', () => {
    const f = fake({ devices: [deviceRun], states: [{ status: 'completed', conclusion: 'success' }] });
    f.run([BR]);
    expect(posted(f.calls)).toBe(true);
    expect(f.deps.now()).toBeGreaterThanOrEqual(DEVICE_YIELD_S * 1000);
  });
  it('with --once dispatches anyway once DEVICE_YIELD_S has passed since the first wait for this head', () => {
    const f = fake({ devices: [deviceRun], states: [{ status: 'queued', conclusion: null }] });
    const first = new Map<string, number>();
    const since = (k: string) => first.get(k) ?? (first.set(k, f.deps.now()), f.deps.now());
    const forget = (k: string) => void first.delete(k);
    expect(main([BR, '--once'], { ...f.deps, since, forget }, () => REPO)).toBe(EXIT.pending);
    expect(posted(f.calls)).toBe(false);
    expect([...first.keys()]).toEqual([`${BR}@${HEAD}`]);
    f.deps.sleep(DEVICE_YIELD_S * 1000);
    expect(main([BR, '--once'], { ...f.deps, since, forget }, () => REPO)).toBe(EXIT.pending);
    expect(posted(f.calls)).toBe(true);
    expect([...first.keys()]).toEqual([]);
  });
  it('starts the shared wait only at a busy poll, and forgets it once the dispatch goes', () => {
    const recorded: string[] = [];
    const free = fake({ states: [{ status: 'queued', conclusion: null }] });
    expect(main([BR, '--once'], { ...free.deps, since: (k) => (recorded.push(k), 0), forget: (k) => void recorded.push(`forget ${k}`) }, () => REPO)).toBe(EXIT.pending);
    expect(posted(free.calls)).toBe(true);
    expect(recorded).toEqual([]);
  });
  it('after waiting, reads the branch head again and reuses a run another invocation dispatched meanwhile', () => {
    const f = fake({ head: NEW, states: [{ status: 'queued', conclusion: null }] });
    let polls = 0;
    let heads = 0;
    const gh = f.deps.gh;
    const busy = [other(1), other(2), other(3)];
    const deps: Deps = {
      ...f.deps,
      gh: (a) => {
        if (a[1] === `repos/${REPO}/branches/${BR}`) return JSON.stringify({ name: BR, commit: { sha: ++heads > 1 ? NEW : HEAD } });
        if (a[1]?.includes('regen-on-ci.yml/runs?')) return JSON.stringify({ workflow_runs: ++polls === 1 ? [] : polls <= 5 ? busy : [rawRun({ id: 78, display_title: runTitle(BR, NEW, 'ffffffffffff'), status: 'in_progress', conclusion: null })] });
        return gh(a);
      },
    };
    main([BR], deps, () => REPO);
    expect(heads).toBe(2);
    expect(posted(f.calls)).toBe(false);
    expect(f.logs).toContain(`run 78 already regenerates ${BR} at ${NEW}: ${URL}`);
  });
  it('dispatches when listing the runs fails', () => {
    const f = fake({ states: [{ status: 'queued', conclusion: null }] });
    const gh = f.deps.gh;
    const deps: Deps = { ...f.deps, gh: (a) => (a[1]?.includes('device-lanes.yml') ? (() => { throw new Error('HTTP 502'); })() : gh(a)) };
    expect(main([BR, '--once'], deps, () => REPO)).toBe(EXIT.pending);
    expect(posted(f.calls)).toBe(true);
    expect(f.logs[0]).toMatch(/^listing the queued and running regens failed \(HTTP 502\); dispatching/);
  });
  it('uses regen-on-ci.yml\'s own slot count and device lanes yield', () => {
    const yml = readFileSync(repoPath('.github/workflows/regen-on-ci.yml'), 'utf8');
    expect(REGEN_BRANCH_SLOTS).toBe(3);
    expect(yml).toContain(`REGEN_BRANCH_SLOTS: '${REGEN_BRANCH_SLOTS}'`);
    expect(yml).toContain(`DEVICE_YIELD_SECONDS: '${DEVICE_YIELD_S}'`);
  });
});

describe('pnpm ci:regen verdicts', () => {
  it('exits 0 at a fixed point, printing the head it regenerated', () => {
    const f = fake({ jobs: [pushJob(false)] });
    expect(f.run([BR, '--run', '77'])).toBe(EXIT.done);
    expect(f.logs).toEqual([`DONE ${BR} at ${HEAD} is already at a fixed point; no commit (${URL})`, `head ${HEAD}`]);
  });
  it('exits 0 for a pushed regen commit on top of the expected head, printing its sha', () => {
    const f = fake({ jobs: [pushJob(true)], commits: [{ ...regenCommit({ sha: 'd'.repeat(40), parent: NEW, url: 'https://github.com/o/r/actions/runs/70' }) }, regenCommit(), { sha: HEAD, parents: [], commit: { message: 'src' } }] });
    expect(f.run([BR, '--run', '77', '--once'])).toBe(EXIT.done);
    expect(f.logs.at(-1)).toBe(`regen commit ${NEW}`);
  });
  it('refuses a pushed commit that is not the run\'s regen commit on top of the expected head', () => {
    expect(pushedCommit(parseCommits(JSON.stringify([regenCommit()])), URL, HEAD, BR)).toBe(NEW);
    const bad = (commits: object[], msg: string) => {
      expect(() => pushedCommit(parseCommits(JSON.stringify(commits)), URL, HEAD, BR)).toThrow(msg);
      const f = fake({ jobs: [pushJob(true)], commits });
      expect(f.run([BR, '--run', '77'])).toBe(EXIT.error);
      expect(f.logs.at(-1)).toContain(msg);
    };
    bad([], `no commits among the newest 0 of ${BR} name the run`);
    bad([regenCommit({ url: `${URL}0` })], 'no commits');
    bad([regenCommit(), regenCommit({ sha: 'e'.repeat(40) })], '2 commits');
    bad([regenCommit({ parent: NEW })], `is not a regen commit on top of ${HEAD}`);
    bad([regenCommit({ base: NEW })], 'is not a regen commit');
    bad([regenCommit({ subject: 'hand edit' })], 'is not a regen commit');
    bad([{ ...regenCommit(), parents: [{ sha: HEAD }, { sha: NEW }] }], 'is not a regen commit');
  });
  it('refuses a successful run whose push job is missing or says neither pushed nor fixed point', () => {
    for (const jobs of [[], [{ ...pushJob(false), conclusion: 'skipped' }], [{ ...pushJob(false), steps: [] }], [{ ...pushJob(false), steps: [{ name: PUSH_STEP, status: 'completed', conclusion: 'success' }, { name: FIXED_STEP, status: 'completed', conclusion: 'failure' }] }]]) {
      const f = fake({ jobs });
      expect(f.run([BR, '--run', '77'])).toBe(EXIT.error);
      expect(f.logs.at(-1)).toMatch(/^ERROR the run .* succeeded but its push job/);
    }
  });
  it('exits 1 for a failed run, naming the failing step and its error', () => {
    const jobs = [{ id: 3, name: 'resolve', status: 'completed', conclusion: 'failure', steps: [{ name: 'Set up job', status: 'completed', conclusion: 'success' }, { name: 'Resolve and refuse unsafe branches', status: 'completed', conclusion: 'failure' }] }];
    const f = fake({ states: [{ conclusion: 'failure' }], jobs, annotations: [{ annotation_level: 'failure', message: `${BR} is at ${NEW}, not the dispatched head ${HEAD}; dispatch again` }, { annotation_level: 'warning', message: 'node 20' }] });
    expect(f.run([BR, '--run', '77'])).toBe(EXIT.failed);
    expect(f.logs).toEqual(['failed job resolve: failure at Resolve and refuse unsafe branches', `  resolve: ${BR} is at ${NEW}, not the dispatched head ${HEAD}; dispatch again`, `FAILED (failure) ${URL}: regen of ${BR} at ${HEAD}`]);
    const noNotes = fake({ states: [{ conclusion: 'timed_out' }], jobs, annotations: 'fail' });
    expect(noNotes.run([BR, '--run', '77'])).toBe(EXIT.failed);
    expect(noNotes.logs[1]).toContain('resolve: no annotations (HTTP 502)');
  });
  it('reports a cancelled run, a gh error and a usage error as 2', () => {
    const c = fake({ states: [{ conclusion: 'cancelled' }] });
    expect(c.run([BR, '--run', '77'])).toBe(EXIT.error);
    expect(c.logs.at(-1)).toMatch(/^CANCELLED /);
    const f = fake();
    const deps: Deps = { ...f.deps, gh: () => { throw new Error('gh api failed: HTTP 403'); } };
    expect(main([BR], deps, () => REPO)).toBe(EXIT.error);
    expect(f.logs.at(-1)).toBe('ERROR gh api failed: HTTP 403');
    expect(f.run(['--bogus'])).toBe(EXIT.error);
  });
  it('waits for the run-name GitHub fills in after the dispatch, then judges the run; a run that never gets one is pending, then refused', () => {
    const named = fake({ states: [{ display_title: PLACEHOLDER, status: 'queued', conclusion: null }, { display_title: PLACEHOLDER, status: 'queued', conclusion: null }, { status: 'queued', conclusion: null }] });
    expect(named.run([BR, '--once'])).toBe(EXIT.pending);
    expect(named.logs.at(-1)).toMatch(/^PENDING \(queued\) .*: regen of lane\/x at a{40}; poll again/);
    const never = fake({ states: [{ display_title: PLACEHOLDER, status: 'queued', conclusion: null }] });
    expect(never.run([BR, '--once'])).toBe(EXIT.pending);
    expect(never.logs.at(-1)).toBe(`PENDING (queued) ${URL}: no run-name yet; poll again with: pnpm ci:regen ${BR} --run 77 --once`);
    const done = fake({ states: [{ display_title: PLACEHOLDER }] });
    expect(done.run([BR, '--run', '77'])).toBe(EXIT.error);
    expect(done.logs.at(-1)).toContain('is not a branch regen dispatched with a head and a nonce');
  });
  it('waits without --once until the run completes', () => {
    const f = fake({ states: [{ status: 'queued', conclusion: null }, { status: 'in_progress', conclusion: null }, {}] });
    expect(f.run([BR, '--run', '77'])).toBe(EXIT.done);
  });
});

// regen-on-ci.yml's shell steps, run as GitHub runs them: the block scalar with its indentation removed, under bash -e.
const yml = readFileSync(repoPath('.github/workflows/regen-on-ci.yml'), 'utf8');
const roundYml = readFileSync(repoPath('.github/workflows/regen-on-ci-round.yml'), 'utf8');
function stepScript(name: string, text: string = yml): string {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  expect(at, name).toBeGreaterThan(0);
  const run = lines.findIndex((l, i) => i > at && l.trim() === 'run: |');
  const indent = (lines[run] as string).indexOf('run:') + 2;
  const body: string[] = [];
  for (const l of lines.slice(run + 1)) {
    if (l.trim() !== '' && l.length - l.trimStart().length < indent) break;
    body.push(l.slice(indent));
  }
  const s = body.join('\n');
  expect(s).not.toContain('${{');
  return s;
}

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmpDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ci-regen-test-'));
  tmp.push(d);
  return d;
};

/** Runs a step with a stub gh in PATH; GITHUB_OUTPUT and the summary are files in the scratch dir. */
function runStep(script: string, env: Record<string, string>, ghStub: string, cwd?: string) {
  const d = tmpDir();
  mkdirSync(join(d, 'bin'));
  writeFileSync(join(d, 'bin', 'gh'), `#!/usr/bin/env bash\n${ghStub}\n`);
  chmodSync(join(d, 'bin', 'gh'), 0o755);
  writeFileSync(join(d, 'out'), '');
  writeFileSync(join(d, 'summary'), '');
  const r = spawnSync('bash', ['-e', '-c', script], { cwd: cwd ?? d, encoding: 'utf8', env: { ...process.env, PATH: `${join(d, 'bin')}:${process.env['PATH']}`, GITHUB_OUTPUT: join(d, 'out'), GITHUB_STEP_SUMMARY: join(d, 'summary'), RUNNER_TEMP: d, GITHUB_REPOSITORY: REPO, REPO, GH_TOKEN: 'x', ...env } });
  const out = Object.fromEntries(readFileSync(join(d, 'out'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2) as [string, string]));
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, out, dir: d };
}

describe('regen-on-ci.yml branch mode, warm run and push, run locally', () => {
  const resolve = stepScript('Resolve and refuse unsafe branches');
  // The stub answers the warm run's status queries (queued: the given runs; other statuses: none) through jq, as gh -q does.
  const resolveGh = (runs: object[], head = HEAD) => `
case "$2" in
  repos/${REPO}) body='{"default_branch":"master"}' ;;
  repos/${REPO}/branches/*) body='{"protected":false,"commit":{"sha":"${head}"}}' ;;
  *status=queued*) body='${JSON.stringify({ workflow_runs: runs })}' ;;
  *status=*) body='{"workflow_runs":[]}' ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\n' "$body"; fi`;
  it('branch mode records the head it regenerates and refuses a branch not at the dispatched head, or a bad head or nonce', () => {
    const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_BRANCH: BR, DISPATCH_SHA: '', DISPATCH_HEAD: HEAD, DISPATCH_NONCE: NONCE, PR_BRANCH: '', PR_REPO: '', PR_SHA: '' };
    expect(runStep(resolve, env, resolveGh([])).out).toEqual({ branch: BR, sha: HEAD, mode: 'push' });
    const moved = runStep(resolve, env, resolveGh([], NEW));
    expect(moved.status).toBe(1);
    expect(moved.stdout).toContain(`::error::${BR} is at ${NEW}, not the dispatched head ${HEAD}; dispatch again`);
    expect(moved.out).toEqual({});
    // A dispatch without a head (by hand) regenerates whatever the branch is at, as before.
    expect(runStep(resolve, { ...env, DISPATCH_HEAD: '' }, resolveGh([], NEW)).out).toEqual({ branch: BR, sha: NEW, mode: 'push' });
    expect(runStep(resolve, { ...env, DISPATCH_HEAD: HEAD.slice(0, 12) }, resolveGh([])).stdout).toContain('::error::head is not a full commit sha');
    expect(runStep(resolve, { ...env, DISPATCH_NONCE: 'a b)' }, resolveGh([])).stdout).toContain('::error::nonce may hold only');
    // Patch mode and the label path resolve as before.
    expect(runStep(resolve, { ...env, DISPATCH_BRANCH: '', DISPATCH_SHA: HEAD, DISPATCH_HEAD: '' }, resolveGh([])).out).toEqual({ branch: '', sha: HEAD, mode: 'patch' });
    const label = { ...env, GITHUB_EVENT_NAME: 'pull_request', DISPATCH_BRANCH: '', DISPATCH_HEAD: '', DISPATCH_NONCE: '', PR_BRANCH: BR, PR_REPO: REPO, PR_SHA: HEAD };
    expect(runStep(resolve, label, resolveGh([])).out).toEqual({ branch: BR, sha: HEAD, mode: 'push' });
    expect(runStep(resolve, label, resolveGh([], NEW)).stdout).toContain(`moved from the labelled head ${HEAD} to ${NEW}`);
  });
  it('a worker\'s branch regen waits, oldest first, while two older branch regens are queued or running', () => {
    const gate = stepScript('Wait for a branch regen slot');
    const d = tmpDir();
    const run = (id: number, created_at: string, event = 'workflow_dispatch', display_title = runTitle(BR, HEAD, NONCE)) => ({ id, created_at, event, display_title });
    const older = [run(1, '2026-10-14T02:00:00Z'), run(2, '2026-10-14T02:05:00Z'), run(3, '2026-10-14T02:10:00Z', 'pull_request', 'Landing batch'), run(4, '2026-10-14T02:10:00Z', 'workflow_dispatch', regenTitle(HEAD))];
    const newer = [run(9, '2026-10-14T02:30:00Z'), run(7, '2026-10-14T02:20:00Z')];
    // Calls 1-4 (one per status) see both older branch regens running; from call 5 on, run 1 has finished.
    const stub = (runs: object[], later: object[]) => `
n=$(( $(cat ${d}/calls 2>/dev/null || echo 0) + 1 )); echo $n > ${d}/calls
case "$2" in
  repos/${REPO}/actions/runs/7) body='{"created_at":"2026-10-14T02:20:00Z"}' ;;
  *device-lanes.yml*) body='{"workflow_runs":[]}' ;;
  *status=in_progress*) if [ $n -le 9 ]; then body='${JSON.stringify({ workflow_runs: runs })}'; else body='${JSON.stringify({ workflow_runs: later })}'; fi ;;
  *status=*) body='{"workflow_runs":[]}' ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\n' "$body"; fi`;
    // The landing's own regens (runs 3 and 4: a label run, patch mode) never hold it back, only the slots do.
    const env = { GITHUB_RUN_ID: '7', REGEN_BRANCH_SLOTS: '2', DEVICE_YIELD_SECONDS: '5400', POLL_SECONDS: '0' };
    const waits = runStep(gate, env, stub([...older, ...newer], [older[1]!, older[2]!, older[3]!, ...newer]));
    expect(waits.status, waits.stderr).toBe(0);
    expect(waits.stdout).toContain('2 older branch regens are queued or running; waiting for one of 2 slots');
    expect(waits.stdout).not.toContain('device lanes run');
    expect(readFileSync(join(d, 'calls'), 'utf8').trim()).toBe('17');
    rmSync(join(d, 'calls'));
    // Newer branch regens never hold it back.
    const free = runStep(gate, env, stub([older[1]!, older[2]!, older[3]!, ...newer], []));
    expect(free.status, free.stderr).toBe(0);
    expect(free.stdout).not.toContain('waiting for one');
    expect(readFileSync(join(d, 'calls'), 'utf8').trim()).toBe('9');
    rmSync(join(d, 'calls'));
    // While a device lanes run is queued or running, a free slot waits too, until it ends; a label run or a patch-mode regen does not hold it.
    const landingStub = (regen: object[], devices: object[]) => `
n=$(( $(cat ${d}/calls 2>/dev/null || echo 0) + 1 )); echo $n > ${d}/calls
case "$2" in
  repos/${REPO}/actions/runs/7) body='{"created_at":"2026-10-14T02:20:00Z"}' ;;
  *device-lanes.yml*status=queued*) if [ $n -le 9 ]; then body='${JSON.stringify({ workflow_runs: devices })}'; else body='{"workflow_runs":[]}'; fi ;;
  *device-lanes.yml*) body='{"workflow_runs":[]}' ;;
  *status=in_progress*) if [ $n -le 9 ]; then body='${JSON.stringify({ workflow_runs: regen })}'; else body='{"workflow_runs":[]}'; fi ;;
  *status=*) body='{"workflow_runs":[]}' ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\n' "$body"; fi`;
    const held = runStep(gate, env, landingStub(newer, [{ id: 50, event: 'workflow_dispatch', display_title: `device lanes of ${HEAD}` }]));
    expect(held.status, held.stderr).toBe(0);
    expect(held.stdout).toContain('1 device lanes run(s) are queued or running; waiting until they end (at most 5400 s)');
    expect(held.stdout).not.toContain('waiting for one');
    expect(readFileSync(join(d, 'calls'), 'utf8').trim()).toBe('17');
    rmSync(join(d, 'calls'));
    for (const regen of [older[2]!, older[3]!]) {
      const beside = runStep(gate, env, landingStub([regen, ...newer], []));
      expect(beside.status, beside.stderr).toBe(0);
      expect(beside.stdout).not.toContain('waiting until they end');
      expect(beside.stdout).toContain('started after waiting 0 s');
      expect(readFileSync(join(d, 'calls'), 'utf8').trim()).toBe('9');
      rmSync(join(d, 'calls'));
    }
    // Past DEVICE_YIELD_SECONDS it stops yielding to device lanes and takes the free slot.
    const always = `
case "$2" in
  repos/${REPO}/actions/runs/7) body='{"created_at":"2026-10-14T02:20:00Z"}' ;;
  *device-lanes.yml*status=in_progress*) body='${JSON.stringify({ workflow_runs: [{ id: 50 }, { id: 51 }] })}' ;;
  *device-lanes.yml*) body='{"workflow_runs":[]}' ;;
  *status=in_progress*) body='${JSON.stringify({ workflow_runs: [older[2]!, older[3]!] })}' ;;
  *status=*) body='{"workflow_runs":[]}' ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\n' "$body"; fi`;
    const capped = runStep(gate, { ...env, DEVICE_YIELD_SECONDS: '1', POLL_SECONDS: '1' }, always);
    expect(capped.status, capped.stderr).toBe(0);
    expect(capped.stdout).toContain('2 device lanes run(s) are queued or running; waiting until they end (at most 1 s)');
    expect(capped.stdout).toContain('started after waiting 1 s');
    // A failed list (a rate limit) waits a poll instead of failing the run.
    const limited = runStep(gate, env, `
n=$(( $(cat ${d}/calls 2>/dev/null || echo 0) + 1 )); echo $n > ${d}/calls
case "$2" in
  repos/${REPO}/actions/runs/7) body='{"created_at":"2026-10-14T02:20:00Z"}' ;;
  *device-lanes.yml*) if [ $n -le 3 ]; then echo '{"message":"API rate limit exceeded"}'; exit 1; fi; body='{"workflow_runs":[]}' ;;
  *status=*) body='{"workflow_runs":[]}' ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\n' "$body"; fi`);
    expect(limited.status, limited.stderr).toBe(0);
    expect(limited.stdout).toContain('listing the queued and running runs failed; trying again in 0 s');
    expect(readFileSync(join(d, 'calls'), 'utf8').trim()).toBe('11');
    rmSync(join(d, 'calls'));
    // A branch that moved off its dispatched head stops at once instead of waiting for a slot it would only be refused in.
    const branchAt = (sha: string) => `
case "$2" in
  repos/${REPO}/actions/runs/7) body='{"created_at":"2026-10-14T02:20:00Z"}' ;;
  repos/${REPO}/branches/${BR}) body='{"commit":{"sha":"${sha}"}}' ;;
  *status=*) body='${JSON.stringify({ workflow_runs: [...older, ...newer] })}' ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\n' "$body"; fi`;
    const moved = runStep(gate, { ...env, DISPATCH_BRANCH: BR, DISPATCH_HEAD: HEAD }, branchAt(NEW));
    expect(moved.status).toBe(1);
    expect(moved.stdout).toContain(`${BR} moved from the dispatched head ${HEAD} to ${NEW} while waiting for a slot; dispatch again`);
    // Still at its head, or a failed lookup (gh prints the error body and exits 1): it keeps waiting, then takes the freed slot.
    const lookup = (branch: string) => `
n=$(( $(cat ${d}/calls 2>/dev/null || echo 0) + 1 )); echo $n > ${d}/calls
case "$2" in
  repos/${REPO}/actions/runs/7) body='{"created_at":"2026-10-14T02:20:00Z"}' ;;
  repos/${REPO}/branches/${BR}) ${branch} ;;
  *device-lanes.yml*) body='{"workflow_runs":[]}' ;;
  *status=in_progress*) if [ $n -le 6 ]; then body='${JSON.stringify({ workflow_runs: [...older, ...newer] })}'; else body='${JSON.stringify({ workflow_runs: newer })}'; fi ;;
  *status=*) body='{"workflow_runs":[]}' ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\n' "$body"; fi`;
    for (const branch of [`body='{"commit":{"sha":"${HEAD}"}}'`, `echo '{"message":"Server Error","status":"502"}'; exit 1`]) {
      const stays = runStep(gate, { ...env, DISPATCH_BRANCH: BR, DISPATCH_HEAD: HEAD }, lookup(branch));
      expect(stays.status, stays.stderr).toBe(0);
      expect(stays.stdout).toContain('waiting for one of 2 slots');
      expect(stays.stdout).not.toContain('moved');
      rmSync(join(d, 'calls'));
    }
  });
  it('master\'s warm run yields to branch regens (dispatched or labelled) but never to the driver\'s patch-mode runs (#220)', () => {
    const warm = (runs: object[]) => runStep(resolve, { GITHUB_EVENT_NAME: 'push', GITHUB_SHA: HEAD, DISPATCH_BRANCH: '', DISPATCH_SHA: '', DISPATCH_HEAD: '', DISPATCH_NONCE: '', PR_BRANCH: '', PR_REPO: '', PR_SHA: '' }, resolveGh(runs)).out['mode'];
    const run = (event: string, display_title: string | null) => ({ event, display_title });
    expect(warm([])).toBe('warm');
    expect(warm([run('workflow_dispatch', regenTitle(HEAD)), run('workflow_dispatch', regenTitle(NEW)), run('push', 'Merge pull request #1')])).toBe('warm');
    expect(warm([run('workflow_dispatch', regenTitle(HEAD)), run('workflow_dispatch', runTitle(BR, HEAD, NONCE))])).toBe('skip');
    expect(warm([run('pull_request', 'Some PR')])).toBe('skip');
    expect(warm([run('pull_request', regenTitle(HEAD))])).toBe('skip');
    expect(warm([run('workflow_dispatch', `regen of branch ${BR} at its head (no nonce)`)])).toBe('skip');
    expect(warm([run('workflow_dispatch', 'regen-on-ci')])).toBe('skip');
    expect(warm([run('workflow_dispatch', null)])).toBe('skip');
    expect(warm([run('workflow_dispatch', `regen of ${HEAD.slice(0, 12)}`)])).toBe('skip');
  });
  it('converge picks the last round that ran, and a round the other side had nothing to do after ends the chain', () => {
    const pick = stepScript('Pick the last round');
    const last = (e: Record<string, string>) => runStep(pick, { C1: '', N1: '', H1: '', C2: '', H2: '', C3: '', ...e }, 'exit 9');
    expect(last({ C1: 'true', N1: 'true', H1: 'true', C2: 'true', H2: 'false' }).out['name']).toBe('host-2');
    expect(last({ C1: 'true', N1: 'true', H1: 'true', C2: 'true' }).out['name']).toBe('chrome-2');
    expect(last({ C1: 'true', N1: 'true', H1: 'false' }).out['name']).toBe('host-1');
    // chrome-1 left lanes-host nothing to do: host-1 is skipped and chrome-1's tree is final.
    expect(last({ C1: 'false', N1: 'false' }).out['name']).toBe('chrome-1');
    const missing = last({ C1: 'true', N1: 'true' });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain('host-1 reported nothing');
    expect(last({}).stdout).toContain('chrome-1 reported nothing');
    expect(last({ C1: 'true', N1: 'true', H1: 'true', C2: 'true', H2: 'true', C3: 'true' }).stdout).toContain('no fixed point after 5 rounds');
    // Each later round runs only when the round before it changed files and left the other side something to do.
    expect(yml).toContain("(needs.resume-chrome-1.outputs.resumed == 'true' && needs.resume-chrome-1.outputs.next || needs.chrome-1.outputs.next) != 'false'");
    for (const [prev, cur] of [['host-1', 'chrome-2'], ['chrome-2', 'host-2'], ['host-2', 'chrome-3']]) {
      const job = yml.slice(yml.indexOf(`\n  ${cur}:\n`), yml.indexOf('uses:', yml.indexOf(`\n  ${cur}:\n`)));
      expect(job).toContain(`if: ${'${{'} !cancelled() && needs.${prev}.result == 'success' && needs.${prev}.outputs.changed == 'true' && needs.${prev}.outputs.next != 'false' }}`);
    }
  });
  it('the run-name gives branch mode its branch, head and nonce; patch mode keeps "regen of <sha>"', () => {
    const line = /\nrun-name: ([^\n]+)\n/.exec(yml)?.[1];
    expect(line).toBe("${{ inputs.sha && format('regen of {0}', inputs.sha) || inputs.branch && format('regen of branch {0} at {1} ({2})', inputs.branch, inputs.head || 'its head', inputs.nonce || 'no nonce') || (github.event_name == 'pull_request' && github.event.pull_request.title) || (github.event_name == 'push' && github.event.head_commit.message) || 'regen-on-ci' }}");
    expect(runTitle(BR, HEAD, NONCE)).toBe(`regen of branch ${BR} at ${HEAD} (${NONCE})`);
  });

  const push = stepScript('Commit and push the outputs, then start CI on the new commit');
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  /** origin with base <- head on the branch, a checkout of head, and the run's patch (one changed generated file). */
  function repo() {
    const d = tmpDir();
    const origin = join(d, 'origin.git');
    git(d, 'init', '-q', '--bare', origin);
    const w = join(d, 'w');
    git(d, 'init', '-q', w);
    writeFileSync(join(w, 'out.json'), '1\n');
    git(w, 'add', '.');
    git(w, 'commit', '-q', '-m', 'base');
    const base = git(w, 'rev-parse', 'HEAD');
    writeFileSync(join(w, 'src.ts'), 'x\n');
    git(w, 'add', '.');
    git(w, 'commit', '-q', '-m', 'head');
    const head = git(w, 'rev-parse', 'HEAD');
    writeFileSync(join(w, 'out.json'), '2\n');
    const patch = git(w, 'diff', '--binary') + '\n';
    writeFileSync(join(w, 'pad.txt'), 'a\nB\nc\n');
    const wide = git(w, 'diff', '--binary') + '\n';
    writeFileSync(join(w, '.gitattributes'), 'out.json merge=dragon-generated\npad.txt merge=dragon-generated\n');
    const claiming = git(w, 'diff', '--binary') + '\n';
    // MERGE_BY_HAND's files are regen outputs too.
    git(w, 'checkout', '-q', '--', '.');
    writeFileSync(join(w, 'out.json'), '2\n');
    mkdirSync(join(w, 'packages', 'wpt', 'expectations'), { recursive: true });
    writeFileSync(join(w, 'packages', 'wpt', 'expectations', 'web.json'), '{}\n');
    git(w, 'add', '-N', 'packages');
    const byHand = git(w, 'diff', '--binary') + '\n';
    git(w, 'rm', '-q', '--cached', '-r', 'packages');
    rmSync(join(w, 'packages'), { recursive: true });
    git(w, 'checkout', '-q', '--', '.');
    writeFileSync(join(w, 'later.ts'), 'y\n');
    git(w, 'add', '.');
    git(w, 'commit', '-q', '-m', 'later');
    const later = git(w, 'rev-parse', 'HEAD');
    git(w, 'remote', 'add', 'origin', origin);
    git(w, 'checkout', '-q', '--detach', head);
    return { w, origin, base, head, later, patch, at: (sha: string) => git(w, 'push', '-q', '-f', 'origin', `${sha}:refs/heads/${BR}`), remote: () => git(w, 'ls-remote', 'origin', `refs/heads/${BR}`).split('\t')[0] ?? '' };
  }
  const runPush = (r: ReturnType<typeof repo>, patch: string) => {
    const env = { BRANCH: BR, SHA: r.head, NOW: '', RUN_URL: URL };
    const d = tmpDir();
    mkdirSync(join(d, 'last'));
    writeFileSync(join(d, 'last', 'outputs.patch'), patch);
    return runStep(push, { ...env, RUNNER_TEMP: d }, 'echo "gh $*" >&2', r.w);
  };
  it('pushes the regen commit on top of the head when the branch is still there, and pushes nothing at a fixed point', () => {
    const r = repo();
    r.at(r.head);
    const ok = runPush(r, r.patch);
    expect(ok.status, ok.stderr).toBe(0);
    const pushed = r.remote();
    expect(ok.out).toEqual({ pushed });
    expect(git(r.w, 'log', '-1', '--format=%P%n%B', pushed)).toBe(`${r.head}\n${COMMIT_SUBJECT}\n\nCommands: pnpm regen --skip lanes-host (macos-26) and pnpm regen --only lanes-host (xcode-27), alternated to a fixed\npoint.\nBase: ${r.head}\nRun: ${URL}`);
    expect(pushedCommit(parseCommits(JSON.stringify([{ sha: pushed, parents: [{ sha: r.head }], commit: { message: git(r.w, 'log', '-1', '--format=%B', pushed) } }])), URL, r.head, BR)).toBe(pushed);
    expect(ok.stderr).toContain(`gh workflow run ci.yml --ref ${BR}`);
    const f = repo();
    f.at(f.head);
    const fixed = runPush(f, '');
    expect(fixed.out).toEqual({ pushed: 'none' });
    expect(f.remote()).toBe(f.head);
  });
  const where = stepScript('Where the branch is now');
  /** The step's gh stub answers the compare query with the given status. */
  const runWhere = (r: ReturnType<typeof repo>, patch: string, status: string) => {
    const d = tmpDir();
    mkdirSync(join(d, 'last'));
    writeFileSync(join(d, 'last', 'outputs.patch'), patch);
    return runStep(where, { BRANCH: BR, SHA: r.head, RUNNER_TEMP: d }, `echo '${status}'`, r.w);
  };
  it('judges a branch still at the head as not moved', () => {
    const r = repo();
    r.at(r.head);
    const res = runWhere(r, r.patch, 'identical');
    expect(res.status, res.stderr).toBe(0);
    expect(res.out).toEqual({ moved: 'false' });
  });
  it('judges nothing when the run has nothing to commit, wherever the branch went', () => {
    const r = repo();
    r.at(r.later);
    const res = runWhere(r, '', 'ahead');
    expect(res.status, res.stderr).toBe(0);
    expect(res.out).toEqual({ moved: 'false' });
  });
  it('pushes nothing when the branch is reset back after it was judged', () => {
    const r = repo();
    r.at(r.later);
    const d = tmpDir();
    mkdirSync(join(d, 'last'));
    writeFileSync(join(d, 'last', 'outputs.patch'), r.patch);
    expect(runStep(where, { BRANCH: BR, SHA: r.head, RUNNER_TEMP: d }, `echo ahead`, r.w).status).toBe(0);
    r.at(r.head);
    const res = runStep(push, { BRANCH: BR, SHA: r.head, NOW: r.later, RUN_URL: URL, RUNNER_TEMP: d }, 'echo "gh $*" >&2', r.w);
    expect(res.status).not.toBe(0);
    expect(r.remote()).toBe(r.head);
    expect(res.out).toEqual({});
  });
  it('refuses a branch moved back, sideways or deleted during the run, and one whose new head the outputs do not apply to', () => {
    for (const [at, status, msg] of [
      ['base', 'behind', `moved from HEAD to BASE (behind, not ahead) during the run; nothing pushed, regen again`],
      ['later', 'diverged', `moved from HEAD to LATER (diverged, not ahead) during the run; nothing pushed, regen again`],
      ['gone', 'ahead', 'no longer exists; nothing pushed'],
      ['clash', 'ahead', `moved from HEAD to CLASH during the run and the outputs do not apply there; nothing pushed, regen again`],
    ] as const) {
      const r = repo();
      let target = r.later;
      if (at === 'clash') {
        git(r.w, 'checkout', '-q', '--detach', r.head);
        writeFileSync(join(r.w, 'out.json'), '3\n');
        git(r.w, 'commit', '-q', '-am', 'clash');
        target = git(r.w, 'rev-parse', 'HEAD');
        git(r.w, 'checkout', '-q', '--detach', r.head);
      }
      if (at === 'base') target = r.base;
      r.at(target);
      if (at === 'gone') git(r.w, 'push', '-q', 'origin', `:refs/heads/${BR}`);
      const res = runWhere(r, r.patch, status);
      expect(res.status, at).not.toBe(0);
      expect(res.stdout, at).toContain(`::error::${BR} ${msg.replace('HEAD', r.head).replace('BASE', r.base).replace('LATER', r.later).replace('CLASH', target)}`);
      expect(res.out, at).toEqual({});
    }
  });
  it('carries the outputs onto a head that moved forward, and the push names it after Onto:', () => {
    const r = repo();
    r.at(r.later);
    const d = tmpDir();
    mkdirSync(join(d, 'last'));
    writeFileSync(join(d, 'last', 'outputs.patch'), r.patch);
    const moved = runStep(where, { BRANCH: BR, SHA: r.head, RUNNER_TEMP: d }, `echo ahead`, r.w);
    expect(moved.status, moved.stderr).toBe(0);
    expect(moved.out).toEqual({ moved: 'true', now: r.later });
    expect(git(r.w, 'rev-parse', 'HEAD')).toBe(r.later);
    const ok = runStep(push, { BRANCH: BR, SHA: r.head, NOW: r.later, RUN_URL: URL, RUNNER_TEMP: d }, 'echo "gh $*" >&2', r.w);
    expect(ok.status, ok.stderr).toBe(0);
    const pushed = r.remote();
    expect(ok.out).toEqual({ pushed });
    expect(git(r.w, 'show', `${pushed}:out.json`)).toBe('2');
    expect(git(r.w, 'show', `${pushed}:later.ts`)).toBe('y');
    const message = git(r.w, 'log', '-1', '--format=%B', pushed);
    expect(message).toContain(`Base: ${r.head}\nOnto: ${r.later} (pushed during the run;`);
    expect(pushedCommit(parseCommits(JSON.stringify([{ sha: pushed, parents: [{ sha: r.later }], commit: { message } }])), URL, r.head, BR)).toBe(pushed);
    // The Onto: line must name the commit's own parent.
    expect(() => pushedCommit(parseCommits(JSON.stringify([{ sha: pushed, parents: [{ sha: r.base }], commit: { message } }])), URL, r.head, BR)).toThrow('is not a regen commit on top of');
  });
});

describe('regen-on-ci.yml resume: chrome-1 taken from an earlier run, run locally', () => {
  const check = stepScript('Check the run to resume from');
  // The branch the run regenerates and this run's id, as resolve and GitHub give them.
  const base = { BRANCH: BR, GITHUB_RUN_ID: '5000', RUNS_TRIED: '5' };
  const RUN = '4242';
  // The run as GitHub gives it: by default a label run of BR made from this repository.
  const ownRun = { path: '.github/workflows/regen-on-ci.yml', event: 'pull_request', head_branch: BR, display_title: 'Batch 3 landing', repository: { full_name: REPO }, head_repository: { full_name: REPO } };
  const ghFor = (o: { readonly run?: object; readonly artifacts?: readonly object[]; readonly jobs?: readonly object[]; readonly missing?: boolean; readonly labelled?: readonly object[]; readonly dispatched?: readonly object[]; readonly also?: readonly number[]; readonly failed?: readonly number[] } = {}) => `
case "$2" in
  *workflows/regen-on-ci.yml/runs?event=pull_request*) body='${JSON.stringify({ workflow_runs: o.labelled ?? [] })}' ;;
  *workflows/regen-on-ci.yml/runs?event=workflow_dispatch*) body='${JSON.stringify({ workflow_runs: o.dispatched ?? [] })}' ;;
  repos/${REPO}/actions/runs/[0-9]*/artifacts*|repos/${REPO}/actions/runs/[0-9]*/jobs*|repos/${REPO}/actions/runs/[0-9]*) id=$(cut -d/ -f6 <<<"$2" | cut -d'?' -f1); [ "$id" = ${RUN} ] || [[ " ${[...(o.also ?? []), ...(o.failed ?? [])].join(' ')} " == *" $id "* ]] || { echo '{"message":"Not Found"}'; exit 1; } ;;&
  repos/${REPO}/actions/runs/[0-9]*/jobs*) [[ " ${(o.failed ?? []).join(' ')} " != *" $id "* ]] || { body='{"jobs":[{"name":"chrome-1 / round","conclusion":"failure"}]}'; jq -r "$4" <<<"$body"; exit 0; } ;;&
  repos/${REPO}/actions/runs/[0-9]*/artifacts*) [ "$id" = ${RUN} ] || [[ " ${(o.failed ?? []).join(' ')} " == *" $id "* ]] || { body='{"artifacts":[]}'; if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; fi; exit 0; } ;;&
  repos/${REPO}/actions/runs/[0-9]*/artifacts*) body='${JSON.stringify({ artifacts: o.artifacts ?? [{ name: 'chrome-1', expired: false }] })}' ;;
  repos/${REPO}/actions/runs/${RUN}/jobs*) body='${JSON.stringify({ jobs: o.jobs ?? [{ name: 'resolve', conclusion: 'success' }, { name: 'chrome-1 / round', conclusion: 'success' }, { name: 'host-1 / round', conclusion: 'failure' }] })}' ;;
  repos/${REPO}/actions/runs/[0-9]*) ${o.missing === true ? `echo '{"message":"Not Found"}'; exit 1` : `body='${JSON.stringify({ ...ownRun, ...o.run })}'`} ;;
  *) echo "unexpected gh $*" >&2; exit 9 ;;
esac
if [ "$3" = -q ]; then jq -r "$4" <<<"$body"; else printf '%s\\n' "$body"; fi`;
  it('takes a regen-on-ci run whose chrome-1 succeeded, and a run given resume saves no cache', () => {
    expect(runStep(check, { ...base, RESUME: RUN, MODE: 'patch' }, ghFor()).out).toEqual({ resume: RUN, save: 'false' });
    expect(runStep(check, { ...base, RESUME: RUN, MODE: 'push' }, ghFor()).out).toEqual({ resume: RUN, save: 'false' });
    // A chrome-1 that resume-chrome-1 itself supplied (its round skipped) qualifies too, so resumes chain.
    expect(runStep(check, { ...base, RESUME: RUN, MODE: 'patch' }, ghFor({ jobs: [{ name: 'resume-chrome-1', conclusion: 'success' }, { name: 'chrome-1', conclusion: 'skipped' }] })).out).toEqual({ resume: RUN, save: 'false' });
    // Without resume, patch mode saves nothing and the other modes save as before.
    expect(runStep(check, { ...base, RESUME: '', MODE: 'patch' }, 'exit 9').out).toEqual({ resume: '', save: 'false' });
    expect(runStep(check, { ...base, RESUME: '', MODE: 'push' }, 'exit 9').out).toEqual({ resume: '', save: 'true' });
    expect(runStep(check, { ...base, RESUME: '', MODE: 'warm' }, 'exit 9').out).toEqual({ resume: '', save: 'true' });
  });
  it('a label run or a branch dispatch takes the newest earlier run of its branch that qualifies, and then saves no cache', () => {
    const lab = (id: number, head_branch = BR, from = REPO) => ({ id, head_branch, display_title: 'Batch 3 landing', head_repository: { full_name: from } });
    const dis = (id: number, branch = BR) => ({ id, head_branch: 'master', display_title: runTitle(branch, HEAD, NONCE), head_repository: { full_name: REPO } });
    // 4242 qualifies; 4300 (newer) has no such run in the stub, so it is passed over; 6000 is newer than this run; other branches never count.
    const found = runStep(check, { ...base, RESUME: '', MODE: 'push' }, ghFor({ labelled: [lab(4300), lab(4242), lab(6000), lab(4400, 'other')], dispatched: [dis(4350, 'other'), dis(4100)] }));
    expect(found.status, found.stderr).toBe(0);
    expect(found.out).toEqual({ resume: RUN, save: 'false' });
    expect(found.stdout).toContain('not resuming from run 4300: run 4300 was not found');
    expect(found.stdout).not.toContain('4400');
    expect(found.stdout).not.toContain('4350');
    // A branch dispatch (run-name "regen of branch <b> at ...") counts too.
    expect(runStep(check, { ...base, RESUME: '', MODE: 'push' }, ghFor({ run: { event: 'workflow_dispatch', head_branch: 'master', display_title: runTitle(BR, HEAD, NONCE) }, dispatched: [dis(4242)] })).out).toEqual({ resume: RUN, save: 'false' });
    // A fork's pull request from a branch of the same name is never looked at.
    const fork = runStep(check, { ...base, RESUME: '', MODE: 'push' }, ghFor({ labelled: [lab(4242, BR, 'fork/r')] }));
    expect(fork.out).toEqual({ resume: '', save: 'true' });
    expect(fork.stdout).not.toContain('4242');
    // Label runs with no chrome-1 (another label) do not use up the tries.
    const busy = runStep(check, { ...base, RESUME: '', MODE: 'push', RUNS_TRIED: '1' }, ghFor({ labelled: [lab(4300), lab(4290), lab(4242)], also: [4300, 4290] }));
    expect(busy.out).toEqual({ resume: RUN, save: 'false' });
    expect(busy.stdout).toContain('not resuming from run 4300: run 4300 has no live chrome-1 artifact');
    // Nothing that qualifies, or a failed list: no resume, and the cache is saved as before.
    expect(runStep(check, { ...base, RESUME: '', MODE: 'push' }, ghFor({ labelled: [lab(4300)] })).out).toEqual({ resume: '', save: 'true' });
    expect(runStep(check, { ...base, RESUME: '', MODE: 'push' }, 'echo nope; exit 1').out).toEqual({ resume: '', save: 'true' });
    // At most RUNS_TRIED regen runs are tried.
    const capped = runStep(check, { ...base, RESUME: '', MODE: 'push', RUNS_TRIED: '1' }, ghFor({ labelled: [lab(4300), lab(4242)], failed: [4300] }));
    expect(capped.stdout).toContain("not resuming from run 4300: run 4300's chrome-1 did not succeed");
    expect(capped.out).toEqual({ resume: '', save: 'true' });
    // Patch mode (the landing driver) and master's warm run never look for one.
    expect(runStep(check, { ...base, RESUME: '', MODE: 'patch' }, ghFor({ labelled: [lab(4242)] })).out).toEqual({ resume: '', save: 'false' });
    expect(runStep(check, { ...base, RESUME: '', MODE: 'warm' }, ghFor({ labelled: [lab(4242)] })).out).toEqual({ resume: '', save: 'true' });
  });
  it('warns and regenerates from scratch for a run that does not qualify, and refuses an id that is not a number', () => {
    for (const [o, why] of [
      [{ missing: true }, `run ${RUN} was not found`],
      [{ run: { path: '.github/workflows/test-files.yml' } }, `run ${RUN} is not a regen-on-ci run`],
      // A fork's pull request runs its own copy of the workflow (the same path), so its artifacts are its own.
      [{ run: { head_repository: { full_name: 'fork/r' } } }, `run ${RUN} was not made from ${REPO}`],
      [{ run: { repository: { full_name: 'fork/r' } } }, `run ${RUN} was not made from ${REPO}`],
      [{ run: { head_repository: null } }, `run ${RUN} was not made from ${REPO}`],
      [{ run: { event: 'schedule' } }, `run ${RUN} came from a schedule event`],
      [{ run: { event: 'workflow_dispatch', head_branch: 'lane/y', display_title: runTitle(BR, HEAD, NONCE) } }, `run ${RUN} was not dispatched from master`],
      [{ run: { event: 'workflow_dispatch', head_branch: 'master', display_title: runTitle('other', HEAD, NONCE) } }, `run ${RUN} regenerated another branch`],
      [{ run: { head_branch: 'other' } }, `run ${RUN} regenerated another branch`],
      [{ run: { event: 'push', head_branch: 'master' } }, `run ${RUN} regenerated another branch`],
      [{ artifacts: [{ name: 'chrome-1', expired: true }] }, `run ${RUN} has no live chrome-1 artifact`],
      [{ artifacts: [] }, `run ${RUN} has no live chrome-1 artifact`],
      [{ jobs: [{ name: 'chrome-1 / round', conclusion: 'failure' }] }, `run ${RUN}'s chrome-1 did not succeed`],
      [{ jobs: [{ name: 'chrome-1 / round', conclusion: 'cancelled' }] }, `run ${RUN}'s chrome-1 did not succeed`],
      [{ jobs: [{ name: 'chrome-1 / round', conclusion: null }] }, `run ${RUN}'s chrome-1 did not succeed`],
    ] as const) {
      const r = runStep(check, { ...base, RESUME: RUN, MODE: 'push' }, ghFor(o));
      expect(r.status, why).toBe(0);
      expect(r.stdout, why).toContain(`::warning::${why}; chrome-1 runs from scratch`);
      expect(r.out, why).toEqual({ resume: '', save: 'false' });
    }
    // Patch mode names no branch: any branch's run of this repository qualifies, a fork's never.
    expect(runStep(check, { ...base, BRANCH: '', RESUME: RUN, MODE: 'patch' }, ghFor({ run: { head_branch: 'other' } })).out).toEqual({ resume: RUN, save: 'false' });
    expect(runStep(check, { ...base, BRANCH: '', RESUME: RUN, MODE: 'patch' }, ghFor({ run: { head_repository: { full_name: 'fork/r' } } })).out).toEqual({ resume: '', save: 'false' });
    const bad = runStep(check, { ...base, RESUME: '12; rm -rf /', MODE: 'patch' }, 'exit 9');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('::error::resume is not a run id');
  });
  it('wires resume-chrome-1 in front of chrome-1, and host-1 and converge take whichever supplied chrome-1', () => {
    const job = (name: string): string => {
      const at = yml.indexOf(`\n  ${name}:\n`);
      expect(at, name).toBeGreaterThan(0);
      const end = yml.slice(at + 1).search(/\n {2}[a-z0-9-]+:\n/);
      return yml.slice(at, end < 0 ? undefined : at + 1 + end);
    };
    expect(job('chrome-1')).toContain("needs.resume-chrome-1.outputs.resumed != 'true'");
    expect(job('chrome-1')).toContain("seed_run: '${{ needs.resolve.outputs.resume }}'");
    expect(job('host-1')).toContain("(needs.chrome-1.result == 'success' || needs.resume-chrome-1.outputs.resumed == 'true')");
    expect(job('converge')).toContain("C1: ${{ needs.resume-chrome-1.outputs.resumed == 'true' && needs.resume-chrome-1.outputs.changed || needs.chrome-1.outputs.changed }}");
    // Every round saves only when resolve says so (never with resume, never in patch mode).
    expect(yml.match(/save_cache: "\$\{\{ needs\.resolve\.outputs\.save == 'true' \}\}"/g)).toHaveLength(5);
    expect(yml).not.toContain("save_cache: \"${{ needs.resolve.outputs.mode != 'patch' }}\"");
  });

  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  /** The earlier run's commit (out.json 1, a regen output), this run's commit on it (a host-only change), and the earlier chrome-1's patch (out.json 2), and one that also changes pad.txt. */
  function repo() {
    const d = tmpDir();
    const w = join(d, 'w');
    git(d, 'init', '-q', w);
    writeFileSync(join(w, 'out.json'), '1\n');
    writeFileSync(join(w, 'pad.txt'), 'a\nb\nc\n');
    writeFileSync(join(w, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(w, '.gitattributes'), 'out.json merge=dragon-generated\n');
    git(w, 'add', '.');
    git(w, 'commit', '-q', '-m', 'earlier');
    writeFileSync(join(w, 'out.json'), '2\n');
    const patch = git(w, 'diff', '--binary') + '\n';
    writeFileSync(join(w, 'pad.txt'), 'a\nB\nc\n');
    const wide = git(w, 'diff', '--binary') + '\n';
    writeFileSync(join(w, '.gitattributes'), 'out.json merge=dragon-generated\npad.txt merge=dragon-generated\n');
    const claiming = git(w, 'diff', '--binary') + '\n';
    // MERGE_BY_HAND's files are regen outputs too.
    git(w, 'checkout', '-q', '--', '.');
    writeFileSync(join(w, 'out.json'), '2\n');
    mkdirSync(join(w, 'packages', 'wpt', 'expectations'), { recursive: true });
    writeFileSync(join(w, 'packages', 'wpt', 'expectations', 'web.json'), '{}\n');
    git(w, 'add', '-N', 'packages');
    const byHand = git(w, 'diff', '--binary') + '\n';
    git(w, 'rm', '-q', '--cached', '-r', 'packages');
    rmSync(join(w, 'packages'), { recursive: true });
    git(w, 'checkout', '-q', '--', '.');
    writeFileSync(join(w, 'host.kt'), 'fix\n');
    git(w, 'add', '.');
    git(w, 'commit', '-q', '-m', 'host fix');
    return { w, sha: git(w, 'rev-parse', 'HEAD'), patch, wide, claiming, byHand };
  }
  /** RUNNER_TEMP with prev/outputs.patch and prev/store.tar.zst (a plain tar: zstd is stubbed as cat), and stubs for zstd and node. */
  function temp(patch: string, chrome: object[], host: object[]) {
    const d = tmpDir();
    mkdirSync(join(d, 'prev'));
    writeFileSync(join(d, 'prev', 'outputs.patch'), patch);
    mkdirSync(join(d, 'st', 'v2', 'capture'), { recursive: true });
    writeFileSync(join(d, 'st', 'v2', 'capture', 'k.json'), '{}\n');
    execFileSync('tar', ['-cf', join(d, 'prev', 'store.tar.zst'), '-C', join(d, 'st'), 'v2']);
    mkdirSync(join(d, 'bin'));
    writeFileSync(join(d, 'bin', 'zstd'), '#!/usr/bin/env bash\ncat "${@: -1}"\n');
    // regen --explain writes last-run.json: the Chrome steps' records for --skip lanes-host, lanes-host's for --only.
    writeFileSync(join(d, 'bin', 'node'), `#!/usr/bin/env bash\nmkdir -p node_modules/.cache/dragon-regen\nif [ "$3" = --only ]; then echo '${JSON.stringify(host)}'; else echo '${JSON.stringify(chrome)}'; fi > node_modules/.cache/dragon-regen/last-run.json\n`);
    for (const f of ['zstd', 'node']) chmodSync(join(d, 'bin', f), 0o755);
    return d;
  }
  const judge = stepScript('Would chrome-1 change anything on this commit');
  const skipped = (step: string) => ({ pass: 1, step, action: 'skipped', ms: 0, changed: 0, why: 'unchanged' });
  const runJudge = (r: ReturnType<typeof repo>, d: string) => runStep(judge, { SHA: r.sha, RESUME: '4242', RUNNER_TEMP: d, PATH: `${join(d, 'bin')}:${process.env['PATH']}` }, 'exit 9', r.w);
  it('takes the earlier tree when every Chrome step is covered on this commit, with its patch made again against this commit', () => {
    const r = repo();
    const d = temp(r.patch, [skipped('capture'), skipped('profile-rows')], [{ ...skipped('lanes-host'), action: 'would run', why: 'host.kt changed' }]);
    const res = runJudge(r, d);
    expect(res.status, res.stderr).toBe(0);
    expect(res.out).toEqual({ ok: 'true', changed: 'true', next: 'true' });
    expect(readFileSync(join(res.dir, 'summary'), 'utf8')).toContain(`chrome-1 (resumed from run 4242): all 2 Chrome steps covered on ${r.sha}, changed files: true; host-1 runs`);
    // The new patch is against this commit and gives the earlier chrome-1's outputs on it.
    git(r.w, 'checkout', '-q', '-f', r.sha);
    git(r.w, 'apply', '--binary', join(d, 'out', 'outputs.patch'));
    expect(readFileSync(join(r.w, 'out.json'), 'utf8')).toBe('2\n');
    expect(readFileSync(join(r.w, 'host.kt'), 'utf8')).toBe('fix\n');
    expect(readFileSync(join(r.w, '.git', 'dragon-regen', 'v2', 'capture', 'k.json'), 'utf8')).toBe('{}\n');
    expect(execFileSync('tar', ['-tf', join(d, 'out', 'store.tar.zst')], { encoding: 'utf8' })).toContain('v2/capture/k.json');
    expect(JSON.parse(readFileSync(join(d, 'out', 'chrome-explain.json'), 'utf8'))).toHaveLength(2);
    // lanes-host covered too: host-1 would change nothing.
    const r2 = repo();
    const all = runJudge(r2, temp(r2.patch, [skipped('capture')], [skipped('lanes-host')]));
    expect(all.out).toEqual({ ok: 'true', changed: 'true', next: 'false' });
    // A MERGE_BY_HAND output (the WPT expectations) is taken like any other output.
    const r4 = repo();
    expect(runJudge(r4, temp(r4.byHand, [skipped('wpt')], [skipped('lanes-host')])).out).toEqual({ ok: 'true', changed: 'true', next: 'false' });
    // The judge's list of them is MERGE_BY_HAND's.
    expect(/by_hand='([^']*)'/.exec(judge)?.[1]?.split(' ')).toEqual(MERGE_BY_HAND.map((h) => h.path).sort());
    // An earlier chrome-1 at its fixed point: an empty patch, changed false.
    const r3 = repo();
    const fixed = runJudge(r3, temp('', [skipped('capture')], [skipped('lanes-host')]));
    expect(fixed.out).toEqual({ ok: 'true', changed: 'false', next: 'false' });
  });
  it('leaves chrome-1 to run when a Chrome step would run or restore, the outputs do not apply, or explain judged nothing', () => {
    const cases: [string, (r: ReturnType<typeof repo>) => string, string][] = [
      ['run', (r) => temp(r.patch, [skipped('capture'), { ...skipped('ua'), action: 'would run', why: 'packages/parity/src/x.ts changed' }], []), 'this commit changes Chrome-step inputs: ua (would run: packages/parity/src/x.ts changed); chrome-1 runs'],
      ['restore', (r) => temp(r.patch, [{ ...skipped('capture'), action: 'would restore', why: 'outputs differ' }], []), 'this commit changes Chrome-step inputs: capture (would restore'],
      ['apply', (r) => temp(r.patch.replace('\n-1\n', '\n-7\n'), [skipped('capture')], []), 'outputs do not apply to'],
      ['none', (r) => temp(r.patch, [], []), 'regen --explain judged no step; chrome-1 runs'],
      // Only regen outputs come from the earlier run: a patch that also changes another file (pad.txt) is not taken.
      ['unclaimed', (r) => temp(r.wide, [skipped('capture')], []), 'changes files no regen step claims (pad.txt); chrome-1 runs'],
      // A patch cannot claim its own paths: .gitattributes is read at this commit.
      ['self-claim', (r) => temp(r.claiming, [skipped('capture')], []), 'changes files no regen step claims (.gitattributes pad.txt); chrome-1 runs'],
    ];
    for (const [name, make, msg] of cases) {
      const r = repo();
      const res = runJudge(r, make(r));
      expect(res.status, `${name}: ${res.stderr}`).toBe(0);
      expect(res.stdout + res.stderr, name).toContain(msg);
      expect(res.out, name).toEqual({});
    }
  });

  const seed = stepScript('Seed the regen cache from it', roundYml);
  it('a seeded round takes the store and the outputs\' blobs, and leaves the worktree at the commit', () => {
    const r = repo();
    const d = temp(r.patch, [], []);
    renameSync(join(d, 'prev'), join(d, 'seed'));
    const res = runStep(seed, { RUNNER_TEMP: d, PATH: `${join(d, 'bin')}:${process.env['PATH']}` }, 'exit 9', r.w);
    expect(res.status, res.stderr).toBe(0);
    expect(git(r.w, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(r.w, 'out.json'), 'utf8')).toBe('1\n');
    expect(readFileSync(join(r.w, '.git', 'dragon-regen', 'v2', 'capture', 'k.json'), 'utf8')).toBe('{}\n');
    // The blob of out.json "2" is in the object database, so regen can restore it.
    const blob = execFileSync('git', ['hash-object', '--stdin'], { cwd: r.w, input: '2\n', encoding: 'utf8' }).trim();
    expect(git(r.w, 'cat-file', '-p', blob)).toBe('2');
  });
});
