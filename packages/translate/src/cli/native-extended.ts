// native:swift and native:kotlin's worker: builds the extended corpus on its own thread while the main thread builds the P1
// corpus, posts whether it matches its lock, and once the main thread has built the target and run the P1 corpus (a build's work
// directory is named by the process, so the two threads never build at once) runs the extended corpus and posts the report.
import { once } from 'node:events';
import { parentPort, workerData } from 'node:worker_threads';
import { committedFiles, runTarget } from '../check.ts';
import type { Target } from '../check.ts';
import { buildExtendedCorpus, EXTENDED_LOCK, extendedLockedDigest } from '../corpus-dpr.ts';
import { describe, writeReport } from '../native.ts';

export type ExtendedCorpusMessage = { readonly kind: 'corpus'; readonly stale: string | null; readonly digest: string };
export type ExtendedRunMessage = { readonly kind: 'run'; readonly text: string; readonly status: string };

const port = parentPort;
if (port === null) throw new Error('native-extended.ts runs as a worker of native.ts');
const target = workerData as Target;
const x = buildExtendedCorpus();
const stale = extendedLockedDigest() === x.digest ? null : `native:${target}: extended corpus digest ${x.digest} differs from ${EXTENDED_LOCK} (run pnpm run native:gen)`;
port.postMessage({ kind: 'corpus', stale, digest: x.digest } satisfies ExtendedCorpusMessage);
if (stale === null) {
  await once(port, 'message');
  const rx = runTarget(target, x, committedFiles(target), `${target}-extended`);
  writeReport(rx, x, 'extended');
  port.postMessage({ kind: 'run', text: `extended corpus:\n${describe(rx, x)}`, status: rx.status } satisfies ExtendedRunMessage);
}
