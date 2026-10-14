// native:gen's worker: builds the extended corpus and writes its lock on its own thread, beside the main corpus, and posts the
// summary line back.
import { writeFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { buildExtendedCorpus, EXTENDED_LOCK, extendedLockText } from '../corpus-dpr.ts';

const x = buildExtendedCorpus();
writeFileSync(EXTENDED_LOCK, extendedLockText(x));
parentPort?.postMessage(`native:gen: extended corpus ${x.suites.map((s) => `${s.name} ${s.lines.length}`).join(', ')}; digest ${x.digest}`);
