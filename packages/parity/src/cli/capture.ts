// Regenerates packages/parity/expected/<case>.web.json from live Chrome (the authored rendering of every case in its environment)
// and packages/parity/emitted/<fixture>.css (and <fixture>-rtl.css for tree fixtures) from the compiler.
// Run with: pnpm run parity:capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { WEB_CSS_PATH } from 'dragon';
import { captureFixture, captureJson } from '../capture.ts';
import { casesOf } from '../cases.ts';
import { launchChrome } from '../chrome.ts';
import { emittedPath, expectedPath } from '../committed.ts';
import { environmentsOf, FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';
import { compileFixture } from '../pipeline.ts';

const expectedDir = repoPath('packages/parity/expected');
const emittedDir = repoPath('packages/parity/emitted');
mkdirSync(emittedDir, { recursive: true });
for (const f of readdirSync(expectedDir)) if (f.endsWith('.web.json')) rmSync(`${expectedDir}/${f}`);
for (const f of readdirSync(emittedDir)) if (f.endsWith('.css')) rmSync(`${emittedDir}/${f}`);
const browser = await launchChrome();
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const { input } = compileFixture(spec);
    const cases = casesOf(spec, input);
    for (const c of cases) writeFileSync(expectedPath(c.id), captureJson(await captureFixture(browser, c.id, c.authoredHtml, c.environment)));
    const notes: string[] = [];
    for (const env of environmentsOf(spec)) {
      const web = compileFixture(spec, undefined, 'enforce', env.direction).compiled.outputs.web;
      const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH) : undefined;
      if (css !== undefined) writeFileSync(emittedPath(spec.id, env.direction), css.text);
      else notes.push(`${env.direction} web output not ready, no CSS written`);
    }
    console.log(`captured ${spec.id} (${cases.length} case${cases.length === 1 ? '' : 's'})${notes.length === 0 ? '' : `; ${notes.join('; ')}`}`);
  }
} finally {
  await browser.close();
}
