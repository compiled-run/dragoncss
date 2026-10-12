// Posts a precomputed landing review as a PR comment, for the landing driver's comment source (LAND_REVIEW_SOURCE=comment in
// land.yml; land-review-lookup.ts reads it). The file must be exactly { "pr": <pr>, "head": "<clean-head sha>", "findings": [...] }
// for the PR named, with well-formed findings, or nothing is posted.
// Run with: pnpm land:post-review <pr> <file.json>   (repository: GH_REPO, GITHUB_REPOSITORY or the origin remote)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookupReview, originUrl, repoOf, reviewComment } from './land-review-lookup.ts';

/** The comment body for the review file's text, checked as strictly as the driver will read it; or why it cannot be posted. */
export const postableReview = (pr: string, fileText: string, path: string): { ok: true; body: string } | { ok: false; error: string } => {
  let head: unknown;
  try {
    head = (JSON.parse(fileText) as { head?: unknown } | null)?.head;
  } catch {}
  const r = lookupReview(fileText, path, pr, typeof head === 'string' ? head : undefined);
  if (!r.ok) return { ok: false, error: r.error.replace(/^land-review-lookup: LAND_REVIEW_HEAD is/, `land-post-review: ${path} head is`).replace(/^land-review-lookup: LAND_REVIEW_PR is/, 'land-post-review: the PR argument is') };
  const findings = (JSON.parse(r.output) as { findings: unknown[] }).findings;
  return { ok: true, body: reviewComment({ pr: Number(pr), head: head as string, findings }) };
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const [pr, file, ...rest] = process.argv.slice(2);
  if (pr === undefined || file === undefined || rest.length > 0) {
    console.error('usage: pnpm land:post-review <pr> <file.json>');
    process.exit(2);
  }
  try {
    const r = postableReview(pr, readFileSync(file, 'utf8'), file);
    if (!r.ok) throw new Error(r.error);
    const repo = repoOf(process.env, originUrl);
    const out = execFileSync('gh', ['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-', '--jq', '.html_url'], { input: JSON.stringify({ body: r.body }), encoding: 'utf8' });
    console.log(`posted the landing review of #${pr}: ${out.trim()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
