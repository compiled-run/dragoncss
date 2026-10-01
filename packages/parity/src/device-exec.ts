// The one way the device code runs a child process (PR #42 round 5): every call to adb, simctl, xcrun, the emulator, the build tools
// or a device process goes through here. A call that exits non-zero, is killed by a signal or cannot start throws an ExecError
// naming the command, its exit and its output, so a failed read is never taken for an empty answer. A call site whose failure is an
// expected answer passes allowFailure with the reason, and then gets the result back to judge (ok false) instead of the throw.
// test/lanes-concurrent.test.ts fails on any child process started in the device sources outside this file.
import type { ChildProcess, StdioOptions } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';

export type ExecResult = {
  readonly cmd: string;
  /** The exit code, or null when the process was killed by a signal or could not start. */
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Why the process could not start (or was stopped by a timeout), else null. */
  readonly error: string | null;
  /** The start or timeout error's code (ENOENT, ETIMEDOUT), else null. */
  readonly errorCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout then stderr, with the start error if any. */
  readonly out: string;
  readonly ok: boolean;
};

export class ExecError extends Error {
  readonly result: ExecResult;
  constructor(result: ExecResult) {
    super(`${result.cmd} failed (${result.error ?? (result.signal !== null ? `killed by ${result.signal}` : `exit ${result.status}`)}; tooling fault): ${result.out.trim().slice(-800)}`);
    this.result = result;
  }
}

export type ExecOptions = {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  /** The reason a failure of this call is an answer the caller judges, not a fault; without it a failure throws. */
  readonly allowFailure?: string;
};

const label = (cmd: string, args: readonly string[]): string => [cmd, ...args].join(' ').slice(0, 200);

function settle(cmd: string, status: number | null, signal: NodeJS.Signals | null, e: Error | undefined | null, stdout: string, stderr: string, opts: ExecOptions): ExecResult {
  if (opts.allowFailure !== undefined && opts.allowFailure.trim() === '') throw new Error(`${cmd}: allowFailure needs a reason`);
  const error = e === undefined || e === null ? null : e.message;
  const errorCode = e === undefined || e === null ? null : ((e as NodeJS.ErrnoException).code ?? null);
  const r: ExecResult = { cmd, status, signal, error, errorCode, stdout, stderr, out: `${stdout}${stderr}${error === null ? '' : error}`, ok: status === 0 && signal === null && error === null };
  if (!r.ok && opts.allowFailure === undefined) throw new ExecError(r);
  return r;
}

/** Runs a command to its end, blocking; throws on failure unless allowFailure. */
export function exec(cmd: string, args: readonly string[], opts: ExecOptions = {}): ExecResult {
  const r = spawnSync(cmd, [...args], { cwd: opts.cwd, env: opts.env ?? process.env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: opts.timeoutMs, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
  return settle(label(cmd, args), r.status, r.signal, r.error, r.stdout ?? '', r.stderr ?? '', opts);
}

/** Runs a command to its end, its stdout kept as bytes (a screenshot); throws on failure unless allowFailure. */
export function execBytes(cmd: string, args: readonly string[], opts: ExecOptions = {}): ExecResult & { readonly bytes: Buffer } {
  const r = spawnSync(cmd, [...args], { cwd: opts.cwd, env: opts.env ?? process.env, maxBuffer: 1024 * 1024 * 1024, timeout: opts.timeoutMs, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
  const bytes = (r.stdout as Buffer | null) ?? Buffer.alloc(0);
  return { ...settle(label(cmd, args), r.status, r.signal, r.error, '', ((r.stderr as Buffer | null) ?? Buffer.alloc(0)).toString('utf8'), opts), bytes };
}

/**
 * A child process the caller streams (its lines forwarded, stdin written): the process, and its end as a promise that rejects
 * with an ExecError on failure unless allowFailure. Its output is kept for the error (the last 64 KiB of each stream).
 */
export function spawnChild(cmd: string, args: readonly string[], opts: ExecOptions & { readonly stdio?: StdioOptions; readonly detached?: boolean } = {}): { readonly child: ChildProcess; readonly done: Promise<ExecResult> } {
  const child = spawn(cmd, [...args], { cwd: opts.cwd, env: opts.env ?? process.env, stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'], detached: opts.detached, timeout: opts.timeoutMs, killSignal: 'SIGKILL' });
  const keep = (s: string, d: Buffer): string => (s + d.toString('utf8')).slice(-65536);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => void (stdout = keep(stdout, d)));
  child.stderr?.on('data', (d: Buffer) => void (stderr = keep(stderr, d)));
  const done = new Promise<ExecResult>((resolve, reject) => {
    let failed: Error | null = null;
    const end = (status: number | null, signal: NodeJS.Signals | null): void => {
      try {
        resolve(settle(label(cmd, args), status, signal, failed, stdout, stderr, opts));
      } catch (e) {
        reject(e);
      }
    };
    child.once('error', (e) => {
      failed = e;
      // A process that never started emits no close.
      if (child.pid === undefined) end(null, null);
    });
    child.once('close', (code, signal) => end(code, signal));
  });
  return { child, done };
}

/** Runs a command to its end without blocking the event loop; rejects on failure unless allowFailure. */
export function execAsync(cmd: string, args: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return spawnChild(cmd, args, opts).done;
}
