// The landing driver's default reviewer (LAND_REVIEW_CMD): prints the Claude review a review agent precomputed for the PR's clean
// head, shaped { "pr": n, "head": "<sha>", "findings": [...] }, from one of two sources (LAND_REVIEW_SOURCE):
// - file (the default): <LAND_REVIEW_PRECOMPUTED_DIR or /tmp/land-reviews/precomputed>/<pr>.json;
// - comment (land.yml): a comment on the PR with the marker line and one fenced JSON block (pnpm land:post-review writes it), by
//   an author on LAND_REVIEWERS (comma or space separated logins; default the repo owner's login), read over REST. The newest
//   such comment for the clean head wins; a malformed or other-PR comment newer than it fails.
// It prints {"findings":[...]} and exits 0 only for a well-formed review of LAND_REVIEW_PR at LAND_REVIEW_HEAD; a missing, malformed,
// other-PR or stale review exits 1, so the driver fails the PR closed.
// Run with: pnpm land:review-lookup (the driver sets LAND_REVIEW_PR, LAND_REVIEW_HEAD and LAND_REVIEW_REPO and writes the prompt on stdin)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseReview } from './land-lib.ts';

export const PRECOMPUTED_DIR = '/tmp/land-reviews/precomputed';
export const REVIEW_MARKER = '<!-- dragon-land-review v1 -->';
const SHA = /^[0-9a-f]{40}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
type Lookup = { ok: true; output: string } | { ok: false; error: string };
const bad = (error: string) => ({ ok: false as const, error: `land-review-lookup: ${error}` });

const checkInputs = (pr: string | undefined, head: string | undefined): Lookup | null => {
  if (pr === undefined || !/^[1-9]\d{0,8}$/.test(pr)) return bad(`LAND_REVIEW_PR is ${JSON.stringify(pr)}, not a PR number`);
  if (head === undefined || !SHA.test(head)) return bad(`LAND_REVIEW_HEAD is ${JSON.stringify(head)}, not a full sha`);
  return null;
};
// One review's text checked against the PR and its clean head; `stale` names the head of a well-formed review of another head.
const checkReview = (text: string, where: string, pr: string, head: string): Lookup | { ok: false; error: string; stale: string } => {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (error) {
    return bad(`${where} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(v) || Object.keys(v).sort().join(',') !== 'findings,head,pr') return bad(`${where} is not exactly { pr, head, findings }`);
  if (v.pr !== Number(pr)) return bad(`${where} reviews PR ${JSON.stringify(v.pr)}, not #${pr}`);
  if (typeof v.head !== 'string' || !SHA.test(v.head)) return bad(`${where} head ${JSON.stringify(v.head)} is not a full sha`);
  const output = JSON.stringify({ findings: v.findings });
  const parsed = parseReview(output);
  if (!parsed.ok) return bad(`${where}: ${parsed.error}`);
  if (v.head !== head) return { ...bad(`${where} reviews ${v.head}, not the clean head ${head}: the review is stale`), stale: v.head };
  return { ok: true, output };
};

/** The review to print for `pr` at `head`, from the precomputed file's text (null when the file is missing). */
export const lookupReview = (fileText: string | null, path: string, pr: string | undefined, head: string | undefined): Lookup => {
  const inputs = checkInputs(pr, head);
  if (inputs !== null) return inputs;
  if (fileText === null) return bad(`no precomputed review at ${path}; a review agent must write one for #${pr} at ${head}`);
  const r = checkReview(fileText, path, pr!, head!);
  return r.ok ? r : { ok: false, error: r.error };
};

// ---- the review comment ---------------------------------------------------------------------------------------------------
export type IssueComment = { id: number; author: string; body: string; createdAt: string };
/** The PR's comments (GET issues/<n>/comments, pages slurped), each checked. */
export const parseCommentPages = (pages: unknown): IssueComment[] => {
  if (!Array.isArray(pages)) throw new Error('land-review-lookup: the PR comments are not a list of pages');
  return pages.flatMap((page) => {
    if (!Array.isArray(page)) throw new Error('land-review-lookup: a PR comments page is not a list');
    return page.map((c): IssueComment => {
      if (!isObject(c) || typeof c.id !== 'number' || !isObject(c.user) || typeof c.user.login !== 'string' || typeof c.body !== 'string' || typeof c.created_at !== 'string') {
        throw new Error('land-review-lookup: a PR comment is not { id, user.login, body, created_at }');
      }
      return { id: c.id, author: c.user.login, body: c.body, createdAt: c.created_at };
    });
  });
};
/** LAND_REVIEWERS (comma or space separated logins), or the repo owner's login when unset or empty. */
export const reviewers = (v: string | undefined, repo: string): string[] => {
  const list = (v ?? '').split(/[\s,]+/).filter((x) => x !== '');
  const logins = list.length > 0 ? list : [repo.split('/')[0] ?? ''];
  for (const l of logins) if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/.test(l)) throw new Error(`land-review-lookup: ${JSON.stringify(l)} is not a GitHub login`);
  return logins;
};
const hasMarker = (body: string): boolean => body.split(/\r?\n/).some((l) => l.trim() === REVIEW_MARKER);
/** The one fenced JSON block of a review comment, or why there is not exactly one. */
export const reviewBlock = (body: string): { json: string } | { error: string } => {
  const blocks = [...body.replace(/\r\n/g, '\n').matchAll(/^```json[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm)];
  if (blocks.length !== 1) return { error: `has ${blocks.length} fenced json blocks, not exactly one` };
  return { json: blocks[0]![1]! };
};
/** The comment a review agent posts (pnpm land:post-review): the marker, a line for people, and the review as one JSON block. */
export const reviewComment = (review: { pr: number; head: string; findings: unknown[] }): string => {
  // A backtick is written as its JSON escape (u+0060), so no review text can close the fence early.
  const json = JSON.stringify({ pr: review.pr, head: review.head, findings: review.findings }, null, 2).replaceAll('`', '\\u0060');
  return `${REVIEW_MARKER}\nLanding review of #${review.pr} at clean head \`${review.head}\`: ${review.findings.length} finding(s). The landing driver reads the JSON below.\n\n\`\`\`json\n${json}\n\`\`\`\n`;
};

/** The review to print for `pr` at `head`, from the PR's comments: the newest marked comment by an allowed author for that head. */
export const lookupReviewComment = (comments: readonly IssueComment[], allowed: readonly string[], pr: string | undefined, head: string | undefined): Lookup => {
  const inputs = checkInputs(pr, head);
  if (inputs !== null) return inputs;
  const marked = comments.filter((c) => hasMarker(c.body));
  const allow = new Set(allowed.map((a) => a.toLowerCase()));
  const ours = marked.filter((c) => allow.has(c.author.toLowerCase())).sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1));
  const ignored = marked.length - ours.length;
  const note = ignored > 0 ? ` (${ignored} marked comment(s) by authors not on LAND_REVIEWERS ${allowed.join(',')} ignored)` : '';
  let stale: string | null = null;
  for (const c of ours) {
    const where = `review comment ${c.id} by ${c.author} (${c.createdAt})`;
    const block = reviewBlock(c.body);
    if ('error' in block) return bad(`${where} ${block.error}`);
    const r = checkReview(block.json, where, pr!, head!);
    if (r.ok) return r;
    if (!('stale' in r)) return { ok: false, error: r.error };
    stale ??= r.error;
  }
  if (stale !== null) return { ok: false, error: `${stale}; no review comment is for the clean head${note}` };
  return bad(`no review comment on #${pr} for ${head}; a review agent must post one (pnpm land:post-review)${note}`);
};

/** owner/name: LAND_REVIEW_REPO, GH_REPO or GITHUB_REPOSITORY, else the origin remote's GitHub URL. */
export const repoOf = (env: Readonly<Record<string, string | undefined>>, originUrl: () => string): string => {
  const set = [env['LAND_REVIEW_REPO'], env['GH_REPO'], env['GITHUB_REPOSITORY']].find((v) => v !== undefined && v !== '');
  const repo = set ?? /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(originUrl().trim())?.[1];
  if (repo === undefined || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`land-review-lookup: cannot tell the repository (${JSON.stringify(repo ?? null)}); set GH_REPO`);
  return repo;
};
export const originUrl = (): string => execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
export const fetchComments = (repo: string, pr: string): IssueComment[] =>
  parseCommentPages(JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments?per_page=100`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })));

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  // Drain the prompt the driver writes on stdin, so its write never fails on a closed pipe.
  try {
    readFileSync(0);
  } catch {}
  const fail: (error: string) => never = (error) => {
    console.error(error);
    process.exit(1);
  };
  const pr = process.env['LAND_REVIEW_PR'];
  const head = process.env['LAND_REVIEW_HEAD'];
  const source = process.env['LAND_REVIEW_SOURCE'] || 'file';
  let r: Lookup;
  if (source === 'comment') {
    const inputs = checkInputs(pr, head);
    if (inputs !== null && !inputs.ok) fail(inputs.error);
    try {
      const repo = repoOf(process.env, originUrl);
      r = lookupReviewComment(fetchComments(repo, pr!), reviewers(process.env['LAND_REVIEWERS'], repo), pr, head);
    } catch (error) {
      r = fail(`land-review-lookup: cannot read the review comments of #${pr}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (source === 'file') {
    const path = join(process.env['LAND_REVIEW_PRECOMPUTED_DIR'] ?? PRECOMPUTED_DIR, `${pr}.json`);
    let text: string | null = null;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT') fail(`land-review-lookup: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    r = lookupReview(text, path, pr, head);
  } else {
    r = fail(`land-review-lookup: LAND_REVIEW_SOURCE is ${JSON.stringify(source)}, not file or comment`);
  }
  if (!r.ok) fail(r.error);
  console.log(r.output);
}
