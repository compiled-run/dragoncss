// The landing supervisor (supervise in scripts/land-lib.ts) with real processes: signals, process groups, deferral and orphans.
// Apart from land.test.ts so a failure under load costs only this file's solo rerun. Waits are bounded only loosely:
// every window is seconds wide, every wait is generous; the one upper bound (30 s against a 600 s step) is far above any load.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';

// A process (group) with any live, non-zombie member.
const groupAlive = (pgid: number): boolean =>
  execFileSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .some((l) => {
      const [g, stat] = l.trim().split(/\s+/);
      return Number(g) === pgid && !/^Z/.test(stat ?? '');
    });
const temps: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'land-sup-'));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe('the supervisor with real processes', () => {
  const lib = repoPath('scripts/land-lib.ts');
  // A fake driver: records its pid and its step's pid, runs a long step (spawnSync, as the driver does), and records "resumed"
  // if it ever gets past the step, which is where the old driver went on to fail PRs after a SIGTERM.
  const setup = (driverBody: (dir: string) => string, o: { graceMs?: number; deferCapMs?: number; slowSpawnMs?: number } = {}): { dir: string; run: () => { done: Promise<{ code: number | null; out: string }>; pid: number } } => {
    const dir = tempDir();
    // Every file the fakes write is written whole (temp file, then rename), so a reader never sees it half-written.
    const atomic = (src: string): string =>
      `import { renameSync as __rename, writeFileSync as __write } from 'node:fs';\nconst put = (p, b) => { __write(p + '.tmp', b); __rename(p + '.tmp', p); };\n${src.replaceAll('writeFileSync(', 'put(')}`;
    writeFileSync(join(dir, 'driver.mjs'), atomic(driverBody(dir)));
    writeFileSync(
      join(dir, 'supervisor.mjs'),
      atomic(`import { existsSync, writeFileSync } from 'node:fs';\nimport { supervise } from ${JSON.stringify(lib)};\n` +
        `const r = await supervise({ command: process.execPath, args: [${JSON.stringify(join(dir, 'driver.mjs'))}], env: process.env, graceMs: ${o.graceMs ?? 5000}, deferCapMs: ${o.deferCapMs ?? 60_000}, pollMs: 50, ` +
        `publishing: () => existsSync(${JSON.stringify(join(dir, 'publishing'))}), ` +
        `onSpawn: (pid) => { writeFileSync(${JSON.stringify(join(dir, 'spawned'))}, String(pid)); const t = Date.now(); while (Date.now() - t < ${o.slowSpawnMs ?? 0}); }, ` +
        `onReady: () => writeFileSync(${JSON.stringify(join(dir, 'ready'))}, 'x'), ` +
        `onStop: () => writeFileSync(${JSON.stringify(join(dir, 'stop'))}, 'x'), log: (l) => console.log(l) });\n` +
        `console.log(JSON.stringify(r)); process.exitCode = r.code;\n`),
    );
    return {
      dir,
      run: () => {
        const p = spawn(process.execPath, [join(dir, 'supervisor.mjs')], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        p.stdout.on('data', (d: Buffer) => (out += d.toString()));
        return { pid: p.pid!, done: new Promise((resolve) => p.on('exit', (code) => resolve({ code, out }))) };
      },
    };
  };
  const waitFor = async (path: string): Promise<string> => {
    for (let i = 0; i < 1200; i++) {
      if (existsSync(path)) return readFileSync(path, 'utf8');
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${path} never appeared`);
  };
  // Waits until the file holds `n` positive pids, retrying on content that is missing or not (yet) that.
  const waitForPids = async (path: string, n = 1): Promise<number[]> => {
    for (let i = 0; i < 1200; i++) {
      const pids = existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\s+/).map(Number) : [];
      if (pids.length === n && pids.every((p) => Number.isInteger(p) && p > 1)) return pids;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${path} never held ${n} pid(s)`);
  };
  const dead = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  };

  it('SIGTERM kills the driver and its running step at once, and the driver never goes on to fail a PR', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawn, spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n` +
        `if (process.env.LAND_SUPERVISED !== '1') process.exit(9);\n` +
        `const probe = spawn('sleep', ['600'], { stdio: 'ignore' });\n` + // the step's own child, in the same group
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, process.pid + ' ' + probe.pid);\n` +
        `spawnSync('sleep', ['600']);\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'resumed'))}, 'the step "failed" and the driver went on');\n`,
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    const [driver, step] = (await waitForPids(join(dir, 'pids'), 2)) as [number, number];
    const t0 = Date.now();
    process.kill(s.pid, 'SIGTERM');
    const { code, out } = await s.done;
    // "At once" against a 600 s step: a bound of 30 s is far above any load, and far below the step it cuts short.
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(code).toBe(130);
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toMatchObject({ code: 130, interrupted: 'SIGTERM', pid: driver });
    expect(dead(driver) && dead(step)).toBe(true);
    expect(existsSync(join(dir, 'resumed'))).toBe(false);
  }, 90_000);

  it('waits for a publish in progress before interrupting, and kills at once on a second signal', async () => {
    // The driver "publishes" for 5 s (the marker exists), then runs a long step; the signals land well inside that window.
    const body = (dir: string) =>
      `import { spawnSync } from 'node:child_process';\nimport { rmSync, writeFileSync } from 'node:fs';\n` +
      `writeFileSync(${JSON.stringify(join(dir, 'publishing'))}, 'x');\nwriteFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
      `spawnSync('sleep', ['5']);\nwriteFileSync(${JSON.stringify(join(dir, 'published'))}, 'x');\nrmSync(${JSON.stringify(join(dir, 'publishing'))});\n` +
      `spawnSync('sleep', ['60']);\nwriteFileSync(${JSON.stringify(join(dir, 'resumed'))}, 'x');\n`;
    const a = setup(body);
    const s = a.run();
    await waitFor(join(a.dir, 'ready'));
    await waitForPids(join(a.dir, 'pids'));
    process.kill(s.pid, 'SIGTERM');
    const r = await s.done;
    expect(r.code).toBe(130);
    expect(r.out).toContain('the driver is merging a PR; interrupting once that merge and its checks end');
    expect(existsSync(join(a.dir, 'published'))).toBe(true); // the publish finished
    expect(existsSync(join(a.dir, 'resumed'))).toBe(false); // and nothing after it ran
    const b = setup(body);
    const s2 = b.run();
    await waitFor(join(b.dir, 'ready'));
    await waitForPids(join(b.dir, 'pids'));
    process.kill(s2.pid, 'SIGTERM');
    await new Promise((res) => setTimeout(res, 300));
    process.kill(s2.pid, 'SIGTERM');
    const r2 = await s2.done;
    expect(r2.out).toContain('SIGTERM again: killing the driver group now');
    expect(existsSync(join(b.dir, 'published'))).toBe(false);
  }, 90_000);

  it('SIGKILLs a step that ignores SIGTERM once the grace period is over', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
        `spawnSync('/bin/sh', ['-c', 'trap "" TERM; echo $$ > ${join(dir, 'step')}.tmp && mv ${join(dir, 'step')}.tmp ${join(dir, 'step')}; while :; do sleep 0.1; done']);\n`,
      { graceMs: 1000 },
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    await waitForPids(join(dir, 'pids'));
    const [step] = (await waitForPids(join(dir, 'step'))) as [number];
    const t0 = Date.now();
    process.kill(s.pid, 'SIGTERM');
    const r = await s.done;
    expect(r.code).toBe(130);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(dead(step)).toBe(true);
  }, 90_000);

  it('reports a driver killed from elsewhere as a death by signal, so the supervisor cleans up after it', async () => {
    const { dir, run } = setup((dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\nspawnSync('sleep', ['60']);\n`);
    const s = run();
    await waitFor(join(dir, 'ready'));
    const [driver] = (await waitForPids(join(dir, 'pids'))) as [number];
    expect(await waitForPids(join(dir, 'spawned'))).toEqual([driver]);
    process.kill(driver, 'SIGKILL');
    const r = await s.done;
    expect(JSON.parse(r.out.trim().split('\n').at(-1)!)).toMatchObject({ interrupted: null, signal: 'SIGKILL', pid: driver });
  }, 90_000);

  it('gives the driver its supervisor\'s pid, so a driver whose supervisor dies stops itself', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
        `for (let i = 0; i < 1200; i++) { if (String(process.ppid) !== process.env.LAND_SUPERVISOR_PID) { writeFileSync(${JSON.stringify(join(dir, 'orphan'))}, 'x'); process.exit(3); } spawnSync('sleep', ['0.1']); }\n`,
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    const [driver] = (await waitForPids(join(dir, 'pids'))) as [number];
    process.kill(s.pid, 'SIGKILL');
    await waitFor(join(dir, 'orphan'));
    for (let i = 0; i < 600 && !dead(driver); i++) await new Promise((res) => setTimeout(res, 50));
    expect(dead(driver)).toBe(true);
  }, 90_000);

  it('acts on a signal that arrives before the driver is recorded, rather than dying of it', async () => {
    // onSpawn takes 6 s (a slow ps), far beyond scheduler jitter under load; the SIGTERM sent once it starts lands inside it.
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\nspawnSync('sleep', ['60']);\nwriteFileSync(${JSON.stringify(join(dir, 'resumed'))}, 'x');\n`,
      { slowSpawnMs: 6000 },
    );
    const s = run();
    const [driver] = (await waitForPids(join(dir, 'spawned'))) as [number];
    process.kill(s.pid, 'SIGTERM');
    const r = await s.done;
    expect(r.code).toBe(130);
    expect(JSON.parse(r.out.trim().split('\n').at(-1)!)).toMatchObject({ interrupted: 'SIGTERM', pid: driver });
    expect(dead(driver)).toBe(true);
    expect(existsSync(join(dir, 'resumed'))).toBe(false);
  }, 90_000);

  it('SIGUSR1 asks for a graceful stop: the driver finishes and exits on its own', async () => {
    const { dir, run } = setup(
      (dir) => `import { spawnSync } from 'node:child_process';\nimport { existsSync, writeFileSync } from 'node:fs';\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'pids'))}, String(process.pid));\n` +
        `for (let i = 0; i < 1200 && !existsSync(${JSON.stringify(join(dir, 'stop'))}); i++) spawnSync('sleep', ['0.1']);\n` +
        `writeFileSync(${JSON.stringify(join(dir, 'finished'))}, 'x');\n`,
    );
    const s = run();
    await waitFor(join(dir, 'ready'));
    await waitForPids(join(dir, 'pids'));
    process.kill(s.pid, 'SIGUSR1');
    const { code, out } = await s.done;
    expect(code).toBe(0);
    expect(out).toContain('SIGUSR1: graceful stop requested');
    expect(JSON.parse(out.trim().split('\n').at(-1)!)).toMatchObject({ code: 0, interrupted: null });
    expect(existsSync(join(dir, 'finished'))).toBe(true);
  }, 90_000);

  it('the builder watchdog kills the builder\'s whole group when the driver is killed with -9, and releases what it held', async () => {
    const dir = tempDir();
    const lstart = (pid: number): string => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const driver = spawn('sleep', ['600'], { stdio: 'ignore' });
    // The builder: its own group, with a child that would outlive it.
    const builder = spawn('/bin/sh', ['-c', 'sleep 600 & sleep 600; wait'], { detached: true, stdio: 'ignore' });
    const [d, b] = [driver.pid!, builder.pid!];
    await new Promise((r) => setTimeout(r, 300));
    const quiet = join(dir, 'quiet');
    const priority = join(dir, 'priority');
    writeFileSync(quiet, String(b));
    writeFileSync(priority, '1'); // another process's priority: kept
    const log = join(dir, 'log');
    const w = spawn(process.execPath, [repoPath('scripts/land-watchdog.ts'), String(d), lstart(d), String(b), lstart(b), quiet, priority, log], { detached: true, stdio: 'ignore' });
    const watchdogDone = new Promise((r) => w.on('exit', r));
    await new Promise((r) => setTimeout(r, 1500));
    expect(groupAlive(b)).toBe(true); // the driver lives: nothing happens
    process.kill(d, 'SIGKILL');
    await watchdogDone;
    for (let i = 0; i < 600 && groupAlive(b); i++) await new Promise((r) => setTimeout(r, 50));
    expect(groupAlive(b)).toBe(false);
    expect(existsSync(quiet)).toBe(false);
    expect(readFileSync(priority, 'utf8')).toBe('1');
    expect(readFileSync(log, 'utf8')).toContain('stopped the builder');
  }, 90_000);

  it('the builder watchdog ends by itself when the builder ends first', async () => {
    const dir = tempDir();
    const lstart = (pid: number): string => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const driver = spawn('sleep', ['600'], { stdio: 'ignore' });
    const builder = spawn('/bin/sh', ['-c', 'sleep 2'], { detached: true, stdio: 'ignore' });
    const [d, b] = [driver.pid!, builder.pid!];
    await new Promise((r) => setTimeout(r, 300));
    const log = join(dir, 'log');
    const w = spawn(process.execPath, [repoPath('scripts/land-watchdog.ts'), String(d), lstart(d), String(b), lstart(b), join(dir, 'q'), join(dir, 'p'), log], { detached: true, stdio: 'ignore' });
    await new Promise((r) => w.on('exit', r));
    expect(readFileSync(log, 'utf8')).toContain('builder ended');
    expect(() => process.kill(d, 0)).not.toThrow(); // the driver was never touched
    process.kill(d, 'SIGKILL');
  }, 90_000);
});
