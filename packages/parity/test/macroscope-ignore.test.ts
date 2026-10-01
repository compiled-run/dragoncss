import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIgnoreFile } from '../../../scripts/macroscope-ignore.ts';

const ignore = (...patterns: string[]) => parseIgnoreFile(patterns.join('\n'));

describe('macroscope ignore matcher', () => {
  it('matches a pattern without "/" at any depth, and one with "/" from the repository root', () => {
    const f = ignore('*.lock', 'build/**');
    expect(f.matches('yarn.lock')).toBe(true);
    expect(f.matches('a/b/Cargo.lock')).toBe(true);
    expect(f.matches('a/b/lock')).toBe(false);
    expect(f.matches('build/x.js')).toBe(true);
    expect(f.matches('build/a/b/x.js')).toBe(true);
    expect(f.matches('pkg/build/x.js')).toBe(false);
    expect(f.matches('build')).toBe(false);
  });

  it('lets a leading or middle "**" match zero or more directories', () => {
    const f = ignore('**/out/**', 'docs/research/**/*.json', '**/package.json');
    expect(f.matches('out/a.json')).toBe(true);
    expect(f.matches('packages/parity/out/lanes.json')).toBe(true);
    expect(f.matches('packages/outer/a.json')).toBe(false);
    expect(f.matches('docs/research/a.json')).toBe(true);
    expect(f.matches('docs/research/x/y/a.json')).toBe(true);
    expect(f.matches('docs/research/x/a.md')).toBe(false);
    expect(f.matches('package.json')).toBe(true);
    expect(f.matches('packages/dragon/package.json')).toBe(true);
    expect(f.matches('packages/dragon/package.json5')).toBe(false);
  });

  it('keeps "*" and "?" inside one path segment and treats other characters literally', () => {
    const f = ignore('examples/*/chrome/**', '**/*-oracle/**', '**/*.generated.*', 'a?c.txt', 'x+y.(z)');
    expect(f.matches('examples/grid/chrome/1.png')).toBe(true);
    expect(f.matches('examples/a/b/chrome/1.png')).toBe(false);
    expect(f.matches('packages/layout/rt-oracle/x.json')).toBe(true);
    expect(f.matches('packages/layout/oracle/x.json')).toBe(false);
    expect(f.matches('src/a.generated.ts')).toBe(true);
    expect(f.matches('src/a.generatedts')).toBe(false);
    expect(f.matches('q/abc.txt')).toBe(true);
    expect(f.matches('q/ac.txt')).toBe(false);
    expect(f.matches('q/a/c.txt')).toBe(false);
    expect(f.matches('x+y.(z)')).toBe(true);
    expect(f.matches('xxy.(z)')).toBe(false);
  });

  it('skips comments, blank lines and an ignoreTests front matter block', () => {
    const f = parseIgnoreFile('---\nignoreTests: false\n---\n# out/**\n\n  vendor/**  \r\n');
    expect(f.patterns).toEqual(['vendor/**']);
    expect(f.ignoreTests).toBe(false);
    expect(f.matches('out/a')).toBe(false);
    expect(f.matches('vendor/a')).toBe(true);
    expect(parseIgnoreFile('vendor/**').ignoreTests).toBeNull();
  });

  it('reads an unclosed "---" block, or one without ignoreTests, as patterns, as Macroscope does', () => {
    const unclosed = parseIgnoreFile('---\nignoreTests: false\nvendor/**\n');
    expect(unclosed.ignoreTests).toBeNull();
    expect(unclosed.patterns).toEqual(['---', 'ignoreTests: false', 'vendor/**']);
    expect(unclosed.matches('a/---')).toBe(true);
    const rule = parseIgnoreFile('---\ntitle.md\n---\nvendor/**\n');
    expect(rule.ignoreTests).toBeNull();
    expect(rule.patterns).toEqual(['---', 'title.md', '---', 'vendor/**']);
  });

  it('throws on syntax the docs do not define, rather than guessing', () => {
    for (const bad of ['!keep.ts', 'a/[ab].ts', 'a/{b,c}', 'a\\*b', '/root.ts', 'dir/', 'a**b', 'a//b']) {
      expect(() => ignore(bad), bad).toThrow();
    }
    expect(() => parseIgnoreFile('')).toThrow();
    expect(() => parseIgnoreFile('# only a comment\n')).toThrow();
    expect(() => parseIgnoreFile('---\nignoreTests: no\n---\nvendor/**')).toThrow();
    expect(() => parseIgnoreFile('---\nignoreTests: false\nother: 1\n---\nvendor/**')).toThrow();
    expect(() => parseIgnoreFile('---\nignoreTests: false\nignoreTests: true\n---\nvendor/**')).toThrow();
    expect(() => parseIgnoreFile(Array.from({ length: 1001 }, (_, i) => `p${i}`).join('\n'))).toThrow();
    expect(() => ignore('a/**').matches('a/../b')).toThrow();
    expect(() => ignore('a/**').matches('')).toThrow();
    expect(() => ignore('a/**').matches('/a/b')).toThrow();
  });

  it('reads the repository ignore file and splits code from generated output', () => {
    const f = parseIgnoreFile(readFileSync(new URL('../../../.macroscope/ignore.md', import.meta.url), 'utf8'));
    // Its leading "---" block is never closed, so Macroscope reads it as patterns and skips test files (check run on 19a66f17e).
    expect(f.ignoreTests).toBeNull();
    for (const path of [
      'packages/layout/vectors/dpr-2/writing-mode-horizontal.json',
      'packages/parity/out/lanes.json',
      'packages/dragon/src/profiles/web.ts',
      'packages/layout/rt-oracle/a.json',
      'package.json',
      'pnpm-lock.yaml',
      'docs/goals/milestone-2-proof/state.yaml',
      'packages/parity/expected-dpr/a.json',
    ]) {
      expect(f.matches(path), path).toBe(true);
    }
    for (const path of [
      'scripts/pr-review.ts',
      'packages/parity/test/pr-review.test.ts',
      'packages/layout/src/index.ts',
      '.macroscope/ignore.md',
      'AGENTS.md',
      'packages/dragon/src/profiles/types.ts',
    ]) {
      expect(f.matches(path), path).toBe(false);
    }
  });
});
