// Every layout case has its committed Chrome captures, at DPR 1 and at every DPR, so a PR that adds a fixture without its regen
// outputs fails the PR checks (ci.yml) rather than the device run that reads them (device-lanes.ts caseReference). No Chrome
// runs here: the files are only looked for.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedPath } from '../src/committed.ts';
import { DPRS, expectedDprPath, layoutCases } from '../src/dpr.ts';

const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));

describe('committed captures', () => {
  it('every layout case has its DPR 1 capture and one at every DPR (pnpm regen writes them)', () => {
    expect(ids.length).toBeGreaterThan(0);
    const missing = ids.flatMap((id) => [expectedPath(id), ...DPRS.map((dpr) => expectedDprPath(id, dpr))].filter((p) => !existsSync(p)));
    expect(missing).toEqual([]);
  });
});
