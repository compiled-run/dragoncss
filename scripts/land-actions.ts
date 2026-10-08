// land.yml's steps around the driver (land-state.ts has the decisions):
//   queue <out-file>: the workflow_dispatch `queue` input (LAND_QUEUE_INPUT) as a queue file; prints the count to $GITHUB_OUTPUT
//     (count=<n>) and the queue to the job summary. A malformed entry fails the step.
//   redispatch <handoff-file>: dispatches land.yml again on GITHUB_REF_NAME with the rest of the queue, when the driver's batch
//     ended normally, no stop was asked for and the land-stop label (LAND_STOP_ISSUE) is not set now.
// Run with: node scripts/land-actions.ts <command> <file>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseHandoff, parseStopIssue, queueFromInput, redispatchDecision, stopLabelSet } from './land-state.ts';

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

const queue = (out: string): void => {
  const text = queueFromInput(env['LAND_QUEUE_INPUT'] ?? '');
  writeFileSync(out, text);
  const lines = text.split('\n').filter((l) => l !== '');
  console.log(lines.length === 0 ? 'the queue is empty' : `queue (${lines.length}):\n${text.trimEnd()}`);
  if (env['GITHUB_OUTPUT']) appendFileSync(env['GITHUB_OUTPUT'], `count=${lines.length}\n`);
  if (env['GITHUB_STEP_SUMMARY']) appendFileSync(env['GITHUB_STEP_SUMMARY'], `## Queue\n\n\`\`\`\n${text || '(empty)\n'}\`\`\`\n`);
};

const redispatch = (handoffPath: string): void => {
  const repo = env['GITHUB_REPOSITORY'] ?? '';
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
    if (env['GITHUB_STEP_SUMMARY']) appendFileSync(env['GITHUB_STEP_SUMMARY'], `\nNot re-dispatched: ${d.why}\n`);
    return;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || ref === '') throw new Error(`land-actions: GITHUB_REPOSITORY (${JSON.stringify(repo)}) or GITHUB_REF_NAME (${JSON.stringify(ref)}) is not set`);
  gh(['workflow', 'run', 'land.yml', '--repo', repo, '--ref', ref, '-f', `queue=${d.queue}`]);
  console.log(`re-dispatched land.yml on ${ref} with the rest of the queue:\n${d.queue}`);
  if (env['GITHUB_STEP_SUMMARY']) appendFileSync(env['GITHUB_STEP_SUMMARY'], `\nRe-dispatched land.yml with the rest of the queue:\n\n\`\`\`\n${d.queue}\n\`\`\`\n`);
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const [command, file, ...rest] = process.argv.slice(2);
  try {
    if (file === undefined || rest.length > 0) throw new Error('usage: node scripts/land-actions.ts queue <out-file> | redispatch <handoff-file>');
    if (command === 'queue') queue(file);
    else if (command === 'redispatch') redispatch(file);
    else throw new Error(`land-actions: unknown command ${JSON.stringify(command)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
