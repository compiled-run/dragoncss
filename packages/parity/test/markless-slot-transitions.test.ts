// SLOT-transitions (markless-slots.ts refuseSlotMotion): a slot input is refused exactly when Chrome, given the app's write into the
// style attribute, runs a transition or animation on what the slot moves, which the phone would jump instead.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchChrome, openPage } from '../src/chrome.ts';
import { marklessDocumentHtml } from '../src/markless-style-compare.ts';
import type { MarklessStyleInput } from '../src/markless-style-input.ts';
import { filledAtInitial, marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import type { SlotTransitionFaults, StyleTemplate } from '../src/markless-slots.ts';
import { filledStyle } from '../src/markless-slots.ts';
import { repoPath } from '../src/paths.ts';

const PATH = 'row.native-style-input.json';
const SLOT = 'slot:v';

type Row = {
  readonly name: string;
  readonly css: string;
  readonly template: StyleTemplate;
  readonly from: number;
  readonly to: number;
  /** The element Chrome is watched on: the one with the template (h1) or its child (h2). */
  readonly watch?: 'h1' | 'h2';
  readonly host?: string;
  readonly integer?: true;
  /** What the export's message names: the property and kind, or the animation program (B). */
  readonly refusal: { readonly property: readonly string[]; readonly of: 'transition' | 'keyframes' } | 'program' | null;
  /** Chrome over-refusals Dragon makes on purpose, with why. */
  readonly overRefusal?: string;
};

const x = (css: string, refusal: Row['refusal'], name: string): Row => ({ name, css: `.t { position: absolute; left: var(--x); top: 0px; width: 10px; height: 10px; ${css} }`, template: ['--x: ', { slot: SLOT }, 'px'], from: 10, to: 50, refusal });
const left = { property: ['left'], of: 'transition' } as const;

const ROWS: readonly Row[] = [
  x('transition: left 1s;', left, 'left 1s through var()'),
  { name: 'left written in the attribute', css: '.t { position: absolute; top: 0px; width: 10px; height: 10px; transition: left 1s; }', template: ['left: ', { slot: SLOT }, 'px'], from: 10, to: 50, refusal: left },
  x('transition: all 1s;', left, 'all 1s'),
  x('transition: inset 1s;', left, 'inset 1s (a shorthand)'),
  x('transition: --x 1s;', null, 'the unregistered custom property'),
  x('transition: top 1s;', null, 'another property'),
  x('transition: left 0s;', null, 'left 0s'),
  x('transition: left 1s -1s;', null, 'left 1s -1s (combined duration 0)'),
  x('transition: left 0s 1s;', left, 'left 0s 1s (a positive delay)'),
  x('transition: left 2s -1s;', left, 'left 2s -1s'),
  { name: 'flex moving flex-grow', host: 'p', css: '.p { display: flex; width: 200px; } .t { flex: var(--s) 1 0; height: 10px; transition: flex 1s; }', template: ['--s: ', { slot: SLOT }], from: 1, to: 2, refusal: { property: ['flex-basis', 'flex-grow'], of: 'transition' } },
  { name: 'order (an integer interpolates)', host: 'p', integer: true, css: '.p { display: flex; } .t { order: var(--o); width: 10px; height: 10px; transition: order 1s; }', template: ['--o: ', { slot: SLOT }], from: 1, to: 5, refusal: { property: ['order'], of: 'transition' } },
  { name: 'colour inherited by a child with a transition', watch: 'h2', css: '.t { color: var(--c); } .k { transition: color 1s; }', template: ['--c: rgb(', { slot: SLOT }, ' 0 0)'], from: 0, to: 200, refusal: { property: ['color'], of: 'transition' } },
  { name: 'a currentcolor border while color moves', css: '.t { color: var(--c); border: 2px solid currentcolor; transition: border-color 1s; }', template: ['--c: rgb(', { slot: SLOT }, ' 0 0)'], from: 0, to: 200, refusal: null },
  { name: 'keyframes setting width, 10s', css: '@keyframes k { from, to { width: 100px } } .t { animation: k 10s; height: 10px; }', template: ['width: ', { slot: SLOT }, 'px'], from: 10, to: 50, refusal: { property: ['width'], of: 'keyframes' } },
  { name: 'keyframes setting width, 0s forwards', css: '@keyframes k { to { width: 100px } } .t { animation: k 0s forwards; height: 10px; }', template: ['width: ', { slot: SLOT }, 'px'], from: 10, to: 50, refusal: { property: ['width'], of: 'keyframes' } },
  { name: 'keyframes setting width, 0s fill none', css: '@keyframes k { to { width: 100px } } .t { animation: k 0s; height: 10px; }', template: ['width: ', { slot: SLOT }, 'px'], from: 10, to: 50, refusal: { property: ['width'], of: 'keyframes' }, overRefusal: 'animations are refused whatever their timing, rather than modelling which fills have no effect' },
  { name: 'em keyframes under a font-size the slot moves', css: '@keyframes k { from, to { width: 10em } } .t { font-size: var(--f); animation: k 10s; height: 10px; }', template: ['--f: ', { slot: SLOT }, 'px'], from: 10, to: 20, refusal: 'program' },
  { name: 'animation timing written with a var() that reads the slot', css: '@keyframes k { from { width: 0px } to { width: 100px } } .t { animation: k var(--d) linear; height: 10px; }', template: ['--d: ', { slot: SLOT }, 's'], from: 10, to: 20, refusal: 'program' },
  { name: 'a transform-origin the slot moves while the transform animates', css: '@keyframes k { from { transform: rotate(0deg) } to { transform: rotate(90deg) } } .t { width: 40px; height: 40px; transform-origin: var(--o) 0px; animation: k 10s linear -5s paused; }', template: ['--o: ', { slot: SLOT }, 'px'], from: 0, to: 40, refusal: 'program' },
];

function inputOf(row: Row): MarklessStyleInput {
  return {
    version: 'markless.native-style-input/0',
    component: 'App',
    css: row.css,
    states: [],
    slots: [{ id: SLOT, initial: row.from, ...(row.integer === undefined ? {} : { integer: true }) }],
    nodes: [
      { kind: 'element', id: 'h0', element: 'div', parent: null, attributes: { class: row.host ?? 'box' } },
      { kind: 'element', id: 'h1', element: 'div', parent: 'h0', attributes: { class: 't' }, styleTemplate: row.template },
      { kind: 'element', id: 'h2', element: 'div', parent: 'h1', attributes: { class: 'k' } },
    ],
  } as MarklessStyleInput;
}

const refusalOf = (text: string, faults: SlotTransitionFaults = {}): string | null => {
  try {
    marklessStyleExport(text, PATH, undefined, 'system', undefined, true, faults);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

/** Whether Chrome, after the app writes `to` into the style attribute, runs a transition or animation on what the slot moves. */
async function chromeMoves(browser: Browser, row: Row): Promise<boolean> {
  const page = await openPage(browser, marklessDocumentHtml(filledAtInitial(inputOf(row)), {}, 'system'), { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' });
  try {
    return await page.evaluate(([style, watch, program]) => {
      const t = document.querySelector('[data-dragon-id="h1"]') as HTMLElement;
      const w = document.querySelector(`[data-dragon-id="${watch}"]`) as HTMLElement;
      const read = (): string => JSON.stringify([getComputedStyle(w).width, getComputedStyle(w).color, w.getBoundingClientRect().toJSON(), document.getAnimations().map((a) => (a.effect as KeyframeEffect).getComputedTiming().duration)]);
      const before = read();
      t.setAttribute('style', style);
      const on = document.getAnimations().filter((a) => (a.effect as KeyframeEffect).target === w);
      // A program row: the running animation's output follows the write, where the phone's is built once.
      return program ? on.length > 0 && read() !== before : on.length > 0;
    }, [filledStyle(row.template, new Map([[SLOT, row.to]])), row.watch ?? 'h1', row.refusal === 'program'] as const);
  } finally {
    await page.context().close();
  }
}

/** How the export disagrees with Chrome on a row, or null: refused exactly when Chrome runs it, with the message naming it. */
function disagreement(row: Row, chrome: boolean, faults: SlotTransitionFaults = {}): string | null {
  const message = refusalOf(JSON.stringify(inputOf(row)), faults);
  if (row.overRefusal !== undefined) return chrome ? 'Chrome runs a row marked as an over-refusal' : message === null ? `exported, where it is refused on purpose: ${row.overRefusal}` : null;
  if (chrome !== (row.refusal !== null)) return `Chrome ${chrome ? 'runs' : 'does not run'} it, and the row says otherwise`;
  if (row.refusal === null) return message === null ? null : `refused, where Chrome runs nothing: ${message}`;
  if (message === null) return 'exported, where Chrome runs it';
  if (row.refusal === 'program') return message.includes(`ios assignment 0: ${SLOT} at `) && message.includes("changes the page's animation program") ? null : `refused for another reason: ${message}`;
  const named = row.refusal.property.some((p) => message.includes(`ios assignment 0: ${p} of ${row.watch ?? 'h1'} follows ${SLOT} and `));
  const kind = message.includes(row.refusal.of === 'transition' ? 'has a transition (' : 'is set by the keyframes of animation k,');
  return named && kind ? null : `refused with another message: ${message}`;
}

describe('a property a slot moves, which Chrome transitions or animates', () => {
  let browser: Browser;
  const chrome = new Map<string, boolean>();
  beforeAll(async () => {
    browser = await launchChrome(1);
    for (const row of ROWS) chrome.set(row.name, await chromeMoves(browser, row));
  }, 120_000);
  afterAll(async () => {
    await browser.close();
  });

  for (const row of ROWS) {
    it(`${row.name}: refused exactly when Chrome runs it`, () => {
      expect(disagreement(row, chrome.get(row.name)!)).toBeNull();
    }, 120_000);
  }

  const FAULTS: readonly [keyof SlotTransitionFaults, string][] = [
    ['slotTransitionDelayIgnored', 'left 0s 1s (a positive delay)'],
    ['slotTransitionOwnElementOnly', 'colour inherited by a child with a transition'],
    ['slotTransitionAdmittedOnly', 'order (an integer interpolates)'],
    ['slotTransitionAnyBorder', 'a currentcolor border while color moves'],
    ['slotAnimProgramInvarianceSkipped', 'em keyframes under a font-size the slot moves'],
  ];
  for (const [fault, name] of FAULTS) {
    it(`the planted ${fault} disagrees with Chrome on "${name}"`, () => {
      const row = ROWS.find((r) => r.name === name)!;
      expect(disagreement(row, chrome.get(name)!, { [fault]: true })).not.toBeNull();
    }, 120_000);
  }
});

describe('what the rule accepts and the order of refusals', () => {
  const SLOTS_PATH = 'examples/markless-styles/input/slots.native-style-input.json';
  const slots = JSON.parse(readFileSync(repoPath(SLOTS_PATH), 'utf8')) as MarklessStyleInput;

  it('a transition on top, which a state moves, beside a slot that moves left, keeps the slots as they were', () => {
    const moving = {
      ...slots,
      css: `${slots.css}.down { top: 4px; }\n.thumb { transition: top 1s; }\n`,
      states: [{ cell: 'c0', domain: [false, true], initial: false }],
      nodes: slots.nodes.map((n) => (n.id === 'h2' && n.kind === 'element' ? { ...n, attributes: {}, classByState: [{ when: { c0: false }, value: 'thumb' }, { when: { c0: true }, value: 'thumb down' }] } : n)),
    };
    const was = marklessStyleExport(JSON.stringify(slots), SLOTS_PATH, undefined, 'system', undefined, true).exported;
    const now = marklessStyleExport(JSON.stringify(moving), SLOTS_PATH, undefined, 'system', undefined, true).exported;
    for (const t of ['ios', 'android'] as const) {
      const want = was.targets[t]!.plan!.assignments[0]!;
      const got = now.targets[t]!;
      expect(got.anim?.slots.map((s) => [s.node, s.property])).toEqual([['h2', 'top']]);
      expect(got.plan!.assignments).toHaveLength(2);
      for (const a of got.plan!.assignments) {
        expect(a.slotFields).toEqual(want.slotFields);
        expect(a.slotWrites).toEqual(want.slotWrites);
        expect(a.slotRefusals).toEqual(want.slotRefusals);
      }
    }
  }, 300_000);

  it('a colour a transitioned colour reaches each frame, which the slot moves, is refused with the transition message', () => {
    const input = {
      version: 'markless.native-style-input/0',
      component: 'App',
      css: '.p { color: rgb(0 0 255); transition: color 1s; } .p.red { color: rgb(255 0 0); } .c { height: 10px; } .own { color: rgb(var(--a) 0 0); }',
      states: [{ cell: 'c0', domain: [false, true], initial: false }],
      slots: [{ id: SLOT, initial: 10 }],
      nodes: [
        { kind: 'element', id: 'h0', element: 'div', parent: null, attributes: {}, classByState: [{ when: { c0: false }, value: 'p' }, { when: { c0: true }, value: 'p red' }] },
        { kind: 'element', id: 'h1', element: 'div', parent: 'h0', attributes: {}, classByState: [{ when: { c0: false }, value: 'c own' }, { when: { c0: true }, value: 'c' }], styleTemplate: ['--a: ', { slot: SLOT }] },
      ],
    };
    expect(refusalOf(JSON.stringify(input))).toContain(`ios assignment 0: color of h1 follows ${SLOT} and has a transition (1s, delay 0s)`);
  }, 120_000);

  it('a slot inside a @for row with a transition is refused by the row rule first', () => {
    const ROWS_PATH = 'examples/markless-styles/input/rows.native-style-input.json';
    const rows = JSON.parse(readFileSync(repoPath(ROWS_PATH), 'utf8')) as MarklessStyleInput;
    const slotted = { ...rows, css: `${rows.css}\nli { transition: background-color 1s, padding-left 1s; }\n`, slots: [{ id: 'slot:h5#0', initial: 4 }], nodes: rows.nodes.map((n) => (n.id === 'h5' ? { ...n, styleTemplate: ['padding-left: ', { slot: 'slot:h5#0' }, 'px'] } : n)) };
    parseMarklessStyleInput(JSON.stringify(slotted));
    expect(refusalOf(JSON.stringify(slotted))).toMatch(/h5 has a transition or animation inside a @for row/);
  }, 300_000);
});
