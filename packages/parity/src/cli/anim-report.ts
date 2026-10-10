// T065 R18: the host frame lanes against the committed frame captures (packages/parity/expected-frames), no browser. For every
// frame case, DPR and sample: the TypeScript animator's value of every tracked colour and margin, string for string with
// Chrome's getComputedStyle; the engine's boxes for the live program against Chrome's rects at the DPR (the DPR lane's gate);
// the settle dump equal to the end assignment's static program; and chrome-dual: the compiled web rendering equal to the
// authored one at every sample. Exit 1 on any difference. Run with: pnpm run parity:anim-report
import { animReport } from '../frame-capture.ts';

const r = animReport();
for (const f of r.failures.slice(0, 60)) console.log(`FAIL ${f}`);
console.log(`parity:anim-report: ${r.cases} frame cases, ${r.samples} samples (${r.values} values, ${r.boxes} boxes, ${r.dual} chrome-dual samples, ${r.settles} settles), failed ${r.failures.length}`);
if (r.failures.length > 0) process.exitCode = 1;
