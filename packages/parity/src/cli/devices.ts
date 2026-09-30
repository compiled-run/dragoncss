// pnpm run parity:devices [-- --require-all] [-- --device-jobs N]: the full lane run (parity:lanes -- --run-host --run-device) with
// both targets at once. Per target: the host lane and reference proof (parity:lanes --run-host --target <t>) beside a build of the
// app, reused when its sources are unchanged; then the device lanes (parity:lanes --run-device --target <t>) under that platform's
// lease (DRAGON_LEASE=<t> /tmp/device-lease.sh, or directly without the script). Each run writes its own records into out/lanes.json
// under the lock. Then the merged file is judged as the sequential run judges its own: the exit is non-zero when any step failed
// or the merged file fails. Internal: --prebuild <target> builds the app with reuse.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { devicesExit, isAncestor, LEASE_SCRIPT, leased, leaseHolder, parentPid } from '../device-jobs.ts';
import { checkLaneParity, laneSources, readLanesFile, reportLanesFile } from '../lanes.ts';
import { buildAndroid, buildIos } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import type { NativeTarget } from '../targets.ts';
import { NATIVE_TARGETS, nativeTargets } from '../targets.ts';

const args = process.argv.slice(2);
const prebuildAt = args.indexOf('--prebuild');
if (prebuildAt >= 0) {
  const t = args[prebuildAt + 1];
  if (t !== 'ios' && t !== 'android') {
    console.error('parity:devices: --prebuild takes ios or android');
    process.exit(2);
  }
  const t0 = Date.now();
  const r = t === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
  for (const l of r.log) console.log(l);
  console.log(`${r.cases} cases in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(0);
}

const requireAll = args.includes('--require-all');
const jobsAt = args.indexOf('--device-jobs');
const jobs = jobsAt < 0 ? [] : ['--device-jobs', args[jobsAt + 1] ?? ''];
if (jobs[1] !== undefined && !/^[1-9]\d?$/.test(jobs[1])) {
  console.error(`parity:devices: --device-jobs takes a whole number from 1 to 99, not ${JSON.stringify(jobs[1])}`);
  process.exit(2);
}
for (const a of args) if (!['--require-all', '--device-jobs'].includes(a) && a !== jobs[1]) {
  console.error(`parity:devices: unknown argument ${JSON.stringify(a)} (takes --require-all and --device-jobs N)`);
  process.exit(2);
}
// Run under the lease itself (/tmp/device-lease.sh pnpm run parity:devices), a step taking it again would wait on its own ancestor.
const holder = leaseHolder();
const inside = holder !== null && isAncestor(holder, process.pid, parentPid);
const script = existsSync(LEASE_SCRIPT) && !inside ? LEASE_SCRIPT : null;
if (inside) console.log(`parity:devices: runs inside the device lease (held by ancestor pid ${holder}), so its device steps do not take it again`);
else if (script === null) console.log(`parity:devices: ${LEASE_SCRIPT} is absent, so the device runs take no lease`);

type Step = { readonly name: string; readonly code: number | null; readonly seconds: number; readonly firstLine: number | null };
const T0 = Date.now();
const secs = (ms: number): string => `${(ms / 1000).toFixed(0)} s`;

function step(name: string, cmd: string, argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<Step> {
  const t0 = Date.now();
  let firstLine: number | null = null;
  return new Promise((resolve) => {
    const p = spawn(cmd, [...argv], { cwd: repoPath('.'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = (l: string): void => {
      firstLine ??= Date.now() - t0;
      console.log(`[${name}] ${l}`);
    };
    createInterface({ input: p.stdout }).on('line', out);
    createInterface({ input: p.stderr }).on('line', out);
    p.once('error', (e) => {
      console.log(`[${name}] could not start: ${e.message}`);
      resolve({ name, code: null, seconds: (Date.now() - t0) / 1000, firstLine: firstLine === null ? null : firstLine / 1000 });
    });
    p.once('close', (code, signal) => {
      console.log(`[${name}] ${code === 0 ? 'done' : `FAILED (${signal ?? `exit ${code}`})`} in ${secs(Date.now() - t0)}`);
      resolve({ name, code, seconds: (Date.now() - t0) / 1000, firstLine: firstLine === null ? null : firstLine / 1000 });
    });
  });
}

const node = (script: string, argv: readonly string[]): [string, string[]] => [process.execPath, ['--conditions=dragon-internal', repoPath(script), ...argv]];
const LANES = 'packages/parity/src/cli/lanes.ts';

async function target(t: NativeTarget): Promise<{ readonly counted: readonly Step[]; readonly prebuild: Step }> {
  const [hc, ha] = node(LANES, ['--run-host', '--target', t, '--own-exit']);
  const [bc, ba] = node('packages/parity/src/cli/devices.ts', ['--prebuild', t]);
  const [host, prebuild] = await Promise.all([step(`${t} host`, hc, ha), step(`${t} build`, bc, ba)]);
  const [dc, da] = node(LANES, ['--run-device', '--target', t, '--own-exit', ...jobs]);
  const l = leased(t, dc, da, script);
  const device = await step(`${t} devices`, l.cmd, l.args, l.env);
  return { counted: [host, device], prebuild };
}

const runs = await Promise.all(NATIVE_TARGETS.map(target));
const file = readLanesFile();
if (file === null) throw new Error('parity:devices: no out/lanes.json after the runs');
const merged = reportLanesFile(file, checkLaneParity(nativeTargets(), laneSources()), requireAll, (l) => console.log(l));
const steps = runs.flatMap((r) => r.counted);
console.log('parity:devices: wall clock per step (first output after, for a leased step, the wait for the lease):');
for (const s of [...runs.map((r) => r.prebuild), ...steps]) console.log(`  ${s.name}: ${s.seconds.toFixed(0)} s${s.firstLine === null ? '' : ` (first output after ${s.firstLine.toFixed(0)} s)`}; ${s.code === 0 ? 'ok' : `exit ${s.code ?? 'none'}`}`);
const exit = devicesExit(steps, merged);
console.log(`parity:devices: ${exit === 0 ? 'pass' : 'FAIL'} in ${secs(Date.now() - T0)}`);
process.exitCode = exit;
