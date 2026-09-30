// PR #42 finding 4143792481: every booted device, of either target and any run, holds a slot of one machine-wide memory budget.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceHandle, IosDeviceSpec } from '../src/device-run.ts';
import { DeviceLeftRunning, release, stopSpawned, withDeviceSlot } from '../src/device-run.ts';
import type { SlotHolder } from '../src/device-slots.ts';
import { acquireDeviceSlot, DEVICE_MEMORY, MEMORY_RESERVE, parseHolder, privateSlotsDir, releaseDeviceSlot, slotDecision, tryAcquireSlot } from '../src/device-slots.ts';
import { writeFileAtomic } from '../src/file-lock.ts';
import { repoPath } from '../src/paths.ts';

const GIB = 1024 ** 3;
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dragon-slots-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const holders = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith('.json'));
const holder = (pid: number, device: string, bytes: number): SlotHolder => ({ pid, device, bytes, since: 0 });

describe('the slot arithmetic', () => {
  const mem = { total: 48 * GIB, available: 20 * GIB };
  const alive = (): boolean => true;
  it('grants while the live holders plus the request fit the smaller of total and available memory, less the reserve', () => {
    expect(slotDecision([], 4 * GIB, mem, alive, 8 * GIB).grant).toBe(true);
    expect(slotDecision([holder(1, 'a', 4 * GIB), holder(2, 'b', 4 * GIB)], 4 * GIB, mem, alive, 8 * GIB).grant).toBe(true);
    const full = slotDecision([holder(1, 'a', 4 * GIB), holder(2, 'b', 4 * GIB), holder(3, 'c', 3 * GIB)], 3 * GIB, mem, alive, 8 * GIB);
    expect(full).toMatchObject({ grant: false, held: 11 * GIB, budget: 12 * GIB });
    expect(slotDecision([holder(1, 'a', 4 * GIB)], 4 * GIB, { total: 10 * GIB, available: 40 * GIB }, alive, 4 * GIB).grant).toBe(false);
  });
  it('always grants with no live holder, so a run makes progress on a loaded machine', () => {
    expect(slotDecision([], 4 * GIB, { total: 8 * GIB, available: 1 * GIB }, alive).grant).toBe(true);
    expect(slotDecision([holder(9, 'dead', 40 * GIB)], 4 * GIB, { total: 8 * GIB, available: 1 * GIB }, () => false).grant).toBe(true);
  });
  it('drops holders whose process is dead and does not count them', () => {
    const d = slotDecision([holder(1, 'live', 4 * GIB), holder(2, 'dead', 4 * GIB)], 4 * GIB, mem, (pid) => pid === 1, 8 * GIB);
    expect(d.stale.map((h) => h.device)).toEqual(['dead']);
    expect(d.held).toBe(4 * GIB);
    expect(d.grant).toBe(true);
  });
  it('two targets asking at once never pass the budget, whatever order they ask in', () => {
    const asks = [...Array(2).fill(DEVICE_MEMORY.ios), ...Array(3).fill(DEVICE_MEMORY.android)] as number[];
    for (let seed = 0; seed < 50; seed++) {
      const order = asks.map((b, i) => ({ b, i, k: (i * 7919 + seed * 104729) % 97 })).sort((x, y) => x.k - y.k);
      const held: SlotHolder[] = [];
      for (const a of order) {
        const d = slotDecision(held, a.b, { total: 48 * GIB, available: 20 * GIB }, alive);
        if (d.grant) held.push(holder(a.i + 1, `d${a.i}`, a.b));
        expect(held.length === 1 || held.reduce((n, h) => n + h.bytes, 0) <= 20 * GIB - MEMORY_RESERVE).toBe(true);
      }
    }
  });
  it('a malformed holder file is an error naming it, never free memory', () => {
    expect(() => parseHolder('{"pid":1}', '/x/1-a.json')).toThrow(/\/x\/1-a.json is malformed/);
    expect(() => parseHolder('not json', '/x/2-a.json')).toThrow(/malformed/);
    expect(() => parseHolder('{"pid":-4,"device":"a","bytes":1,"since":0}', '/x/3-a.json')).toThrow(/malformed/);
    expect(() => parseHolder('{"pid":4,"device":"","bytes":1,"since":0}', '/x/4-a.json')).toThrow(/malformed/);
    expect(() => parseHolder('{"pid":4,"device":"a","bytes":1e999,"since":0}', '/x/5-a.json')).toThrow(/malformed/);
    expect(parseHolder('{"pid":4,"device":"a","bytes":1,"since":0}', 'f')).toEqual({ pid: 4, device: 'a', bytes: 1, since: 0 });
  });
});

describe('the slot files', () => {
  it('holders of other processes count; a stale one is removed by the next acquire', () => {
    const dir = tmp();
    const memory = () => ({ total: 48 * GIB, available: 8 * GIB + 7 * GIB });
    const live = new Set([1001, 1002]);
    const alive = (pid: number) => live.has(pid);
    expect(tryAcquireSlot('a', 4 * GIB, { dir, memory, alive, pid: 1001 }).grant).toBe(true);
    expect(tryAcquireSlot('b', 4 * GIB, { dir, memory, alive, pid: 1002 }).grant).toBe(false);
    live.delete(1001);
    const d = tryAcquireSlot('b', 4 * GIB, { dir, memory, alive, pid: 1002 });
    expect(d.grant).toBe(true);
    expect(d.stale.map((h) => h.pid)).toEqual([1001]);
    expect(holders(dir)).toEqual(['1002-b.json']);
  });
  it('the atomic write\'s temp file is not a holder, and a holder given back is gone from the count', () => {
    const dir = tmp();
    const memory = () => ({ total: 48 * GIB, available: 20 * GIB });
    const a = tryAcquireSlot('a', 4 * GIB, { dir, memory, alive: () => true, pid: 2001 });
    writeFileSync(join(dir, '2002-half.json.tmp-1'), 'partial');
    expect(tryAcquireSlot('b', 4 * GIB, { dir, memory, alive: () => true, pid: 2003 })).toMatchObject({ grant: true, held: 4 * GIB });
    releaseDeviceSlot(a.file);
    expect(tryAcquireSlot('c', 4 * GIB, { dir, memory, alive: () => true, pid: 2004 })).toMatchObject({ grant: true, held: 4 * GIB });
  });
  // PR #42 finding 4147492181: /tmp is shared, so the slots directory and the files written into it are checked.
  it('the slots directory must be a private real directory of this user: a symlink, one others can write, or a relative path is refused', () => {
    const base = tmp();
    const elsewhere = join(base, 'elsewhere');
    mkdirSync(elsewhere);
    const link = join(base, 'slots-link');
    symlinkSync(elsewhere, link);
    expect(() => tryAcquireSlot('a', GIB, { dir: link, memory: () => ({ total: 48 * GIB, available: 20 * GIB }) })).toThrow(/slots-link is a symlink/);
    expect(readdirSync(elsewhere)).toEqual([]);
    const open = join(base, 'open');
    mkdirSync(open);
    chmodSync(open, 0o777);
    expect(() => privateSlotsDir(open)).toThrow(/open is writable by others \(mode 777\)/);
    expect(() => privateSlotsDir('relative/slots')).toThrow(/not an absolute path/);
    const fresh = join(base, 'fresh');
    expect(privateSlotsDir(fresh)).toBe(fresh);
    expect(statSync(fresh).mode & 0o777).toBe(0o700);
  });
  it('an atomic write never writes through a link planted at a temporary name', () => {
    const dir = tmp();
    const victim = join(dir, 'victim');
    writeFileSync(victim, 'untouched');
    const path = join(dir, '1-a.json');
    // The name the temporary file had before the fix: predictable, so it could be planted.
    symlinkSync(victim, `${path}.tmp-${process.pid}`);
    writeFileAtomic(path, 'holder');
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(readFileSync(path, 'utf8')).toBe('holder');
  });
  it('a malformed holder stops the acquire with its name', () => {
    const dir = tmp();
    writeFileSync(join(dir, '7-x.json'), '{}');
    expect(() => tryAcquireSlot('a', GIB, { dir })).toThrow(/7-x.json is malformed/);
  });
  it('a wait that finds no slot in time throws naming the holders', async () => {
    const dir = tmp();
    const memory = () => ({ total: 48 * GIB, available: 12 * GIB });
    tryAcquireSlot('iPad', 3 * GIB, { dir, memory, alive: () => true, pid: 4242 });
    await expect(acquireDeviceSlot('android', 'dragon-320', { dir, memory, alive: () => true, waitMs: 50, pollMs: 10, log: () => undefined })).rejects.toThrow(/no device memory slot within 0.05 s .*iPad \(pid 4242\)/);
  });
  it('a failed boot gives its slot back; release gives it back once the device is stopped', async () => {
    const dir = tmp();
    const spec: IosDeviceSpec = { target: 'ios', name: 'iPhone 17' };
    await expect(withDeviceSlot(spec, () => Promise.reject(new Error('boot failed')), { dir, log: () => undefined })).rejects.toThrow('boot failed');
    expect(holders(dir)).toEqual([]);
    const h = await withDeviceSlot(spec, () => Promise.resolve({ spec, udid: 'x', startedHere: true } satisfies DeviceHandle), { dir, log: () => undefined });
    expect(holders(dir)).toEqual([`${process.pid}-iPhone_17.json`]);
    expect(await release(h, () => undefined, () => Promise.resolve(null))).toBeNull();
    expect(holders(dir)).toEqual([]);
    releaseDeviceSlot(join(dir, `${process.pid}-iPhone_17.json`));
  });
  // PR #42 finding 4147492203: a device left running still holds its memory, so it keeps its slot.
  it('a device this runner did not start keeps its slot at release (it stays running), and is not stopped', async () => {
    const dir = tmp();
    const spec: IosDeviceSpec = { target: 'ios', name: 'iPhone 17' };
    const h = await withDeviceSlot(spec, () => Promise.resolve({ spec, udid: 'x', startedHere: false } satisfies DeviceHandle), { dir, log: () => undefined });
    expect(await release(h, () => undefined)).toBeNull();
    expect(holders(dir)).toEqual([`${process.pid}-iPhone_17.json`]);
    releaseDeviceSlot(join(dir, `${process.pid}-iPhone_17.json`));
  });
  it('a device whose stop failed keeps its slot, and the failure is logged and returned; a thrown stop is one too', async () => {
    const dir = tmp();
    const spec: IosDeviceSpec = { target: 'ios', name: 'iPad (A16)' };
    const file = join(dir, `${process.pid}-iPad_A16_.json`);
    const h = await withDeviceSlot(spec, () => Promise.resolve({ spec, udid: 'x', startedHere: true } satisfies DeviceHandle), { dir, log: () => undefined });
    const lines: string[] = [];
    expect(await release(h, (l) => lines.push(l), () => Promise.resolve('the iPad (A16) simulator is Booted after simctl shutdown'))).toMatch(/is Booted/);
    expect(lines.join('\n')).toMatch(/is Booted.*slot is kept until this process exits/);
    expect(holders(dir)).toEqual([`${process.pid}-iPad_A16_.json`]);
    expect(await release(h, () => undefined, () => Promise.reject(new Error('simctl hung')))).toMatch(/could not be stopped: simctl hung/);
    expect(holders(dir)).toEqual([`${process.pid}-iPad_A16_.json`]);
    releaseDeviceSlot(file);
  });
  it('a failed boot that left its device running keeps the slot; stopSpawned stops a live spawned emulator or says it could not', async () => {
    const dir = tmp();
    const spec: IosDeviceSpec = { target: 'ios', name: 'iPhone 17' };
    await expect(withDeviceSlot(spec, () => Promise.reject(new DeviceLeftRunning('boot failed; and it still runs')), { dir, log: () => undefined })).rejects.toThrow('still runs');
    expect(holders(dir)).toEqual([`${process.pid}-iPhone_17.json`]);
    releaseDeviceSlot(join(dir, `${process.pid}-iPhone_17.json`));
    let alive = true;
    expect(await stopSpawned({ alive: () => alive, kill: () => void (alive = false) }, 'dragon-320')).toBeNull();
    expect(await stopSpawned({ alive: () => false, kill: () => { throw new Error('not called'); } }, 'dragon-320')).toBeNull();
    expect(await stopSpawned({ alive: () => true, kill: () => undefined }, 'dragon-480', 600)).toMatch(/dragon-480 emulator process still runs after SIGTERM/);
  });

  // Real processes at once: two iOS and three Android devices ask together; each, once granted, sums the holders on disk.
  const child = (dir: string, target: string, device: string, out: string, mode: 'hold' | 'throw' | 'kill'): Promise<number | null> =>
    new Promise((resolve) => {
      const src = `
        import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
        import { acquireDeviceSlot, releaseDeviceSlot } from ${JSON.stringify(repoPath('packages/parity/src/device-slots.ts'))};
        import { withFileLock } from ${JSON.stringify(repoPath('packages/parity/src/file-lock.ts'))};
        const dir = ${JSON.stringify(dir)};
        const f = await acquireDeviceSlot(${JSON.stringify(target)}, ${JSON.stringify(device)}, { dir, pollMs: 20, log: () => undefined, memory: () => ({ total: 48 * 2 ** 30, available: 20 * 2 ** 30 }) });
        // A holder given back (without the lock) between the listing and the read holds nothing.
        const bytesOf = (x) => { try { return JSON.parse(readFileSync(dir + '/' + x, 'utf8')).bytes; } catch (e) { if (e.code === 'ENOENT') return 0; throw e; } };
        const held = withFileLock(dir + '/slots', () => readdirSync(dir).filter((x) => x.endsWith('.json')).map(bytesOf).reduce((a, b) => a + b, 0));
        appendFileSync(${JSON.stringify(out)}, held + '\\n');
        ${mode === 'throw' ? "throw new Error('the device run failed');" : mode === 'kill' ? "process.kill(process.pid, 'SIGKILL');" : 'await new Promise((r) => setTimeout(r, 300)); releaseDeviceSlot(f);'}
      `;
      const p = spawn(process.execPath, ['--conditions=dragon-internal', '--input-type=module', '-e', src], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d: Buffer) => void (err += d.toString('utf8')));
      p.once('close', (code) => {
        if (code !== 0 && mode === 'hold') console.error(`${device}: ${err}`);
        resolve(code);
      });
    });

  it('two targets in separate processes at once never hold more than the budget, and every device gets its slot', async () => {
    const dir = tmp();
    const out = join(dir, 'held.txt');
    // Two runs' worth of devices (ten processes): holders are given back without the lock while others list them, so the race runs.
    const matrix = [['ios', 'iPhone 17'], ['ios', 'iPad (A16)'], ['android', 'dragon-320'], ['android', 'dragon-smoke'], ['android', 'dragon-480']] as const;
    const devices = [...matrix, ...matrix.map(([t, d]) => [t, `${d} 2`] as const)];
    const codes = await Promise.all(devices.map(([t, d]) => child(dir, t, d, out, 'hold')));
    expect(codes).toEqual(devices.map(() => 0));
    const held = readFileSync(out, 'utf8').trim().split('\n').map(Number);
    expect(held).toHaveLength(devices.length);
    for (const h of held) expect(h).toBeLessThanOrEqual(20 * GIB - MEMORY_RESERVE);
    expect(holders(dir)).toEqual([]);
  }, 60_000);

  it('a process that fails gives its slot back at exit; one killed leaves a holder the next acquire drops', async () => {
    const dir = tmp();
    const out = join(dir, 'held.txt');
    expect(await child(dir, 'android', 'dragon-320', out, 'throw')).not.toBe(0);
    expect(holders(dir)).toEqual([]);
    expect(await child(dir, 'android', 'dragon-480', out, 'kill')).not.toBe(0);
    expect(holders(dir)).toHaveLength(1);
    const d = tryAcquireSlot('dragon-smoke', 4 * GIB, { dir, memory: () => ({ total: 48 * GIB, available: 20 * GIB }) });
    expect(d.stale.map((h) => h.device)).toEqual(['dragon-480']);
    expect(holders(dir)).toEqual([`${process.pid}-dragon-smoke.json`]);
    releaseDeviceSlot(d.file);
  }, 60_000);
});

describe('every boot path takes a slot', () => {
  // A simulator or emulator started anywhere in the parity sources outside the budget would overcommit memory beside the matrix runs.
  const src = repoPath('packages/parity/src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));
  const boots = /simctl', \['boot'|'simctl', 'boot'|'-avd'/;
  it('each source that boots a device takes a device memory slot before it', () => {
    const booting = files(src).filter((f) => boots.test(readFileSync(f, 'utf8')));
    expect(booting.map((f) => f.slice(src.length + 1)).sort()).toEqual(['cli/native-smoke.ts', 'device-run.ts']);
    for (const f of booting) {
      const text = readFileSync(f, 'utf8');
      const firstBoot = text.search(boots);
      const slot = text.search(/acquireDeviceSlot\(|withDeviceSlot\(/);
      expect(slot, f).toBeGreaterThanOrEqual(0);
      expect(slot, f).toBeLessThan(firstBoot);
    }
  });
});
