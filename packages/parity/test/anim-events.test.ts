// The CSS animation events the animator gives a host (rt-animator.ts animationEvents), against Chrome's: each frame case with
// animations runs in Chrome frozen, a state step morphing the page in place and an advance moving its running animations as the
// frame lanes do, with every animationstart, animationiteration, animationend and animationcancel recorded after the step; the
// TypeScript animator runs the same steps. Each element's events, in order, with their animation name and elapsed time, must be
// the same.
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
  .filter((c) => c.direction === 'ltr' && (c.ap.animations?.length ?? 0) > 0);

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

// Chrome's events over every case: the comparison is not vacuous.
let fired = 0;

describe('CSS animation events', () => {
  it('runs the frame cases with animations, state steps among them', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8);
    expect(CASES.some((c) => frameScript(c).some((s) => s.kind === 'set'))).toBe(true);
  });

  for (const c of CASES)
    it(`${c.id}: the animator's events are Chrome's, element by element`, async () => {
      const steps = frameScript(c);
      const sim = simulator(c);
      const ours: Fired[] = [];
      const model = authoredModel(fixtureInput(c.fixture.spec));
      const rt = new StateRuntime(c.sp);
      const render = (): string => model.render((c.sp.assignments[rt.assignment] as { assignment: Assignment }).assignment, { kind: 'authored' });
      const html = render();
      // The page each state step morphs to, in step order.
      const morphs: string[] = [];
      for (const s of steps) {
        if (s.kind === 'set') {
          for (const x of s.sets) rt.set(x.state, x.value);
          morphs.push(render());
          // One style change event, as simulator's set makes it.
          for (const x of s.sets) sim.rt.set(x.state, x.value);
          for (const e of sim.animator.eventWithEvents(sim.rt.assignment)) ours.push({ node: e.node, type: e.type, name: e.name, elapsedTime: e.elapsedTime });
        } else if (s.kind === 'advance') for (const e of sim.animator.advanceWithEvents(s.ms)) ours.push({ node: e.node, type: e.type, name: e.name, elapsedTime: e.elapsedTime });
      }
      const page = await openFrozenPage(browser, html, { viewport: c.viewport, devicePixelRatio: 1, direction: c.direction, rootFont: 'ahem' });
      try {
        await page.evaluate(() => {
          const w = window as unknown as { __fired: Fired[] };
          w.__fired = [];
          for (const type of ['animationstart', 'animationiteration', 'animationend', 'animationcancel'])
            document.addEventListener(type, (e) => {
              const a = e as AnimationEvent;
              w.__fired.push({ node: (a.target as Element).getAttribute('data-dragon-id') ?? '', type, name: a.animationName, elapsedTime: a.elapsedTime });
            });
        });
        // Events for the first style come in the frame after it.
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        let morph = 0;
        for (const s of steps) {
          if (s.kind === 'set') {
            await page.evaluate(async (next) => {
              const idOf = (n: Node): string | null => (n.nodeType === Node.ELEMENT_NODE ? (n as Element).getAttribute('data-dragon-id') : null);
              // As frame-capture.ts morphs a state step: attributes, text and children by data-dragon-id, kept elements kept.
              const sync = (from: Element, to: Element): void => {
                for (const a of Array.from(from.attributes)) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
                for (const a of Array.from(to.attributes)) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
                const old = new Map(Array.from(from.children).flatMap((e) => {
                  const id = idOf(e);
                  return id === null ? [] : [[id, e] as const];
                }));
                const wanted: Node[] = [];
                for (const n of Array.from(to.childNodes)) {
                  const id = idOf(n);
                  if (id !== null && old.has(id)) {
                    const kept = old.get(id) as Element;
                    sync(kept, n as Element);
                    wanted.push(kept);
                  } else wanted.push(document.importNode(n, true));
                }
                wanted.forEach((n, i) => {
                  if (from.childNodes[i] !== n) from.insertBefore(n, from.childNodes[i] ?? null);
                });
                while (from.childNodes.length > wanted.length) from.removeChild(from.lastChild as Node);
                for (const n of Array.from(from.childNodes)) if (n.nodeType === Node.TEXT_NODE && !wanted.includes(n)) from.removeChild(n);
              };
              sync(document.body, new DOMParser().parseFromString(next, 'text/html').body);
              getComputedStyle(document.body).width;
              await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
            }, morphs[morph] as string);
            morph++;
          } else if (s.kind === 'advance')
            await page.evaluate(async (ms) => {
              for (const a of document.getAnimations()) if (a.playState === 'running') a.currentTime = Number(a.currentTime) + ms;
              await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
            }, s.ms);
        }
        const chrome = (await page.evaluate(() => (window as unknown as { __fired: Fired[] }).__fired)) as Fired[];
        expect(byNode(ours)).toEqual(byNode(chrome));
        fired += chrome.length;
      } finally {
        await page.context().close();
      }
    });

  it('saw Chrome fire animation events', () => {
    expect(fired).toBeGreaterThan(20);
  });
});
