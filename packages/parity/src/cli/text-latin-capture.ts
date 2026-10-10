// Writes the text-latin registry's committed Chrome references (fixture-groups/text-latin.ts) from live Chrome on the reference
// platform: for every case and DPR (1, 2, 3, 2.625) the authored capture and Chrome's breaks under the stated reference, into
// packages/parity/expected-text-latin/<platform>/dpr-<d>/, and the compiled web CSS into packages/parity/expected-text-latin/emitted/.
// With --vectors it writes the engine vectors with their shape transcripts instead, from the committed captures, for every case
// that passes its lanes: packages/layout/vectors/text-latin/dpr-<d>/<case>.json.
// Exits 1 when a case writes nothing (no web CSS, or a vector of a case that fails its lanes), 2 on an unknown argument.
// Run with: node --conditions=dragon-internal packages/parity/src/cli/text-latin-capture.ts [--vectors]
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Browser } from 'playwright';
import { WEB_CSS_PATH } from 'dragon';
import { captureJson } from '../capture.ts';
import { launchChrome } from '../chrome.ts';
import { zoomGuard } from '../dpr.ts';
import { TEXT_LATIN_FIXTURES } from '../fixture-groups/text-latin.ts';
import { chromeBreaksText } from '../line-breaks.ts';
import { hostPlatform, requireReferencePlatform } from '../platform.ts';
import { repoPath } from '../paths.ts';
import {
  committedTextLatinOptions, compileTextLatin, liveTextLatinBreaks, liveTextLatinCapture, runTextLatinDpr, runTextLatinFixture, TEXT_LATIN_DPRS,
  textLatinBreaksPath, textLatinCapturePath, textLatinCases, textLatinDir, textLatinEmittedPath, textLatinVector, textLatinVectorPath, textLatinVectorText,
} from '../text-latin-run.ts';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--vectors');
if (unknown.length > 0) {
  console.error(`unknown argument ${unknown.join(' ')}; usage: text-latin-capture.ts [--vectors]`);
  process.exit(2);
}
const vectors = args.includes('--vectors');
requireReferencePlatform(hostPlatform());
const failures: string[] = [];

const clean = (dir: string, suffix: string): void => {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(suffix)) rmSync(`${dir}/${f}`);
};

if (!vectors) {
  for (const dpr of TEXT_LATIN_DPRS) clean(textLatinDir(dpr), '.json');
  clean(dirname(textLatinEmittedPath('x', 'ltr')), '.css');
  for (const dpr of TEXT_LATIN_DPRS) {
    const browser: Browser = await launchChrome(dpr);
    try {
      if (dpr !== 1) console.log(`DPR ${dpr}: ${await zoomGuard(browser, dpr)}`);
      for (const f of TEXT_LATIN_FIXTURES) {
        const cases = textLatinCases(f);
        for (const c of cases) {
          writeFileSync(textLatinCapturePath(c.id, dpr), captureJson(await liveTextLatinCapture(browser, f, c, dpr)));
          writeFileSync(textLatinBreaksPath(c.id, dpr), chromeBreaksText(await liveTextLatinBreaks(browser, f, c, dpr)));
          if (dpr === 1) {
            const web = compileTextLatin(f, c.environment.direction).compiled.outputs.web;
            const css = web.kind === 'ready' ? web.files.find((x) => x.path === WEB_CSS_PATH) : undefined;
            if (css !== undefined) writeFileSync(textLatinEmittedPath(f.spec.id, c.environment.direction), css.text);
            else failures.push(`${c.id}: web output not ready, no CSS written`);
          }
        }
        console.log(`captured ${f.spec.id} at DPR ${dpr} (${cases.length} case${cases.length === 1 ? '' : 's'})`);
      }
    } finally {
      await browser.close();
    }
  }
} else {
  for (const dpr of TEXT_LATIN_DPRS) clean(repoPath(`packages/layout/vectors/text-latin/dpr-${dpr}`), '.json');
  const browser = await launchChrome();
  let written = 0;
  try {
    for (const f of TEXT_LATIN_FIXTURES) {
      for (const o of await runTextLatinFixture(f, browser, committedTextLatinOptions)) {
        if (o.status !== 'pass' || o.vector === null) {
          failures.push(`skipped ${o.id} at DPR 1: ${o.reason}`);
          continue;
        }
        writeFileSync(textLatinVectorPath(o.id, 1), textLatinVectorText(textLatinVector(o.vector.input)));
        written++;
      }
      for (const dpr of TEXT_LATIN_DPRS.filter((d) => d !== 1)) {
        for (const o of await runTextLatinDpr(f, dpr, committedTextLatinOptions)) {
          if (o.status !== 'pass' || o.vector === null || o.breakProblems.length > 0) {
            failures.push(`skipped ${o.id} at DPR ${dpr}: ${o.reason ?? o.breakProblems.join('; ')}`);
            continue;
          }
          writeFileSync(textLatinVectorPath(o.id, dpr), textLatinVectorText(textLatinVector(o.vector.input)));
          written++;
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`wrote ${written} text-latin vectors to packages/layout/vectors/text-latin`);
}
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
