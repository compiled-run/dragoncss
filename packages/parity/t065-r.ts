import { authoredModel } from './src/render.ts';
import { fixtureInput } from './src/cases.ts';
import { tree } from './src/fixture-groups/define.ts';
const input = fixtureInput(tree('anim-branch'));
const m = authoredModel(input);
console.log(m.assignments.map((a) => JSON.stringify(a)).join('\n'));
console.log(m.render(m.assignments[3]!, { kind: 'authored' }));
