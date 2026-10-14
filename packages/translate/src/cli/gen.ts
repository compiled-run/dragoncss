// pnpm run native:gen: rewrites packages/layout/generated from packages/layout/src, and the corpus lock. The extended corpus is
// built on a worker thread (gen-extended.ts) while this thread lowers and builds the main corpus: the two take about as long.
import { writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { LOCK, lockText } from '../check.ts';
import { buildCorpus } from '../corpus.ts';
import { KOTLIN_DIR, kotlinFiles, lowerAll, SWIFT_DIR, swiftFiles, writeTree } from '../generate.ts';

const extended = new Promise<string>((resolve, reject) => {
  const w = new Worker(new URL('./gen-extended.ts', import.meta.url));
  let line: string | null = null;
  w.once('message', (m: string) => (line = m));
  w.once('error', reject);
  w.once('exit', (code) => (code === 0 && line !== null ? resolve(line) : reject(new Error(`native:gen: the extended corpus worker exited with ${code}`))));
});
const l = lowerAll();
const swift = swiftFiles(l);
const kotlin = kotlinFiles(l);
writeTree(SWIFT_DIR, swift);
writeTree(KOTLIN_DIR, kotlin);
const c = buildCorpus();
writeFileSync(LOCK, lockText(c));
console.log(`native:gen: ${swift.size} Swift files, ${kotlin.size} Kotlin files; corpus ${c.suites.map((s) => `${s.name} ${s.lines.length}`).join(', ')}; digest ${c.digest}`);
console.log(await extended);
