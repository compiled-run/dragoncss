// MQ-a Phase B (notes/T025 §3 B items 6, 8 and 10): the web band sweep against the committed records, the sample choice, the
// planted compiler faults through the parity pipeline and the sweep, and the native refusal through the public entry.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { createProject, NO_FAULTS } from 'dragon';
import { band } from '../../dragon/src/media/index.ts';
import { parseMediaQueryList } from '../../dragon/src/media/index.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { readHtmlFixture } from '../src/fixture-reader.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { checkRecords, mediaFixtures, partitionOf, recordPass, sampleViewports, sweepFixture } from '../src/media-sweep.ts';
import type { SweepRecord } from '../src/media-sweep.ts';
import { runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

let browser: Browser;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser.close();
});

const partition = (...queries: string[]) => {
  const p = band(queries.map((q) => parseMediaQueryList(q)));
  if (p.kind !== 'bands') throw new Error(p.detail);
  return p;
};

describe('media sweep samples', () => {
  it('samples each side of every boundary and one width inside every band', () => {
    const { samples, unsampled } = sampleViewports(partition('(max-width: 400px)'), ENVIRONMENT.viewport);
    expect(samples.map((s) => [s.width, s.band])).toEqual([[200, 0], [399, 0], [400, 0], [401, 1], [500, 1]]);
    expect(unsampled).toEqual([]);
  });
  it('a band no whole-px viewport lies in is reported, never skipped', () => {
    const p = partition('(max-width: 400px)', '(min-width: 400.5px)');
    expect(sampleViewports(p, ENVIRONMENT.viewport).unsampled).toEqual([1]);
  });
  it('height atoms are sampled at the fixture width', () => {
    const { samples } = sampleViewports(partition('(min-height: 200px)'), ENVIRONMENT.viewport);
    expect(samples.map((s) => [s.width, s.height, s.band])).toEqual([[400, 100, 0], [400, 199, 0], [400, 200, 1], [400, 201, 1], [400, 300, 1]]);
  });
  it('a sheet whose @media rules have no width or height atom is sampled once, at the fixture viewport', () => {
    expect(sampleViewports(partition('print', 'screen'), ENVIRONMENT.viewport)).toEqual({ samples: [{ width: 400, height: 300, band: 0 }], unsampled: [] });
  });
  it('the partition is read from every @media prelude of the fixture, nested ones included', () => {
    const p = partitionOf(readHtmlFixture('media-nested').html.split('<style>')[1]?.split('</style>')[0] ?? '');
    expect(p?.kind === 'bands' ? p.atoms.map((a) => a.text) : p).toEqual(['(min-width: 300px)', '(max-width: 500px)', '(max-width: 350px)', '(max-width: 250px)', '(min-width: 100px)']);
  });
});

describe.sequential('the web band sweep in Chrome', () => {
  let records: SweepRecord[] = [];
  it('every media fixture is equal in Chrome, authored and compiled, at every sample in both directions, and matches the committed records', async () => {
    records = [];
    for (const spec of mediaFixtures()) records.push(...(await sweepFixture(spec, browser)));
    expect(records.filter((r) => !recordPass(r)).map((r) => [r.fixture, r.direction, r.problem, r.samples.filter((s) => !s.pass)])).toEqual([]);
    expect(records.length).toBe(2 * mediaFixtures().length);
    for (const r of records) expect(new Set(r.samples.map((s) => s.band)).size, `${r.fixture} ${r.direction}`).toBe(r.bands.length);
    expect(checkRecords(records)).toEqual([]);
  }, 600_000);
  it('mediaConditionIgnored fails sweep samples of media-max-width in both directions', async () => {
    const spec = mediaFixtures().find((f) => f.id === 'media-max-width');
    if (spec === undefined) throw new Error('media-max-width is not registered');
    const faulty = await sweepFixture(spec, browser, { ...NO_FAULTS, mediaConditionIgnored: true });
    for (const r of faulty) {
      expect(recordPass(r), r.direction).toBe(false);
      // Every rule applies, so only the widths where every condition holds (399 and below) stay equal.
      expect(r.samples.filter((s) => !s.pass).map((s) => s.width), r.direction).toEqual([400, 401, 402, 501]);
    }
  }, 120_000);
  it('mediaBandOffByOne fails the sweep sample at each boundary width', async () => {
    const spec = mediaFixtures().find((f) => f.id === 'media-max-width');
    if (spec === undefined) throw new Error('media-max-width is not registered');
    for (const r of await sweepFixture(spec, browser, { ...NO_FAULTS, mediaBandOffByOne: true })) {
      expect(r.samples.filter((s) => !s.pass).map((s) => s.width), r.direction).toEqual([399, 400, 401]);
    }
  }, 120_000);
});

describe.sequential('MQ-a planted compiler faults through the parity pipeline', () => {
  const PLANTED = [
    { fault: 'mediaConditionIgnored', lane: 'chrome-dual', nodes: ['a'] },
    { fault: 'mediaBandOffByOne', lane: 'linux-dragon-layout', nodes: ['b'] },
  ] as const;
  for (const p of PLANTED) {
    it(`${p.fault} fails media-max-width on ${p.nodes.join(', ')} in both directions; unfaulted it passes`, async () => {
      const spec = FIXTURES.find((f) => f.id === 'media-max-width');
      if (spec === undefined) throw new Error('media-max-width is not registered');
      const clean = await runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(clean.reason).toBeNull();
      const faulty = await runFixture(spec, browser, { authored: committedAuthored, faults: { ...NO_FAULTS, [p.fault]: true }, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
      expect(faulty.status).toBe('fail');
      expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes[p.lane], c.id).toBe('fail');
        expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id), c.id).toEqual(expect.arrayContaining([...p.nodes]));
      }
    }, 120_000);
  }
});

describe('the native refusal through the public entry', () => {
  it('media-overlap compiles for web; ios and android refuse both @media rules until MQ-R', () => {
    const { input } = readHtmlFixture('media-overlap');
    const c = createProject({ projectId: 'dragon-parity', targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } } }).compile(input);
    expect(c.outputs.web.kind).toBe('ready');
    expect([c.outputs.ios.kind, c.outputs.android.kind]).toEqual(['blocked', 'blocked']);
    const refusals = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_AT_RULE');
    expect(refusals.map((d) => [d.target, d.message])).toEqual(['ios', 'android'].flatMap((t) => ['768px', '640px'].map((w) => [t, `@media screen and (max-width: ${w}) selects rules by the viewport width or height, which the ${t} output does not support until MQ-R`])));
  });
});
