// DRAGON_REQUIRE_NATIVE=1 turns a native run with a missing toolchain from blocked (owner tooling) into a failure naming the tool,
// as CI's "No native run was blocked" step does; unset, the run reads blocked as before.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { committedFiles, runTarget } from '../src/check.ts';
import type { Corpus } from '../src/corpus.ts';
import type { KotlinLookup } from '../src/native.ts';
import { blockedRun, requireNative } from '../src/native.ts';

const none: KotlinLookup = { javaHomeEnv: '/nonexistent/jdk', javaHomeCommand: '/nonexistent/java_home', jdkHomes: ['/nonexistent/openjdk@17'], kotlincs: ['/nonexistent/kotlinc'] };
const corpus: Corpus = { suites: [{ name: 'vectors', mode: 'engine', lines: ['{}'], expected: ['["ok"]'] }], vectors: [], engineSplit: { ok: 0, unsupported: 0, refused: 0, threw: 0, harnessError: 0 }, digest: 'x', digests: {} };
const kotlin = (require?: boolean) => (require === undefined ? runTarget('kotlin', corpus, committedFiles('kotlin'), 'test-require-native', false, none) : runTarget('kotlin', corpus, committedFiles('kotlin'), 'test-require-native', false, none, require));

/** Runs use with PATH holding only an empty directory, so swiftc is not found. */
function withoutSwiftc<T>(use: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'dragon-no-swiftc-'));
  const path = process.env['PATH'];
  vi.stubEnv('PATH', dir);
  try {
    return use();
  } finally {
    vi.stubEnv('PATH', path);
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DRAGON_REQUIRE_NATIVE', () => {
  it('reads 1 as on, unset, empty or 0 as off, and throws on any other value', () => {
    expect(requireNative({})).toBe(false);
    expect(requireNative({ DRAGON_REQUIRE_NATIVE: '' })).toBe(false);
    expect(requireNative({ DRAGON_REQUIRE_NATIVE: '0' })).toBe(false);
    expect(requireNative({ DRAGON_REQUIRE_NATIVE: '1' })).toBe(true);
    for (const v of ['true', 'yes', ' 1', '2']) expect(() => requireNative({ DRAGON_REQUIRE_NATIVE: v }), v).toThrow(`DRAGON_REQUIRE_NATIVE is ${JSON.stringify(v)}`);
  });

  it('blockedRun returns blocked (owner tooling) with require off and throws naming the target and tool with it on', () => {
    expect(blockedRun('swift', 'swiftc not found', 'no swiftc on PATH', false)).toEqual({ target: 'swift', status: 'blocked (owner tooling)', toolchain: 'swiftc not found', reason: 'no swiftc on PATH', suites: [], buildSeconds: 0, runSeconds: 0 });
    expect(() => blockedRun('swift', 'swiftc not found', 'no swiftc on PATH', true)).toThrow('DRAGON_REQUIRE_NATIVE=1 and native:swift has no toolchain: swiftc not found (no swiftc on PATH)');
  });

  it('set to 1, a missing JDK and kotlinc fails the Kotlin run, naming them', () => {
    vi.stubEnv('DRAGON_REQUIRE_NATIVE', '1');
    expect(() => kotlin()).toThrow(/^DRAGON_REQUIRE_NATIVE=1 and native:kotlin has no toolchain: no JDK 17\+ or kotlinc \(install JDK 17 and kotlinc/);
    expect(() => kotlin(true)).toThrow(/native:kotlin has no toolchain: no JDK 17\+ or kotlinc/);
  });

  it('set to 1, a missing swiftc fails the Swift run, naming it', () => {
    vi.stubEnv('DRAGON_REQUIRE_NATIVE', '1');
    withoutSwiftc(() => expect(() => runTarget('swift', corpus, committedFiles('swift'), 'test-require-native')).toThrow(/^DRAGON_REQUIRE_NATIVE=1 and native:swift has no toolchain: swiftc not found \(no swiftc on PATH\)/));
  });

  it('unset, a missing toolchain still reads blocked (owner tooling) with no suites, on both targets', () => {
    vi.stubEnv('DRAGON_REQUIRE_NATIVE', undefined);
    const k = kotlin();
    expect([k.status, k.toolchain, k.suites.length]).toEqual(['blocked (owner tooling)', 'no JDK 17+ or kotlinc', 0]);
    const s = withoutSwiftc(() => runTarget('swift', corpus, committedFiles('swift'), 'test-require-native'));
    expect([s.status, s.toolchain, s.suites.length]).toEqual(['blocked (owner tooling)', 'swiftc not found', 0]);
  });

  it('a value other than 0, 1 or empty fails the run rather than being read as off', () => {
    vi.stubEnv('DRAGON_REQUIRE_NATIVE', 'true');
    expect(() => kotlin()).toThrow('DRAGON_REQUIRE_NATIVE is "true"');
  });
});
