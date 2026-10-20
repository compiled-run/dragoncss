import { readFileSync, writeFileSync } from 'node:fs';
import { withoutPointerEvents } from './src/hit-capture.ts';
const p = 'packages/parity/emitted/attr-presence.css';
writeFileSync(process.argv[2]!, withoutPointerEvents(p, readFileSync('emitted/attr-presence.css', 'utf8')));
