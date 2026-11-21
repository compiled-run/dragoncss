// FORM-b select focus: Chrome 145 gives a select that a tap or click focuses both :focus and :focus-visible, as a text input, where a
// button gets :focus alone (T064 P6). Dragon's pointer focus (analysis/interaction.ts pointerFocusVisible) does the same, and the
// select's focused style resolves to Chrome's computed values after a real tap and click.
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as dragon from 'dragon';
import { interactionPartition } from '../../dragon/src/analysis/interaction.ts';
import { resolveTree, valueToString } from '../../dragon/src/analysis/resolve.ts';
import type { ResolvedElement, ResolvedValue } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { internalRecord } from '../../dragon/src/project.ts';
import { referenceDataset } from '../../dragon/src/ua/datasets.ts';
import { launchChrome } from '../src/chrome.ts';
import { fixtureToInput } from '../src/fixture-reader.ts';

const CSS = [
  'body { margin: 0; font-family: Ahem; font-size: 10px; }',
  'select, button { display: block; width: 100px; font: inherit; margin: 0 0 4px; color: #000; border: 1px solid #036; background-color: #fff; }',
  '#n { appearance: none; }',
  'select:focus, button:focus { border-color: #c00; }',
  ':focus-visible { background-color: #efe; }',
].join('\n');
const BODY = '<select data-dragon-id="m" id="m"><option data-dragon-id="m-o0">Work</option><option data-dragon-id="m-o1">Home</option></select><select data-dragon-id="n" id="n"><option data-dragon-id="n-o0">A</option></select><button data-dragon-id="b" id="b" type="button">XX</button>';
const HTML = `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${CSS}\n</style>\n</head>\n<body data-dragon-id="body">${BODY}</body>\n</html>\n`;
const PROPS = ['border-top-color', 'background-color'] as const;

type Seen = { readonly focus: boolean; readonly focusVisible: boolean; readonly style: readonly string[] };

/** Dragon's partition of the page: per element, whether a tap gives it :focus-visible, and its resolved style in that state. */
function dragonPointerFocus(): Map<string, Seen> {
  const compiled = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' } } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', rootFont: 'ahem', interactionLanes: true }).compile(fixtureToInput('form-b-select-focus', HTML));
  // The native hit model does not cover form controls yet (project.ts hitUnmodelledControl), which refuses the rules by that name only.
  expect(compiled.diagnostics.filter((d) => d.severity === 'error' && !d.message.includes('hit testing through the form control m')).map((d) => d.message)).toEqual([]);
  const record = internalRecord(compiled);
  if (record === undefined || record.linked === null) throw new Error('no internal record');
  const rules = parseStylesheet(CSS, { source: { kind: 'file', path: 'form-b-select-focus.css' } as never, start: 0, end: CSS.length }, { id: 's', owner: 'doc' as never, scope: 'document' }, 0, []);
  const env = { direction: 'ltr' as const, rootFont: 'ahem' as const, ua: referenceDataset() };
  const root = (record.linked.cases[0] as { root: Parameters<typeof resolveTree>[0] }).root;
  const built = interactionPartition(root, (ix) => resolveTree(root, rules, dragon.NO_FAULTS, env, ix), dragon.NO_FAULTS);
  const p = built.partition;
  const out = new Map<string, Seen>();
  p.elements.forEach((e, i) => {
    const id = e.address.split('/').at(-1) as string;
    if (!['m', 'n', 'b'].includes(id)) return;
    const v = p.dimensions.focus[p.pointerFocusOf[i] as number];
    if (v === undefined || v.target !== e.address) throw new Error(`${id}: a tap does not focus it`);
    const resolved = resolveTree(root, rules, dragon.NO_FAULTS, env, { hover: new Set(), active: new Set(), focus: new Set(v.focus === null ? [] : [v.focus]), focusVisible: new Set(v.focusVisible === null ? [] : [v.focusVisible]) });
    const find = (r: ResolvedElement): ResolvedElement | null => (r.element.address === e.address ? r : r.children.reduce<ResolvedElement | null>((f, k) => f ?? (k.kind === 'element' ? find(k as ResolvedElement) : null), null));
    const el = find(resolved);
    if (el === null) throw new Error(`${id}: not resolved`);
    out.set(id, { focus: v.focus !== null, focusVisible: v.focusVisible !== null, style: PROPS.map((q) => valueToString((el.props.get(q) as ResolvedValue).value)) });
  });
  return out;
}

async function chromeFocus(page: Page, how: 'tap' | 'click', id: string): Promise<Seen> {
  await page.setContent(HTML);
  if (how === 'tap') await page.tap(`#${id}`);
  else await page.click(`#${id}`);
  return page.evaluate(([i, props]) => {
    const e = document.getElementById(i as string) as HTMLElement;
    const cs = getComputedStyle(e);
    return { focus: e.matches(':focus'), focusVisible: e.matches(':focus-visible'), style: (props as readonly string[]).map((q) => cs.getPropertyValue(q)) };
  }, [id, [...PROPS]] as const);
}

describe('FORM-b select focus from a tap or click', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchChrome(1);
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  for (const how of ['tap', 'click'] as const) {
    it(`a ${how} gives each select :focus and :focus-visible and the button :focus alone, in Chrome and in Dragon, with Chrome's focused style`, async () => {
      const ctx = await browser.newContext({ hasTouch: how === 'tap', viewport: { width: 400, height: 300 } });
      try {
        const page = await ctx.newPage();
        const ours = dragonPointerFocus();
        for (const id of ['m', 'n', 'b']) {
          const chrome = await chromeFocus(page, how, id);
          expect(chrome.focus, `${id} :focus in Chrome`).toBe(true);
          expect(chrome.focusVisible, `${id} :focus-visible in Chrome`).toBe(id !== 'b');
          const mine = ours.get(id) as Seen;
          expect({ focus: mine.focus, focusVisible: mine.focusVisible }, id).toEqual({ focus: chrome.focus, focusVisible: chrome.focusVisible });
          expect(mine.style, `${id} focused style`).toEqual(chrome.style);
        }
      } finally {
        await ctx.close();
      }
    });
  }
});
