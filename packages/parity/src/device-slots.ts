// One machine-wide memory budget for booted devices (PR #42, finding 4143792481). Every boot takes a slot first: a holder file in
// DEVICE_SLOTS_DIR naming its pid, device and the memory the device holds, written under a lock after judging the holders already
// there against one fresh memory reading. So device processes of both targets, of any number of runs, never add up past the budget,
// however they were sized. A slot is released with its device, on a failed boot, and at process exit; a holder whose process has
// died (a crash, a kill after a timeout) is dropped by the next boot that reads it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { withFileLock, writeFileAtomic } from './file-lock.ts';
import type { NativeTarget } from './targets.ts';

const GIB = 1024 ** 3;
/** Memory one booted device holds with its app (resident size measured with a full run: see notes/LANE-SPEED.md), rounded up. */
export const DEVICE_MEMORY: { readonly [T in NativeTarget]: number } = { ios: 3 * GIB, android: 4 * GIB };
/** Memory left to the rest of the machine (the host lanes, the checks, other agents) when devices are started. */
export const MEMORY_RESERVE = 8 * GIB;
/** Machine-wide: /tmp, not os.tmpdir(), which differs between sessions of the same user. DRAGON_DEVICE_SLOTS moves it (tests). */
export const DEVICE_SLOTS_DIR = process.env['DRAGON_DEVICE_SLOTS'] ?? '/tmp/dragon-device-slots';
export const SLOT_WAIT_MS = 1_800_000;
const SLOT_POLL_MS = 2000;

/** Memory free for new processes: free, inactive and speculative pages on macOS (vm_stat), else os.freemem(). */
export function availableMemory(): number {
  if (process.platform !== 'darwin') return freemem();
  const r = spawnSync('vm_stat', { encoding: 'utf8' });
  const parsed = r.status === 0 ? parseVmStat(r.stdout) : null;
  return parsed ?? freemem();
}

/** Free, inactive and speculative bytes from vm_stat output; null when a count or the page size is missing. */
export function parseVmStat(text: string): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const count = (name: string): number => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.`, 'm').exec(text)?.[1]);
  const pages = count('free') + count('inactive') + count('speculative');
  return Number.isFinite(page) && page > 0 && Number.isFinite(pages) ? pages * page : null;
}

export type SlotHolder = { readonly pid: number; readonly device: string; readonly bytes: number; readonly since: number };
export type Memory = { readonly total: number; readonly available: number };

/**
 * Whether a device needing `need` bytes may boot now, given the holders on disk and one memory reading. Holders whose process is
 * dead are stale and dropped. The budget is the smaller of total and available memory, less the reserve; the live holders' bytes
 * count against it in full although a booted device's memory is already out of `available` (counted twice, so it errs toward
 * waiting). With no live holder the device may always boot, so a run always makes progress.
 */
export function slotDecision(holders: readonly SlotHolder[], need: number, mem: Memory, alive: (pid: number) => boolean, reserve: number = MEMORY_RESERVE): { readonly grant: boolean; readonly live: readonly SlotHolder[]; readonly stale: readonly SlotHolder[]; readonly held: number; readonly budget: number } {
  const live = holders.filter((h) => alive(h.pid));
  const stale = holders.filter((h) => !alive(h.pid));
  const held = live.reduce((n, h) => n + h.bytes, 0);
  const budget = Math.min(mem.total, mem.available) - reserve;
  return { grant: live.length === 0 || held + need <= budget, live, stale, held, budget };
}

/** A holder file read back, checked; a malformed one is an error naming the file (never counted as free memory). */
export function parseHolder(text: string, file: string): SlotHolder {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    v = null;
  }
  const o = (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const ok = Number.isInteger(o['pid']) && (o['pid'] as number) > 0 && typeof o['device'] === 'string' && typeof o['bytes'] === 'number' && (o['bytes'] as number) > 0 && typeof o['since'] === 'number';
  if (!ok) throw new Error(`the device slot ${file} is malformed; remove it once no run is booting devices`);
  return o as unknown as SlotHolder;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const slug = (device: string): string => device.replace(/[^A-Za-z0-9-]+/g, '_');
const holderFile = (dir: string, pid: number, device: string): string => join(dir, `${pid}-${slug(device)}.json`);
const mine = new Set<string>();
let exitHook = false;

export type SlotOptions = { readonly dir?: string; readonly memory?: () => Memory; readonly alive?: (pid: number) => boolean; readonly waitMs?: number; readonly pollMs?: number; readonly pid?: number; readonly log?: (line: string) => void };

/** One attempt, under the lock: drop stale holders, and write this device's holder when the budget allows it. */
export function tryAcquireSlot(device: string, need: number, opts: SlotOptions = {}): ReturnType<typeof slotDecision> & { readonly file: string } {
  const dir = opts.dir ?? DEVICE_SLOTS_DIR;
  const pid = opts.pid ?? process.pid;
  const file = holderFile(dir, pid, device);
  mkdirSync(dir, { recursive: true });
  return withFileLock(join(dir, 'slots'), () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)).filter((f) => f !== file);
    // A holder is given back without the lock (at exit, too), so one listed a moment ago may be gone: it no longer holds memory.
    const holders = files.flatMap((f) => {
      const text = readIfPresent(f);
      return text === null ? [] : [{ f, h: parseHolder(text, f) }];
    });
    const d = slotDecision(holders.map((x) => x.h), need, (opts.memory ?? (() => ({ total: totalmem(), available: availableMemory() })))(), opts.alive ?? pidAlive);
    for (const x of holders) if (d.stale.includes(x.h)) rmSync(x.f, { force: true });
    if (d.grant) {
      writeFileAtomic(file, JSON.stringify({ pid, device, bytes: need, since: Date.now() } satisfies SlotHolder));
      if (pid === process.pid) remember(file);
    }
    return { ...d, file };
  });
}

function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

function remember(file: string): void {
  mine.add(file);
  if (exitHook) return;
  exitHook = true;
  // Every exit path of this process that runs JS gives its slots back; a kill leaves a stale holder the next boot drops.
  process.once('exit', () => {
    for (const f of mine) rmSync(f, { force: true });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const gib = (n: number): string => `${(n / GIB).toFixed(1)} GiB`;

/** Waits for a slot for the device (DEVICE_MEMORY of its target); throws after waitMs naming the holders. Returns the holder file. */
export async function acquireDeviceSlot(target: NativeTarget, device: string, opts: SlotOptions = {}): Promise<string> {
  const need = DEVICE_MEMORY[target];
  const log = opts.log ?? ((l: string) => console.log(l));
  const t0 = Date.now();
  let waited = false;
  for (;;) {
    const d = tryAcquireSlot(device, need, opts);
    if (d.grant) {
      if (waited || d.held + need > d.budget) log(`${device}: device memory slot after ${((Date.now() - t0) / 1000).toFixed(0)} s (${gib(d.held + need)} held of a ${gib(d.budget)} budget${d.live.length === 0 ? '; the only device, so it boots whatever the budget' : ''})`);
      return d.file;
    }
    if (!waited) log(`${device}: waiting for a device memory slot: ${gib(d.held)} held by ${d.live.map((h) => `${h.device} (pid ${h.pid})`).join(', ')}, ${gib(need)} more would pass the ${gib(d.budget)} budget`);
    waited = true;
    const waitMs = opts.waitMs ?? SLOT_WAIT_MS;
    if (Date.now() - t0 > waitMs) throw new Error(`${device}: no device memory slot within ${waitMs / 1000} s (tooling fault): ${gib(d.held)} held by ${d.live.map((h) => `${h.device} (pid ${h.pid})`).join(', ')} of a ${gib(d.budget)} budget`);
    await sleep(opts.pollMs ?? SLOT_POLL_MS);
  }
}

/** Gives a slot back; releasing one twice, or one never taken, does nothing. */
export function releaseDeviceSlot(file: string | null): void {
  if (file === null) return;
  mine.delete(file);
  if (existsSync(file)) rmSync(file, { force: true });
}
