// The pointer-events identity (PM capture ruling on T063J): adding the pointer-events longhand may change the Chrome captures
// and the emitted CSS only by its own key. Every capture and emitted file of the base (expected-hit/identity-base.json, written by
// pnpm run parity:hit-capture -- --identity-base <rev>) must still exist and, with that key removed, hash to the base's; every
// other file under those roots belongs to a SELD-R1b fixture.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IdentityManifest } from '../src/hit-capture.ts';
import { IDENTITY_MANIFEST, IDENTITY_NEW, IDENTITY_ROOTS, withoutPointerEvents } from '../src/hit-capture.ts';
import { repoPath } from '../src/paths.ts';

const manifest = JSON.parse(readFileSync(repoPath(IDENTITY_MANIFEST), 'utf8')) as IdentityManifest;

function walk(rel: string): string[] {
  const abs = repoPath(rel);
  return readdirSync(abs).flatMap((f) => (statSync(join(abs, f)).isDirectory() ? walk(`${rel}/${f}`) : [`${rel}/${f}`]));
}

describe('pointer-events changes the captures and emitted files only by its own key', () => {
  it('names a base commit and every base capture and emitted file', () => {
    expect(manifest.base).toMatch(/^[0-9a-f]{40}$/);
    const files = Object.keys(manifest.files);
    expect(files.length).toBeGreaterThan(1000);
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
      if (createHash('sha256').update(withoutPointerEvents(path, text), 'utf8').digest('hex') !== sha) differ.push(path);
    }
    expect(differ).toEqual([]);
  });

  it('adds the key to every captured element and emitted rule', () => {
    const capture = readFileSync(repoPath('packages/parity/expected/darwin-arm64/attr-drop-invalid.web.json'), 'utf8');
    expect(capture.match(/"pointer-events": "auto"/g)?.length).toBe(capture.match(/"computed": \{/g)?.length);
    const css = readFileSync(repoPath('packages/parity/emitted/attr-drop-invalid.css'), 'utf8');
    expect(css.match(/pointer-events: auto;/g)?.length).toBe(css.match(/\{\n/g)?.length);
  });

  it('holds only SELD-R1b fixtures\' files beyond the base', () => {
    const extra = IDENTITY_ROOTS.flatMap(walk).filter((p) => (p.endsWith('.json') || p.endsWith('.css')) && manifest.files[p] === undefined);
    expect(extra.filter((p) => !IDENTITY_NEW.test(p))).toEqual([]);
    expect(extra.length).toBeGreaterThan(0);
  });

  it('catches a byte that differs beyond the key', () => {
    expect(withoutPointerEvents('a.json', '{\n  "x": "1",\n  "pointer-events": "none"\n}')).toBe('{\n  "x": "1"\n}');
    expect(withoutPointerEvents('a.css', '/* compilation ' + 'a'.repeat(64) + ' */\n.d {\n  pointer-events: none;\n  color: red;\n}\n')).toBe('/* compilation <digest> */\n.d {\n  color: red;\n}\n');
    expect(withoutPointerEvents('a.css', '.d {\n  pointer-events: none;\n  color: blue;\n}\n')).not.toBe(withoutPointerEvents('a.css', '.d {\n  color: red;\n}\n'));
    expect(() => withoutPointerEvents('a.png', '')).toThrow(/only .json captures and .css outputs/);
  });
});
