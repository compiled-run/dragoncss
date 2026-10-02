// pnpm run parity:lanes [-- --run-host] [-- --run-device] [-- --target ios|android] [-- --device-jobs N] [-- --require-all] [-- --plant <fault>]
// (docs/research/native-strategy.md 3.6; notes/T015-p4-review-p5-plan.md section 4 item 7). Without a run flag it checks parity and
// reads the committed out/lanes.json. --run-host runs the host engine lanes of both targets at once through native:swift and
// native:kotlin, and the reference proof; --run-device (only under the device lease, /tmp/device-lease.sh) builds each target's app
// in its own process meanwhile, then runs the device lanes of both targets at once on their simulators or emulators, up to
// --device-jobs devices of a target at once (device-lanes.ts), every boot admitted by this process's memory budget (device-run.ts);
// every failure is printed and written to out/device-failures-<target>.json. Either rewrites out/lanes.json, keeping the committed
// records of lanes not run now when they still describe the configuration. --target limits --run-device to one target. pnpm run
// parity:devices is parity:lanes -- --run-host --run-device. Internal: --prebuild <target> builds the app with reuse.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deviceJobs, lanesArgs, prebuildApps } from '../device-jobs.ts';
import { failuresByKind, runTargetOnDevices } from '../device-lanes.ts';
import { requireDeviceLease } from '../device-run.ts';
import type { DeviceRun, LaneFault, LanesFile } from '../lanes.ts';
import { checkLaneParity, fileStatusProblems, LANE_FAULTS, LANES_JSON, lanesFile, laneSources, notPassed, plantLaneFault, readLanesFile, referenceProof, runHostLane, staleCovers, staleEvidence, staleLanes, writeLanesFile } from '../lanes.ts';
import { buildAndroid, buildIos } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import type { NativeTarget } from '../targets.ts';
import { nativeTargets } from '../targets.ts';
import type { HostRun } from '../lanes.ts';

const parsed = lanesArgs(process.argv.slice(2));
if ('error' in parsed) {
  console.error(`parity:lanes: ${parsed.error}`);
  process.exit(2);
}
const { runHost, runDevice, only, requireAll, plant, jobs, prebuild } = parsed;
if (prebuild !== null) {
  const t0 = Date.now();
  const r = prebuild === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
  for (const l of r.log) console.log(l);
  console.log(`${r.cases} cases in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(0);
}
if (runDevice) {
  try {
    requireDeviceLease();
  } catch (e) {
    console.error(`parity:lanes --run-device: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

const targets = nativeTargets();
const sources = laneSources();
const problems = checkLaneParity(targets, sources);

if (plant !== null) {
  const fault = plant as LaneFault;
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
  const mine = targets.filter((t) => only === null || t.target === only);
  // The apps build in their own processes while the host lanes run; a target whose build failed runs no devices and fails the run.
  const builds = runDevice ? prebuildApps(mine.map((t) => t.target), (l) => console.log(l)) : Promise.resolve([]);
  if (runHost) {
    const runs = await Promise.all(targets.map(async (t) => [t.target, await runHostLane(t)] as const));
    for (const [t, r] of runs) host.set(t, r);
    reference = referenceProof(targets);
    for (const r of reference) for (const row of r.rows) for (const f of row.failures.slice(0, 20)) console.log(`REFERENCE FAIL ${r.target} ${f}`);
    if (reference.some((r) => r.rows.some((row) => row.failures.length > 0))) exit = 1;
  }
  const failedBuilds = await builds;
  if (failedBuilds.length > 0) exit = 1;
  const device = new Map<NativeTarget, DeviceRun>();
  if (runDevice) {
    // Settled, not raced: a target that throws still lets the other finish and stop its devices before the run fails.
    const settled = await Promise.allSettled(
      mine.filter((t) => !failedBuilds.includes(t.target)).map(async (t) => {
        // A committed host run judges the device vectors only while it still describes the configuration.
        const hostRun = host.get(t.target) ?? (committed !== null && staleLanes(committed, targets).some((p) => staleCovers(p, t.target, 'layout-vectors-host')) ? null : hostOf(committed, t.target));
        const log = (l: string): void => console.log(`parity:lanes --run-device ${t.target}: ${l}`);
        const d = await runTargetOnDevices(t, hostRun, log, { jobs: deviceJobs(t.target, jobs, log) });
        device.set(t.target, d);
        const all = d.sets.flatMap((s) => s.failures);
        mkdirSync(repoPath('packages/parity/out'), { recursive: true });
        writeFileSync(repoPath(`packages/parity/out/device-failures-${t.target}.json`), `${JSON.stringify(all, null, 1)}\n`);
        for (const f of all) console.log(`DEVICE FAIL ${t.target} ${f.lane} ${f.case}@${f.dpr} ${f.kind}${f.node === null ? '' : ` ${f.node}`}: ${f.detail}`);
        console.log(`parity:lanes --run-device ${t.target}: ${all.length} failures ${JSON.stringify(failuresByKind(all))} (listed in packages/parity/out/device-failures-${t.target}.json)`);
        for (const s of d.sets) for (const r of s.faults) console.log(`  dump fault ${r.fault} (check ${r.check}) at DPR ${s.dpr}: caught ${r.caught}/${r.applicable} real dumps${r.uncaught.length === 0 ? '' : `; UNCAUGHT in ${r.uncaught.join(', ')}`}`);
        for (const tr of d.trust) for (const row of tr.rows) for (const m of row.mismatches) console.log(`  CAPTURE TRUST FAIL ${tr.device} ${row.case}: ${m}`);
      }),
    );
    for (const r of settled) if (r.status === 'rejected') throw r.reason;
  }
  file = lanesFile(targets, problems, host, reference, device, committed);
  writeLanesFile(file);
} else {
  const committed = readLanesFile();
  if (committed === null) {
    console.log(`parity:lanes: ${LANES_JSON} is absent; host lanes are not run (pnpm run parity:lanes -- --run-host)`);
    file = lanesFile(targets, problems, new Map(), null);
  } else {
    const stale = [...staleLanes(committed, targets), ...staleEvidence(committed)];
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
// The status is the file's parity (configuration problems plus run-record problems such as an uncaught dump fault), rechecked
// here for a committed file, not only the configuration problems this process found.
const status = fileStatusProblems(file, problems);
if (status.length > 0) {
  console.log(`parity:lanes: parity FAILS:\n  ${status.join('\n  ')}`);
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
