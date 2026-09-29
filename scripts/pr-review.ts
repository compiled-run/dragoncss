// Prints a PR's check runs and the Macroscope review comments nobody has answered yet; exits 1 while anything is open.
// Run with: pnpm run pr:review [<pr number>] [--wait]
import { execFileSync } from 'node:child_process';

type CheckRun = { name: string; status: string; conclusion: string | null; html_url: string };
type ReviewComment = {
  id: number;
  in_reply_to_id?: number;
  user: { login: string };
  path: string;
  line: number | null;
  body: string;
  html_url: string;
};

// GitHub's API times out now and then; a transient failure must not end a --wait.
const gh = (args: string[], attempt = 1): string => {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (attempt >= 5) throw error;
    execFileSync('sleep', [String(attempt * 5)]);
    return gh(args, attempt + 1);
  }
};
const ghJson = <T>(path: string): T[] => (JSON.parse(gh(['api', '--paginate', '--slurp', path])) as T[][]).flat();
const isMacroscope = (login: string): boolean => login.toLowerCase().includes('macroscope');
const passed = (run: CheckRun): boolean => ['success', 'neutral', 'skipped'].includes(run.conclusion ?? '');

const args = process.argv.slice(2);
const wait = args.includes('--wait');
const pr = args.find((a) => /^\d+$/.test(a)) ?? gh(['pr', 'view', '--json', 'number', '--jq', '.number']).trim();
const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
const sha = gh(['pr', 'view', pr, '--json', 'headRefOid', '--jq', '.headRefOid']).trim();

const checkRuns = (): CheckRun[] =>
  (JSON.parse(gh(['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`])) as { check_runs: CheckRun[] }).check_runs;

// Macroscope's correctness review starts only after CI passes, so a green CI alone is not "done"; a failed check ends the wait.
const CORRECTNESS = 'Macroscope - Correctness Check';
const settled = (rs: CheckRun[]): boolean =>
  rs.length > 0 && rs.every((r) => r.status === 'completed') && (rs.some((r) => r.name === CORRECTNESS) || rs.some((r) => !passed(r)));

let runs = checkRuns();
const deadline = Date.now() + 45 * 60_000;
while (wait && !settled(runs) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  runs = checkRuns();
}

console.log(`PR #${pr} at ${sha.slice(0, 7)}\n\nChecks:`);
for (const run of runs) console.log(`  ${run.status === 'completed' ? run.conclusion : run.status}\t${run.name}\t${run.html_url}`);

// Macroscope reports findings as inline review comments; a finding is answered once anyone else replies in its thread.
const comments = ghJson<ReviewComment>(`repos/${repo}/pulls/${pr}/comments?per_page=100`);
const answered = new Set(comments.filter((c) => c.in_reply_to_id !== undefined && !isMacroscope(c.user.login)).map((c) => c.in_reply_to_id));
const open = comments.filter((c) => c.in_reply_to_id === undefined && isMacroscope(c.user.login) && !answered.has(c.id));

console.log(`\nUnanswered Macroscope findings: ${open.length}`);
for (const c of open) console.log(`\n--- ${c.path}:${c.line ?? '?'} (comment ${c.id})\n${c.html_url}\n${c.body.trim()}`);

const pending = runs.filter((r) => r.status !== 'completed');
if (!runs.some((r) => r.name === CORRECTNESS)) pending.push({ name: CORRECTNESS, status: 'not started', conclusion: null, html_url: '' });
const failed = runs.filter((r) => r.status === 'completed' && !passed(r));
if (pending.length > 0) console.log(`\nStill running: ${pending.map((r) => r.name).join(', ')}`);
if (failed.length > 0) console.log(`\nFailed: ${failed.map((r) => r.name).join(', ')}`);
process.exit(pending.length + failed.length + open.length > 0 ? 1 : 0);
