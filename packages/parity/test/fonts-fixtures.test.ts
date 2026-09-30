// TXT1-C fonts fixtures (notes/T033-txt1c-wiring-spec.md §3 B8): the web-only lane passes every case in both directions, against
// the committed authored captures, which equal a live capture under the stated reference; each planted fonts fault fails its case;
// the rejects are in the parity corpus.
import { readdirSync, readFileSync } from 'node:fs';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompilerFaults } from 'dragon';
import { NO_FAULTS } from 'dragon';
import { captureJson } from '../src/capture.ts';
import { launchChrome } from '../src/chrome.ts';
import { FONT_FIXTURES, FONTS, fontMapOf } from '../src/fixture-groups/fonts.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { fontFaceUrls } from '../src/fixture-reader.ts';
import { authoredFontHtml, committedFontAuthored, faceProblem, readFontCapture, fontCases, fontEmittedDir, fontExpectedDir, fontExpectedPath, liveFontAuthored, runFontFixture } from '../src/fonts-run.ts';
import { pinnedGenerics } from '../src/font-reference.ts';
import { compileFixture, inlineFontAssets, runFixture, webCssOf } from '../src/pipeline.ts';

let browser: Browser;
beforeAll(async () => {
  browser = await launchChrome();
});
afterAll(async () => {
  await browser.close();
});

const fixture = (id: string) => {
  const f = FONT_FIXTURES.find((x) => x.spec.id === id);
  if (f === undefined) throw new Error(id);
  return f;
};

describe('the fonts group', () => {
  it('its rejects are the fonts group of the corpus; its layout fixtures are web-only and outside it, with their own committed files', () => {
    expect(FIXTURE_GROUPS.find((g) => g.id === 'fonts')?.fixtures).toBe(FONTS);
    const corpus = new Set(FIXTURE_GROUPS.flatMap((g) => g.fixtures.map((s) => s.id)));
    for (const f of FONT_FIXTURES) expect(corpus.has(f.spec.id), f.spec.id).toBe(false);
    const ids = FONT_FIXTURES.flatMap((f) => fontCases(f).map((c) => c.id)).sort();
    expect(readdirSync(fontExpectedDir()).sort()).toEqual(ids.map((id) => `${id}.web.json`).sort());
    expect(readdirSync(fontEmittedDir()).sort()).toEqual(ids.map((id) => `${id}.css`).sort());
  });

  it('each reject fails as its registry says', async () => {
    for (const spec of FONTS) {
      const o = await runFixture(spec, browser, { authored: () => Promise.reject(new Error('a reject renders nothing')), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(o.status, `${spec.id}: ${o.reason}`).toBe('pass');
    }
  }, 120_000);

  it('a fixture without a font map compiles as before: no assets, and @font-face url()s resolve only to files under vendor/fonts', () => {
    expect(fontMapOf('block-ua-divs')).toBeUndefined();
    const { input } = compileFixture({ id: 'block-ua-divs', format: 'html', kind: 'layout', gate: 'default', environments: ['ltr'], source: 'hand-written', rootFont: 'ua-default' });
    expect(input.snapshot.assets).toEqual([]);
    expect(input.snapshot.resolutions).toEqual([]);
    expect(fontFaceUrls('@font-face{src:url("../../../vendor/fonts/Inter/Inter-Bold.ttf")} @font-face{src:url(../../../package.json)} @font-face{src:url("https://x/y.ttf")}')).toEqual([
      { specifier: '../../../vendor/fonts/Inter/Inter-Bold.ttf', id: 'vendor/fonts/Inter/Inter-Bold.ttf' },
    ]);
  });

  it('the compiled CSS inlines every font asset, and the authored document every vendored @font-face url()', () => {
    const { compiled } = compileFixture(fixture('fonts-declared').spec, NO_FAULTS, 'derive');
    const css = webCssOf(compiled) ?? '';
    expect(css).toMatch(/src:url\("data:font\/ttf;base64,/);
    expect(css).not.toMatch(/url\("fonts\//);
    const html = readFileSync(new URL('../fixtures/fonts-declared.html', import.meta.url), 'utf8');
    expect(authoredFontHtml(html)).not.toMatch(/vendor\/fonts/);
    const forms = "@font-face{src:url(../../../vendor/fonts/Inter/Inter-Bold.ttf)} @font-face{src:url('../../../vendor/fonts/Inter/Inter-Bold.ttf')} @font-face{src:url(missing.ttf)}";
    expect(authoredFontHtml(forms).match(/url\("data:font\/ttf;base64,/g)?.length).toBe(2);
    expect(authoredFontHtml(forms)).toMatch(/url\(missing\.ttf\)/);
  });

  it('pinnedGenerics: a named family pins under its own name as Chrome folds it, never under another', () => {
    const faces = [{ src: 'vendor/fonts/Lato/Lato-Regular.ttf' }];
    expect(pinnedGenerics({ generics: { monospace: { mode: 'pinned', family: 'Dragon Mono', faces } }, families: { lato: { mode: 'pinned', family: 'Lato', faces } } })).toEqual({ monospace: 'Dragon Mono' });
    expect(() => pinnedGenerics({ generics: {}, families: { Lato: { mode: 'pinned', family: 'Other', faces } } })).toThrow(/cannot rename the family Lato to Other/);
  });

  it('inlineFontAssets inlines every named asset, and throws on a url naming no asset or an asset no url names', () => {
    const a = { path: 'fonts/0123456789abcdef.ttf', bytes: new Uint8Array([1, 2, 3]) };
    expect(inlineFontAssets('.x{color:red}', [])).toBe('.x{color:red}');
    expect(inlineFontAssets(`@font-face{src:url("${a.path}")}`, [a])).toBe('@font-face{src:url("data:font/ttf;base64,AQID")}');
    expect(() => inlineFontAssets('@font-face{src:url("fonts/other.woff2")}', [a])).toThrow(/names fonts\/other\.woff2, which is not a web output asset/);
    expect(() => inlineFontAssets('.x{color:red}', [a])).toThrow(/never names: fonts\/0123456789abcdef\.ttf/);
  });

  it('a committed fonts capture is read checked: its case, direction, Chrome, nodes and canonical form', () => {
    const f = fixture('fonts-platform');
    const [ltr, rtl] = fontCases(f);
    if (ltr === undefined || rtl === undefined) throw new Error('fonts-platform cases');
    const text = readFileSync(fontExpectedPath(ltr.id), 'utf8');
    expect(readFontCapture(ltr, text).fixture).toBe(ltr.id);
    expect(() => readFontCapture(rtl, text)).toThrow(/not fonts-platform-rtl rtl/);
    const cap = JSON.parse(text) as { nodes: Record<string, unknown>[] };
    expect(() => readFontCapture(ltr, JSON.stringify(cap))).toThrow(/not in the form parity:capture writes/);
    expect(() => readFontCapture(ltr, `${JSON.stringify({ ...cap, nodes: [{ ...cap.nodes[0], x: 'NaN' }] }, null, 2)}\n`)).toThrow(/node 0 is malformed/);
    expect(() => readFontCapture(ltr, `${JSON.stringify({ ...cap, nodes: [] }, null, 2)}\n`)).toThrow(/no nodes/);
    expect(() => readFontCapture(ltr, 'null')).toThrow(/not a capture/);
  });

  it('faceProblem accepts only the expected web font, or only platform faces', () => {
    const f = (postScriptName: string, isCustomFont: boolean) => ({ familyName: 'x', postScriptName, isCustomFont, glyphCount: 1 });
    expect(faceProblem('Inter-Regular', [f('Inter-Regular', true)])).toBeNull();
    expect(faceProblem('Inter-Regular', [f('Inter-Regular', false)])).not.toBeNull();
    expect(faceProblem('Inter-Regular', [f('Inter-Regular', true), f('Helvetica', false)])).not.toBeNull();
    expect(faceProblem('platform', [f('Helvetica', false)])).toBeNull();
    expect(faceProblem('platform', [])).not.toBeNull();
    expect(faceProblem('platform', [f('Inter-Regular', true)])).not.toBeNull();
  });
});

describe('the web-only lane', () => {
  for (const f of FONT_FIXTURES) {
    it(`${f.spec.id}: every case passes chrome-dual and renders its expected faces in both documents`, async () => {
      const cases = await runFontFixture(f, browser, { authored: committedFontAuthored });
      expect(cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
      for (const c of cases) expect(c.status, `${c.id}: ${c.reason}`).toBe('pass');
      for (const c of cases) expect(c.features.web.filter((k) => k.startsWith('font-family:')).length, c.id).toBeGreaterThan(0);
    }, 120_000);

    it(`${f.spec.id}: the committed authored captures equal a live capture under the stated reference`, async () => {
      expect(readdirSync(fontExpectedDir()).filter((x) => x.startsWith(`${f.spec.id}.`) || x.startsWith(`${f.spec.id}-rtl.`)).sort()).toEqual(fontCases(f).map((c) => `${c.id}.web.json`).sort());
      const live = liveFontAuthored(browser, f);
      for (const c of fontCases(f)) expect(captureJson(await live(c)), c.id).toBe(readFileSync(fontExpectedPath(c.id), 'utf8'));
    }, 120_000);
  }
});

describe('planted fonts faults fail their named case', () => {
  const planted: readonly [keyof CompilerFaults, string][] = [
    ['pinnedGenericNotRewritten', 'fonts-pinned-sans'],
    ['fontFaceNotEmitted', 'fonts-declared'],
  ];
  it('unmappedFamilyAccepted fails reject-fonts-unmapped', async () => {
    const spec = FONTS.find((s) => s.id === 'reject-fonts-unmapped');
    if (spec === undefined) throw new Error('reject-fonts-unmapped');
    const o = await runFixture(spec, browser, { authored: () => Promise.reject(new Error('a reject renders nothing')), faults: { ...NO_FAULTS, unmappedFamilyAccepted: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect(o.status).toBe('fail');
  });
  it('a text element with no expected face fails its case', async () => {
    const cases = await runFontFixture({ ...fixture('fonts-platform'), faces: {} }, browser, { authored: committedFontAuthored });
    for (const c of cases) expect(c.reason, c.id).toMatch(/text has text but no expected face/);
  }, 120_000);
  for (const [fault, id] of planted) {
    it(`${fault} fails ${id}`, async () => {
      const cases = await runFontFixture(fixture(id), browser, { authored: committedFontAuthored, faults: { ...NO_FAULTS, [fault]: true } });
      expect(cases.some((c) => c.status === 'fail'), fault).toBe(true);
    }, 120_000);
  }
});
