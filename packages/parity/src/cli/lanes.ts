// pnpm run parity:lanes [-- --run-host] [-- --run-device] [-- --target ios|android] [-- --require-all] [-- --plant <fault>]
// (docs/research/native-strategy.md 3.6; notes/T015-p4-review-p5-plan.md section 4 item 7). Without a run flag it checks parity and
// reads the committed out/lanes.json. --run-host runs the host engine lanes through native:swift and native:kotlin and the reference
// proof; --run-device runs the device lanes of each target on its simulators or emulators, one device at a time (device-lanes.ts),
// every failure printed and written to out/device-failures-<target>.json. Either rewrites out/lanes.json, keeping the committed
// records of lanes not run now when they still describe the configuration. --target limits --run-device to one target.
import { writeFileSync } from 'node:fs';
import { failuresByKind } from '../device-lanes.ts';
import { runTargetOnDevices } from '../device-lanes.ts';
import type { DeviceRun, LaneFault, LanesFile } from '../lanes.ts';
import { checkLaneParity, LANE_FAULTS, LANES_JSON, lanesFile, laneSources, notPassed, plantLaneFault, readLanesFile, referenceProof, runHostLane, staleLanes, writeLanesFile } from '../lanes.ts';
import { repoPath } from '../paths.ts';
import type { NativeTarget } from '../targets.ts';
import { nativeTargets } from '../targets.ts';
import type { HostRun } from '../lanes.ts';

const args = process.argv.slice(2);
const runHost = args.includes('--run-host');
const runDevice = args.includes('--run-device');
const only = args.includes('--target') ? (args[args.indexOf('--target') + 1] as NativeTarget) : null;
const requireAll = args.includes('--require-all');
const plantAt = args.indexOf('--plant');

const targets = nativeTargets();
const sources = laneSources();
const problems = checkLaneParity(targets, sources);

if (plantAt >= 0) {
  const fault = args[plantAt + 1] as LaneFault;
  if (!(LANE_FAULTS as readonly string[]).includes(fault)) throw new Error(`--plant takes one of ${LANE_FAULTS.join(', ')}`);
  if (problems.length > 0) {
    console.log(`parity:lanes: the configuration already fails, so a planted fault proves nothing:\n  ${problems.join('\n  ')}`);
    process.exit(2);
  }
  const planted = plantLaneFault(fault, targets, sources);
  const caught = checkLaneParity(planted.targets, planted.sources);
  if (caught.length === 0) {
    console.log(`parity:lanes --plant ${fault}: NOT caught; the check cannot tell this fault from a correct configuration`);
    process.exit(0);
  }
  console.log(`parity:lanes --plant ${fault}: caught (${caught.length} problem(s)):\n  ${caught.join('\n  ')}`);
  process.exit(1);
}

let file: LanesFile;
let exit = 0;
if (runHost || runDevice) {
  const committed = readLanesFile();
  const host = new Map<NativeTarget, HostRun>();
  let reference: ReturnType<typeof referenceProof> | null = null;
  if (runHost) {
    for (const t of targets) host.set(t.target, await runHostLane(t));
    reference = referenceProof(targets);
    for (const r of reference) for (const row of r.rows) for (const f of row.failures.slice(0, 20)) console.log(`REFERENCE FAIL ${r.target} ${f}`);
    if (reference.some((r) => r.rows.some((row) => row.failures.length > 0))) exit = 1;
  }
  const device = new Map<NativeTarget, DeviceRun>();
  if (runDevice) {
    for (const t of targets) {
      if (only !== null && t.target !== only) continue;
      const hostRun = host.get(t.target) ?? hostOf(committed, t.target);
      const d = await runTargetOnDevices(t, hostRun, (l) => console.log(`parity:lanes --run-device ${t.target}: ${l}`));
      device.set(t.target, d);
      const all = d.sets.flatMap((s) => s.failures);
      writeFileSync(repoPath(`packages/parity/out/device-failures-${t.target}.json`), `${JSON.stringify(all, null, 1)}\n`);
      for (const f of all) console.log(`DEVICE FAIL ${t.target} ${f.lane} ${f.case}@${f.dpr} ${f.kind}${f.node === null ? '' : ` ${f.node}`}: ${f.detail}`);
      console.log(`parity:lanes --run-device ${t.target}: ${all.length} failures ${JSON.stringify(failuresByKind(all))} (listed in packages/parity/out/device-failures-${t.target}.json)`);
      for (const s of d.sets) for (const r of s.faults) console.log(`  dump fault ${r.fault} (check ${r.check}) at DPR ${s.dpr}: caught ${r.caught}/${r.applicable} real dumps${r.uncaught.length === 0 ? '' : `; UNCAUGHT in ${r.uncaught.join(', ')}`}`);
      for (const tr of d.trust) for (const row of tr.rows) for (const m of row.mismatches) console.log(`  CAPTURE TRUST FAIL ${tr.device} ${row.case}: ${m}`);
    }
  }
  file = lanesFile(targets, problems, host, reference, device, committed);
  writeLanesFile(file);
} else {
  const committed = readLanesFile();
  if (committed === null) {
    console.log(`parity:lanes: ${LANES_JSON} is absent; host lanes are not run (pnpm run parity:lanes -- --run-host)`);
    file = lanesFile(targets, problems, new Map(), null);
  } else {
    const stale = staleLanes(committed, targets);
    for (const s of stale) console.log(`STALE ${s}`);
    if (stale.length > 0) exit = 1;
    file = committed;
  }
}

for (const t of file.targets) {
  console.log(`${t.target} (device DPRs ${t.dprs.join(', ')}; projection ${t.projection}):`);
  for (const l of t.lanes) {
    const sets = l.sets.map((s) => `${s.dpr}${s.extra === null ? '' : ` ${s.extra}`}: ${s.cases}`).join(', ');
    const run = l.run === null ? '' : `; ${l.run.suites.map((s) => `${s.corpus}/${s.suite} ${s.pass ?? '-'}/${s.total ?? '-'} (declared ${s.declared})`).join(', ')}; digests ${l.run.digests.p1 ?? '-'} ${l.run.digests.extended ?? '-'}; ${l.run.toolchain ?? 'no toolchain'}`;
    console.log(`  ${l.lane}: ${l.state}${l.reason === null ? '' : ` (${l.reason})`}; cases [${sets}] + corpora ${l.corpora.reduce((n, c) => n + c.cases, 0)} = ${l.totalCases}${run}`);
    for (const s of l.device?.sets ?? []) console.log(`    DPR ${s.dpr} on ${s.device.name} (${s.device.os}, build ${s.device.build}; scale ${s.device.profileScale}/${s.device.appScale}): ${s.dumps}/${s.cases} dumps; compared a ${s.compared.a}, b ${s.compared.b}, c ${s.compared.c}, d ${s.compared.d}, breaks ${s.compared.breaks}; failures ${s.failures} ${JSON.stringify(s.failuresByKind)}`);
    for (const tr of l.device?.trust ?? []) console.log(`    capture trust on ${tr.device} (DPR ${tr.dpr}): ${tr.points - tr.mismatches}/${tr.points} points over ${tr.cases} cases`);
    if (l.state === 'fail') exit = 1;
  }
  for (const r of t.dumpFaults ?? []) console.log(`  dump faults at DPR ${r.dpr}: ${r.rows.map((x) => `${x.fault} ${x.caught}/${x.applicable}`).join(', ')}`);
  for (const r of t.referenceProof ?? []) console.log(`  reference proof DPR ${r.dpr} (${r.role}): ${r.cases} cases, ${r.valid} valid dumps, (a) ${r.chrome}/${r.cases} (${r.chromeCompared} nodes and lines), (d) ${r.engine}/${r.cases} (${r.engineCompared} nodes and lines)`);
}
if (problems.length > 0) {
  console.log(`parity:lanes: parity FAILS:\n  ${problems.join('\n  ')}`);
  exit = 1;
} else {
  console.log('parity:lanes: lanes, case lists, tolerances, sample rules, dump faults and the projection agree on ios and android');
}
if (requireAll) {
  const missing = notPassed(file);
  if (missing.length > 0) {
    console.log(`parity:lanes --require-all: ${missing.length} lane(s) did not pass (not met):\n  ${missing.join('\n  ')}`);
    exit = 1;
  }
}
process.exitCode = exit;

function hostOf(f: LanesFile | null, target: NativeTarget): HostRun | null {
  const l = f?.targets.find((t) => t.target === target)?.lanes.find((x) => x.lane === 'layout-vectors-host');
  if (l === undefined || l.run === null) return null;
  return { state: l.state, reason: l.reason, toolchain: l.run.toolchain, suites: l.run.suites, digests: l.run.digests };
}
