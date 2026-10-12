import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { expectationsPath, readExpectations } from '../src/expectations.ts';
import { buildManifest } from '../src/manifest.ts';
import { lockedCommit, pinnedWptDir, REPO_ROOT } from '../src/paths.ts';
import type { ReftestLayoutReport } from '../src/reftest.ts';
import { readReftestCapture, REFTEST_CAPTURE_DIR, reftestLayoutPath, serializeReftestLayout } from '../src/reftest.ts';
import { listSnapshots, needsSnapshot, parseSnapshot, serializeSnapshot, sha256, SNAPSHOT_DIR, snapshotFile } from '../src/snapshot.ts';
import { translate } from '../src/translate.ts';

const wpt = pinnedWptDir();
const commit = lockedCommit();
const read = (p: string): string | null => {
  try {
    return readFileSync(join(wpt, p), 'utf8');
  } catch {
    return null;
  }
};

describe('the committed snapshot store (packages/wpt/snapshots)', () => {
  const committed = listSnapshots(SNAPSHOT_DIR);

  it('holds exactly the numeric files whose static translation meets script logic, helper scripts or handlers', () => {
    const expected = buildManifest(wpt).filter((e) => {
      if (e.kind !== 'numeric') return false;
      const t = translate(e.path, read(e.path) as string, commit, read);
      return t.kind === 'refused' && needsSnapshot(t.missing);
    }).map((e) => e.path);
    expect(committed).toEqual(expected);
    expect(committed.length).toBeGreaterThan(250);
  });

  it('every snapshot is pinned to the locked commit and its source, and re-serializes byte for byte', () => {
    for (const p of committed) {
      const text = readFileSync(snapshotFile(SNAPSHOT_DIR, p), 'utf8');
      const f = parseSnapshot(text);
      expect(f.source).toBe(p);
      expect(f.wpt).toBe(commit);
      expect(f.sha256).toBe(sha256(read(p) as string));
      expect(serializeSnapshot(f)).toBe(text);
    }
  });

  it('PLANTED: wpt:check fails when a committed snapshot is missing or stale', () => {
    const path = 'css/css-grid/alignment/grid-alignment-implies-size-change-001.html';
    expect(committed).toContain(path);
    const expectedReason = readExpectations(expectationsPath('web')).tests[path];
    expect(expectedReason?.status).toBe('not-runnable');
    const check = (dir: string) => spawnSync(process.execPath, ['--conditions=dragon-internal', join(REPO_ROOT, 'packages/wpt/src/cli/check.ts'), '--target', 'web', '--filter', path, '--snapshots', dir], { encoding: 'utf8', env: process.env });
    const dir = mkdtempSync(join(tmpdir(), 'dragon-wpt-snapshots-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(SNAPSHOT_DIR, dir, { recursive: true });
    expect(check(dir).status).toBe(0);
    const file = snapshotFile(dir, path);
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace(/"sha256": "[0-9a-f]+"/, `"sha256": "${'0'.repeat(64)}"`));
    const stale = check(dir);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain(`${path}: not-runnable reason changed`);
    expect(stale.stderr).toContain('"snapshot:stale"');
    rmSync(file);
    const missing = check(dir);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('"snapshot:missing"');
  });
});

describe('the committed reftest-layout report and captures (experimental, report-only)', () => {
  it('is deterministic, pinned, and every verdict has a committed Chrome capture', () => {
    const file = reftestLayoutPath('web');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    const r = JSON.parse(text) as ReftestLayoutReport;
    expect(serializeReftestLayout(r)).toBe(text);
    expect(r.wpt).toBe(commit);
    expect(r.kind).toBe('reftest-layout');
    for (const [p, e] of Object.entries(r.tests)) {
      if (e.status === 'not-runnable' && !e.missing.startsWith('reftest-layout:')) continue;
      const c = readReftestCapture(REFTEST_CAPTURE_DIR, p);
      expect(c?.wpt).toBe(commit);
      if (e.status !== 'not-runnable') expect(c?.ref).toBe(e.ref);
    }
  });
});
