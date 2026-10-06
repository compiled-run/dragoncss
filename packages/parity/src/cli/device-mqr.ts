// MQ-R1 device proof (notes/T067-mq-r-spec.md R7): only the runtime's lanes, on every device of a target's matrix: the resize prefix
// scripts (device-states: frames, applied values, pixels and the environment record after every step) and the device-env rotation
// (portrait, landscape, back), each judged exactly as parity:lanes --run-device judges them. The full device run (every lane and
// case) stays the landing driver's; this is the proof the runtime's lanes pass before it lands. Prints every failure and writes
// out/native/<target>/lanes/mqr-<device>.json (not committed). Run only under the device lease:
//   /tmp/device-lease.sh pnpm run parity:device-mqr -- --target ios|android [--device <name>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BACKEND_OF, buildAndroid, buildIos, nativeOut } from '../native-host.ts';
import { boot, DEVICE_MATRIX, deviceProfile, deviceRecord, release, runApp } from '../device-run.ts';
import { ENV_IDS, envOracleBrowser, evaluateEnv } from '../device-env.ts';
import { evaluateStates, failuresByKind } from '../device-lanes.ts';
import type { DeviceSet } from '../device-lanes.ts';
import { casePoints, runFileText } from '../pixel-reference.ts';
import { resizeScriptCases } from '../resize-scripts.ts';
import type { NativeTarget } from '../targets.ts';

const args = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] ?? null);
};
const target = arg('--target');
if (target !== 'ios' && target !== 'android') {
  console.error('usage: parity:device-mqr -- --target ios|android [--device <name>]');
  process.exit(2);
}
const only = arg('--device');
const specs = DEVICE_MATRIX.filter((d) => d.target === target && (only === null || d.name === only));
if (specs.length === 0) {
  console.error(`no ${target} device ${only ?? ''} in the matrix`);
  process.exit(2);
}
const t: NativeTarget = target;
const build = t === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
for (const l of build.log) console.log(`${t} build: ${l}`);
const scripts = resizeScriptCases(t);
let failed = 0;
for (const spec of specs) {
  const h = await boot(spec);
  try {
    const prof = deviceProfile(h);
    const dpr = prof.profileScale;
    const base = join(nativeOut(t), 'lanes', `mqr-${spec.name.replace(/[^A-Za-z0-9-]+/g, '_')}`);
    const statesDir = `${base}-states`;
    const sr = await runApp(h, build.artifact, { runFile: runFileText(scripts.map((s) => ({ id: s.script.case.id, points: casePoints(s.end.programs[BACKEND_OF[t]], s.end.case.environment.viewport, dpr) })), false), caseCount: scripts.length, outDir: statesDir });
    const rec = deviceRecord(prof, sr.record);
    const states: DeviceSet = evaluateStates(t, dpr, statesDir, rec, scripts, sr.error === null ? [] : [{ lane: 'device-states', case: '-', dpr, node: null, kind: 'device-record', detail: `the host did not finish: ${sr.error}` }]);
    const envDir = `${base}-env`;
    const er = await runApp(h, build.artifact, { runFile: runFileText(ENV_IDS.map((id) => ({ id, points: [] })), false), caseCount: ENV_IDS.length, outDir: envDir });
    const oracle = await envOracleBrowser(dpr);
    let env: DeviceSet;
    try {
      env = await evaluateEnv(t, dpr, envDir, rec, oracle, er.error === null ? [] : [{ lane: 'device-env', case: '-', dpr, node: null, kind: 'device-record', detail: `the host did not finish the rotation: ${er.error}` }]);
    } finally {
      await oracle.close();
    }
    console.log(`${spec.name} (DPR ${dpr}): device-states resize ${states.dumps}/${states.cases} dumps, failures ${JSON.stringify(failuresByKind(states.failures))}; device-env ${env.dumps}/${env.cases} dumps, failures ${JSON.stringify(failuresByKind(env.failures))}`);
    for (const f of [...states.failures, ...env.failures]) console.log(`  FAIL ${f.lane} ${f.case} ${f.kind}${f.node === null ? '' : ` ${f.node}`}: ${f.detail}`);
    failed += states.failures.length + env.failures.length;
    const out = `${base}.json`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ device: spec.name, dpr, states, env }, null, 1)}\n`);
  } finally {
    await release(h, (l) => console.error(l));
  }
}
console.log(`parity:device-mqr ${t}: ${failed} failures over ${specs.map((s) => s.name).join(', ')}`);
process.exit(failed === 0 ? 0 : 1);
