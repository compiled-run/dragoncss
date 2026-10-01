// T132: an emulator that exits before it attaches names how it ended and the tail of its own log (device-run.ts spawnDetached).
import { closeSync, mkdtempSync, openSync, rmSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emulatorLog, logTailOf, spawnDetached } from '../src/device-run.ts';

const dir = mkdtempSync(join(tmpdir(), 'dragon-t132-'));
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('T132: the emulator log is kept and surfaced', () => {
  it('a child that exits early names its exit code, and its stdout and stderr are in the log tail', async () => {
    const log = join(dir, 'exit.log');
    const p = spawnDetached(process.execPath, ['-e', "console.log('emulator: INFO: starting');console.error('FATAL: port 5580 is in use');process.exit(7)"], log);
    await settle(700);
    expect(p.alive()).toBe(false);
    expect(p.exited()).toBe('exit 7');
    expect(p.logTail()).toBe('emulator: INFO: starting | FATAL: port 5580 is in use');
  });

  it('a child killed by a signal names the signal; a running child has not ended', async () => {
    const killed = spawnDetached(process.execPath, ['-e', "process.kill(process.pid,'SIGKILL')"], join(dir, 'killed.log'));
    const slow = spawnDetached(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], join(dir, 'slow.log'));
    await settle(700);
    expect(killed.exited()).toBe('killed by SIGKILL');
    expect(slow.exited()).toBeNull();
    expect(slow.alive()).toBe(true);
    slow.kill();
  });

  it('a binary that cannot start names the start error, and its log says it is empty', async () => {
    const log = join(dir, 'missing.log');
    const p = spawnDetached('/nonexistent/dragon-emulator', [], log);
    await settle(300);
    expect(p.exited()).toMatch(/^could not start: .*ENOENT/);
    expect(p.logTail()).toBe(`(${log} is empty)`);
  });

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
    writeFileSync(big, '');
    truncateSync(big, 3 * 1024 ** 3);
    const fd = openSync(big, 'r+');
    const end = Buffer.from('\nemulator: FATAL: out of memory\n');
    writeSync(fd, end, 0, end.length, 3 * 1024 ** 3);
    closeSync(fd);
    try {
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
