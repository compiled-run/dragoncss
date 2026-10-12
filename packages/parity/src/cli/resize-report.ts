// The resize host lanes (notes/T067 R5, R7 (a)) over the committed captures: prints the counts and every failure, exits 1 on any.
// Run with: pnpm run parity:resize-report
import { resizeReport } from '../resize-capture.ts';

const r = resizeReport();
for (const f of r.failures) console.log(`FAIL ${f}`);
console.log(`parity:resize-report: ${r.passing.length}/${r.cases} cases pass; ${r.samples} samples, ${r.boxes} boxes, ${r.colors} colours, ${r.dual} chrome-dual samples, ${r.oracle} oracle points; ${r.failures.length} failures`);
process.exit(r.failures.length === 0 ? 0 : 1);
