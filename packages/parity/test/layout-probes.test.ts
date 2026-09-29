// The grid, float and writing-mode probe capture scripts: their argument checks, case validation, corpus formatting, pin checks
// and screenshot sampling, exercised without Chrome.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../src/paths.ts';
import { FAMILIES as FLOAT_FAMILIES } from '../../../scripts/capture-float-probe.ts';
import { checkPins, FAMILIES as GRID_FAMILIES } from '../../../scripts/capture-grid-probe.ts';
import { darkAt, FAMILIES as WM_FAMILIES } from '../../../scripts/capture-writing-mode-probe.ts';
import { allNumbers, allPrimitives, caseProblems, formatJson, parseProbeArgs, writeOrCheck } from '../../../scripts/probe-common.ts';

describe('probe arguments', () => {
  it('accepts the listed flags and values', () => {
    const a = parseProbeArgs(['--check', '--only=fr'], ['--check', '--plants'], ['--only']);
    expect([...a.flags]).toEqual(['--check']);
    expect(a.values.get('--only')).toBe('fr');
  });
  it('rejects a misspelled flag, an empty value and a value on a plain flag', () => {
    expect(() => parseProbeArgs(['--chek'], ['--check'])).toThrow(/unknown argument --chek/);
    expect(() => parseProbeArgs(['--only='], ['--check'], ['--only'])).toThrow(/unknown argument/);
    expect(() => parseProbeArgs(['--check=1'], ['--check'])).toThrow(/unknown argument/);
  });
  it('a misspelled flag exits 1 before Chrome launches', () => {
    for (const script of ['capture-float-probe.ts', 'capture-grid-probe.ts', 'capture-writing-mode-probe.ts']) {
      let status = 0;
      try {
        execFileSync(process.execPath, ['--conditions=dragon-internal', repoPath(`scripts/${script}`), '--chek'], { stdio: 'pipe' });
      } catch (e) {
        status = (e as { status: number }).status;
      }
      expect(status, script).toBe(1);
    }
  });
});

describe('probe cases', () => {
  it('no family repeats a case id or a data-p label within a case', () => {
    expect(caseProblems(GRID_FAMILIES)).toEqual([]);
    expect(caseProblems(FLOAT_FAMILIES)).toEqual([]);
    expect(caseProblems(WM_FAMILIES)).toEqual([]);
  });
  it('reports repeated case ids and labels', () => {
    const fam = { id: 'f', cases: [{ id: 'a', html: '<i data-p="x"></i><b data-p="x"></b>' }, { id: 'a', html: '' }] };
    expect(caseProblems([fam])).toEqual(['f a: duplicate data-p="x"', 'f: duplicate case a']);
  });
});

describe('probe corpus JSON', () => {
  it('reproduces every committed float and writing-mode corpus file byte for byte', () => {
    for (const [dir, inline] of [['docs/research/float-spike/probe', allNumbers], ['docs/research/writing-mode-spike/probe', allPrimitives]] as const) {
      const files = readdirSync(repoPath(dir)).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThan(5);
      for (const f of files) {
        const text = readFileSync(repoPath(`${dir}/${f}`), 'utf8');
        expect(`${formatJson(JSON.parse(text), inline)}\n` === text, `${dir}/${f}`).toBe(true);
      }
    }
  });
  it('never rewrites string contents', () => {
    const v = { html: 'a [1, 2] b', list: ['x, y', 'z'], nums: [1, -2.5] };
    for (const inline of [allNumbers, allPrimitives]) expect(JSON.parse(formatJson(v, inline))).toEqual(v);
    expect(formatJson(v, allPrimitives)).toContain('["x, y","z"]');
  });
  it('throws on a value JSON would silently turn into null', () => {
    for (const inline of [allNumbers, allPrimitives]) {
      expect(() => formatJson({ a: [1, Number.NaN] }, inline)).toThrow(/NaN is not JSON/);
      expect(() => formatJson({ a: Number.POSITIVE_INFINITY }, inline)).toThrow(/Infinity is not JSON/);
      expect(() => formatJson([undefined], inline)).toThrow(/undefined is not JSON/);
    }
  });
});

describe('grid probe pins', () => {
  it('every plant and deviation pin holds on the committed corpus', () => {
    expect(checkPins()).toBe(true);
  });
  it('a pin whose case, label or environment is missing fails instead of throwing', () => {
    const real = (file: string): string => readFileSync(repoPath(`docs/research/grid-spike/probe/${file}.json`), 'utf8');
    const without = (drop: (j: { cases: Record<string, { labels: string[] }>; envs: string[] }) => void) => (file: string): string => {
      const j = JSON.parse(real(file));
      drop(j);
      return JSON.stringify(j);
    };
    expect(checkPins(without((j) => { delete j.cases['s-fr-seven']; }))).toBe(false);
    expect(checkPins(without((j) => { j.envs = j.envs.map((e) => e.replace('dpr1-', 'dprX-')); }))).toBe(false);
    expect(checkPins(without((j) => { for (const c of Object.values(j.cases)) c.labels = []; }))).toBe(false);
  });
});

describe('writing-mode glyph sampling', () => {
  const img = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) };
  it('reads dark and light pixels', () => {
    expect(darkAt(img, 0, 0)).toBe(true);
    expect(darkAt(img, 1, 0)).toBe(false);
  });
  it('throws for a sample outside the screenshot instead of reading it as light', () => {
    expect(() => darkAt(img, 2, 0)).toThrow(/outside the 2x1 screenshot/);
    expect(() => darkAt(img, 0, 1)).toThrow(/outside/);
    expect(() => darkAt(img, -1, 0)).toThrow(/outside/);
  });
});

describe('probe corpus writes', () => {
  it('--check reports a missing or different file and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    try {
      expect(writeOrCheck([[join(dir, 'a.json'), 'x', 'a.json']], true)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
      expect(writeOrCheck([[join(dir, 'a.json'), 'x', 'a.json']], false)).toBe(true);
      expect(writeOrCheck([[join(dir, 'a.json'), 'x', 'a.json']], true)).toBe(true);
      expect(writeOrCheck([[join(dir, 'a.json'), 'y', 'a.json']], true)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('a failure while staging a later file leaves every target untouched and no staged files behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    try {
      writeFileSync(join(dir, 'a.json'), 'old');
      writeFileSync(join(dir, 'blocker'), '');
      // b.json's parent is a regular file, so staging it fails after a.json is staged.
      expect(() => writeOrCheck([[join(dir, 'a.json'), 'new', 'a'], [join(dir, 'blocker', 'b.json'), 'new', 'b']], false)).toThrow();
      expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('old');
      expect(readdirSync(dir).sort()).toEqual(['a.json', 'blocker']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('a failure while replacing a later file restores the files already replaced', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    try {
      writeFileSync(join(dir, 'a.json'), 'old');
      // c.json is a non-empty directory: staging succeeds, replacing it fails after a.json and b.json were replaced.
      mkdirSync(join(dir, 'c.json'));
      writeFileSync(join(dir, 'c.json', 'x'), '');
      const outputs = [[join(dir, 'a.json'), 'new', 'a'], [join(dir, 'b.json'), 'new', 'b'], [join(dir, 'c.json'), 'new', 'c']] as const;
      expect(() => writeOrCheck(outputs, false)).toThrow();
      expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('old');
      expect(readdirSync(dir).sort()).toEqual(['a.json', 'c.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
