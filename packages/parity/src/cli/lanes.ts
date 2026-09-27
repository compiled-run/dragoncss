// pnpm run parity:lanes [-- --run-host] [-- --require-all] [-- --plant <fault>] (docs/research/native-strategy.md 3.6).
// Without --run-host it checks parity and reads the committed out/lanes.json; with it, it runs the host engine lanes through
// native:swift and native:kotlin, runs the reference proof and rewrites out/lanes.json.
import type { LaneFault, LanesFile } from '../lanes.ts';
import { checkLaneParity, LANE_FAULTS, LANES_JSON, lanesFile, laneSources, notPassed, plantLaneFault, readLanesFile, referenceProof, runHostLane, staleLanes, writeLanesFile } from '../lanes.ts';
import type { NativeTarget } from '../targets.ts';
import { nativeTargets } from '../targets.ts';
import type { HostRun } from '../lanes.ts';

const args = process.argv.slice(2);
const runHost = args.includes('--run-host');
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
if (runHost) {
  const host = new Map<NativeTarget, HostRun>();
  for (const t of targets) host.set(t.target, await runHostLane(t));
  const reference = referenceProof(targets);
  file = lanesFile(targets, problems, host, reference);
  writeLanesFile(file);
  for (const r of reference) for (const row of r.rows) for (const f of row.failures.slice(0, 20)) console.log(`REFERENCE FAIL ${r.target} ${f}`);
  if (reference.some((r) => r.rows.some((row) => row.failures.length > 0))) exit = 1;
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
    if (l.state === 'fail') exit = 1;
  }
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
