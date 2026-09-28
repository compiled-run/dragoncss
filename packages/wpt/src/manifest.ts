// Every test file under <wpt>/css with its kind. The file rules and kind order are the scout classifier's
// (/tmp/wpt-scout/classify.py, run with --all); only the kind decides here, never feature support.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type TestKind = 'numeric' | 'testharness-other' | 'reftest' | 'crashtest' | 'manual' | 'other';
export const TEST_KINDS: readonly TestKind[] = ['numeric', 'testharness-other', 'reftest', 'crashtest', 'manual', 'other'];

export type ManifestEntry = { readonly path: string; readonly kind: TestKind };

const EXT = ['.html', '.htm', '.xht', '.xhtml', '.svg', '.xml'];
const SKIP_DIRS = new Set(['support', 'resources', 'reference', 'references', 'tools']);

/** A file path relative to its spec directory (css/<spec>/<rel>) that names a test, not a support or reference file. */
export function isTestFile(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return false;
  const b = parts[parts.length - 1] as string;
  if (!EXT.some((e) => b.endsWith(e)) && !b.endsWith('.window.js') && !b.endsWith('.any.js')) return false;
  if (/(-ref|-notref|-ref-\d+|\.ref)\./.test(b) || b.startsWith('ref-') || b.includes('-ref.')) return false;
  return true;
}

/** The kind of a test file from its path and source; null for a harness-less file with no rel=help, which is not a test. */
export function kindOf(path: string, src: string): TestKind | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base.includes('-manual')) return 'manual';
  if (path.includes('/crashtests/') || base.includes('-crash')) return 'crashtest';
  if (/<link[^>]*rel\s*=\s*["']?(match|mismatch)/i.test(src)) return 'reftest';
  if (src.includes('testharness.js')) {
    if (src.includes('check-layout-th.js') || /data-(expected-[a-z-]+|offset-[xy])\s*=/.test(src)) return 'numeric';
    return 'testharness-other';
  }
  return /rel\s*=\s*["']?help/.test(src) ? 'other' : null;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function walk(dir: string, rel: string, out: string[]): void {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    const r = rel === '' ? d.name : `${rel}/${d.name}`;
    if (d.isDirectory()) walk(full, r, out);
    else if (d.isFile() || (d.isSymbolicLink() && statSync(full).isFile())) out.push(r);
  }
}

/** Every css/<spec>/... file path (relative to the WPT root) that passes isTestFile, sorted by code unit. */
export function testFilePaths(wpt: string): string[] {
  const out: string[] = [];
  for (const spec of readdirSync(join(wpt, 'css'), { withFileTypes: true })) {
    if (!spec.isDirectory()) continue;
    const files: string[] = [];
    walk(join(wpt, 'css', spec.name), '', files);
    for (const f of files) if (isTestFile(f)) out.push(`css/${spec.name}/${f}`);
  }
  return out.sort(byCodeUnit);
}

/** The manifest: every test file under css/ with its kind, sorted by path. */
export function buildManifest(wpt: string): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const path of testFilePaths(wpt)) {
    if (path.endsWith('.js')) {
      out.push({ path, kind: 'testharness-other' });
      continue;
    }
    const kind = kindOf(path, readFileSync(join(wpt, path), 'utf8'));
    if (kind !== null) out.push({ path, kind });
  }
  return out;
}

export function countKinds(entries: readonly ManifestEntry[]): Record<TestKind, number> {
  const out = Object.fromEntries(TEST_KINDS.map((k) => [k, 0])) as Record<TestKind, number>;
  for (const e of entries) out[e.kind] += 1;
  return out;
}
