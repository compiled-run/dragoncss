// Prints a PR's check runs and the Macroscope review comments nobody has answered yet; exits 1 while anything is open.
// Run with: pnpm run pr:review [<pr number>] [--wait | --once] [--conflicts-ok]
// --once polls a single time and exits 0 (clean), 1 (not clean) or 2 (pending, where --wait would poll again); the caller owns the deadline.
import { execFileSync } from 'node:child_process';
import { ghRest } from './gh-rest.ts';
import {
  CORRECTNESS,
  CORRECTNESS_GRACE_MS,
  type CheckRun,
  correctnessSucceeded,
  type Earlier,
  type Git,
  type Ignore,
  ignoreAt,
  isVouchableSkip,
  judgedHead,
  onceExit,
  outcome,
  type PrHead,
  type PatchId,
  patchIdOver,
  reviewExit,
  settled,
  skipScope,
  SPENDING_LIMIT,
  type Vouch,
  vouchForSkip,
  waivedWithoutCorrectness,
} from './pr-review-vouch.ts';

const isMacroscope = (login: string): boolean => login.toLowerCase().includes('macroscope');

const args = process.argv.slice(2);
const wait = args.includes('--wait');
const once = args.includes('--once');
if (wait && once) throw new Error('pr-review: --wait and --once are exclusive');
const conflictsOk = args.includes('--conflicts-ok');
const rest = ghRest();
const currentBranchPr = (): string => {
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  const found = rest.prForBranch(branch);
  if (found === null) throw new Error(`pr-review: no open PR has ${branch} as its head; pass the PR number`);
  return String(found.number);
};
const pr = args.find((a) => /^\d+$/.test(a)) ?? currentBranchPr();
if (!/^\d+$/.test(pr)) throw new Error(`pr-review: not a PR number: ${JSON.stringify(pr)}`);
const prNumber = Number(pr);
// The head is re-read on every poll, so a push during --wait is judged on its own checks, never on the previous commit's.
let head: PrHead = { sha: '', mergeable: 'UNKNOWN' };
let sha = '';
const checkRuns = (): CheckRun[] => {
  const view = rest.prView(prNumber);
  const seen: PrHead = { sha: view.sha, mergeable: view.mergeable };
  if (conflictsOk && seen.mergeable === 'CONFLICTING' && head.sha !== seen.sha) console.error(`pr-review: GitHub reports ${seen.sha} CONFLICTING; --conflicts-ok leaves that to the merge train's drivers`);
  head = judgedHead(seen, conflictsOk, view.state === 'OPEN');
  sha = head.sha;
  return runsOf(sha);
};
const runsOf = (commit: string): CheckRun[] => rest.checkRuns(commit);

const git: Git = (args, input) => execFileSync('git', args, { input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
const message = (error: unknown): string => {
  const raw = (error as { stderr?: unknown }).stderr;
  const stderr = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  return typeof stderr === 'string' && stderr.trim() !== '' ? stderr.trim() : error instanceof Error ? error.message : String(error);
};
const haveCommit = (commit: string): boolean => {
  try {
    git(['cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};
const fetched = (commit: string): { error: string } | null => {
  try {
    if (!haveCommit(commit)) git(['fetch', '--quiet', 'origin', commit]);
  } catch (error) {
    return { error: `${commit}: ${message(error)}` };
  }
  return haveCommit(commit) ? null : { error: `commit ${commit} is not available locally even after fetching it` };
};

const vouchFor = (run: CheckRun, head: string): Vouch => {
  const view = rest.prView(prNumber);
  const base = view.base;
  const commits = rest.prCommits(prNumber);
  if (commits.length === 0) throw new Error(`pr-review: PR #${pr} lists no commits`);
  const at = commits.indexOf(head);
  if (at < 0) return { ok: false, reason: `head ${head} is not in the PR's commit list` };
  const baseRef = `refs/remotes/origin/${base}`;
  try {
    git(['fetch', '--quiet', 'origin', `+refs/heads/${base}:${baseRef}`, `refs/pull/${pr}/head`]);
  } catch (error) {
    return { ok: false, reason: `git fetch of ${base} and PR #${pr} failed: ${message(error)}` };
  }
  const scope = skipScope(run);
  if (scope === null) return vouchForSkip(run, { error: 'not a vouchable skip' }, []);
  if (scope === 'reviewed paths' && view.crossRepository) {
    return { ok: false, reason: `PR #${pr} comes from a fork, which Macroscope reviews with the base branch's ignore file` };
  }
  const headMissing = fetched(head);
  if (headMissing) return { ok: false, reason: `head: ${headMissing.error}` };
  let ignore: Ignore | undefined;
  if (scope === 'reviewed paths') {
    const read = ignoreAt(git, head);
    if ('error' in read) return { ok: false, reason: `head: ${read.error}` };
    ignore = read;
  }
  const patchIdOf = (commit: string): PatchId => fetched(commit) ?? patchIdOver(git, commit, baseRef, scope, ignore);
  const earlier: Earlier[] = commits.slice(0, at).map((c) => ({ sha: c, runs: runsOf(c) }));
  for (const c of earlier) if (correctnessSucceeded(c.runs)) c.patchId = patchIdOf(c.sha);
  return vouchForSkip(run, patchIdOf(head), earlier);
};

// A skipped correctness review (for example over the per-review cost limit) is no review, so it never counts as passed,
// except a "Diff unchanged", "already reviewed" or "no code objects reviewed" skip that vouchForSkip ties to an earlier reviewed
// commit with the same patch id.
// Vouches are judged on every poll, before settled(), so the wait loop and the final verdict read the same verdictOf.
const vouches = new Map<string, Vouch>();
const judge = (rs: CheckRun[]): Map<string, Vouch> => {
  for (const run of rs.filter(isVouchableSkip)) {
    const key = run.html_url;
    if (!vouches.has(key)) vouches.set(key, vouchFor(run, sha));
  }
  return vouches;
};

let runs = checkRuns();
const deadline = Date.now() + 45 * 60_000;
while (wait && !settled(runs, judge(runs), head) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  runs = checkRuns();
}
// One clock for the settled test and the verdict, so --once never reports pending beside a clean verdict.
const now = Date.now();
const isSettled = settled(runs, judge(runs), head, now);

console.log(`PR #${pr} at ${sha}\n\nChecks:`);
for (const run of runs) console.log(`  ${run.status === 'completed' ? run.conclusion : run.status}\t${run.name}\t${run.html_url}${run.output?.title ? `\t(${run.output.title})` : ''}`);

for (const run of runs.filter(isVouchableSkip)) {
  const vouch = vouches.get(run.html_url);
  const skip = `${CORRECTNESS} skipped as ${JSON.stringify(run.output?.title)}`;
  if (vouch?.ok) console.log(`\n${skip}: earlier commit ${vouch.sha} passed it with the same patch id ${vouch.patchId} over ${vouch.scope}`);
  else console.log(`\n${skip}, not vouched for: ${vouch?.reason ?? 'not judged'}`);
}

// Macroscope reports findings as inline review comments; a finding is answered once anyone else replies in its thread.
const comments = rest.reviewComments(prNumber);
const answered = new Set(comments.filter((c) => c.in_reply_to_id !== undefined && !isMacroscope(c.user.login)).map((c) => c.in_reply_to_id));
const open = comments.filter((c) => c.in_reply_to_id === undefined && isMacroscope(c.user.login) && !answered.has(c.id));

console.log(`\nUnanswered Macroscope findings: ${open.length}`);
for (const c of open) console.log(`\n--- ${c.path}:${c.line ?? '?'} (comment ${c.id})\n${c.html_url}\n${c.body.trim()}`);

const result = outcome(runs, vouches, head, now);
const { pending, failed } = result;
if (result.unreviewed) {
  console.log(`\n!!! UNREVIEWED: Macroscope spending limit. Every Macroscope check of ${sha} was skipped with "${SPENDING_LIMIT}"; the owner's`);
  console.log('!!! standing directive (2026-10-02) lets this commit land without a Macroscope review once CI passes and every finding is answered.');
  if (waivedWithoutCorrectness(runs, now)) console.log(`!!! Macroscope created no "${CORRECTNESS}" check within ${CORRECTNESS_GRACE_MS / 60_000} minutes of CI passing; treated as the same limit.`);
}
if (pending.length > 0) console.log(`\nStill running: ${pending.join(', ')}`);
if (failed.length > 0) console.log(`\nFailed: ${failed.join(', ')}`);
process.exit(once ? onceExit(isSettled, result, open.length) : reviewExit(result, open.length));
