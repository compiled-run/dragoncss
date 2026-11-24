// The build runs its own copy of the engine's phase I, since the published dragon package does not depend on @dragon/layout.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENGINE = 'packages/layout/src/white-space.ts';
const COPY = 'packages/dragon/src/analysis/white-space.ts';

describe('the build phase I copy', () => {
  it(`${COPY} is a byte-for-byte copy of ${ENGINE}`, () => {
    const engine = readFileSync(join(ROOT, ENGINE));
    const copy = readFileSync(join(ROOT, COPY));
    expect(copy.equals(engine), `${COPY} differs from ${ENGINE}: edit ${ENGINE} and copy it over (cp ${ENGINE} ${COPY})`).toBe(true);
  });
});
