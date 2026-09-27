// Regenerates packages/parity/expected/*.web.json from live Chrome and packages/parity/emitted/*.css from the compiler.
// Run with: pnpm run parity:capture
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createProject, WEB_CSS_PATH } from 'dragon';
import { captureFixture, captureJson } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { PROJECT_ID, readFixture } from '../fixture-reader.ts';
import { ENVIRONMENT, FIXTURES } from '../fixtures.ts';
import { repoPath } from '../paths.ts';

const expectedDir = repoPath('packages/parity/expected');
const emittedDir = repoPath('packages/parity/emitted');
mkdirSync(emittedDir, { recursive: true });
for (const f of readdirSync(expectedDir)) if (f.endsWith('.web.json')) rmSync(`${expectedDir}/${f}`);
for (const f of readdirSync(emittedDir)) if (f.endsWith('.css')) rmSync(`${emittedDir}/${f}`);
const browser = await launchChrome();
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const html = readFileSync(repoPath(`packages/parity/fixtures/${spec.id}.html`), 'utf8');
    const capture = await captureFixture(browser, spec.id, html, ENVIRONMENT);
    writeFileSync(`${expectedDir}/${spec.id}.web.json`, captureJson(capture));
    const compiled = createProject({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }).compile(readFixture(spec.id).input);
    const web = compiled.outputs.web;
    const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH) : undefined;
    if (css !== undefined) writeFileSync(`${emittedDir}/${spec.id}.css`, css.text);
    console.log(`captured ${spec.id} (${capture.nodes.length} nodes)${css === undefined ? '; web output not ready, no CSS written' : ''}`);
  }
} finally {
  await browser.close();
}
