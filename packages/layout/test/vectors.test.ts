import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layout, measurerFor, validateLayoutInput } from '../src/index.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

type VectorFile = { platform: string; measurer: string; input: unknown; output: unknown };

/** The engine with the measurer a vector names; a platform with no rules is refused, never measured with another's. */
function run(v: VectorFile): unknown {
  const m = measurerFor(v.platform);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  expect(m.key).toBe(v.measurer);
  const valid = validateLayoutInput(v.input);
  if (!valid.ok) throw new Error(JSON.stringify(valid.errors));
  const r = layout(valid.input, m.measurer);
  if (r.kind !== 'ok') throw new Error(r.unsupported.code);
  return r.boxes;
}

describe('shared vectors (written only by pnpm run layout:vectors; format in vectors/README.md)', () => {
  it('exist', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`${file}: names its platform and measurer, passes the validator, and the engine reproduces its output exactly`, () => {
      const vector = JSON.parse(readFileSync(join(dir, file), 'utf8')) as VectorFile;
      expect(Object.keys(vector)).toEqual(['platform', 'measurer', 'input', 'output']);
      expect(run(vector)).toEqual(vector.output);
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

describe('(e) the documented vector format (vectors/README.md)', () => {
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  const block = (info: string): unknown => {
    const m = new RegExp(`\`\`\`json ${info}\\n([\\s\\S]*?)\\n\`\`\``).exec(readme);
    if (m === null) throw new Error(`no ${info} block in README.md`);
    return JSON.parse(m[1] as string);
  };
  it('the example input validates with every field present, and laying it out gives the documented output', () => {
    const input = block('vector-input') as { root: { style: Record<string, unknown>; children: { style: Record<string, unknown> }[] } };
    expect(Object.keys(input.root.style).length).toBe(42);
    expect(validateLayoutInput(input).ok).toBe(true);
    expect(run({ platform: 'darwin-arm64', measurer: 'ahem/darwin-arm64', input, output: null })).toEqual(block('vector-output'));
    // No defaults: dropping any one style field of the example is a validation error.
    for (const k of Object.keys(input.root.style)) {
      const copy = JSON.parse(JSON.stringify(input)) as typeof input;
      delete copy.root.style[k];
      expect(validateLayoutInput(copy).ok, k).toBe(false);
    }
  });
  it('documents the keys, units, ordering and measurer keys a port must follow', () => {
    for (const phrase of ['"platform"', '"measurer"', 'ahem/darwin-arm64', 'no-platform-rules', 'in LU', '1/64 px', 'preorder', 'absolutely positioned box', '<leaf>:line<j>', 'no defaults', 'Parents come before children']) expect(readme, phrase).toContain(phrase);
  });
  it('a vector for a platform with no rules is refused by measurerFor', () => {
    expect(measurerFor('linux-x64')).toMatchObject({ kind: 'refused', code: 'no-platform-rules' });
  });
});
