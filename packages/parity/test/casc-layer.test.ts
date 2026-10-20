// CASC 3's planted compiler faults through runFixture, with the committed Chrome captures as the authored side.
// layersIgnored cascades the layered rules as unlayered ones, so specificity decides b1, n and d; layerImportantNotReversed lets the
// last layer's !important win on imp; revertLayerAsRevert sends casc-layer-revert's revert-layer to the user agent. Unfaulted, both
// fixtures pass both lanes in both directions.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import type { CompilerFaults } from 'dragon';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { liveAuthored, runFixture } from '../src/pipeline.ts';
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

// DRAGON_LIVE_AUTHORED=1 captures Chrome live instead of reading the committed capture (before the first regen of a new fixture).
const run = async (id: string, faults: CompilerFaults) => {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  const authored = process.env['DRAGON_LIVE_AUTHORED'] === '1' ? liveAuthored(browser) : committedAuthored;
  return runFixture(spec, browser, { authored, faults, engineFaults: NO_ENGINE_FAULTS, profiles: 'enforce' });
};

describe.sequential('CASC 3 planted compiler faults', () => {
  for (const id of ['casc-layer', 'casc-layer-revert']) {
    it(`unfaulted, ${id} passes chrome-dual and linux-dragon-layout in both directions`, async () => {
      const clean = await run(id, NO_FAULTS);
      expect(clean.reason).toBeNull();
      expect(clean.status).toBe('pass');
      expect(clean.cases.map((c) => [c.direction, c.lanes['chrome-dual'], c.lanes['linux-dragon-layout']])).toEqual([['ltr', 'pass', 'pass'], ['rtl', 'pass', 'pass']]);
    });
  }
  for (const [fault, id, moved] of [['layersIgnored', 'casc-layer', ['b1', 'n', 'd']], ['layerImportantNotReversed', 'casc-layer', ['imp']], ['revertLayerAsRevert', 'casc-layer-revert', ['r1', 'r4', 'r10', 'r11']]] as const) {
    it(`${fault}: ${id} fails chrome-dual in both directions on the boxes it moves`, async () => {
      const faulty = await run(id, { ...NO_FAULTS, [fault]: true });
      expect(faulty.status).toBe('fail');
      expect(faulty.cases.map((c) => c.direction)).toEqual(['ltr', 'rtl']);
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes['chrome-dual'], c.id).toBe('fail');
        expect(c.comparison?.nodes.filter((n) => !n.pass).map((n) => n.id), c.id).toEqual(expect.arrayContaining([...moved]));
      }
    });
  }
});
