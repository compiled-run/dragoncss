// The per-feature registries of the parity package and the regen chain: each feature owns its own file and one line in a central
// list kept sorted, and no two features claim the same id, step name or output.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANUAL, REGEN_FEATURES, STEPS } from '../../../scripts/regen.ts';
import { compilePattern, matchSegments } from '../../../scripts/macroscope-ignore.ts';
import { globsOverlap, overlappingOutputs, placeSteps, type RegenFeature, type Step } from '../../../scripts/regen-steps/step.ts';
import { FIXTURE_GROUPS, FIXTURES, GROUPS, LEGACY_RUN_ORDER } from '../src/fixtures.ts';
import { repoPath } from '../src/paths.ts';

/** Every name claimed by more than one owner, as "name: owner, owner". */
function doubleClaims(owners: readonly (readonly [owner: string, names: readonly string[]])[]): string[] {
  const by = new Map<string, string[]>();
  for (const [owner, names] of owners) for (const n of names) by.set(n, [...(by.get(n) ?? []), owner]);
  return [...by].filter(([, o]) => o.length > 1).map(([n, o]) => `${n}: ${o.join(', ')}`);
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();
/** The module paths of a source file's imports from one directory, in source order. */
const importsFrom = (file: string, dir: string): string[] => [...readFileSync(repoPath(file), 'utf8').matchAll(new RegExp(`^import .* from '\\./${dir}/([^']+)';$`, 'gm'))].map((m) => m[1] as string);

describe('doubleClaims', () => {
  it('names every name two owners claim, with both owners', () => {
    expect(doubleClaims([['a', ['x', 'y']], ['b', ['y']], ['c', ['z']]])).toEqual(['y: a, b']);
    expect(doubleClaims([['a', ['x']], ['b', ['y']]])).toEqual([]);
  });
});

describe('fixture groups (packages/parity/src/fixture-groups/<group>.ts)', () => {
  const ids = Object.keys(GROUPS);
  it('one line per group and one import per group file, each sorted', () => {
    expect(ids).toEqual(sorted(ids));
    const imports = importsFrom('packages/parity/src/fixtures.ts', 'fixture-groups');
    expect(imports).toEqual(sorted(imports));
    const files = readdirSync(repoPath('packages/parity/src/fixture-groups')).filter((f) => f.endsWith('.ts') && f !== 'define.ts');
    expect(sorted(imports)).toEqual(sorted(files));
  });
  it('every group runs once: the legacy groups in their frozen order, then the rest by id', () => {
    expect(doubleClaims(LEGACY_RUN_ORDER.map((id, i) => [`#${i}`, [id]]))).toEqual([]);
    expect(FIXTURE_GROUPS.map((g) => g.id)).toEqual([...LEGACY_RUN_ORDER, ...sorted(ids.filter((id) => !(LEGACY_RUN_ORDER as readonly string[]).includes(id)))]);
    expect(sorted(FIXTURE_GROUPS.map((g) => g.id))).toEqual(sorted(ids));
  });
  it('no fixture id belongs to two groups, and no two groups share a fixture list', () => {
    expect(doubleClaims(FIXTURE_GROUPS.map((g) => [g.id, g.fixtures.map((f) => f.id)]))).toEqual([]);
    expect(new Set(FIXTURE_GROUPS.map((g) => g.fixtures)).size).toBe(FIXTURE_GROUPS.length);
    expect(new Set(FIXTURES.map((f) => f.id)).size).toBe(FIXTURES.length);
  });
});

describe('regen steps (scripts/regen-steps/<feature>.ts)', () => {
  const ids = Object.keys(REGEN_FEATURES);
  it('one line per feature and one import per feature file, each sorted', () => {
    expect(ids).toEqual(sorted(ids));
    const imports = importsFrom('scripts/regen.ts', 'regen-steps').filter((f) => f !== 'step.ts');
    expect(imports).toEqual(sorted(imports));
    const files = readdirSync(repoPath('scripts/regen-steps')).filter((f) => f.endsWith('.ts') && f !== 'step.ts');
    expect(imports).toEqual(sorted(files));
    expect(sorted(files)).toEqual(ids.map((id) => `${id}.ts`));
  });
  it('no step name, output or MANUAL command is claimed twice', () => {
    expect(doubleClaims(STEPS.map((s, i) => [`#${i}`, [s.name]]))).toEqual([]);
    expect(doubleClaims([...STEPS.map((s) => [s.name, s.outputs] as const), ...MANUAL.map((m) => [m.command, m.outputs] as const)])).toEqual([]);
    expect(doubleClaims(MANUAL.map((m, i) => [`#${i}`, [m.command]]))).toEqual([]);
  });
  it('no tracked file is written by two steps, and placeSteps refuses a step whose outputs overlap another\'s', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoPath('.'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p !== '');
    const writers = (p: string): string[] => STEPS.filter((s) => s.outputs.some((g) => matchSegments(compilePattern(g), p.split('/')))).map((s) => s.name);
    expect(tracked.filter((p) => writers(p).length > 1).map((p) => `${p}: ${writers(p).join(', ')}`)).toEqual([]);
    expect(overlappingOutputs(STEPS)).toBeNull();
    const step = (name: string, outputs: string[]): Step => ({ name, argv: ['true'], outputs });
    expect(() => placeSteps([step('a', ['out/a/**'])], { x: { steps: [{ after: 'a', step: step('x1', ['out/**']) }], outputs: {}, manual: [] } })).toThrow('steps a and x1 both write out/a/** / out/**');
    expect(() => placeSteps([step('a', ['out/a/**']), step('b', ['out/b/*.json'])], { x: { steps: [], outputs: { b: ['out/a/x/**'] }, manual: [] } })).toThrow('steps a and b both write');
    expect(globsOverlap('packages/layout/vectors/dpr-*/**', 'packages/layout/vectors/text-latin/dpr-2/**')).toBe(false);
  });
  it('placeSteps puts each feature step after the step it names, features in id order, and refuses an unknown step', () => {
    const step = (name: string): Step => ({ name, argv: ['true'], outputs: [`${name}/**`] });
    const feature = (steps: RegenFeature['steps'], outputs: RegenFeature['outputs'] = {}): RegenFeature => ({ steps, outputs, manual: [] });
    const placed = placeSteps([step('a'), step('b')], { z: feature([{ after: 'a', step: step('z1') }]), y: feature([{ after: 'a', step: step('y1') }, { after: 'y1', step: step('y2') }], { b: ['extra/**'] }) });
    expect(placed.map((s) => s.name)).toEqual(['a', 'y1', 'y2', 'z1', 'b']);
    expect(placed.find((s) => s.name === 'b')?.outputs).toEqual(['b/**', 'extra/**']);
    expect(() => placeSteps([step('a')], { x: feature([{ after: 'nope', step: step('x1') }]) })).toThrow('x places step x1 after nope, which is no step');
    expect(() => placeSteps([step('a')], { x: feature([], { nope: ['o/**'] }) })).toThrow('x adds outputs to nope, which is no step');
  });
});
