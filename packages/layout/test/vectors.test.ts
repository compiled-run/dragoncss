import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ahemMeasurer, layout, validateLayoutInput } from '../src/index.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

describe('shared vectors (written only by pnpm run layout:vectors)', () => {
  it('exist', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`${file}: passes the validator and the engine reproduces its output exactly`, () => {
      const vector = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { input: unknown; output: unknown };
      expect(Object.keys(vector).sort()).toEqual(['input', 'output']);
      const v = validateLayoutInput(vector.input);
      if (!v.ok) throw new Error(JSON.stringify(v.errors));
      const r = layout(v.input, ahemMeasurer);
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') expect(r.boxes).toEqual(vector.output);
    });
  }
  it('planted fault 3: a vector with a missing field is rejected by the validator', () => {
    const first = files[0] as string;
    const vector = JSON.parse(readFileSync(join(dir, first), 'utf8')) as { input: { root: { style: Record<string, unknown> } } };
    delete vector.input.root.style['flexShrink'];
    const v = validateLayoutInput(vector.input);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toContainEqual(expect.objectContaining({ code: 'missing-key', path: '$.root.style.flexShrink' }));
  });
});
