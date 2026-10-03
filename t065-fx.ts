import { readdirSync } from 'node:fs';
import { compileFixture } from './packages/parity/src/pipeline.ts';
import { tree } from './packages/parity/src/fixture-groups/define.ts';
for (const id of readdirSync('packages/parity/fixtures').filter((f) => /^(anim|motion)-/.test(f))) {
  try {
    const { compiled } = compileFixture(tree(id), undefined, 'derive', 'ltr');
    console.log(id, compiled.targets, compiled.diagnostics.map((d) => `${d.code}: ${d.message.slice(0, 90)}`));
  } catch (e) { console.log(id, 'THREW', (e as Error).message.slice(0, 200)); }
}
