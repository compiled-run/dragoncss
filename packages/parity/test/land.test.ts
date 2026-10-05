import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  backoffMs,
  baseAction,
  type BatchOps,
  bisectPrefixes,
  ciState,
  ciStep,
  claudeReviewGate,
  type Entry,
  Fatal,
  findingsComment,
  floorRegressions,
  isFloorFile,
  failingTestFiles,
  isQuiet,
  ignoredFilesArgs,
  ignoredToRemove,
  clearStaleQuiet,
  releaseQuiet,
  requestQuiet,
  waitForQuiet,
  isTransient,
  isUnreviewed,
  LandFailure,
  cleanUpAfterDriver,
  clearsUnproved,
  interruptedStatus,
  lockState,
  MERGES_LOG,
  parseBatchSize,
  parseLstart,
  parseMerges,
  parsePidFile,
  parsePublishMark,
  parseUnproved,
  proveRestingMaster,
  PUBLISH_MARK,
  provedTree,
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
  runBatches,
  runQueue,
  runReviewer,
  splitPatch,
  statusText,
  withRetry,
  worktreesOf,
} from '../../../scripts/land-lib.ts';
import { commitRegen, type Member, memberTip, mergeMember, planPositions, predictPosition, tipProblem, treeMatches } from '../../../scripts/merge-train-lib.ts';
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

  it('reads the failing test files from a vitest log, and refuses a log with no summary', () => {
    const log = [
      ' \x1b[31mFAIL\x1b[39m ',
      ' FAIL  packages/translate/test/translate.test.ts > differential corpus > is deterministic',
      'Error: Test timed out in 120000ms.',
      ' FAIL  packages/parity/test/lanes.test.ts > committed out/lanes.json > every device lane ran',
      ' FAIL  packages/translate/test/translate.test.ts > subset > accepts',
      ' FAIL  packages/parity/test/lanes-concurrent.test.ts [ packages/parity/test/lanes-concurrent.test.ts ]',
      '',
      ' Test Files  3 failed | 180 passed (183)',
      '      Tests  4 failed | 4800 passed (4804)',
    ].join('\n');
    expect(failingTestFiles(log)).toEqual(['packages/parity/test/lanes-concurrent.test.ts', 'packages/parity/test/lanes.test.ts', 'packages/translate/test/translate.test.ts']);
    expect(failingTestFiles('\x1b[1m Test Files \x1b[22m 1 passed (1)\n')).toEqual([]);
    // Killed or crashed before the summary: no list to trust.
    expect(failingTestFiles(' FAIL  packages/parity/test/lanes.test.ts > x\n')).toBeNull();
  });

  it('holds the quiet request while it waits, and drops it when the wait ends unless asked to hold it through the rerun', () => {
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
    // With hold (the driver's rerun): a quiet result keeps the request held so nothing starts beside the rerun; the caller
    // releases it. A failed wait still drops it.
    const holding = (quietAt: number, ceilingMs: number) =>
      waitForQuiet({
        quiet: () => clock >= quietAt,
        request: () => requestQuiet(path, 4242),
        release: () => releaseQuiet(path, 4242),
        sleep: (ms) => (clock += ms),
        now: () => clock,
        ceilingMs,
        pollMs: 1000,
        hold: true,
      });
    clock = 0;
    expect(holding(2000, 10_000)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('4242');
    releaseQuiet(path, 4242);
    expect(existsSync(path)).toBe(false);
    clock = 0;
    expect(holding(Number.POSITIVE_INFINITY, 3000)).toBe(false);
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

describe('batched landing (runBatches with fakes)', () => {
  const e = (pr: number): Entry => ({ branch: `b${pr}`, pr, clean: sha('a') });
  type Pos = { head: string; prev: string; prs: number[] };
  // A fake driver: master is the list of landed PRs; a position's tree is the PRs merged into it; `broken` PRs fail any proof
  // of a tree that holds them, `conflicts` fail their build, and `reject`/`publishFail` fail admission or publishing.
  const harness = (
    o: { broken?: number[]; conflicts?: number[]; reject?: number[]; publishFail?: number[]; fatalAt?: number; merged?: number[]; masterRed?: boolean; fixedBy?: [number, number]; installFails?: string } = {},
  ) => {
    const master: number[] = [];
    const trace: string[] = [];
    const failures: string[] = [];
    const mergedBefore = new Set(o.merged ?? []);
    const name = (prs: number[]): string => (prs.length === 0 ? 'master' : `m+${prs.join('+')}`);
    const heads = new Map<string, number[]>();
    const ops: BatchOps<{ pr: number }, Pos> = {
      admit: (x, earlier) => {
        trace.push(`admit #${x.pr}${earlier.length ? ` after ${earlier.map((y) => `#${y.pr}`).join(' ')}` : ''}`);
        if (mergedBefore.has(x.pr)) return { merged: 'merged as x' };
        if (o.reject?.includes(x.pr)) throw new LandFailure('claude-review-before', `#${x.pr} has a Medium finding at its head`);
        return { ticket: { pr: x.pr } };
      },
      base: () => {
        const h = name(master);
        heads.set(h, [...master]);
        return h;
      },
      build: (prev, x, t, k) => {
        trace.push(`build #${x.pr} at ${k} on ${prev}`);
        if (t.pr !== x.pr) throw new Error('ticket mixed up');
        if (o.conflicts?.includes(x.pr)) throw new LandFailure('merge', `merging b${x.pr} failed; conflicts in src/a.ts`);
        const prs = [...heads.get(prev)!, x.pr];
        const head = name(prs);
        heads.set(head, prs);
        return { head, prev, prs };
      },
      verify: (built) => {
        trace.push(`verify ${built.map((b) => b.position.head).join(' ')}`);
        built.forEach((b, i) => expect(b.position.prev).toBe(i === 0 ? name(master) : built[i - 1]!.position.head));
      },
      prove: (p) => {
        trace.push(`prove ${p.head}`);
        if (o.installFails === p.head) throw new LandFailure('install', 'pnpm install --frozen-lockfile exited 1: ECONNRESET');
        if (o.masterRed) throw new LandFailure('test', `pnpm test on ${p.head} failed: t0.test.ts`);
        const bad = p.prs.filter((n) => o.broken?.includes(n));
        // `fixedBy` [a, b]: PR a breaks a test that PR b fixes, so only a tree with a and without b fails.
        if (o.fixedBy && p.prs.includes(o.fixedBy[0]) && !p.prs.includes(o.fixedBy[1])) bad.push(o.fixedBy[0]);
        if (bad.length > 0) throw new LandFailure('test', `pnpm test on ${p.head} failed: 2 files (t${bad.join(',t')}.test.ts)`);
      },
      proveMaster: (m) => {
        trace.push(`prove master ${m}`);
        if (o.masterRed) throw new LandFailure('test', `pnpm test on master failed: t0.test.ts`);
      },
      publish: (x, p) => {
        trace.push(`publish #${x.pr}`);
        if (o.fatalAt === x.pr) throw new Fatal(`#${x.pr} merged, but master differs`);
        // The merge gate: master holds exactly the previous position.
        expect(heads.get(p.prev)).toEqual(master);
        if (o.publishFail?.includes(x.pr)) throw new LandFailure('ci', `#${x.pr} landing commit CI failed`);
        master.push(x.pr);
        return `merged at ${p.head}`;
      },
      onFail: (x, f) => failures.push(`#${x.pr} ${f.step}: ${f.message}`),
      onOutcome: () => {},
      log: () => {},
    };
    return { ops, master, trace, failures };
  };
  const results = (r: { outcomes: { entry: Entry; result: string; step?: string }[] }): string[] => r.outcomes.map((x) => `#${x.entry.pr} ${x.result}${x.step ? ` at ${x.step}` : ''}`);

  it('proves a batch once and publishes each PR in order at its own position', () => {
    const h = harness();
    const r = runBatches([e(1), e(2), e(3), e(4)], 4, h.ops);
    expect(results(r)).toEqual(['#1 landed', '#2 landed', '#3 landed', '#4 landed']);
    expect(h.trace.filter((t) => t.startsWith('prove'))).toEqual(['prove m+1+2+3+4']);
    expect(h.trace.filter((t) => t.startsWith('build'))).toEqual(['build #1 at 1 on master', 'build #2 at 2 on m+1', 'build #3 at 3 on m+1+2', 'build #4 at 4 on m+1+2+3']);
    expect(h.master).toEqual([1, 2, 3, 4]);
    expect(r).toMatchObject({ fatal: null, exit: 0 });
  });

  it('splits a long queue into batches of the given size, each built on the master the one before left', () => {
    const h = harness();
    const r = runBatches([1, 2, 3, 4, 5].map(e), 2, h.ops);
    expect(results(r).every((x) => x.endsWith('landed'))).toBe(true);
    expect(h.trace.filter((t) => t.startsWith('prove'))).toEqual(['prove m+1+2', 'prove m+1+2+3+4', 'prove m+1+2+3+4+5']);
    expect(h.trace).toContain('build #3 at 1 on m+1+2');
  });

  it('bisects a failing batch: finds the culprit in log2(n) more proofs, lands the PRs before it and requeues the rest', () => {
    const h = harness({ broken: [4] });
    const r = runBatches([1, 2, 3, 4, 5].map(e), 5, h.ops);
    // Top (5) fails; then positions 2 and 3 pass and 4 fails: 3 more proofs, ceil(log2 5).
    expect(h.trace.filter((t) => t.startsWith('prove')).slice(0, 4)).toEqual(['prove m+1+2+3+4+5', 'prove m+1+2', 'prove m+1+2+3', 'prove m+1+2+3+4']);
    expect(results(r)).toEqual(['#1 landed', '#2 landed', '#3 landed', '#4 failed at test', '#5 landed']);
    // The culprit gets its own failing run (its position's), not the top's, and the bisect that found it.
    expect(h.failures).toEqual([expect.stringMatching(/^#4 test: pnpm test on m\+1\+2\+3\+4 failed: 2 files \(t4\.test\.ts\)\n\nFound by bisecting the batch #1 #2 #3 #4 #5 \(4 proofs\): master with #1 #2 #3 passes, adding #4 fails\.$/)]);
    // #5 is rebuilt on the new master without #4, and proved on its own tree.
    expect(h.trace.slice(-4)).toEqual(['build #5 at 1 on m+1+2+3', 'verify m+1+2+3+5', 'prove m+1+2+3+5', 'publish #5']);
    expect(h.master).toEqual([1, 2, 3, 5]);
    expect(r.exit).toBe(1);
  });

  it('finds a culprit in the first position, and fails a batch of one with no bisect', () => {
    const h = harness({ broken: [1] });
    const r = runBatches([1, 2, 3].map(e), 3, h.ops);
    expect(results(r)).toEqual(['#1 failed at test', '#2 landed', '#3 landed']);
    expect(h.failures[0]).toMatch(/master passes, adding #1 fails/);
    // Position 1 fails, so master is proved before #1 is blamed.
    expect(h.trace.filter((t) => t.startsWith('prove')).slice(0, 3)).toEqual(['prove m+1+2+3', 'prove m+1', 'prove master master']);
    const one = harness({ broken: [7] });
    expect(results(runBatches([e(7)], 4, one.ops))).toEqual(['#7 failed at test']);
    expect(one.trace.filter((t) => t.startsWith('prove'))).toEqual(['prove m+7', 'prove master master']);
    expect(one.failures).toEqual(['#7 test: pnpm test on m+7 failed: 2 files (t7.test.ts)']);
  });

  it('ejects a PR whose merge conflicts and builds the next one on the position before it', () => {
    const h = harness({ conflicts: [2] });
    const r = runBatches([1, 2, 3].map(e), 3, h.ops);
    expect(results(r)).toEqual(['#2 failed at merge', '#1 landed', '#3 landed']);
    expect(h.trace).toContain('build #3 at 2 on m+1');
    expect(h.trace.filter((t) => t.startsWith('prove'))).toEqual(['prove m+1+3']);
  });

  it('ejects a PR whose review is not clean for its head before any build, and fills the batch from the queue', () => {
    const h = harness({ reject: [2], merged: [3] });
    const r = runBatches([1, 2, 3, 4, 5].map(e), 2, h.ops);
    expect(results(r).slice(0, 2)).toEqual(['#2 failed at claude-review-before', '#3 merged before']);
    expect(h.trace.some((t) => t.startsWith('build #2'))).toBe(false);
    expect(h.trace.filter((t) => t.startsWith('verify'))).toEqual(['verify m+1 m+1+4', 'verify m+1+4+5']);
    // Admission sees the PRs admitted before it in the same batch (a child PR may be based on one of their branches).
    expect(h.trace.filter((t) => t.startsWith('admit'))).toEqual(['admit #1', 'admit #2 after #1', 'admit #3 after #1', 'admit #4 after #1', 'admit #5']);
    expect(h.failures).toEqual(['#2 claude-review-before: #2 has a Medium finding at its head']);
  });

  it('stops a batch at a failed publish and requeues every PR after it, the culprit too (its verdict assumed that prefix)', () => {
    const h = harness({ publishFail: [2], broken: [4] });
    const r = runBatches([1, 2, 3, 4].map(e), 4, h.ops);
    expect(results(r)).toEqual(['#1 landed', '#2 failed at ci', '#3 landed', '#4 failed at test']);
    // Never published on a master that lacks the previous position (the fake publish checks it), and #3 was rebuilt without #2.
    expect(h.trace).toContain('build #3 at 1 on m+1');
    expect(h.master).toEqual([1, 3]);
  });

  it('stops everything on a fatal error, recording it against the PR being handled', () => {
    const h = harness({ fatalAt: 2 });
    const r = runBatches([1, 2, 3].map(e), 3, h.ops);
    expect(results(r)).toEqual(['#1 landed', '#2 failed at fatal']);
    expect(r).toMatchObject({ fatal: '#2 merged, but master differs', exit: 1 });
    expect(h.trace.at(-1)).toBe('publish #2');
  });

  it('stops with "master is red" when master itself fails, blaming no PR and writing no note', () => {
    const h = harness({ masterRed: true });
    const r = runBatches([1, 2, 3].map(e), 3, h.ops);
    expect(r.fatal).toMatch(/^master is red: master master itself fails pnpm test, so no PR of the batch #1 #2 #3 is blamed:\npnpm test on master failed/);
    expect(r.outcomes).toEqual([]);
    expect(h.failures).toEqual([]);
    expect(h.trace.some((t) => t.startsWith('publish'))).toBe(false);
    expect(r.exit).toBe(1);
  });

  it('proves master\'s new tree when publishing stops part-way, and stops loudly when it fails', () => {
    // #2 breaks a test that #3 fixes; the top passes, #1 and #2 merge, #3 fails to publish: master rests on an unproved tree.
    const h = harness({ fixedBy: [2, 3], publishFail: [3] });
    const r = runBatches([1, 2, 3].map(e), 3, h.ops);
    expect(h.trace.filter((t) => t.startsWith('prove'))).toEqual(['prove m+1+2+3', 'prove m+1+2']);
    expect(results(r)).toEqual(['#1 landed', '#2 landed', '#3 failed at ci', '#2 failed at fatal']);
    expect(h.failures.at(-1)).toMatch(/^#2 master-red: master now rests on #2's position m\+1\+2, which was not the batch's proven top, and it fails pnpm test\. The driver stopped\./);
    expect(r.fatal).toMatch(/master now rests on #2's position/);
    // A resting tree that passes lets the queue continue; one already proved (a bisect probe) is not proved again.
    const ok = harness({ publishFail: [3] });
    expect(results(runBatches([1, 2, 3, 4].map(e), 4, ok.ops))).toEqual(['#1 landed', '#2 landed', '#3 failed at ci', '#4 landed']);
    expect(ok.trace.filter((t) => t.startsWith('prove'))).toEqual(['prove m+1+2+3+4', 'prove m+1+2', 'prove m+1+2+4']);
    const probed = harness({ broken: [4], publishFail: [3] });
    runBatches([1, 2, 3, 4].map(e), 4, probed.ops);
    expect(probed.trace.filter((t) => t.startsWith('prove')).slice(0, 3)).toEqual(['prove m+1+2+3+4', 'prove m+1+2', 'prove m+1+2+3']);
    expect(probed.trace.slice(probed.trace.indexOf('publish #3') + 1, probed.trace.indexOf('publish #3') + 2)).toEqual(['admit #4']);
  });

  it('treats an error outside the test while proving as the driver\'s, never as a verdict on a prefix', () => {
    const h = harness({ broken: [4], installFails: 'm+1+2' });
    const r = runBatches([1, 2, 3, 4].map(e), 4, h.ops);
    expect(r.fatal).toMatch(/^proving position 2 failed outside the test, at install, so it says nothing about the tree: pnpm install/);
    expect(h.failures).toEqual([]);
    const top = harness({ installFails: 'm+1+2' });
    expect(runBatches([1, 2].map(e), 2, top.ops).fatal).toMatch(/proving #2's position \(the batch top\) failed outside the test, at install/);
    expect(top.trace.some((t) => t.startsWith('publish'))).toBe(false);
  });

  it('stops on a master it cannot read, rather than building on nothing', () => {
    const h = harness();
    const r = runBatches([e(1)], 2, { ...h.ops, base: () => { throw new Error('git fetch: could not resolve host'); } });
    expect(r.fatal).toMatch(/could not read master: git fetch/);
  });

  it('treats a chain that is not what it claims as fatal, before any proof', () => {
    const h = harness();
    const r = runBatches([1, 2].map(e), 2, { ...h.ops, verify: () => { throw new Error('position 2 is not the merge it was built as'); } });
    expect(r.fatal).toMatch(/not the chain of positions it claims: position 2/);
    expect(h.trace.some((t) => t.startsWith('prove') || t.startsWith('publish'))).toBe(false);
  });

  it('bisects in at most ceil(log2 n) proofs, whatever the culprit', () => {
    for (let n = 1; n <= 8; n++) {
      for (let c = 1; c <= n; c++) {
        const seen: number[] = [];
        const r = bisectPrefixes(n, new LandFailure('test', 'top'), (k) => {
          seen.push(k);
          if (k >= c) throw new LandFailure('test', `at ${k}`);
        });
        expect(r.culprit).toBe(c);
        expect(r.failure.message).toBe(c === n ? 'top' : `at ${c}`);
        expect(r.proofs).toBe(seen.length);
        expect(r.proofs).toBeLessThanOrEqual(Math.ceil(Math.log2(n)));
      }
    }
    expect(() => bisectPrefixes(4, new LandFailure('test', 'top'), () => { throw new Fatal('master moved'); })).toThrow(Fatal);
  });

  it('skips the master proof only when master has the tree of a commit this run proved', () => {
    const trees = new Map([['p1', 'T1'], ['p2', 'T2'], ['p3', 'T2']]);
    const sameAs = (tree: string) => (c: string): boolean => trees.get(c) === tree;
    expect(provedTree(['p1', 'p2', 'p3'], sameAs('T2'))).toBe('p3');
    expect(provedTree(['p1', 'p2'], sameAs('T1'))).toBe('p1');
    expect(provedTree(['p1', 'p2'], sameAs('T9'))).toBeNull();
    expect(provedTree([], sameAs('T1'))).toBeNull();
  });

  it('stops gracefully between batches when asked: the batch it is on lands, nothing new starts, no PR fails', () => {
    const h = harness();
    let asked = false;
    const r = runBatches([1, 2, 3, 4, 5].map(e), 2, {
      ...h.ops,
      publish: (x, p, t) => {
        const out = h.ops.publish(x, p, t);
        if (x.pr === 1) asked = true; // asked mid-batch: #2, in the same batch, still lands
        return out;
      },
      stopRequested: () => asked,
    });
    expect(results(r)).toEqual(['#1 landed', '#2 landed']);
    expect(r.stopped.map((x) => x.pr)).toEqual([3, 4, 5]);
    expect(r).toMatchObject({ fatal: null, exit: 0 });
    expect(h.trace.some((t) => t.startsWith('admit #3'))).toBe(false);
    const s = statusText({ queue: 'q', startedAt: 't0', now: 't1', running: null, outcomes: r.outcomes, fatal: null, total: 5, done: true, stopped: r.stopped });
    expect(s).toMatch(/^land STOPPED ON REQUEST t1/);
    expect(s).toContain('stop requested: not started #3 #4 #5 (no PR failed for it)');
    // Requeued PRs (after a culprit) are not started either once a stop is asked.
    const b = harness({ broken: [2] });
    const rb = runBatches([1, 2, 3].map(e), 3, { ...b.ops, stopRequested: () => b.trace.includes('publish #1') });
    expect(results(rb)).toEqual(['#1 landed', '#2 failed at test']);
    expect(rb.stopped.map((x) => x.pr)).toEqual([3]);
    expect(runBatches([e(1)], 2, { ...harness().ops, stopRequested: () => true })).toMatchObject({ outcomes: [], stopped: [e(1)], exit: 0 });
  });

  it('records an interrupt in the status, naming what merged and never calling a merged PR "not failed"', () => {
    const before = 'land RUNNING 10:00 (started 09:00) queue q: 1 of 3 handled\nlanding now: #7 b7\n  landed #6 b6: merged as x\n';
    const base = { previous: before, how: 'SIGTERM', now: '10:05', publishing: null, merges: [], unproved: null };
    expect(interruptedStatus(base)).toBe(
      'land INTERRUPTED 10:05 by SIGTERM (was: land RUNNING 10:00 (started 09:00) queue q: 1 of 3 handled)\ninterrupted while #7 b7 was landing; it was not failed, and its step\'s work is discarded\n  landed #6 b6: merged as x\n',
    );
    expect(interruptedStatus({ ...base, previous: '', how: 'SIGINT' })).toBe('land INTERRUPTED 10:05 by SIGINT\ninterrupted between PRs\n');
    const merges = [{ pr: 6, merge: sha('a'), head: sha('b') }, { pr: 7, merge: sha('c'), head: sha('d') }];
    const merged = interruptedStatus({ ...base, publishing: { pr: 7, head: sha('d'), merged: null }, merges, unproved: { pr: 7, head: sha('d') } });
    expect(merged).toContain(`#7 MERGED as ${sha('c')} when interrupted; its post-merge tree check and branch cleanup did not run`);
    expect(merged).toContain(`merged in this run: #6 (${sha('a').slice(0, 12)}), #7 (${sha('c').slice(0, 12)})`);
    expect(merged).toContain(`master rests on #7's position ${sha('d')}, which no full test has proved; the next run proves it before anything else`);
    expect(merged).not.toContain('not failed');
    expect(interruptedStatus({ ...base, publishing: { pr: 7, head: sha('d'), merged: null } })).toContain(`interrupted while merging #7 (position ${sha('d')}); check whether it merged`);
  });

  it('reads the driver\'s run files strictly', () => {
    expect(parsePublishMark(JSON.stringify({ pr: 3, head: sha('a'), merged: null }))).toEqual({ pr: 3, head: sha('a'), merged: null });
    for (const bad of [null, '{', '{"pr":"3","head":"x","merged":null}', '[]']) expect(parsePublishMark(bad)).toBeNull();
    expect(parseMerges(`3 ${sha('a')} ${sha('b')}\ngarbage\n4 ${sha('c')} ${sha('d')}\n`)).toEqual([{ pr: 3, merge: sha('a'), head: sha('b') }, { pr: 4, merge: sha('c'), head: sha('d') }]);
    expect(parseUnproved(null)).toBeNull();
    expect(parseUnproved(JSON.stringify({ pr: 3, head: sha('a') }))).toEqual({ pr: 3, head: sha('a') });
    // An unreadable record is not "nothing to prove".
    expect(parseUnproved('{"pr":')).toMatchObject({ pr: 0, head: expect.stringMatching(/^unreadable/) });
    expect(parseLstart('Sun Oct  4 21:59:58 2026\n')).toBe('Sun Oct  4 21:59:58 2026');
    expect(parseLstart('')).toBeNull();
    expect(parsePidFile('123\n')).toBe(123);
    for (const bad of [null, '', '1', '-5', 'x', '12x']) expect(parsePidFile(bad)).toBeNull();
  });

  it('holds the lock while the supervisor or its driver lives, and never takes a reused pid for either', () => {
    const procs = (live: Record<number, string>) => (pid: number) => live[pid] ?? null;
    const sup = { pid: 10, start: 'Sun 21:00' };
    const drv = { pid: 11, start: 'Sun 21:01' };
    expect(lockState(sup, drv, procs({ 10: 'Sun 21:00', 11: 'Sun 21:01' }))).toBe('held');
    expect(lockState(sup, drv, procs({ 10: 'Sun 21:00' }))).toBe('held');
    expect(lockState(sup, drv, procs({ 11: 'Sun 21:01' }))).toBe('orphan');
    expect(lockState(sup, drv, procs({}))).toBe('free');
    // The pids live again, but as other processes (started later): nothing is held and no group is killed.
    expect(lockState(sup, drv, procs({ 10: 'Mon 09:00', 11: 'Mon 09:01' }))).toBe('free');
    // No start time recorded (a run died between its two writes): held while that pid lives, and never killed as an orphan.
    expect(lockState({ pid: 10, start: '' }, drv, procs({ 10: 'whatever' }))).toBe('held');
    expect(lockState({ pid: 10, start: '' }, drv, procs({}))).toBe('free');
    expect(lockState(null, { pid: 11, start: '' }, procs({ 11: 'Mon 09:01' }))).toBe('held');
    expect(lockState(null, null, procs({ 1: 'x' }))).toBe('free');
  });

  it('starts the merge critical section just before gh pr merge, so an interrupt during CI and review waits acts at once', () => {
    const src = readFileSync(repoPath('scripts/land.ts'), 'utf8');
    const body = src.slice(src.indexOf('const publishInside'));
    const mark = body.indexOf('writeFileSync(runFile(PUBLISH_MARK)');
    expect(mark).toBeGreaterThan(body.indexOf("waitCi('ci'"));
    expect(mark).toBeGreaterThan(body.indexOf('mergeGate('));
    expect(mark).toBeLessThan(body.indexOf('ghMerge(e.pr'));
    expect(src).not.toMatch(/simctl|emulatorPids|process\.kill\(pid, 'SIGKILL'\)/);
  });

  it('cleans up after a dead driver: release, reset and status, each despite the others failing, and never a device', () => {
    const files = new Map<string, string>([
      [PUBLISH_MARK, JSON.stringify({ pr: 7, head: sha('d'), merged: sha('c') })],
      [MERGES_LOG, `7 ${sha('c')} ${sha('d')}\n`],
    ]);
    const done: string[] = [];
    let status = 'land RUNNING t\nlanding now: #7 b7\n';
    const problems = cleanUpAfterDriver({
      how: 'SIGTERM',
      now: 't9',
      read: (f) => files.get(f) ?? null,
      unproved: () => ({ pr: 7, head: sha('d') }),
      release: () => {
        done.push('release');
        throw new Error('rm failed');
      },
      reset: () => done.push('reset'),
      status: { read: () => status, write: (t) => (status = t) },
      log: () => {},
    });
    expect(done).toEqual(['release', 'reset']);
    expect(problems).toEqual(['releasing the quiet request and priority: rm failed']);
    expect(status).toMatch(/^land INTERRUPTED t9 by SIGTERM/);
    expect(status).toContain('#7 MERGED as');
  });

  it('proves the tree an interrupted run left master on first, logs a red master loudly, and never blocks the queue', () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const prove = (fail?: Error) => () => {
      calls.push('prove');
      if (fail) throw fail;
    };
    const clear = () => calls.push('clear');
    expect(proveRestingMaster(null, prove(), clear, (l) => logs.push(l))).toBeNull();
    expect(calls).toEqual([]);
    expect(proveRestingMaster({ pr: 7, head: sha('d') }, prove(), clear, (l) => logs.push(l))).toBe(true);
    expect(calls).toEqual(['prove', 'clear']);
    calls.length = 0;
    // Red: logged, the record kept, and the run carries on (no throw, no refusal).
    expect(proveRestingMaster({ pr: 7, head: sha('d') }, prove(new LandFailure('test', 'red: t1.test.ts')), clear, (l) => logs.push(l))).toBe(false);
    expect(calls).toEqual(['prove']);
    expect(logs.at(-1)).toMatch(/^!!! MASTER IS RED: it rests on #7's position .* carrying on, so a batch whose top passes can land the fix:\nred: t1\.test\.ts$/);
    expect(proveRestingMaster({ pr: 7, head: sha('d') }, prove(new LandFailure('install', 'ECONNRESET')), clear, (l) => logs.push(l))).toBe(false);
    expect(logs.at(-1)).toMatch(/^!!! could not prove master: .*install/);
  });

  it('clears the unproved record only when master is on a proven tree', () => {
    const mastersTree = (commits: string[]) => (c: string) => commits.includes(c);
    const rec = { head: sha('d') };
    expect(clearsUnproved(rec, sha('d'), mastersTree([sha('d')]))).toBe(true); // master proved where it rests
    expect(clearsUnproved(rec, sha('m'), mastersTree([sha('m')]))).toBe(true); // master moved to this proved tree by a publish
    expect(clearsUnproved(rec, sha('e'), mastersTree([sha('d')]))).toBe(false); // a passing batch on top of master that has not landed
    expect(clearsUnproved(null, sha('d'), mastersTree([sha('d')]))).toBe(false);
    expect(clearsUnproved({ head: 'unreadable "{"' }, sha('d'), mastersTree([sha('d')]))).toBe(true);
  });

  it('reads LAND_BATCH strictly', () => {
    expect(parseBatchSize(undefined)).toBe(4);
    expect(parseBatchSize('1')).toBe(1);
    expect(parseBatchSize('8')).toBe(8);
    for (const bad of ['0', '9', '-1', '2.5', 'four', '']) expect(() => parseBatchSize(bad)).toThrow(/LAND_BATCH/);
    expect(() => runBatches([e(1)], 0, harness().ops)).toThrow(/batch size/);
  });
});

describe('the supervisor with real processes', () => {
  const lib = repoPath('scripts/land-lib.ts');
  // A fake driver: records its pid and its step's pid, runs a long step (spawnSync, as the driver does), and records "resumed"
  // if it ever gets past the step, which is where the old driver went on to fail PRs after a SIGTERM.
  const setup = (driverBody: (dir: string) => string, o: { graceMs?: number; deferCapMs?: number; slowSpawnMs?: number } = {}): { dir: string; run: () => { done: Promise<{ code: number | null; out: string }>; pid: number } } => {
    const dir = tempDir();
    // Every file the fakes write is written whole (temp file, then rename), so a reader never sees it half-written.
    const atomic = (src: string): string =>
      `import { renameSync as __rename, writeFileSync as __write } from 'node:fs';\nconst put = (p, b) => { __write(p + '.tmp', b); __rename(p + '.tmp', p); };\n${src.replaceAll('writeFileSync(', 'put(')}`;
    writeFileSync(join(dir, 'driver.mjs'), atomic(driverBody(dir)));
    writeFileSync(
      join(dir, 'supervisor.mjs'),
      atomic(`import { existsSync, writeFileSync } from 'node:fs';\nimport { supervise } from ${JSON.stringify(lib)};\n` +
        `const r = await supervise({ command: process.execPath, args: [${JSON.stringify(join(dir, 'driver.mjs'))}], env: process.env, graceMs: ${o.graceMs ?? 5000}, deferCapMs: ${o.deferCapMs ?? 60_000}, pollMs: 50, ` +
        `publishing: () => existsSync(${JSON.stringify(join(dir, 'publishing'))}), ` +
        `onSpawn: (pid) => { writeFileSync(${JSON.stringify(join(dir, 'spawned'))}, String(pid)); const t = Date.now(); while (Date.now() - t < ${o.slowSpawnMs ?? 0}); }, ` +
        `onReady: () => writeFileSync(${JSON.stringify(join(dir, 'ready'))}, 'x'), ` +
        `onStop: () => writeFileSync(${JSON.stringify(join(dir, 'stop'))}, 'x'), log: (l) => console.log(l) });\n` +
        `console.log(JSON.stringify(r)); process.exitCode = r.code;\n`),
    );
    return {
      dir,
      run: () => {
        const p = spawn(process.execPath, [join(dir, 'supervisor.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        p.stdout.on('data', (d: Buffer) => (out += d.toString()));
        return { pid: p.pid!, done: new Promise((resolve) => p.on('exit', (code) => resolve({ code, out }))) };
      },
    };
  };
  const waitFor = async (path: string): Promise<string> => {
    for (let i = 0; i < 400; i++) {
      if (existsSync(path)) return readFileSync(path, 'utf8');
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${path} never appeared`);
  };
  // Waits until the file holds `n` positive pids, retrying on content that is missing or not (yet) that.
  const waitForPids = async (path: string, n = 1): Promise<number[]> => {
    for (let i = 0; i < 400; i++) {
      const pids = existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\s+/).map(Number) : [];
      if (pids.length === n && pids.every((p) => Number.isInteger(p) && p > 1)) return pids;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${path} never held ${n} pid(s)`);
  };
  const dead = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  };

  it('SIGTERM kills the driver and its running step at once, and the driver never goes on to fail a PR', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawn, spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n` +
        `if (process.env.LAND_SUPERVISED !== '1') process.exit(9);\n` +
        `const probe = spawn('sleep', ['60'], { stdio: 'ignore' });\n` + // the step's own child, in the same group
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, process.pid + ' ' + probe.pid);\n` +
        `spawnSync('sleep', ['60']);\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'resumed'))}, 'the step "failed" and the driver went on');\n`,
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    const [driver, step] = (await waitForPids(join(dir, 'pids'), 2)) as [number, number];
    const t0 = Date.now();
    process.kill(s.pid, 'SIGTERM');
    const { code, out } = await s.done;
    expect(code).toBe(130);
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toMatchObject({ code: 130, interrupted: 'SIGTERM', pid: driver });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(dead(driver) && dead(step)).toBe(true);
    expect(existsSync(join(dir, 'resumed'))).toBe(false);
  }, 20_000);

  it('waits for a publish in progress before interrupting, and kills at once on a second signal', async () => {
    // The driver "publishes" for 1.5 s (the marker exists), then runs a long step.
    const body = (dir: string) =>
      `import { spawnSync } from 'node:child_process';\nimport { rmSync, writeFileSync } from 'node:fs';\n` +
      `writeFileSync(${JSON.stringify(join(dir, 'publishing'))}, 'x');\nwriteFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
      `spawnSync('sleep', ['1.5']);\nwriteFileSync(${JSON.stringify(join(dir, 'published'))}, 'x');\nrmSync(${JSON.stringify(join(dir, 'publishing'))});\n` +
      `spawnSync('sleep', ['60']);\nwriteFileSync(${JSON.stringify(join(dir, 'resumed'))}, 'x');\n`;
    const a = setup(body);
    const s = a.run();
    await waitFor(join(a.dir, 'ready'));
    await waitForPids(join(a.dir, 'pids'));
    process.kill(s.pid, 'SIGTERM');
    const r = await s.done;
    expect(r.code).toBe(130);
    expect(r.out).toContain('the driver is merging a PR; interrupting once that merge and its checks end');
    expect(existsSync(join(a.dir, 'published'))).toBe(true); // the publish finished
    expect(existsSync(join(a.dir, 'resumed'))).toBe(false); // and nothing after it ran
    const b = setup(body);
    const s2 = b.run();
    await waitFor(join(b.dir, 'ready'));
    await waitForPids(join(b.dir, 'pids'));
    process.kill(s2.pid, 'SIGTERM');
    await new Promise((res) => setTimeout(res, 300));
    process.kill(s2.pid, 'SIGTERM');
    const r2 = await s2.done;
    expect(r2.out).toContain('SIGTERM again: killing the driver group now');
    expect(existsSync(join(b.dir, 'published'))).toBe(false);
  }, 20_000);

  it('SIGKILLs a step that ignores SIGTERM once the grace period is over', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
        `spawnSync('/bin/sh', ['-c', 'trap "" TERM; echo $$ > ${join(dir, 'step')}.tmp && mv ${join(dir, 'step')}.tmp ${join(dir, 'step')}; while :; do sleep 0.1; done']);\n`,
      { graceMs: 1000 },
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    await waitForPids(join(dir, 'pids'));
    const [step] = (await waitForPids(join(dir, 'step'))) as [number];
    const t0 = Date.now();
    process.kill(s.pid, 'SIGTERM');
    const r = await s.done;
    expect(r.code).toBe(130);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(dead(step)).toBe(true);
  }, 20_000);

  it('reports a driver killed from elsewhere as a death by signal, so the supervisor cleans up after it', async () => {
    const { dir, run } = setup((dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\nspawnSync('sleep', ['60']);\n`);
    const s = run();
    await waitFor(join(dir, 'ready'));
    const [driver] = (await waitForPids(join(dir, 'pids'))) as [number];
    expect(await waitForPids(join(dir, 'spawned'))).toEqual([driver]);
    process.kill(driver, 'SIGKILL');
    const r = await s.done;
    expect(JSON.parse(r.out.trim().split('\n').at(-1)!)).toMatchObject({ interrupted: null, signal: 'SIGKILL', pid: driver });
  }, 20_000);

  it('gives the driver its supervisor\'s pid, so a driver whose supervisor dies stops itself', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
        `for (let i = 0; i < 200; i++) { if (String(process.ppid) !== process.env.LAND_SUPERVISOR_PID) { writeFileSync(${JSON.stringify(join(dir, 'orphan'))}, 'x'); process.exit(3); } spawnSync('sleep', ['0.1']); }\n`,
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    const [driver] = (await waitForPids(join(dir, 'pids'))) as [number];
    process.kill(s.pid, 'SIGKILL');
    await waitFor(join(dir, 'orphan'));
    for (let i = 0; i < 40 && !dead(driver); i++) await new Promise((res) => setTimeout(res, 50));
    expect(dead(driver)).toBe(true);
  }, 20_000);

  it('acts on a signal that arrives before the driver is recorded, rather than dying of it', async () => {
    // onSpawn takes 3 s (a slow ps), far beyond scheduler jitter; the SIGTERM sent once it starts lands inside it.
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\nspawnSync('sleep', ['60']);\nwriteFileSync(${JSON.stringify(join(dir, 'resumed'))}, 'x');\n`,
      { slowSpawnMs: 3000 },
    );
    const s = run();
    const [driver] = (await waitForPids(join(dir, 'spawned'))) as [number];
    process.kill(s.pid, 'SIGTERM');
    const r = await s.done;
    expect(r.code).toBe(130);
    expect(JSON.parse(r.out.trim().split('\n').at(-1)!)).toMatchObject({ interrupted: 'SIGTERM', pid: driver });
    expect(dead(driver)).toBe(true);
    expect(existsSync(join(dir, 'resumed'))).toBe(false);
  }, 20_000);

  it('SIGUSR1 asks for a graceful stop: the driver finishes and exits on its own', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { existsSync, writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
        `for (let i = 0; i < 100 && !existsSync(${JSON.stringify(join(dir, 'stop'))}); i++) spawnSync('sleep', ['0.1']);\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'finished'))}, 'x');\n`,
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    await waitForPids(join(dir, 'pids'));
    process.kill(s.pid, 'SIGUSR1');
    const { code, out } = await s.done;
    expect(code).toBe(0);
    expect(out).toContain('SIGUSR1: graceful stop requested');
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toMatchObject({ code: 0, interrupted: null });
    expect(existsSync(join(dir, 'finished'))).toBe(true);
  }, 20_000);
});

describe('a batch of positions on a scratch repository', () => {
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
  const master = commit({ '.macroscope/ignore.md': '---\nignoreTests: false\n---\n**/out/**\ndocs/goals/**\n', 'src/a.ts': lines('a'), 'src/b.ts': lines('b'), 'src/c.ts': lines('c'), 'out/x.json': '0\n' }, 'base');
  const branch = (name: string, files: Record<string, string>): Member => {
    git(['checkout', '-q', '-b', name, master]);
    const clean = commit(files, name);
    return { branch: name, pr: name.charCodeAt(0), clean };
  };
  const a = branch('a', { 'src/a.ts': lines('a').replace('a3 = 3', 'a3 = 33') });
  const b = branch('b', { 'src/a.ts': lines('a').replace('a3 = 3', 'a3 = 34') }); // conflicts with a
  const c = branch('c', { 'src/c.ts': lines('c').replace('c5 = 5', 'c5 = 55') });
  git(['checkout', '-q', '--detach', master]);
  // The driver's build loop: each member on the position before it; a conflict ejects the member and the chain stays put.
  const built: { member: Member; prev: string; merge: string; head: string }[] = [];
  const ejected: string[] = [];
  let prev = master;
  for (const m of [a, b, c]) {
    try {
      const merge = mergeMember(git, prev, m, built.length + 1, m.clean, 'Land');
      writeFileSync(join(dir, 'out/x.json'), `${built.length + 1}\n`);
      const head = commitRegen(git, built.length + 1, m, ['pnpm regen'], 'Land');
      built.push({ member: m, prev, merge, head });
      prev = head;
    } catch (error) {
      ejected.push(`${m.branch}: ${(error as Error).message}`);
    }
  }

  it('ejects the conflicting member, leaving no merge in progress, and chains the next on the position before it', () => {
    expect(ejected).toEqual([expect.stringMatching(/^b: .*conflicts in src\/a\.ts/)]);
    expect(built.map((x) => x.member.branch)).toEqual(['a', 'c']);
    expect(built[1]!.prev).toBe(built[0]!.head);
    expect(() => git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).toThrow();
  });

  it('builds positions that are exactly what they claim: the chain checks out, each regen commit is regen-only and vouchable', () => {
    const plan = planPositions(git, built.map((x) => x.member), built.map((x) => x.head));
    expect(plan.base).toBe(master);
    expect(plan.positions.map((p) => [p.prev, p.merge, p.tip])).toEqual(built.map((x) => [x.prev, x.merge, x.member.clean]));
    for (const x of built) {
      const ignore = ignoreAt(git, x.head);
      if ('error' in ignore) throw new Error(ignore.error);
      expect(regenOnlyProblems(git, x.head, ignore)).toEqual([]);
      expect(predictPosition(git, x.member, { prev: x.prev, merge: x.merge, head: x.head, tip: x.member.clean }).ok).toBe(true);
    }
    // Position 1 holds a and not c: an intermediate master is a's tree only.
    expect(git(['show', `${built[0]!.head}:src/c.ts`]).toString()).toBe(lines('c'));
    expect(git(['show', `${built[1]!.head}:src/c.ts`]).toString()).toContain('c5 = 55');
  });

  it('cleans ignored outputs of another tree before a proof, keeping installs and build caches', () => {
    const d = tempDir();
    const g = (args: string[]): string => execFileSync('git', [...config, ...args], { cwd: d, encoding: 'utf8' });
    g(['init', '-q']);
    const files: Record<string, string> = {
      '.gitignore': 'node_modules/\npackages/parity/out/*\n!packages/parity/out/kept.json\n*.tsbuildinfo\nvendor/wpt/\nbuild/\ndist/\n',
      'packages/parity/out/kept.json': '{}\n',
    };
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(dirname(join(d, path)), { recursive: true });
      writeFileSync(join(d, path), body);
    }
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'x']);
    const stale = ['packages/parity/out/report.html', 'packages/x/tsconfig.tsbuildinfo', 'packages/dragon/dist/index.js'];
    // Ignored files nested in a kept tree stay too: node_modules/.pnpm/*/dist/ holds every installed package's code (the
    // first version deleted vitest's dist/ this way and every later test run failed to start).
    const kept = [
      'node_modules/a/index.js',
      'node_modules/.pnpm/vitest@4/node_modules/vitest/dist/cli.js',
      'packages/p/node_modules/b/index.js',
      'packages/p/node_modules/b/dist/x.js',
      'vendor/wpt/css/t.html',
      'packages/layout/generated/kotlin/build/x.class',
    ];
    for (const path of [...stale, ...kept]) {
      mkdirSync(dirname(join(d, path)), { recursive: true });
      writeFileSync(join(d, path), 'x');
    }
    for (const p of ignoredToRemove(g(ignoredFilesArgs()))) rmSync(join(d, p), { force: true });
    expect(stale.filter((path) => existsSync(join(d, path)))).toEqual([]);
    expect(kept.filter((path) => existsSync(join(d, path)))).toEqual(kept);
    expect(existsSync(join(d, 'packages/parity/out/kept.json'))).toBe(true);
  });

  it('refuses a chain whose positions are out of order or skip one', () => {
    expect(() => planPositions(git, [c, a], [built[1]!.head, built[0]!.head])).toThrow();
    expect(() => planPositions(git, [a, c], [built[0]!.head, built[0]!.head])).toThrow();
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
