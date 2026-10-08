// scripts/cloud-setup.sh, the cloud-session SessionStart hook: it reads the Node and pnpm pins from the workflows and package.json,
// fails loudly on a pin it cannot read, and is a no-op unless CLAUDE_CODE_REMOTE=true.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';

const SCRIPT = repoPath('scripts/cloud-setup.sh');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };
function run(script: string, args: readonly string[], env: NodeJS.ProcessEnv): Run {
  const r = spawnSync('bash', [script, ...args], { encoding: 'utf8', env });
  if (r.error !== undefined) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A copy of the script in a fixture root with the given workflow node-version lines (odd ones in .yaml files) and packageManager. */
function fixture(nodeVersions: readonly string[], packageManager: string): { root: string; script: string } {
  const root = mkdtempSync(join(tmpdir(), 'dragon-cloud-setup-'));
  dirs.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  copyFileSync(SCRIPT, join(root, 'scripts/cloud-setup.sh'));
  nodeVersions.forEach((v, i) => writeFileSync(join(root, `.github/workflows/w${i}.${i % 2 === 0 ? 'yml' : 'yaml'}`), `jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${v}\n`));
  writeFileSync(join(root, 'package.json'), `{\n  "name": "x",\n  "packageManager": "${packageManager}",\n  "private": true\n}\n`);
  return { root, script: join(root, 'scripts/cloud-setup.sh') };
}

const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete e[k];
  return e;
};

describe('scripts/cloud-setup.sh', () => {
  it('prints the one full Node pin every workflow uses and the pnpm of package.json packageManager', () => {
    const pins = new Set<string>();
    for (const f of readdirSync(repoPath('.github/workflows'))) {
      for (const m of readFileSync(repoPath(`.github/workflows/${f}`), 'utf8').matchAll(/^\s*node-version:\s*['"]?([^'"\s]+)['"]?\s*$/gm)) pins.add(m[1] ?? '');
    }
    const full = [...pins].filter((p) => /^\d+\.\d+\.\d+$/.test(p));
    expect(full.length, [...pins].join(', ')).toBe(1);
    expect([...pins].every((p) => p === full[0] || p === full[0]?.split('.')[0]), [...pins].join(', ')).toBe(true);
    const pm = (JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as { packageManager: string }).packageManager;
    const r = run(SCRIPT, ['--print-versions'], env());
    expect([r.status, r.stderr]).toEqual([0, '']);
    expect(r.stdout).toBe(`node ${full[0]}\npnpm ${pm.replace(/^pnpm@/, '').replace(/\+.*$/, '')}\n`);
  });

  it('is a no-op outside a cloud session: no output, no install, whatever CLAUDE_CODE_REMOTE holds other than true', () => {
    for (const remote of [undefined, '', 'false', '1', 'TRUE']) {
      // A fixture whose pins would fail proves the script exits before reading them.
      const f = fixture(["'24.15.0'", "'25.0.0'"], 'npm@10.0.0');
      const home = join(f.root, 'home');
      mkdirSync(home);
      const r = run(f.script, [], env({ CLAUDE_CODE_REMOTE: remote, CLAUDE_ENV_FILE: join(home, 'claude-env'), HOME: home }));
      expect([remote, r.status, r.stdout, r.stderr]).toEqual([remote, 0, '', '']);
      expect(readdirSync(home), String(remote)).toEqual([]);
    }
  });

  it('fails loudly, naming the cause, on pins it cannot use', () => {
    const cases: readonly [readonly string[], string, RegExp][] = [
      [["'24.15.0'", "'24.16.0'"], 'pnpm@10.33.2', /the workflows pin different Node versions: 24\.15\.0 24\.16\.0/],
      [["'24.15.0'", "'22'"], 'pnpm@10.33.2', /a workflow pins node-version '22', which is not 24\.15\.0 or 24/],
      [["'24.15.0'", '${{ matrix.node }}'], 'pnpm@10.33.2', /a workflow pins node-version '\$\{\{ matrix\.node \}\}'/],
      [["'24'"], 'pnpm@10.33.2', /no workflow pins a full x\.y\.z node-version/],
      [["'24.15.0'"], 'npm@10.0.0', /package\.json packageManager is not pnpm@x\.y\.z/],
      [["'24.15.0'"], 'pnpm@latest', /package\.json packageManager is not pnpm@x\.y\.z \(read 'latest'\)/],
    ];
    for (const [nodes, pm, want] of cases) {
      const f = fixture(nodes, pm);
      const envFile = join(f.root, 'claude-env');
      for (const [args, remote] of [[['--print-versions'], undefined], [[], 'true']] as const) {
        // In a cloud session the pins are read before anything is installed, so a bad pin fails there too.
        const r = run(f.script, args, env({ CLAUDE_CODE_REMOTE: remote, CLAUDE_ENV_FILE: envFile, HOME: join(f.root, 'home') }));
        expect(r.status, `${nodes.join(',')} ${pm} ${args.join(' ')}`).toBe(1);
        expect(r.stderr).toMatch(want);
        expect(r.stdout).toBe('');
      }
      // The cloud run exported DRAGON_REQUIRE_NATIVE=1 before it read the pins, so native runs fail even when setup does.
      expect(readFileSync(envFile, 'utf8')).toBe('export DRAGON_REQUIRE_NATIVE=1\n');
    }
  });

  it('accepts a pnpm pin with a +sha512 hash suffix', () => {
    const f = fixture(["'24.15.0'", "'24'"], 'pnpm@10.33.2+sha512.abc');
    expect(run(f.script, ['--print-versions'], env()).stdout).toBe('node 24.15.0\npnpm 10.33.2\n');
  });

  it('in a cloud session, exports DRAGON_REQUIRE_NATIVE=1 through CLAUDE_ENV_FILE, and fails loudly without that file', () => {
    const f = fixture(["'24.15.0'"], 'pnpm@10.33.2');
    const home = join(f.root, 'home');
    mkdirSync(home);
    const missing = run(f.script, [], env({ CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: undefined, HOME: home }));
    expect([missing.status, missing.stdout]).toEqual([1, '']);
    expect(missing.stderr).toMatch(/^cloud-setup: CLAUDE_ENV_FILE is not set, so the session's commands would not get DRAGON_REQUIRE_NATIVE=1/);
    // Past the export, a host other than Linux stops at the Node download; the export is already in place.
    const envFile = join(f.root, 'claude-env');
    const r = run(f.script, [], env({ CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile, HOME: home }));
    expect(readFileSync(envFile, 'utf8').split('\n')[0]).toBe('export DRAGON_REQUIRE_NATIVE=1');
    if (process.platform !== 'linux') {
      expect([r.status, r.stdout]).toEqual([1, '']);
      expect(r.stderr).toMatch(/^cloud-setup: no Node download for /);
    }
  });

  it('rejects an unknown argument', () => {
    const r = run(SCRIPT, ['--install'], env());
    expect([r.status, r.stderr]).toEqual([1, "cloud-setup: unknown argument '--install' (only --print-versions)\n"]);
  });

  it('runs as the project SessionStart hook on every source (no matcher: compaction drops CLAUDE_ENV_FILE exports), and setup:git turns rerere off', () => {
    const settings = JSON.parse(readFileSync(repoPath('.claude/settings.json'), 'utf8')) as { hooks: { SessionStart: unknown[] } };
    expect(settings.hooks.SessionStart).toEqual([{ hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR"/scripts/cloud-setup.sh', timeout: 900 }] }]);
    const setupGit = (JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['setup:git'] ?? '';
    expect(setupGit.split(' && ')).toContain('git config rerere.enabled false');
  });
});
