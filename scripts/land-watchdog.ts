// The landing builder's watchdog (runWatchdog in land-lib.ts), started detached by the driver with each builder.
// Run as: node scripts/land-watchdog.ts <driver pid> <driver start> <builder pid> <builder start> <quiet file> <priority file> <log>
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builderLiveness, type Leader, type Liveness, parseLstart, runWatchdog } from './land-lib.ts';

const [driverPid, driverStart, builderPid, builderStart, quiet, priority, logFile] = process.argv.slice(2);
const pid = (v: string | undefined): number => (v !== undefined && /^[1-9]\d*$/.test(v) ? Number(v) : Number.NaN);
const driver = pid(driverPid);
const builder = pid(builderPid);
if (!Number.isFinite(driver) || !Number.isFinite(builder) || !driverStart || !builderStart || !quiet || !priority || !logFile) {
  console.error('usage: land-watchdog <driver pid> <driver start> <builder pid> <builder start> <quiet file> <priority file> <log>');
  process.exit(2);
}
// A process's liveness against its recorded start time. Only "no such process" (ESRCH, or ps finding none) or another start
// time is "gone"; any other failure of kill or ps (EAGAIN under fork pressure, a signal) is "unknown" and asked again.
const leader = (p: number, start: string): Leader => {
  try {
    process.kill(p, 0);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === 'ESRCH' ? 'exited' : code === 'EPERM' ? 'alive' : 'unknown';
  }
  const r = spawnSync('ps', ['-o', 'stat=,lstart=', '-p', String(p)], { encoding: 'utf8' });
  if (r.error !== undefined || r.signal !== null) return 'unknown';
  const m = /^\s*(\S+)\s+(.*\S)\s*$/.exec(r.stdout ?? '');
  if (r.status === 1 && m === null) return 'exited';
  if (r.status !== 0 || m === null) return 'unknown';
  if (parseLstart(m[2]!) !== start) return 'reused';
  return m[1]!.startsWith('Z') ? 'exited' : 'alive'; // a zombie has exited, not yet reaped
};
// The driver is a single process: exited or reused is gone.
const liveness = (p: number, start: string): Liveness => {
  const l = leader(p, start);
  return l === 'alive' || l === 'unknown' ? l : 'gone';
};
const groupLeft = (pgid: number): boolean | null => {
  const r = spawnSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error !== undefined || r.signal !== null || r.status !== 0) return null;
  return r.stdout.split('\n').some((l) => {
    const [g, stat] = l.trim().split(/\s+/);
    return Number(g) === pgid && !/^Z/.test(stat ?? '');
  });
};
const releaseIfOurs = (path: string): void => {
  try {
    if (readFileSync(path, 'utf8').trim() === String(builder)) rmSync(path, { force: true });
  } catch {}
};
const result = runWatchdog({
  driver: () => liveness(driver, driverStart),
  builder: () => builderLiveness(leader(builder, builderStart), () => groupLeft(builder)),
  groupLeft: () => groupLeft(builder),
  signal: (sig) => {
    try {
      process.kill(-builder, sig);
    } catch {}
  },
  release: () => {
    releaseIfOurs(quiet);
    releaseIfOurs(priority);
  },
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  log: (line) => writeFileSync(logFile, `${new Date().toTimeString().slice(0, 8)} [watchdog] ${line}\n`, { flag: 'a' }),
});
writeFileSync(logFile, `${new Date().toTimeString().slice(0, 8)} [watchdog] ${result}\n`, { flag: 'a' });
