// The CSS animation events the animator gives a host (rt-animator.ts animationEvents), against Chrome's: each frame case whose
// script only lets time pass runs in Chrome frozen, its running animations moved by each step as the frame lanes move them,
// with every animationstart, animationiteration and animationend recorded after the step; the TypeScript animator runs the
// same steps. Each element's events, in order, with their animation name and elapsed time, must be the same.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import type { Assignment } from 'dragon';
import { StateRuntime } from 'dragon';
import { animCasesOf, animFixtures, frameScript, simulator } from '../src/anim-cases.ts';
import { launchChrome, openFrozenPage } from '../src/chrome.ts';
import { fixtureInput } from '../src/cases.ts';
import { authoredModel } from '../src/render.ts';

type Fired = { readonly node: string; readonly type: string; readonly name: string; readonly elapsedTime: number };

const CASES = animFixtures()
  .flatMap((fx) => animCasesOf(fx))
  .filter((c) => c.direction === 'ltr' && frameScript(c).every((s) => s.kind !== 'set') && (c.ap.animations?.length ?? 0) > 0);

let browser: Browser;
beforeAll(async () => {
  browser = await launchChrome(1);
});
afterAll(async () => {
  await browser.close();
});

const byNode = (events: readonly Fired[]): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const e of events) out.set(e.node, [...(out.get(e.node) ?? []), `${e.type} ${e.name} ${e.elapsedTime.toFixed(6)}`]);
  return out;
};

describe('CSS animation events', () => {
  it('runs at least two frame cases that only let time pass', () => {
    expect(CASES.map((c) => c.id).length).toBeGreaterThanOrEqual(2);
  });

  for (const c of CASES)
    it(`${c.id}: the animator's events are Chrome's, element by element`, async () => {
      const steps = frameScript(c);
      const sim = simulator(c);
      const ours: Fired[] = [];
      for (const s of steps) if (s.kind === 'advance') for (const e of sim.animator.advanceWithEvents(s.ms)) ours.push({ node: e.node, type: e.type, name: e.name, elapsedTime: e.elapsedTime });

      const model = authoredModel(fixtureInput(c.fixture.spec));
      const rt = new StateRuntime(c.sp);
      const html = model.render((c.sp.assignments[rt.assignment] as { assignment: Assignment }).assignment, { kind: 'authored' });
      const page = await openFrozenPage(browser, html, { viewport: c.viewport, devicePixelRatio: 1, direction: c.direction, rootFont: 'ahem' });
      try {
        await page.evaluate(() => {
          const w = window as unknown as { __fired: Fired[] };
          w.__fired = [];
          for (const type of ['animationstart', 'animationiteration', 'animationend'])
            document.addEventListener(type, (e) => {
              const a = e as AnimationEvent;
              w.__fired.push({ node: (a.target as Element).getAttribute('data-dragon-id') ?? '', type, name: a.animationName, elapsedTime: a.elapsedTime });
            });
        });
        // Events for the first style come in the frame after it.
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        for (const s of steps) {
          if (s.kind !== 'advance') continue;
          await page.evaluate(async (ms) => {
            for (const a of document.getAnimations()) if (a.playState === 'running') a.currentTime = Number(a.currentTime) + ms;
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          }, s.ms);
        }
        const chrome = (await page.evaluate(() => (window as unknown as { __fired: Fired[] }).__fired)) as Fired[];
        expect(chrome.length, `${c.id}: Chrome fired no animation event`).toBeGreaterThan(0);
        expect(byNode(ours)).toEqual(byNode(chrome));
      } finally {
        await page.context().close();
      }
    });
});
