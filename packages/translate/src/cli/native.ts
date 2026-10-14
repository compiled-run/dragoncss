// pnpm run native:swift and pnpm run native:kotlin: the committed generated engine against the P1 corpus (the milestone-1 vectors
// and the units, engine and library corpora) and the extended corpus (P2b vectors, DPR vectors, engine-dpr, units-m2 and snap).
// The extended corpus is built and run on a worker thread (native-extended.ts) beside the P1 corpus: the two take about as long.
import { Worker } from 'node:worker_threads';
import { LOCK, lockedDigest, runTarget, staleFiles, committedFiles } from '../check.ts';
import type { Target } from '../check.ts';
import { buildCorpus } from '../corpus.ts';
import { lowerAll } from '../generate.ts';
import { buildKotlin, buildSwift, defaultKotlinLookup, describe, kotlinTool, swiftTool, writeReport } from '../native.ts';
import type { ExtendedCorpusMessage, ExtendedRunMessage } from './native-extended.ts';

const target = process.argv[2] as Target;
if (target !== 'swift' && target !== 'kotlin') throw new Error('usage: native.ts swift|kotlin');
const l = lowerAll();
const stale = staleFiles(target, l);
if (stale.length > 0) {
  console.log(`native:${target}: generated files are stale or hand-edited (run pnpm run native:gen):\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
const worker = new Worker(new URL('./native-extended.ts', import.meta.url), { workerData: target });
// The worker's two posts, in order; a worker error or an early exit rejects whichever is still pending.
const resolvers = <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } => {
  let resolve: (v: T) => void = () => {};
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const corpusPost = resolvers<ExtendedCorpusMessage>();
const runPost = resolvers<ExtendedRunMessage>();
runPost.promise.catch(() => {});
worker.on('message', (m: ExtendedCorpusMessage | ExtendedRunMessage) => (m.kind === 'corpus' ? corpusPost.resolve(m) : runPost.resolve(m)));
const ended = (e: Error): void => {
  corpusPost.reject(e);
  runPost.reject(e);
};
worker.once('error', ended);
worker.once('exit', (code) => ended(new Error(`native:${target}: the extended corpus worker exited with ${code} before posting its report`)));

const c = buildCorpus();
if (lockedDigest() !== c.digest) {
  console.log(`native:${target}: corpus digest ${c.digest} differs from ${LOCK} (run pnpm run native:gen)`);
  process.exit(1);
}
const x = await corpusPost.promise;
if (x.stale !== null) {
  console.log(x.stale);
  process.exit(1);
}
// The target is built here first, so the worker's run finds it in the build cache: a build's work directory is named by the
// process, which both threads share.
const files = committedFiles(target);
if (target === 'swift') {
  const tool = swiftTool();
  if (tool !== null) buildSwift(tool, files);
} else {
  const tool = kotlinTool(defaultKotlinLookup());
  if (tool !== null) buildKotlin(tool, files);
}
worker.postMessage('built');
const r = runTarget(target, c, files, target);
writeReport(r, c);
console.log(describe(r, c));
const rx = await runPost.promise;
console.log(rx.text);
const status = r.status === 'pass' && rx.status === 'pass' ? 'pass' : r.status === 'blocked (owner tooling)' || rx.status === 'blocked (owner tooling)' ? 'blocked (owner tooling)' : 'fail';
console.log(`native:${target}: P1 corpus digest ${c.digest}; extended corpus digest ${x.digest}; status ${status}`);
if (status === 'fail') process.exitCode = 1;
