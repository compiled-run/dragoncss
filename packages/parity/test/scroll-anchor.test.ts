// REPL-r2a ruling 2: Chrome's scroll offset after an img that follows its image loads or changes above or across the viewport's
// top (expected-scroll-anchor, parity:scroll-anchor-capture), against the engine's two-case rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runtimeImageScrollShift } from '@dragon/layout';
import type { ScrollAnchorCapture } from '../src/scroll-anchor.ts';
import { SCROLL_ANCHOR_CASES, SCROLL_ANCHOR_DPRS, scrollAnchorPath } from '../src/scroll-anchor.ts';

const capture = JSON.parse(readFileSync(scrollAnchorPath(), 'utf8')) as ScrollAnchorCapture;

describe('REPL-r2a: the scroll offset follows Chrome when an img changes height above it', () => {
  it('covers every case at every DPR, each scrolled where the case says before the load', () => {
    expect(capture.cases.map((c) => `${c.id}@${c.dpr}`)).toEqual(SCROLL_ANCHOR_DPRS.flatMap((d) => SCROLL_ANCHOR_CASES.map((c) => `${c.id}@${d}`)));
    for (const c of capture.cases) expect(c.before, c.id).toBe(SCROLL_ANCHOR_CASES.find((k) => k.id === c.id)?.offset);
  });
  it('moves by the change when the img lies wholly above a non-zero offset, and not at all across the top or at offset 0', () => {
    for (const c of capture.cases) expect(c.before + runtimeImageScrollShift(c.before, c.top, c.was, c.now), `${c.id}@${c.dpr}`).toBe(c.after);
    expect(capture.cases.filter((c) => c.after !== c.before).map((c) => c.id)).toEqual(['above', 'above-swap', 'top-above', 'above', 'above-swap', 'top-above']);
  });
});
