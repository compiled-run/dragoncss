// T132: an emulator that exits before it attaches names how it ended and the tail of its own log (device-run.ts spawnDetached).
import { closeSync, mkdtempSync, openSync, rmSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emulatorLog, logTailOf, spawnDetached } from '../src/device-run.ts';

const dir = mkdtempSync(join(tmpdir(), 'dragon-t132-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// PR #48 finding 4151667772: wait for the child's state to change, bounded, instead of a fixed delay a busy host can outrun.
async function until(what: string, done: () => boolean, timeoutMs = 20_000): Promise<void> {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('T132: the emulator log is kept and surfaced', () => {
  it('a child that exits early names its exit code, and its stdout and stderr are in the log tail', async () => {
    const log = join(dir, 'exit.log');
    const p = spawnDetached(process.execPath, ['-e', "console.log('emulator: INFO: starting');console.error('FATAL: port 5580 is in use');process.exit(7)"], log);
    await until('the child to exit', () => p.exited() !== null);
    expect(p.alive()).toBe(false);
    expect(p.exited()).toBe('exit 7');
    expect(p.logTail()).toBe('emulator: INFO: starting | FATAL: port 5580 is in use');
  }, 30_000);

  it('a child killed by a signal names the signal; a running child has not ended until it is stopped', async () => {
    const killed = spawnDetached(process.execPath, ['-e', "process.kill(process.pid,'SIGKILL')"], join(dir, 'killed.log'));
    // Runs until killed below; it writes a line first, so the test knows it started.
    const slowLog = join(dir, 'slow.log');
    const slow = spawnDetached(process.execPath, ['-e', "console.log('up');setInterval(() => {}, 1000)"], slowLog);
    try {
      await until('the killed child to end', () => killed.exited() !== null);
      expect(killed.exited()).toBe('killed by SIGKILL');
      await until('the running child to start', () => slow.logTail() === 'up');
      expect(slow.exited()).toBeNull();
      expect(slow.alive()).toBe(true);
    } finally {
      slow.kill();
    }
    await until('the running child to stop', () => !slow.alive());
    expect(slow.exited()).toBe('killed by SIGTERM');
  }, 30_000);

  it('a binary that cannot start names the start error, and its log says it is empty', async () => {
    const log = join(dir, 'missing.log');
    const p = spawnDetached('/nonexistent/dragon-emulator', [], log);
    await until('the start error', () => p.exited() !== null);
    expect(p.exited()).toMatch(/^could not start: .*ENOENT/);
    expect(p.logTail()).toBe(`(${log} is empty)`);
  }, 30_000);

  it('without a log path there is no tail; a missing log is named; a long log is cut to its end on one line', () => {
    expect(spawnDetached(process.execPath, ['-e', ''], null).logTail()).toBe('');
    expect(logTailOf(join(dir, 'absent.log'))).toBe(`(no log at ${join(dir, 'absent.log')})`);
    const long = join(dir, 'long.log');
    writeFileSync(long, `${'a'.repeat(3000)}\nlast\n`);
    const t = logTailOf(long, 100);
    expect(t.length).toBe(103);
    expect(t.endsWith('a | last')).toBe(true);
    expect(emulatorLog('dragon-320')).toBe(join(tmpdir(), 'dragon-emulator-logs', 'dragon-320.log'));
  });

  // PR #48 finding 4151492076: only the end of the log is read, so a log of any size (here 3 GiB, past readFileSync's limit) works.
  it('a log larger than a whole-file read allows gives its tail, read from the end only', () => {
    const big = join(dir, 'big.log');
    try {
      // A sparse file on APFS and ext4; where holes are not supported it takes real space, and is removed whatever happens.
      writeFileSync(big, '');
      truncateSync(big, 3 * 1024 ** 3);
      const fd = openSync(big, 'r+');
      try {
        const end = Buffer.from('\nemulator: FATAL: out of memory\n');
        writeSync(fd, end, 0, end.length, 3 * 1024 ** 3);
      } finally {
        closeSync(fd);
      }
      expect(logTailOf(big, 40)).toMatch(/ \| emulator: FATAL: out of memory$/);
    } finally {
      rmSync(big, { force: true });
    }
  });

  it('a tail that starts inside a UTF-8 sequence drops the broken bytes; carriage returns are separators', () => {
    const utf = join(dir, 'utf.log');
    writeFileSync(utf, `${'é'.repeat(5000)}\rlast`);
    const t = logTailOf(utf, 10);
    expect(t).not.toContain('\uFFFD');
    expect(t).toBe('...ééé | last');
  });
});
