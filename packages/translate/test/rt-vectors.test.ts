// ANIM-a2 (T047 section 3.2): the rt suite of the P1 corpus. Its lines are the rt vector inputs (packages/layout/rt-vectors), its
// expected results are the translated harness run in TypeScript, and native:swift and native:kotlin compare Swift and Kotlin with
// them byte for byte. These tests prove the expected results are the rt vectors' records, bit for bit and string for string, so
// native equality on the suite is equality with the TypeScript rt reference.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLibraryCase } from '../harness/harness.ts';
import { lockText } from '../src/check.ts';
import { buildCorpus, RT_VECTORS_DIR, rtCases } from '../src/corpus.ts';
import { engineFiles, engineRoots, LAYOUT_SRC, lowerAll } from '../src/generate.ts';

type Rec = readonly (string | number | null)[];
const records = (name: string): readonly Rec[] => (JSON.parse(readFileSync(join(RT_VECTORS_DIR, name), 'utf8')) as { records: Rec[] }).records;

/** The records the rt suite must reproduce, in suite order: [progress, iteration] or [progress, value]. */
function wanted(): string[] {
  return [
    ...records('timing.json').map((r) => JSON.stringify(['ok', [r[2], r[3]]])),
    ...records('easing.json').map((r) => JSON.stringify(['ok', [r[2]]])),
    ...records('hold.json').map((r) => JSON.stringify(['ok', [r[2], r[3]]])),
    ...records('interp.json').map((r) => JSON.stringify(['ok', [r[2], r[3]]])),
  ];
}

/** The easing records carry progress only; the harness reports [progress, iteration] for every timing read. */
function comparable(expected: readonly string[]): string[] {
  const start = records('timing.json').length;
  const end = start + records('easing.json').length;
  return expected.map((e, i) => {
    if (i < start || i >= end) return e;
    const [tag, [p]] = JSON.parse(e) as [string, [string | null, string | null]];
    return JSON.stringify([tag, [p]]);
  });
}

function mismatches(got: readonly string[], want: readonly string[]): number {
  let bad = got.length === want.length ? 0 : Math.abs(got.length - want.length);
  for (let i = 0; i < Math.min(got.length, want.length); i++) if (got[i] !== want[i]) bad++;
  return bad;
}

describe('rt suite (ANIM-a2)', () => {
  const corpus = buildCorpus();
  const rt = corpus.suites.find((s) => s.name === 'rt');

  it('is the last P1 suite, in library mode, one line per rt vector record', () => {
    expect(corpus.suites.map((s) => s.name)).toEqual(['vectors', 'units', 'engine', 'library', 'rt']);
    expect(rt?.mode).toBe('library');
    const n = ['timing.json', 'easing.json', 'hold.json', 'interp.json'].reduce((k, f) => k + records(f).length, 0);
    expect(n).toBe(36785 + 10439 + 903 + 6461);
    expect(rt?.lines.length).toBe(n);
    expect(rt?.lines).toEqual(rtCases());
  });

  it('the TypeScript harness reproduces every rt vector record: timing, easing, hold and interpolation', () => {
    expect(rt).toBeDefined();
    const got = comparable(rt?.expected ?? []);
    const want = wanted();
    const bad: string[] = [];
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i] && bad.length < 5) bad.push(`#${i} ${rt?.lines[i]?.slice(0, 200)}: harness ${got[i]}, vector ${want[i]}`);
    expect(bad).toEqual([]);
    expect(mismatches(got, want)).toBe(0);
    // Every rotation that is not a multiple of 45 degrees went through the harness trigonometry; the matrices are strings too.
    expect(want.filter((w) => w.includes('matrix(')).length).toBeGreaterThan(1000);
    expect((rt?.expected ?? []).filter((e) => !e.startsWith('["ok"'))).toEqual([]);
  });

  it('the comparison is not vacuous: one altered progress bit or value string is a mismatch', () => {
    const want = wanted();
    const got = comparable(rt?.expected ?? []);
    const i = want.findIndex((w) => w.includes('matrix('));
    const flipped = [...got];
    flipped[i] = (flipped[i] as string).replace('matrix(', 'matrix( ');
    expect(mismatches(flipped, want)).toBe(1);
    const j = want.findIndex((w) => /"[0-9a-f]{16}"/.test(w));
    const bits = [...got];
    bits[j] = (bits[j] as string).replace(/"([0-9a-f]{15})([0-9a-f])"/, (_, a: string, b: string) => `"${a}${b === '0' ? '1' : '0'}"`);
    expect(mismatches(bits, want)).toBe(1);
  });

  it('the harness fails a case whose trigonometry falls outside the kernel range rather than guess', () => {
    const b = (x: number): string => Buffer.from(new Float64Array([x]).buffer).reverse().toString('hex');
    const len = ['px', b(0), b(0)];
    const color = [b(0), b(0), b(0), b(0)];
    const lin = ['linear', b(0), b(0), b(0), b(0), b(0), 'end'];
    const rot = (deg: number): unknown[] => ['transform', b(0), len, color, [['rotate', len, len, b(deg), b(1), b(1)]]];
    // Below 9e7 degrees gfx::SinCosDegrees reduces to [0, 45] degrees, so the harness answers; above it the argument is not reduced.
    expect(runLibraryCase(JSON.stringify(['rt-interp', rot(0), rot(100), lin, lin, b(500), b(250.5), b(97.25)]))).toMatch(/^\["ok",\["[0-9a-f]{16}","matrix\(/);
    expect(runLibraryCase(JSON.stringify(['rt-interp', rot(0), rot(2e8), lin, lin, b(500), b(250.5), b(97.25)]))).toMatch(/^\["harness-error","rt trig argument/);
  });

  it('the rt reference files are translated engine roots, and the lock records the rt suite', () => {
    const roots = engineRoots(engineFiles());
    for (const [file, fn] of [['rt-easing.ts', 'easingFromSpec'], ['rt-easing.ts', 'solveBezier'], ['rt-timing.ts', 'computeTiming'], ['rt-timing.ts', 'currentTimeAt'], ['rt-timing.ts', 'seekPaused'], ['rt-interpolate.ts', 'interpolateValue'], ['rt-interpolate.ts', 'serializeValue']] as const) {
      expect(roots.some((r) => r.file === join(LAYOUT_SRC, file) && r.name === fn), `${file} ${fn}`).toBe(true);
    }
    const l = lowerAll();
    const files = new Set(l.engine.sources.map((s) => s.file));
    for (const f of ['rt-easing.ts', 'rt-timing.ts', 'rt-interpolate.ts']) expect(files.has(`packages/layout/src/${f}`), f).toBe(true);
    expect((JSON.parse(lockText(corpus)) as { cases: Record<string, number> }).cases['rt']).toBe(rt?.lines.length);
    expect(JSON.parse(readFileSync(join(RT_VECTORS_DIR, '../../translate/corpus.json'), 'utf8'))).toEqual(JSON.parse(lockText(corpus)));
  }, 120_000);
});
