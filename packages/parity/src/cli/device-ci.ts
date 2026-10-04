// Device lanes on CI (device-ci.ts, .github/workflows/device-lanes.yml), under the device lease like every device run.
//   one <target> <device> <outcome.json>: builds the target's app, boots the one device, runs it as a local run runs each device
//     (runOneDevice, judged against the committed host run while it is current), and writes the outcome with its evidence stamp
//     and host. An android device never runs the vectors lane here: the hybrid keeps it on the Mac.
//   vectors <record.json>: on the Mac, boots the android vectors device and runs only layout-vectors-device (runDeviceVectors).
//   merge <dir> (--local-vectors <record.json> | --ci-half): merges every outcome in <dir> (all matrix devices of both targets,
//     this tree's evidence) with the Mac's vectors record, and writes out/lanes.json and out/device-failures-<target>.json as
//     parity:lanes --run-device does. --ci-half merges the CI outcomes alone (the workflow's check), leaving that lane not run.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ciOutcomeText, LOCAL_VECTORS, mergeCiOutcomes, OUTCOME_SCHEMA, parseCiOutcome, parseVectorsRecord, producerLabel, vectorsRecordText, VECTORS_SCHEMA } from '../device-ci.ts';
import { deviceEvidence } from '../device-evidence.ts';
import { allRunFailures, deviceFailuresText, failuresByKind, runOneDevice } from '../device-lanes.ts';
import { boot, DEVICE_MATRIX, release, requireDeviceLease } from '../device-run.ts';
import { runDeviceVectors } from '../device-vectors.ts';
import { checkLaneParity, committedHostRun, fileStatusProblems, laneSources, lanesFile, readLanesFile, writeLanesFile } from '../lanes.ts';
import { buildAndroid, buildIos, nativeCases } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import { nativeTargets } from '../targets.ts';

// Exit codes: 0 merged with lane parity; 1 a parity failure, or a blocked device; 2 usage; 3 a refused merge (a missing,
// repeated or foreign half), with nothing written.
const USAGE = 'usage: device-ci.ts one <ios|android> <device> <outcome.json> | vectors <record.json> | merge <dir> (--local-vectors <record.json> | --ci-half)';
const [mode, ...rest] = process.argv.slice(2);
const targets = nativeTargets();

if (mode === 'one' && rest.length === 3) {
  const [target, device, out] = rest as [string, string, string];
  const t = targets.find((x) => x.target === target);
  const spec = DEVICE_MATRIX.find((d) => d.target === target && d.name === device);
  if (t === undefined || spec === undefined) {
    console.error(`device-ci one: ${JSON.stringify(device)} is not a ${target} matrix device (${DEVICE_MATRIX.map((d) => `${d.target}/${d.name}`).join(', ')})`);
    process.exit(2);
  }
  requireDeviceLease();
  const log = (l: string): void => console.log(`device-ci ${t.target} ${spec.name}: ${l}`);
  // Stamped before any device work, as runTargetOnDevices does.
  const evidence = deviceEvidence(t.target);
  const cases = nativeCases();
  const b0 = Date.now();
  const build = t.target === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
  for (const l of build.log) log(`build: ${l}`);
  log(`build: ${((Date.now() - b0) / 1000).toFixed(0)} s`);
  if (build.cases !== cases.length) throw new Error(`${t.target}: the app holds ${build.cases} cases, layoutCases() ${cases.length}`);
  const host = committedHostRun(readLanesFile(), targets, t.target);
  if (host === null) log('no current committed host run: the vectors lane is judged without one');
  const vectors = t.target !== LOCAL_VECTORS.target;
  if (!vectors && spec.name === LOCAL_VECTORS.device) log('layout-vectors-device is not run here: the hybrid runs it on the Mac (device-ci.ts vectors)');
  const outcome = await runOneDevice(t, spec, host, build.artifact, () => cases, vectors, log);
  writeFileSync(out, ciOutcomeText({ schema: OUTCOME_SCHEMA, target: t.target, device: spec.name, evidence, producedOn: producerLabel(), outcome }));
  log(`outcome written to ${out}${outcome.blocked === null ? '' : ` (blocked: ${outcome.blocked})`}`);
  // A blocked device fails its job: the run is not device evidence (the outcome is still uploaded to show why).
  if (outcome.blocked !== null) process.exitCode = 1;
} else if (mode === 'vectors' && rest.length === 1) {
  const out = rest[0]!;
  const t = targets.find((x) => x.target === LOCAL_VECTORS.target)!;
  const spec = DEVICE_MATRIX.find((d) => d.target === LOCAL_VECTORS.target && d.name === LOCAL_VECTORS.device)!;
  requireDeviceLease();
  const log = (l: string): void => console.log(`device-ci vectors ${spec.name}: ${l}`);
  const evidence = deviceEvidence(t.target);
  const host = committedHostRun(readLanesFile(), targets, t.target);
  if (host === null) log('no current committed host run: the vectors lane is judged without one');
  const h = await boot(spec);
  let problem: string | null = null;
  try {
    const v0 = Date.now();
    const vectors = await runDeviceVectors(h, t, host);
    log(`layout-vectors-device ${vectors.state}${vectors.reason === null ? '' : ` (${vectors.reason})`} in ${((Date.now() - v0) / 1000).toFixed(0)} s`);
    writeFileSync(out, vectorsRecordText({ schema: VECTORS_SCHEMA, target: LOCAL_VECTORS.target, device: spec.name, evidence, producedOn: producerLabel(), vectors }));
  } finally {
    problem = await release(h, log);
  }
  if (problem !== null) throw new Error(`${spec.name} could not be stopped: ${problem}`);
  log(`record written to ${out}`);
} else if (mode === 'merge' && rest.length >= 2 && ((rest[1] === '--local-vectors' && rest.length === 3) || (rest[1] === '--ci-half' && rest.length === 2))) {
  const dir = rest[0]!;
  let files: string[] = [];
  let local: ReturnType<typeof parseVectorsRecord> | 'ci-half' = 'ci-half';
  let runs: ReturnType<typeof mergeCiOutcomes>;
  try {
    local = rest[1] === '--ci-half' ? 'ci-half' : parseVectorsRecord(readFileSync(rest[2]!, 'utf8'), rest[2]!);
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    runs = mergeCiOutcomes(files.map((f) => parseCiOutcome(readFileSync(join(dir, f), 'utf8'), f)), local, deviceEvidence);
  } catch (e) {
    // A refused merge exits 3, apart from a merged run whose parity fails (1), so the landing driver names it.
    console.error(`device-ci merge: REFUSED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(3);
  }
  mkdirSync(repoPath('packages/parity/out'), { recursive: true });
  for (const [target, d] of runs) {
    writeFileSync(repoPath(`packages/parity/out/device-failures-${target}.json`), deviceFailuresText(d));
    const all = allRunFailures(d);
    for (const f of all) console.log(`DEVICE FAIL ${target} ${f.lane} ${f.case}@${f.dpr} ${f.kind}${f.node === null ? '' : ` ${f.node}`}: ${f.detail}`);
    console.log(`device-ci merge ${target}: ${all.length} failures ${JSON.stringify(failuresByKind(all))}${d.blocked === null ? '' : `; blocked: ${d.blocked}`}`);
  }
  const problems = checkLaneParity(targets, laneSources());
  const file = lanesFile(targets, problems, new Map(), null, runs, readLanesFile());
  writeLanesFile(file);
  for (const t of file.targets) for (const l of t.lanes) if (l.where !== 'host') console.log(`  ${t.target} ${l.lane}: ${l.state}${l.reason === null ? '' : ` (${l.reason})`} on ${(l.producedOn ?? []).join(' + ') || 'no host'}`);
  const status = fileStatusProblems(file, problems);
  if (status.length > 0) {
    console.log(`device-ci merge: parity FAILS:\n  ${status.join('\n  ')}`);
    process.exitCode = 1;
  } else console.log(`device-ci merge: ${files.length} outcomes${local === 'ci-half' ? ' (CI half only)' : ' and the local vectors record'} merged into packages/parity/out (lanes.json, device-failures-ios.json, device-failures-android.json)`);
} else {
  console.error(USAGE);
  process.exit(2);
}
