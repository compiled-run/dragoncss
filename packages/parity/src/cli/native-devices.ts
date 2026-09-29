// pnpm run native:devices [-- --target ios|android] [-- --plant glyph-offset-1|dash-phase-1|dash-gap-unfitted] (notes/T015-p4-review-p5-plan.md section 4 items 1
// and 5). Without --plant: provisions and verifies the device matrix, one device at a time: boots it headless (emulators by
// serial), runs the app once, and prints the model, OS and build, the scale from the device profile and from the app, the window
// and stage in device px, the root's window offset and the text scale; any disagreement, a root that does not fit, or a text scale
// other than the pinned one fails. With --plant glyph-offset-1: builds the planted app (every glyph 1 device px right) and runs the
// plant case on each target's plant device; device-pixels must fail on glyph or edge rules while device-frames and device-lines pass.
import { SUPPORT_PLANTS } from 'dragon';
import type { SupportPlant } from 'dragon';
import { caseReference, dumpFile, evaluateCase, plantVerdict, readDump } from '../device-lanes.ts';
import type { DeviceSpec } from '../device-run.ts';
import { avdScale, boot, DEVICE_MATRIX, deviceProfile, deviceRecord, iosProfileScale, matrixProblems, PLANT_CASE, PLANT_CASES, PLANT_DEVICES, PLANT_RULES, recordProblems, release, runApp } from '../device-run.ts';
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

// The raster plant: pixels must see what (d) cannot, on the plant's cases (PLANT_CASES) and sample rules (PLANT_RULES).
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
