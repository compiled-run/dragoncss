// Regenerates packages/parity/expected/<platform>/<case>.web.json from live Chrome (the authored rendering of every case in its
// environment), keyed by this process's platform. On the reference platform it also writes packages/parity/emitted/<fixture>.css
// (and <fixture>-rtl.css) from the compiler. It never writes another platform's key.
// Run with: pnpm run parity:capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { WEB_CSS_PATH } from 'dragon';
import { captureFixture, captureJson } from '../capture.ts';
import { casesOf, fixtureInput } from '../cases.ts';
import { launchChrome } from '../chrome.ts';
import { emittedPath, expectedDir, expectedPath } from '../committed.ts';
import { environmentsOf, FIXTURES } from '../fixtures.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';
import { repoPath } from '../paths.ts';
import { compileFixture } from '../pipeline.ts';

const platform = hostPlatform();
const reference = platform === REFERENCE_PLATFORM;
const dir = expectedDir(platform);
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.web.json')) rmSync(`${dir}/${f}`);
const emittedDir = repoPath('packages/parity/emitted');
if (reference) {
  mkdirSync(emittedDir, { recursive: true });
  for (const f of readdirSync(emittedDir)) if (f.endsWith('.css')) rmSync(`${emittedDir}/${f}`);
}
console.log(`capturing into packages/parity/expected/${platform}${reference ? ' (reference platform: emitted CSS rewritten)' : ' (emitted CSS untouched: it is compiled for the reference platform)'}`);
const browser = await launchChrome();
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const cases = casesOf(spec, fixtureInput(spec));
    for (const c of cases) writeFileSync(expectedPath(c.id, platform), captureJson(await captureFixture(browser, c.id, c.authoredHtml, c.environment, c.computedExtra)));
    const notes: string[] = [];
    if (reference) {
      for (const env of environmentsOf(spec)) {
        const web = compileFixture(spec, undefined, 'enforce', env.direction).compiled.outputs.web;
        const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH) : undefined;
        if (css !== undefined) writeFileSync(emittedPath(spec.id, env.direction), css.text);
        else notes.push(`${env.direction} web output not ready, no CSS written`);
      }
    }
    console.log(`captured ${spec.id} (${cases.length} case${cases.length === 1 ? '' : 's'})${notes.length === 0 ? '' : `; ${notes.join('; ')}`}`);
  }
} finally {
  await browser.close();
}
