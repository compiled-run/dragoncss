// Chrome 145 gives :focus and :focus-visible only to an element a key, click or tap can focus. A host that never forces a state
// (hostUnforced, a Markless host) skips the forced :focus and :focus-visible states of every other element (forcedOnlyFocus), so
// their styles are neither checked nor lowered on native, while a focusable element, a tabindex, contenteditable and a scroller keep theirs.
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as dragon from 'dragon';
import { forcedOnlyFocus, interactionPartition } from '../../dragon/src/analysis/interaction.ts';
import { resolveTree } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { forcedOnlyStatesIn, interactionPartitionIn } from '../../dragon/src/internal.ts';
import { internalRecord } from '../../dragon/src/project.ts';
import { referenceDataset } from '../../dragon/src/ua/datasets.ts';
import { launchChrome } from '../src/chrome.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';

const CSS = [
  'body { margin: 0; font-family: Ahem; font-size: 10px; }',
  'div, p, ul, li, label, button, input { display: block; margin: 0 0 4px; }',
  '#sc { overflow: auto; height: 20px; width: 60px; }',
  ':focus { color: #00c; }',
  ':focus-visible { outline: 3px solid #c00; outline-offset: 2px; }',
].join('\n');
const FOCUSABLE = ['a', 'bt', 'in', 'ti', 'ce', 'sc'];
const NEVER = ['as', 'ast', 'nh', 'p', 'ps', 'ul', 'li', 'lb', 'd', 'img'];
const BODY = [
  '<a data-dragon-id="a" id="a" href="#x"><span data-dragon-id="as" id="as">XX</span> <strong data-dragon-id="ast" id="ast">XX</strong></a>',
  '<a data-dragon-id="nh" id="nh">XX</a>',
  '<button data-dragon-id="bt" id="bt" type="button">XX</button>',
  '<input data-dragon-id="in" id="in" readonly="" value="XX">',
  '<span data-dragon-id="ti" id="ti" tabindex="0">XX</span>',
  '<div data-dragon-id="ce" id="ce" contenteditable="true">XX</div>',
  '<div data-dragon-id="sc" id="sc">XX XX XX XX XX XX XX XX</div>',
  '<p data-dragon-id="p" id="p">XX <span data-dragon-id="ps" id="ps">XX</span></p>',
  '<ul data-dragon-id="ul" id="ul"><li data-dragon-id="li" id="li">XX</li></ul>',
  '<label data-dragon-id="lb" id="lb">XX</label>',
  '<div data-dragon-id="d" id="d">XX</div>',
  '<img data-dragon-id="img" id="img" alt="" width="20" height="10" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
].join('');
const HTML = `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${CSS}\n</style>\n</head>\n<body data-dragon-id="body">${BODY}</body>\n</html>\n`;
const idOf = (address: string): string => address.split('/').at(-1) as string;

/** The ids whose forced :focus or :focus-visible state Dragon finds only forcing reaches. */
function forcedOnlyIds(): Set<string> {
  const compiled = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' } } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', interactionLanes: true }).compile(fixtureToInput('focus-forced-only', HTML));
  const record = internalRecord(compiled);
  if (record === undefined || record.linked === null) throw new Error('no internal record');
  const rules = parseStylesheet(CSS, { source: { kind: 'file', path: 'focus-forced-only.css' } as never, start: 0, end: CSS.length }, { id: 's', owner: 'doc' as never, scope: 'document' }, 0, []);
  const env = { direction: 'ltr' as const, rootFont: 'ahem' as const, ua: referenceDataset() };
  const root = (record.linked.cases[0] as { root: Parameters<typeof resolveTree>[0] }).root;
  const built = interactionPartition(root, (ix) => resolveTree(root, rules, dragon.NO_FAULTS, env, ix), dragon.NO_FAULTS);
  const base = resolveTree(root, rules, dragon.NO_FAULTS, env);
  const out = new Set<string>();
  built.partition.states.forEach((v, k) => {
    if (forcedOnlyFocus(v, built.partition, [base, built.resolved[k] as never])) out.add(idOf(v.force[0]?.address as string));
  });
  return out;
}

/** The ids that matched :focus or :focus-visible at any point while Chrome tabs through the page, then clicks and taps each element. */
async function chromeFocused(browser: Browser): Promise<{ readonly focus: Set<string>; readonly tabbed: Set<string> }> {
  const focus = new Set<string>();
  const tabbed = new Set<string>();
  const record = async (page: Page, into: Set<string>[]): Promise<void> => {
    const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].filter((e) => e.matches(':focus') || e.matches(':focus-visible')).map((e) => e.id));
    for (const s of into) for (const id of ids) s.add(id);
  };
  for (const touch of [false, true]) {
    const ctx = await browser.newContext({ hasTouch: touch, viewport: { width: 400, height: 400 } });
    try {
      const page = await ctx.newPage();
      if (!touch) {
        await page.setContent(HTML);
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press('Tab');
          await record(page, [focus, tabbed]);
        }
      }
      for (const id of [...FOCUSABLE, ...NEVER]) {
        await page.setContent(HTML);
        if (touch) await page.tap(`#${id}`);
        else await page.click(`#${id}`);
        await record(page, [focus]);
      }
    } finally {
      await ctx.close();
    }
  }
  return { focus, tabbed };
}

describe('forced-only :focus and :focus-visible states (hostUnforced)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChrome(1);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('Dragon skips exactly the elements no key, click or tap focuses in Chrome, and keeps every element Chrome focuses', async () => {
    const skipped = forcedOnlyIds();
    expect([...skipped].filter((id) => [...FOCUSABLE, ...NEVER].includes(id)).sort()).toEqual([...NEVER].sort());
    const chrome = await chromeFocused(browser);
    expect(NEVER.filter((id) => chrome.focus.has(id))).toEqual([]);
    expect(FOCUSABLE.filter((id) => !chrome.tabbed.has(id))).toEqual([]);
  }, 120_000);

  it('a Markless host compile drops the inline outline refusal of a span and a strong in a link, and keeps it for an inline link', () => {
    const body = '<a data-dragon-id="a" href="#x"><span data-dragon-id="as">XX</span> <strong data-dragon-id="ast">XX</strong></a><a data-dragon-id="nh">XX</a><p data-dragon-id="p">XX <span data-dragon-id="ps">XX</span></p>';
    const inline = `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\nbody { margin: 0; font-family: Ahem; font-size: 10px; }\n:focus-visible { outline: 3px solid #c00; }\n</style>\n</head>\n<body data-dragon-id="body">${body}</body>\n</html>\n`;
    const outlineRefusals = (hostUnforced: boolean): string[] =>
      dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' } } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', interactionLanes: true, hostUnforced })
        .compile(fixtureToInput('focus-forced-only', inline))
        .diagnostics.filter((d) => d.target === 'ios' && d.message.includes('has an outline on an inline box'))
        .map((d) => idOf(d.message.split(' ')[0] as string))
        .sort();
    expect(outlineRefusals(false)).toEqual(['a', 'as', 'ast', 'nh', 'ps']);
    expect(outlineRefusals(true)).toEqual(['a']);
    // The compile's own record marks the same states skipped: every forced focus state (the link's equal its reachable ones).
    const compiled = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' } } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', interactionLanes: true, hostUnforced: true }).compile(fixtureToInput('focus-forced-only', inline));
    const partition = interactionPartitionIn(compiled, [], 0);
    if (partition === null) throw new Error('no partition');
    const skipped = forcedOnlyStatesIn(compiled, [], 0);
    const focusOwners = (keep: boolean): string[] => [...new Set(partition.states.flatMap((v, k) => ((v.kind === 'forced-focus' || v.kind === 'forced-focus-visible') && skipped[k] === keep ? [idOf(v.force[0]?.address as string)] : [])))].sort();
    expect(focusOwners(true)).toEqual(['as', 'ast', 'body', 'html', 'nh', 'p', 'ps']);
    expect(focusOwners(false)).toEqual([]);
  });
});
