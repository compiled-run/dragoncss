// The DPR lane report: every milestone-1 layout case at DPR 2, 3 and 2.625 (the Android extra), the engine against the committed
// DPR captures at the 1 device px gate, with exact nodes counted in zoomed LU. It writes no report file and touches no DPR-1
// result. Run with: pnpm run parity:dpr-report
import { dprChromeDeviations } from '@dragon/layout';
import { DPR_GATE_DEVICE_PX, dprRegistryRows, EXTRA_DPRS, registryRowPasses, runDprLane } from '../dpr.ts';

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
// The DPR deviation registry (chrome-deviations-dpr.ts): every node exact, and non-exact under the spec-reading fault; every
// control exact, and in the same place in its frame under the fault.
const rows = dprRegistryRows();
for (const d of dprChromeDeviations) {
  const mine = rows.filter((r) => r.deviation === d.id);
  const nodes = mine.filter((r) => r.kind === 'node');
  const controls = mine.filter((r) => r.kind === 'control');
  console.log(`DPR deviation ${d.id} (fault ${d.fault}; branches ${d.branches.map((b) => b.id).join(', ')}): nodes exact ${nodes.filter((r) => r.exact).length}/${nodes.length}, non-exact under ${d.fault} ${nodes.filter((r) => !r.exactUnderFault).length}/${nodes.length} (over the gate ${nodes.filter((r) => r.gapUnderFault > DPR_GATE_DEVICE_PX).length}); controls exact ${controls.filter((r) => r.exact).length}/${controls.length}, held under the fault ${controls.filter((r) => r.held === true).length}/${controls.length}`);
  for (const r of mine) {
    const verdict = registryRowPasses(r) ? 'ok  ' : 'FAIL';
    console.log(`  ${verdict} ${r.kind} ${r.fixture} ${r.node} @${r.dpr} (${r.detail}): exact ${r.exact}; under ${d.fault}: exact ${r.exactUnderFault}, gap ${r.gapUnderFault.toFixed(3)} device px${r.held === null ? '' : `, held ${r.held}`}`);
    if (!registryRowPasses(r)) failed++;
  }
}
const cases = lane.reduce((n, s) => n + s.cases, 0);
const pass = lane.reduce((n, s) => n + s.pass, 0);
console.log(`parity:dpr-report: ${pass}/${cases} cases pass the ${DPR_GATE_DEVICE_PX} device px gate; exact ${lane.map((s) => `${s.exact}/${s.nodes} at ${s.dpr}`).join(', ')}; failed ${failed} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
if (failed > 0) process.exitCode = 1;
