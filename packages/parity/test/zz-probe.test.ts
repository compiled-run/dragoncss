import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Browser } from 'playwright';
import { NO_ENGINE_FAULTS } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import { launchChrome } from '../src/chrome.ts';
import { liveAuthored, runFixture } from '../src/pipeline.ts';
import { both, layout } from '../src/fixture-groups/define.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { fontMapOf } from '../src/fixture-groups/fonts.ts';

let browser: Browser;
beforeAll(async () => { browser = await launchChrome(); }, 120_000);
afterAll(async () => { await browser?.close(); });
const ids = (process.env.PROBE ?? '@shaped') === '@shaped' ? FIXTURES.filter((f) => f.kind === 'layout' && f.format === 'html' && fontMapOf(f.id) !== undefined).map((f) => f.id) : (process.env.PROBE ?? 'zz-probe-space').split(',');
for (const id of ids) test(id, async () => {
  const spec = FIXTURES.find((f) => f.id === id) ?? (process.env.PROBE_LTR ? layout(id) : both(id));
  const o = await runFixture(spec, browser, { authored: liveAuthored(browser), faults: NO_FAULTS, engineFaults: NO_ENGINE_FAULTS, profiles: (process.env.PROBE_ENFORCE ? 'enforce' : 'derive') as 'derive' });
  console.log(JSON.stringify(o.diagnostics.slice(0, 10), null, 1));
  console.log(o.status, o.reason?.slice(0, 6000));
  expect(o.status).toBe('pass');
}, 300_000);
