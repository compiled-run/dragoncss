// GitHub App installation tokens for the landing driver (land.yml), so the cloud driver merges as its own App identity, separate
// from the reviewer identity whose comments it trusts. An installation token lives one hour and a batch can run for hours, so the
// driver mints a fresh one whenever the one it holds is near expiry (land.ts landToken), each time by running this file's mint
// command: a fetch cannot run synchronously, and the driver's gh and git calls are synchronous.
// The App's id and private key come from the land environment (vars.LAND_APP_ID, secrets.LAND_APP_PRIVATE_KEY) on stdin, never
// from argv or the environment. node: built-ins only: the token job installs nothing.
// Run with: node scripts/land-app-token.ts mint <owner/repo>   (stdin: {"appId": "...", "privateKey": "-----BEGIN ..."})
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = 'https://api.github.com';
const REPO = /^[\w.-]+\/[\w.-]+$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

export type AppCredentials = { appId: string; privateKey: string };
export type Minted = { token: string; expiresAt: number; botId: number; botLogin: string };

/** The App's credentials, checked: a numeric App id or a client id, and a PEM private key. */
export const checkCredentials = (v: unknown): AppCredentials => {
  if (!isObject(v)) throw new Error('land-app-token: the credentials are not an object');
  const { appId, privateKey } = v;
  if (typeof appId !== 'string' || !/^(?:[1-9]\d{0,11}|Iv[\w.]{4,40})$/.test(appId.trim())) throw new Error('land-app-token: LAND_APP_ID is not an App id or client id');
  if (typeof privateKey !== 'string' || !/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----/.test(privateKey)) throw new Error('land-app-token: LAND_APP_PRIVATE_KEY is not a PEM private key');
  return { appId: appId.trim(), privateKey: privateKey.replace(/\\n/g, '\n') };
};

/** The App's JWT (RS256): issued a minute in the past for clock drift, valid nine minutes (GitHub allows at most ten). */
export const appJwt = (c: AppCredentials, nowS: number): string => {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: nowS - 60, exp: nowS + 540, iss: c.appId }));
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(c.privateKey);
  return `${head}.${body}.${b64url(signature)}`;
};

/** The token the driver holds now, or null when it must mint one: none yet, or fewer than `marginMs` left before it expires. */
export const reusable = (held: Minted | null, nowMs: number, marginMs = 15 * 60_000): Minted | null => (held !== null && held.expiresAt - nowMs > marginMs ? held : null);

/** The mint command's output, checked as strictly as the driver reads it. */
export const parseMinted = (text: string): Minted => {
  const v: unknown = JSON.parse(text);
  if (!isObject(v)) throw new Error('land-app-token: the mint output is not an object');
  const { token, expiresAt, botId, botLogin } = v;
  if (typeof token !== 'string' || !/^[\w-]{20,}$/.test(token)) throw new Error('land-app-token: the mint output has no token');
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) throw new Error('land-app-token: the mint output has no expiry');
  if (typeof botId !== 'number' || !Number.isSafeInteger(botId) || botId <= 0) throw new Error('land-app-token: the mint output has no bot user id');
  if (typeof botLogin !== 'string' || !botLogin.endsWith('[bot]')) throw new Error('land-app-token: the mint output has no bot login');
  return { token, expiresAt, botId, botLogin };
};

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const call = async (fetchFn: Fetch, method: string, path: string, auth: string, body?: unknown): Promise<Record<string, unknown>> => {
  const r = await fetchFn(`${API}${path}`, {
    method,
    headers: { accept: 'application/vnd.github+json', authorization: auth, 'x-github-api-version': '2022-11-28', 'user-agent': 'dragon-land' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`land-app-token: ${method} ${path} returned HTTP ${r.status}: ${text.slice(0, 300)}`);
  const v: unknown = JSON.parse(text);
  if (!isObject(v)) throw new Error(`land-app-token: ${method} ${path} returned no object`);
  return v;
};

/**
 * Mints an installation token for one repository, scoped to that repository only, and names the App's bot user: GitHub's GET user
 * refuses an installation token, so the driver takes its own identity (the only trusted land/proof writer, never a reviewer) from here.
 */
export const mint = async (c: AppCredentials, repo: string, fetchFn: Fetch, nowMs: number): Promise<Minted> => {
  if (!REPO.test(repo)) throw new Error(`land-app-token: ${JSON.stringify(repo)} is not owner/repo`);
  const jwt = `Bearer ${appJwt(c, Math.floor(nowMs / 1000))}`;
  const app = await call(fetchFn, 'GET', '/app', jwt);
  if (typeof app.slug !== 'string' || !/^[\w-]+$/.test(app.slug)) throw new Error('land-app-token: GET /app returned no slug');
  const inst = await call(fetchFn, 'GET', `/repos/${repo}/installation`, jwt);
  if (typeof inst.id !== 'number' || !Number.isSafeInteger(inst.id)) throw new Error(`land-app-token: the App is not installed on ${repo}`);
  const tok = await call(fetchFn, 'POST', `/app/installations/${inst.id}/access_tokens`, jwt, { repositories: [repo.split('/')[1]] });
  if (typeof tok.token !== 'string' || typeof tok.expires_at !== 'string') throw new Error('land-app-token: the access token response has no token');
  const expiresAt = Date.parse(tok.expires_at);
  if (!Number.isFinite(expiresAt)) throw new Error(`land-app-token: expires_at ${JSON.stringify(tok.expires_at)} is not a date`);
  const botLogin = `${app.slug}[bot]`;
  const bot = await call(fetchFn, 'GET', `/users/${encodeURIComponent(botLogin)}`, `token ${tok.token}`);
  if (typeof bot.id !== 'number' || !Number.isSafeInteger(bot.id)) throw new Error(`land-app-token: GET /users/${botLogin} returned no id`);
  return parseMinted(JSON.stringify({ token: tok.token, expiresAt, botId: bot.id, botLogin }));
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const [cmd, repo, ...rest] = process.argv.slice(2);
  if (cmd !== 'mint' || repo === undefined || rest.length > 0) {
    console.error('usage: node scripts/land-app-token.ts mint <owner/repo>   (credentials as JSON on stdin)');
    process.exit(2);
  }
  try {
    const c = checkCredentials(JSON.parse(readFileSync(0, 'utf8')));
    process.stdout.write(JSON.stringify(await mint(c, repo, fetch, Date.now())));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
