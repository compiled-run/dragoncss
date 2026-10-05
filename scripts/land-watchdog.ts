// The landing builder's watchdog (runWatchdog in land-lib.ts), started detached by the driver with each builder.
// Run as: node scripts/land-watchdog.ts <driver pid> <driver start> <builder pid> <builder start> <quiet file> <priority file> <log>
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseLstart, runWatchdog } from './land-lib.ts';

const [driverPid, driverStart, builderPid, builderStart, quiet, priority, logFile] = process.argv.slice(2);
const pid = (v: string | undefined): number => (v !== undefined && /^[1-9]\d*$/.test(v) ? Number(v) : Number.NaN);
const driver = pid(driverPid);
const builder = pid(builderPid);
if (!Number.isFinite(driver) || !Number.isFinite(builder) || !driverStart || !builderStart || !quiet || !priority || !logFile) {
  console.error('usage: land-watchdog <driver pid> <driver start> <builder pid> <builder start> <quiet file> <priority file> <log>');
  process.exit(2);
}
const startOf = (p: number): string | null => {
  try {
    return parseLstart(execFileSync('ps', ['-o', 'lstart=', '-p', String(p)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
};
const members = (pgid: number): number => {
  const out = execFileSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').filter((l) => {
    const [g, stat] = l.trim().split(/\s+/);
    return Number(g) === pgid && !/^Z/.test(stat ?? '');
  }).length;
};
const releaseIfOurs = (path: string): void => {
  try {
    if (readFileSync(path, 'utf8').trim() === String(builder)) rmSync(path, { force: true });
  } catch {}
};
const result = runWatchdog({
  driverAlive: () => startOf(driver) === driverStart,
  builderAlive: () => members(builder) > 0,
  builderIsOurs: () => {
    const now = startOf(builder);
    return now === null || now === builderStart;
  },
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
