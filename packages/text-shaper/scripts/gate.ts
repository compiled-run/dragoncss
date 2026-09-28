// Runs the TXT1-0 gate over every reference (the 620 spike cases and the Lato cases) and prints the result.
// Exit code 1 on any mismatch.
// Usage: node packages/text-shaper/scripts/gate.ts
import { basename } from 'node:path';
import { GATE_REFERENCES, loadReference, runGate } from '../src/gate.ts';
import { DragonHB } from '../src/wasm.ts';

const hb = DragonHB.load();
const results = GATE_REFERENCES.flatMap(({ reference }) => {
  const rs = runGate(loadReference(reference), hb);
  console.log(`${basename(reference)}: ${rs.filter((r) => r.exact).length}/${rs.length} cases exact`);
  return rs;
});
const exact = results.filter((r) => r.exact).length;
const groups = new Map<string, [number, number]>();
for (const r of results) {
  const g = r.id.split('/').slice(0, 2).join('/');
  const v = groups.get(g) ?? [0, 0];
  v[1]++;
  if (r.exact) v[0]++;
  groups.set(g, v);
}
for (const [g, [ok, n]] of groups) console.log(`${g.padEnd(24)} ${ok}/${n}`);
console.log(`gate: ${exact}/${results.length} cases exact, ${results.reduce((n, r) => n + r.lines, 0)} lines`);
for (const r of results.filter((x) => !x.exact)) {
  console.log(`MISMATCH ${r.id}${r.error !== undefined ? ` (${r.error})` : ''} nowrap chrome ${r.nowrap.chrome} dragon ${r.nowrap.dragon}`);
  for (const d of r.lineDiffs) console.log(`  line ${d.line} ${JSON.stringify(d.text)} chrome ${d.chrome} dragon ${d.dragon} (LU)`);
}
process.exitCode = exact === results.length ? 0 : 1;
