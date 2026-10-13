// DIAGNOSTIC (temporary, removed before the PR is final): runs the real parity:anim-capture several times and checks after each
// run that packages/parity/expected-frames is byte-identical to the committed files.
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';

const RUNS = Number(process.env.DIAG_RUNS ?? 3);

describe('anim recapture determinism (diagnostic)', () => {
  it('recaptures every frame case to the committed bytes, every time', () => {
    const changed: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = Date.now();
      const r = spawnSync('pnpm', ['-s', 'run', 'parity:anim-capture'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 1 << 26 });
      if (r.status !== 0) throw new Error(`anim-capture run ${i} exited ${String(r.status)}: ${(r.stderr ?? '').slice(-4000)}`);
      const status = execFileSync('git', ['status', '--porcelain', '--', 'packages/parity/expected-frames'], { cwd: repoPath('.'), encoding: 'utf8' }).trim();
      console.log(`anim-capture run ${i}: ${Math.round((Date.now() - t) / 1000)} s, ${status === '' ? 'expected-frames identical to the commit' : `changed:\n${status}`}`);
      if (status !== '') changed.push(`run ${i}: ${status}`);
      execFileSync('git', ['checkout', '--', 'packages/parity/expected-frames'], { cwd: repoPath('.') });
    }
    expect(changed).toEqual([]);
  }, 3_400_000);
});
