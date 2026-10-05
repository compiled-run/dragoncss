// PNT1 radius on the host (T046 §2): the radius fixtures' points against the committed Chrome PNGs at every device DPR. A small
// paint model (boxes in tree order, each filling its rounded border box, borders between the rounded border-box and padding-edge
// shapes, rounded overflow clips of ancestors, Skia's 8-bit source-over) predicts each sample's colour from the program and the TS
// paint-radius.ts geometry; every radius, clip and kept base colour point must equal Chrome exactly. This proves the geometry the
// device draws with (percentages, the §5.5 clamp, the padding-edge radii) before any device runs, and that the points are clear.
import { describe, expect, it } from 'vitest';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import { casePoints, committedPixels } from '../src/pixel-reference.ts';
import { ruleKind } from '../src/samples.ts';
import { boxes, modelAt } from './paint-model.ts';

const RADIUS_FIXTURES = (FIXTURE_GROUPS.find((g) => g.id === 'radius')?.fixtures ?? []).filter((f) => f.kind === 'layout');

describe('PNT1 radius: the paint model at every sample point equals the committed Chrome pixels', () => {
  it('covers the six radius fixtures in both directions', () => {
    expect(RADIUS_FIXTURES.map((f) => f.id)).toEqual(['radius-basic', 'radius-borders', 'radius-clip', 'radius-clamp', 'radius-cascade', 'radius-longhands']);
  });
  for (const spec of RADIUS_FIXTURES) {
    for (const c of casesOf(spec, fixtureInput(spec))) {
      it(`${c.id} at ${DPRS.join(', ')}`, () => {
        const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
        if (programs.kind !== 'ready') throw new Error(programs.reason);
        const p = programs.programs.uikit;
        let radiusPoints = 0;
        const problems: string[] = [];
        for (const dpr of DPRS) {
          const chrome = committedPixels(c.id, dpr);
          if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
          const list = boxes(p, c.environment.viewport, dpr);
          for (const pt of casePoints(p, c.environment.viewport, dpr)) {
            const kind = ruleKind(pt.rule);
            if (kind === 'edge' || kind === 'glyph') continue;
            if (kind === 'radius' || (kind === 'clip' && pt.rule.split(':').length === 3 && /-(left|right)$/.test(pt.rule))) radiusPoints++;
            const i = (pt.y * chrome.width + pt.x) * 4;
            const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2], chrome.data[i + 3]];
            const want = modelAt(list, pt.x, pt.y);
            if (got.some((v, k) => v !== want[k])) problems.push(`${pt.rule} at ${pt.x},${pt.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
          }
        }
        expect(problems).toEqual([]);
        expect(radiusPoints, 'radius and rounded clip points').toBeGreaterThan(0);
      });
    }
  }
});
