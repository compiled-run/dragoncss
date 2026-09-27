// pnpm run layout:subset: fails with file:line on any engine construct outside the translator subset (validate.ts is exempt).
import { EXEMPT } from '../generate.ts';
import { checkSubset } from '../subset.ts';

const violations = checkSubset();
for (const v of violations) console.log(`${v.file}:${v.line}: ${v.message}`);
console.log(`layout:subset: ${violations.length} violations (exempt: ${EXEMPT.join(', ')})`);
if (violations.length > 0) process.exitCode = 1;
