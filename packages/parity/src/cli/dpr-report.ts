// The DPR lane report: every milestone-1 layout case at DPR 2, 3 and 2.625 (the Android extra), the engine against the committed
// DPR captures at the 1 device px gate, with exact nodes counted in zoomed LU. It writes no report file and touches no DPR-1
// result. Run with: pnpm run parity:dpr-report
import { DPR_GATE_DEVICE_PX, EXTRA_DPRS, runDprLane } from '../dpr.ts';

const t = Date.now();
const lane = runDprLane();
let failed = 0;
for (const s of lane) {
  const extra = EXTRA_DPRS.find((e) => e.dpr === s.dpr);
  console.log(`DPR ${s.dpr} (${extra === undefined ? 'shared' : `${extra.platform} extra ${extra.name}`}): ${s.pass}/${s.cases} cases pass the ${DPR_GATE_DEVICE_PX} device px gate; ${s.exact}/${s.nodes} nodes exact in zoomed LU`);
  for (const o of s.outcomes) {
    if (o.status === 'pass') continue;
    failed++;
    console.log(`  FAIL ${o.id} @${s.dpr}: ${(o.reason ?? '').slice(0, 1500)}`);
  }
}
const cases = lane.reduce((n, s) => n + s.cases, 0);
const pass = lane.reduce((n, s) => n + s.pass, 0);
console.log(`parity:dpr-report: ${pass}/${cases} cases pass the ${DPR_GATE_DEVICE_PX} device px gate; exact ${lane.map((s) => `${s.exact}/${s.nodes} at ${s.dpr}`).join(', ')}; failed ${failed} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
if (failed > 0) process.exitCode = 1;
