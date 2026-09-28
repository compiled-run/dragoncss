// Where the package, the repo and the pinned WPT copy live. DRAGON_WPT_DIR overrides vendor/wpt (for example a shared copy).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(PACKAGE_DIR, '..', '..');

export const packagePath = (relative: string): string => join(PACKAGE_DIR, relative);

/** packages/wpt/wpt.lock: "<name> <40-hex commit>" lines for wpt and wpt-metadata. */
function lockEntry(name: 'wpt' | 'wpt-metadata'): string {
  const text = readFileSync(packagePath('wpt.lock'), 'utf8');
  const m = new RegExp(`^${name} ([0-9a-f]{40})$`, 'm').exec(text);
  if (m === null) throw new Error(`packages/wpt/wpt.lock has no "${name} <40-hex commit>" line`);
  return m[1] as string;
}

/** The WPT commit every expectations file is pinned to. */
export const lockedCommit = (): string => lockEntry('wpt');

/** The web-platform-tests/wpt-metadata commit the Interop label map (interop-labels.json) comes from. */
export const lockedMetadataCommit = (): string => lockEntry('wpt-metadata');

export function wptDir(): string {
  const env = process.env.DRAGON_WPT_DIR;
  return env !== undefined && env !== '' ? resolve(env) : join(REPO_ROOT, 'vendor', 'wpt');
}

/** The commit the WPT copy records in its README.md ("- Commit: `<sha>`"); fails when the copy is missing. */
export function vendoredCommit(dir: string = wptDir()): string {
  const readme = join(dir, 'README.md');
  if (!existsSync(join(dir, 'css')) || !existsSync(readme)) {
    throw new Error(`no WPT copy at ${dir}: run scripts/fetch-wpt.sh, or set DRAGON_WPT_DIR to a copy at the commit in packages/wpt/wpt.lock`);
  }
  const m = /^- Commit: `([0-9a-f]{40})`/m.exec(readFileSync(readme, 'utf8'));
  if (m === null) throw new Error(`${readme} records no "- Commit: \`<sha>\`" line`);
  return m[1] as string;
}

/** The WPT directory, after checking it is at the locked commit. */
export function pinnedWptDir(): string {
  const dir = wptDir();
  const vendored = vendoredCommit(dir);
  const locked = lockedCommit();
  if (vendored !== locked) throw new Error(`WPT copy at ${dir} is ${vendored}, but packages/wpt/wpt.lock pins ${locked}`);
  return dir;
}
