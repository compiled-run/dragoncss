// INL1a's planted engine faults through runFixture, with the committed Chrome captures as the authored side: each moves one line
// breaking rule off Blink's (linebreak.ts, linefit.ts), and the layout lane names the boxes whose line count changes. The unfaulted
// runs pass.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineFaults } from '@dragon/layout';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import { committedAuthored } from '../src/committed.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { runFixture } from '../src/pipeline.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

let browser: Browser | undefined;

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  browser = await launchChrome();
  expect(browser.version()).toBe(CHROME_VERSION);
});

afterAll(async () => {
  await browser?.close();
});

const run = async (id: string, engineFaults: EngineFaults) => {
  const spec = FIXTURES.find((f) => f.id === id);
  if (spec === undefined) throw new Error(`${id} is not registered`);
  if (browser === undefined) throw new Error('Chrome did not launch');
  return runFixture(spec, browser, { authored: committedAuthored, faults: NO_FAULTS, engineFaults, profiles: 'enforce' });
};

/** Each plant, the fixture that catches it, and the boxes whose layout it moves off Chrome's in every case of the fixture. */
const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly fixture: string; readonly nodes: readonly string[] }[] = [
  { fault: 'spaceOnlyBreaks', fixture: 'inline-breaks-hyphen', nodes: ['h1', 'h2', 'h3', 'h5', 'h7', 'h8'] },
  { fault: 'noHyphenDigitBreak', fixture: 'inline-breaks-hyphen', nodes: ['h2', 'h3'] },
  { fault: 'breakAfterSolidus', fixture: 'inline-breaks-no-break', nodes: ['n1', 'n2'] },
  { fault: 'fitWithoutEpsilon', fixture: 'inline-breaks-fit', nodes: ['e1', 'e4'] },
];

describe.sequential('INL1a planted engine faults', () => {
  for (const p of PLANTS) {
    it(`${p.fault}: ${p.fixture} fails the layout lane on ${p.nodes.join(', ')}; unfaulted it passes`, async () => {
      const clean = await run(p.fixture, NO_ENGINE_FAULTS);
      expect(clean.reason).toBeNull();
      expect(clean.status).toBe('pass');
      const faulty = await run(p.fixture, { ...NO_ENGINE_FAULTS, [p.fault]: true });
      expect(faulty.status).toBe('fail');
      expect(clean.cases.length).toBeGreaterThan(0);
      expect(faulty.cases.map((c) => c.id)).toEqual(clean.cases.map((c) => c.id));
      for (const c of faulty.cases) {
        expect(c.status, c.id).toBe('fail');
        expect(c.lanes['linux-dragon-layout'], c.id).toBe('fail');
        const failed = new Set((c.comparison?.nodes ?? []).filter((n) => !n.pass).map((n) => n.id));
        for (const n of p.nodes) expect(failed.has(n), `${c.id} ${n}`).toBe(true);
      }
    });
  }
});
