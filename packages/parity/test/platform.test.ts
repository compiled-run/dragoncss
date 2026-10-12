// S5 (b): platform keying (docs/decisions.md, Linux lane scope; docs/api.md §10.1). No Chrome runs here.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measurerFor, PLATFORM_RULES, platformRules, REFERENCE_PLATFORM as ENGINE_REFERENCE } from '@dragon/layout';
import { createProjectWith, NO_FAULTS, REFERENCE_PLATFORM as COMPILER_REFERENCE, ReferencePlatformUnavailable, referenceDataset, uaDatasetFor } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { expectedDir } from '../src/committed.ts';
import { isForcedCaseId } from '../src/cases.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';
import { checkPlatformCaptures, fixtureOfCase, readCaptures } from '../src/platform-check.ts';
import { BROWSER_FLAVOUR, hostPlatform, REFERENCE_PLATFORM, REFERENCE_REQUIRED, requireReferencePlatform } from '../src/platform.ts';

const UA_DEFAULT = new Set(FIXTURES.filter((f) => f.kind === 'layout' && f.rootFont === 'ua-default').map((f) => f.id));

describe('platform keys', () => {
  it('the reference platform is darwin-arm64 in the parity lane, the engine and the compiler', () => {
    expect([REFERENCE_PLATFORM, ENGINE_REFERENCE, COMPILER_REFERENCE]).toEqual(['darwin-arm64', 'darwin-arm64', 'darwin-arm64']);
    expect(hostPlatform()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it('every committed capture and vector carries its platform (and the capture its browser flavour)', () => {
    const captures = readCaptures(REFERENCE_PLATFORM);
    expect(captures.size).toBeGreaterThan(250);
    for (const [id, c] of captures) expect([c.platform, c.browser], id).toEqual(['darwin-arm64', BROWSER_FLAVOUR]);
    const dir = repoPath('packages/layout/vectors');
    const vectors = readdirSync(dir).filter((f) => f.endsWith('.json'));
    // A SELD-R2a forced case ("~ix<k>") is captured but adds no engine vector: its layout is compared through the lanes. TXT1a-2: a
    // shaped case's vector (with its transcript) lives in vectors/text-latin/dpr-1; its keys are checked by text-latin.test.ts.
    const shaped = readdirSync(`${dir}/text-latin/dpr-1`).filter((f) => f.endsWith('.json'));
    expect(vectors.length + shaped.length).toBe([...captures.keys()].filter((id) => !isForcedCaseId(id)).length);
    for (const f of shaped) expect(JSON.parse(readFileSync(`${dir}/text-latin/dpr-1/${f}`, 'utf8')).platform, f).toBe('darwin-arm64');
    for (const f of vectors) {
      const v = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Record<string, unknown>;
      expect([Object.keys(v), v['platform'], v['measurer']], f).toEqual([['platform', 'measurer', 'input', 'output'], 'darwin-arm64', 'ahem/darwin-arm64']);
    }
  });

  it('the UA dataset and the platform rules are keyed darwin-arm64; there is no Linux dataset, rule or capture file', () => {
    const ua = readdirSync(repoPath('packages/dragon/src/ua')).filter((f) => f.endsWith('.generated.ts'));
    expect(ua).toEqual(['chrome-145.darwin-arm64.dark.generated.ts', 'chrome-145.darwin-arm64.generated.ts']);
    expect(referenceDataset().platform).toBe('darwin-arm64');
    expect([...PLATFORM_RULES.keys()]).toEqual(['darwin-arm64']);
    for (const r of platformRules) expect(r.platform).toBe('darwin-arm64');
    for (const dir of ['packages/dragon/src', 'packages/dragon/src/ua', 'packages/layout/src', 'packages/parity/expected', 'packages/layout/vectors']) {
      expect(readdirSync(repoPath(dir)).filter((f) => /linux/i.test(f)), dir).toEqual([]);
    }
    expect(existsSync(expectedDir('linux-x64'))).toBe(false);
  });

  it('a Linux reference environment and a Linux measurer each give their typed refusal, never another platform\'s values', () => {
    expect(uaDatasetFor('linux-x64')).toMatchObject({ kind: 'refused', code: 'no-ua-dataset', platform: 'linux-x64' });
    let thrown: unknown = null;
    try {
      createProjectWith({ projectId: 'p', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', platform: 'linux-x64' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReferencePlatformUnavailable);
    expect(thrown).toMatchObject({ code: 'no-ua-dataset', platform: 'linux-x64' });
    expect(measurerFor('linux-x64')).toMatchObject({ kind: 'refused', code: 'no-platform-rules', platform: 'linux-x64' });
    expect(measurerFor('darwin-arm64')).toMatchObject({ kind: 'ok', key: 'ahem/darwin-arm64' });
  });

  it('the live parity suite fails off the reference platform with the unavailable message (the guard its beforeAll calls)', () => {
    expect(REFERENCE_REQUIRED).toBe('reference platform darwin-arm64 required; Linux lane unavailable');
    expect(() => requireReferencePlatform('linux-x64')).toThrow(REFERENCE_REQUIRED);
    expect(() => requireReferencePlatform('linux-arm64')).toThrow(REFERENCE_REQUIRED);
    expect(() => requireReferencePlatform('darwin-arm64')).not.toThrow();
    expect(readFileSync(repoPath('packages/parity/test/parity.test.ts'), 'utf8')).toMatch(/beforeAll\(async \(\) => \{\n[^\n]*\n {2}requireReferencePlatform\(hostPlatform\(\)\);/);
  });

  it('ua:capture refuses to write another platform\'s dataset', () => {
    let status = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, ['--conditions=dragon-internal', repoPath('scripts/capture-ua-defaults.ts'), 'linux-x64'], { stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
      status = (e as { status: number }).status;
      stderr = String((e as { stderr: string }).stderr);
    }
    expect(status).toBe(1);
    expect(stderr).toMatch(new RegExp(`refuses to write the linux-x64 dataset on ${hostPlatform()}`));
  });
});

describe('parity:platform-check', () => {
  const reference = readCaptures(REFERENCE_PLATFORM);

  it('passes the reference captures against themselves', () => {
    const r = checkPlatformCaptures(reference, reference, UA_DEFAULT);
    expect(r.problems).toEqual([]);
    expect(r.exemptions).toEqual([]);
    expect(r.geometry).toEqual([]);
    expect(r.comparedCases).toBe(reference.size);
    expect(r.comparedValues).toBeGreaterThan(300_000);
  });

  it('detects a planted computed-value change and a missing node, and exempts only the keyed UA font', () => {
    const copy = new Map<string, WebCapture>(JSON.parse(JSON.stringify([...reference])) as [string, WebCapture][]);
    const edit = (id: string, f: (c: WebCapture) => WebCapture): void => {
      copy.set(id, f(copy.get(id) as WebCapture));
    };
    // One computed value changed on a node of flex-order, one node missing from text-wrap-spaces, and the Linux UA font on block-ua-divs.
    edit('flex-order', (c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === 'r1b' && n.computed !== null ? { ...n, computed: { ...n.computed, 'margin-top': '1px' } } : n)) }));
    edit('text-wrap-spaces', (c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== 'w1') }));
    edit('block-ua-divs', (c) => ({ ...c, nodes: c.nodes.map((n) => (n.computed === null ? n : { ...n, computed: { ...n.computed, 'font-family': '"Times New Roman"' } })) }));
    const r = checkPlatformCaptures(reference, copy, UA_DEFAULT);
    expect(r.problems).toEqual(['flex-order: r1b margin-top "0px" on the reference, "1px" here', 'text-wrap-spaces: node w1 is missing']);
    expect(r.exemptions.length).toBeGreaterThan(0);
    for (const e of r.exemptions) expect([fixtureOfCase(e.case), e.property, e.value]).toEqual(['block-ua-divs', 'font-family', '"Times New Roman"']);
    // The same font change on an Ahem-environment fixture is a hard failure.
    edit('block-border-box', (c) => ({ ...c, nodes: c.nodes.map((n) => (n.id === 'html' && n.computed !== null ? { ...n, computed: { ...n.computed, 'font-family': '"Times New Roman"' } } : n)) }));
    expect(checkPlatformCaptures(reference, copy, UA_DEFAULT).problems).toContain('block-border-box: html font-family "Ahem" on the reference, ""Times New Roman"" here');
  });
});

describe('platform neutrality guard (notes/T033-linux-lane.md)', () => {
  it('no expected or emitted file names a platform default font, except fixtures on the UA-default root font, which match the keyed dataset', () => {
    const uaFont = referenceDataset().computed.html['font-family'] as string;
    expect(uaFont).toBe('Times');
    const checked = { expected: 0, emitted: 0, ua: 0 };
    for (const f of readdirSync(expectedDir())) {
      const text = readFileSync(`${expectedDir()}/${f}`, 'utf8');
      const fixture = fixtureOfCase(f.replace(/\.web\.json$/, ''));
      checked.expected++;
      if (!UA_DEFAULT.has(fixture)) {
        expect(text, f).not.toMatch(/Times/);
        continue;
      }
      checked.ua++;
      const c = JSON.parse(text) as WebCapture;
      for (const n of c.nodes) if (n.computed !== null) expect(n.computed['font-family'], `${f} ${n.id}`).toBe(uaFont);
    }
    for (const f of readdirSync(repoPath('packages/parity/emitted'))) {
      checked.emitted++;
      const text = readFileSync(repoPath(`packages/parity/emitted/${f}`), 'utf8');
      if (UA_DEFAULT.has(f.replace(/(-rtl)?\.css$/, ''))) {
        for (const m of text.matchAll(/font-family: ([^;]+);/g)) expect(m[1], f).toBe(uaFont);
      } else expect(text, f).not.toMatch(/Times/);
    }
    expect(checked.ua).toBe(1);
    expect(checked.expected).toBeGreaterThan(250);
    expect(checked.emitted).toBeGreaterThan(160);
  });
});

describe('the Linux workflow (written, not pushed)', () => {
  const text = readFileSync(repoPath('.github/workflows/parity.yml'), 'utf8');
  const run = [...text.matchAll(/^ {8}run: (.+)$/gm)].map((m) => m[1]);
  it('triggers only on workflow_dispatch and runs on ubuntu-latest with Node 24, pnpm 10.33.2 and Playwright 1.58.2', () => {
    expect(text).toMatch(/^on:\n {2}workflow_dispatch:\n(?! )/m);
    expect(text).not.toMatch(/\b(push|pull_request|schedule|workflow_run|repository_dispatch):/);
    expect([...text.matchAll(/runs-on: (.+)/g)].map((m) => m[1])).toEqual(['ubuntu-latest']);
    expect(text).toMatch(/node-version: '24'/);
    expect(text).toMatch(/version: 10\.33\.2/);
    expect(text).toContain('"Version 1.58.2"');
    expect(readFileSync(repoPath('packages/parity/package.json'), 'utf8')).toContain('"playwright": "1.58.2"');
    for (const u of [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1] as string)) expect(u, u).toMatch(/@v\d+$/);
  });
  it('runs exactly the S5 steps, uses no secrets, and never writes the reference platform key', () => {
    expect(run).toEqual([
      'pnpm install --frozen-lockfile',
      '|',
      'pnpm typecheck',
      'pnpm exec vitest run packages/layout packages/dragon',
      'pnpm run parity:capture',
      'pnpm run parity:platform-check linux-x64',
    ]);
    expect(text).toMatch(/pnpm --filter @dragon\/parity exec playwright install --with-deps chromium/);
    expect(text).toMatch(/path: \|\n {12}packages\/parity\/expected\/linux-x64\n {12}packages\/parity\/out\n/);
    expect(text).not.toMatch(/secrets\.|GITHUB_TOKEN|token:/);
    expect(text).not.toMatch(/darwin-arm64/);
    expect(text).not.toMatch(/ua:capture|layout:vectors|profile:rows|git push|git commit/);
  });
  // T040: a check on the workflow file, not on the environment, so adding a git remote or running without a given git binary
  // cannot turn this red. The workflow runs only when dispatched by hand and has no step that pushes, commits or publishes.
  it('runs only on workflow_dispatch and has no push step', () => {
    const on = /^on:\n((?: {2}.*\n)*)/m.exec(text);
    expect(on, 'on: block').not.toBeNull();
    expect([...(on?.[1] ?? '').matchAll(/^ {2}([A-Za-z_]+):/gm)].map((m) => m[1])).toEqual(['workflow_dispatch']);
    expect(text).not.toMatch(/^on: *\S/m);
    expect(text).toMatch(/^permissions:\n {2}contents: read\n(?! )/m);
    const steps = text.split(/^ {6}- /m).slice(1);
    expect(steps.map((s) => /^name: (.+)/.exec(s)?.[1])).toEqual([
      'Check out', 'Set up pnpm 10.33.2', 'Set up Node 24', 'Install dependencies', 'Install Playwright 1.58.2 Chromium', 'Typecheck',
      'Platform-free suites (packages/layout, packages/dragon)', 'Capture Chrome into the linux-x64 key', 'Platform check against the reference captures',
      'Upload the captures and the report',
    ]);
    for (const step of steps) {
      expect(step, step).not.toMatch(/\bgit\s+(push|commit|tag)\b|\b(npm|pnpm|yarn)\s+publish\b|docker\s+push|gh\s+(release|pr)\b/);
      expect(step, step).not.toMatch(/uses: \S*(push|commit|deploy|publish|release)\S*/i);
    }
  });
});
