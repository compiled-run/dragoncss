import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  backoffMs,
  baseAction,
  ciState,
  ciStep,
  claudeReviewGate,
  type Entry,
  Fatal,
  findingsComment,
  floorRegressions,
  isFloorFile,
  isQuiet,
  clearStaleQuiet,
  releaseQuiet,
  requestQuiet,
  waitForQuiet,
  isTransient,
  isUnreviewed,
  LandFailure,
  parseLandArgs,
  parseQueue,
  parseReview,
  REVIEW_PROMPT,
  type ReviewRecord,
  reviewedPatch,
  parseChildPrs,
  retargetChildrenThenDelete,
  reviewerEnv,
  reviewVerdict,
  runQueue,
  runReviewer,
  splitPatch,
  statusText,
  withRetry,
  worktreesOf,
} from '../../../scripts/land-lib.ts';
import { commitRegen, type Member, memberTip, mergeMember, predictPosition, tipProblem, treeMatches } from '../../../scripts/merge-train-lib.ts';
import { parseIgnoreFile } from '../../../scripts/macroscope-ignore.ts';
import { type CheckRun, type Git, ignoreAt, regenOnlyProblems } from '../../../scripts/pr-review-vouch.ts';
import { parseLanesForStamp, stampProblems } from '../../../scripts/evidence-stamp.ts';
import { lookupReview } from '../../../scripts/land-review-lookup.ts';
import { deviceEvidence } from '../src/device-evidence.ts';
import { LANES_JSON, type LanesFile } from '../src/lanes.ts';
import { repoPath } from '../src/paths.ts';

const sha = (c: string): string => c.repeat(40);
const temps: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'land-'));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe('the landing queue', () => {
  it('reads one <branch>:<pr>:<clean-head> per line, in order, with comments and blanks', () => {
    const q = parseQueue(`# today\nfeat/a:12:${sha('a')}\n\n  b-2:7:abc1234   # short sha\n`);
    expect(q).toEqual([
      { branch: 'feat/a', pr: 12, clean: sha('a') },
      { branch: 'b-2', pr: 7, clean: 'abc1234' },
    ]);
  });

  it('rejects train lines, malformed lines, duplicates and an empty queue', () => {
    expect(() => parseQueue(`train one\na:1:${sha('a')}\n`)).toThrow(/trains are gone/);
    expect(() => parseQueue('a:1\n')).toThrow(/not <branch>:<pr>:<clean-head>/);
    expect(() => parseQueue(`master:1:${sha('a')}\n`)).toThrow(/bad branch/);
    expect(() => parseQueue(`a..b:1:${sha('a')}\n`)).toThrow(/bad branch/);
    expect(() => parseQueue(`a:0:${sha('a')}\n`)).toThrow(/bad PR/);
    expect(() => parseQueue('a:1:ABCDEF12\n')).toThrow(/clean head/);
    expect(() => parseQueue('a:1:abc12\n')).toThrow(/clean head/);
    expect(() => parseQueue(`a:1:${sha('a')}\nb:1:${sha('b')}\n`)).toThrow(/share a pr/);
    expect(() => parseQueue(`a:1:${sha('a')}\na:2:${sha('b')}\n`)).toThrow(/share a branch/);
    expect(() => parseQueue('# nothing\n\n')).toThrow(/no entries/);
  });

  it('parses the command line strictly', () => {
    expect(parseLandArgs(['q.txt'])).toEqual({ queue: 'q.txt', dryRun: false });
    expect(parseLandArgs(['--dry-run', 'q.txt'])).toEqual({ queue: 'q.txt', dryRun: true });
    expect(() => parseLandArgs([])).toThrow(/usage/);
    expect(() => parseLandArgs(['q', 'r'])).toThrow(/one queue file/);
    expect(() => parseLandArgs(['--from', 'q'])).toThrow(/unknown option/);
  });
});

describe('retries of network calls', () => {
  const failing = (stderr: string) => Object.assign(new Error('Command failed: gh api'), { stderr: Buffer.from(stderr) });

  it('retries a transient error 3 times with backoff, then gives up', () => {
    const slept: number[] = [];
    let calls = 0;
    expect(() =>
      withRetry(
        'gh api',
        () => {
          calls++;
          throw failing('net/http: TLS handshake timeout');
        },
        (ms) => slept.push(ms),
      ),
    ).toThrow(/gh api/);
    expect(calls).toBe(4);
    expect(slept).toEqual([backoffMs(1), backoffMs(2), backoffMs(3)]);
    expect(slept[0]! < slept[1]! && slept[1]! < slept[2]!).toBe(true);
  });

  it('returns once a retry succeeds, and never retries a real failure', () => {
    let calls = 0;
    expect(withRetry('git fetch', () => (++calls < 3 ? (() => { throw failing('HTTP 502: Bad Gateway'); })() : 'ok'), () => {})).toBe('ok');
    expect(calls).toBe(3);
    calls = 0;
    expect(() => withRetry('git push', () => { calls++; throw failing('! [rejected] x -> x (non-fast-forward)'); }, () => {})).toThrow();
    expect(calls).toBe(1);
  });

  it('tells transient errors from real ones', () => {
    for (const t of ['net/http: TLS handshake timeout', 'HTTP 503', 'gh: Service Unavailable', 'fatal: unable to access: Could not resolve host: github.com', 'error: RPC failed; curl 92', 'read: connection reset by peer', 'i/o timeout', 'HTTP 500: Internal Server Error']) {
      expect(isTransient(failing(t)), t).toBe(true);
    }
    for (const t of ['GraphQL: Could not resolve to a PullRequest with the number of 999', 'HTTP 404: Not Found', 'HTTP 422: Validation Failed', '! [rejected] (non-fast-forward)', 'merge conflict']) {
      expect(isTransient(failing(t)), t).toBe(false);
    }
  });
});

describe('CI, base, worktree and quiet decisions', () => {
  const ci = (status: string, conclusion: string | null, url = 'u'): CheckRun => ({ name: 'checks', status, conclusion, html_url: url });
  const other: CheckRun = { name: 'Macroscope - Correctness Check', status: 'completed', conclusion: 'failure', html_url: 'm' };

  it('needs every "checks" run of the commit (push and pull_request) to succeed', () => {
    expect(ciState([other])).toEqual({ state: 'none' });
    expect(ciState([ci('completed', 'success'), other])).toEqual({ state: 'success' });
    expect(ciState([ci('completed', 'success', 'push'), ci('completed', 'success', 'pr')])).toEqual({ state: 'success' });
    expect(ciState([ci('completed', 'success', 'push'), ci('in_progress', null, 'pr')])).toEqual({ state: 'pending' });
    expect(ciState([ci('completed', 'success', 'push'), ci('completed', 'failure', 'pr')])).toEqual({ state: 'failure', conclusions: ['failure pr'] });
    expect(ciState([ci('in_progress', null), ci('completed', 'cancelled', 'x')]).state).toBe('failure');
    expect(ciState([ci('completed', 'skipped')]).state).toBe('failure');
  });

  it('lets a CONFLICTING PR with no CI run on its clean head through to the build, and nothing else', () => {
    const limits = { appearS: 900, waitS: 5400 };
    const none = ciState([other]);
    const failed = ciState([ci('completed', 'failure', 'f')]);
    // Conflicting and no CI run: GitHub runs none, so the build proceeds without waiting.
    expect(ciStep(none, 0, limits, true)).toBe('skip');
    // Conflicting but its CI run failed: the PR fails.
    expect(ciStep(failed, 0, limits, true)).toEqual({ fail: 'did not succeed: failure f' });
    // Conflicting with a run still going: wait for its verdict.
    expect(ciStep(ciState([ci('in_progress', null)]), 0, limits, true)).toBe('wait');
    expect(ciStep(ciState([ci('completed', 'success')]), 0, limits, true)).toBe('success');
    // Mergeable (or the landing commit, where conflicting is never passed) and no CI run: wait, then fail closed as before.
    expect(ciStep(none, 899, limits, false)).toBe('wait');
    expect(ciStep(none, 900, limits, false)).toEqual({ fail: 'has no CI checks run after 900s' });
    expect(ciStep(none, 900, limits)).toEqual({ fail: 'has no CI checks run after 900s' });
    expect(ciStep(failed, 0, limits, false)).toEqual({ fail: 'did not succeed: failure f' });
    expect(ciStep(ciState([ci('queued', null)]), 5400, limits)).toEqual({ fail: 'CI checks still pending after 5400s' });
  });

  it('retargets a landed parent (or its review/* copy) to master, and fails on a parent still open', () => {
    expect(baseAction('master', null)).toBe('ready');
    expect(baseAction('review/x', true)).toBe('retarget');
    expect(baseAction('review/x', false)).toEqual({ fail: expect.stringMatching(/land its parent first/) });
    expect(baseAction('feat/parent', true)).toBe('retarget');
    expect(baseAction('feat/parent', false)).toEqual({ fail: expect.stringMatching(/land its parent first/) });
    expect(baseAction('gone', null)).toEqual({ fail: expect.stringMatching(/no longer exists/) });
  });

  it('finds a member\'s worktrees by branch or commit, never the main checkout or the driver\'s', () => {
    const porcelain = [
      'worktree /repo\nHEAD ' + sha('1') + '\nbranch refs/heads/master',
      'worktree /tmp/dragon-land\nHEAD ' + sha('2') + '\ndetached',
      'worktree /tmp/w-a\nHEAD ' + sha('3') + '\nbranch refs/heads/feat/a',
      'worktree /private/tmp/w-b\nHEAD ' + sha('4') + '\ndetached',
      'worktree /tmp/w-c\nHEAD ' + sha('5') + '\nbranch refs/heads/feat/ab',
    ].join('\n\n');
    expect(worktreesOf(porcelain, 'feat/a', [sha('4'), sha('2')], ['/repo', '/tmp/dragon-land'])).toEqual(['/tmp/w-a', '/private/tmp/w-b']);
    expect(worktreesOf(porcelain, 'master', [], ['/repo'])).toEqual([]);
  });

  it('waits for a quiet machine: no other heavy job and load under 20', () => {
    expect(isQuiet(0, 19.9)).toBe(true);
    expect(isQuiet(1, 2)).toBe(false);
    expect(isQuiet(0, 20)).toBe(false);
  });

  it('holds the quiet request while it waits, and drops it when the wait ends, quiet or not', () => {
    const path = join(tempDir(), 'dragon-train-quiet');
    let clock = 0;
    const held: boolean[] = [];
    const wait = (quietAt: number, ceilingMs: number, quiet?: () => boolean) =>
      waitForQuiet({
        quiet: quiet ?? (() => (held.push(existsSync(path)), clock >= quietAt)),
        request: () => requestQuiet(path, 4242),
        release: () => releaseQuiet(path, 4242),
        sleep: (ms) => (clock += ms),
        now: () => clock,
        ceilingMs,
        pollMs: 1000,
      });
    // Quiet after 3 polls: the request was held on every poll and is gone when the rerun starts.
    expect(wait(3000, 10_000)).toBe(true);
    expect(held).toEqual([true, true, true, true]);
    expect(existsSync(path)).toBe(false);
    // Never quiet: fails at the ceiling instead of hanging, and still drops the request.
    clock = 0;
    expect(wait(Number.POSITIVE_INFINITY, 5000)).toBe(false);
    expect(clock).toBe(5000);
    expect(existsSync(path)).toBe(false);
    // A failure while waiting drops it too.
    expect(() => wait(0, 5000, () => { throw new Error('readdir failed'); })).toThrow('readdir failed');
    expect(existsSync(path)).toBe(false);
  });

  it('never removes another process\'s quiet request, and clears one whose driver is gone', () => {
    const path = join(tempDir(), 'dragon-train-quiet');
    requestQuiet(path, 7);
    releaseQuiet(path, 8);
    expect(readFileSync(path, 'utf8')).toBe('7');
    expect(clearStaleQuiet(path, () => true)).toBe(false);
    expect(existsSync(path)).toBe(true);
    expect(clearStaleQuiet(path, () => false)).toBe(true);
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, 'garbage');
    expect(clearStaleQuiet(path, () => true)).toBe(true);
    expect(clearStaleQuiet(path, () => true)).toBe(false);
    releaseQuiet(path, 7);
  });

  it('reads pr:review\'s UNREVIEWED banner, which pr-review.ts prints', () => {
    const banner = '!!! UNREVIEWED: Macroscope spending limit.';
    expect(readFileSync(repoPath('scripts/pr-review.ts'), 'utf8')).toContain('!!! UNREVIEWED: Macroscope spending limit. Every Macroscope check');
    expect(isUnreviewed(`PR #1 at x\n\n${banner} Every Macroscope check of x was skipped\n`)).toBe(true);
    expect(isUnreviewed('PR #1 at x\nChecks:\n  success\tchecks\n')).toBe(false);
    expect(isUnreviewed('a finding body quoting "!!! UNREVIEWED: Macroscope spending limit"')).toBe(false);
  });
});

// A diff the shape `gh pr diff` prints: a source file, a test, a generated output, a binary file and a deleted source.
const PATCH = [
  'diff --git a/scripts/tool.ts b/scripts/tool.ts\nindex 1..2 100644\n--- a/scripts/tool.ts\n+++ b/scripts/tool.ts\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n',
  'diff --git a/packages/x/test/t.test.ts b/packages/x/test/t.test.ts\nnew file mode 100644\nindex 0..3\n--- /dev/null\n+++ b/packages/x/test/t.test.ts\n@@ -0,0 +1 @@\n+it("x", () => {});\n',
  'diff --git a/packages/parity/out/lanes.json b/packages/parity/out/lanes.json\nindex 4..5 100644\n--- a/packages/parity/out/lanes.json\n+++ b/packages/parity/out/lanes.json\n@@ -1 +1 @@\n-{}\n+{"a":1}\n',
  'diff --git a/vendor/fonts/x.ttf b/vendor/fonts/x.ttf\nindex 6..7 100644\nBinary files a/vendor/fonts/x.ttf and b/vendor/fonts/x.ttf differ\n',
  'diff --git a/docs/img.png b/docs/img.png\nnew file mode 100644\nindex 0..8\nGIT binary patch\nliteral 3\nKcmZ?\n\n',
  'diff --git a/scripts/old.ts b/scripts/old.ts\ndeleted file mode 100644\nindex 9..0\n--- a/scripts/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const old = 1;\n',
].join('');
const IGNORE = parseIgnoreFile('---\nignoreTests: false\n---\nout/**\n**/out/**\n**/vendor/**\n');

describe('the reviewed part of a PR diff', () => {
  it('splits a diff by file and keeps source and tests, never ignored outputs or binaries', () => {
    expect(splitPatch(PATCH).map((f) => f.path)).toEqual(['scripts/tool.ts', 'packages/x/test/t.test.ts', 'packages/parity/out/lanes.json', 'vendor/fonts/x.ttf', 'docs/img.png', 'scripts/old.ts']);
    const r = reviewedPatch(PATCH, (p) => IGNORE.matches(p));
    expect(r.paths).toEqual(['scripts/tool.ts', 'packages/x/test/t.test.ts', 'scripts/old.ts']);
    expect(r.text).toContain('+export const a = 2;');
    expect(r.text).toContain('-export const old = 1;');
    expect(r.text).not.toContain('lanes.json');
    expect(splitPatch('')).toEqual([]);
  });

  it('refuses a diff it cannot split, rather than reviewing part of it', () => {
    expect(() => splitPatch('hello\ndiff --git a/x b/x\n')).toThrow(/does not start/);
    expect(() => splitPatch('diff --git "a/x y" "b/x y"\n')).toThrow(/unparsable/);
  });
});

const finding = (severity: string, extra: Record<string, unknown> = {}) => ({ severity, file: 'scripts/tool.ts', line: 3, summary: 'drops an error', failure_scenario: 'gh fails, the step passes', ...extra });

describe('the Claude reviewer\'s output', () => {
  it('accepts exactly {"findings": [...]}, fenced or not', () => {
    expect(parseReview('{"findings": []}')).toEqual({ ok: true, findings: [] });
    expect(parseReview(`\`\`\`json\n${JSON.stringify({ findings: [finding('High')] })}\n\`\`\`\n`)).toEqual({ ok: true, findings: [{ ...finding('high') }] });
    expect(parseReview(JSON.stringify({ findings: [finding('medium', { line: null })] }))).toMatchObject({ ok: true, findings: [{ line: null }] });
  });

  it('treats anything else as malformed', () => {
    const bad = [
      '',
      'No issues found.',
      'Here you go: {"findings": []}',
      '{"findings": {}}',
      '{"issues": []}',
      '{"findings": [], "note": "x"}',
      JSON.stringify({ findings: [finding('severe')] }),
      JSON.stringify({ findings: [finding('high', { file: '' })] }),
      JSON.stringify({ findings: [finding('high', { line: '3' })] }),
      JSON.stringify({ findings: [finding('high', { line: 1.5 })] }),
      JSON.stringify({ findings: [finding('high', { summary: ' ' })] }),
      JSON.stringify({ findings: [finding('high', { failure_scenario: undefined })] }),
      JSON.stringify({ findings: ['high'] }),
    ];
    for (const b of bad) expect(parseReview(b).ok, b).toBe(false);
  });

  it('stops on any Medium+ finding or a failed run, and lets Low findings through', () => {
    const ok = (stdout: string) => ({ status: 0, signal: null, stdout, stderr: '' });
    expect(reviewVerdict(ok('{"findings": []}'))).toEqual({ pass: true, findings: [], note: 'no findings' });
    expect(reviewVerdict(ok(JSON.stringify({ findings: [finding('low')] })))).toMatchObject({ pass: true, note: '1 Low finding(s), not blocking' });
    for (const s of ['medium', 'high', 'critical']) expect(reviewVerdict(ok(JSON.stringify({ findings: [finding('low'), finding(s)] }))).pass, s).toBe(false);
    expect(reviewVerdict(ok('not json'))).toMatchObject({ pass: false, reason: expect.stringMatching(/did not print JSON/) });
    expect(reviewVerdict({ status: 1, signal: null, stdout: '{"findings": []}', stderr: 'auth' })).toMatchObject({ pass: false, reason: expect.stringMatching(/exit 1: auth/) });
    expect(reviewVerdict({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' })).toMatchObject({ pass: false });
    expect(reviewVerdict({ status: null, signal: null, stdout: '', stderr: '', error: 'spawnSync /bin/sh ETIMEDOUT' })).toMatchObject({ pass: false });
  });

  it('names each blocking finding in the PR comment', () => {
    const c = findingsComment(5, sha('c'), [finding('low', { summary: 'nit' }), finding('high'), finding('medium', { line: null, file: 'a.ts' })] as never);
    expect(c).toContain('**high** `scripts/tool.ts:3`: drops an error');
    expect(c).toContain('**medium** `a.ts`');
    expect(c).not.toContain('nit');
  });
});

describe('the Claude review gate with a fake reviewer command', () => {
  const dir = tempDir();
  // A fake reviewer: saves the prompt it reads on stdin, then prints a canned answer (or fails).
  const fake = (name: string, body: string): string => {
    const path = join(dir, `${name}.sh`);
    writeFileSync(path, `#!/bin/sh\ncat > "${dir}/${name}.prompt"\n${body}\n`);
    return `sh ${path}`;
  };
  const gate = (command: string, patch = PATCH, timeoutMs = 20_000) => {
    const saved: ReviewRecord[] = [];
    const verdict = claudeReviewGate({
      pr: 9,
      head: sha('d'),
      patch,
      ignored: (p) => IGNORE.matches(p),
      command,
      review: (input) => runReviewer(command, input, dir, timeoutMs),
      save: (r) => saved.push(r),
    });
    return { verdict, saved };
  };

  it('passes a clean review, sends only the reviewed diff, and records the review', () => {
    const { verdict, saved } = gate(fake('clean', `echo '{"findings": []}'`));
    expect(verdict.pass).toBe(true);
    const prompt = readFileSync(join(dir, 'clean.prompt'), 'utf8');
    expect(prompt.startsWith(REVIEW_PROMPT)).toBe(true);
    expect(prompt).toContain('+export const a = 2;');
    expect(prompt).not.toContain('lanes.json');
    expect(prompt).not.toContain('GIT binary patch');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ pr: 9, head: sha('d'), verdict: 'pass', paths: ['scripts/tool.ts', 'packages/x/test/t.test.ts', 'scripts/old.ts'], findings: [] });
  });

  it('stops on a Medium finding and records it', () => {
    const { verdict, saved } = gate(fake('medium', `echo '${JSON.stringify({ findings: [finding('Medium')] })}'`));
    expect(verdict).toMatchObject({ pass: false, reason: '1 finding(s) of Medium severity or higher' });
    expect(saved[0]).toMatchObject({ verdict: 'fail', findings: [{ severity: 'medium', file: 'scripts/tool.ts' }] });
  });

  it('fails on malformed output, a non-zero exit and a timeout, never passing them', () => {
    expect(gate(fake('prose', `echo 'Looks good to me!'`)).verdict.pass).toBe(false);
    expect(gate(fake('half', `printf '{"findings": ['`)).verdict.pass).toBe(false);
    expect(gate(fake('empty', 'true')).verdict.pass).toBe(false);
    const exit = gate(fake('exit', `echo '{"findings": []}'; echo 'rate limited' >&2; exit 3`));
    expect(exit.verdict).toMatchObject({ pass: false, reason: expect.stringMatching(/exit 3: rate limited/) });
    expect(exit.saved[0]).toMatchObject({ verdict: 'fail', stderr: 'rate limited\n' });
    expect(gate(fake('slow', `sleep 5; echo '{"findings": []}'`), PATCH, 500).verdict.pass).toBe(false);
    expect(gate('/nonexistent/claude -p').verdict.pass).toBe(false);
  });

  it('runs no reviewer for a diff with no reviewed path', () => {
    const outputsOnly = splitPatch(PATCH)[2]!.text;
    const { verdict, saved } = gate(fake('never', 'exit 1'), outputsOnly);
    expect(verdict).toEqual({ pass: true, findings: [], note: 'no reviewed path in the diff' });
    expect(saved[0]).toMatchObject({ verdict: 'pass', paths: [] });
    expect(() => readFileSync(join(dir, 'never.prompt'))).toThrow();
  });
});

describe('the queue loop', () => {
  const e = (pr: number): Entry => ({ branch: `b${pr}`, pr, clean: sha('a') });

  it('records a failed PR, reports it, and continues with the next', () => {
    const reported: string[] = [];
    const r = runQueue(
      [e(1), e(2), e(3), e(4)],
      (x) => {
        if (x.pr === 2) throw new LandFailure('test', 'pnpm test failed', 'comment');
        if (x.pr === 3) throw new Error('gh: HTTP 404');
        return { result: x.pr === 4 ? 'merged before' : 'landed', detail: 'ok' };
      },
      (x, f) => reported.push(`#${x.pr} ${f.step}: ${f.message}`),
      () => {},
    );
    expect(r.outcomes.map((o) => `${o.entry.pr} ${o.result}`)).toEqual(['1 landed', '2 failed', '3 failed', '4 merged before']);
    expect(reported).toEqual(['#2 test: pnpm test failed', '#3 error: gh: HTTP 404']);
    expect(r).toMatchObject({ fatal: null, exit: 1 });
  });

  it('exits 0 only when every PR landed or was merged before', () => {
    expect(runQueue([e(1), e(2)], (x) => ({ result: x.pr === 1 ? 'landed' : 'merged before', detail: '' }), () => {}, () => {}).exit).toBe(0);
  });

  it('stops the whole queue on a fatal error', () => {
    const seen: number[] = [];
    const r = runQueue(
      [e(1), e(2), e(3)],
      (x) => {
        seen.push(x.pr);
        if (x.pr === 2) throw new Fatal('master differs from the landing commit');
        return { result: 'landed', detail: '' };
      },
      () => {},
      () => {},
    );
    expect(seen).toEqual([1, 2]);
    expect(r).toMatchObject({ fatal: 'master differs from the landing commit', exit: 1 });
  });

  it('writes a status naming each PR\'s outcome and failing step', () => {
    const outcomes = [
      { entry: e(1), result: 'landed' as const, detail: 'merged as x' },
      { entry: e(2), result: 'failed' as const, step: 'claude-review', detail: '1 finding(s)' },
    ];
    const s = statusText({ queue: 'q', startedAt: 't0', now: 't1', running: null, outcomes, fatal: null, total: 2, done: true });
    expect(s).toContain('land DONE t1');
    expect(s).toContain('landed #1 b1: merged as x');
    expect(s).toContain('FAILED #2 b2 at claude-review: 1 finding(s)');
    expect(s).toContain('1 PR(s) failed');
    expect(statusText({ queue: 'q', startedAt: 't0', now: 't1', running: e(3), outcomes: [], fatal: null, total: 3, done: false })).toContain('landing now: #3 b3');
  });
});

describe('a landing commit on a scratch repository', () => {
  const dir = tempDir();
  const config = ['user.name=t', 'user.email=t@t', 'commit.gpgsign=false', 'core.hooksPath=/dev/null'].flatMap((c) => ['-c', c]);
  const git: Git = (args, input) => execFileSync('git', [...config, ...args], { cwd: dir, input, stdio: ['pipe', 'pipe', 'pipe'] });
  const commit = (files: Record<string, string>, m: string): string => {
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), body);
    }
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', m]);
    return git(['rev-parse', 'HEAD']).toString().trim();
  };
  const lines = (tag: string): string => Array.from({ length: 12 }, (_, i) => `export const ${tag}${i} = ${i};\n`).join('');
  git(['init', '-q', '-b', 'master']);
  const base = commit({ '.macroscope/ignore.md': '---\nignoreTests: false\n---\n**/out/**\ndocs/goals/**\n', 'src/a.ts': lines('a'), 'src/b.ts': lines('b'), 'out/x.json': '0\n' }, 'base');
  git(['checkout', '-q', '-b', 'a']);
  const clean = commit({ 'src/a.ts': lines('a').replace('a3 = 3', 'a3 = 33') }, 'a change');
  git(['checkout', '-q', 'master']);
  const master = commit({ 'src/b.ts': lines('b').replace('b9 = 9', 'b9 = 99') }, 'another PR landed');
  const m: Member = { branch: 'a', pr: 4, clean };
  const land = (prev: string, tip: string, out: string): { merge: string; head: string } => {
    const merge = mergeMember(git, prev, m, 1, tip, 'Land');
    writeFileSync(join(dir, 'out/x.json'), out);
    return { merge, head: commitRegen(git, 1, m, ['pnpm regen'], 'Land') };
  };
  const first = land(master, clean, '1\n');

  it('merges the PR into master and adds one regen-only commit, which pr:review will vouch for', () => {
    expect(git(['log', '-2', '--format=%s', first.head]).toString().trim().split('\n')).toEqual(['Land: regenerate after merging a (#4)', 'Land: merge a (#4)']);
    const ignore = ignoreAt(git, first.head);
    if ('error' in ignore) throw new Error(ignore.error);
    expect(regenOnlyProblems(git, first.head, ignore)).toEqual([]);
    expect(predictPosition(git, m, { prev: master, merge: first.merge, head: first.head, tip: clean }).ok).toBe(true);
    expect(treeMatches(git, first.head, first.merge)).toEqual({ ok: false, paths: ['out/x.json'] });
  });

  it('builds again on a PR head an earlier landing pushed, and refuses any other commit above the clean head', () => {
    // The earlier landing commit was pushed but failed later (say CI); master has moved since.
    git(['checkout', '-q', 'master']);
    const moved = commit({ 'docs/goals/board.md': 'PM\n' }, 'board');
    expect(tipProblem(git, m, first.head)).toBeNull();
    expect(memberTip(git, m, first.head)).toBe(first.head);
    const again = land(moved, first.head, '2\n');
    expect(git(['rev-list', '--parents', '-n', '1', again.merge]).toString().trim().split(' ').slice(1)).toEqual([moved, first.head]);
    git(['checkout', '-q', '--detach', first.head]);
    const sneaky = commit({ 'src/a.ts': 'unreviewed\n' }, 'Fix after review');
    expect(tipProblem(git, m, sneaky)).toMatch(/did not make/);
    expect(base).not.toBe(master);
  });
});

describe('pnpm evidence:stamp --compare', () => {
  const committed = JSON.parse(readFileSync(repoPath(LANES_JSON), 'utf8')) as LanesFile;
  // The committed file with every device lane stamped as this tree would stamp it.
  const current = (): LanesFile => {
    const f = structuredClone(committed) as unknown as { targets: { target: 'ios' | 'android'; lanes: { where: string; state: string; evidence: unknown }[] }[] };
    for (const t of f.targets) for (const l of t.lanes) if (l.where === 'device' && l.state !== 'not run') l.evidence = { ...deviceEvidence(t.target) };
    return f as unknown as LanesFile;
  };

  it('is equal when every device lane that ran carries this tree\'s stamp', () => {
    expect(stampProblems(parseLanesForStamp(current(), 'test'))).toEqual([]);
  });

  it('differs when a stamp is another tree\'s, missing, or no device lane ran', () => {
    const other = current() as unknown as { targets: { target: string; lanes: { lane: string; where: string; state: string; evidence: Record<string, string> | null }[] }[] };
    const ios = other.targets.find((t) => t.target === 'ios')!;
    const lane = ios.lanes.find((l) => l.where === 'device' && l.state !== 'not run')!;
    lane.evidence = { ...lane.evidence!, app: 'f'.repeat(64) };
    expect(stampProblems(other as unknown as LanesFile)).toEqual([expect.stringMatching(new RegExp(`ios ${lane.lane} evidence is stale: app ffffffffffff`))]);
    lane.evidence = null;
    expect(stampProblems(other as unknown as LanesFile)).toEqual([expect.stringMatching(/the record has no evidence stamp/)]);
    const none = current() as unknown as { targets: { target: string; lanes: { where: string; state: string; evidence: unknown }[] }[] };
    for (const l of none.targets.find((t) => t.target === 'android')!.lanes) if (l.where === 'device') Object.assign(l, { state: 'not run', evidence: null });
    expect(stampProblems(none as unknown as LanesFile)).toContain(`${LANES_JSON}: android has no device lane that ran`);
  });

  it('refuses a lanes file it cannot read, rather than calling it different', () => {
    expect(() => parseLanesForStamp({}, 'x')).toThrow(/not \{ targets/);
    expect(() => parseLanesForStamp({ targets: [{ target: 'ios', lanes: [{ lane: 'device-frames', where: 'device', state: 'pass', caseListSha256: 'x', evidence: { app: 1 } }] }] }, 'x')).toThrow(/evidence/);
    expect(() => parseLanesForStamp({ targets: [{ target: 'ios', lanes: [{ lane: 'device-frames' }] }] }, 'x')).toThrow(/lane is not/);
  });
});

describe('the precomputed review lookup (the default reviewer)', () => {
  const dir = tempDir();
  const head = sha('e');
  const write = (pr: number, body: unknown): void => writeFileSync(join(dir, `${pr}.json`), typeof body === 'string' ? body : JSON.stringify(body));
  // The real script, run the way the driver runs it: through sh, prompt on stdin, PR and clean head in the environment.
  const command = `node --conditions=dragon-internal '${repoPath('scripts/land-review-lookup.ts')}'`;
  const gate = (pr: number, cleanHead = head) => {
    const saved: ReviewRecord[] = [];
    const verdict = claudeReviewGate({
      pr,
      head: sha('f'),
      // Larger than a pipe buffer, so the lookup must drain stdin for the driver's write to succeed.
      patch: PATCH + PATCH.split('diff --git').slice(1, 2).map((s) => `diff --git${s.replace('scripts/tool.ts', 'scripts/big.ts').replace('+export const a = 2;\n', `${'+export const big = 1;\n'.repeat(4000)}`)}`).join(''),
      ignored: (p) => IGNORE.matches(p),
      command,
      review: (input) => runReviewer(command, input, dir, 60_000, { ...reviewerEnv(pr, cleanHead), LAND_REVIEW_PRECOMPUTED_DIR: dir }),
      save: (r) => saved.push(r),
    });
    return { verdict, saved };
  };

  it('passes a review of this PR at its clean head with no findings', () => {
    write(21, { pr: 21, head, findings: [] });
    const { verdict, saved } = gate(21);
    expect(verdict).toEqual({ pass: true, findings: [], note: 'no findings' });
    expect(saved[0]!.stdout.trim()).toBe('{"findings":[]}');
  });

  it('stops on a Medium finding', () => {
    write(22, { pr: 22, head, findings: [finding('medium')] });
    expect(gate(22).verdict).toMatchObject({ pass: false, reason: '1 finding(s) of Medium severity or higher', findings: [{ severity: 'medium' }] });
  });

  it('fails closed on a missing file, a stale head, another PR and malformed JSON', () => {
    const missing = gate(23);
    expect(missing.verdict).toMatchObject({ pass: false, reason: expect.stringMatching(/exit 1: land-review-lookup: no precomputed review/) });
    write(24, { pr: 24, head: sha('0'), findings: [] });
    expect(gate(24).verdict).toMatchObject({ pass: false, reason: expect.stringMatching(/the review is stale/) });
    write(25, { pr: 26, head, findings: [] });
    expect(gate(25).verdict).toMatchObject({ pass: false, reason: expect.stringMatching(/reviews PR 26, not #25/) });
    write(27, '{"pr": 27, "head": "');
    expect(gate(27).verdict).toMatchObject({ pass: false, reason: expect.stringMatching(/is not JSON/) });
    write(28, { pr: 28, head, findings: [finding('urgent')] });
    expect(gate(28).verdict).toMatchObject({ pass: false, reason: expect.stringMatching(/severity "urgent"/) });
  });

  it('checks its inputs', () => {
    const ok = JSON.stringify({ pr: 3, head, findings: [] });
    expect(lookupReview(ok, 'p', '3', head)).toEqual({ ok: true, output: '{"findings":[]}' });
    expect(lookupReview(ok, 'p', undefined, head)).toMatchObject({ ok: false, error: expect.stringMatching(/LAND_REVIEW_PR/) });
    expect(lookupReview(ok, 'p', '3', 'abc1234')).toMatchObject({ ok: false, error: expect.stringMatching(/LAND_REVIEW_HEAD/) });
    expect(lookupReview(null, 'p', '3', head)).toMatchObject({ ok: false, error: expect.stringMatching(/no precomputed review/) });
    expect(lookupReview(JSON.stringify({ pr: 3, head: head.slice(0, 12), findings: [] }), 'p', '3', head)).toMatchObject({ ok: false, error: expect.stringMatching(/not a full sha/) });
    expect(lookupReview(JSON.stringify({ pr: '3', head, findings: [] }), 'p', '3', head)).toMatchObject({ ok: false });
    expect(lookupReview(JSON.stringify({ pr: 3, head, findings: [], verdict: 'pass' }), 'p', '3', head)).toMatchObject({ ok: false, error: expect.stringMatching(/exactly/) });
    expect(lookupReview(JSON.stringify({ pr: 3, head }), 'p', '3', head)).toMatchObject({ ok: false });
  });
});

describe('deleting a merged branch only after its child PRs move to master', () => {
  // A fake gh over a set of open PRs and their bases; `failEdit` PRs refuse the retarget, `stick` PRs accept it but keep their base.
  const fakeGh = (prs: Record<number, string>, opts: { failEdit?: number[]; stick?: number[]; failList?: boolean; failDelete?: boolean } = {}) => {
    const calls: string[] = [];
    let deleted: string | null = null;
    const gh = (args: string[]): string => {
      calls.push(args.join(' '));
      const flag = (name: string): string => args[args.indexOf(name) + 1]!;
      if (args[0] === 'pr' && args[1] === 'list') {
        if (opts.failList) throw Object.assign(new Error('Command failed'), { stderr: 'HTTP 404: Not Found' });
        return JSON.stringify(Object.entries(prs).filter(([, b]) => b === flag('--base')).map(([n, b]) => ({ number: Number(n), baseRefName: b })));
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        const n = Number(args[2]);
        if (opts.failEdit?.includes(n)) throw Object.assign(new Error('Command failed'), { stderr: 'GraphQL: Resource not accessible' });
        if (!opts.stick?.includes(n)) prs[n] = flag('--base');
        return '';
      }
      if (args[0] === 'api' && args[2] === 'DELETE') {
        if (opts.failDelete) throw Object.assign(new Error('Command failed'), { stderr: 'HTTP 422: Reference does not exist' });
        deleted = args[3]!;
        return '';
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    };
    return { gh, calls, prs, deleted: () => deleted };
  };
  const run = (f: ReturnType<typeof fakeGh>) => {
    const lines: string[] = [];
    return { r: retargetChildrenThenDelete({ repo: 'o/r', branch: 'land-5b', gh: f.gh, log: (l) => lines.push(l) }), lines };
  };

  it('retargets every open child PR to master, logs each, then deletes the branch last', () => {
    const f = fakeGh({ 127: 'land-5b', 128: 'land-5b', 130: 'master', 131: 'other' });
    const { r, lines } = run(f);
    expect(r).toEqual({ retargeted: [127, 128], deleted: true, problems: [] });
    expect(f.prs).toEqual({ 127: 'master', 128: 'master', 130: 'master', 131: 'other' });
    expect(lines).toEqual(['  #127 was based on land-5b; retargeted to master', '  #128 was based on land-5b; retargeted to master', '  deleted branch land-5b']);
    expect(f.deleted()).toBe('repos/o/r/git/refs/heads/land-5b');
    expect(f.calls.at(-1)).toBe('api -X DELETE repos/o/r/git/refs/heads/land-5b');
    expect(f.calls.findIndex((c) => c.startsWith('api'))).toBeGreaterThan(f.calls.findLastIndex((c) => c.startsWith('pr edit')));
  });

  it('deletes a branch with no child PRs', () => {
    const f = fakeGh({ 5: 'master' });
    expect(run(f).r).toEqual({ retargeted: [], deleted: true, problems: [] });
  });

  it('keeps the branch when a retarget fails, still moving the others, and reports it', () => {
    const f = fakeGh({ 127: 'land-5b', 128: 'land-5b' }, { failEdit: [127] });
    const { r } = run(f);
    expect(r.deleted).toBe(false);
    expect(r.retargeted).toEqual([128]);
    expect(r.problems).toEqual(['kept branch land-5b so no PR based on it is closed', '#127 is based on land-5b and could not be retargeted to master: GraphQL: Resource not accessible']);
    expect(f.deleted()).toBeNull();
  });

  it('keeps the branch when a child is still based on it after the retarget, or the list cannot be read', () => {
    const stuck = fakeGh({ 127: 'land-5b' }, { stick: [127] });
    expect(run(stuck).r).toMatchObject({ deleted: false, problems: ['kept branch land-5b so no PR based on it is closed', 'open PRs still based on land-5b: #127'] });
    expect(stuck.deleted()).toBeNull();
    const unlisted = fakeGh({ 127: 'land-5b' }, { failList: true });
    expect(run(unlisted).r).toMatchObject({ deleted: false, problems: [expect.stringMatching(/kept branch land-5b: could not list/)] });
    expect(unlisted.calls.some((c) => c.startsWith('pr edit') || c.startsWith('api'))).toBe(false);
  });

  it('reports a failed delete after the retargets', () => {
    const f = fakeGh({ 127: 'land-5b' }, { failDelete: true });
    expect(run(f).r).toEqual({ retargeted: [127], deleted: false, problems: ['could not delete branch land-5b: HTTP 422: Reference does not exist'] });
  });

  it('checks gh pr list output', () => {
    expect(parseChildPrs('[{"number":3,"baseRefName":"b"}]', 'b')).toEqual([3]);
    expect(() => parseChildPrs('[{"number":3,"baseRefName":"c"}]', 'b')).toThrow();
    expect(() => parseChildPrs('{}', 'b')).toThrow();
    expect(() => parseChildPrs('[{"number":"3","baseRefName":"b"}]', 'b')).toThrow();
  });
});

describe('floors may only rise (the landing commit against master)', () => {
  const j = (v: unknown): string => JSON.stringify(v);
  const P1 = 'packages/translate/test/p1-floor.json';
  const suites = { p1: { order: ['vectors', 'units'], counts: { vectors: 258, units: 320000 } }, extended: { order: ['vectors-m1', 'vectors-m2'], counts: { 'vectors-m1': 10, 'vectors-m2': 249 } } };
  const NAMES = 'packages/dragon/test/seams-floor.json';
  const names = { longhands: ['display', 'position', 'top'], inherited: ['color', 'font-size'] };

  it('finds every floor file and the glyph clearance pins, nothing else', () => {
    for (const p of [P1, NAMES, 'packages/parity/test/css-escapes-floor.json', 'packages/parity/test/glyph-clearance-pins.json', 'packages/new/test/x-floor.json']) expect(isFloorFile(p), p).toBe(true);
    for (const p of ['packages/translate/test/floor.ts', 'packages/parity/out/lanes.json', 'packages/x/test/sub/y-floor.json', 'docs/a-floor.json']) expect(isFloorFile(p), p).toBe(false);
  });

  it('fails a lowered count, naming its key (the #72 case: vectors-m2 249 -> 241)', () => {
    const lowered = structuredClone(suites);
    lowered.extended.counts['vectors-m2'] = 241;
    expect(floorRegressions(P1, j(suites), j(lowered))).toEqual([`${P1}: extended.counts.vectors-m2: lowered 249 -> 241`]);
    const css = 'packages/parity/test/css-escapes-floor.json';
    expect(floorRegressions(css, j({ background: 227, border: 197 }), j({ background: 226, border: 197 }))).toEqual([`${css}: background: lowered 227 -> 226`]);
  });

  it('fails a removed name, suite, count or key', () => {
    expect(floorRegressions(NAMES, j(names), j({ ...names, longhands: ['display', 'top'] }))).toEqual([`${NAMES}: longhands: "position" removed`]);
    expect(floorRegressions(NAMES, j(names), j({ longhands: names.longhands }))).toEqual([`${NAMES}: inherited: removed`]);
    const noSuite = { ...suites, extended: { order: ['vectors-m1'], counts: { 'vectors-m1': 10 } } };
    expect(floorRegressions(P1, j(suites), j(noSuite))).toEqual([`${P1}: extended.order: "vectors-m2" removed`, `${P1}: extended.counts.vectors-m2: removed (was 249)`]);
  });

  it('fails a reordered ordered list', () => {
    expect(floorRegressions(NAMES, j(names), j({ ...names, longhands: ['position', 'display', 'top'] }))).toEqual([`${NAMES}: longhands: "position" now comes before "display"`]);
    const swapped = { ...suites, p1: { ...suites.p1, order: ['units', 'vectors'] } };
    expect(floorRegressions(P1, j(suites), j(swapped))).toEqual([`${P1}: p1.order: "units" now comes before "vectors"`]);
  });

  it('accepts additions anywhere and raised counts', () => {
    const more = { p1: { order: ['vectors', 'units', 'hit'], counts: { vectors: 300, units: 320000, hit: 5 } }, extended: suites.extended, rt: { order: ['a'], counts: { a: 1 } } };
    expect(floorRegressions(P1, j(suites), j(more))).toEqual([]);
    expect(floorRegressions(NAMES, j(names), j({ longhands: ['display', 'float', 'position', 'top', 'left'], inherited: names.inherited, 'role:item': ['order'] }))).toEqual([]);
  });

  it('accepts a floor master does not have, and fails one the landing commit removes', () => {
    expect(floorRegressions('packages/x/test/new-floor.json', null, j({ a: ['b'] }))).toEqual([]);
    expect(floorRegressions(P1, j(suites), null)).toEqual([`${P1}: removed (it is on master)`]);
    expect(floorRegressions(P1, j(suites), '{')).toEqual([expect.stringMatching(/not JSON/)]);
    expect(floorRegressions(P1, j({ odd: { x: 'y' } }), j({ odd: { x: 'y' } }))).toEqual([`${P1}: odd: a floor shape the driver cannot judge`]);
  });

  it('judges the glyph clearance pins by direction: rescued may not fall, dropped may not rise, new cases are free', () => {
    const PINS = 'packages/parity/test/glyph-clearance-pins.json';
    const pins = { a: { 'ios@3': { dropped: { edge: 2 }, rescued: { edge: 1 } } } };
    const at = (dropped: Record<string, number>, rescued: Record<string, number>) => j({ a: { 'ios@3': { dropped, rescued } } });
    expect(floorRegressions(PINS, j(pins), at({ edge: 1 }, { edge: 2 }))).toEqual([]);
    expect(floorRegressions(PINS, j(pins), j({ ...pins, b: { 'ios@2': { dropped: { edge: 9 }, rescued: {} } } }))).toEqual([]);
    expect(floorRegressions(PINS, j(pins), at({ edge: 3 }, { edge: 1 }))).toEqual([`${PINS}: a ios@3 dropped.edge: raised 2 -> 3`]);
    expect(floorRegressions(PINS, j(pins), at({ edge: 2, 'edge:glyph': 1 }, { edge: 1 }))).toEqual([`${PINS}: a ios@3 dropped.edge:glyph: raised 0 -> 1`]);
    expect(floorRegressions(PINS, j(pins), at({ edge: 2 }, {}))).toEqual([`${PINS}: a ios@3 rescued.edge: lowered 1 -> 0`]);
    expect(floorRegressions(PINS, j(pins), j({}))).toEqual([`${PINS}: a ios@3 rescued.edge: lowered 1 -> 0`]);
  });

  it('reads every floor file in this tree, and finds none below itself', () => {
    const files = execFileSync('git', ['ls-files', 'packages'], { cwd: repoPath('.'), encoding: 'utf8' }).split('\n').filter(isFloorFile);
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const t = readFileSync(repoPath(f), 'utf8');
      expect(floorRegressions(f, t, t), f).toEqual([]);
    }
  });
});
