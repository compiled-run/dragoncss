// T132: an emulator that exits before it attaches names how it ended and the tail of its own log (device-run.ts spawnDetached).
import { mkdtempSync, writeFileSync } from 'node:fs';
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
});
