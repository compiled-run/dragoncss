// Captures the stated reference of a pinned generic family (T011, notes/T033-txt1c-wiring-spec.md §1.3): Chrome renders the
// authored document with the pinned faces injected as @font-face rules and every unquoted pinned generic replaced by the pinned
// family in Chrome's own CSSOM (Chrome's parse and serialization, rewritten in the page; Dragon's family-list.ts is not used).
// P1 records what CDP Page.setFontFamilies does with a web font family (the rejected mechanism), P2 runs the rewrite over a corpus
// of family lists and reads each text node's face with CSS.getPlatformFontsForNode, P3 checks the rewrite changes nothing in a
// document without pinned generics. Writes packages/dragon/test/fonts/reference/*.json.
// Run with: node --conditions=dragon-internal scripts/capture-font-reference.ts [--check [--plant <name>]]
// --check captures again into a temporary directory and requires the committed files to be byte-identical and every probe
// expectation to hold. --plant breaks the in-page rewrite (quoted-generic-rewritten, generic-not-rewritten); only with --check.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, chromeArgsAt, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import type { PageEnvironment } from '../packages/parity/src/chrome.ts';
import { applyFontReference, pinnedFaceCss, pinnedGenerics, platformFonts, REFERENCE_PLANTS, settleFonts } from '../packages/parity/src/font-reference.ts';
import type { ReferencePlant, Visit } from '../packages/parity/src/font-reference.ts';
import type { FontMap } from '../packages/dragon/src/index.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { hostPlatform } from '../packages/parity/src/platform.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<typeof openPage>>;

const REFERENCE_DIR = 'packages/dragon/test/fonts/reference';
const PLANTS = REFERENCE_PLANTS;
type Plant = ReferencePlant;

const LIGHT = 'Inter/Inter-Light.ttf';
const REGULAR = 'Inter/Inter-Regular.ttf';
const ITALIC = 'Inter/Inter-Italic.ttf';
const BOLD = 'Inter/Inter-Bold.ttf';
const BOLDITALIC = 'Inter/Inter-BoldItalic.ttf';
const MONO = 'NotoSansMono/NotoSansMono-Regular.ttf';
const FONT_FILES = [LIGHT, REGULAR, ITALIC, BOLD, BOLDITALIC, MONO] as const;

/** The reference font map (T033 §1.1): sans-serif is "Dragon Sans" (Inter 4.1 static), monospace is "Dragon Mono"; system-ui is platform. */
const REFERENCE_MAP = {
  generics: {
    'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [
      { src: `fonts/${LIGHT}`, weight: '300' }, { src: `fonts/${REGULAR}`, weight: '400' }, { src: `fonts/${ITALIC}`, weight: '400', style: 'italic' },
      { src: `fonts/${BOLD}`, weight: '700' }, { src: `fonts/${BOLDITALIC}`, weight: '700', style: 'italic' },
    ] },
    monospace: { mode: 'pinned', family: 'Dragon Mono', faces: [{ src: `fonts/${MONO}` }] },
    'system-ui': { mode: 'platform' },
  },
} as const;

/** Unquoted generic keyword to pinned family, from the map; what the in-page rewrite replaces. */
const PINNED: Record<string, string> = pinnedGenerics(REFERENCE_MAP as unknown as FontMap);

const bytesOf = (f: string): Buffer => readFileSync(repoPath(`vendor/fonts/${f}`));
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const fontHashes = Object.fromEntries(FONT_FILES.map((f) => [f, sha(bytesOf(f))]));
const DPR = 1;

const header = () => ({
  chrome: CHROME_VERSION,
  playwright: PLAYWRIGHT_VERSION,
  platform: hostPlatform(),
  launches: [{ dpr: DPR, flags: chromeArgsAt(DPR) }],
  fonts: fontHashes,
});


/** The pinned faces as @font-face rules, src written as url("fonts/<file>"); embed() gives Chrome the same bytes as data: URIs. */
const PINNED_FACE_CSS = pinnedFaceCss(REFERENCE_MAP as unknown as FontMap, (src) => src);
const embed = (css: string): string => css.replace(/url\("fonts\/([^"]+)"\)/g, (_m, f: string) => `url("data:font/ttf;base64,${bytesOf(f).toString('base64')}")`);

const ENV: PageEnvironment = { viewport: { width: 800, height: 600 }, devicePixelRatio: DPR, direction: 'ltr', rootFont: 'ua-default' };

/** The stated-reference transform (packages/parity/src/font-reference.ts), with the reference map's faces embedded as data: URLs. */
const applyReference = (page: Page, plant: Plant | null): Promise<Visit[]> => applyFontReference(page, embed(PINNED_FACE_CSS), PINNED, plant);
const settle = settleFonts;

const doc = (css: string, body: string): string => `<!DOCTYPE html><html><head><style>${css}</style></head><body>${body}</body></html>`;

// ---------------------------------------------------------------------------------------------------------------- P1
/** Page.setFontFamilies: does Chrome resolve the sans-serif setting against @font-face families? Recorded as data. */
async function probeSetFontFamilies(browser: Browser): Promise<unknown> {
  const variants = [
    { id: 'no-setting', setting: null, faces: true },
    { id: 'setting-web-font', setting: 'Dragon Sans', faces: true },
    { id: 'setting-web-font-no-face', setting: 'Dragon Sans', faces: false },
  ] as const;
  const rows = [];
  for (const v of variants) {
    const page = await openPage(browser, doc('', ''), ENV);
    if (v.setting !== null) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Page.setFontFamilies', { fontFamilies: { sansSerif: v.setting } });
      await cdp.detach();
    }
    await page.setContent(doc(v.faces ? embed(PINNED_FACE_CSS) : '', '<div id="t" style="font-family:sans-serif">AaBb</div>'));
    await settle(page);
    const [fonts] = await platformFonts(page, ['#t']);
    const computed = await page.evaluate(() => getComputedStyle(document.getElementById('t') as Element).fontFamily);
    await page.context().close();
    const used = fonts ?? [];
    rows.push({ id: v.id, setting: v.setting, fontFaceRules: v.faces ? PINNED_FACE_CSS : '', computed, chrome: used, usesPinnedFace: used.length === 1 && used[0]?.isCustomFont === true && used[0]?.postScriptName === 'Inter-Regular' });
  }
  return { ...header(), probe: 'P1', note: 'data only: the stated reference uses the CSSOM rewrite (P2), not Page.setFontFamilies', variants: rows };
}

// ---------------------------------------------------------------------------------------------------------------- P2
/** authored: the font-family list as written, when Chrome's serialization of it is lossy or decodes escapes (Dragon reads the source). */
type P2Case = { readonly id: string; readonly css: string; readonly body: string; readonly expect: string; readonly authored?: string };
const T = 'AaBb';
const P2_CASES: readonly P2Case[] = [
  { id: 'unquoted', css: '.c{font-family:sans-serif}', body: `<div class="c">${T}</div>`, expect: 'Inter-Regular' },
  { id: 'unquoted-300', css: '.c{font-family:sans-serif;font-weight:300}', body: `<div class="c">${T}</div>`, expect: 'Inter-Light' },
  { id: 'unquoted-700', css: '.c{font-family:sans-serif;font-weight:700}', body: `<div class="c">${T}</div>`, expect: 'Inter-Bold' },
  { id: 'unquoted-italic', css: '.c{font-family:sans-serif;font-style:italic}', body: `<div class="c">${T}</div>`, expect: 'Inter-Italic' },
  { id: 'unquoted-700-italic', css: '.c{font-family:sans-serif;font-weight:700;font-style:italic}', body: `<div class="c">${T}</div>`, expect: 'Inter-BoldItalic' },
  { id: 'ua-bold-h1', css: 'h1{font-family:sans-serif}', body: `<h1 class="c">${T}</h1>`, expect: 'Inter-Bold' },
  { id: 'quoted', css: '.c{font-family:"sans-serif"}', body: `<div class="c">${T}</div>`, expect: 'platform' },
  { id: 'lato-then-generic', css: ".c{font-family:'Lato', sans-serif}", body: `<div class="c">${T}</div>`, expect: 'Inter-Regular' },
  { id: 'unknown-then-generic', css: '.c{font-family:Unknown Family, sans-serif}', body: `<div class="c">${T}</div>`, expect: 'Inter-Regular' },
  { id: 'monospace', css: '.c{font-family:monospace}', body: `<div class="c">${T}</div>`, expect: 'NotoSansMono-Regular' },
  { id: 'monospace-then-sans', css: '.c{font-family:monospace, sans-serif;font-weight:700}', body: `<div class="c">${T}</div>`, expect: 'NotoSansMono-Regular' },
  { id: 'system-ui', css: '.c{font-family:system-ui}', body: `<div class="c">${T}</div>`, expect: 'platform' },
  { id: 'system-ui-then-sans', css: '.c{font-family:system-ui, sans-serif}', body: `<div class="c">${T}</div>`, expect: 'platform' },
  { id: 'case-folded', css: '.c{font-family:SANS-SERIF}', body: `<div class="c">${T}</div>`, expect: 'Inter-Regular' },
  { id: 'shorthand-700', css: '.c{font:700 16px sans-serif}', body: `<div class="c">${T}</div>`, expect: 'Inter-Bold' },
  { id: 'shorthand-italic', css: '.c{font:italic 16px/1.25 sans-serif}', body: `<div class="c">${T}</div>`, expect: 'Inter-Italic' },
  { id: 'shorthand-quoted', css: '.c{font:16px "sans-serif"}', body: `<div class="c">${T}</div>`, expect: 'platform' },
  { id: 'shorthand-monospace', css: '.c{font:300 13px monospace}', body: `<div class="c">${T}</div>`, expect: 'NotoSansMono-Regular' },
  { id: 'style-attribute', css: '', body: `<div class="c" style="font-family:sans-serif;font-weight:700">${T}</div>`, expect: 'Inter-Bold' },
  { id: 'inside-media', css: '@media (min-width:1px){.c{font-family:sans-serif;font-style:italic}}', body: `<div class="c">${T}</div>`, expect: 'Inter-Italic' },
  { id: 'important-beats-attribute', css: '.c{font-family:sans-serif !important}', body: `<div class="c" style="font-family:serif">${T}</div>`, expect: 'Inter-Regular' },
  { id: 'inherited', css: '.p{font-family:sans-serif}', body: `<div class="p"><span class="c">${T}</span></div>`, expect: 'Inter-Regular' },
  { id: 'quoted-monospace', css: '.c{font-family:"monospace"}', body: `<div class="c">${T}</div>`, expect: 'platform' },
  { id: 'escaped-generic', css: '.c{font-family:s\\61ns-serif}', body: `<div class="c">${T}</div>`, expect: 'Inter-Regular', authored: 's\\61ns-serif' },
  { id: 'quoted-escaped-generic', css: '.c{font-family:"s\\61ns-serif"}', body: `<div class="c">${T}</div>`, expect: 'platform', authored: '"s\\61ns-serif"' },
  { id: 'quoted-upper-then-mono', css: '.c{font-family:"SANS-SERIF", monospace}', body: `<div class="c">${T}</div>`, expect: 'NotoSansMono-Regular', authored: '"SANS-SERIF", monospace' },
  { id: 'quoted-ui-serif', css: '.c{font-family:"ui-serif"}', body: `<div class="c">${T}</div>`, expect: 'platform', authored: '"ui-serif"' },
];

async function probeRewrite(browser: Browser, plant: Plant | null): Promise<unknown> {
  const rows = [];
  for (const c of P2_CASES) {
    const page = await openPage(browser, doc(c.css, c.body), ENV);
    const visits = await applyReference(page, plant);
    const [fonts] = await platformFonts(page, ['.c']);
    const computed = await page.evaluate(() => getComputedStyle(document.querySelector('.c') as Element).fontFamily);
    await page.context().close();
    const chrome = fonts ?? [];
    const ok = c.expect === 'platform'
      ? chrome.length > 0 && chrome.every((f) => !f.isCustomFont)
      : chrome.length === 1 && chrome[0]?.isCustomFont === true && chrome[0]?.postScriptName === c.expect;
    rows.push({ id: c.id, css: c.css, body: c.body, ...(c.authored === undefined ? {} : { authored: c.authored }), visits, computed, chrome, expect: c.expect, ok });
  }
  return { ...header(), probe: 'P2', map: REFERENCE_MAP, fontFaceRules: PINNED_FACE_CSS, cases: rows };
}

// ---------------------------------------------------------------------------------------------------------------- P3
const P3_CSS = [
  'body{margin:8px}',
  '.a{font-family:Ahem;font-size:20px;line-height:1.5}',
  '.b{font-family:"sans-serif";font-weight:700}',
  '.c{font:italic 13px/1.4 serif}',
  '.d{font-family:system-ui;display:flex;gap:4px}',
  '.d>span{flex:1;font-family:Times, "monospace"}',
  '.e{font-family:Unknown Family, fantasy;width:120px;padding:3px}',
  '@media (min-width:1px){.f{font-family:cursive;font-size:17.5px}}',
].join('\n');
const P3_BODY = [
  '<div class="a" id="a">Ahem text</div>',
  '<div class="b" id="b">Quoted generic</div>',
  '<p class="c" id="c">Serif italic <b>bold</b></p>',
  '<div class="d" id="d"><span>one</span><span>two words</span></div>',
  '<div class="e" id="e">wrap wrap wrap wrap wrap wrap</div>',
  '<div class="f" id="f" style="font-family:system-ui, serif">attr</div>',
  '<h1 id="h">Heading</h1>',
].join('');

async function snapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('body, body *')];
    return JSON.stringify(els.map((el) => {
      const cs = getComputedStyle(el);
      const props: string[] = [];
      for (let i = 0; i < cs.length; i++) {
        const name = cs.item(i);
        props.push(`${name}:${cs.getPropertyValue(name)}`);
      }
      const r = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = [...range.getClientRects()].map((t) => [t.x, t.y, t.width, t.height]);
      return { tag: el.tagName, id: el.id, props, box: [r.x, r.y, r.width, r.height], text };
    }));
  });
}

async function probeControl(browser: Browser, plant: Plant | null): Promise<unknown> {
  const page = await openPage(browser, doc(P3_CSS, P3_BODY), ENV);
  const before = await snapshot(page);
  const visits = await applyReference(page, plant);
  const after = await snapshot(page);
  await page.context().close();
  const parsed = JSON.parse(before) as { props: string[] }[];
  return {
    ...header(), probe: 'P3', css: P3_CSS, body: P3_BODY, visits,
    elements: parsed.length, computedValues: parsed.reduce((n, e) => n + e.props.length, 0),
    before: sha(before), after: sha(after), identical: before === after,
  };
}

// ---------------------------------------------------------------------------------------------------------------- main
const FILES = ['p1-set-font-families.json', 'p2-cssom-rewrite.json', 'p3-control.json'] as const;

async function captureAll(dir: string, plant: Plant | null): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const write = (name: string, v: unknown): void => writeFileSync(join(dir, name), `${JSON.stringify(v, null, 1)}\n`);
  const failures: string[] = [];
  const browser = await launchChrome(DPR);
  try {
    write(FILES[0], await probeSetFontFamilies(browser));
    const p2 = (await probeRewrite(browser, plant)) as { cases: { id: string; ok: boolean }[] };
    write(FILES[1], p2);
    for (const c of p2.cases) if (!c.ok) failures.push(`P2 ${c.id}: Chrome did not use the expected face`);
    const p3 = (await probeControl(browser, plant)) as { identical: boolean };
    write(FILES[2], p3);
    if (!p3.identical) failures.push('P3: the rewrite changed a computed value or box in the control document');
  } finally {
    await browser.close();
  }
  return failures;
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const plantAt = args.indexOf('--plant');
const plantName = plantAt < 0 ? null : args[plantAt + 1];
if (plantName !== null && !(PLANTS as readonly (string | undefined)[]).includes(plantName)) {
  console.error(`--plant takes one of ${PLANTS.join(', ')}`);
  process.exit(2);
}
const plant = plantName as Plant | null;
if (plant !== null && !check) {
  console.error('--plant is only allowed with --check, so a planted capture is never committed');
  process.exit(2);
}

if (!check) {
  const failures = await captureAll(repoPath(REFERENCE_DIR), null);
  for (const f of failures) console.error(f);
  if (failures.length > 0) process.exit(1);
  console.log(`font reference written to ${REFERENCE_DIR}`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'dragon-font-reference-'));
  try {
    const failures = await captureAll(tmp, plant);
    const committed = readdirSync(repoPath(REFERENCE_DIR)).sort();
    const fresh = readdirSync(tmp).sort();
    const differ = fresh.filter((f) => !committed.includes(f) || !readFileSync(join(tmp, f)).equals(readFileSync(repoPath(join(REFERENCE_DIR, f)))));
    const extra = committed.filter((f) => !fresh.includes(f));
    if (differ.length > 0 || extra.length > 0) failures.push(`font reference differs from a fresh Chrome capture: ${[...differ, ...extra].join(', ')}`);
    for (const f of failures) console.error(f);
    if (failures.length > 0) process.exitCode = 1;
    else console.log(`font reference byte-identical to a fresh capture (${fresh.length} files), every probe expectation holds`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
