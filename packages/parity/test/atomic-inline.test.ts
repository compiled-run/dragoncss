// INL2a (notes/T059J-inl2.md): the compare.ts anonymous-box rule for atomic inlines, and the group's planted faults. An anonymous
// box passes when it holds a compared text line or atomic inline and nothing it holds is uncompared; the engine plants fail a named
// atomic-inline case at every DPR against the committed Chrome captures, and the compiler plant fails the space case in both
// directions. The unfaulted runs pass.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutInput, LayoutRect, LayoutStyle } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { compareLayout } from '../src/compare.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { committedDprCapture, DPRS, runDprCase } from '../src/dpr.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { compileFixture, runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

const STYLE = {
  display: 'block', position: 'static', top: { kind: 'auto' }, right: { kind: 'auto' }, bottom: { kind: 'auto' }, left: { kind: 'auto' },
  overflowX: 'visible', overflowY: 'visible', direction: 'ltr', boxSizing: 'content-box', width: { kind: 'auto' }, height: { kind: 'auto' },
  minWidth: { kind: 'auto' }, minHeight: { kind: 'auto' }, maxWidth: { kind: 'none' }, maxHeight: { kind: 'none' },
  marginTop: { kind: 'px', value: 0 }, marginRight: { kind: 'px', value: 0 }, marginBottom: { kind: 'px', value: 0 }, marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 }, paddingRight: { kind: 'px', value: 0 }, paddingBottom: { kind: 'px', value: 0 }, paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 }, borderRightWidth: { kind: 'px', value: 0 }, borderBottomWidth: { kind: 'px', value: 0 }, borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: { kind: 'auto' }, order: 0, justifyContent: 'normal',
  alignItems: 'normal', alignSelf: 'auto', alignContent: 'normal', rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start',
  verticalAlign: { kind: 'keyword', value: 'baseline' }, aspectRatio: { kind: 'auto' },
} as const satisfies LayoutStyle;

describe('compare.ts: an anonymous box holding only atomic inlines', () => {
  const font = { family: 'Ahem', size: 10, specifiedSize: { kind: 'px', value: 10 }, absoluteSize: true } as const;
  const atomic = (id: string): LayoutBox => ({ kind: 'box', id, boxType: 'element', style: { ...STYLE, display: 'inline-block' }, strut: null, children: [] });
  const input = (kids: readonly LayoutBox[]): LayoutInput => ({
    viewport: { width: 400, height: 300 }, devicePixelRatio: 1, viewportUnits: { small: { width: 400, height: 300 }, large: { width: 400, height: 300 }, dynamic: { width: 400, height: 300 } },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16,
    root: { kind: 'box', id: 'r', boxType: 'element', style: STYLE, strut: null, children: [{ kind: 'box', id: 'r:anon0', boxType: 'anonymous', style: STYLE, strut: { font, lineHeight: { kind: 'normal' } }, children: kids }] },
  });
  const rect = (id: string, parent: string | null): LayoutRect => ({ id, parent, x: 0 as LayoutRect['x'], y: 0 as LayoutRect['y'], width: 640 as LayoutRect['width'], height: 640 as LayoutRect['height'] });
  const capture = (ids: readonly string[]): WebCapture => ({
    fixture: 't', chrome: CHROME_VERSION, browser: 'b', platform: 'p', viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr',
    nodes: ids.map((id) => ({ id, kind: 'element', hasBox: true, x: 0, y: 0, width: 10, height: 10, computed: null })),
  });
  const absolute = (ids: readonly string[]): Map<string, LayoutRect> => new Map([['r', rect('r', null)], ['r:anon0', rect('r:anon0', 'r')], ...ids.map((id) => [id, rect(id, 'r:anon0')] as const)]);
  it('passes when every atomic inline it holds is compared with Chrome', () => {
    const c = compareLayout(capture(['r', 'a', 'b']), absolute(['a', 'b']), input([atomic('a'), atomic('b')]), ENVIRONMENT);
    expect(c.problems).toEqual([]);
    expect(c.pass).toBe(true);
  });
  it('fails when an atomic inline it holds is uncompared', () => {
    const c = compareLayout(capture(['r', 'a']), absolute(['a', 'b']), input([atomic('a'), atomic('b')]), ENVIRONMENT);
    expect(c.problems).toContain('r:anon0: anonymous box whose text lines are not all compared with Chrome (b)');
    expect(c.pass).toBe(false);
  });
  it('fails when it holds no text line and no atomic inline', () => {
    const c = compareLayout(capture(['r']), absolute([]), input([]), ENVIRONMENT);
    expect(c.problems).toContain('r:anon0: anonymous box whose text lines are not all compared with Chrome (no lines)');
  });
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

describe('INL2a engine plants fail a named atomic-inline case at every DPR (committed captures)', () => {
  const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly fixture: string }[] = [
    { fault: 'inlineBlockFirstBaseline', fixture: 'atomic-inline-block' },
    { fault: 'overflowBaselineIgnored', fixture: 'atomic-inline-block' },
    { fault: 'inlineFlexLastBaseline', fixture: 'atomic-inline-flex' },
    { fault: 'atomicMarginExcluded', fixture: 'atomic-inline-shrink' },
    { fault: 'noBreakAroundAtomic', fixture: 'atomic-inline-breaks' },
    { fault: 'atomicShrinkToFitIgnored', fixture: 'atomic-inline-shrink' },
  ];
  it.each(PLANTS)('$fault fails $fixture at DPR 1, 2, 3 and 2.625 in each direction; unfaulted it passes', (p) => {
    const spec = FIXTURES.find((x) => x.id === p.fixture);
    if (spec === undefined) throw new Error(`${p.fixture} is not registered`);
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
  });
});

describe.sequential('INL2a compiler plant', () => {
  it('atomicCollapsesAsLineEnd: atomic-inline-breaks fails in both directions on the space leaves; unfaulted it passes', async () => {
    const spec = FIXTURES.find((f) => f.id === 'atomic-inline-breaks');
    if (spec === undefined) throw new Error('atomic-inline-breaks is not registered');
    const run = (faults: typeof NO_FAULTS) => runFixture(spec, browser, { authored: committedAuthored, faults, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
    expect((await run(NO_FAULTS)).reason).toBeNull();
    const faulty = await run({ ...NO_FAULTS, atomicCollapsesAsLineEnd: true });
    expect(faulty.status).toBe('fail');
    expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
    for (const c of faulty.cases) {
      expect(c.status, c.id).toBe('fail');
      expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id), c.id).toEqual(expect.arrayContaining(['space:text0:line0']));
    }
  });
});
