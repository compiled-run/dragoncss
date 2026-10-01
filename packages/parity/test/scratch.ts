// Test scratch space with guaranteed cleanup (PR #48 rounds 2-3): every temp folder and spawned child a test makes is tracked, and
// after each test, pass or fail, every child still running is stopped (SIGTERM, then a bounded wait) and every folder removed.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

export type Child = { readonly alive: () => boolean; readonly kill: () => void };

/** A bounded wait for a condition, polled every 20 ms; it throws naming what it waited for. */
export async function until(what: string, done: () => boolean, timeoutMs = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Registers the cleanup in the calling test file; call it once at module level. */
export function scratch(): { readonly dir: () => string; readonly remove: (path: string) => string; readonly track: <T extends Child>(c: T) => T } {
  let dirs: string[] = [];
  let children: Child[] = [];
  afterEach(async () => {
    const live = children;
    const remove = dirs;
    children = [];
    dirs = [];
    try {
      for (const c of live) if (c.alive()) c.kill();
      await until('every spawned child to stop', () => live.every((c) => !c.alive()), 10_000);
    } finally {
      for (const d of remove) rmSync(d, { recursive: true, force: true });
    }
  });
  return {
    dir: () => {
      const d = mkdtempSync(join(tmpdir(), 'dragon-t132-'));
      dirs.push(d);
      return d;
    },
    /** A path a test writes outside its temp folders (a tool's own output folder), removed after the test. */
    remove: (path) => {
      dirs.push(path);
      return path;
    },
    track: (c) => {
      children.push(c);
      return c;
    },
  };
}
