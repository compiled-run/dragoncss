// POSX-s scroll: Chrome's sticky boxes at scroll offsets of the viewport, for stickyShift (layout.ts) at offsets other than 0. Each
// capture holds, per offset, the scroll offset Chrome reached and every sticky box's border box in page CSS px.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { openPage } from './chrome.ts';
import { atDpr } from './dpr.ts';
import { casesOf, fixtureInput } from './cases.ts';
import type { ParityCase } from './cases.ts';
import { FIXTURES } from './fixtures.ts';
import { repoPath } from './paths.ts';

/** The sticky fixtures the scroll capture covers, and the DPRs it runs at. */
export const STICKY_SCROLL_FIXTURES: readonly string[] = ['sticky-viewport', 'sticky-shift', 'sticky-scroll'];
export const STICKY_SCROLL_DPRS: readonly number[] = [1, 2];
/** Vertical scroll offsets in CSS px: inside and past each fixture's sticky ranges; Chrome clamps to its scroll range. */
export const STICKY_SCROLL_OFFSETS: readonly number[] = [0, 7, 20, 45, 90, 150, 400];

export type StickyScrollCapture = {
  readonly case: string;
  readonly dpr: number;
  /** Per requested offset: the scroll offset Chrome reached, then each sticky box as [id, x, y, width, height] in page CSS px. */
  readonly steps: readonly { readonly scrollX: number; readonly scrollY: number; readonly boxes: readonly (readonly [string, number, number, number, number])[] }[];
};

export const stickyScrollCases = (): readonly ParityCase[] =>
  FIXTURES.filter((f) => STICKY_SCROLL_FIXTURES.includes(f.id)).flatMap((f) => casesOf(f, fixtureInput(f)));

export const stickyScrollPath = (caseId: string, dpr: number): string => repoPath(`packages/parity/expected-sticky-scroll/dpr-${dpr}/${caseId}.json`);

export function committedStickyScroll(caseId: string, dpr: number): StickyScrollCapture {
  return JSON.parse(readFileSync(stickyScrollPath(caseId, dpr), 'utf8')) as StickyScrollCapture;
}

export async function captureStickyScroll(browser: Browser, c: ParityCase, dpr: number): Promise<StickyScrollCapture> {
  const page = await openPage(browser, c.authoredHtml, atDpr(c.environment, dpr));
  try {
    const steps: StickyScrollCapture['steps'][number][] = [];
    for (const y of STICKY_SCROLL_OFFSETS) {
      const step = await page.evaluate((to) => {
        window.scrollTo(0, to);
        const boxes: [string, number, number, number, number][] = [];
        for (const e of document.querySelectorAll('[data-dragon-id]')) {
          if (getComputedStyle(e).position !== 'sticky') continue;
          const r = e.getBoundingClientRect();
          boxes.push([e.getAttribute('data-dragon-id') ?? '', r.x + window.scrollX, r.y + window.scrollY, r.width, r.height]);
        }
        return { scrollX: window.scrollX, scrollY: window.scrollY, boxes };
      }, y);
      steps.push(step);
    }
    return { case: c.id, dpr, steps };
  } finally {
    await page.context().close();
  }
}
