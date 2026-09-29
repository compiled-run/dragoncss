// Internal to parity:lanes --run-device (device-jobs.ts): runs one device of a target's matrix, the job read from argv[2], and writes
// its outcome to argv[3]. A thrown error exits non-zero with the message on stderr, and the parent run stops, as a sequential run does.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDeviceJob } from '../device-jobs.ts';
import { runOneDevice } from '../device-lanes.ts';
import { DEVICE_MATRIX } from '../device-run.ts';
import { nativeCases } from '../native-host.ts';
import { nativeTargets } from '../targets.ts';

const [jobFile, outFile] = process.argv.slice(2);
if (jobFile === undefined || outFile === undefined) {
  console.error('usage: device-one.ts <job.json> <outcome.json>');
  process.exit(2);
}
const job = parseDeviceJob(readFileSync(jobFile, 'utf8'));
const t = nativeTargets().find((x) => x.target === job.target);
const spec = DEVICE_MATRIX.find((d) => d.target === job.target && d.name === job.device);
if (t === undefined || spec === undefined) throw new Error(`no ${job.target} target or device ${job.device}`);
const outcome = await runOneDevice(t, spec, job.host, job.artifact, nativeCases, job.vectors, (l) => console.log(l));
writeFileSync(outFile, JSON.stringify(outcome));
