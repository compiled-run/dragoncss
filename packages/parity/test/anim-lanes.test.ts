// T065 ANIM-b1 part 2: the device-anim lane on the host, with fake device dumps (the device run is the landing driver's). Every frame
// sample targets.ts declares is a sample the frame scripts dump; a sample's dump built from its frame-applied program passes the
// frames and applied checks against Chrome's frame capture, a dump of another sample fails them, a missing one fails as missing,
// and pixels and line breaks, which have no per-sample Chrome reference, are not judged. The settled sample of every frame case is
// its end assignment's static program (the R16 oracle). The host apps carry one sample case per sample.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NativeDump } from '../src/native-dump.ts';
import { emitFrameScripts, expectedDigest, expectedDump, programAt, programInput, StateRuntime } from 'dragon';
import type { FrameSampleCase } from '../src/anim-lanes.ts';
import { evaluateAnim, frameCaseEmits, frameRuns, frameSampleCases, sampleId } from '../src/anim-lanes.ts';
import { frameEmits, frameStateProgram } from '../src/anim-cases.ts';
import { ANIM_LANE } from '../src/device-lanes.ts';
import type { DeviceRecord } from '../src/device-run.ts';
import { referenceDump } from '../src/native-compare.ts';
import { BACKEND_OF, engineBoxes, expectedEngine } from '../src/native-host.ts';
import { stateEmits } from '../src/state-cases.ts';
import { frameSampleIds } from '../src/targets.ts';

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragon-anim-'));
});
afterAll(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

const DPR = 2;
const device = { name: 'fake', platform: 'ios', os: 'host', build: 'host', profileScale: DPR, appScale: DPR, windowPx: [0, 0], stagePx: [0, 0], rootOriginPx: [0, 0], textScale: 'none' } as unknown as DeviceRecord;
const samples = frameSampleCases();

/** A fake device dump of sample s, built from sample `from`'s frame-applied program (the device's own when from is s). */
function write(at: string, s: FrameSampleCase, from: FrameSampleCase): void {
  const p = from.sample.programs[BACKEND_OF.ios];
  const viewport = s.sample.case.environment.viewport;
  const ref = referenceDump({ platform: 'ios', caseId: s.sample.case.id, fixture: s.sample.spec.id, dpr: DPR, direction: s.sample.case.environment.direction, compilerDigest: s.sample.compiled.digest, input: programInput(p, viewport, DPR), engine: engineBoxes(p, viewport, DPR) });
  const e = expectedDump(p, s.sample.case.id, viewport, DPR, expectedEngine());
  const applied = new Map(e.nodes.map((x) => [x.id, x.applied]));
  const dump = { ...ref, lane: 'ios-sim', case: { ...ref.case, expectedDigest: expectedDigest(e) }, device: { platform: 'ios', os: 'host', model: 'none', abi: 'host', scale: DPR, toolchain: 'host', renderer: 'none' }, nodes: ref.nodes.map((x) => ({ ...x, native: e.nodes.find((y) => y.id === x.id)?.native ?? x.native, applied: applied.get(x.id) ?? {}, lines: x.lines.map((l, j) => ({ ...l, baseline: l.frame.height * 0.8, start: 3 * j, end: 3 * j + 2 })) })), pixels: { capture: 'drawHierarchy', colorSpace: 'sRGB', width: 1, height: 1, sha256: 'x', samples: [] }, timing: { settleMs: 1, dumpMs: 1 } } as unknown as NativeDump;
  writeFileSync(join(at, `${s.sample.case.id}@${DPR}.json`), JSON.stringify(dump));
}

describe('device-anim: the frame samples', () => {
  it('are the samples targets.ts declares from the committed frame captures, one per dump of each frame script', () => {
    // The lane's declared ids are in capture directory order, the samples in frame case order: the same set, each once.
    expect(samples.map((s) => s.sample.case.id).sort()).toEqual([...frameSampleIds()].sort());
    expect(new Set(frameSampleIds()).size).toBe(frameSampleIds().length);
    for (const r of frameRuns('uikit')) expect(r.steps.filter((x) => x.kind === 'dump').length, r.c.id).toBe(r.programs.length);
    expect(samples.length).toBeGreaterThan(0);
  });

  it('end, settled, on the end assignment\'s static program wherever nothing still animates (R16), on both backends', () => {
    let checked = 0;
    for (const backend of ['uikit', 'android-views'] as const) {
      for (const r of frameRuns(backend)) {
        const sp = frameStateProgram(r.c, backend);
        const rt = new StateRuntime(sp);
        for (const s of r.steps) if (s.kind === 'set') for (const x of s.sets) rt.set(x.state, x.value);
        const last = r.programs[r.programs.length - 1];
        const frame = r.frames[r.frames.length - 1];
        if (last === undefined || frame === undefined) throw new Error(`${r.c.id}: no dumps`);
        // An infinite or paused animation still writes its value at the settle; only a settled frame must equal the static program.
        if (frame.size > 0) continue;
        checked++;
        expect(JSON.stringify(last), `${r.c.id} ${backend}`).toBe(JSON.stringify(programAt(sp, rt.assignment)));
      }
    }
    expect(checked).toBeGreaterThan(10);
  }, 600_000);
});

describe('device-anim on fake dumps', () => {
  const some = samples.filter((s) => s.caseId === 'anim-color-all@400x300');

  it('passes every sample whose dump is its own frame-applied program\'s, failures under device-anim only', () => {
    const at = join(dir, 'own');
    mkdirSync(at);
    for (const s of some) write(at, s, s);
    const set = evaluateAnim('ios', DPR, at, device, some);
    expect(set.dumps).toBe(some.length);
    expect(set.failures.map((f) => `${f.case} ${f.kind} ${f.detail}`)).toEqual([]);
  });

  it('fails a sample dumped from a different sample of a moving case, and a missing dump, under device-anim', () => {
    const at = join(dir, 'moved');
    mkdirSync(at);
    const moving = samples.filter((s) => s.caseId === 'anim-layout-margin@393x852');
    const first = moving[0];
    const last = moving[moving.length - 1];
    if (first === undefined || last === undefined || moving.length < 2) throw new Error('anim-layout-margin has fewer than two samples');
    write(at, last, first);
    const set = evaluateAnim('ios', DPR, at, device, [last, first]);
    expect(set.failures.every((f) => f.lane === ANIM_LANE)).toBe(true);
    expect(set.failures.some((f) => f.case === last.sample.case.id && (f.kind === 'frame-chrome' || f.kind === 'applied'))).toBe(true);
    expect(set.failures.some((f) => f.case === first.sample.case.id && f.kind === 'dump-missing')).toBe(true);
    // Pixels and line breaks have no per-sample reference: never judged.
    expect(set.failures.some((f) => f.kind === 'pixel' || f.kind === 'break-mismatch')).toBe(false);
  });
});

describe('the host apps\' frame samples', () => {
  it('emit one sample case per dump, each frame case on the machine of its own entry in the host\'s state program list', () => {
    const programs = [...stateEmits('ios'), ...frameEmits('ios')];
    const frames = frameCaseEmits('ios', programs);
    const files = emitFrameScripts('uikit', frames);
    const table = files.find((f) => f.path === 'Cases/DragonFrameCaseTable.swift')?.text ?? '';
    expect(files.length).toBe(frames.length + 1);
    expect((table.match(/dragonFrames\d+Sample\d+/g) ?? []).length).toBe(samples.length);
    expect(frames.length).toBeGreaterThan(1);
    frames.forEach((f, k) => {
      const m = Number(/^dragonStates(\d+)$/.exec(f.machine)?.[1]);
      expect(programs[m]?.id, f.id).toBe(f.id);
      expect(programs[m]?.anim, f.id).toBeDefined();
      expect(files[k]?.text, f.id).toContain(`DragonFrameScript(make: ${f.machine}Machine, steps: [`);
    });
    expect(files[0]?.text).toContain(`dragonFrameSample(id: "${sampleId(frames[0]?.id ?? '', 0)}"`);
    // A reordered list moves each script with its case; a list without a frame case's program, or with it twice, is refused.
    const reordered = frameCaseEmits('ios', [...programs].reverse());
    expect(reordered.map((f) => f.machine)).toEqual(frames.map((f) => `dragonStates${programs.length - 1 - Number(f.machine.slice('dragonStates'.length))}`));
    expect(() => frameCaseEmits('ios', programs.slice(0, -1))).toThrow(/0 state programs with animation tables carry this frame case, not 1/);
    expect(() => frameCaseEmits('ios', [...programs, ...frameEmits('ios').slice(0, 1)])).toThrow(/2 state programs with animation tables carry this frame case, not 1/);
    const androidPrograms = [...stateEmits('android'), ...frameEmits('android')];
    const kotlin = emitFrameScripts('android-views', frameCaseEmits('android', androidPrograms));
    expect(kotlin[0]?.text).toContain(`DragonFrameScript(::dragonStates${stateEmits('android').length}Machine, listOf(`);
    expect(() => emitFrameScripts('uikit', [{ ...(frames[0] as (typeof frames)[number]), samples: [] }])).toThrow(/dump steps for 0 samples/);
  }, 600_000);
});
