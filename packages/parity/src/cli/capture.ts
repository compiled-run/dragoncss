// Regenerates packages/parity/expected/*.web.json from live Chrome. Run with: pnpm run parity:capture
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { captureFixture, captureJson } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { FIXTURES, VIEWPORT } from '../fixtures.ts';
import { repoPath } from '../paths.ts';

const dir = repoPath('packages/parity/expected');
for (const f of readdirSync(dir)) if (f.endsWith('.web.json')) rmSync(`${dir}/${f}`);
const browser = await launchChrome();
try {
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const html = readFileSync(repoPath(`packages/parity/fixtures/${spec.id}.html`), 'utf8');
    const capture = await captureFixture(browser, spec.id, html, VIEWPORT);
    writeFileSync(`${dir}/${spec.id}.web.json`, captureJson(capture));
    console.log(`captured ${spec.id} (${capture.nodes.length} nodes)`);
  }
} finally {
  await browser.close();
}
