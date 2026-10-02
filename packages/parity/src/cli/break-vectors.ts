// pnpm run layout:break-vectors (notes/T015-p4-review-p5-plan.md section 4 item 4 (i)): the engine's per-line start and end of every
// text node of every layout case at every device DPR, through the engine's own placeLines as the device reads them,
// written to packages/layout/break-vectors/dpr-<d>/<case>.json. The case list is layoutCases(); the DPRs are DPRS.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { programInput } from 'dragon';
import { DPRS } from '../dpr.ts';
import { breakVector, breakVectorDir, breakVectorPath, breakVectorText, engineTextLines } from '../line-breaks.ts';
import { nativeCases, referenceMeasurer } from '../native-host.ts';

const cases = nativeCases();
const m = referenceMeasurer();
let lines = 0;
for (const dpr of DPRS) {
  const dir = breakVectorDir(dpr);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(`${dir}/${f}`);
  let texts = 0;
  for (const n of cases) {
    // Both backends run the one shared engine input tree; the break vector is of that tree.
    if (JSON.stringify(n.programs.uikit.root) !== JSON.stringify(n.programs['android-views'].root)) throw new Error(`${n.case.id}: the uikit and android-views programs hold different engine inputs`);
    const t = engineTextLines(programInput(n.programs.uikit, n.case.environment.viewport, dpr), m);
    texts += t.length;
    lines += t.reduce((k, x) => k + x.lines.length, 0);
    writeFileSync(breakVectorPath(n.case.id, dpr), breakVectorText(breakVector(n.case.id, dpr, t)));
  }
  const written = readdirSync(dir).filter((f) => f.endsWith('.json')).length;
  if (written !== cases.length) throw new Error(`DPR ${dpr}: ${written} break vectors written, ${cases.length} cases`);
  console.log(`layout:break-vectors: DPR ${dpr}: ${written} cases, ${texts} text nodes -> packages/layout/break-vectors/dpr-${dpr}`);
}
console.log(`layout:break-vectors: ${cases.length} cases x ${DPRS.length} DPRs; ${lines} lines in all`);
