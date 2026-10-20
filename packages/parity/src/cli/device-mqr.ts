// MQ-R1 and MQ-R2 device proof (notes/T067-mq-r-spec.md R7, R9): only the runtime's lanes, on every device of a target's matrix:
// the resize prefix scripts, the media-environment ones included (device-states: frames, applied values, pixels and the environment
// record after every step), and device-env (the rotation's portrait, landscape and back phases; on Android the OS's reduced-motion
// setting on and off), each judged exactly as parity:lanes --run-device judges them. The full device run (every lane and case)
// stays the landing driver's; this is the proof the runtime's lanes pass before it lands. Prints every failure and writes
// out/native/<target>/lanes/mqr-<device>.json (not committed). With --plant reduced-motion-transition-scale (Android), runs
// device-env alone on the planted app, which must fail only on the motion phase's readings. Run only under the device lease:
//   /tmp/device-lease.sh pnpm run parity:device-mqr -- --target ios|android [--device <name>] [--plant <media plant>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildAndroid, buildIos, nativeOut } from '../native-host.ts';
import type { MediaPlant } from '../device-run.ts';
import { boot, DEVICE_MATRIX, deviceProfile, deviceRecord, release, runApp } from '../device-run.ts';
import { envOracleBrowser, evaluateEnv } from '../device-env.ts';
import { evaluateStates, failuresByKind, runEnv } from '../device-lanes.ts';
import type { DeviceSet } from '../device-lanes.ts';
import { runFileText } from '../pixel-reference.ts';
import { resizeScriptCases } from '../resize-scripts.ts';
import type { NativeTarget } from '../targets.ts';

const args = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] ?? null);
};
const target = arg('--target');
const plantArg = arg('--plant');
if ((target !== 'ios' && target !== 'android') || (plantArg !== null && (plantArg !== 'reduced-motion-transition-scale' || target !== 'android'))) {
  console.error('usage: parity:device-mqr -- --target ios|android [--device <name>] [--plant reduced-motion-transition-scale (android)]');
  process.exit(2);
}
const plant: MediaPlant | null = plantArg === null ? null : 'reduced-motion-transition-scale';
const only = arg('--device');
const specs = DEVICE_MATRIX.filter((d) => d.target === target && (only === null || d.name === only));
if (specs.length === 0) {
  console.error(`no ${target} device ${only ?? ''} in the matrix`);
  process.exit(2);
}
const t: NativeTarget = target;
const build = t === 'ios' ? buildIos({ reuse: true, plant }) : buildAndroid({ reuse: true, plant });
for (const l of build.log) console.log(`${t} build: ${l}`);
const scripts = resizeScriptCases(t);
let failed = 0;
let caught = 0;
for (const spec of specs) {
  const h = await boot(spec);
  try {
    const prof = deviceProfile(h);
    const dpr = prof.profileScale;
    const base = join(nativeOut(t), 'lanes', `mqr-${spec.name.replace(/[^A-Za-z0-9-]+/g, '_')}${plant === null ? '' : `-${plant}`}`);
    let states: DeviceSet | null = null;
    let rec = null;
    if (plant === null) {
      const statesDir = `${base}-states`;
      // A resize step script samples the points of its program at this DPR (its reference).
      const sr = await runApp(h, build.artifact, { runFile: runFileText(scripts.map((s) => ({ id: s.script.case.id, points: s.reference(dpr).points })), false), caseCount: scripts.length, outDir: statesDir });
      rec = deviceRecord(prof, sr.record);
      states = evaluateStates(t, dpr, statesDir, rec, scripts, sr.error === null ? [] : [{ lane: 'device-states', case: '-', dpr, node: null, kind: 'device-record', detail: `the host did not finish: ${sr.error}` }]);
    }
    const envDir = `${base}-env`;
    const er = await runEnv(h, build.artifact, t, envDir);
    rec ??= deviceRecord(prof, er.record);
    const oracle = await envOracleBrowser(dpr);
    let env: DeviceSet;
    try {
      env = await evaluateEnv(t, dpr, envDir, rec, oracle, er.error === null ? [] : [{ lane: 'device-env', case: '-', dpr, node: null, kind: 'device-record', detail: `the host did not finish device-env: ${er.error}` }]);
    } finally {
      await oracle.close();
    }
    if (states !== null) console.log(`${spec.name} (DPR ${dpr}): device-states resize ${states.dumps}/${states.cases} dumps, failures ${JSON.stringify(failuresByKind(states.failures))}`);
    console.log(`${spec.name} (DPR ${dpr}): device-env ${env.dumps}/${env.cases} dumps, failures ${JSON.stringify(failuresByKind(env.failures))}`);
    for (const f of [...(states?.failures ?? []), ...env.failures]) console.log(`  FAIL ${f.lane} ${f.case} ${f.kind}${f.node === null ? '' : ` ${f.node}`}: ${f.detail}`);
    if (plant === null) failed += (states?.failures.length ?? 0) + env.failures.length;
    else {
      // The planted reading misses the OS setting: the motion phase's readings (and so its band) fail, and nothing else does.
      const motion = env.failures.filter((f) => f.case.endsWith('~env~motion') && f.kind === 'environment');
      const other = env.failures.filter((f) => !(f.case.endsWith('~env~motion') && (f.kind === 'environment' || f.kind === 'applied' || f.kind === 'frame-engine')));
      const ok = motion.length > 0 && other.length === 0 && er.error === null;
      console.log(`${spec.name} (DPR ${dpr}) plant ${plant}: ${motion.length} environment failures on the motion phase, ${other.length} elsewhere: plant ${ok ? 'CAUGHT' : 'NOT CAUGHT'}`);
      if (ok) caught++;
      else failed++;
    }
    const out = `${base}.json`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ device: spec.name, dpr, plant, states, env }, null, 1)}\n`);
  } finally {
    await release(h, (l) => console.error(l));
  }
}
console.log(`parity:device-mqr ${t}${plant === null ? '' : ` --plant ${plant}`}: ${plant === null ? `${failed} failures` : `caught on ${caught}/${specs.length} devices`} over ${specs.map((s) => s.name).join(', ')}`);
process.exit(failed === 0 ? 0 : 1);
