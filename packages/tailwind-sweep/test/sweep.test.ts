// TW-SWEEP ratchet: the whole corpus through Dragon and Chrome 145 again, against the committed snapshot. Any utility whose
// outcome changed fails this test until `pnpm run tw:sweep` regenerates the snapshot; a compiler crash on any utility fails it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHROME_VERSION } from '../../parity/src/chrome.ts';
import type { ChromeSession } from '../src/chrome.ts';
import { openChrome } from '../src/chrome.ts';
import { fixtureHtml } from '../src/dragon.ts';
import { flatten } from '../src/flatten.ts';
import { readSnapshot, serialize, SNAPSHOT_PATH, SUMMARY_PATH, summarize, summaryMarkdown } from '../src/snapshot.ts';
import type { SweepResult } from '../src/sweep.ts';
import { outcomeDiffs, sweep } from '../src/sweep.ts';
import { publishedCss, TAILWIND_VERSION } from '../src/tailwind.ts';

describe(`Tailwind ${TAILWIND_VERSION} sweep`, () => {
  it('every utility compiles without a crash, and its outcome on web, ios and android equals the committed snapshot', async () => {
    const result: SweepResult = await sweep(openChrome);
    // A plant: Chrome must see a wrong acceptance. The compiled side of flex is given display: block.
    const chrome: ChromeSession = await openChrome();
    let planted: string[];
    try {
      const css = await publishedCss(['flex']);
      planted = await chrome.dual({ key: 'plant', authoredHtml: fixtureHtml(['flex'], css), compiledHtml: fixtureHtml(['flex'], flatten(css).css.replace('display: flex', 'display: block')) });
    } finally {
      await chrome.close();
    }
    expect(planted).toContain('u: display authored "flex" compiled "block"');
    expect(result.crashes).toEqual([]);
    const snapshot = readSnapshot();
    expect({ tailwind: snapshot.meta.tailwind, chrome: snapshot.meta.chrome }).toEqual({ tailwind: TAILWIND_VERSION, chrome: CHROME_VERSION });
    const diffs = outcomeDiffs(snapshot.records, result.records);
    expect(diffs.slice(0, 50), `${diffs.length} outcomes differ from ${SNAPSHOT_PATH}; run pnpm run tw:sweep`).toEqual([]);
    expect(serialize(result.records, { chrome: CHROME_VERSION }), 'run pnpm run tw:sweep').toBe(readFileSync(SNAPSHOT_PATH, 'utf8'));
    expect(summaryMarkdown(summarize(result.records), { chrome: CHROME_VERSION }), 'run pnpm run tw:sweep').toBe(readFileSync(SUMMARY_PATH, 'utf8'));
  }, 1_800_000);
});
