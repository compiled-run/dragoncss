import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRtlSafe } from '../../layout/src/inline.ts';
import { committedFiles, diffFiles, expectedFiles, lockedDigest, staleFiles } from '../src/check.ts';
import type { Target } from '../src/check.ts';
import { buildCorpus } from '../src/corpus.ts';
import { FAULTS } from '../src/faults.ts';
import { engineFiles, EXEMPT, LAYOUT_SRC, lowerAll } from '../src/generate.ts';
import { checkSubset } from '../src/subset.ts';
import { hexBits } from '../harness/host.ts';
import { suiteFloorProblems } from './floor.ts';

const lowered = lowerAll();

describe('translator subset (docs/research/native-strategy.md 1.2)', () => {
  it('layout:subset finds 0 violations, and validate.ts is the only exempt engine file', () => {
    expect(EXEMPT).toEqual(['validate.ts']);
    const all = readdirSync(LAYOUT_SRC).filter((f) => f.endsWith('.ts')).sort();
    expect(engineFiles().map((f) => f.slice(LAYOUT_SRC.length + 1))).toEqual(all.filter((f) => f !== 'validate.ts'));
    expect(checkSubset()).toEqual([]);
  });

  it('reports constructs outside the subset with file and line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dragon-subset-'));
    const file = join(dir, 'bad.ts');
    writeFileSync(file, [
      'type Box = { readonly w: number; readonly name: string };',
      'export function a(b: Box | undefined): number { return b?.w ?? 0; }',
      'export function c(s: string): number { return s.length; }',
      'export function d(n: number): number { return n || 1; }',
      "export function e(): boolean { return /x/.test('x'); }",
      'export function f(): number { return Date.now(); }',
      'export function g(n: number): number { return n & 1; }',
      'export function h(): { readonly x: number } { return { x: 1 }; }',
      "export function i(v: unknown): boolean { return typeof v === 'string'; }",
      '',
    ].join('\n'));
    try {
      const v = checkSubset([file]);
      const text = v.map((x) => `${x.line}: ${x.message}`).join('\n');
      for (const [line, what] of [[2, '?.'], [2, '??'], [3, 'string length'], [4, 'booleans only'], [5, 'RegExp'], [6, 'Date'], [7, 'bitwise &'], [8, 'anonymous object type'], [9, 'unknown'], [9, 'typeof']] as const) {
        expect(v.some((x) => x.line === line && x.message.includes(what)), `${line}: ${what}\n${text}`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refactor: isRtlSafe equals the former RTL_SAFE regex over every BMP code point, astral code points and mixed strings', () => {
    const RTL_SAFE = /^[A-Za-z \u200b]*$/u;
    for (let cp = 0; cp <= 0xffff; cp++) {
      const s = String.fromCharCode(cp);
      if (isRtlSafe(s) !== RTL_SAFE.test(s)) throw new Error(`differs at U+${cp.toString(16)}`);
    }
    for (const cp of [0x10000, 0x1d400, 0x1f600, 0x20000, 0xe0041, 0x10ffff]) expect(isRtlSafe(String.fromCodePoint(cp))).toBe(RTL_SAFE.test(String.fromCodePoint(cp)));
    const alphabet = ['A', 'z', ' ', '\u200b', '1', '\u00e9', 'e\u0301', '\u{1F600}', '\ud800', '\udc00', '-', ''];
    let seed = 7;
    for (let k = 0; k < 20000; k++) {
      let s = '';
      const n = k % 9;
      for (let j = 0; j < n; j++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        s += alphabet[seed % alphabet.length];
      }
      expect(isRtlSafe(s), JSON.stringify(s)).toBe(RTL_SAFE.test(s));
    }
  });

  it('the inner fround of fromCssPx is redundant (why the missing-fround fault is planted in percentOf)', () => {
    // fround(fround(x) * 64) equals fround(x * 64): scaling by a power of two commutes with rounding to float.
    const view = new DataView(new ArrayBuffer(8));
    let s = 1;
    const next = (): number => {
      s = (s * 1103515245 + 12345) >>> 0;
      return s;
    };
    const values: number[] = [0, -0, 1 / 64, 2 ** -126, 2 ** -149, 2 ** 122 * (1 - 2 ** -25), 2 ** 122 * (1 - 2 ** -24), 3.4028234663852886e38, Infinity, -Infinity, NaN];
    for (let i = 0; i < 400000; i++) {
      view.setUint32(0, next());
      view.setUint32(4, next());
      values.push(view.getFloat64(0));
    }
    for (let e = -160; e < 140; e++) for (let m = 0; m < 200; m++) values.push(2 ** e * (1 + m / 200));
    for (const x of values) expect(Object.is(Math.trunc(Math.fround(Math.fround(x) * 64)), Math.trunc(Math.fround(x * 64)))).toBe(true);
  });

  it('T038 item 21 guards still hold in packages/layout/src', () => {
    for (const f of readdirSync(LAYOUT_SRC).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(join(LAYOUT_SRC, f), 'utf8');
      expect(/\?\?|\?\.|\?:/.test(text), `${f}: ??, ?. or ?:`).toBe(false);
      expect(/\bDate\b|Math\.random|performance\.|process\.|globalThis/.test(text), `${f}: nondeterminism`).toBe(false);
      // The audited numerics modules: units.ts (layout) and rt-easing.ts (the rt reference's rounding wrappers, T047 RT-3).
      if (f !== 'units.ts' && f !== 'rt-easing.ts') expect(/Math\.(round|floor|ceil|trunc|fround)/.test(text), `${f}: Math rounding outside units.ts and rt-easing.ts`).toBe(false);
    }
  });
});

describe('generated engines (native-strategy.md 1.8)', () => {
  for (const target of ['swift', 'kotlin'] as const satisfies readonly Target[]) {
    it(`${target}: the committed files are byte-equal to a fresh translation (no stale, missing, extra or hand-edited file)`, () => {
      expect(staleFiles(target, lowered)).toEqual([]);
      expect(committedFiles(target).size).toBeGreaterThan(10);
    });

    it(`${target}: every file carries the do-not-edit header; engine files name their TypeScript source and its sha256`, () => {
      const files = committedFiles(target);
      for (const [f, text] of files) {
        const head = text.split('\n').slice(0, 2).join('\n');
        expect(head, f).toMatch(/GENERATED by @dragon\/translate from .*, translator [0-9a-f]{16}\. Do not edit\./);
      }
      for (const s of lowered.engine.sources) {
        const decls = lowered.engine.decls.filter((d) => d.kind !== 'union' && d.loc.file === s.file);
        if (decls.length === 0) continue;
        const text = [...files.entries()].find(([, t]) => t.includes(`from ${s.file} (sha256 ${s.sha256})`));
        expect(text, s.file).toBeDefined();
      }
    });
  }

  it('a hand edit, an extra hand-written file and a missing file are each caught by the freshness comparison', () => {
    for (const target of ['swift', 'kotlin'] as const) {
      const want = expectedFiles(target, lowered);
      const [name, text] = [...want.entries()].find(([f]) => /Units\.(swift|kt)$/.test(f)) as [string, string];
      const edited = new Map(want);
      edited.set(name, text.replace('jsFround', 'jsTrunc'));
      expect(diffFiles(want, edited)).toEqual([name]);
      const extra = new Map(want);
      extra.set(target === 'swift' ? 'Sources/DragonLayout/HandWritten.swift' : 'src/main/kotlin/dev/dragon/layout/HandWritten.kt', '// by hand\n');
      expect(diffFiles(want, extra).length).toBe(1);
      const missing = new Map(want);
      missing.delete(name);
      expect(diffFiles(want, missing)).toEqual([name]);
    }
  });

  it('every planted fault has a Swift and a Kotlin definition', () => {
    expect(FAULTS.map((f) => f.id)).toEqual(['missing-fround', 'platform-round', 'unordered-map', 'unstable-sort', 'character-iteration', 'canonical-equality', 'int32-cumulative']);
    for (const f of FAULTS) {
      expect(f.swift.length, f.id).toBeGreaterThan(0);
      expect(f.kotlin.length, f.id).toBeGreaterThan(0);
    }
  });
});

describe('differential corpus (native-strategy.md 1.7)', () => {
  const c = buildCorpus();

  it('matches the committed seed, sizes and digest; at least 50% of the engine corpus lays out ok', () => {
    expect(c.digest).toBe(lockedDigest());
    const n = Object.fromEntries(c.suites.map((s) => [s.name, s.lines.length]));
    // PIN-DERIVE: p1-floor.json holds every P1 suite in order at no fewer cases than it had (rt-vectors.test reads it too); the
    // four P1 suites keep their exact sizes, and any later suite (ANIM-a2 rt, SELD-R1b hit, ANIM-b1 3b animator) only grows.
    expect(suiteFloorProblems(new URL('./p1-floor.json', import.meta.url), 'p1', c.suites.map((s) => ({ name: s.name, count: s.lines.length })))).toEqual([]);
    expect([n['vectors'], n['units'], n['engine'], n['library']]).toEqual([258, 320000, 20258, 22000]);
    expect(c.engineSplit.ok / 20258).toBeGreaterThanOrEqual(0.5);
    expect(c.engineSplit.threw + c.engineSplit.harnessError).toBe(0);
  });

  it('every engine corpus input passes validateLayoutInput (checked while generating) and the corpus is deterministic', () => {
    expect(buildCorpus().digest).toBe(c.digest);
  });

  it('the translated harness, run in TypeScript, reproduces every vector file output exactly', () => {
    const vectors = c.suites[0];
    expect(vectors?.name).toBe('vectors');
    c.vectors.forEach((v, i) => {
      const r = JSON.parse(vectors?.expected[i] as string) as [string, string, [string, string | null, string, string, string, string][]];
      expect(r[0], v.file).toBe('ok');
      expect(r[1], v.file).toBe(v.measurer);
      const boxes = r[2].map(([id, parent, x, y, w, h]) => ({ id, parent, x: hexBits(x), y: hexBits(y), width: hexBits(w), height: hexBits(h) }));
      expect(boxes, v.file).toEqual(v.output);
    });
  });
});

describe('the harness decodes a calculated line height only with the non-negative range (CSS2 §10.8.1)', () => {
  it('lays out range non-negative and reports a harness error for range all', async () => {
    const { runEngineCase } = await import('../harness/harness.ts');
    const { NO_ENGINE_FAULTS } = await import('../../layout/src/block.ts');
    const v = JSON.parse(readFileSync(join(import.meta.dirname, '../../layout/vectors/phrasing-blockified-abspos.json'), 'utf8')) as { platform: string; input: unknown };
    const withLineHeight = (range: string): string => {
      const input = JSON.parse(JSON.stringify(v.input)) as unknown;
      let set = 0;
      const walk = (n: { kind: string; lineHeight?: unknown; children?: unknown[] }): void => {
        if (n.kind === 'text') { n.lineHeight = { kind: 'calc', expr: { kind: 'px', value: 12 }, range }; set++; }
        for (const c of n.children ?? []) walk(c as never);
      };
      walk((input as { root: never }).root);
      expect(set).toBeGreaterThan(0);
      return JSON.stringify({ platform: v.platform, faults: NO_ENGINE_FAULTS, input });
    };
    expect(runEngineCase(withLineHeight('non-negative'))).toMatch(/^\["ok",/);
    expect(runEngineCase(withLineHeight('all'))).toMatch(/^\["harness-error",".*range/);
  });
});

describe('the harness refuses a shaping plant, which only the shaped measurer acts on (TXT1a-1)', () => {
  it('reports a harness error naming each shaping plant, and lays out the same input without it', async () => {
    const { runEngineCase } = await import('../harness/harness.ts');
    const { NO_ENGINE_FAULTS } = await import('../../layout/src/block.ts');
    const v = JSON.parse(readFileSync(join(import.meta.dirname, '../../layout/vectors/text-fractional-font-size.json'), 'utf8')) as { platform: string; input: unknown };
    expect(runEngineCase(JSON.stringify({ platform: v.platform, faults: NO_ENGINE_FAULTS, input: v.input }))).toMatch(/^\["ok",/);
    const plants = ['advanceNot16_16', 'doubleAccumulation', 'noReshapeAtBreak', 'kerningDropped', 'wholePixelPositions', 'softHyphenWidthMissing', 'metricRoundingSwapped', 'latinCheckSkipped'];
    for (const plant of plants) {
      const out = runEngineCase(JSON.stringify({ platform: v.platform, faults: { ...NO_ENGINE_FAULTS, [plant]: true }, input: v.input }));
      expect(out, plant).toBe(`["harness-error","$.faults.${plant} is a shaping plant, which acts only through the shaped measurer; the harness has only measurerFor's Ahem measurer"]`);
    }
  });
});
