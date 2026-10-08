// land.yml and the trusted driver (LAND_TRUSTED): the token job runs no tree code, the tree checks come back as data, the
// cross-host lock, and the dispatches that never let GitHub drop a queued run. No network: gh is a fake, git a scratch repository.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SETUP_GIT_CONFIG } from '../../../scripts/floor-merge.ts';
import { type BatchOps, type Entry, runBatches, patchHasSymlink, readInTree, removeInTree, symlinkEntries, treeCodeRefusal, trustedGitConfig, writeInTree } from '../../../scripts/land-lib.ts';
import { applyRegenPatch, VERDICT_STEP, checksBranch, checksFiles, checksTitle, checksWorkflow, parseChecksResult, runIdOf, scratchRef, staleScratchBranches, titleOf } from '../../../scripts/land-devices-ci.ts';
import {
  clearOutage,
  outageStreak,
  parseOutageEject,
  writeOutage,
  checkLockFree,
  dispatchLand,
  type DispatchDeps,
  landJobStatus,
  lockHolder,
  lockStale,
  lockTag,
  parseLockHolder,
  pendingRuns,
  queueFromInput,
  redispatchDecision,
  releaseLock,
  serializeHandoff,
  takeLock,
  workflowRuns,
} from '../../../scripts/land-state.ts';
import { repoPath } from '../src/paths.ts';

const sha = (c: string): string => c.repeat(40);
const temps: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'land-trusted-'));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// The workflow's jobs, each as its own text (top-level keys under jobs:, two-space indent), and a job's steps.
const jobsOf = (yml: string): Map<string, string> => {
  const body = yml.slice(yml.indexOf('\njobs:\n') + 7);
  const out = new Map<string, string>();
  for (const part of body.split(/\n(?=  [a-z][\w-]*:\n)/)) out.set(/^ {2}([a-z][\w-]*):/.exec(part)![1]!, part);
  return out;
};
const stepsOf = (job: string): string[] => job.slice(job.indexOf('\n    steps:\n')).split(/\n(?= {6}- )/).slice(1);
const runOf = (step: string): string | null => {
  const m = /\n {8}run: (\|\n((?: {10}.*\n?)+)|.*)/.exec(step);
  return m === null ? null : (m[2] ?? m[1]!).replace(/^ {10}/gm, '').trim();
};

describe('land.yml: the job that holds LAND_TOKEN runs no tree code', () => {
  const yml = readFileSync(repoPath('.github/workflows/land.yml'), 'utf8');
  const jobs = jobsOf(yml);
  const land = jobs.get('land')!;

  it('keeps the token in the land environment, in the driver step only, never in a job environment', () => {
    expect(land).toMatch(/\n {4}environment: land\n/);
    expect(yml.match(/secrets\.LAND_TOKEN/g)).toHaveLength(2);
    const steps = stepsOf(land);
    const withSecret = steps.filter((st) => st.includes('secrets.LAND_TOKEN')).map((st) => /- name: (.*)/.exec(st)![1]);
    expect(withSecret).toEqual(['Check the token and the ref', 'Land one batch']);
    // The check sees only whether it is set.
    expect(steps.find((st) => st.includes('Check the token'))).toContain("HAS_LAND_TOKEN: ${{ secrets.LAND_TOKEN != '' }}");
    expect(steps.find((st) => st.includes('Land one batch'))).toMatch(/env:\n {10}LAND_TOKEN: \$\{\{ secrets\.LAND_TOKEN \}\}\n {8}run: node scripts\/land\.ts "\$LAND_QUEUE_FILE"/);
    const jobEnv = land.slice(land.indexOf('\n    env:\n'), land.indexOf('\n    steps:\n'));
    expect(jobEnv).not.toMatch(/secrets\./);
    expect(jobEnv).toContain('GH_TOKEN: ${{ github.token }}');
    expect(jobs.get('redispatch')).not.toMatch(/secrets\./);
    expect(land).toMatch(/LAND_TRUSTED: '1'/);
    expect(land).toMatch(/LAND_CI: only/);
    expect(land).toMatch(/LAND_GLOBAL_LOCK: '1'/);
    // No write permission for GITHUB_TOKEN in the token job.
    const perms = /\n {4}permissions:\n((?: {6}.*\n)+)/.exec(land)![1]!;
    expect(perms.split('\n').filter((l) => l.trim() !== '').every((l) => / read$/.test(l))).toBe(true);
  });

  it('checks out only its own commit, without credentials, and runs only the trusted checkout\'s commands', () => {
    const steps = stepsOf(land);
    const checkouts = steps.filter((st) => st.includes('actions/checkout'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]).toMatch(/ref: \$\{\{ github\.sha \}\}/);
    expect(checkouts[0]).toMatch(/persist-credentials: false/);
    // Every action is one of these; every command, one of these exact scripts (none runs in a landing worktree).
    const uses = steps.flatMap((st) => /uses: (\S+)/.exec(st)?.[1] ?? []);
    expect(uses.sort()).toEqual(['actions/checkout@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4']);
    const runs = steps.map(runOf).filter((r): r is string => r !== null);
    const allowed = [
      /^if \[ -z "\$\(printf '%s' "\$QUEUE" \| tr -d '\[:space:\]'\)" \]; then/,
      /^\{\n {2}echo "LAND_LOG_DIR=\$RUNNER_TEMP\/land-logs"/,
      /^git config rerere\.enabled false\ngit config core\.symlinks false\n/,
      /^free=\$\(df -BG --output=avail \/tmp \| tail -1 \| tr -dc '0-9'\)/,
      /^mkdir -p "\$LAND_LOG_DIR"\nnode scripts\/land-actions\.ts queue "\$LAND_QUEUE_FILE"$/,
      /^chmod -R a-w "\$GITHUB_WORKSPACE"\nchmod -R u\+w "\$GITHUB_WORKSPACE\/\.git"\n/,
      /^node scripts\/land\.ts "\$LAND_QUEUE_FILE"$/,
    ];
    for (const r of runs) expect(allowed.some((a) => a.test(r)), r).toBe(true);
    expect(runs).toHaveLength(allowed.length);
    // The installs and commands above run in the workspace, the trusted checkout: no step changes directory.
    expect(steps.some((st) => /working-directory:|\bcd /.test(st))).toBe(false);
    // No package manager, in either job: package.json commands are not the code review reads.
    for (const job of [land, jobs.get('redispatch')!]) for (const r of stepsOf(job).map(runOf)) expect(r ?? '', r ?? '').not.toMatch(/\b(pnpm|npx|npm|yarn|corepack)\b(?! regen rebuilds)/);
    expect(yml).not.toMatch(/pnpm\/action-setup|\binstall\b.*--frozen-lockfile/);
    // The merge drivers are the trusted checkout's, by absolute path; the checkout is made read-only before the driver runs.
    const git = runs.find((r) => r.startsWith('git config rerere'))!;
    expect(git).toContain(`git config merge.dragon-floor.driver "node '$GITHUB_WORKSPACE/scripts/floor-merge.ts' %O %A %B %P"`);
    expect(git).toContain(`git config merge.dragon-sorted.driver "node '$GITHUB_WORKSPACE/scripts/sorted-merge.ts' %O %A %B %P"`);
    const names = steps.map((st) => /- name: (.*)/.exec(st)![1]);
    expect(names.indexOf('Make the trusted checkout read-only')).toBe(names.indexOf('Land one batch') - 1);
  });

  it('refuses a queue when there is no stop channel (LAND_STOP_ISSUE)', () => {
    const check = runOf(stepsOf(land).find((st) => st.includes('Check the token and the ref'))!)!;
    expect(stepsOf(land).find((st) => st.includes('Check the token and the ref'))).toContain('STOP_ISSUE: ${{ vars.LAND_STOP_ISSUE }}');
    // After the empty-queue exit, so only a queue needs it.
    expect(check.indexOf('[[ "$STOP_ISSUE" =~ ^[1-9][0-9]*$ ]]')).toBeGreaterThan(check.indexOf('exit 0'));
  });

  it('the token job\'s scripts import only node: built-ins and repository files, so it installs nothing', async () => {
    const ts = (await import('typescript')).default;
    const roots = ['land.ts', 'land-actions.ts', 'land-review-lookup.ts', 'pr-review.ts', 'floor-merge.ts', 'sorted-merge.ts', 'land-watchdog.ts'];
    const seen = new Set<string>();
    const outside: string[] = [];
    const walk = (f: string): void => {
      if (seen.has(f)) return;
      seen.add(f);
      for (const i of ts.preProcessFile(readFileSync(f, 'utf8'), true, true).importedFiles) {
        if (i.fileName.startsWith('.')) walk(resolve(dirname(f), i.fileName));
        else if (!i.fileName.startsWith('node:')) outside.push(`${f}: ${i.fileName}`);
      }
    };
    for (const r of roots) walk(repoPath(`scripts/${r}`));
    expect(outside).toEqual([]);
    // Every file it reaches is a script of the repository (no package's source).
    expect([...seen].every((f) => f.startsWith(repoPath('scripts/')))).toBe(true);
    expect(seen.size).toBeGreaterThan(roots.length);
  });

  it('serialises the land jobs, not the runs, and re-dispatches from a job with no secret', () => {
    expect(land).toMatch(/\n {4}concurrency:\n {6}group: land\n {6}cancel-in-progress: false\n/);
    expect(yml.slice(0, yml.indexOf('\njobs:\n'))).not.toMatch(/\nconcurrency:/);
    const redispatch = jobs.get('redispatch')!;
    expect(redispatch).toMatch(/needs: land/);
    expect(redispatch).toMatch(/!cancelled\(\)/);
    expect(stepsOf(redispatch).map(runOf).filter((r) => r !== null)).toEqual(['node scripts/land-actions.ts redispatch "$RUNNER_TEMP/land-logs/handoff.json"']);
  });

  it('land-checks.yml has no secret and reads only', () => {
    const checks = readFileSync(repoPath('.github/workflows/land-checks.yml'), 'utf8');
    expect(checks).not.toMatch(/secrets\./);
    expect(checks).toMatch(/\npermissions:\n {2}contents: read\n {2}actions: read\n/);
    expect(checks).not.toMatch(/\n {4}permissions:/);
    expect(checks).toMatch(/persist-credentials: false/);
    expect(checks).toMatch(/run-name: \$\{\{ format\('land checks of \{0\}', inputs\.sha\) \}\}/);
    expect(checks).not.toMatch(/cache: pnpm/);
    // Every tree command under timeout, so a hang is its recorded failure; the results upload whatever happened.
    expect(checks).toMatch(/timeout --kill-after=60s "\$limit" "\$@"/);
    for (const [name, limit] of [['install', '30m'], ['merge', '15m'], ['typecheck', '40m'], ['stamp', '20m'], ['lanes', '20m']]) expect(checks).toMatch(new RegExp(`record ${name} ${limit} `));
    expect(checks).toMatch(/timeout-minutes: 150/);
    expect(checks).toMatch(/- name: Upload the results\n {8}if: always\(\)/);
    // Each command in a session of its own, whose leftovers are killed by session id once it ends: no name list, nothing of the
    // runner's at risk. The records patch and result.json are made after every command's session is gone.
    const land = runOf(stepsOf(jobsOf(checks).get('checks')!).find((st) => st.includes('- name: Land checks'))!)!;
    expect(land).toMatch(/ {2}setsid timeout --kill-after=60s "\$limit" "\$@" > "\$parts\/\$name\.out" 2> "\$parts\/\$name\.err" &\n {2}local sid=\$!\n {2}wait "\$sid"\n {2}local status=\$\?\n {2}pkill -KILL -s "\$sid" 2> \/dev\/null \|\| true\n/);
    expect(land).not.toMatch(/kill_strays|Runner\.Worker|ps -u/);
    expect(land.indexOf('git diff --cached --binary HEAD')).toBeGreaterThan(land.lastIndexOf('record lanes'));
    expect(land.indexOf('jq -s add')).toBeGreaterThan(land.lastIndexOf('record lanes'));
    // The record lines are the only places the tree's commands run.
    const body = runOf(stepsOf(jobsOf(checks).get('checks')!).find((st) => st.includes('- name: Land checks'))!)!;
    expect(body.split('\n').filter((l) => /\b(pnpm|node) /.test(l) && !/^\s*(record |typecheck\)|stamp\)|lanes\))/.test(l))).toEqual([]);
  });
});

describe('the trusted driver (LAND_TRUSTED)', () => {
  it('points every merge driver at the trusted checkout by absolute path', () => {
    const c = trustedGitConfig(SETUP_GIT_CONFIG, '/home/runner/work/dragoncss/dragoncss');
    expect(Object.fromEntries(c)).toMatchObject({
      'merge.dragon-floor.driver': "node '/home/runner/work/dragoncss/dragoncss/scripts/floor-merge.ts' %O %A %B %P",
      'merge.dragon-sorted.driver': "node '/home/runner/work/dragoncss/dragoncss/scripts/sorted-merge.ts' %O %A %B %P",
      'merge.dragon-generated.driver': 'true',
      'rerere.enabled': 'false',
    });
    expect(c.filter(([k]) => k.endsWith('.driver')).every(([, v]) => v === 'true' || v.startsWith("node '/home/runner/work/dragoncss/dragoncss/scripts/"))).toBe(true);
    expect(() => trustedGitConfig(SETUP_GIT_CONFIG, 'relative')).toThrow(/absolute path/);
    expect(() => trustedGitConfig(SETUP_GIT_CONFIG, "/a b/'c")).toThrow(/absolute path/);
    expect(() => trustedGitConfig([['merge.x.driver', 'sh tree/evil.sh %A']], '/m')).toThrow(/is not the trusted checkout's script/);
  });

  it('refuses any command outside the trusted checkout, and any package manager anywhere', () => {
    const id = (p: string): string => p.replace(/\/$/, '');
    expect(treeCodeRefusal(['/usr/bin/node', '/w/main/scripts/pr-review.ts', '5'], '/w/main/', '/w/main', id)).toBeNull();
    for (const pm of ['pnpm', 'npx', 'npm', '/usr/local/bin/pnpm', 'yarn']) expect(treeCodeRefusal([pm, '-s', 'pr:review'], '/w/main', '/w/main', id), pm).toMatch(/no package manager runs/);
    expect(treeCodeRefusal(['node', 'scripts/x.ts'], '/tmp/dragon-land', '/w/main', id)).toMatch(/LAND_TRUSTED: refusing to run node scripts\/x.ts in \/tmp\/dragon-land/);
  });

  it('every way land.ts runs a command goes through the refusal when trusted', () => {
    const src = readFileSync(repoPath('scripts/land.ts'), 'utf8');
    // run (and must, heavy) refuses first; the lane judgement, the installs and the main checkout's pull are trusted-aware.
    expect(src).toMatch(/const run = \(step: string, argv: string\[\], cwd: string, extraEnv: Record<string, string> = \{\}\): Run => \{\n {2}exitIfOrphaned\(\);\n {2}const refusal = TRUSTED \? treeCodeRefusal\(argv, cwd, MAIN, resolvePath\) : null;\n {2}if \(refusal !== null\) throw new Fatal\(refusal\);/);
    expect(src).toMatch(/if \(ran === null && TRUSTED\) throw new Fatal/);
    expect(src).toMatch(/const install = \(step: string, dir: string\): void => \{\n {2}if \(!TRUSTED\) must\(/);
    expect(src).toMatch(/if \(!TRUSTED\) \{\n {4}try \{\n {6}net\(git, \['pull', '-q', '--ff-only'\]\);/);
    // The only other processes it starts: git, gh, the trusted checkout's scripts (the reviewer, the builder and its watchdog)
    // and the land-lease helpers of a local run.
    const spawned = [...src.matchAll(/\b(?:spawnSync|spawn|execFileSync)\(\s*([^,]+),/g)].map((m) => m[1]!.trim());
    expect([...new Set(spawned)].sort()).toEqual(["'/bin/bash'", "'gh'", "'git'", "'pnpm'", "'ps'", 'argv[0]!', 'process.execPath'].sort());
    // pnpm directly only for the local lane judgement, behind the trusted refusal above.
    expect(src.match(/spawnSync\('pnpm'/g)).toHaveLength(1);
    // bash only for a local preparation's regen, which LAND_REGEN=ci-only (required by LAND_TRUSTED) never reaches.
    expect(src).toMatch(/if \(REGEN_ON !== 'local'\) \{[\s\S]{0,600}return \{ k, dir, done: '', log: '', pgid: 0, start: null, ci: \{ d, record \} \};\n {4}\}\n {4}const done = runFile/);
    expect(src).toMatch(/if \(TRUSTED && !CI_ONLY\) throw new Error/);
    // pr:review, the one command the driver runs in its own checkout, is the script itself with node when trusted.
    expect(src).toContain("const prReview = (): string[] => (TRUSTED ? [process.execPath, join(MAIN, 'scripts/pr-review.ts')] : ['pnpm', '-s', 'pr:review']);");
    expect(src.match(/'pr:review'/g)).toHaveLength(1);
    // Records go into a tree's worktree only through the no-follow writers, after the symlink check of the trees they come from.
    expect(src).not.toMatch(/(writeFileSync|copyFileSync|rmSync)\(join\(WT,/);
    expect(src.match(/writeInTree\(WT, p,/g)).toHaveLength(2);
    expect(src.match(/refuseRecordSymlinks\(\[/g)).toHaveLength(2);
    expect(src).toMatch(/\['core\.symlinks', 'false'\]/);
    // The token: read once, out of the environment, only to git push and gh.
    expect(src).toMatch(/const TOKEN = env\['LAND_TOKEN'\] \|\| null;\ndelete env\['LAND_TOKEN'\];/);
    expect(src.match(/withToken\(/g)!.length).toBe(2); // the driver's spawn and the builder's
  });
});

describe('the tree checks on CI (land-checks.yml)', () => {
  const want = { sha: sha('a'), checks: ['typecheck', 'stamp', 'lanes'] as const, devicesRun: null };
  const ok = { status: 0, stdout: 'ok', stderr: '' };
  it('dispatches with the previous position, the checks and a device run', () => {
    const w = checksWorkflow({ prev: sha('b'), checks: ['typecheck', 'stamp'], devicesRun: 42 });
    expect(w).toMatchObject({ workflow: 'land-checks.yml', artifact: 'land-checks', inputs: [`prev=${sha('b')}`, 'checks=typecheck,stamp', 'devices_run=42'] });
    expect(w.title(sha('c'))).toBe(`land checks of ${sha('c')}`);
    expect(titleOf('land-checks.yml', sha('c'))).toBe(checksTitle(sha('c')));
    expect(() => checksWorkflow({ prev: 'HEAD', checks: ['lanes'], devicesRun: null })).toThrow(/not a full sha/);
    expect(() => checksWorkflow({ prev: sha('b'), checks: [], devicesRun: null })).toThrow(/nothing to run/);
    expect(() => checksWorkflow({ prev: sha('b'), checks: [], devicesRun: 0 })).toThrow(/not a run id/);
    expect(checksBranch(sha('d'))).toBe(`land-checks/c-${sha('d').slice(0, 12)}`);
    expect(scratchRef(checksBranch(sha('d')))).toBe(`refs/heads/land-checks/c-${sha('d').slice(0, 12)}`);
    expect(staleScratchBranches(`x\trefs/heads/land-checks/c-${'d'.repeat(12)}\ny\trefs/heads/land-checks/other`)).toEqual([`land-checks/c-${'d'.repeat(12)}`]);
    expect(checksFiles(['result.json', 'outputs.patch'])).toEqual(['result.json', 'outputs.patch']);
    // A step the tree's commands ended leaves only outputs.patch: the driver then blames the tree.
    expect(checksFiles(['outputs.patch'])).toEqual(['outputs.patch']);
    expect(() => checksFiles(['result.json'])).toThrow(/not outputs.patch and result.json/);
    expect(() => checksFiles([])).toThrow(/holds nothing/);
    // A failed "Land checks" step is the tree's verdict; the other steps are setup.
    expect(VERDICT_STEP.test('Land checks')).toBe(true);
    expect(VERDICT_STEP.test('Check the inputs')).toBe(false);
    expect(VERDICT_STEP.test('Download the device outcomes')).toBe(false);
    expect(runIdOf('https://github.com/o/r/actions/runs/123')).toBe(123);
    expect(() => runIdOf('https://github.com/o/r/pull/1')).toThrow(/not a run URL/);
  });

  it('reads the results as data, checked against what was asked', () => {
    const all = { sha: sha('a'), install: ok, typecheck: { ...ok, status: 2 }, stamp: { ...ok, status: 1 }, lanes: ok };
    expect(parseChecksResult(JSON.stringify(all), want)).toMatchObject({ install: ok, typecheck: { status: 2 }, stamp: { status: 1 }, lanes: ok, merge: null });
    // A failed install ran nothing after it.
    expect(parseChecksResult(JSON.stringify({ sha: sha('a'), install: { ...ok, status: 1 } }), want)).toMatchObject({ install: { status: 1 }, typecheck: null });
    const bad: [unknown, RegExp][] = [
      [{ ...all, sha: sha('b') }, /is for "b{40}", not a{40}/],
      [{ ...all, lanes: undefined }, /has no lanes, which was asked for/],
      [{ ...all, extra: 1 }, /unknown fields extra/],
      [{ ...all, install: { status: 'x', stdout: '', stderr: '' } }, /install is not \{ status, stdout, stderr \}/],
      [{ ...all, merge: ok }, /has a device merge, but one was not asked for/],
    ];
    for (const [v, e] of bad) expect(() => parseChecksResult(JSON.stringify(v), want)).toThrow(e);
    expect(() => parseChecksResult(JSON.stringify(all), { ...want, checks: ['lanes'] })).toThrow(/has typecheck, which was not asked for/);
    const m = { ...want, checks: ['lanes'] as const, devicesRun: 9 };
    expect(parseChecksResult(JSON.stringify({ sha: sha('a'), install: ok, merge: { ...ok, status: 1 }, lanes: ok }), m)).toMatchObject({ merge: { status: 1 }, lanes: ok });
    // A refused merge (exit 3) ran no check after it.
    expect(parseChecksResult(JSON.stringify({ sha: sha('a'), install: ok, merge: { ...ok, status: 3 } }), m)).toMatchObject({ merge: { status: 3 }, lanes: null });
    expect(() => parseChecksResult(JSON.stringify({ sha: sha('a'), install: ok, lanes: ok }), m)).toThrow(/has no device merge, but one was asked for/);
    expect(() => parseChecksResult('[]', want)).toThrow(/not an object/);
  });
});

describe('the cross-host lock (refs/tags/land-lock) on a scratch repository', () => {
  const setup = () => {
    const dir = tempDir();
    const g = (cwd: string, args: string[], input?: string): string => execFileSync('git', ['-C', cwd, ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    execFileSync('git', ['init', '-q', '--bare', '-b', 'master', join(dir, 'origin.git')]);
    const mk = (name: string): ((args: string[], input?: string) => string) => {
      const c = join(dir, name);
      execFileSync('git', ['clone', '-q', join(dir, 'origin.git'), c], { stdio: 'ignore' });
      g(c, ['config', 'user.email', 't@t']);
      g(c, ['config', 'user.name', 't']);
      return (args, input) => g(c, args, input);
    };
    const a = mk('a');
    a(['commit', '-q', '--allow-empty', '-m', 'm']);
    a(['push', '-q', 'origin', 'HEAD:master']);
    return { a, b: mk('b'), origin: (args: string[]) => g(join(dir, 'origin.git'), args) };
  };
  const logs: string[] = [];
  const here = (o: { alive?: boolean; completed?: boolean } = {}) => ({ hostname: 'mac', alive: () => o.alive ?? true, runCompleted: () => o.completed ?? false });
  const mac = (pid: number) => lockHolder({}, { hostname: 'mac', pid, pidStart: 'Thu' }, '2026-10-08T00:00:00Z');
  const ci = lockHolder({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '77', GITHUB_REPOSITORY: 'o/r' }, { hostname: 'runner', pid: 1, pidStart: 'x' }, 't');

  it('lets one driver hold it, refuses a second while the first lives, and takes over from one that is gone', () => {
    const { a, b, origin } = setup();
    const tagA = takeLock({ git: a, me: mac(10), here: here(), now: () => 1_000_000, log: (l) => logs.push(l) });
    expect(origin(['rev-parse', 'refs/tags/land-lock'])).toBe(tagA);
    expect(origin(['cat-file', 'tag', 'refs/tags/land-lock'])).toContain('"pid":10');
    expect(() => takeLock({ git: b, me: ci, here: here(), now: () => 2_000_000, log: () => {} })).toThrow(/another landing driver holds refs\/tags\/land-lock: the driver pid 10 on mac/);
    // Its process gone on this host: taken over under the lease.
    const tagB = takeLock({ git: b, me: ci, here: here({ alive: false }), now: () => 3_000_000, log: (l) => logs.push(l) });
    expect(origin(['rev-parse', 'refs/tags/land-lock'])).toBe(tagB);
    expect(logs.some((l) => /held by the driver pid 10 on mac.*which is gone; taking it over/.test(l))).toBe(true);
    // The first holder's release does not delete the new holder's lock.
    releaseLock(a, tagA, (l) => logs.push(l));
    expect(origin(['rev-parse', 'refs/tags/land-lock'])).toBe(tagB);
    expect(logs.some((l) => /could not release/.test(l))).toBe(true);
    // A land.yml holder: held while its run lives, replaced once it completed.
    expect(() => takeLock({ git: a, me: mac(11), here: here(), now: () => 4_000_000, log: () => {} })).toThrow(/land.yml run 77 of o\/r/);
    const tagC = takeLock({ git: a, me: mac(11), here: here({ completed: true }), now: () => 5_000_000, log: () => {} });
    releaseLock(a, tagC, () => {});
    expect(() => origin(['rev-parse', '--verify', '-q', 'refs/tags/land-lock'])).toThrow();
  });

  it('a run that does not take the lock still refuses to start while a land.yml run holds it (read only)', () => {
    const { a, b, origin } = setup();
    const said: string[] = [];
    // No lock: nothing changes, and nothing is written to the remote.
    checkLockFree({ git: b, runCompleted: () => false, log: (l) => said.push(l) });
    expect(said).toEqual([]);
    const tag = takeLock({ git: a, me: ci, here: here(), now: () => 1_000_000, log: () => {} });
    expect(() => checkLockFree({ git: b, runCompleted: () => false, log: () => {} })).toThrow(/land.yml run 77 of o\/r .*holds refs\/tags\/land-lock and is still running/);
    checkLockFree({ git: b, runCompleted: () => true, log: (l) => said.push(l) });
    expect(said[0]).toMatch(/!!! refs\/tags\/land-lock is held by land.yml run 77/);
    expect(origin(['rev-parse', 'refs/tags/land-lock'])).toBe(tag);
    releaseLock(a, tag, () => {});
  });

  it('never judges a holder on another host, or an unreadable one, gone', () => {
    expect(lockStale(mac(5), { ...here({ alive: false }), hostname: 'other' })).toBe(false);
    expect(lockStale(null, here({ alive: false, completed: true }))).toBe(false);
    expect(lockStale(ci, here({ completed: true }))).toBe(true);
    expect(parseLockHolder('{"host":"actions","repo":"o/r","run":77,"started":"t"}')).toEqual({ host: 'actions', repo: 'o/r', run: 77, started: 't' });
    expect(parseLockHolder('{"host":"actions","repo":"o/r; x","run":77,"started":"t"}')).toBeNull();
    expect(parseLockHolder('not json')).toBeNull();
    expect(() => lockHolder({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: 'x', GITHUB_REPOSITORY: 'o/r' }, { hostname: 'h', pid: 1, pidStart: '' }, 't')).toThrow(/GITHUB_RUN_ID/);
    expect(lockTag(sha('a'), ci, 5)).toBe(`object ${sha('a')}\ntype commit\ntag land-lock\ntagger dragon landing driver <land@users.noreply.github.com> 5 +0000\n\n${JSON.stringify(ci)}\n`);
  });
});

describe('dispatching land.yml without letting GitHub drop a queued run', () => {
  const q = `b1:1:${sha('a')}`;
  // A fake GitHub: land.yml runs with their land job's status; a dispatch adds a run, and (as GitHub does) cancels an older
  // pending one; `race` makes another dispatcher's run appear right after ours.
  const fake = (runs: { id: number; status: string; job: string | null; conclusion?: string }[], o: { race?: boolean; startAfterMs?: number } = {}) => {
    let t = 0;
    let next = 100;
    const calls: string[] = [];
    const logs: string[] = [];
    let raced = false;
    const d: DispatchDeps = {
      repo: 'o/r',
      ref: 'master',
      self: 5,
      sleep: (ms) => {
        t += ms;
        // Time passes: a pending run starts once its turn comes.
        if (o.startAfterMs !== undefined && t >= o.startAfterMs) for (const r of runs) if (r.job === 'pending' && r.status !== 'completed') [r.job, r.status] = ['in_progress', 'in_progress'];
      },
      now: () => t,
      log: (l) => logs.push(l),
      waitS: 3600,
      watchS: 60,
      gh: (args) => {
        const path = args.find((a) => a.startsWith('repos/'))!;
        calls.push(`${args[1] === '-X' ? 'POST ' : ''}${path}`);
        if (path.includes('/workflows/land.yml/runs')) return JSON.stringify({ workflow_runs: runs.map((r) => ({ id: r.id, status: r.status })) });
        const jobs = /actions\/runs\/(\d+)\/jobs/.exec(path);
        if (jobs) {
          const r = runs.find((x) => x.id === Number(jobs[1]))!;
          return JSON.stringify({ jobs: r.job === null ? [] : [{ name: 'land', status: r.job }] });
        }
        if (path.endsWith('/dispatches')) {
          expect(args).toContain(`inputs[queue]=${q}`);
          for (const r of runs) if (r.status !== 'completed' && r.job === 'pending') Object.assign(r, { status: 'completed', conclusion: 'cancelled', job: 'completed' });
          const id = next++;
          runs.push({ id, status: 'queued', job: 'pending' });
          if (o.race && !raced) {
            raced = true;
            Object.assign(runs.at(-1)!, { status: 'completed', conclusion: 'cancelled', job: 'completed' });
            runs.push({ id: next++, status: 'queued', job: 'pending' });
          }
          return JSON.stringify({ workflow_run_id: id });
        }
        const run = /actions\/runs\/(\d+)$/.exec(path);
        if (run) {
          const r = runs.find((x) => x.id === Number(run[1]))!;
          return JSON.stringify({ id: r.id, status: r.status, conclusion: r.conclusion ?? null });
        }
        throw new Error(`unexpected gh ${args.join(' ')}`);
      },
    };
    return { d, calls, logs, runs, time: () => t };
  };

  it('dispatches at once when no land run waits to start (a running one, or this run itself, is no obstacle)', () => {
    const f = fake([{ id: 4, status: 'in_progress', job: 'in_progress' }, { id: 5, status: 'in_progress', job: 'completed' }]);
    expect(dispatchLand(q, f.d)).toBe(100);
    expect(f.calls.filter((c) => c.startsWith('POST'))).toEqual(['POST repos/o/r/actions/workflows/land.yml/dispatches']);
    expect(f.runs.find((r) => r.id === 4)!.status).toBe('in_progress');
  });

  it('waits while a land run waits to start, then dispatches once it has started', () => {
    const f = fake([{ id: 6, status: 'queued', job: 'pending' }], { startAfterMs: 180_000 });
    expect(dispatchLand(q, f.d)).toBe(100);
    expect(f.runs.find((r) => r.id === 6)).toMatchObject({ status: 'in_progress' });
    expect(f.logs.filter((l) => /run\(s\) 6 wait to start/.test(l))).toHaveLength(3);
  });

  it('dispatches again when a racing dispatch replaced its run, and gives up past the wait', () => {
    const r = fake([], { race: true, startAfterMs: 400_000 });
    expect(dispatchLand(q, r.d)).toBe(102);
    expect(r.logs).toContain('land.yml run 100 was cancelled before it started (another dispatch replaced it); dispatching again');
    const stuck = fake([{ id: 6, status: 'queued', job: 'pending' }]);
    expect(() => dispatchLand(q, { ...stuck.d, waitS: 120 })).toThrow(/run\(s\) 6 still wait to start after 120s/);
    expect(stuck.calls.some((c) => c.startsWith('POST'))).toBe(false);
    expect(() => dispatchLand('b1:x:y', r.d)).toThrow(/bad PR number/);
  });

  it('reads the runs and jobs GitHub returns', () => {
    expect(pendingRuns([{ id: 1, status: 'queued', landJob: null }, { id: 2, status: 'in_progress', landJob: 'pending' }, { id: 3, status: 'in_progress', landJob: 'in_progress' }, { id: 4, status: 'completed', landJob: null }, { id: 5, status: 'queued', landJob: 'queued' }], 5)).toEqual([1, 2]);
    expect(landJobStatus({ jobs: [{ name: 'redispatch', status: 'queued' }, { name: 'land', status: 'waiting' }] })).toBe('waiting');
    expect(landJobStatus({ jobs: [] })).toBeNull();
    expect(() => landJobStatus({})).toThrow(/not \{ jobs/);
    expect(workflowRuns([{ workflow_runs: [{ id: 1, status: 'queued' }] }])).toEqual([{ id: 1, status: 'queued' }]);
    expect(() => workflowRuns([{ workflow_runs: [{ id: '1', status: 'queued' }] }])).toThrow(/no id or status/);
  });
});

describe('land.yml\'s steps (scripts/land-actions.ts with a fake gh on PATH)', () => {
  it('builds the queue file and re-dispatches the rest only when the batch ended normally and no stop is set', () => {
    const dir = tempDir();
    // gh api: no land run listed, a dispatch returns run 77, which has started.
    writeFileSync(
      join(dir, 'gh'),
      `#!/bin/sh\nprintf '%s\\n' "$@" >> "${dir}/calls"\ncase "$*" in\n*issues/9/labels*) cat "${dir}/labels.json" ;;\n*land.yml/runs*) echo '{"workflow_runs":[]}' ;;\n*dispatches*) echo '{"workflow_run_id":77}' ;;\n*actions/runs/77*) echo '{"id":77,"status":"in_progress"}' ;;\nesac\n`,
      { mode: 0o755 },
    );
    const cli = (args: string[], extra: Record<string, string>) => {
      const env = { ...process.env, PATH: `${dir}:${process.env['PATH']}`, GITHUB_REPOSITORY: 'o/r', GITHUB_REF_NAME: 'master', GITHUB_RUN_ID: '5', GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary'), LAND_STOP_ISSUE: '', LAND_DISPATCH_WATCH: '1', ...extra };
      try {
        return { status: 0, out: execFileSync('node', [repoPath('scripts/land-actions.ts'), ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
      } catch (error) {
        return { status: (error as { status: number }).status, out: String((error as { stderr: unknown }).stderr) };
      }
    };
    const a = `b1:1:${sha('a')}`;
    expect(cli(['queue', join(dir, 'q.txt')], { LAND_QUEUE_INPUT: `${a} b2:2:${sha('b')}` }).status).toBe(0);
    expect(readFileSync(join(dir, 'q.txt'), 'utf8')).toBe(`${a}\nb2:2:${sha('b')}\n`);
    expect(readFileSync(join(dir, 'output'), 'utf8')).toBe('count=2\n');
    expect(cli(['queue', join(dir, 'bad.txt')], { LAND_QUEUE_INPUT: 'b1:x:abc' })).toMatchObject({ status: 1, out: expect.stringMatching(/bad PR number/) });
    const handoff = join(dir, 'handoff.json');
    writeFileSync(handoff, serializeHandoff({ remainder: [{ branch: 'b3', pr: 3, clean: sha('c') }], stopAsked: false, outage: null, fatal: null }));
    expect(cli(['redispatch', handoff], {})).toMatchObject({ status: 0, out: expect.stringMatching(/re-dispatched land.yml \(run 77\) on master/) });
    expect(readFileSync(join(dir, 'calls'), 'utf8')).toContain(`-X\nPOST\nrepos/o/r/actions/workflows/land.yml/dispatches\n-f\nref=master\n-f\ninputs[queue]=b3:3:${sha('c')}\n-F\nreturn_run_details=true\n`);
    rmSync(join(dir, 'calls'));
    writeFileSync(join(dir, 'labels.json'), JSON.stringify([[{ name: 'land-stop' }]]));
    expect(cli(['redispatch', handoff], { LAND_STOP_ISSUE: '9' })).toMatchObject({ status: 0, out: expect.stringMatching(/not re-dispatching: a stop was requested/) });
    expect(readFileSync(join(dir, 'calls'), 'utf8')).not.toContain('dispatches');
    expect(cli(['redispatch', join(dir, 'none.json')], {})).toMatchObject({ status: 0, out: expect.stringMatching(/no handoff/) });
    expect(cli(['dispatch', 'b4:4:abcdef1'], {})).toMatchObject({ status: 0, out: expect.stringMatching(/dispatched land.yml run 77 on master/) });
    expect(cli(['dispatch'], {})).toMatchObject({ status: 1, out: expect.stringMatching(/usage/) });
  });

  it('decides on the queue input and the re-dispatch', () => {
    const a = `b1:1:${sha('a')}`;
    expect(queueFromInput(`  ${a}   b2:2:${sha('b').slice(0, 12)}\r\n`)).toBe(`${a}\nb2:2:${sha('b').slice(0, 12)}\n`);
    expect(queueFromInput(' \n\t')).toBe('');
    expect(() => queueFromInput(`${a} b9:1:${sha('c')}`)).toThrow(/share a pr/);
    expect(() => queueFromInput(`${a} master:3:${sha('c')}`)).toThrow(/bad branch name/);
    const h = { remainder: [{ branch: 'b3', pr: 3, clean: sha('c') }], stopAsked: false, outage: null, fatal: null };
    expect(redispatchDecision(h, false)).toEqual({ dispatch: true, queue: `b3:3:${sha('c')}` });
    expect(redispatchDecision(h, true)).toMatchObject({ dispatch: false, why: expect.stringMatching(/stop was requested; still queued: #3/) });
    expect(redispatchDecision({ ...h, outage: 'runners down' }, false)).toMatchObject({ dispatch: false, why: expect.stringMatching(/CI outage: runners down/) });
    expect(redispatchDecision({ ...h, fatal: 'tree mismatch' }, false)).toMatchObject({ dispatch: false, why: expect.stringMatching(/stopped: tree mismatch/) });
    expect(redispatchDecision({ ...h, remainder: [] }, false)).toEqual({ dispatch: false, why: 'the queue is done' });
    expect(redispatchDecision(null, false)).toMatchObject({ dispatch: false, why: expect.stringMatching(/no handoff/) });
  });
});

describe('a tree\'s symlink never redirects a write of the driver', () => {
  const setup = () => {
    const dir = tempDir();
    const trusted = join(dir, 'trusted');
    mkdirSync(trusted);
    writeFileSync(join(trusted, 'package.json'), '{"scripts":{}}\n');
    const wt = join(dir, 'wt');
    mkdirSync(join(wt, 'packages/parity/out'), { recursive: true });
    return { dir, trusted, wt, trustedFile: join(trusted, 'package.json') };
  };

  it('refuses a planted symlink at the record, or at a directory above it, and leaves the trusted file unchanged', () => {
    const { trusted, wt, trustedFile } = setup();
    const rec = 'packages/parity/out/device-failures-ios.json';
    symlinkSync(trustedFile, join(wt, rec));
    expect(() => writeInTree(wt, rec, '{"scripts":{"pr:review":"curl evil"}}')).toThrow(/is a symlink; refusing to write it/);
    expect(() => readInTree(wt, rec)).toThrow(/is a symlink; refusing to read it/);
    expect(readFileSync(trustedFile, 'utf8')).toBe('{"scripts":{}}\n');
    // Removing it removes the link, never its target.
    removeInTree(wt, rec);
    expect(existsSync(join(wt, rec))).toBe(false);
    expect(readFileSync(trustedFile, 'utf8')).toBe('{"scripts":{}}\n');
    // A symlinked directory on the way.
    rmSync(join(wt, 'packages/parity/out'), { recursive: true });
    symlinkSync(trusted, join(wt, 'packages/parity/out'));
    expect(() => writeInTree(wt, 'packages/parity/out/package.json', 'x')).toThrow(/packages\/parity\/out is a symlink; refusing to write packages\/parity\/out\/package.json through it/);
    expect(() => removeInTree(wt, 'packages/parity/out/package.json')).toThrow(/is a symlink; refusing to remove/);
    expect(() => readInTree(wt, 'packages/parity/out/package.json')).toThrow(/is a symlink; refusing to read/);
    expect(readFileSync(trustedFile, 'utf8')).toBe('{"scripts":{}}\n');
    expect(() => writeInTree(wt, '../trusted/package.json', 'x')).toThrow(/not a plain relative path/);
    expect(() => writeInTree(wt, '/etc/x', 'x')).toThrow(/not a plain relative path/);
  });

  it('writes and reads a real file as usual, creating its directories', () => {
    const { wt } = setup();
    writeInTree(wt, 'packages/parity/out/new/lanes.json', '{"a":1}');
    expect(readInTree(wt, 'packages/parity/out/new/lanes.json')).toBe('{"a":1}');
    writeInTree(wt, 'packages/parity/out/new/lanes.json', '{}');
    expect(readInTree(wt, 'packages/parity/out/new/lanes.json')).toBe('{}');
    expect(lstatSync(join(wt, 'packages/parity/out/new')).isDirectory()).toBe(true);
  });

  it('finds symlinks in git listings, and refuses a regen or checks patch that plants one', () => {
    expect(symlinkEntries(`100644 ${'a'.repeat(40)} 0\tpackages/x.json\u0000120000 ${'b'.repeat(40)} 0\tpackages/parity/out\u0000`)).toEqual(['packages/parity/out']);
    expect(symlinkEntries(`120000 blob ${'b'.repeat(40)}\tpackages/l`)).toEqual([]);
    expect(symlinkEntries(`120000 ${'b'.repeat(40)}\tpackages/l\n`)).toEqual(['packages/l']);
    expect(patchHasSymlink('diff --git a/x b/x\nnew file mode 120000\nindex 0000000..1111111\n')).toBe(true);
    expect(patchHasSymlink('diff --git a/x b/x\nold mode 100644\nnew mode 120000\n')).toBe(true);
    expect(patchHasSymlink('diff --git a/x b/x\nindex 1111111..2222222 120000\n')).toBe(true);
    expect(patchHasSymlink('diff --git a/x b/x\nindex 1111111..2222222 100644\n+120000\n')).toBe(false);
    // git apply takes a CRLF patch, so its line ends must not hide the mode.
    expect(patchHasSymlink('diff --git a/x b/x\r\nnew file mode 120000\r\nindex 0000000..1111111\r\n')).toBe(true);
    expect(patchHasSymlink('diff --git a/x b/x\r\nindex 1111111..2222222 120000\r\n')).toBe(true);
    // On a scratch repository: the patch is refused before git apply, and the trusted file is untouched.
    const { dir, trustedFile } = setup();
    const repo = join(dir, 'repo');
    const g = (args: string[]): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    execFileSync('git', ['init', '-q', repo]);
    g(['config', 'user.email', 't@t']);
    g(['config', 'user.name', 't']);
    mkdirSync(join(repo, 'packages/parity/out'), { recursive: true });
    writeFileSync(join(repo, 'packages/parity/out/lanes.json'), '{}\n');
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'base']);
    const base = g(['rev-parse', 'HEAD']);
    rmSync(join(repo, 'packages/parity/out/lanes.json'));
    symlinkSync(trustedFile, join(repo, 'packages/parity/out/lanes.json'));
    g(['add', '-A']);
    const patch = join(dir, 'outputs.patch');
    writeFileSync(patch, execFileSync('git', ['-C', repo, 'diff', '--cached', '--binary', 'HEAD']));
    g(['reset', '-q', '--hard', base]);
    expect(readFileSync(patch, 'utf8')).toMatch(/new file mode 120000/);
    expect(() => applyRegenPatch(g, base, patch)).toThrow(/creates or keeps a symlink \(mode 120000\)/);
    expect(lstatSync(join(repo, 'packages/parity/out/lanes.json')).isSymbolicLink()).toBe(false);
    expect(readFileSync(trustedFile, 'utf8')).toBe('{"scripts":{}}\n');
    chmodSync(trustedFile, 0o444);
  });
});

describe('a PR whose own CI runs keep ending without a verdict is ejected (LAND_OUTAGE_EJECT)', () => {
  const ME = 900;
  const trusted = new Set([ME]);
  const sha = 'c'.repeat(40);
  let n = 0;
  const st = (state: string, at: string, o: { creator?: number | null; url?: string; description?: string; context?: string } = {}) => ({
    id: ++n,
    context: o.context ?? 'land/outage',
    state,
    created_at: at,
    target_url: o.url ?? `https://github.com/o/r/actions/runs/${n}`,
    description: o.description ?? state,
    creator: o.creator === null ? null : { id: o.creator ?? ME },
  });
  it('counts the builds since the last verdict: an outage, or a build a killed run left pending', () => {
    expect(outageStreak([], sha, trusted)).toEqual({ count: 0, runs: [] });
    const two = [st('error', '2026-10-08T03:00:00Z', { description: 'CI outage: runners down', url: 'https://r/3' }), st('pending', '2026-10-08T02:00:00Z', { url: 'https://r/2' }), st('success', '2026-10-08T01:00:00Z'), st('error', '2026-10-08T00:00:00Z')];
    expect(outageStreak(two, sha, trusted)).toEqual({ count: 2, runs: ['https://r/3 (CI outage: runners down)', 'https://r/2 (ended mid-build)'] });
    // A verdict since resets it; another context, another creator or none is not counted.
    expect(outageStreak([st('success', '2026-10-08T04:00:00Z'), ...two], sha, trusted).count).toBe(0);
    expect(outageStreak([st('error', '2026-10-08T05:00:00Z', { creator: 666 }), st('error', '2026-10-08T05:00:00Z', { creator: null }), st('error', '2026-10-08T05:00:00Z', { context: 'ci' }), st('success', '2026-10-08T04:00:00Z')], sha, trusted).count).toBe(0);
    expect(() => outageStreak({}, sha, trusted)).toThrow(/not a list/);
    expect(parseOutageEject(undefined)).toBe(2);
    expect(parseOutageEject('3')).toBe(3);
    expect(() => parseOutageEject('0')).toThrow(/LAND_OUTAGE_EJECT/);
  });
  it('writes the mark on the PR head as a commit status', () => {
    const calls: string[][] = [];
    writeOutage((a) => (calls.push(a), '{}'), 'o/r', sha, 'outage', `CI outage: ${'x'.repeat(300)}`, 'https://run');
    writeOutage((a) => (calls.push(a), '{}'), 'o/r', sha, 'building', 'building', null);
    expect(calls[0]!.slice(0, 8)).toEqual(['api', '-X', 'POST', `repos/o/r/statuses/${sha}`, '-f', 'state=error', '-f', 'context=land/outage']);
    expect(calls[0]!.find((x) => x.startsWith('description='))!.length).toBe('description='.length + 139);
    expect(calls[1]).toContain('state=pending');
    expect(calls[1]).not.toContain('-f target_url');
    expect(() => writeOutage(() => '', 'o/r', 'HEAD', 'verdict', 'x', null)).toThrow(/not a full sha/);
  });
  it('clears a streak at the PR\'s current head with a success status (pnpm land:clear-outage)', () => {
    const calls: string[] = [];
    const gh = (a: string[]): string => {
      calls.push(a.join(' '));
      if (a[1] === 'repos/o/r/pulls/7') return JSON.stringify({ state: 'open', head: { sha } });
      if (a[1] === 'user') return JSON.stringify({ id: 42, login: 'pm' });
      return '{}';
    };
    expect(clearOutage(gh, 'o/r', '7')).toEqual({ context: 'land/outage', head: sha, login: 'pm', id: 42 });
    expect(calls.at(-1)).toBe(`api -X POST repos/o/r/statuses/${sha} -f state=success -f context=land/outage -f description=cleared by pm after a GitHub outage (pnpm land:clear-outage)`);
    // As every status, it counts only from a trusted writer.
    const cleared = [st('success', '2026-10-08T06:00:00Z', { creator: 42 }), st('error', '2026-10-08T05:00:00Z')];
    expect(outageStreak(cleared, sha, trusted).count).toBe(1);
    expect(outageStreak(cleared, sha, new Set([ME, 42])).count).toBe(0);
    expect(() => clearOutage(gh, 'o/r', 'x')).toThrow(/not a PR number/);
    expect(() => clearOutage(() => JSON.stringify({ state: 'closed', head: { sha } }), 'o/r', '7')).toThrow(/is closed, not open/);
  });

  it('builds a PR alone once a build or proof of it ended without a verdict, so the next outage is pinned on it', () => {
    const e = (pr: number): Entry => ({ branch: `b${pr}`, pr, clean: 'a'.repeat(40) });
    const trace: string[] = [];
    const soloPrs = new Set([3]);
    const ops: BatchOps<{ pr: number }, { head: string }> = {
      admit: (x) => (trace.push(`admit #${x.pr}`), { ticket: { pr: x.pr } }),
      base: () => 'm',
      build: (prev, x) => ({ head: `${prev}+${x.pr}` }),
      verify: (built) => void trace.push(`batch ${built.map((b) => `#${b.entry.pr}`).join(' ')}`),
      prove: () => {},
      proveMaster: () => {},
      publish: () => 'merged',
      onFail: () => {},
      onOutcome: () => {},
      log: () => {},
      solo: (x) => soloPrs.has(x.pr),
    };
    runBatches([1, 2, 3, 4, 5].map(e), 4, ops);
    // #3 waits for the batch after #1 #2, is alone in its own, and #4 #5 follow it; it is never admitted twice.
    expect(trace.filter((t) => t.startsWith('batch'))).toEqual(['batch #1 #2', 'batch #3', 'batch #4 #5']);
    expect(trace.filter((t) => t === 'admit #3')).toHaveLength(1);
    soloPrs.add(1);
    trace.length = 0;
    runBatches([1, 2].map(e), 4, ops);
    expect(trace.filter((t) => t.startsWith('batch'))).toEqual(['batch #1', 'batch #2']);
  });

  it('is wired into the driver: each position build is marked, and admission ejects at the limit', () => {
    const src = readFileSync(repoPath('scripts/land.ts'), 'utf8');
    expect(src).toContain('const buildPosition = (prev: string, e: Entry, t: Ticket, k: number): Built => tracked(e, t, () => buildPositionHere(prev, e, t, k));');
    expect(src).toContain('=> tracked(it.entry, it.ticket, () => assemblePositionHere(prev, it, k, h));');
    expect(src).toMatch(/if \(error instanceof CiOutage\) putOutage\(t\.prHead, 'outage'/);
    expect(src).toMatch(/if \(streak\.count >= OUTAGE_EJECT\) throw new LandFailure\('ci-outage'/);
    // A completed run's unreadable results or refused patch are the PR's, not an outage.
    expect(src).toMatch(/throw new LandFailure\('checks', `the results of the tree checks \$\{r\.url\} do not read/);
    expect(src).toMatch(/if \(error instanceof PatchRefused\) throw new LandFailure\('checks'/);
    // The other two places a PR's tree runs: a prepared position's CI regen, marked on that PR; the full test of a position,
    // marked on every PR its tree holds (the chain up to it), then each of them built alone (solo).
    expect(src).toMatch(/await: \(h\) => \{\n {8}const it = items\[h\.k - 1\]!;\n {8}if \(CI_ONLY\) putOutage\(it\.ticket\.prHead, 'building'[\s\S]{0,200}awaitPrepared\(h\);\n {8}\} catch \(error\) \{\n {10}if \(CI_ONLY && error instanceof CiOutage\) putOutage\(it\.ticket\.prHead, 'outage'/);
    expect(src).toMatch(/const members = CI_ONLY && k >= 0 \? chain\.slice\(0, k \+ 1\) : \[\];/);
    expect(src).toMatch(/if \(error instanceof CiOutage\) for \(const m of members\) putOutage\(m\.prHead, 'outage'/);
    expect(src).toMatch(/chain = built\.map\(/);
    expect(src.match(/\bsolo\b(?=[,\s}])/g)!.length).toBeGreaterThanOrEqual(2); // the driver's ops and the builder's
    expect(src).toMatch(/return readOutageStreak\(gh, REPO, pr\.headOid, PROOF_WRITERS\)\.count > 0;/);
  });
});
