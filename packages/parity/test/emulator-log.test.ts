// T132: an emulator that exits before it attaches names how it ended and the tail of its own log (device-run.ts spawnDetached).
// Every child and temp folder goes through scratch(), which stops and removes them after each test, pass or fail.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { emulatorLog, logTailOf, spawnDetached } from '../src/device-run.ts';
import { scratch, until } from './scratch.ts';

// Counts what device-run.ts reads, so the bounded-read test needs no large file (PR #48 finding 4151752733).
const reads = vi.hoisted(() => ({ bytes: 0, whole: 0 }));
vi.mock('node:fs', async (load) => {
  const fs = await load<typeof import('node:fs')>();
  return {
    ...fs,
    readSync: (...a: Parameters<typeof fs.readSync>) => {
      const n = fs.readSync(...a);
      reads.bytes += n;
      return n;
    },
    readFileSync: (...a: Parameters<typeof fs.readFileSync>) => {
      reads.whole++;
      return fs.readFileSync(...a);
    },
  };
});

const s = scratch();
const spawn = (cmd: string, args: readonly string[], log: string | null) => s.track(spawnDetached(cmd, args, log));

describe('T132: the emulator log is kept and surfaced', () => {
  it('a child that exits early names its exit code, and its stdout and stderr are in the log tail', async () => {
    const log = join(s.dir(), 'exit.log');
    const p = spawn(process.execPath, ['-e', "console.log('emulator: INFO: starting');console.error('FATAL: port 5580 is in use');process.exit(7)"], log);
    await until('the child to exit', () => p.exited() !== null);
    expect(p.alive()).toBe(false);
    expect(p.exited()).toBe('exit 7');
    expect(p.logTail()).toBe('emulator: INFO: starting | FATAL: port 5580 is in use');
  }, 30_000);

  it('a child killed by a signal names the signal; a running child has not ended until it is stopped', async () => {
    const dir = s.dir();
    const killed = spawn(process.execPath, ['-e', "process.kill(process.pid,'SIGKILL')"], join(dir, 'killed.log'));
    // Runs until stopped; its first line says it started. scratch() stops it if an assertion fails first.
    const slow = spawn(process.execPath, ['-e', "console.log('up');setInterval(() => {}, 1000)"], join(dir, 'slow.log'));
    await until('the killed child to end', () => killed.exited() !== null);
    expect(killed.exited()).toBe('killed by SIGKILL');
    await until('the running child to start', () => slow.logTail() === 'up');
    expect(slow.exited()).toBeNull();
    expect(slow.alive()).toBe(true);
    slow.kill();
    await until('the running child to stop', () => !slow.alive());
    expect(slow.exited()).toBe('killed by SIGTERM');
  }, 30_000);

  it('a binary that cannot start names the start error, and its log says it is empty', async () => {
    const log = join(s.dir(), 'missing.log');
    const p = spawn('/nonexistent/dragon-emulator', [], log);
    await until('the start error', () => p.exited() !== null);
    expect(p.exited()).toMatch(/^could not start: .*ENOENT/);
    expect(p.logTail()).toBe(`(${log} is empty)`);
  }, 30_000);

  it('without a log path there is no tail; a missing log is named; a long log is cut to its end on one line', async () => {
    const dir = s.dir();
    const quiet = spawn(process.execPath, ['-e', ''], null);
    await until('the child to exit', () => quiet.exited() !== null);
    expect(quiet.exited()).toBe('exit 0');
    expect(quiet.logTail()).toBe('');
    expect(logTailOf(join(dir, 'absent.log'))).toBe(`(no log at ${join(dir, 'absent.log')})`);
    const long = join(dir, 'long.log');
    writeFileSync(long, `${'a'.repeat(3000)}\nlast\n`);
    const t = logTailOf(long, 100);
    expect(t.length).toBe(103);
    expect(t.endsWith('a | last')).toBe(true);
    expect(emulatorLog('dragon-320')).toBe(join(tmpdir(), 'dragon-emulator-logs', 'dragon-320.log'));
  }, 30_000);

  // PR #48 findings 4151492076 and 4151752733: only the end of the log is read, measured on an 8 MiB log (no large allocation).
  it('the tail of a large log is read from its end only, in a bounded number of bytes', () => {
    const big = join(s.dir(), 'big.log');
    writeFileSync(big, `${'x'.repeat(8 * 1024 * 1024)}\nemulator: FATAL: out of memory\n`);
    reads.bytes = 0;
    reads.whole = 0;
    expect(logTailOf(big, 40)).toBe('...xxxxxxx | emulator: FATAL: out of memory');
    expect(reads.whole).toBe(0);
    expect(reads.bytes).toBeGreaterThan(0);
    expect(reads.bytes).toBeLessThanOrEqual(40 * 4 + 1024);
  });

  it('a tail that starts inside a UTF-8 sequence drops the broken bytes; carriage returns are separators', () => {
    const utf = join(s.dir(), 'utf.log');
    writeFileSync(utf, `${'é'.repeat(5000)}\rlast`);
    // 10 chars read 1064 bytes back from 10005: an odd offset, inside a two-byte é.
    const t = logTailOf(utf, 10);
    expect(t).not.toContain('\uFFFD');
    expect(t).toBe('...ééé | last');
  });
});
