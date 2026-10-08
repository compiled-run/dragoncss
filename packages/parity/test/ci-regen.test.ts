// pnpm ci:regen (scripts/ci-regen.ts) against a fake gh: its arguments, the run-name, finding and reusing the run, the exit codes
// and the pushed-head check. Then regen-on-ci.yml's own shell, run locally with a stub gh: branch mode's head check, master's warm
// run still yielding to branch regens but never to patch-mode runs, and the push refusing a branch that moved.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMIT_SUBJECT, type Deps, EXIT, FIXED_STEP, findReusable, main, parseArgs, parseCommits, parseRun, parseTitle, PLACEHOLDER, PUSH_STEP, pushedCommit, type Run, runTitle } from '../../../scripts/ci-regen.ts';
import { regenTitle } from '../../../scripts/land-devices-ci.ts';
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
function fake(o: { states?: object[]; jobs?: object[]; commits?: object[]; head?: string; listed?: object[]; dispatchAnswer?: string; annotations?: object[] | 'fail' } = {}) {
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
      if (path?.startsWith(`repos/${REPO}/actions/workflows/regen-on-ci.yml/runs?`)) return JSON.stringify({ workflow_runs: o.listed ?? [] });
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
    const deps: Deps = { ...f.deps, gh: (a) => (a[1]?.includes('/runs?') ? JSON.stringify({ workflow_runs: ++lists > 2 ? [rawRun({ status: 'queued', conclusion: null }), ...others] : others }) : gh(a)) };
    expect(main([BR, '--once'], deps, () => REPO)).toBe(EXIT.pending);
    expect(f.logs).toContain(`dispatched regen-on-ci.yml from master for ${BR} at ${HEAD} (${NONCE}): run 77`);
    // The first list is the reuse check; the dispatch's own lookup waits until its run-name appears.
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
function stepScript(name: string): string {
  const lines = yml.split('\n');
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
    const env = { BRANCH: BR, SHA: r.head, RUN_URL: URL };
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
    expect(git(r.w, 'log', '-1', '--format=%P%n%B', pushed)).toBe(`${r.head}\n${COMMIT_SUBJECT}\n\nCommands: pnpm regen --skip lanes-host --skip tw-sweep (macos-26) and pnpm regen --only lanes-host (xcode-27), alternated\nto a fixed point, then pnpm regen --only tw-sweep (macos-26).\nBase: ${r.head}\nRun: ${URL}`);
    expect(pushedCommit(parseCommits(JSON.stringify([{ sha: pushed, parents: [{ sha: r.head }], commit: { message: git(r.w, 'log', '-1', '--format=%B', pushed) } }])), URL, r.head, BR)).toBe(pushed);
    expect(ok.stderr).toContain(`gh workflow run ci.yml --ref ${BR}`);
    const f = repo();
    f.at(f.head);
    const fixed = runPush(f, '');
    expect(fixed.out).toEqual({ pushed: 'none' });
    expect(f.remote()).toBe(f.head);
  });
  it('refuses to push when the branch moved during the run: forward, back to an ancestor, or deleted', () => {
    for (const where of ['later', 'base', 'gone'] as const) {
      const r = repo();
      if (where === 'gone') r.at(r.base);
      else r.at(r[where]);
      if (where === 'gone') git(r.w, 'push', '-q', 'origin', `:refs/heads/${BR}`);
      const before = where === 'gone' ? '' : r.remote();
      const res = runPush(r, r.patch);
      expect(res.status, where).not.toBe(0);
      expect(res.stdout, where).toContain(`::error::${BR} moved from ${r.head} to ${where === 'gone' ? 'nothing' : r[where]} during the run; nothing pushed, regen again`);
      expect(where === 'gone' ? git(r.w, 'ls-remote', 'origin', `refs/heads/${BR}`) : r.remote(), where).toBe(before);
      expect(res.out, where).toEqual({});
    }
  });
});
