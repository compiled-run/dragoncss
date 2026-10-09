// The pointer-events identity (PM capture ruling on T063J): adding the pointer-events longhand may change the Chrome captures
// and the emitted CSS only by its own key. Every capture and emitted file of the base (expected-hit/identity-base.json, written by
// pnpm run parity:hit-capture -- --identity-base <rev>) must still exist and, with that key removed, hash to the base's; every
// other file under those roots is a case of a registered fixture (fixture groups added since the base capture their cases there).
// IDENTITY_RULED pins the post-ruling hash of each base file a later ruling moves.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IdentityManifest } from '../src/hit-capture.ts';
import { GROUPS } from '../src/fixtures.ts';
import { IDENTITY_MANIFEST, IDENTITY_ROOTS, IDENTITY_RULED, parseHitCaptureArgs, withoutPointerEvents } from '../src/hit-capture.ts';
import { repoPath } from '../src/paths.ts';

const manifest = JSON.parse(readFileSync(repoPath(IDENTITY_MANIFEST), 'utf8')) as IdentityManifest;

const FIXTURE_IDS = new Set(Object.values(GROUPS).flatMap((g) => g.map((f) => f.id)));

/** The registered fixture a capture or emitted file is a case of (its name less the ~ixN, #N and -rtl case suffixes), or null. */
function fixtureOf(path: string): string | null {
  for (let k = (path.split('/').pop() as string).replace(/\.web\.json$|\.json$|\.css$/, ''); ; ) {
    if (FIXTURE_IDS.has(k)) return k;
    const next = k.replace(/(~ix\d+|#\d+|-rtl)$/, '');
    if (next === k) return null;
    k = next;
  }
}

function walk(rel: string): string[] {
  const abs = repoPath(rel);
  return readdirSync(abs).flatMap((f) => (statSync(join(abs, f)).isDirectory() ? walk(`${rel}/${f}`) : [`${rel}/${f}`]));
}

describe('pointer-events changes the captures and emitted files only by its own key', () => {
  it('names a base commit and every base capture and emitted file', () => {
    expect(manifest.base).toMatch(/^[0-9a-f]{40}$/);
    const files = Object.keys(manifest.files);
    expect(files.length).toBeGreaterThan(1000);
    for (const [path, sha] of Object.entries(manifest.files)) expect([path, /^[0-9a-f]{64}$/.test(sha)]).toEqual([path, true]);
    for (const root of IDENTITY_ROOTS) expect(files.some((f) => f.startsWith(`${root}/`)), root).toBe(true);
  });

  it('hashes every base file, without the pointer-events key, to the base', () => {
    const differ: string[] = [];
    for (const [path, sha] of Object.entries(manifest.files)) {
      let text: string;
      try {
        text = readFileSync(repoPath(path), 'utf8');
      } catch {
        differ.push(`${path}: missing`);
        continue;
      }
      const want = IDENTITY_RULED[path]?.sha256 ?? sha;
      if (createHash('sha256').update(withoutPointerEvents(path, text), 'utf8').digest('hex') !== want) differ.push(path);
    }
    expect(differ).toEqual([]);
    // A ruled file is a base file whose ruling changed it: its pinned hash is a sha256 and differs from the base's.
    for (const [path, r] of Object.entries(IDENTITY_RULED)) expect([path, manifest.files[path] !== undefined, /^[0-9a-f]{64}$/.test(r.sha256), r.sha256 !== manifest.files[path]]).toEqual([path, true, true, true]);
  });

  it('adds the key to every captured element and emitted rule', () => {
    // Every file under the roots, not one sample: the identity hash alone passes a file that never gained the key. Rules inside
    // @media blocks carry only the declarations their query changes, so a CSS file is counted up to its first @media.
    const short: string[] = [];
    let files = 0;
    for (const p of IDENTITY_ROOTS.flatMap(walk)) {
      if (!p.endsWith('.json') && !p.endsWith('.css')) continue;
      files++;
      const text = readFileSync(repoPath(p), 'utf8');
      const own = p.endsWith('.json') ? text : (text.split(/^@media /m)[0] as string);
      const keys = p.endsWith('.json') ? own.match(/"pointer-events": "(auto|none)"/g) : own.match(/^ {2}pointer-events: (auto|none);\n/gm);
      const units = p.endsWith('.json') ? own.match(/"computed": \{/g) : own.match(/\{\n/g);
      if (units === null || keys?.length !== units.length) short.push(`${p}: ${keys?.length ?? 0} pointer-events of ${units?.length ?? 0}`);
    }
    expect(short).toEqual([]);
    expect(files).toBeGreaterThan(Object.keys(manifest.files).length);
  });

  it('holds files beyond the base only for cases of registered fixtures, none of them a base fixture', () => {
    const extra = IDENTITY_ROOTS.flatMap(walk).filter((p) => (p.endsWith('.json') || p.endsWith('.css')) && manifest.files[p] === undefined);
    expect(extra.filter((p) => fixtureOf(p) === null)).toEqual([]);
    expect(extra.length).toBeGreaterThan(0);
    // INL1a and the stacks merged after the base add fixtures of their own; no file is added to a base fixture.
    const baseFixtures = new Set(Object.keys(manifest.files).map(fixtureOf));
    expect(extra.filter((p) => baseFixtures.has(fixtureOf(p)))).toEqual([]);
    // An orphan (a removed or renamed fixture's capture) still fails, as does a suffix on a name no fixture registers.
    expect(fixtureOf('packages/parity/expected/darwin-arm64/no-such-fixture.web.json')).toBeNull();
    expect(fixtureOf('packages/parity/emitted/no-such-fixture~ix0-rtl.css')).toBeNull();
    expect(fixtureOf('packages/parity/expected/darwin-arm64/tree-param-args#0-rtl.web.json')).toBe('tree-param-args');
  });

  it('catches a byte that differs beyond the key', () => {
    expect(withoutPointerEvents('a.json', '{\n  "x": "1",\n  "pointer-events": "none"\n}')).toBe('{\n  "x": "1"\n}');
    expect(withoutPointerEvents('a.css', '/* compilation ' + 'a'.repeat(64) + ' */\n.d {\n  pointer-events: none;\n  color: red;\n}\n')).toBe('/* compilation <digest> */\n.d {\n  color: red;\n}\n');
    expect(withoutPointerEvents('a.css', '.d {\n  pointer-events: none;\n  color: blue;\n}\n')).not.toBe(withoutPointerEvents('a.css', '.d {\n  color: red;\n}\n'));
    expect(() => withoutPointerEvents('a.png', '')).toThrow(/only .json captures and .css outputs/);
  });

  it('removes the PNT1 corner radii added since the base, and nothing else', () => {
    const json = '{\n  "x": "1",\n  "border-top-left-radius": "10px 20px",\n  "border-bottom-left-radius": "50%",\n  "pointer-events": "auto"\n}';
    expect(withoutPointerEvents('a.json', json)).toBe('{\n  "x": "1"\n}');
    expect(withoutPointerEvents('a.css', '.d {\n  border-top-right-radius: 0px;\n  color: red;\n  border-bottom-right-radius: 4px 2px;\n}\n')).toBe('.d {\n  color: red;\n}\n');
    // Another radius-like key, or a changed value beside the stripped ones, still differs.
    expect(withoutPointerEvents('a.json', '{\n  "x": "1",\n  "border-start-start-radius": "0px"\n}')).not.toBe('{\n  "x": "1"\n}');
    expect(withoutPointerEvents('a.css', '.d {\n  border-top-left-radius: 1px;\n  color: blue;\n}\n')).not.toBe(withoutPointerEvents('a.css', '.d {\n  color: red;\n}\n'));
  });

  it('parity:hit-capture takes --vectors, --identity-base <rev> or nothing, and refuses anything else', () => {
    expect(parseHitCaptureArgs([])).toEqual({ mode: 'capture' });
    expect(parseHitCaptureArgs(['--'])).toEqual({ mode: 'capture' });
    expect(parseHitCaptureArgs(['--vectors'])).toEqual({ mode: 'vectors' });
    expect(parseHitCaptureArgs(['--', '--identity-base', 'abc123'])).toEqual({ mode: 'identity-base', rev: 'abc123' });
    expect(() => parseHitCaptureArgs(['--identity-base'])).toThrow(/needs a revision/);
    expect(() => parseHitCaptureArgs(['--identity-base', '--vectors'])).toThrow(/needs a revision/);
    // A typo would otherwise rewrite every capture from Chrome; two modes would otherwise run only the first.
    expect(() => parseHitCaptureArgs(['--vector'])).toThrow(/unknown argument "--vector"/);
    expect(() => parseHitCaptureArgs(['--vectors', '--identity-base', 'abc123'])).toThrow(/one of/);
    expect(() => parseHitCaptureArgs(['--vectors', '--vectors'])).toThrow(/one of/);
  });
});
