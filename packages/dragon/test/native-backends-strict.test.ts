// With DRAGON_REQUIRE_NATIVE=1 and the toolchains hidden (an empty PATH, no JAVA_HOME), native-backends.test.ts's checked int
// tests fail naming the missing tool; they once logged "blocked (owner tooling)" and passed (strict-native-class).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

type Report = { readonly testResults: readonly { readonly assertionResults: readonly { readonly title: string; readonly status: string; readonly failureMessages: readonly string[] }[] }[] };

describe('the checked int conversion with DRAGON_REQUIRE_NATIVE=1 and no toolchain on PATH', () => {
  it('fails naming the missing tool instead of reading blocked (owner tooling) and passing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dragon-strict-native-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const report = join(dir, 'report.json');
    const { JAVA_HOME: _javaHome, ...rest } = process.env;
    const env = { ...rest, PATH: '', DRAGON_REQUIRE_NATIVE: '1' };
    const r = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'packages/dragon/test/native-backends.test.ts', '-t', 'checked int', '--reporter=default', '--reporter=json', `--outputFile.json=${report}`], { cwd: root, encoding: 'utf8', env, timeout: 300_000 });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, out).toBe(1);
    expect(out).not.toMatch(/checked int (swift|kotlin): blocked \(owner tooling\)/);
    const tests = (JSON.parse(readFileSync(report, 'utf8')) as Report).testResults.flatMap((f) => f.assertionResults);
    const swift = tests.find((t) => t.title.startsWith('swift:'));
    const kotlin = tests.find((t) => t.title.startsWith('kotlin:'));
    expect(swift?.status, out).toBe('failed');
    expect(swift?.failureMessages.join('\n')).toContain('DRAGON_REQUIRE_NATIVE=1 and checked int swift has no toolchain: swiftc not found');
    // The Kotlin lookup also tries fixed JDK and kotlinc paths (native.ts defaultKotlinLookup), so on a machine with those it runs.
    if (kotlin?.status !== 'passed') {
      expect(kotlin?.status, out).toBe('failed');
      expect(kotlin?.failureMessages.join('\n')).toContain('DRAGON_REQUIRE_NATIVE=1 and checked int kotlin has no toolchain: no JDK 17+ or kotlinc');
    }
  }, 600_000);
});
