// The device lanes over dumps (notes/T015-p4-review-p5-plan.md section 4 items 3, 5 and 6), without a device: a dump that carries
// exactly the references passes every device check; each DUMP_FAULTS entry planted into it is caught by the check it names, with
// its failure kind and lane; (a) and (d) split into node and line parts without losing a problem; and the capture-trust probe
// compares in-app samples with an OS screenshot at the root's offset.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CaseReference, DeviceCheckLane, FailureKind, TrustCase } from '../src/device-lanes.ts';
import { captureTrust, caseReference, dumpFile, evaluateCase, evaluateSet, isSampleRule, readDump, splitByLines, trustFailuresOf } from '../src/device-lanes.ts';
import type { DumpFault, NamedCheck } from '../src/native-compare.ts';
import { checkAgainstChrome, DUMP_FAULTS, FAULT_CHECK, plantDumpFault, readSamples } from '../src/native-compare.ts';
import type { NativeDump } from '../src/native-dump.ts';
import type { NativeCase } from '../src/native-host.ts';
import { nativeCases, nativeOut, relabelledReferenceDumps, reuseStamp } from '../src/native-host.ts';
import { repoPath } from '../src/paths.ts';
import { casePoints, expectedPixelsPath, rasterSize } from '../src/pixel-reference.ts';
import type { NativeTarget } from '../src/targets.ts';

const cases = nativeCases();

/** A dump as a perfect device would write it: the engine frames snapped, the expected applied values, the break vector's line
 * offsets and the Chrome PNG's pixels at the generated points. */
function perfectDump(target: NativeTarget, dpr: number, n: NativeCase, ref: CaseReference, all: readonly NativeDump[]): NativeDump {
  const d = all.find((x) => x.case.id === n.case.id);
  if (d === undefined || ref.breaks === null || ref.pixels === null) throw new Error(`${n.case.id}: no reference`);
  const lines = new Map(ref.breaks.texts.map((t) => [t.id, t.lines]));
  const size = rasterSize(n.case.environment.viewport, dpr);
  return {
    ...d,
    device: { ...d.device, platform: target },
    nodes: d.nodes.map((x) => ({ ...x, lines: x.lines.map((l, j) => ({ ...l, start: lines.get(x.id)?.[j]?.[0] ?? null, end: lines.get(x.id)?.[j]?.[1] ?? null })) })),
    pixels: { capture: target === 'ios' ? 'drawHierarchy' : 'PixelCopy', colorSpace: 'sRGB', width: size.width, height: size.height, sha256: 'a'.repeat(64), samples: readSamples(ref.pixels, ref.points) },
  };
}

const LANE_OF: { readonly [C in NamedCheck]: readonly [DeviceCheckLane, FailureKind] } = { a: ['device-frames', 'frame-chrome'], b: ['device-applied', 'applied'], c: ['device-pixels', 'pixel'], d: ['device-frames', 'frame-engine'], breaks: ['device-lines', 'break-mismatch'] };

describe.each([['ios', 3], ['android', 2.625], ['android', 2]] as const)('device checks on %s at DPR %s', (target, dpr) => {
  const all = relabelledReferenceDumps(target, dpr);
  const sample = cases.filter((n, i) => i % 16 === 0 || n.case.id === 'text-wrap-spaces' || n.case.id === 'color-border-sides');
  const refs = new Map(sample.map((n) => [n.case.id, caseReference(target, n, dpr)]));
  const dumps = new Map(sample.map((n) => [n.case.id, perfectDump(target, dpr, n, refs.get(n.case.id) as CaseReference, all)]));
  it('a dump that carries the references passes every check, with every check compared', () => {
    for (const n of sample) {
      const o = evaluateCase(target, n, dpr, JSON.parse(JSON.stringify(dumps.get(n.case.id))), refs.get(n.case.id) as CaseReference);
      expect(o.failures, n.case.id).toEqual([]);
      expect(o.compared.a > 0 && o.compared.b > 0 && o.compared.c > 0 && o.compared.d > 0, n.case.id).toBe(true);
    }
  });
  it('no dump fails every lane as dump-missing; an invalid dump as dump-invalid', () => {
    const n = sample[0] as NativeCase;
    const ref = refs.get(n.case.id) as CaseReference;
    expect(evaluateCase(target, n, dpr, null, ref).failures.map((f) => [f.lane, f.kind])).toEqual([['device-frames', 'dump-missing'], ['device-applied', 'dump-missing'], ['device-lines', 'dump-missing'], ['device-pixels', 'dump-missing']]);
    expect(evaluateCase(target, n, dpr, { schema: 'x' }, ref).failures.every((f) => f.kind === 'dump-invalid')).toBe(true);
  });
  it.each([...DUMP_FAULTS])('planted %s is caught by its named check, in its lane, with its kind, on every dump it applies to', (fault: DumpFault) => {
    let applicable = 0;
    for (const n of sample) {
      const ref = refs.get(n.case.id) as CaseReference;
      const dump = dumps.get(n.case.id) as NativeDump;
      const clean = evaluateCase(target, n, dpr, dump, ref);
      const planted = plantDumpFault(fault, dump, { engine: ref.engine, passingSamples: clean.passingSamples });
      if (planted === null) continue;
      applicable++;
      const [lane, kind] = LANE_OF[FAULT_CHECK[fault]];
      const got = evaluateCase(target, n, dpr, planted, ref).failures;
      expect(got.some((f) => f.lane === lane && f.kind === kind), `${fault} on ${n.case.id}: ${JSON.stringify(got.slice(0, 3))}`).toBe(true);
    }
    expect(applicable).toBeGreaterThan(0);
  });
});

describe('dump provenance and unreadable files', () => {
  const n = cases.find((c) => c.case.id === 'text-wrap-spaces') as NativeCase;
  const ref = caseReference('ios', n, 3);
  const d = perfectDump('ios', 3, n, ref, relabelledReferenceDumps('ios', 3));
  it('a dump from another compile (a stale app) fails every lane as compiler-digest', () => {
    expect(evaluateCase('ios', n, 3, d, ref).failures).toEqual([]);
    const stale = { ...d, case: { ...d.case, compilerDigest: `${d.case.compilerDigest}0` } };
    expect(evaluateCase('ios', n, 3, stale, ref).failures.filter((f) => f.kind === 'compiler-digest').map((f) => f.lane)).toEqual(['device-frames', 'device-applied', 'device-lines', 'device-pixels']);
  });
  it('a truncated dump is dump-invalid for its case and the set goes on; capture trust names it', () => {
    const dir = join(nativeOut('ios'), 'test-unreadable');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const text = JSON.stringify(d);
    writeFileSync(dumpFile(dir, n.case.id, 3), text.slice(0, text.length / 2));
    const other = cases.find((c) => c.case.id === 'color-border-sides') as NativeCase;
    const otherRef = caseReference('ios', other, 3);
    writeFileSync(dumpFile(dir, other.case.id, 3), JSON.stringify(perfectDump('ios', 3, other, otherRef, relabelledReferenceDumps('ios', 3))));
    expect(readDump(dumpFile(dir, n.case.id, 3)).kind).toBe('unparseable');
    const record = { name: 'iPhone 17', target: 'ios' as const, model: 'x', os: 'x', build: 'x', profileScale: 3, appScale: 3, windowPx: [1206, 2622] as const, stagePx: [1206, 2334] as const, rootOriginPx: [0, 186] as const, textScale: 'UICTContentSizeCategoryL' };
    const set = evaluateSet('ios', 3, dir, record, [n, other]);
    expect(set.dumps).toBe(1);
    expect(set.failures.filter((f) => f.case === n.case.id).map((f) => f.kind)).toEqual(['dump-invalid', 'dump-invalid', 'dump-invalid', 'dump-invalid']);
    expect(set.failures.filter((f) => f.case === other.case.id)).toEqual([]);
    copyFileSync(expectedPixelsPath(n.case.id, 3), join(dir, `screen-${n.case.id}.png`));
    expect(captureTrust(dir, [trustCase(n, 3)], 3, [0, 0])[0]?.mismatches[0]).toMatch(/^the dump is not JSON/);
    rmSync(dir, { recursive: true, force: true });
  });
  it('a trust dump that is JSON but not a dump (null) is a capture-trust mismatch, not a crash', () => {
    const dir = join(nativeOut('ios'), 'test-trust-null');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(dumpFile(dir, n.case.id, 3), 'null');
    copyFileSync(expectedPixelsPath(n.case.id, 3), join(dir, `screen-${n.case.id}.png`));
    expect(captureTrust(dir, [trustCase(n, 3)], 3, [0, 0])[0]?.mismatches[0]).toMatch(/^the dump does not validate: /);
    rmSync(dir, { recursive: true, force: true });
  });
  it('a trust run that did not finish is a capture-trust failure even with no sample mismatch', () => {
    expect(trustFailuresOf([{ case: 'a', points: 3, mismatches: [] }], 3, 'iPhone 17', 'timed out')).toEqual([{ lane: 'device-pixels', case: '-', dpr: 3, node: null, kind: 'capture-trust', detail: 'iPhone 17: the capture-trust run did not finish: timed out' }]);
  });
  it('a dump that omits a line box counts only the lines the checks compared, never a negative node count', () => {
    const full = evaluateCase('ios', n, 3, d, ref).compared;
    const dropped = { ...d, nodes: d.nodes.map((x) => (x.id === 'w1:text0' ? { ...x, lines: x.lines.slice(0, 1) } : x)) };
    const o = evaluateCase('ios', n, 3, dropped, ref);
    expect(o.compared.a).toBe(full.a - 2);
    expect(o.compared.d).toBe(full.d - 2);
    expect(o.failures.some((f) => f.lane === 'device-lines')).toBe(true);
  });
  it('capture-trust mismatches become device-pixels failures of kind capture-trust', () => {
    expect(trustFailuresOf([{ case: 'a', points: 3, mismatches: ['m1', 'm2'] }, { case: 'b', points: 3, mismatches: [] }], 2, 'iPad (A16)')).toEqual([
      { lane: 'device-pixels', case: 'a', dpr: 2, node: null, kind: 'capture-trust', detail: 'iPad (A16): m1' },
      { lane: 'device-pixels', case: 'a', dpr: 2, node: null, kind: 'capture-trust', detail: 'iPad (A16): m2' },
    ]);
  });
});

describe('dump identity and malformed samples (round 6)', () => {
  const n = cases.find((c) => c.case.id === 'text-wrap-spaces') as NativeCase;
  const ref = caseReference('ios', n, 3);
  const d = perfectDump('ios', 3, n, ref, relabelledReferenceDumps('ios', 3));
  const kinds = (x: unknown) => [...new Set(evaluateCase('ios', n, 3, x, ref).failures.map((f) => f.kind))];
  it('case.dpr, the device platform, fixture, direction and viewport must be the case under test', () => {
    expect(kinds(d)).toEqual([]);
    expect(kinds({ ...d, case: { ...d.case, dpr: 2 } })).toContain('device-scale');
    expect(kinds({ ...d, device: { ...d.device, platform: 'android' } })).toContain('device-scale');
    expect(kinds({ ...d, case: { ...d.case, fixture: 'color-border-sides' } })).toContain('case-identity');
    expect(kinds({ ...d, case: { ...d.case, direction: 'rtl' } })).toContain('case-identity');
    expect(kinds({ ...d, case: { ...d.case, viewport: { width: 401, height: 300 } } })).toContain('case-identity');
  });
  it("the capture must be the target's compositor capture", () => {
    expect(kinds({ ...d, pixels: { ...(d.pixels as NonNullable<typeof d.pixels>), capture: 'PixelCopy' } })).toContain('capture-kind');
  });
  it('an unknown sample rule is a pixel failure, not a crash of the run', () => {
    const samples = (d.pixels as NonNullable<typeof d.pixels>).samples.map((s, i) => (i === 0 ? { ...s, rule: 'bogus:x' } : s));
    const o = evaluateCase('ios', n, 3, { ...d, pixels: { ...(d.pixels as NonNullable<typeof d.pixels>), samples } }, ref);
    expect(o.failures.some((f) => f.lane === 'device-pixels' && f.kind === 'pixel')).toBe(true);
    expect(o.passingSamples).not.toContain(0);
    expect(isSampleRule('bogus:x')).toBe(false);
    expect(isSampleRule('glyph:w1:text0:line0:0')).toBe(true);
    expect(isSampleRule('edge')).toBe(false);
  });
});

describe('build reuse', () => {
  it('the reuse stamp covers the bundled Ahem.ttf besides the source tree', () => {
    const ahem = createHash('sha256').update(readFileSync(repoPath('vendor/fonts/Ahem.ttf'))).digest('hex');
    expect(reuseStamp('abc')).toBe(`abc ahem ${ahem}`);
  });
});

describe('the node and line split of (a) and (d)', () => {
  it('line problems go to the line part, everything else to the node part, and nothing is lost', () => {
    const r = { pass: false, compared: 10, problems: ['w1:text0:line1: edge delta [1,0,0,0] css px exceeds 1 device px at DPR 3', 'w1: edge delta [1,0,0,0] css px exceeds 1 device px at DPR 3', 'w1:text0: the dump has 2 line boxes, the engine 3', 'capture DPR 2 is not the dump DPR 3'] };
    const s = splitByLines(r, 4);
    expect(s.lines.problems).toEqual([r.problems[0], r.problems[2]]);
    expect(s.nodes.problems).toEqual([r.problems[1], r.problems[3]]);
    expect([s.nodes.compared, s.lines.compared]).toEqual([6, 4]);
  });
  it('on a real split, an edge moved by 2 device px on one line fails only the line part', () => {
    const n = cases.find((c) => c.case.id === 'text-wrap-spaces') as NativeCase;
    const ref = caseReference('ios', n, 3);
    const d = perfectDump('ios', 3, n, ref, relabelledReferenceDumps('ios', 3));
    const moved = { ...d, nodes: d.nodes.map((x) => (x.id === 'w1:text0' ? { ...x, lines: x.lines.map((l, j) => (j === 1 ? { ...l, frame: { ...l.frame, width: l.frame.width + 1 } } : l)) } : x)) };
    const s = splitByLines(checkAgainstChrome(moved, ref.chrome), ref.chrome.nodes.filter((c) => c.kind === 'line').length);
    expect(s.nodes.problems).toEqual([]);
    expect(s.lines.problems[0]).toMatch(/^w1:text0:line1: edge delta/);
  });
});

const trustCase = (n: NativeCase, dpr: number): TrustCase => ({ id: n.case.id, points: casePoints(n.programs.uikit, n.case.environment.viewport, dpr), size: rasterSize(n.case.environment.viewport, dpr) });

describe('capture trust', () => {
  it('in-app samples equal the OS screenshot at the root offset; a one-row offset error is caught', () => {
    const dir = join(nativeOut('ios'), 'test-trust');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const n = cases.find((c) => c.case.id === 'color-border-sides') as NativeCase;
    const ref = caseReference('ios', n, 3);
    const d = perfectDump('ios', 3, n, ref, relabelledReferenceDumps('ios', 3));
    writeFileSync(dumpFile(dir, n.case.id, 3), JSON.stringify(d));
    copyFileSync(expectedPixelsPath(n.case.id, 3), join(dir, `screen-${n.case.id}.png`));
    const tc = trustCase(n, 3);
    const ok = captureTrust(dir, [tc], 3, [0, 0]);
    expect(ok[0]?.points).toBe(ref.points.length);
    expect(ok[0]?.mismatches).toEqual([]);
    expect(captureTrust(dir, [tc], 3, [0, 1])[0]?.mismatches.length).toBeGreaterThan(0);
    expect(captureTrust(dir, [trustCase(cases.find((c) => c.case.id === 'text-wrap-spaces') as NativeCase, 3)], 3, [0, 0])[0]?.mismatches).toEqual(['no dump']);
    rmSync(dir, { recursive: true, force: true });
  });
  it('the held dump must carry exactly the generated points, the raster size and the case: a host that drops, moves or swaps points fails', () => {
    const dir = join(nativeOut('ios'), 'test-trust-points');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const n = cases.find((c) => c.case.id === 'color-border-sides') as NativeCase;
    const ref = caseReference('ios', n, 3);
    const d = perfectDump('ios', 3, n, ref, relabelledReferenceDumps('ios', 3));
    const tc = trustCase(n, 3);
    copyFileSync(expectedPixelsPath(n.case.id, 3), join(dir, `screen-${n.case.id}.png`));
    const withSamples = (samples: typeof d.pixels extends null ? never : NonNullable<typeof d.pixels>['samples'], extra: Partial<NativeDump> = {}): readonly string[] => {
      writeFileSync(dumpFile(dir, n.case.id, 3), JSON.stringify({ ...d, ...extra, pixels: { ...(d.pixels as NonNullable<typeof d.pixels>), samples } }));
      return captureTrust(dir, [tc], 3, [0, 0])[0]?.mismatches ?? [];
    };
    const samples = (d.pixels as NonNullable<typeof d.pixels>).samples;
    expect(withSamples(samples)).toEqual([]);
    expect(withSamples(samples.slice(0, 1))[0]).toMatch(/^the dump has 1 samples, the generator \d+$/);
    expect(withSamples(samples.map((s, i) => (i === 3 ? { ...s, x: s.x + 1 } : s)))[0]).toMatch(/^sample 3 is .* the generator's is /);
    expect(withSamples(samples, { case: { ...d.case, id: 'text-wrap-spaces' } })[0]).toMatch(/^the dump is case text-wrap-spaces at DPR 3, not color-border-sides at 3$/);
    writeFileSync(dumpFile(dir, n.case.id, 3), JSON.stringify({ ...d, pixels: { ...(d.pixels as NonNullable<typeof d.pixels>), width: 1199 } }));
    expect(captureTrust(dir, [tc], 3, [0, 0])[0]?.mismatches).toEqual(['the in-app capture is 1199x900, the raster rule 1200x900']);
    rmSync(dir, { recursive: true, force: true });
  });
});
