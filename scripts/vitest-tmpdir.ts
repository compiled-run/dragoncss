// Vitest global setup: every test run gets its own TMPDIR, and the run fails if a test leaves anything in it (TMP-LEAK).
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Node's own module compile cache, which Node writes under TMPDIR by itself. */
export const OWNED_BY_NODE: ReadonlySet<string> = new Set(['node-compile-cache']);

/** The entries a run left in its TMPDIR, apart from Node's own cache. */
export function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((e) => !OWNED_BY_NODE.has(e)).sort();
}

/** Points TMPDIR at a fresh folder for the run and returns the teardown that judges and removes it. */
export function isolateTmpdir(env: NodeJS.ProcessEnv = process.env): () => void {
  const previous = env['TMPDIR'];
  const dir = mkdtempSync(join(env['TMPDIR'] ?? tmpdir(), 'dragon-test-run-'));
  env['TMPDIR'] = dir;
  return () => {
    if (previous === undefined) delete env['TMPDIR'];
    else env['TMPDIR'] = previous;
    let left: string[];
    try {
      left = leftovers(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (left.length > 0) throw new Error(`tests left ${left.length} entr${left.length === 1 ? 'y' : 'ies'} in TMPDIR; remove each in afterEach, afterAll, onTestFinished or finally: ${left.join(', ')}`);
  };
}

export default function setup(): () => void {
  const teardown = isolateTmpdir();
  return () => {
    try {
      teardown();
    } catch (e) {
      // Vitest only logs a teardown error, so the exit code is set here.
      process.exitCode = 1;
      throw e;
    }
  };
}
