// The iOS system fonts at build time: Core Text on the build Mac, through a small Swift helper (coretext-helper.swift) compiled
// once into the build's cache and kept running; the engine's measurer is synchronous, so a worker thread talks to the helper and
// the caller waits on a shared buffer. Off macOS it refuses by name.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { threadId, Worker } from 'node:worker_threads';
import { repoPath } from '../paths.ts';

export const CORETEXT_HELPER_SOURCE = new URL('./coretext-helper.swift', import.meta.url);

/** A Core Text face: the system UI font at a UIFont.Weight value and design, a font by PostScript name, or a registered author file. */
export type CoreTextFace =
  | { readonly kind: 'system'; readonly weight: number; readonly design: 'default' | 'serif' | 'monospaced' }
  | { readonly kind: 'name'; readonly postScriptName: string }
  | { readonly kind: 'data'; readonly sha256: string }
  /** The font Core Text's cascade gives base for text (CTFontCreateForString), which must be postScriptName: a hidden font has no name a host can ask for. */
  | { readonly kind: 'cascade'; readonly base: CoreTextFace; readonly text: string; readonly postScriptName: string };

/** What the helper reports for a face at a size (coretext-helper.swift describe). */
export type CoreTextDescription = {
  readonly postScriptName: string;
  readonly familyName: string;
  readonly file: string | null;
  readonly variation: Readonly<Record<string, number>>;
  readonly size: number;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly leading: number;
  readonly xHeight: number;
  readonly capHeight: number;
  readonly xTop: number;
  readonly zeroAdvance: number;
  readonly ellipsisAdvance: number;
  readonly hhea: { readonly ascender: number; readonly descender: number; readonly lineGap: number } | null;
  readonly os2: { readonly sCapHeight: number; readonly sxHeight: number } | null;
};

export class CoreTextUnavailable extends Error {}

/** The compiled helper in node_modules/.cache, rebuilt when its source changes. */
export function coreTextHelper(): string {
  if (process.platform !== 'darwin') throw new CoreTextUnavailable(`iOS system fonts are measured with Core Text on macOS at build time, and this build runs on ${process.platform}; build on a Mac, or use a font the app bundles`);
  const source = readFileSync(CORETEXT_HELPER_SOURCE);
  const dir = repoPath(`node_modules/.cache/dragon-system-fonts/coretext-${createHash('sha256').update(source).digest('hex').slice(0, 16)}`);
  const binary = join(dir, 'coretext-helper');
  if (existsSync(binary)) return binary;
  mkdirSync(dir, { recursive: true });
  const scratch = `${binary}.${process.pid}-${threadId}`;
  try {
    execFileSync('xcrun', ['swiftc', '-O', CORETEXT_HELPER_SOURCE.pathname, '-o', scratch], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: Buffer };
    throw new CoreTextUnavailable(`the Core Text helper did not compile with xcrun swiftc (Xcode's command line tools are needed): ${err.stderr?.toString() ?? String(e)}`);
  }
  renameSync(scratch, binary);
  return binary;
}

const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const child = spawn(workerData.binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const flag = new Int32Array(workerData.shared, 0, 2);
const bytes = new Uint8Array(workerData.shared, 8);
let pending = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  pending += d;
  let at;
  while ((at = pending.indexOf('\\n')) >= 0) {
    const line = Buffer.from(pending.slice(0, at), 'utf8');
    pending = pending.slice(at + 1);
    if (line.length > bytes.length) { flag[1] = -1; } else { bytes.set(line); flag[1] = line.length; }
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
  }
});
child.on('exit', (code) => { flag[1] = -2; Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); });
parentPort.on('message', (m) => { if (m === null) child.stdin.end(); else child.stdin.write(m + '\\n'); });
`;

/** One running helper, called synchronously. */
export class CoreText {
  private readonly worker: Worker;
  private readonly flag: Int32Array;
  private readonly bytes: Uint8Array;
  private readonly cache = new Map<string, unknown>();
  private readonly registered = new Set<string>();

  constructor(binary: string = coreTextHelper()) {
    const shared = new SharedArrayBuffer(8 + (16 << 20));
    this.flag = new Int32Array(shared, 0, 2);
    this.bytes = new Uint8Array(shared, 8);
    this.worker = new Worker(WORKER, { eval: true, workerData: { binary, shared } });
    this.worker.unref();
  }

  private call(request: Record<string, unknown>): Record<string, unknown> {
    const line = JSON.stringify(request);
    const hit = this.cache.get(line);
    if (hit !== undefined) return hit as Record<string, unknown>;
    const reply = this.send(request);
    if (reply['ok'] !== true) throw new Error(`Core Text: ${String(reply['error'])}`);
    this.cache.set(line, reply);
    return reply;
  }

  private send(request: Record<string, unknown>): Record<string, unknown> {
    const line = JSON.stringify(request);
    Atomics.store(this.flag, 0, 0);
    this.worker.postMessage(line);
    if (Atomics.wait(this.flag, 0, 0, 60_000) === 'timed-out') throw new Error('the Core Text helper did not answer in 60 s');
    const n = this.flag[1] as number;
    if (n === -2) throw new Error('the Core Text helper exited');
    if (n < 0) throw new Error('the Core Text helper answered with more than 16 MB');
    return JSON.parse(new TextDecoder().decode(this.bytes.slice(0, n))) as Record<string, unknown>;
  }

  /** Hands Core Text an author font file; the face that draws it is { kind: 'data', sha256 }. */
  register(bytes: Uint8Array): CoreTextFace {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!this.registered.has(sha256)) {
      const reply = this.send({ op: 'register', sha256, bytes: Buffer.from(bytes).toString('base64') });
      if (reply['ok'] !== true) throw new Error(`Core Text: ${String(reply['error'])}`);
      this.registered.add(sha256);
    }
    return { kind: 'data', sha256 };
  }

  describe(face: CoreTextFace, size: number): CoreTextDescription {
    return this.call({ op: 'describe', face, size })['face'] as CoreTextDescription;
  }

  /** HarfBuzz's integers (GLYPH_STRIDE per glyph) for text[start, end) shaped by Core Text with the whole text as context. */
  shape(face: CoreTextFace, size: number, text: string, start: number, end: number, language: string, features: readonly { readonly tag: string; readonly value: number; readonly start: number; readonly end: number }[]): readonly number[] {
    return this.call({ op: 'shape', face, size, text, start, end, language, features })['glyphs'] as number[];
  }

  /** The font Core Text's cascade draws all of text[start, end) in instead of the face, with its file; null where the face draws any of it. */
  fallback(face: CoreTextFace, size: number, text: string, start: number, end: number, language: string): { readonly postScriptName: string; readonly path: string } | null {
    const r = this.call({ op: 'fallback', face, size, text, start, end, language });
    return r['postScriptName'] === '' ? null : { postScriptName: r['postScriptName'] as string, path: r['path'] as string };
  }

  close(): void {
    this.worker.postMessage(null);
  }
}

/** The iOS simulator runtime the build reads iOS's own font files from: DRAGON_IOS_RUNTIME_ROOT, else the newest iOS runtime. */
export function iosRuntimeRoot(env: NodeJS.ProcessEnv = process.env): { readonly root: string; readonly build: string } {
  const own = env['DRAGON_IOS_RUNTIME_ROOT'];
  if (own !== undefined && own !== '') return { root: own, build: 'DRAGON_IOS_RUNTIME_ROOT' };
  if (process.platform !== 'darwin') throw new CoreTextUnavailable(`iOS system fonts are measured on macOS at build time, and this build runs on ${process.platform}`);
  let listed: unknown;
  try {
    listed = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'runtimes', '-j'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    throw new CoreTextUnavailable(`iOS's own system font metrics are read from an iOS simulator runtime, and \`xcrun simctl list runtimes\` failed: ${(e as Error).message}`);
  }
  const runtimes = ((listed as { runtimes?: unknown }).runtimes ?? []) as { identifier?: string; platform?: string; version?: string; buildversion?: string; isAvailable?: boolean; runtimeRoot?: string }[];
  const ios = runtimes.filter((r) => r.platform === 'iOS' && r.isAvailable === true && typeof r.runtimeRoot === 'string' && typeof r.version === 'string');
  const key = (v: string): number[] => v.split('.').map(Number);
  const newer = (a: string, b: string): number => {
    const x = key(a);
    const y = key(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  // The general runtime of a version (com.apple.CoreSimulator.SimRuntime.iOS-27-2) before a device-specific one of the same version.
  const general = (r: (typeof ios)[number]): boolean => r.identifier === `com.apple.CoreSimulator.SimRuntime.iOS-${(r.version as string).split('.').join('-')}`;
  const best = [...ios].sort((a, b) => newer(b.version as string, a.version as string) || Number(general(b)) - Number(general(a)))[0];
  if (best === undefined) throw new CoreTextUnavailable('iOS\'s own system font metrics are read from an iOS simulator runtime, and none is installed (Xcode > Settings > Components)');
  return { root: best.runtimeRoot as string, build: best.buildversion ?? (best.version as string) };
}

/** A file of iOS's own fonts in that runtime (System/Library/Fonts/Core/<name>). */
export function iosRuntimeFont(name: string): { readonly path: string; readonly bytes: Uint8Array; readonly build: string } {
  const { root, build } = iosRuntimeRoot();
  const path = join(root, 'System/Library/Fonts/Core', name);
  if (!existsSync(path)) throw new CoreTextUnavailable(`the iOS runtime ${build} has no ${path}`);
  return { path, bytes: new Uint8Array(readFileSync(path)), build };
}

let shared: CoreText | null = null;
/** The process's helper, started on first use. */
export function coreText(): CoreText {
  if (shared === null) shared = new CoreText();
  return shared;
}
