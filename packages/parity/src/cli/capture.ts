// Regenerates packages/parity/expected/<platform>/<case>.web.json from live Chrome (the authored rendering of every case in its
// environment), keyed by this process's platform. On the reference platform it also writes packages/parity/emitted/<fixture>.css
// (and <fixture>-rtl.css) from the compiler. It never writes another platform's key.
// Run with: pnpm run parity:capture
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { WEB_CSS_PATH } from 'dragon';
import { captureFixture, captureJson } from '../capture.ts';
import { casesOf, fixtureInput } from '../cases.ts';
import { launchChrome } from '../chrome.ts';
import { CHROME_PAGES, inOrder } from '../chrome-pool.ts';
import { emittedPath, expectedDir, expectedPath } from '../committed.ts';
import { environmentsOf, FIXTURES } from '../fixtures.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';
import { repoPath } from '../paths.ts';
import { authoredPrepareOf, compileFixture, forcedCases } from '../pipeline.ts';
import { FONT_FIXTURES } from '../fixture-groups/fonts.ts';
import { fontCases, fontEmittedDir, fontEmittedPath, fontExpectedDir, fontExpectedPath, liveFontAuthored } from '../fonts-run.ts';
import { ENV_FIXTURES } from '../fixture-groups/env.ts';
import { envCases, envEmittedDir, envEmittedPath, envExpectedDir, envExpectedPath, liveEnvAuthored } from '../env-run.ts';

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
  // CHROME_PAGES fixtures at once, each case in its own context (captureFixture); every file is written by one fixture alone.
  const layout = FIXTURES.filter((spec) => spec.kind === 'layout');
  await inOrder(layout, CHROME_PAGES, async (spec) => {
    const cases = casesOf(spec, fixtureInput(spec));
    for (const c of cases) writeFileSync(expectedPath(c.id, platform), captureJson(await captureFixture(browser, c.id, c.authoredHtml, c.environment, c.computedExtra, authoredPrepareOf(c))));
    // SELD-R2a: each forced case's authored rendering with its pseudo-classes forced (CSS.forcePseudoState).
    const forced = forcedCases(spec);
    for (const c of forced) writeFileSync(expectedPath(c.id, platform), captureJson(await captureFixture(browser, c.id, c.authoredHtml, c.environment, c.computedExtra, authoredPrepareOf(c))));
    const notes: string[] = [];
    if (reference) {
      for (const env of environmentsOf(spec)) {
        const web = compileFixture(spec, undefined, 'enforce', env.direction).compiled.outputs.web;
        const css = web.kind === 'ready' ? web.files.find((f) => f.path === WEB_CSS_PATH) : undefined;
        if (css !== undefined) writeFileSync(emittedPath(spec.id, env.direction), css.text);
        else notes.push(`${env.direction} web output not ready, no CSS written`);
      }
    }
    console.log(`captured ${spec.id} (${cases.length} case${cases.length === 1 ? '' : 's'}${forced.length === 0 ? '' : `, ${forced.length} forced`})${notes.length === 0 ? '' : `; ${notes.join('; ')}`}`);
  });
  // TXT1-C: the web-only fonts fixtures, each authored document captured under its stated reference, into expected-fonts.
  mkdirSync(fontExpectedDir(platform), { recursive: true });
  for (const f of readdirSync(fontExpectedDir(platform))) if (f.endsWith('.web.json')) rmSync(`${fontExpectedDir(platform)}/${f}`);
  if (reference) {
    mkdirSync(fontEmittedDir(), { recursive: true });
    for (const f of readdirSync(fontEmittedDir())) if (f.endsWith('.css')) rmSync(`${fontEmittedDir()}/${f}`);
  }
  await inOrder(FONT_FIXTURES, CHROME_PAGES, async (f) => {
    const cases = fontCases(f);
    for (const c of cases) writeFileSync(fontExpectedPath(c.id, platform), captureJson(await liveFontAuthored(browser, f)(c)));
    const notes: string[] = [];
    if (reference) {
      for (const env of environmentsOf(f.spec)) {
        const web = compileFixture(f.spec, undefined, 'enforce', env.direction).compiled.outputs.web;
        const css = web.kind === 'ready' ? web.files.find((x) => x.path === WEB_CSS_PATH) : undefined;
        if (css !== undefined) writeFileSync(fontEmittedPath(f.spec.id, env.direction), css.text);
        else notes.push(`${env.direction} web output not ready, no CSS written`);
      }
    }
    console.log(`captured ${f.spec.id} (${cases.length} cases, web only)${notes.length === 0 ? '' : `; ${notes.join('; ')}`}`);
  });
  // ENV-SAFE: the web-only env() fixtures, each authored document captured under its safe-area insets, into expected-env.
  mkdirSync(envExpectedDir(platform), { recursive: true });
  for (const f of readdirSync(envExpectedDir(platform))) if (f.endsWith('.web.json')) rmSync(`${envExpectedDir(platform)}/${f}`);
  if (reference) {
    mkdirSync(envEmittedDir(), { recursive: true });
    for (const f of readdirSync(envEmittedDir())) if (f.endsWith('.css')) rmSync(`${envEmittedDir()}/${f}`);
  }
  await inOrder(ENV_FIXTURES, CHROME_PAGES, async (f) => {
    const cases = envCases(f);
    for (const c of cases) writeFileSync(envExpectedPath(c.id, platform), captureJson(await liveEnvAuthored(browser, f)(c)));
    const notes: string[] = [];
    if (reference) {
      for (const env of environmentsOf(f.spec)) {
        const web = compileFixture(f.spec, undefined, 'enforce', env.direction).compiled.outputs.web;
        const css = web.kind === 'ready' ? web.files.find((x) => x.path === WEB_CSS_PATH) : undefined;
        if (css !== undefined) writeFileSync(envEmittedPath(f.spec.id, env.direction), css.text);
        else notes.push(`${env.direction} web output not ready, no CSS written`);
      }
    }
    console.log(`captured ${f.spec.id} (${cases.length} cases, web only, insets ${JSON.stringify(f.safeArea)})${notes.length === 0 ? '' : `; ${notes.join('; ')}`}`);
  });
} finally {
  await browser.close();
}
