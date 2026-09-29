// pnpm run parity:lanes [-- --run-host] [-- --run-device] [-- --target ios|android] [-- --device-jobs N] [-- --require-all] [-- --plant <fault>]
// (docs/research/native-strategy.md 3.6; notes/T015-p4-review-p5-plan.md section 4 item 7). Without a run flag it checks parity and
// reads the committed out/lanes.json. --run-host runs the host engine lanes through native:swift and native:kotlin and the reference
// proof; --run-device runs the device lanes of each target on its simulators or emulators, up to --device-jobs devices of a target
// at once (device-lanes.ts), every failure printed and written to out/device-failures-<target>.json. Either rewrites out/lanes.json
// under a lock, re-read at write time, replacing only the records this run produced and keeping the others while they still
// describe the configuration. --target limits both runs to one target, so the two targets can run at once in two processes;
// --own-exit (with --target, used by parity:devices) makes the exit status cover only this run's own target.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deviceJobs } from '../device-jobs.ts';
import { failuresByKind, runTargetOnDevices } from '../device-lanes.ts';
import type { DeviceRun, LaneFault, LanesFile } from '../lanes.ts';
import { checkLaneParity, LANE_FAULTS, LANES_JSON, lanesFile, laneSources, plantLaneFault, readLanesFile, referenceProof, reportLanesFile, runHostLane, staleCovers, staleEvidence, staleLanes, updateLanesFile } from '../lanes.ts';
import { repoPath } from '../paths.ts';
import type { NativeTarget } from '../targets.ts';
import { nativeTargets } from '../targets.ts';
import type { HostRun } from '../lanes.ts';

const args = process.argv.slice(2);
const runHost = args.includes('--run-host');
const runDevice = args.includes('--run-device');
const targetAt = args.indexOf('--target');
const onlyArg = targetAt < 0 ? null : (args[targetAt + 1] ?? '');
if (onlyArg !== null && onlyArg !== 'ios' && onlyArg !== 'android') {
  console.error(`parity:lanes: --target takes ios or android, not ${JSON.stringify(onlyArg)}`);
  process.exit(2);
}
const only: NativeTarget | null = onlyArg;
const requireAll = args.includes('--require-all');
const ownExit = args.includes('--own-exit');
if (ownExit && only === null) {
  console.error('parity:lanes: --own-exit needs --target ios|android');
  process.exit(2);
}
const jobsAt = args.indexOf('--device-jobs');
const jobsArg = jobsAt < 0 ? null : (args[jobsAt + 1] ?? '');
if (jobsArg !== null && !/^[1-9]\d?$/.test(jobsArg)) {
  console.error(`parity:lanes: --device-jobs takes a whole number from 1 to 99, not ${JSON.stringify(jobsArg)}`);
  process.exit(2);
}
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
  const mine = targets.filter((t) => only === null || t.target === only);
  let reference: ReturnType<typeof referenceProof> | null = null;
  if (runHost) {
    for (const t of mine) host.set(t.target, await runHostLane(t));
    reference = referenceProof(mine);
    for (const r of reference) for (const row of r.rows) for (const f of row.failures.slice(0, 20)) console.log(`REFERENCE FAIL ${r.target} ${f}`);
    if (reference.some((r) => r.rows.some((row) => row.failures.length > 0))) exit = 1;
  }
  const device = new Map<NativeTarget, DeviceRun>();
  if (runDevice) {
    for (const t of mine) {
      // A committed host run judges the device vectors only while it still describes the configuration.
      const hostRun = host.get(t.target) ?? (committed !== null && staleLanes(committed, targets).some((p) => staleCovers(p, t.target, 'layout-vectors-host')) ? null : hostOf(committed, t.target));
      const log = (l: string): void => console.log(`parity:lanes --run-device ${t.target}: ${l}`);
      const d = await runTargetOnDevices(t, hostRun, log, { jobs: deviceJobs(t.target, jobsArg === null ? null : Number(jobsArg), log) });
      device.set(t.target, d);
      const all = d.sets.flatMap((s) => s.failures);
      mkdirSync(repoPath('packages/parity/out'), { recursive: true });
      writeFileSync(repoPath(`packages/parity/out/device-failures-${t.target}.json`), `${JSON.stringify(all, null, 1)}\n`);
      for (const f of all) console.log(`DEVICE FAIL ${t.target} ${f.lane} ${f.case}@${f.dpr} ${f.kind}${f.node === null ? '' : ` ${f.node}`}: ${f.detail}`);
      console.log(`parity:lanes --run-device ${t.target}: ${all.length} failures ${JSON.stringify(failuresByKind(all))} (listed in packages/parity/out/device-failures-${t.target}.json)`);
      for (const s of d.sets) for (const r of s.faults) console.log(`  dump fault ${r.fault} (check ${r.check}) at DPR ${s.dpr}: caught ${r.caught}/${r.applicable} real dumps${r.uncaught.length === 0 ? '' : `; UNCAUGHT in ${r.uncaught.join(', ')}`}`);
      for (const tr of d.trust) for (const row of tr.rows) for (const m of row.mismatches) console.log(`  CAPTURE TRUST FAIL ${tr.device} ${row.case}: ${m}`);
    }
  }
  // Re-read at write time: a run of the other target may have replaced its records since this run started.
  file = updateLanesFile((onDisk) => lanesFile(targets, problems, host, reference, device, onDisk));
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

if (ownExit) {
  // parity:devices judges the merged file once both targets have written theirs; this run answers for its own target only.
  const own = file.targets.find((t) => t.target === only)?.lanes.filter((l) => l.state === 'fail') ?? [];
  for (const l of own) console.log(`parity:lanes --own-exit: ${only} ${l.lane} failed${l.reason === null ? '' : ` (${l.reason})`}`);
  if (own.length > 0) exit = 1;
  console.log(`parity:lanes --own-exit ${only}: ${exit === 0 ? 'pass' : 'FAIL'}`);
} else if (reportLanesFile(file, problems, requireAll, (l) => console.log(l)) !== 0) {
  exit = 1;
}
process.exitCode = exit;

function hostOf(f: LanesFile | null, target: NativeTarget): HostRun | null {
  const l = f?.targets.find((t) => t.target === target)?.lanes.find((x) => x.lane === 'layout-vectors-host');
  if (l === undefined || l.run === null) return null;
  return { state: l.state, reason: l.reason, toolchain: l.run.toolchain, suites: l.run.suites, digests: l.run.digests };
}
