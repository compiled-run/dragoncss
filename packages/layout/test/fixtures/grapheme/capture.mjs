// Captures Chrome 145.0.7632.6's Intl.Segmenter('en', { granularity: 'grapheme' }) boundaries over a corpus: every line of the
// pinned GraphemeBreakTest-16.0.0 (vendored copy read from the generator's cache or unicode.org), plus Latin text with combining
// marks, emoji sequences and Indic conjuncts. Writes chrome-grapheme.json beside this script; --check exits 1 unless it is unchanged.
// Run with: node --conditions=dragon-internal packages/layout/test/fixtures/grapheme/capture.mjs [--check]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_VERSION, launchChrome } from '../../../../parity/src/chrome.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'chrome-grapheme.json');
const TEST_URL = 'https://www.unicode.org/Public/16.0.0/ucd/auxiliary/GraphemeBreakTest.txt';
const TEST_SHA256 = 'ee2b9354d270ac061b29f09662cafea06341d77e704b8cc6bd72aaeeda363cb5';

async function testLines() {
  const cache = join(HERE, '../../../../../node_modules/.cache/ucd-16.0.0/GraphemeBreakTest.txt');
  const bytes = existsSync(cache) ? readFileSync(cache) : Buffer.from(await (await fetch(TEST_URL)).arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== TEST_SHA256) throw new Error(`GraphemeBreakTest.txt sha256 ${sha}, pinned ${TEST_SHA256}`);
  const out = [];
  for (const raw of bytes.toString('utf8').split('\n')) {
    const body = (raw.includes('#') ? raw.slice(0, raw.indexOf('#')) : raw).trim();
    if (body === '') continue;
    out.push(body.split(/\s+/).filter((t) => t !== '÷' && t !== '×').map((t) => parseInt(t, 16)));
  }
  return out;
}

/** Hand-picked text: Latin with combining marks, the fixture words, emoji ZWJ and flag sequences, Hangul and Devanagari conjuncts. */
const EXTRA = [
  'été', 'Supercalifragilisticexpialidocious', 'abcdéfgh', 'ä́b', 'ñô', 'Å',
  '\u{1F468}‍\u{1F469}‍\u{1F467}', '\u{1F1EB}\u{1F1F7}\u{1F1E9}\u{1F1EA}', '\u{1F44D}\u{1F3FD}', '각', '각',
  'क्ष', 'क्‍ष', 'x\r\ny', 'a​b', 'Lato café résumé',
];

const cases = [...(await testLines()), ...EXTRA.map((s) => [...s].map((c) => c.codePointAt(0)))];
const browser = await launchChrome();
let results;
try {
  if (browser.version() !== CHROME_VERSION) throw new Error(`Chrome ${browser.version()}`);
  const page = await (await browser.newContext()).newPage();
  results = await page.evaluate((all) => {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return all.map((cps) => {
      const s = String.fromCodePoint(...cps);
      // Boundary code point indices (UTF-16 indices mapped back to code points).
      const cpAt = [];
      let k = 0;
      for (const ch of s) {
        cpAt.push(k);
        for (let u = 1; u < ch.length; u++) cpAt.push(-1);
        k++;
      }
      const starts = [];
      for (const g of seg.segment(s)) starts.push(cpAt[g.index]);
      return starts;
    });
  }, cases);
} finally {
  await browser.close();
}
const text = `${JSON.stringify({ chrome: CHROME_VERSION, segmenter: "Intl.Segmenter('en', { granularity: 'grapheme' })", note: 'starts: the code point index of each grapheme cluster start', cases: cases.map((cps, i) => ({ cps, starts: results[i] })) }, null, 0).replace(/\},\{/g, '},\n{')}\n`;
if (process.argv.includes('--check')) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === text;
  console.log(`grapheme capture: ${cases.length} cases, ${same ? 'unchanged' : 'CHANGED'}`);
  if (!same) process.exitCode = 1;
} else {
  writeFileSync(OUT, text);
  console.log(`grapheme capture: wrote ${cases.length} cases to ${OUT}`);
}
