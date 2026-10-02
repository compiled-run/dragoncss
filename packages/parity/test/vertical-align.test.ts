// INL2b (notes/T059J-inl2.md ruling 2): the vertical-align group's planted faults against the committed Chrome captures. Each engine
// plant fails its named case at DPR 1, 2, 3 and 2.625 in each direction, the compiler plant verticalAlignDropped fails its cases in
// both directions, and the unfaulted runs pass. Plus the Chrome CSS.supports matrix for vertical-align against the generated grammar
// (ruling 7: scripts/gen-css-grammar.ts SYNTAX_OVERRIDES).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { committedDprCapture, DPRS, runDprCase } from '../src/dpr.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { compileFixture, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';
import { parseStylesheet } from 'dragon';
import type { Diagnostic } from 'dragon';

const specOf = (id: string) => {
  const spec = FIXTURES.find((x) => x.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  return spec;
};

describe('INL2b engine plants fail a named vertical-align case at every DPR (committed captures)', () => {
  const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly fixture: string }[] = [
    { fault: 'topBottomSinglePass', fixture: 'inline-vertical-align-top-bottom' },
    { fault: 'middleWithoutXHeight', fixture: 'inline-vertical-align-keywords' },
    { fault: 'middleWithoutXHeight', fixture: 'inline-vertical-align-atomic' },
    { fault: 'middleWithoutXHeight', fixture: 'inline-vertical-align-lato' },
    { fault: 'subShiftOwnFont', fixture: 'inline-vertical-align-keywords' },
    { fault: 'subShiftOwnFont', fixture: 'inline-vertical-align-tags' },
    { fault: 'subShiftOwnFont', fixture: 'inline-vertical-align-lato' },
  ];
  it.each(PLANTS)('$fault fails $fixture at DPR 1, 2, 3 and 2.625 in each direction; unfaulted it passes', (p) => {
    const spec = specOf(p.fixture);
    const cases = casesOf(spec, fixtureInput(spec));
    expect(cases.map((c) => c.environment.direction)).toEqual(['ltr', 'rtl']);
    for (const c of cases) {
      const { compiled } = compileFixture(spec, NO_FAULTS, 'enforce', c.environment.direction);
      for (const dpr of [1, ...DPRS]) {
        const capture = committedDprCapture(c.id, dpr);
        expect(runDprCase(c, compiled, dpr, capture).reason, `${c.id} ${dpr}`).toBeNull();
        expect(runDprCase(c, compiled, dpr, capture, { ...NO_ENGINE_FAULTS, [p.fault]: true }).status, `${c.id} ${dpr}`).toBe('fail');
      }
    }
  }, 600_000);
});

let browser: Browser;
beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});
afterAll(async () => {
  await browser.close();
});

describe.sequential('INL2b compiler plant', () => {
  it.each(['inline-vertical-align-keywords', 'inline-vertical-align-atomic', 'inline-vertical-align-tags'])('verticalAlignDropped: %s fails in both directions; unfaulted it passes', async (id) => {
    const spec = specOf(id);
    const run = (faults: typeof NO_FAULTS) => runFixture(spec, browser, { authored: committedAuthored, faults, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect((await run(NO_FAULTS)).reason).toBeNull();
    const faulty = await run({ ...NO_FAULTS, verticalAlignDropped: true });
    expect(faulty.cases.map((c) => [c.direction, c.status])).toEqual([['ltr', 'fail'], ['rtl', 'fail']]);
  }, 600_000);
});

// Ruling 7: Chrome's CSS.supports for vertical-align equals the generated grammar's verdict (css-tree over grammar.generated.ts,
// through the stylesheet parser) on every keyword, lengths, percentages and calculations, and css-inline-3 forms Chrome 145 rejects.
/** Whether Dragon's stylesheet parser keeps vertical-align: v (a declaration that sets the longhand, with no diagnostic). */
function parsesVerticalAlign(v: string): boolean {
  const css = `.a { vertical-align: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: { uri: 'dragon-source://test/va.css', revision: 'r1', hash: 'sha256:0' }, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = rules[0]?.declarations[0];
  return diagnostics.length === 0 && d !== undefined && d.longhands.some((l) => l.property === 'vertical-align');
}

const SUPPORTS_MATRIX: readonly string[] = [
  'baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom', '-webkit-baseline-middle',
  'BASELINE', 'Middle', '5px', '-5px', '0', '1.5em', '2rem', '50%', '-12.5%', 'calc(10% + 2px)', 'calc(1px * 3)', 'min(1px, 2%)',
  'first', 'last', 'sub 2px', 'first baseline', 'center', 'alphabetic', 'text-before-edge', 'baseline-middle', 'none', 'auto', '5', '1px 2px', 'inherit',
];

describe.sequential('INL2b vertical-align grammar', () => {
  it('Chrome 145 CSS.supports agrees with the generated grammar on every case of the matrix (N/N)', async () => {
    const page = await (await browser.newContext()).newPage();
    try {
      const chrome = await page.evaluate((vs) => vs.map((v) => CSS.supports('vertical-align', v)), [...SUPPORTS_MATRIX]);
      const dragon = SUPPORTS_MATRIX.map((v) => parsesVerticalAlign(v));
      const disagree = SUPPORTS_MATRIX.filter((v, i) => chrome[i] !== dragon[i]).map((v, i) => `${v}: Chrome ${String(chrome[SUPPORTS_MATRIX.indexOf(v)])}`);
      expect(disagree).toEqual([]);
      expect(chrome.filter((x) => x).length).toBeGreaterThan(10);
      expect(chrome.filter((x) => !x).length).toBeGreaterThan(10);
    } finally {
      await page.context().close();
    }
  }, 120_000);
});
