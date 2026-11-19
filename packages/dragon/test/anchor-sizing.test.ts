// aspect-ratio on an anchored box (css-sizing-4 §5.1 with css-anchor-position-1): its auto width comes through the ratio from its
// height, and its auto height from its width, as Chrome 145 sizes them (Blink ComputeOofInlineDimensions). Each expected rect was
// read from the pinned Chrome on the same CSS: a 200x100 relative containing block, a 20x10 anchor 50px in.
import { describe, expect, it } from 'vitest';
import { layout, measurerFor, REFERENCE_PLATFORM } from '@dragon/layout';
import { createProjectWith, nativeProgramFor, NO_FAULTS, programInput } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const BASE = 'body { margin: 0; } .cb { position: relative; width: 200px; height: 100px; } .a { anchor-name: --a; width: 20px; height: 10px; margin-left: 50px; } .b { position: absolute; position-anchor: --a; }';

/** The anchored box's border box in CSS px from its containing block. */
function anchored(css: string): number[] {
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${BASE} ${css}`, (r) => [div(r, 'cb', ['cb'], [div(r, 'a', ['a']), div(r, 'b', ['b'])])]));
  expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
  const p = nativeProgramFor(c, [], 'ios');
  if (p.kind !== 'ready') throw new Error(p.reason);
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(m.detail);
  const out = layout(programInput(p.program, { width: 400, height: 300 }, 1), m.measurer);
  if (out.kind !== 'ok') throw new Error(JSON.stringify(out));
  const b = out.boxes.find((x) => x.id === 'b');
  if (b === undefined) throw new Error('no box b');
  return [b.x / 64, b.y / 64, b.width / 64, b.height / 64];
}

describe('aspect-ratio on an anchored box', () => {
  const cases: [string, string, number[]][] = [
    ['a height gives the width', 'position-area: bottom; height: 20px; aspect-ratio: 2;', [40, 10, 40, 20]],
    ['a width gives the height', 'position-area: bottom; width: 60px; aspect-ratio: 2;', [30, 10, 60, 30]],
    ['max-width clamps the width from the ratio', 'position-area: bottom; height: 20px; aspect-ratio: 2; max-width: 30px;', [45, 10, 30, 20]],
    ['min-width raises the width from the ratio', 'position-area: bottom; height: 20px; aspect-ratio: 2; min-width: 50px;', [35, 10, 50, 20]],
    ['max-height clamps the height from the ratio', 'position-area: bottom; width: 60px; aspect-ratio: 2; max-height: 20px;', [30, 10, 60, 20]],
    ['anchor() insets with a height', 'top: anchor(bottom); left: anchor(left); height: 20px; aspect-ratio: 2;', [50, 10, 40, 20]],
    ['a width stretched between insets gives the height past the block insets', 'top: anchor(bottom); bottom: 0; left: 0; right: 0; aspect-ratio: 2;', [0, 10, 200, 100]],
    ['a transferred max-height bounds the stretched width', 'top: anchor(bottom); bottom: 0; left: anchor(left); right: 0; aspect-ratio: 2; max-height: 30px;', [50, 10, 60, 30]],
    ['a definite width stretches between the block insets', 'top: anchor(bottom); bottom: 0; left: anchor(left); width: 30px; aspect-ratio: 2;', [50, 10, 30, 90]],
    ['the ratio sizes the content box', 'position-area: bottom span-all; height: 20px; aspect-ratio: 2; padding: 2px; border: 1px solid;', [37, 10, 46, 26]],
    ['auto && <ratio> sizes the content box under border-box sizing', 'position-area: bottom; height: 20px; aspect-ratio: auto 2; padding: 2px; box-sizing: border-box;', [42, 10, 36, 20]],
    ['anchor-center alignment', 'position-area: right; height: 20px; aspect-ratio: 2; justify-self: anchor-center;', [70, 0, 40, 20]],
  ];
  for (const [name, css, chrome] of cases) it(`${name}, as Chrome`, () => expect(anchored(`.b { ${css} }`)).toEqual(chrome));
});
