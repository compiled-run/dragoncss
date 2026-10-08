import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  backoffMs,
  baseAction,
  type BatchOps,
  type NextRound,
  parsePrepared,
  type Prepared,
  prepareRound,
  serializePrepared,
  bisectPrefixes,
  buildPositionsParallel,
  androidAbis,
  archChanges,
  ciArchRebaseline,
  CiOutage,
  hostAbi,
  normalAbi,
  parseLandModes,
  parseMaxInflight,
  serializeFatal,
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
  builderLiveness,
  runWatchdog,
  unsafeWorktree,
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
import { commitRegen, deviceRunProblems, failuresJson, type Member, memberTip, mergeMember, parseDeviceEvidence, planPositions, predictPosition, tipProblem, treeMatches } from '../../../scripts/merge-train-lib.ts';
import { parseIgnoreFile } from '../../../scripts/macroscope-ignore.ts';
import { type CheckRun, type Git, ignoreAt, regenOnlyProblems } from '../../../scripts/pr-review-vouch.ts';
import { parseLanesForStamp, stampProblems } from '../../../scripts/evidence-stamp.ts';
import { lookupReview } from '../../../scripts/land-review-lookup.ts';
import { applyRegenPatch, CiUnavailable, landRegen } from '../../../scripts/land-devices-ci.ts';
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
    expect(isQuiet(1, 2)).toBe(true); // idle machine: a held slot doesn't keep it from being quiet
    expect(isQuiet(1, 6)).toBe(false);
    expect(isQuiet(2, 12)).toBe(false);
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
    let tag = ''; // '[next] ' while the fake builder prepares
    const ops: BatchOps<{ pr: number }, Pos> = {
      admit: (x, earlier) => {
        trace.push(`${tag}admit #${x.pr}${earlier.length ? ` after ${earlier.map((y) => `#${y.pr}`).join(' ')}` : ''}`);
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
        trace.push(`${tag}build #${x.pr} at ${k} on ${prev}`);
        if (t.pr !== x.pr) throw new Error('ticket mixed up');
        if (o.conflicts?.includes(x.pr)) throw new LandFailure('merge', `merging b${x.pr} failed; conflicts in src/a.ts`);
        const prs = [...heads.get(prev)!, x.pr];
        const head = name(prs);
        heads.set(head, prs);
        return { head, prev, prs };
      },
      verify: (built) => {
        trace.push(`${tag}verify ${built.map((b) => b.position.head).join(' ')}`);
        // The driver's chain starts on master; the builder's on the top it was given (master only once that batch lands).
        built.forEach((b, i) => (i > 0 || tag === '') && expect(b.position.prev).toBe(i === 0 ? name(master) : built[i - 1]!.position.head));
      },
      prove: (p) => {
        trace.push(`${tag}prove ${p.head}`);
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
    // A fake builder: prepares the round synchronously when started (as the real one would while the batch publishes), on the
    // batch's top, with the same ops; `crash` makes it end with nothing, `fatal` with a Fatal.
    const next = (n: { crash?: boolean; fatal?: string } = {}): NextRound<{ pr: number }, Pos> => {
      let round: Prepared<{ pr: number }, Pos> | null = null;
      return {
        start: (base, queue, earlier, size) => {
          trace.push(`next start on ${base} with ${queue.map((x) => `#${x.pr}`).join(' ')}`);
          tag = '[next] ';
          try {
            round = prepareRound([...queue], size, () => base, ops, { earlier, baseProven: true });
          } finally {
            tag = '';
          }
        },
        collect: () => {
          trace.push('next collect');
          if (n.fatal) throw new Fatal(n.fatal);
          if (n.crash) return { base: '', consumed: [], results: [], built: [], good: 0, proven: [], culprit: null };
          return parsePrepared<{ pr: number }, Pos>(serializePrepared(round!)) as Prepared<{ pr: number }, Pos>;
        },
        cancel: () => trace.push('next cancel'),
      };
    };
    return { ops, master, trace, failures, next };
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

  it('stops on a CI outage (ci-only) blaming no PR: the batch it hit and the rest of the queue stay queued', () => {
    const outage = (where: string) => new CiOutage(`LAND_TEST=ci-only: GitHub Actions did not run the full test (${where})`);
    // While proving the second batch's top: the first batch landed, nothing of the second is failed or labelled.
    const h = harness();
    const r = runBatches([1, 2, 3, 4, 5].map(e), 2, {
      ...h.ops,
      prove: (p, x) => {
        if (p.prs.includes(3)) throw outage('no run appeared');
        h.ops.prove(p, x);
      },
    });
    expect(results(r)).toEqual(['#1 landed', '#2 landed']);
    expect(r).toMatchObject({ fatal: null, outage: 'LAND_TEST=ci-only: GitHub Actions did not run the full test (no run appeared)', exit: 1 });
    expect(r.stopped.map((x) => x.pr)).toEqual([3, 4, 5]);
    expect(h.failures).toEqual([]);
    expect(h.trace.some((t) => t === 'publish #3')).toBe(false);
    const s = statusText({ queue: 'q', startedAt: 't0', now: 't1', running: null, outcomes: r.outcomes, fatal: r.fatal, outage: r.outage, total: 5, done: true, stopped: r.stopped });
    expect(s).toMatch(/^land STOPPED BY A CI OUTAGE t1/);
    expect(s).toContain('CI outage: LAND_TEST=ci-only: GitHub Actions did not run the full test (no run appeared)');
    expect(s).toContain('no PR was failed for it; still queued, not landed: #3 #4 #5');
    expect(s).not.toContain('FAILED');
    // While building a position (its CI regen or devices), and during a bisect: PRs ejected before it keep their failure.
    const b = harness({ conflicts: [1] });
    const rb = runBatches([1, 2, 3].map(e), 3, { ...b.ops, build: (prev, x, t, k) => (x.pr === 3 ? (() => { throw outage('queued past LAND_CI_QUEUE_WAIT'); })() : b.ops.build(prev, x, t, k)) });
    expect(results(rb)).toEqual(['#1 failed at merge']);
    expect(rb.stopped.map((x) => x.pr)).toEqual([2, 3]);
    expect(b.failures).toEqual(['#1 merge: merging b1 failed; conflicts in src/a.ts']);
    const bis = harness({ broken: [3] });
    let proofs = 0;
    const rbis = runBatches([1, 2, 3, 4].map(e), 4, { ...bis.ops, prove: (p, x) => (++proofs > 1 ? (() => { throw outage('setup failed'); })() : bis.ops.prove(p, x)) });
    expect(rbis).toMatchObject({ outcomes: [], fatal: null, exit: 1 });
    expect(rbis.stopped.map((x) => x.pr)).toEqual([1, 2, 3, 4]);
    expect(bis.failures).toEqual([]);
    // A plain Fatal is unchanged: recorded against the PR at hand, nothing listed as still queued.
    const f = harness({ fatalAt: 2 });
    expect(runBatches([1, 2, 3].map(e), 3, f.ops)).toMatchObject({ outage: null, stopped: [] });
  });

  it('carries a builder\'s CI outage to the driver as an outage, and a plain Fatal as a Fatal', () => {
    expect(parsePrepared(serializeFatal(new CiOutage('LAND_REGEN=ci-only: no run')))).toEqual({ fatal: 'LAND_REGEN=ci-only: no run', outage: true });
    expect(parsePrepared(serializeFatal(new Fatal('master is red')))).toEqual({ fatal: 'master is red', outage: false });
    expect(parsePrepared(JSON.stringify({ fatal: 'old builder' }))).toEqual({ fatal: 'old builder', outage: false });
    expect(() => parsePrepared(JSON.stringify({ fatal: 'x', outage: 'yes' }))).toThrow('outage is not a boolean');
    const src = readFileSync(repoPath('scripts/land.ts'), 'utf8');
    expect(src).toContain('if (error instanceof Fatal) put(serializeFatal(error));');
    expect(src).toContain("throw round.outage ? new CiOutage(`while preparing the next batch: ${round.fatal}`) : new Fatal(");
    const h = harness();
    const r = runBatches([1, 2, 3].map(e), 2, { ...h.ops, next: { ...h.next(), collect: () => { throw new CiOutage('while preparing the next batch: LAND_DEVICES=ci-only: no run'); } } });
    expect(results(r)).toEqual(['#1 landed', '#2 landed']);
    expect(r).toMatchObject({ outage: 'while preparing the next batch: LAND_DEVICES=ci-only: no run', fatal: null });
    expect(r.stopped.map((x) => x.pr)).toEqual([3]);
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
    // A CI outage (ci-only) stops the driver before any batch rather than carrying on into the same outage.
    expect(() => proveRestingMaster({ pr: 7, head: sha('d') }, prove(new CiOutage('LAND_TEST=ci-only: no run')), clear, (l) => logs.push(l))).toThrow(CiOutage);
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

  it('pipelines: prepares the next batch on the proven top while this one publishes, and uses it once all of this one landed', () => {
    const h = harness();
    const r = runBatches([1, 2, 3, 4, 5].map(e), 2, { ...h.ops, next: h.next() });
    expect(results(r)).toEqual(['#1 landed', '#2 landed', '#3 landed', '#4 landed', '#5 landed']);
    const t = h.trace;
    expect(t.indexOf('next start on m+1+2 with #3 #4 #5')).toBeLessThan(t.indexOf('publish #1'));
    expect(t).toContain('[next] build #3 at 1 on m+1+2');
    expect(t).toContain('[next] prove m+1+2+3+4');
    expect(t.some((x) => /^build #3/.test(x))).toBe(false); // the driver never built #3 itself
    expect(t.indexOf('next collect')).toBeGreaterThan(t.indexOf('publish #2'));
    expect(t).toContain('verify m+1+2+3 m+1+2+3+4'); // the driver checks the adopted chain itself
    expect(h.master).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws the prepared batch away when this batch did not all land, and reports nothing of it', () => {
    const h = harness({ publishFail: [2], reject: [3] });
    const r = runBatches([1, 2, 3, 4].map(e), 2, { ...h.ops, next: h.next() });
    expect(results(r)).toEqual(['#1 landed', '#2 failed at ci', '#3 failed at claude-review-before', '#4 landed']);
    expect(h.trace).toContain('next cancel');
    expect(h.trace).not.toContain('next collect');
    expect(h.trace).toContain('build #4 at 1 on m+1'); // prepared again on the master that came of it
    // #3's rejection in the discarded round was not reported; the driver's own admission reported it once.
    expect(h.failures.filter((f) => f.startsWith('#3'))).toEqual(['#3 claude-review-before: #3 has a Medium finding at its head']);
  });

  it('stops the builder as soon as a publish fails, before the proof of the tree master rests on', () => {
    // #2 breaks a test that #3 fixes; the top passes, #1 and #2 merge, #3 fails to publish: master rests on m+1+2.
    const h = harness({ fixedBy: [2, 3], publishFail: [3] });
    const r = runBatches([1, 2, 3, 4].map(e), 3, { ...h.ops, next: h.next() });
    const t = h.trace;
    expect(t.indexOf('next cancel')).toBeGreaterThan(t.indexOf('publish #3'));
    expect(t.indexOf('next cancel')).toBeLessThan(t.indexOf('prove m+1+2'));
    expect(t.filter((x) => x === 'next cancel')).toHaveLength(1);
    expect(r.fatal).toMatch(/master now rests on #2's position/);
  });

  it('prepares nothing ahead of a batch whose top failed, and discards the prepared batch on a stop request', () => {
    const b = harness({ broken: [2] });
    runBatches([1, 2, 3].map(e), 2, { ...b.ops, next: b.next() });
    expect(b.trace.some((x) => x.startsWith('next start'))).toBe(false);
    const s = harness();
    const r = runBatches([1, 2, 3, 4].map(e), 2, { ...s.ops, next: s.next(), stopRequested: () => s.trace.includes('publish #2') });
    expect(results(r)).toEqual(['#1 landed', '#2 landed']);
    expect(r.stopped.map((x) => x.pr)).toEqual([3, 4]);
    expect(s.trace).toContain('next cancel');
  });

  it('stops on a builder\'s fatal error, and prepares the batch itself when the builder ended with nothing', () => {
    const f = harness();
    expect(runBatches([1, 2, 3].map(e), 2, { ...f.ops, next: f.next({ fatal: 'while preparing the next batch: master is red' }) }).fatal).toBe('while preparing the next batch: master is red');
    const c = harness();
    const r = runBatches([1, 2, 3].map(e), 2, { ...c.ops, next: c.next({ crash: true }) });
    expect(results(r)).toEqual(['#1 landed', '#2 landed', '#3 landed']);
    expect(c.trace).toContain('build #3 at 1 on m+1+2');
  });

  it('carries a prepared round through JSON exactly, and refuses a malformed one', () => {
    const round: Prepared<{ pr: number }, Pos> = {
      base: 'b',
      consumed: [e(3), e(4)],
      results: [{ entry: e(3), failure: new LandFailure('merge', 'conflict', 'comment') }],
      built: [{ entry: e(4), ticket: { pr: 4 }, position: { head: 'h4', prev: 'b', prs: [4] } }],
      good: 0,
      proven: [],
      culprit: { index: 0, failure: new LandFailure('test', 't4 failed') },
    };
    const back = parsePrepared<{ pr: number }, Pos>(serializePrepared(round));
    expect(back).toEqual(round);
    if ('fatal' in back) throw new Error('unexpected');
    expect(back.results[0]).toMatchObject({ failure: expect.any(LandFailure) });
    expect(parsePrepared(JSON.stringify({ fatal: 'x' }))).toEqual({ fatal: 'x', outage: false });
    const bad = (patch: object): (() => unknown) => () => parsePrepared(JSON.stringify({ ...JSON.parse(serializePrepared(round)), ...patch }));
    expect(bad({ good: 2 })).toThrow(/good/);
    expect(bad({ culprit: null })).toThrow(/without a culprit/);
    expect(bad({ proven: [5] })).toThrow(/out of range/);
    expect(bad({ consumed: [{ pr: 3 }] })).toThrow(/malformed/);
    expect(bad({ results: [{ entry: e(3), failure: { step: 1 } }] })).toThrow(/failure is malformed/);
  });

  it('the builder\'s watchdog stops the builder only once the driver is definitely gone', () => {
    type L = 'alive' | 'gone' | 'unknown';
    // `driver` and `builder` give the liveness per poll (the last repeats); `group` says what is left after SIGTERM.
    const run = (o: { driver: L[]; builder?: L[]; ignoresTerm?: boolean; groupUnknown?: boolean }) => {
      let poll = 0;
      let termed = false;
      const did: string[] = [];
      const at = (xs: L[], i: number): L => xs[Math.min(i, xs.length - 1)]!;
      const result = runWatchdog({
        driver: () => at(o.driver, poll),
        builder: () => at(o.builder ?? ['alive'], poll),
        groupLeft: () => (did.includes('SIGKILL') ? false : o.groupUnknown ? null : !termed || o.ignoresTerm === true),
        signal: (sig) => {
          did.push(sig);
          if (sig === 'SIGTERM') termed = true;
        },
        release: () => did.push('release'),
        sleep: () => void poll++,
        log: () => {},
        graceMs: 5000,
      });
      return { result, did, poll };
    };
    // The builder ends first (exits, becomes a zombie, or its pid is another process now): nothing is signalled.
    expect(run({ driver: ['alive'], builder: ['alive', 'alive', 'gone'] })).toEqual({ result: 'builder ended', did: [], poll: 2 });
    // The driver is gone: SIGTERM, then release.
    expect(run({ driver: ['alive', 'alive', 'gone'] })).toMatchObject({ result: 'stopped the builder', did: ['SIGTERM', 'release'], poll: 2 });
    // Unknown (a failed ps or kill under load) is asked again, never taken as a death, for the driver and for the builder.
    expect(run({ driver: ['unknown', 'unknown', 'unknown', 'alive', 'gone'] })).toMatchObject({ did: ['SIGTERM', 'release'], poll: 4 });
    expect(run({ driver: ['gone'], builder: ['unknown', 'unknown', 'gone'] })).toEqual({ result: 'builder ended', did: [], poll: 2 });
    // A group that ignores SIGTERM, or cannot be read, gets SIGKILL after the grace period.
    expect(run({ driver: ['gone'], ignoresTerm: true }).did).toEqual(['SIGTERM', 'SIGKILL', 'release']);
    expect(run({ driver: ['gone'], groupUnknown: true }).did).toEqual(['SIGTERM', 'SIGKILL', 'release']);
  });

  it('watches a builder whose leader exited while its group lives, and lets go of a reused leader pid', () => {
    const calls: string[] = [];
    const group = (left: boolean | null) => () => (calls.push('group'), left);
    expect(builderLiveness('alive', group(false))).toBe('alive');
    expect(builderLiveness('unknown', group(false))).toBe('unknown');
    expect(calls).toEqual([]); // a live leader needs no group read
    expect(builderLiveness('exited', group(true))).toBe('alive'); // members left: still the builder's, still watched
    expect(builderLiveness('exited', group(false))).toBe('gone');
    expect(builderLiveness('exited', group(null))).toBe('unknown');
    expect(builderLiveness('reused', group(true))).toBe('gone'); // that group is another one now
  });

  it('refuses a builder worktree that is, contains or sits inside a protected worktree', () => {
    const id = (p: string): string => p;
    // As the caller passes them: the main checkout, the driver's worktree, and every listed worktree but the candidate's own.
    const protectedPaths = ['/Users/me/dragon', '/tmp/dragon-land', '/tmp/dragon-repla'];
    expect(unsafeWorktree('/tmp/dragon-land-next', protectedPaths, id)).toBeNull();
    expect(unsafeWorktree('/tmp/dragon-landx', protectedPaths, id)).toBeNull(); // a sibling sharing a prefix
    // Equal to the driver's worktree, the main checkout or another worktree: refused, never skipped.
    expect(unsafeWorktree('/tmp/dragon-land', protectedPaths, id)).toMatch(/is the worktree \/tmp\/dragon-land$/);
    expect(unsafeWorktree('/Users/me/dragon', protectedPaths, id)).toMatch(/is the worktree \/Users\/me\/dragon$/);
    expect(unsafeWorktree('/tmp/dragon-repla/', protectedPaths, id)).toMatch(/is the worktree \/tmp\/dragon-repla$/);
    expect(unsafeWorktree('/tmp', protectedPaths, id)).toMatch(/contains the worktree \/Users\/me\/dragon|contains the worktree \/tmp\/dragon-land/);
    expect(unsafeWorktree('/Users/me', protectedPaths, id)).toMatch(/contains the worktree \/Users\/me\/dragon/);
    expect(unsafeWorktree('/Users/me/dragon/next', protectedPaths, id)).toMatch(/inside the worktree \/Users\/me\/dragon/);
    expect(unsafeWorktree('/', protectedPaths, id)).toMatch(/root/);
    // Compared after resolving (a symlinked /tmp, a trailing slash).
    expect(unsafeWorktree('/private/tmp/', protectedPaths, (p) => p.replace(/^\/private/, ''))).toMatch(/contains/);
  });

  it('reads LAND_BATCH strictly', () => {
    expect(parseBatchSize(undefined)).toBe(4);
    expect(parseBatchSize('1')).toBe(1);
    expect(parseBatchSize('8')).toBe(8);
    for (const bad of ['0', '9', '-1', '2.5', 'four', '']) expect(() => parseBatchSize(bad)).toThrow(/LAND_BATCH/);
    expect(() => runBatches([e(1)], 0, harness().ops)).toThrow(/batch size/);
  });
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
      '.gitignore': 'node_modules/\npackages/translate/out/\npackages/parity/out/*\n!packages/parity/out/kept.json\n*.tsbuildinfo\nvendor/wpt/\nbuild/\ndist/\n',
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
      'packages/translate/out/kotlin/0123abcd/harness.jar',
      'packages/translate/out/swift/0123abcd/harness',
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
    const files = execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(isFloorFile);
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const t = readFileSync(repoPath(f), 'utf8');
      expect(floorRegressions(f, t, t), f).toEqual([]);
    }
  });
});

describe('LAND_REGEN (every regen of a landing tree on CI)', () => {
  it('is local, ci or ci-only, unset is local, and anything else stops the driver before it starts', () => {
    expect(parseLandModes({}).regen).toBe('local');
    for (const v of ['local', 'ci', 'ci-only'] as const) expect(parseLandModes({ LAND_REGEN: v }).regen).toBe(v);
    for (const bad of ['', 'CI', 'only', 'remote', ' ci']) expect(() => parseLandModes({ LAND_REGEN: bad }), bad).toThrow(`land: LAND_REGEN must be local, ci or ci-only, not ${JSON.stringify(bad)}`);
    const src = readFileSync(repoPath('scripts/land.ts'), 'utf8');
    expect(src).toContain('({ devices: DEVICES_ON, test: TEST_ON, regen: REGEN_ON, ciOnly: CI_ONLY } = parseLandModes(env));');
    expect(src).toContain("REGEN_WAIT_S = seconds('LAND_REGEN_WAIT', DEFAULT_REGEN_WAIT_S);");
  });
  it('sends every regen call site through regenTree, and a parallel preparation dispatches its regen on CI', () => {
    const src = readFileSync(repoPath('scripts/land.ts'), 'utf8');
    // The only heavy pnpm regen is regenTree's local branch; the four call sites (and the one-by-one fallback) use regenTree.
    expect([...src.matchAll(/heavy\([^)]*REGEN\)/g)].length).toBe(1);
    for (const site of ["regenTree('regen', 'regen')", "regenTree('regen-carried', 'regen')", "regenTree('regen-after-devices', 'regen-after-devices')", "regenTree('regen-records', 'regen')"]) expect(src, site).toContain(site);
    const prepare = src.slice(src.indexOf('const preparePosition'), src.indexOf('const awaitPrepared'));
    expect(prepare.indexOf("if (REGEN_ON !== 'local')")).toBeGreaterThan(-1);
    expect(prepare.indexOf("if (REGEN_ON !== 'local')")).toBeLessThan(prepare.indexOf('spawn('));
    expect(src).toContain("'refs/heads/land-regen/*'");
    // A local git error making the tree's commit judged nothing about the PR (#220 review).
    const dispatch = src.slice(src.indexOf('const dispatchRegen'), src.indexOf('const finishRegen'));
    expect(dispatch).toMatch(/try \{\n {4}sha = commitApart\([^\n]+\n {2}\} catch \(error\) \{\n {4}throw new CiUnavailable\(/);
    // The regen commit names the CI run that regenerated it (#220 review).
    expect(src).toContain('regenRan = `${REGEN.join(\' \')} on CI (regen-on-ci.yml ${url})`;');
    expect(src).toContain('const commands = [regenRan];');
    expect(src).toContain('commands.push(ran, regenRan);');
  });

  describe('where a regen runs when GitHub Actions does not run it', () => {
    const setup = (o: { mode?: 'local' | 'ci'; mac: boolean; ready?: boolean; ci?: () => void }) => {
      const calls: string[] = [];
      const go = () =>
        landRegen({
          mode: o.mode ?? 'ci',
          mac: o.mac,
          ready: () => (calls.push('ready'), o.ready ?? true),
          ci: () => (calls.push('ci'), o.ci?.()),
          local: () => void calls.push('local'),
          log: (l) => void calls.push(l),
        });
      return { calls, go };
    };
    it('local runs pnpm regen locally and never asks CI', () => {
      const s = setup({ mode: 'local', mac: false });
      expect(s.go()).toBe('local');
      expect(s.calls).toEqual(['local']);
    });
    it('ci runs on CI, with no local regen', () => {
      const s = setup({ mac: false });
      expect(s.go()).toBe('ci');
      expect(s.calls).toEqual(['ready', 'ci']);
    });
    it('on a Mac, falls back to the local regen loudly, as LAND_DEVICES=ci does', () => {
      const s = setup({ mac: true, ci: () => { throw new CiUnavailable('no run appeared'); } });
      expect(s.go()).toBe('local');
      expect(s.calls).toEqual(['ready', 'ci', '  !!! LAND_REGEN=ci: GitHub Actions did not run the regen (no run appeared); running pnpm regen locally', 'local']);
      const early = setup({ mac: true, ready: false });
      expect(early.go()).toBe('local');
      expect(early.calls[1]).toContain("master's regen-on-ci.yml has no patch mode yet");
    });
    it('off a Mac, stops the driver (Fatal) and blames no PR, with no local regen', () => {
      const s = setup({ mac: false, ci: () => { throw new CiUnavailable('jobs never started'); } });
      expect(s.go).toThrow(Fatal);
      expect(s.go).toThrow('GitHub Actions did not run the regen (jobs never started); this host is not a Mac, so no local regen can stand in for it. The driver stops; no PR is blamed');
      expect(s.calls).not.toContain('local');
      const early = setup({ mac: false, ready: false });
      expect(early.go).toThrow(Fatal);
      expect(early.calls).toEqual(['ready']);
    });
    it('a regen that failed on CI is the PR\'s, as a failed local regen is: never a fallback', () => {
      for (const mac of [true, false]) {
        const s = setup({ mac, ci: () => { throw new LandFailure('regen-after-devices', 'the CI regen run u has failed jobs'); } });
        expect(s.go).toThrow(LandFailure);
        expect(s.calls).not.toContain('local');
      }
      // Any other error is not swallowed either (the queue loop fails the PR with it, as before).
      const odd = setup({ mac: true, ci: () => { throw new Error('disk full'); } });
      expect(odd.go).toThrow('disk full');
      expect(odd.calls).not.toContain('local');
    });
  });

  describe('the CI regen\'s patch, applied to the landing tree on a scratch repository', () => {
    const dir = tempDir();
    const ci = join(dir, 'ci');
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const config = ['user.name=t', 'user.email=t@t', 'commit.gpgsign=false', 'core.hooksPath=/dev/null'].flatMap((c) => ['-c', c]);
    const at = (cwd: string) => (args: string[]): string => execFileSync('git', [...config, ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const git = at(repo);
    const bin = (seed: number, n: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + (i >> 3)) % 256));
    const write = (root: string, files: Record<string, string | Buffer | null>): void => {
      for (const [p, body] of Object.entries(files)) {
        if (body === null) rmSync(join(root, p));
        else {
          mkdirSync(dirname(join(root, p)), { recursive: true });
          writeFileSync(join(root, p), body);
        }
      }
    };
    git(['init', '-q', '-b', 'master']);
    write(repo, { 'src/a.ts': 'export const a = 1;\n', 'out/x.json': '{"x":1}\n', 'out/shot.png': bin(7, 4096), 'out/gone.bin': bin(3, 300), 'out/keep.txt': 'same\n' });
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
    // The landing tree: HEAD plus uncommitted work (a carried device record, an untracked file), committed apart as the driver
    // does (commitApart: a scratch index, HEAD as parent).
    write(repo, { 'out/x.json': '{"x":2}\n', 'out/new-record.json': '{}\n' });
    const index = join(dir, 'scratch-index');
    const apart = (args: string[]) => execFileSync('git', [...config, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: index } }).trim();
    apart(['read-tree', 'HEAD']);
    apart(['add', '-A']);
    const base = apart(['commit-tree', apart(['write-tree']), '-p', 'HEAD', '-m', 'landing tree']);
    // The CI regen: a checkout of that commit, regenerated (binary changes, a new binary, a deletion, a text change), its patch
    // the round's own command (git diff --cached --binary <sha>).
    git(['worktree', 'add', '-q', '--detach', ci, base]);
    write(ci, { 'out/shot.png': bin(11, 5000), 'out/new.png': bin(13, 777), 'out/gone.bin': null, 'out/x.json': '{"x":2,"y":3}\n' });
    at(ci)(['add', '-A']);
    const regenerated = at(ci)(['write-tree']).trim();
    const patch = join(dir, 'outputs.patch');
    writeFileSync(patch, at(ci)(['diff', '--cached', '--binary', base]));
    const empty = join(dir, 'empty.patch');
    writeFileSync(empty, '');
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('makes the tree exactly the CI regen\'s, binary files included, staged', () => {
      expect(readFileSync(patch, 'utf8')).toContain('GIT binary patch');
      const bytes = applyRegenPatch(git, base, patch);
      expect(bytes).toBe(readFileSync(patch).length);
      expect(git(['write-tree']).trim()).toBe(regenerated);
      for (const p of ['out/shot.png', 'out/new.png', 'out/x.json', 'out/keep.txt', 'src/a.ts']) expect(readFileSync(join(repo, p)).equals(readFileSync(join(ci, p))), p).toBe(true);
      expect(existsSync(join(repo, 'out/gone.bin'))).toBe(false);
      // Staged whole: the worktree is the index (git apply --index).
      expect(git(['diff', '--name-only'])).toBe('');
      // Back to the landing tree for the next cases.
      git(['read-tree', '-u', '--reset', base]);
      expect(git(['write-tree']).trim()).toBe(at(repo)(['rev-parse', `${base}^{tree}`]).trim());
    });
    it('applies nothing for an empty patch (a tree at its fixed point)', () => {
      expect(applyRegenPatch(git, base, empty)).toBe(0);
      expect(git(['write-tree']).trim()).toBe(git(['rev-parse', `${base}^{tree}`]).trim());
    });
    it('refuses a tree that is not the commit the CI regen ran on, a missing patch, and a patch that does not apply, changing nothing', () => {
      write(repo, { 'src/a.ts': 'export const a = 2;\n' });
      expect(() => applyRegenPatch(git, base, patch)).toThrow(`which the CI regen ran on`);
      write(repo, { 'src/a.ts': 'export const a = 1;\n' });
      expect(() => applyRegenPatch(git, base, join(dir, 'nope.patch'))).toThrow('nope.patch is missing');
      const broken = join(dir, 'broken.patch');
      writeFileSync(broken, readFileSync(patch, 'utf8').replace('{"x":2}', '{"x":9}'));
      git(['add', '-A']);
      const before = git(['write-tree']).trim();
      expect(before).toBe(git(['rev-parse', `${base}^{tree}`]).trim());
      expect(() => applyRegenPatch(git, base, broken)).toThrow();
      // All or nothing: not even the binary files of the patch were written.
      expect(git(['write-tree']).trim()).toBe(before);
      expect(git(['diff', '--name-only'])).toBe('');
    });
  });
});

describe('ci-only: every heavy step on GitHub runners, never here (LAND_CI=only)', () => {
  const src = readFileSync(repoPath('scripts/land.ts'), 'utf8');
  it('reads LAND_CI, LAND_DEVICES, LAND_TEST and LAND_REGEN strictly; LAND_CI=only sets all three and refuses any other value', () => {
    expect(parseLandModes({})).toEqual({ devices: 'local', test: 'local', regen: 'local', ciOnly: false });
    expect(parseLandModes({ LAND_CI: 'only' })).toEqual({ devices: 'ci-only', test: 'ci-only', regen: 'ci-only', ciOnly: true });
    expect(parseLandModes({ LAND_CI: 'only', LAND_TEST: 'ci-only' }).ciOnly).toBe(true);
    expect(parseLandModes({ LAND_DEVICES: 'ci-only', LAND_TEST: 'ci-only', LAND_REGEN: 'ci-only' }).ciOnly).toBe(true);
    // One step ci-only: that step never falls back, but the others still run here, so the shared-Mac coordination stays.
    expect(parseLandModes({ LAND_DEVICES: 'ci-only', LAND_TEST: 'ci' })).toEqual({ devices: 'ci-only', test: 'ci', regen: 'local', ciOnly: false });
    for (const name of ['LAND_DEVICES', 'LAND_TEST', 'LAND_REGEN']) {
      for (const bad of ['', 'CI', 'only', 'ci_only', 'ci-only ']) expect(() => parseLandModes({ [name]: bad }), `${name}=${bad}`).toThrow(`land: ${name} must be local, ci or ci-only, not ${JSON.stringify(bad)}`);
      for (const other of ['local', 'ci']) expect(() => parseLandModes({ LAND_CI: 'only', [name]: other })).toThrow(`land: LAND_CI=only runs every step on CI only, but ${name} is "${other}"`);
    }
    for (const bad of ['', 'ONLY', '1', 'ci', 'yes']) expect(() => parseLandModes({ LAND_CI: bad }), bad).toThrow(`land: LAND_CI must be only (or unset), not ${JSON.stringify(bad)}`);
    expect(parseMaxInflight(undefined)).toBe(2);
    expect(parseMaxInflight('1')).toBe(1);
    expect(parseMaxInflight('8')).toBe(8);
    for (const bad of ['0', '9', '-1', '2.5', '', ' 2', 'two']) expect(() => parseMaxInflight(bad), bad).toThrow('LAND_CI_MAX_INFLIGHT must be a whole number from 1 to 8');
    expect(src).toContain("CI_QUEUE_S = seconds('LAND_CI_QUEUE_WAIT', DEFAULT_QUEUE_WAIT_S);");
    expect(src).toContain("CI_MAX_INFLIGHT = parseMaxInflight(env['LAND_CI_MAX_INFLIGHT']);");
  });

  it('never falls back to a local run: every CiUnavailable the driver catches stops it as a CI outage under ci-only, before any local run', () => {
    const catches = [...src.matchAll(/instanceof CiUnavailable\)/g)].map((m) => src.slice(m.index - 120, m.index + 700));
    expect(catches.length).toBe(3); // devices, the full test, a prepared CI regen (regenTree goes through landRegen)
    for (const c of catches) {
      const stop = c.search(/if \((DEVICES_ON|TEST_ON|REGEN_ON) === 'ci-only'(?: && error instanceof CiUnavailable)?\) throw new CiOutage\(/);
      expect(stop, c.slice(0, 120)).toBeGreaterThan(-1);
      const local = c.search(/running (them|pnpm test) locally/);
      if (local !== -1) expect(stop).toBeLessThan(local);
    }
    // The CI workflow missing from master is an outage too under ci-only, never a local run.
    for (const ready of ['const ciDevicesReady', 'const ciTestReady']) {
      const body = src.slice(src.indexOf(ready), src.indexOf('};', src.indexOf(ready)));
      expect(body, ready).toMatch(/=== 'ci-only'\) throw new CiOutage\(/);
    }
    // Every CI wait passes the queue wait.
    expect([...src.matchAll(/startS: CI_START_S, queueS: CI_QUEUE_S/g)].length).toBe(2);
    expect(src).toMatch(/startS: CI_START_S,\n\s+queueS: CI_QUEUE_S,/);
  });

  it('needs no lease, no quiet-machine or priority file and no /tmp helper script once every step is ci-only', () => {
    // The leases (zsh scripts in /tmp) are used only by the local regen, test and device run, which ci-only never reaches.
    expect([...src.matchAll(/\bHEAVY\b/g)].length).toBe(3); // its definition, heavy(), and the local parallel regen
    expect(src).toMatch(/const heavy = \(step: string, argv: string\[\]\): Run => run\(step, \[HEAVY, \.\.\.argv\]/);
    expect([...src.matchAll(/\[DEVICE, \.\.\.DEVICES\]/g)].length).toBe(1);
    const prepare = src.slice(src.indexOf('const preparePosition'), src.indexOf('const awaitPrepared'));
    expect(prepare.indexOf("if (REGEN_ON !== 'local')")).toBeLessThan(prepare.indexOf('HEAVY'));
    expect(src).toContain("if (!CI_ONLY) writeFileSync(PRIORITY, String(process.pid));");
    expect(src).toContain("if (!CI_ONLY && clearStaleQuiet(QUIET_FILE, alive))");
    const releasePriority = src.slice(src.indexOf('const releasePriority'), src.indexOf('};', src.indexOf('const releasePriority')));
    expect(releasePriority).toContain('if (CI_ONLY) return;');
    // The quiet-machine wait is only in the local test's rerun.
    expect([...src.matchAll(/waitQuiet\(\)/g)].length).toBe(1);
    expect(src.indexOf('waitQuiet()')).toBeGreaterThan(src.indexOf('const proveIn'));
  });

  it('dispatches at most LAND_CI_MAX_INFLIGHT prepared CI regens at once; the positions above build one by one', () => {
    const prepare = src.slice(src.indexOf('const preparePosition'), src.indexOf('const awaitPrepared'));
    const cap = prepare.indexOf("if (REGEN_ON !== 'local' && k > CI_MAX_INFLIGHT) throw new Error(");
    expect(cap).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(prepare.indexOf("git(['worktree', 'add'"));
    // A preparation that throws builds that position and every one above it one by one (buildPositionsParallel).
    const order: string[] = [];
    const slots = buildPositionsParallel<number, { head: string }, number>('m', [1, 2, 3, 4].map((pr) => ({ entry: { branch: `b${pr}`, pr, clean: sha('a') }, ticket: pr })), {
      speculate: (k) => {
        if (k > 2) throw new Error('LAND_CI_MAX_INFLIGHT is 2');
        order.push(`dispatch ${k}`);
        return k;
      },
      await: () => {},
      assemble: (_p, it) => (order.push(`assemble #${it.entry.pr}`), { head: `h${it.entry.pr}` }),
      sequential: (_p, it) => (order.push(`one by one #${it.entry.pr}`), { head: `h${it.entry.pr}` }),
      abandon: () => {},
      log: () => {},
    });
    expect(slots).toHaveLength(4);
    expect(order).toEqual(['dispatch 1', 'dispatch 2', 'assemble #1', 'assemble #2', 'one by one #3', 'one by one #4']);
  });

  describe('a regen GitHub Actions did not run', () => {
    const go = (o: { mode: 'ci' | 'ci-only'; mac: boolean; ready?: boolean; fail?: Error }) => {
      const calls: string[] = [];
      const f = () =>
        landRegen({ mode: o.mode, mac: o.mac, ready: () => o.ready ?? true, ci: () => { calls.push('ci'); if (o.fail) throw o.fail; }, local: () => void calls.push('local'), log: (l) => void calls.push(l) });
      return { calls, f };
    };
    it('stops the driver as a CI outage under ci-only, even on a Mac, with no local regen', () => {
      for (const mac of [true, false]) {
        const s = go({ mode: 'ci-only', mac, fail: new CiUnavailable('jobs never started') });
        expect(s.f).toThrow(CiOutage);
        expect(s.f).toThrow('LAND_REGEN=ci-only: GitHub Actions did not run the regen (jobs never started). The driver stops; no PR is blamed');
        expect(s.calls).not.toContain('local');
        const early = go({ mode: 'ci-only', mac, ready: false });
        expect(early.f).toThrow("LAND_REGEN=ci-only: master's regen-on-ci.yml has no patch mode yet");
        expect(early.calls).toEqual([]);
      }
      // Off a Mac, plain ci is an outage too (no local regen writes the same outputs there).
      expect(go({ mode: 'ci', mac: false, fail: new CiUnavailable('no run') }).f).toThrow(CiOutage);
    });
    it('still blames the PR for a regen that failed on CI, and runs on CI when it can', () => {
      const s = go({ mode: 'ci-only', mac: false, fail: new LandFailure('regen', 'the CI regen run u has failed jobs') });
      expect(s.f).toThrow(LandFailure);
      expect(s.f).not.toThrow(CiOutage);
      const ok = go({ mode: 'ci-only', mac: false });
      expect(ok.f()).toBe('ci');
      expect(ok.calls).toEqual(['ci']);
    });
  });

  describe('R3: the Android records CI makes (x86_64) after the ones this Mac made (arm64)', () => {
    // master's own device records, and the same records as a CI run would write them: only the Android image ABI differs.
    const lanesText = readFileSync(repoPath('packages/parity/out/lanes.json'), 'utf8');
    const failures = (t: string): unknown => JSON.parse(readFileSync(repoPath(failuresJson(t)), 'utf8'));
    const toCi = (text: string): string => text.replaceAll('built for arm64 /', 'built for x86_64 /').replaceAll('Android 16, arm64-v8a)', 'Android 16, x86_64)');
    const master = parseDeviceEvidence(JSON.parse(lanesText), failures, 'master');
    const ci = (edit: (lanes: string) => string = (x) => x, fail: (t: string) => unknown = failures) => parseDeviceEvidence(JSON.parse(edit(toCi(lanesText))), fail, 'ci');
    it('master\'s records are the arm64 image\'s; the CI copy differs in the ABI alone', () => {
      expect([...androidAbis(master)]).toEqual(['arm64']);
      expect([...androidAbis(ci())]).toEqual(['x86_64']);
      expect(normalAbi('arm64-v8a')).toBe('arm64');
      expect(hostAbi('arm64')).toBe('arm64');
      expect(hostAbi('x64')).toBe('x86_64');
      expect(toCi(lanesText)).not.toBe(lanesText);
    });
    it('accepts it as an architecture rebaseline when every lane keeps its state and exact failures', () => {
      const c = archChanges(master, ci());
      expect(c.other).toEqual([]);
      expect(c.abi.length).toBeGreaterThan(0);
      const r = ciArchRebaseline(master, ci());
      expect(r.rebaseline).toBe(true);
      expect(deviceRunProblems(master, ci(), [], { rebaseline: r.rebaseline })).toEqual([]);
      // Without it the first CI landing fails judge-devices on the architecture alone (the gap R3 names).
      expect(deviceRunProblems(master, ci(), []).every((p) => p.includes('changing a lane\'s architecture is an explicit rebaseline'))).toBe(true);
      // Later positions compare like with like: no change, no rebaseline.
      expect(ciArchRebaseline(ci(), ci())).toEqual({ rebaseline: false, changes: [] });
    });
    it('refuses any verdict difference, even one the normal rule allows (a fixed failure on a changed lane)', () => {
      const android = (failures('android') as { lane: string }[]);
      expect(android.length).toBeGreaterThan(0);
      const extra = [...android, { ...(android[0] as object), case: 'a-case-master-does-not-fail' }];
      const more = ci((x) => x, (t) => (t === 'android' ? extra : failures(t)));
      expect(ciArchRebaseline(master, more).rebaseline).toBe(true);
      expect(deviceRunProblems(master, more, [], { rebaseline: true }).length).toBeGreaterThan(0);
      const fewer = ci((x) => x, (t) => (t === 'android' ? android.slice(1) : failures(t)));
      expect(deviceRunProblems(master, fewer, [], { rebaseline: true }).some((p) => p.includes('an architecture rebaseline needs master\'s state and exactly master\'s failures'))).toBe(true);
    });
    it('is never automatic for any other model change: an iOS model, another device, or a model that differs beyond its ABI', () => {
      const ios = ci((x) => x.replaceAll('"model": "iPhone 17"', '"model": "iPhone 17 Pro"'));
      expect(archChanges(master, ios).other.length).toBeGreaterThan(0);
      expect(ciArchRebaseline(master, ios)).toEqual({ rebaseline: false, changes: [] });
      const renamed = ci((x) => x.replaceAll('x86_64 / dragon-320', 'x86_64 / dragon-320b'));
      expect(ciArchRebaseline(master, renamed).rebaseline).toBe(false);
      const vectorsDevice = ci((x) => x.replace('ART app_process on dragon-smoke (Android 16, x86_64)', 'ART app_process on dragon-480 (Android 16, x86_64)'));
      expect(ciArchRebaseline(master, vectorsDevice).rebaseline).toBe(false);
    });
    it('is wired into the driver: only a CI device run rebaselines, logged loudly and recorded in the landing; a local fallback onto another ABI stops instead', () => {
      expect(src).toContain('const judged = judgeDevices(prev, started, ci !== null);');
      expect(src).toContain('const { problems } = judgeDevices(prev, null);');
      expect(src).toContain('const auto = !arch.rebaseline && onCi ? ciArchRebaseline(before, after)');
      expect(src).toContain('!!! ARCHITECTURE REBASELINE');
      expect(src).toContain("rebaseline: arch.rebaseline || auto.rebaseline");
      expect(src).toMatch(/const abis = \[\.\.\.androidAbis\(evidenceAt\(prev\)\)\]\.filter\(\(a\) => a !== hostAbi\(process\.arch\)\);\n\s+if \(abis\.length > 0\) throw new CiOutage\(/);
    });
  });
});
