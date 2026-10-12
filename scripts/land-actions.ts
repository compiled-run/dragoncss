// land.yml's steps around the driver, and the PM's way to dispatch it (land-state.ts has the decisions):
//   queue <out-file>: the workflow_dispatch `queue` input (LAND_QUEUE_INPUT) as a queue file; prints count=<n> to $GITHUB_OUTPUT
//     and the queue to the job summary. A malformed entry fails the step.
//   redispatch <handoff-file>: dispatches land.yml again on GITHUB_REF_NAME with the rest of the queue, when the driver's batch
//     ended normally, no stop was asked for and the land-stop label (LAND_STOP_ISSUE) is not set now.
//   dispatch <queue entries...>: the PM's dispatch (pnpm land:dispatch), on master.
//   clear-outage <pr>: after a real GitHub outage, ends a PR's land/outage streak at its current head without a new push (pnpm
//     land:clear-outage), with a success status. The driver trusts it only from its own identity or LAND_PROOF_WRITERS ids.
// Every dispatch first waits until no land.yml run waits to start: GitHub keeps one pending run per concurrency group and cancels
// the older one, which would drop its queue silently (dispatchLand).
// Run with: node scripts/land-actions.ts <command> <args>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearOutage, dispatchLand, type DispatchDeps, parseHandoff, parseStopIssue, queueFromInput, redispatchDecision, stopLabelSet } from './land-state.ts';

const env = process.env;
const gh = (args: string[]): string => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
};
const summary = (text: string): void => {
  if (env['GITHUB_STEP_SUMMARY']) appendFileSync(env['GITHUB_STEP_SUMMARY'], text);
};
const repoOf = (): string => {
  const repo = env['GITHUB_REPOSITORY'] || env['GH_REPO'] || execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`land-actions: ${JSON.stringify(repo)} is not owner/name`);
  return repo;
};
const deps = (repo: string, ref: string, self: number | null): DispatchDeps => ({
  gh,
  repo,
  ref,
  self,
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now: Date.now,
  log: (line) => console.log(line),
  waitS: Number(env['LAND_DISPATCH_WAIT'] || 6 * 3600),
  ...(env['LAND_DISPATCH_WATCH'] ? { watchS: Number(env['LAND_DISPATCH_WATCH']) } : {}),
});

const queue = (out: string): void => {
  const text = queueFromInput(env['LAND_QUEUE_INPUT'] ?? '');
  writeFileSync(out, text);
  const lines = text.split('\n').filter((l) => l !== '');
  console.log(lines.length === 0 ? 'the queue is empty' : `queue (${lines.length}):\n${text.trimEnd()}`);
  if (env['GITHUB_OUTPUT']) appendFileSync(env['GITHUB_OUTPUT'], `count=${lines.length}\n`);
  summary(`## Queue\n\n\`\`\`\n${text || '(empty)\n'}\`\`\`\n`);
};

const redispatch = (handoffPath: string): void => {
  const repo = repoOf();
  const ref = env['GITHUB_REF_NAME'] ?? '';
  const handoff = parseHandoff(readOrNull(handoffPath));
  const issue = parseStopIssue(env['LAND_STOP_ISSUE']);
  let stopNow = false;
  if (issue !== null && handoff !== null && handoff.remainder.length > 0) {
    try {
      stopNow = stopLabelSet(gh, repo, issue);
    } catch (error) {
      // As in the driver: a label that cannot be read counts as set.
      console.log(`could not read the labels of ${repo}#${issue} (${error instanceof Error ? error.message.split('\n')[0] : String(error)}); not re-dispatching`);
      stopNow = true;
    }
  }
  const d = redispatchDecision(handoff, stopNow);
  if (!d.dispatch) {
    console.log(`not re-dispatching: ${d.why}`);
    summary(`\nNot re-dispatched: ${d.why}\n`);
    return;
  }
  if (ref === '') throw new Error('land-actions: GITHUB_REF_NAME is not set');
  const self = /^[1-9]\d*$/.test(env['GITHUB_RUN_ID'] ?? '') ? Number(env['GITHUB_RUN_ID']) : null;
  const id = dispatchLand(d.queue, deps(repo, ref, self));
  console.log(`re-dispatched land.yml (run ${id}) on ${ref} with the rest of the queue:\n${d.queue}`);
  summary(`\nRe-dispatched land.yml (run ${id}) with the rest of the queue:\n\n\`\`\`\n${d.queue}\n\`\`\`\n`);
};

const dispatch = (entries: string[]): void => {
  const q = queueFromInput(entries.join('\n'));
  if (q === '') throw new Error('land-actions: dispatch needs queue entries <branch>:<pr>:<clean-head>');
  const id = dispatchLand(q.trimEnd(), deps(repoOf(), 'master', null));
  console.log(`dispatched land.yml run ${id} on master with:\n${q.trimEnd()}`);
};

const clear = (pr: string): void => {
  const r = clearOutage(gh, repoOf(), pr);
  console.log(`cleared the ${r.context} streak of #${pr} at ${r.head} as ${r.login} (user ${r.id}). The driver counts it only if user ${r.id} is its token's identity or on LAND_PROOF_WRITERS.`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'queue' && rest.length === 1) queue(rest[0]!);
    else if (command === 'redispatch' && rest.length === 1) redispatch(rest[0]!);
    else if (command === 'dispatch' && rest.length > 0) dispatch(rest);
    else if (command === 'clear-outage' && rest.length === 1) clear(rest[0]!);
    else throw new Error('usage: node scripts/land-actions.ts queue <out-file> | redispatch <handoff-file> | dispatch <entry>... | clear-outage <pr>');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
