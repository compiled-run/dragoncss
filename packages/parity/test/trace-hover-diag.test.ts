// DIAGNOSTIC (temporary, reverted before the PR): runs the real trace-capture CLI repeatedly while the other Chrome captures that
// regen runs beside it (dpr-capture, capture) load the machine, and prints every hover-media disagreement with its timeline.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';

const RUNS = Number(process.env.DIAG_RUNS ?? 6);

function run(script: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn('pnpm', ['-s', 'run', script], { cwd: repoPath('.'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('close', (code) => resolve({ code, out }));
  });
}

describe('trace capture hover media (diagnostic)', () => {
  it('runs the trace-capture CLI under regen-like load without a hover media disagreement', async () => {
    let stop = false;
    const load = async (script: string): Promise<void> => {
      while (!stop) {
        const r = await run(script);
        console.log(`load ${script}: exit ${r.code} ${r.out.slice(-200)}`);
      }
    };
    const loads = [load('parity:dpr-capture'), load('parity:capture')];
    const errors: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = Date.now();
      const r = await run('parity:trace-capture');
      console.log(`trace-capture run ${i}: exit ${r.code} in ${Date.now() - t} ms`);
      if (r.code !== 0) errors.push(`run ${i}: ${r.out.slice(-6000)}`);
    }
    stop = true;
    await Promise.all(loads);
    for (const e of errors) console.log(e);
    expect(errors).toEqual([]);
  }, 5_400_000);
});
