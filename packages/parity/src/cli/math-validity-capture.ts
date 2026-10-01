// Captures packages/dragon/test/data/math-validity-chrome.json from the pinned Chrome (T131): CSS.supports for every corpus pair
// (packages/dragon/test/data/math-validity-corpus.json), and the cascade outcome when an invalid calculation follows a valid
// declaration of the same property, in both directions. It lives here because the dragon suite runs without a browser.
// Run: node --conditions=dragon-internal packages/parity/src/cli/math-validity-capture.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, launchChrome } from '../chrome.ts';

const OUT = new URL('../../../dragon/test/data/math-validity-chrome.json', import.meta.url);
const CORPUS = JSON.parse(readFileSync(new URL('../../../dragon/test/data/math-validity-corpus.json', import.meta.url), 'utf8')) as { properties: string[]; values: string[]; undetermined: string[] };
const MATH_VALIDITY_PROPERTIES = CORPUS.properties;
const MATH_VALIDITY_VALUES = CORPUS.values;
const MATH_VALIDITY_UNDETERMINED = CORPUS.undetermined;

/** The cascade cases: an earlier valid declaration, then one Chrome drops; what Chrome computes and lays out. */
const CASCADE = `<!DOCTYPE html><html><head><style>
body { margin: 0; font: 10px/1 monospace; }
.row { display: flex; width: 300px; }
.w { border-left-style: solid; border-left-width: 3px; border-left-width: calc(1px + 5%); width: 10px; height: 10px; }
.g { flex-grow: 2; flex-grow: calc(1 + 5%); height: 10px; }
.h { flex-grow: 1; height: 10px; }
</style></head><body><div class="row"><div id="w" class="w"></div><div id="g" class="g"></div><div id="h" class="h"></div></div></body></html>`;

const browser = await launchChrome();
try {
  const page = await browser.newPage();
  const rows = await page.evaluate(([props, values]) => props.flatMap((p) => values.map((v) => [p, v, CSS.supports(p, v)] as const)), [MATH_VALIDITY_PROPERTIES, [...MATH_VALIDITY_VALUES, ...MATH_VALIDITY_UNDETERMINED]] as const);
  const cascade: Record<string, unknown> = {};
  for (const direction of ['ltr', 'rtl'] as const) {
    await page.setContent(CASCADE.replace('<html>', `<html dir="${direction}">`));
    cascade[direction] = await page.evaluate(() => {
      const box = (id: string) => {
        const e = document.getElementById(id) as HTMLElement;
        const r = e.getBoundingClientRect();
        const s = getComputedStyle(e);
        return { x: r.x, width: r.width, borderLeftWidth: s.borderLeftWidth, flexGrow: s.flexGrow };
      };
      return { w: box('w'), g: box('g'), h: box('h') };
    });
  }
  writeFileSync(OUT, `${JSON.stringify({ chrome: CHROME_VERSION, cascade, rows }, null, 0).replace(/\],\[/g, '],\n[')}\n`);
  console.log(`${rows.length} rows, ${rows.filter((r) => !r[2]).length} invalid in Chrome`);
} finally {
  await browser.close();
}
