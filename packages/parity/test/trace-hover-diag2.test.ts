// DIAGNOSTIC (temporary, never merged): runs the regen steps that run beside trace-capture in a CI regen (hit-capture, then
// dpr-capture, trace-capture and vectors with 2 jobs), under regen itself, repeatedly, and prints trace-capture's whole log.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';

const RUNS = Number(process.env.DIAG_RUNS ?? 5);

function run(argv: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(argv[0] as string, argv.slice(1), { cwd: repoPath('.'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('close', (code) => resolve({ code, out }));
  });
}

describe('trace capture hover media under regen (diagnostic)', () => {
  it('runs the regen steps around trace-capture without a hover media disagreement', async () => {
    const errors: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = Date.now();
      const r = await run(['node', 'scripts/regen.ts', '--force', '--jobs', '2', '--only', 'hit-capture', '--only', 'dpr-capture', '--only', 'trace-capture', '--only', 'vectors']);
      const log = repoPath('node_modules/.cache/dragon-regen/trace-capture.log');
      const tlog = existsSync(log) ? readFileSync(log, 'utf8') : '(no trace-capture.log)';
      console.log(`regen run ${i}: exit ${r.code} in ${Date.now() - t} ms\n${r.out.split('\n').filter((l) => /trace-capture|FAILED|ran in/.test(l)).join('\n')}\nTRACE LOG TAIL:\n${tlog.slice(-1500)}`);
      if (/hover: hover/.test(tlog) && /DIAG/.test(tlog)) errors.push(`run ${i}:\n${tlog}`);
    }
    for (const e of errors) console.log(e);
    expect(errors).toEqual([]);
  }, 7_000_000);
});
