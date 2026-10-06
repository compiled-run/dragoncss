// The per-feature registries (diagnostic codes, faults, property families, animation kinds, paint modules): each feature owns its
// own file and one line in a central list kept sorted by feature id, and no two features claim the same name.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALIAS_FAMILIES } from '../src/css/aliases.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { LONGHANDS, PROPERTY_FAMILIES, SHORTHANDS } from '../src/css/properties.ts';
import { DIAGNOSTIC_FEATURES, LEGACY_FEATURES } from '../src/diagnostics/codes.ts';
import { paintPlants, PAINT_EMITTERS } from '../src/emit/paint/registry.ts';
import { FAULT_GROUPS, NO_FAULTS } from '../src/faults.ts';
import { PAINT_LOWERINGS } from '../src/lower/paint/registry.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every name claimed by more than one owner, as "name: owner, owner". */
function doubleClaims(owners: readonly (readonly [owner: string, names: readonly string[]])[]): string[] {
  const by = new Map<string, string[]>();
  for (const [owner, names] of owners) for (const n of names) by.set(n, [...(by.get(n) ?? []), owner]);
  return [...by].filter(([, o]) => o.length > 1).map(([n, o]) => `${n}: ${o.join(', ')}`);
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

/** The feature file stems of a registry directory. */
const stems = (dir: string): string[] => readdirSync(join(SRC, dir)).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3));

describe('doubleClaims', () => {
  it('names every name two owners claim, with both owners', () => {
    expect(doubleClaims([['a', ['x', 'y']], ['b', ['y']], ['c', ['z']]])).toEqual(['y: a, b']);
    expect(doubleClaims([['a', ['x']], ['b', ['y']]])).toEqual([]);
  });
});

describe('diagnostic codes (diagnostics/codes/<feature>.ts)', () => {
  const ids = Object.keys(DIAGNOSTIC_FEATURES) as (keyof typeof DIAGNOSTIC_FEATURES)[];
  it('one line per feature, sorted by id, one file per feature, and the legacy features registered', () => {
    expect(ids).toEqual(sorted(ids));
    expect(sorted(stems('diagnostics/codes'))).toEqual(sorted(ids));
    for (const id of LEGACY_FEATURES) expect(ids).toContain(id);
  });
  it('no code belongs to two features, and each feature catalogues exactly its own codes', () => {
    expect(doubleClaims(ids.map((id) => [id, DIAGNOSTIC_FEATURES[id].codes]))).toEqual([]);
    for (const id of ids) expect(sorted(Object.keys(DIAGNOSTIC_FEATURES[id].catalogue)), id).toEqual(sorted(DIAGNOSTIC_FEATURES[id].codes));
  });
});

describe('faults (faults/<feature>.ts)', () => {
  const ids = Object.keys(FAULT_GROUPS) as (keyof typeof FAULT_GROUPS)[];
  it('one line per feature, sorted by id, one file per feature', () => {
    expect(ids).toEqual(sorted(ids));
    expect(sorted(stems('faults'))).toEqual(sorted(ids));
  });
  it('no fault belongs to two features, and NO_FAULTS holds every feature\'s faults off', () => {
    expect(doubleClaims(ids.map((id) => [id, Object.keys(FAULT_GROUPS[id])]))).toEqual([]);
    expect(sorted(Object.keys(NO_FAULTS))).toEqual(sorted(ids.flatMap((id) => Object.keys(FAULT_GROUPS[id]))));
    for (const [k, v] of Object.entries(NO_FAULTS)) expect(v === false || v === null, k).toBe(true);
  });
});

describe('property families (css/properties/<family>.ts)', () => {
  it('family ids are unique, and no longhand or shorthand belongs to two families', () => {
    expect(doubleClaims(PROPERTY_FAMILIES.map((f, i) => [`#${i}`, [f.id]]))).toEqual([]);
    expect(doubleClaims(PROPERTY_FAMILIES.map((f) => [f.id, f.longhands]))).toEqual([]);
    expect(doubleClaims(PROPERTY_FAMILIES.map((f) => [f.id, f.shorthands]))).toEqual([]);
    expect(new Set(LONGHANDS).size).toBe(LONGHANDS.length);
    expect(new Set(SHORTHANDS).size).toBe(SHORTHANDS.length);
  });
  it('each family\'s inherited, container and text-role lists name only its own longhands', () => {
    for (const f of PROPERTY_FAMILIES) {
      for (const p of [...f.inherited, ...f.container, ...f.textRole, ...Object.keys(f.aspects)]) expect(f.longhands, `${f.id}: ${p}`).toContain(p);
    }
  });
});

describe('legacy aliases (css/aliases/<family>.ts)', () => {
  const ids = Object.keys(ALIAS_FAMILIES);
  it('one line per family, sorted by id, one file per family, each a property family', () => {
    expect(ids).toEqual(sorted(ids));
    expect(sorted(stems('css/aliases'))).toEqual(sorted(ids));
    for (const id of ids) expect(PROPERTY_FAMILIES.map((f) => f.id), id).toContain(id);
  });
  it('no alias is claimed twice or is itself a property, and each family file aliases only its own family\'s properties', () => {
    expect(doubleClaims(ids.map((id) => [id, Object.keys(ALIAS_FAMILIES[id]!)]))).toEqual([]);
    for (const id of ids) {
      const family = PROPERTY_FAMILIES.find((f) => f.id === id)!;
      const own: readonly string[] = [...family.longhands, ...family.shorthands];
      for (const [alias, property] of Object.entries(ALIAS_FAMILIES[id]!)) {
        expect(own, `${id}: ${alias}`).toContain(property);
        expect([...LONGHANDS, ...SHORTHANDS] as readonly string[], alias).not.toContain(alias);
      }
    }
  });
});

describe('animation kinds (css/animation-kinds/<family>.ts)', () => {
  const text = readFileSync(join(SRC, 'css/animation-kinds.ts'), 'utf8');
  const spread = [...text.matchAll(/^ {2}\.\.\.([A-Z_]+)_ANIMATION,$/gm)].map((m) => m[1]!.toLowerCase().replace(/_/g, '-'));
  it('one spread per family file, sorted by family id', () => {
    expect(spread).toEqual(sorted(spread));
    expect(sorted(spread)).toEqual(sorted(stems('css/animation-kinds').filter((s) => s !== 'kinds')));
  });
  it('no longhand is claimed by two family files, and every family file names only its family\'s longhands', async () => {
    const files = await Promise.all(spread.map(async (id) => [id, Object.keys((await import(join(SRC, 'css/animation-kinds', `${id}.ts`)))[`${id.toUpperCase().replace(/-/g, '_')}_ANIMATION`] as object)] as const));
    expect(doubleClaims(files)).toEqual([]);
    for (const [id, names] of files) expect(sorted(names), id).toEqual(sorted(PROPERTY_FAMILIES.find((f) => f.id === id)?.longhands ?? []));
    expect(sorted(Object.keys(ANIMATION_KINDS))).toEqual(sorted(LONGHANDS));
  });
});

describe('paint modules (lower/paint/<module>.ts, emit/paint/<module>.ts)', () => {
  it('no write kind, vocabulary key or raster plant belongs to two modules', () => {
    expect(doubleClaims(PAINT_LOWERINGS.map((m) => [m.name, Object.keys(m.css)]))).toEqual([]);
    expect(doubleClaims(PAINT_EMITTERS.map((m) => [m.name, m.kinds]))).toEqual([]);
    expect(doubleClaims(PAINT_EMITTERS.map((m) => [m.name, m.plants.map((p) => p.name)]))).toEqual([]);
    expect(paintPlants().map((p) => p.name)).toEqual(PAINT_EMITTERS.flatMap((m) => m.plants.map((p) => p.name)));
  });
});
