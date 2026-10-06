// Preloaded into every Node process of a regen step (NODE_OPTIONS=--import, DRAGON_REGEN_TRACE=<dir>): appends each path the
// process reads, lists or probes, each module it loads and each child it starts to <dir>/<pid>.log, so regen can check that a
// step read nothing outside the input set its cache key covers. Lines: "<kind>\t<absolute path>"; kinds R read, D directory
// listing, P probe (stat, exists, access, realpath), G glob (cwd, then pattern), X child (cwd, then the argv as JSON); the
// first line, A, names the process (cwd, then its argv as JSON).
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import * as fsAll from 'node:fs';
import * as cpAll from 'node:child_process';

const dir = process.env.DRAGON_REGEN_TRACE;
const fs = (fsAll as unknown as { default: Record<string, unknown> }).default;
const cp = (cpAll as unknown as { default: Record<string, unknown> }).default;
const traced = (globalThis as { __dragonRegenTrace?: boolean }).__dragonRegenTrace === true;

if (dir !== undefined && dir !== '' && !traced) {
  (globalThis as { __dragonRegenTrace?: boolean }).__dragonRegenTrace = true;
  const logFile = resolve(dir, `${process.pid}-${process.hrtime.bigint()}.log`);
  const seen = new Set<string>();
  const write = appendFileSync;
  write(logFile, `A\t${process.cwd()}\t${JSON.stringify(process.argv)}\n`);
  const note = (kind: string, p: unknown, extra?: string): void => {
    let path: string;
    if (typeof p === 'string') path = p.startsWith('file:') ? fileURLToPath(p) : p;
    else if (p instanceof URL) {
      if (p.protocol !== 'file:') return;
      path = fileURLToPath(p);
    } else if (Buffer.isBuffer(p)) path = p.toString('utf8');
    else return;
    const line = `${kind}\t${resolve(path)}${extra === undefined ? '' : `\t${extra}`}\n`;
    if (seen.has(line)) return;
    seen.add(line);
    write(logFile, line);
  };
  const readFlags = (flags: unknown): boolean => flags === undefined || flags === null || typeof flags === 'number' || (typeof flags === 'string' && (flags.startsWith('r') || flags.includes('+')));
  const wrap = (obj: Record<string, unknown>, name: string, kind: string, pick: (args: unknown[]) => unknown[] = (a) => [a[0]]): void => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    const w = function (this: unknown, ...args: unknown[]): unknown {
      for (const p of pick(args)) note(kind, p);
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    };
    for (const k of Reflect.ownKeys(orig)) if (k !== 'length' && k !== 'name' && k !== 'prototype') Object.defineProperty(w, k, Object.getOwnPropertyDescriptor(orig, k)!);
    obj[name] = w;
  };
  const openPick = (a: unknown[]): unknown[] => (readFlags(a[1]) ? [a[0]] : []);
  const promises = fs.promises as Record<string, unknown>;
  for (const [o, isPromises] of [[fs, false], [promises, true]] as const) {
    for (const n of ['readFile', 'createReadStream']) wrap(o, n, 'R');
    for (const n of ['readdir', 'opendir']) wrap(o, n, 'D');
    for (const n of ['stat', 'lstat', 'exists', 'access', 'realpath', 'readlink', 'statfs']) wrap(o, n, 'P');
    for (const n of ['copyFile', 'cp']) wrap(o, n, 'R');
    wrap(o, 'open', 'R', openPick);
    if (!isPromises) {
      for (const n of ['readFileSync']) wrap(o, n, 'R');
      for (const n of ['readdirSync', 'opendirSync']) wrap(o, n, 'D');
      for (const n of ['statSync', 'lstatSync', 'existsSync', 'accessSync', 'realpathSync', 'readlinkSync', 'statfsSync']) wrap(o, n, 'P');
      for (const n of ['copyFileSync', 'cpSync']) wrap(o, n, 'R');
      wrap(o, 'openSync', 'R', openPick);
      const rp = fs.realpathSync as Record<string, unknown>;
      wrap(rp, 'native', 'P');
      const rpa = fs.realpath as Record<string, unknown>;
      wrap(rpa, 'native', 'P');
    }
    for (const n of isPromises ? ['glob'] : ['glob', 'globSync']) {
      const orig = o[n];
      if (typeof orig !== 'function') continue;
      o[n] = function (this: unknown, ...args: unknown[]): unknown {
        const opts = (typeof args[1] === 'object' && args[1] !== null ? args[1] : {}) as { cwd?: unknown };
        const cwd = typeof opts.cwd === 'string' ? opts.cwd : opts.cwd instanceof URL ? fileURLToPath(opts.cwd) : process.cwd();
        note('G', cwd, JSON.stringify(args[0]));
        return (orig as (...a: unknown[]) => unknown).apply(this, args);
      };
    }
  }
  // Children: note the argv, and keep the tracer in every child's environment (an explicit env would drop it).
  const keepEnv = (env: Record<string, string | undefined>): Record<string, string | undefined> => ({ ...env, DRAGON_REGEN_TRACE: dir, NODE_OPTIONS: process.env.NODE_OPTIONS });
  const child = (name: string, shell: boolean): void => {
    const orig = cp[name];
    if (typeof orig !== 'function') return;
    cp[name] = function (this: unknown, ...args: unknown[]): unknown {
      const optIdx = args.findIndex((a, i) => i > 0 && typeof a === 'object' && a !== null && !Array.isArray(a));
      const opts = (optIdx >= 0 ? args[optIdx] : {}) as { env?: Record<string, string | undefined>; cwd?: unknown };
      const argv = shell ? ['sh', '-c', String(args[0])] : [String(args[0]), ...(Array.isArray(args[1]) ? args[1].map(String) : [])];
      const cwd = typeof opts.cwd === 'string' ? opts.cwd : opts.cwd instanceof URL ? fileURLToPath(opts.cwd) : process.cwd();
      note('X', cwd, JSON.stringify(argv));
      if (opts.env !== undefined) {
        const next = { ...opts, env: keepEnv(opts.env) };
        if (optIdx >= 0) args[optIdx] = next;
      }
      return (orig as (...a: unknown[]) => unknown).apply(this, args);
    };
  };
  for (const n of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) child(n, false);
  for (const n of ['exec', 'execSync']) child(n, true);
  syncBuiltinESMExports();
  registerHooks({
    load(url, context, next) {
      if (url.startsWith('file:')) note('R', url);
      return next(url, context);
    },
  });
}
