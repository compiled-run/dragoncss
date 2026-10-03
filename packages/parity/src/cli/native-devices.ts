// pnpm run native:devices [-- --target ios|android] [-- --plant <SUPPORT_PLANTS>]
// (notes/T015-p4-review-p5-plan.md section 4 items 1 and 5; T093 ruling A and addendum). Without --plant: provisions and verifies
// the device matrix, one device at a time: boots it headless (emulators by serial), runs the app once, and prints the model, OS and
// build, the scale from the device profile and from the app, the window and stage in device px, the root's window offset and the
// text scale; any disagreement, a root that does not fit, or a text scale other than the pinned one fails. With a glyph --plant:
// runs the plant case on each target's plant device twice, with the clean app and with the planted one (every glyph 1 device px
// right, or down), and judges the plant against the clean run (judgeGlyphPlant): both hosts finished; the clean run has no
// device-pixels failure; on the plant's axis every line's glyph position (the x centre, or the bottom edge) fails the position
// check by PLANT_MARGIN_DEVICE_PX or more and moved PLANT_SHIFT_DEVICE_PX within the spread; and device-frames and device-lines
// pass in both runs. A paint plant (P6a dash, PNT1 radius and shadow) runs its cases (PLANT_CASES) once with the planted app: device-pixels must fail on its
// sample rules (PLANT_RULES) while device-frames and device-lines pass (plantVerdict).
import { SUPPORT_PLANTS } from 'dragon';
import type { SupportPlant } from 'dragon';
import { GATE_GLYPH_POSITION_DEVICE_PX } from '../compare.ts';
import { caseReference, dumpFile, evaluateCase, plantVerdict, readDump } from '../device-lanes.ts';
import type { DeviceSpec } from '../device-run.ts';
import { avdScale, boot, DEVICE_MATRIX, deviceProfile, deviceRecord, iosProfileScale, isGlyphPlant, judgeGlyphPlant, matrixProblems, PLANT_AXIS, PLANT_CASE, PLANT_CASES, PLANT_DEVICES, PLANT_RULES, recordProblems, release, runApp } from '../device-run.ts';
import { glyphPositions } from '../native-compare.ts';
import { validateNativeDump } from '../native-dump.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_OF, buildAndroid, buildIos, nativeCases, nativeOut } from '../native-host.ts';
import { casePoints, rasterSize, runFileText } from '../pixel-reference.ts';
import type { NativeTarget } from '../targets.ts';

const args = process.argv.slice(2);
const targetAt = args.indexOf('--target');
const onlyArg = targetAt < 0 ? null : (args[targetAt + 1] ?? '');
if (onlyArg !== null && onlyArg !== 'ios' && onlyArg !== 'android') {
  console.error(`native:devices: --target takes ios or android, not ${JSON.stringify(onlyArg)}`);
  process.exit(2);
}
const only: NativeTarget | null = onlyArg;
const plant = args.includes('--plant') ? (args[args.indexOf('--plant') + 1] as SupportPlant) : null;
if (plant !== null && !SUPPORT_PLANTS.includes(plant)) throw new Error(`--plant takes one of ${SUPPORT_PLANTS.join(', ')}`);
const targets: NativeTarget[] = (['ios', 'android'] as const).filter((t) => only === null || t === only);
const log = (s: string): void => console.log(`native:devices: ${s}`);

const scaleOf = (d: DeviceSpec): number => (d.target === 'ios' ? iosProfileScale(d.name) : avdScale(d));
const matrix = matrixProblems(scaleOf, DEVICE_MATRIX, targets);
for (const p of matrix) console.log(`native:devices: MATRIX ${p}`);
let failures = matrix.length;
const cases = nativeCases();

if (plant === null) {
  for (const target of targets) {
    const build = target === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
    const probe = cases.filter((n) => n.case.id === PLANT_CASE);
    for (const spec of DEVICE_MATRIX.filter((d) => d.target === target)) {
      const h = await boot(spec);
      try {
        const prof = deviceProfile(h);
        const r = await runApp(h, build.artifact, { runFile: runFileText(probe.map((n) => ({ id: n.case.id, points: [] })), false), caseCount: probe.length, outDir: join(nativeOut(target), 'devices', spec.name) });
        const rec = deviceRecord(prof, r.record);
        const root = rasterSize(probe[0]?.case.environment.viewport ?? { width: 0, height: 0 }, prof.profileScale);
        log(`${target} ${spec.name}: ${rec.model}; ${rec.os}; build ${rec.build}; scale ${rec.profileScale} (device profile: ${target === 'ios' ? 'capabilities.plist' : 'wm density'}) / ${rec.appScale} (app: ${target === 'ios' ? 'UIScreen.scale' : 'displayMetrics.density'}); window ${rec.windowPx.join('x')} px; stage ${rec.stagePx.join('x')} px at ${rec.rootOriginPx.join(',')}; root ${root.width}x${root.height} px; text scale ${rec.textScale}${r.error === null ? '' : `; host error ${r.error}`}`);
        if (r.error !== null) {
          failures++;
          log(`FAIL ${spec.name}: the host did not finish: ${r.error}`);
        }
        for (const p of recordProblems(rec, root)) {
          failures++;
          log(`FAIL ${p}`);
        }
      } finally {
        await release(h);
      }
    }
  }
  log(`status ${failures === 0 ? 'pass' : 'fail'} (${failures} problem(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

// A paint plant (P6a): pixels must see what (d) cannot, on the plant's cases (PLANT_CASES) and sample rules (PLANT_RULES).
if (!isGlyphPlant(plant)) {
  for (const target of targets) {
    const build = target === 'ios' ? buildIos({ reuse: true, plant }) : buildAndroid({ reuse: true, plant });
    const spec = DEVICE_MATRIX.find((d) => d.name === PLANT_DEVICES[target]);
    if (spec === undefined) throw new Error(`no plant device ${PLANT_DEVICES[target]}`);
    const ns = PLANT_CASES[plant].map((id) => {
      const n = cases.find((c) => c.case.id === id);
      if (n === undefined) throw new Error(`no case ${id}`);
      return n;
    });
    const h = await boot(spec);
    try {
      const dpr = deviceProfile(h).profileScale;
      const dir = join(nativeOut(target), 'devices', `${spec.name}-${plant}`);
      const r = await runApp(h, build.artifact, { runFile: runFileText(ns.map((n) => ({ id: n.case.id, points: casePoints(n.programs[BACKEND_OF[target]], n.case.environment.viewport, dpr) })), false), caseCount: ns.length, outDir: dir });
      if (r.error !== null) log(`${target} ${spec.name} @${dpr} ${plant}: FAIL the host did not finish: ${r.error}`);
      const all = ns.flatMap((n) => {
        const read = readDump(dumpFile(dir, n.case.id, dpr));
        const raw = read.kind === 'ok' ? read.raw : read.kind === 'unparseable' ? { unparseable: read.detail } : null;
        return evaluateCase(target, n, dpr, raw, caseReference(target, n, dpr)).failures;
      });
      for (const f of all) log(`${target} ${spec.name} @${dpr} ${plant}: ${f.case} ${f.lane} ${f.kind} ${f.node ?? ''}: ${f.detail}`);
      const v = plantVerdict(all, r.error, PLANT_RULES[plant]);
      log(`${target} ${spec.name} @${dpr} ${plant} on ${PLANT_CASES[plant].join(', ')}: device-pixels ${v.pixels} failures (${v.inked} on ${PLANT_RULES[plant].source} rules); device-frames ${v.frames}, device-lines ${v.lines} failures${r.error === null ? '' : '; the host did not finish'}: plant ${v.caught ? 'CAUGHT' : 'NOT CAUGHT'}`);
      if (!v.caught) failures++;
    } finally {
      await release(h);
    }
  }
  log(`plant ${plant}: status ${failures === 0 ? 'pass' : 'fail'}`);
  process.exit(failures === 0 ? 0 : 1);
}

// The raster plant, judged against the clean run on the same device: pixels must see what (d) cannot.
for (const target of targets) {
  const clean = target === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
  const build = target === 'ios' ? buildIos({ reuse: true, plant }) : buildAndroid({ reuse: true, plant });
  const spec = DEVICE_MATRIX.find((d) => d.name === PLANT_DEVICES[target]);
  if (spec === undefined) throw new Error(`no plant device ${PLANT_DEVICES[target]}`);
  const n = cases.find((c) => c.case.id === PLANT_CASE);
  if (n === undefined) throw new Error(`no case ${PLANT_CASE}`);
  const h = await boot(spec);
  try {
    const dpr = deviceProfile(h).profileScale;
    const ref = caseReference(target, n, dpr);
    if (ref.pixels === null) throw new Error(`no committed Chrome PNG of ${PLANT_CASE}@${dpr}`);
    const chrome = ref.pixels;
    const runOne = async (artifact: string, label: string) => {
      const dir = join(nativeOut(target), 'devices', `${spec.name}-${label}`);
      const r = await runApp(h, artifact, { runFile: runFileText([{ id: n.case.id, points: ref.points }], false), caseCount: 1, outDir: dir });
      if (r.error !== null) log(`${target} ${spec.name} @${dpr} ${label}: FAIL the host did not finish: ${r.error}`);
      const read = readDump(dumpFile(dir, n.case.id, dpr));
      const raw = read.kind === 'ok' ? read.raw : read.kind === 'unparseable' ? { unparseable: read.detail } : null;
      const o = evaluateCase(target, n, dpr, raw, ref);
      const v = raw === null ? null : validateNativeDump(raw);
      const centres = v !== null && v.ok && v.dump.pixels !== null ? glyphPositions(v.dump.pixels.samples, chrome) : [];
      const of = (lane: string) => o.failures.filter((f) => f.lane === lane);
      for (const lane of ['device-pixels', 'device-frames', 'device-lines', 'device-applied']) for (const f of of(lane)) log(`${target} ${spec.name} @${dpr} ${label}: ${lane} ${f.kind} ${f.node ?? ''}: ${f.detail}`);
      return { of, centres, hostError: r.error };
    };
    const base = await runOne(clean.artifact, 'clean');
    const planted = await runOne(build.artifact, plant);
    const frames = planted.of('device-frames').length + base.of('device-frames').length;
    const lines = planted.of('device-lines').length + base.of('device-lines').length;
    const hostErrors = [base, planted].flatMap((run, i) => (run.hostError === null ? [] : [`the ${i === 0 ? 'clean' : 'planted'} host did not finish: ${run.hostError}`]));
    const verdict = judgeGlyphPlant(plant, { failures: base.of('device-pixels').length, centres: base.centres }, planted.centres, GATE_GLYPH_POSITION_DEVICE_PX, { hostErrors, frames, lines });
    for (const l of verdict.lines) log(`${target} ${spec.name} @${dpr} ${plant}: ${l.line} ${PLANT_AXIS[plant] === 'x' ? 'x centre' : 'bottom edge'} Chrome ${l.chrome.toFixed(3)}, clean ${l.clean.toFixed(3)}, planted ${l.planted.toFixed(3)}: shift ${(l.planted - l.clean).toFixed(3)}, error ${(l.planted - l.chrome).toFixed(3)} (gate ${GATE_GLYPH_POSITION_DEVICE_PX})`);
    for (const p of verdict.problems) log(`${target} ${spec.name} @${dpr} ${plant}: ${p}`);
    const caught = verdict.caught;
    log(`${target} ${spec.name} @${dpr} ${plant} on ${PLANT_CASE}: clean device-pixels ${base.of('device-pixels').length} failures; planted device-pixels ${planted.of('device-pixels').length} failures, ${verdict.lines.length} ${PLANT_AXIS[plant]} position lines judged; device-frames ${frames}, device-lines ${lines} failures: plant ${caught ? 'CAUGHT' : 'NOT CAUGHT'}`);
    if (!caught) failures++;
  } finally {
    await release(h);
  }
}
log(`plant ${plant}: status ${failures === 0 ? 'pass' : 'fail'}`);
process.exit(failures === 0 ? 0 : 1);
