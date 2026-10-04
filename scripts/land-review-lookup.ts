// The landing driver's default reviewer (LAND_REVIEW_CMD): prints the Claude review a review agent precomputed for the PR's clean
// head, from <LAND_REVIEW_PRECOMPUTED_DIR or /tmp/land-reviews/precomputed>/<pr>.json, shaped { "pr": n, "head": "<sha>", "findings": [...] }.
// It prints {"findings":[...]} and exits 0 only for a well-formed review of LAND_REVIEW_PR at LAND_REVIEW_HEAD; a missing, malformed,
// other-PR or stale review exits 1, so the driver fails the PR closed.
// Run with: pnpm land:review-lookup (the driver sets LAND_REVIEW_PR and LAND_REVIEW_HEAD and writes the prompt on stdin)
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseReview } from './land-lib.ts';

export const PRECOMPUTED_DIR = '/tmp/land-reviews/precomputed';
const SHA = /^[0-9a-f]{40}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The review to print for `pr` at `head`, from the precomputed file's text (null when the file is missing). */
export const lookupReview = (fileText: string | null, path: string, pr: string | undefined, head: string | undefined): { ok: true; output: string } | { ok: false; error: string } => {
  const bad = (error: string) => ({ ok: false as const, error: `land-review-lookup: ${error}` });
  if (pr === undefined || !/^[1-9]\d{0,8}$/.test(pr)) return bad(`LAND_REVIEW_PR is ${JSON.stringify(pr)}, not a PR number`);
  if (head === undefined || !SHA.test(head)) return bad(`LAND_REVIEW_HEAD is ${JSON.stringify(head)}, not a full sha`);
  if (fileText === null) return bad(`no precomputed review at ${path}; a review agent must write one for #${pr} at ${head}`);
  let v: unknown;
  try {
    v = JSON.parse(fileText);
  } catch (error) {
    return bad(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(v) || Object.keys(v).sort().join(',') !== 'findings,head,pr') return bad(`${path} is not exactly { pr, head, findings }`);
  if (v.pr !== Number(pr)) return bad(`${path} reviews PR ${JSON.stringify(v.pr)}, not #${pr}`);
  if (typeof v.head !== 'string' || !SHA.test(v.head)) return bad(`${path} head ${JSON.stringify(v.head)} is not a full sha`);
  if (v.head !== head) return bad(`${path} reviews ${v.head}, not the clean head ${head}: the review is stale`);
  const output = JSON.stringify({ findings: v.findings });
  const parsed = parseReview(output);
  if (!parsed.ok) return bad(`${path}: ${parsed.error}`);
  return { ok: true, output };
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  // Drain the prompt the driver writes on stdin, so its write never fails on a closed pipe.
  try {
    readFileSync(0);
  } catch {}
  const pr = process.env['LAND_REVIEW_PR'];
  const path = join(process.env['LAND_REVIEW_PRECOMPUTED_DIR'] ?? PRECOMPUTED_DIR, `${pr}.json`);
  let text: string | null = null;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ENOENT') {
      console.error(`land-review-lookup: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  const r = lookupReview(text, path, pr, process.env['LAND_REVIEW_HEAD']);
  if (!r.ok) {
    console.error(r.error);
    process.exit(1);
  }
  console.log(r.output);
}
