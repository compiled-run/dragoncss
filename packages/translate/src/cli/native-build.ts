// native:swift and native:kotlin's build worker: compiles the target into the build cache while the main thread builds the P1
// corpus (the build needs only the committed files, not the corpus), then posts how long it took. The main thread waits for it
// before it runs anything, so the two threads never build at once (a build's work directory is named by the process).
import { parentPort, workerData } from 'node:worker_threads';
import { committedFiles } from '../check.ts';
import type { Target } from '../check.ts';
import { buildKotlin, buildSwift, defaultKotlinLookup, kotlinTool, swiftTool } from '../native.ts';

export type BuildMessage = { readonly seconds: number } | { readonly error: string };

const port = parentPort;
if (port === null) throw new Error('native-build.ts runs as a worker of native.ts');
const target = workerData as Target;
let message: BuildMessage;
try {
  const files = committedFiles(target);
  let seconds = 0;
  if (target === 'swift') {
    const tool = swiftTool();
    if (tool !== null) seconds = buildSwift(tool, files).seconds;
  } else {
    const tool = kotlinTool(defaultKotlinLookup());
    if (tool !== null) seconds = buildKotlin(tool, files).seconds;
  }
  message = { seconds };
} catch (e) {
  message = { error: e instanceof Error ? e.message : String(e) };
}
port.postMessage(message);
