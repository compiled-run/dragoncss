// POSX-s scroll: the translated harness's runMarklessSticky gives each sticky box's shift at a scroll offset as stickyShift does, from
// the constraints the layout answer reports, so the hosts move a sticky view as the engine would place it there.
import { describe, expect, it } from 'vitest';
import type { StickyConstraint } from '../../layout/src/layout.ts';
import { stickyShift } from '../../layout/src/layout.ts';
import { fromRaw, LU_PER_PX } from '../../layout/src/units.ts';
import { runMarklessSticky } from '../harness/harness.ts';
import { bitsHex } from '../harness/host.ts';

const lu = (px: number) => fromRaw(Math.round(px * LU_PER_PX));
const c = (id: string, y: number, h: number, cbTop: number, cbBottom: number, top: number | null, bottom: number | null): StickyConstraint => ({
  id, x: lu(0), y: lu(y), width: lu(400), height: lu(h), cbLeft: lu(0), cbTop: lu(cbTop), cbRight: lu(400), cbBottom: lu(cbBottom), viewportWidth: lu(400), viewportHeight: lu(300), top: top === null ? null : lu(top), right: null, bottom: bottom === null ? null : lu(bottom), left: null,
});
const row = (k: StickyConstraint): unknown[] => [k.id, ...[k.x, k.y, k.width, k.height, k.cbLeft, k.cbTop, k.cbRight, k.cbBottom, k.viewportWidth, k.viewportHeight, k.top, k.right, k.bottom, k.left].map((v) => (v === null ? null : bitsHex(v / LU_PER_PX)))];

describe('POSX-s scroll: runMarklessSticky', () => {
  const cs = [c('bar', 0, 56, 0, 900, 0, null), c('tab', 96, 30, 96, 276, 20, null), c('foot', 400, 24, 0, 900, null, 10)];
  it('gives stickyShift for every box at every offset', () => {
    for (const scroll of [0, 7.5, 45.3, 150, 400]) {
      const out = JSON.parse(runMarklessSticky(JSON.stringify({ sticky: cs.map(row), scroll: [0, scroll] }))) as unknown[];
      expect(out[0], `${scroll}`).toBe('ok');
      expect(out[1], `${scroll}`).toEqual(cs.map((k) => {
        const d = stickyShift(k, lu(0), fromRaw(Math.floor(scroll * LU_PER_PX)));
        return [k.id, bitsHex(d.dx / LU_PER_PX), bitsHex(d.dy / LU_PER_PX)];
      }));
    }
    // The header follows the scroll, the tab stops at its containing block, the footer is pulled up into the viewport.
    const at = (scroll: number) => cs.map((k) => stickyShift(k, lu(0), lu(scroll)).dy / LU_PER_PX);
    expect(at(150)).toEqual([150, 74, 0]);
    expect(at(400)).toEqual([400, 150, 0]);
    expect(at(0)).toEqual([0, 0, -134]);
  });
  it('refuses a malformed request by name', () => {
    expect(runMarklessSticky(JSON.stringify({ sticky: [['bar', 0]], scroll: [0, 0] }))).toBe('["harness-error","$.sticky[0]: expected an id and 14 numbers"]');
    expect(runMarklessSticky(JSON.stringify({ sticky: [], scroll: [0] }))).toBe('["harness-error","$.scroll: expected [x, y]"]');
  });
});
