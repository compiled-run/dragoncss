// TXT1a-1 R3: the text-latin vectors (packages/layout/vectors/text-latin) replay in the generated Swift and Kotlin engines, through
// the translated harness's transcript replay, with the TypeScript harness's results. Split from text-latin.test.ts, whose other
// cases need Chrome, so this file runs on the native shards (scripts/test-shards.ts TOOLCHAIN_USE).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { repoPath } from '../src/paths.ts';
import type { TextLatinVector } from '../src/text-latin-run.ts';

const { runEngineCase } = (await import(pathToFileURL(repoPath('packages/translate/harness/harness.ts')).href)) as { runEngineCase: (line: string) => string };

const vecs = [1, 2, 3, 2.625].flatMap((d) => {
  const dir = repoPath(`packages/layout/vectors/text-latin/dpr-${d}`);
  return readdirSync(dir).filter((x) => x.endsWith('.json')).sort().map((x) => JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')) as TextLatinVector);
});
const lines = vecs.map((v) => JSON.stringify({ platform: v.platform, faults: NO_ENGINE_FAULTS, input: v.input, shaping: { language: v.language, faces: v.faces, calls: v.calls } }));

describe('TXT1a-1 phase B: text-latin vectors replay in the generated native engines (R3)', () => {
  it('reads every text-latin vector, each laid out by the TypeScript harness', () => {
    expect(vecs.length).toBe(28);
    for (const line of lines) expect(JSON.parse(runEngineCase(line))[0]).toBe('ok');
  });

  for (const target of ['swift', 'kotlin'] as const) {
    it(`replays every vector in the generated ${target} engine with the TypeScript results`, async () => {
      const check = (await import(pathToFileURL(repoPath('packages/translate/src/check.ts')).href)) as { runTarget: (t: string, c: unknown, files: unknown, tag: string) => { status: string; suites: { name: string; failures?: unknown; mismatches?: unknown }[] }; committedFiles: (t: string) => unknown };
      // native.ts corpusFiles keys the written inputs by the corpus digest, so the digest covers the lines.
      const digest = createHash('sha256').update(lines.join('\n')).digest('hex');
      const corpus = { suites: [{ name: 'text-latin', mode: 'engine', lines, expected: lines.map(runEngineCase) }], vectors: [], engineSplit: { ok: lines.length, unsupported: 0, refused: 0, threw: 0, harnessError: 0 }, digest, digests: {} };
      const r = check.runTarget(target, corpus, check.committedFiles(target), `${target}-text-latin`);
      expect(r.status, JSON.stringify(r.suites).slice(0, 2000)).toBe('pass');
    }, 1_800_000);
  }
});
