// dragon.native-dump/3 (native-strategy.md 3.2; MQ-R1 adds the environment record, MQ-R2 the device readings in it): the one schema description, the types inferred from it, and the validator, which
// rejects a missing or extra key at every level, a missing node id, non-integer deviceEdges and nulls outside the reference lane.
import { describe, expect, it } from 'vitest';
import type { Field, FieldType, NativeDump } from '../src/native-dump.ts';
import { NATIVE_DUMP_SCHEMA, REFERENCE_LANE, validateNativeDump } from '../src/native-dump.ts';

const edges = { left: 60, top: 60, right: 420, bottom: 180 };
/** An iPhone's platform readings (MQ-R2): a touch screen, no motion preference. */
const READINGS = { pointer: 'coarse', hover: 'none', anyPointer: ['coarse'], anyHover: 'none', reducedMotion: 'no-preference', source: 'platform', inputs: [0, 0] } as const;
const frame = { x: 20, y: 20, width: 120, height: 40 };

/** A device dump with every field present and non-null, as P5 writes it. */
function deviceDump(): NativeDump {
  return {
    schema: 'dragon.native-dump/3',
    lane: 'ios-sim',
    case: { id: 'flex-row-gap', fixture: 'flex-row-gap', dpr: 3, viewport: { width: 400, height: 300 }, direction: 'ltr', compilerDigest: 'c0ffee', expectedDigest: 'beef' },
    device: { platform: 'ios', os: '26.5 (23F77)', model: 'iPhone 17', abi: 'arm64', scale: 3, toolchain: 'Xcode 27.0 (27A266a)', renderer: 'simulator-metal' },
    units: 'css-px',
    nodes: [
      { id: 'html', parent: null, kind: 'element', native: 'UIView', frame, deviceEdges: edges, applied: {}, lines: [] },
      { id: 'n3', parent: 'html', kind: 'element', native: 'UIView', frame, deviceEdges: edges, applied: { 'layer.cornerRadius': 8, backgroundColor: [0.2, 0.4, 1, 1] }, lines: [] },
      { id: 'n3:text0', parent: 'n3', kind: 'text', native: 'DragonTextView', frame, deviceEdges: edges, applied: {}, lines: [{ frame, deviceEdges: edges, baseline: 10.5, start: 0, end: 3 }] },
    ],
    pixels: { capture: 'drawHierarchy', colorSpace: 'sRGB', width: 1200, height: 900, sha256: 'abc', samples: [{ x: 240, y: 120, rgba: [51, 102, 255, 255], rule: 'interior:n3' }] },
    timing: { settleMs: 3, dumpMs: 1 },
    environment: { rootPx: [1200, 900], dpr: 3, media: [400, 300], band: 1, readings: READINGS },
  };
}

type Json = Record<string, unknown> | unknown[];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Every object path of the description with a value path that holds it (nodes at index 2, the text node with a line). */
function objectPaths(t: FieldType, path: (string | number)[], out: { path: (string | number)[]; fields: readonly Field[] }[]): void {
  if (t.kind === 'object') {
    out.push({ path, fields: t.fields });
    for (const f of t.fields) objectPaths(f.type, [...path, f.name], out);
  } else if (t.kind === 'array') objectPaths(t.items, [...path, path[path.length - 1] === 'nodes' ? 2 : 0], out);
}
const PATHS: { path: (string | number)[]; fields: readonly Field[] }[] = [];
objectPaths(NATIVE_DUMP_SCHEMA, [], PATHS);

function at(root: unknown, path: readonly (string | number)[]): Json {
  let v = root;
  for (const k of path) v = (v as Record<string | number, unknown>)[k];
  return v as Json;
}
const dotted = (path: readonly (string | number)[], key: string): string => [...path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)), `.${key}`].join('').replace(/^\./, '').replace(/\.\[/g, '[');

describe('the schema description', () => {
  it('describes every field with a type and required flag; every key is required; deviceEdges are integers', () => {
    expect(PATHS.length).toBeGreaterThanOrEqual(10);
    for (const p of PATHS) for (const f of p.fields) {
      expect(f.required, f.name).toBe(true);
      expect(typeof f.type.kind).toBe('string');
      expect(f.doc.length).toBeGreaterThan(0);
    }
    const edgeObjects = PATHS.filter((p) => p.path[p.path.length - 1] === 'deviceEdges');
    expect(edgeObjects.map((p) => p.path.join('.'))).toEqual(['nodes.2.deviceEdges', 'nodes.2.lines.0.deviceEdges']);
    for (const p of edgeObjects) expect(p.fields.map((f) => [f.name, f.type.kind])).toEqual([['left', 'integer'], ['top', 'integer'], ['right', 'integer'], ['bottom', 'integer']]);
    expect(NATIVE_DUMP_SCHEMA.fields.map((f) => f.name)).toEqual(['schema', 'lane', 'case', 'device', 'units', 'nodes', 'pixels', 'timing', 'environment']);
  });
  it('MQ-R1 adds only the environment record: a /1 dump with the new schema id and a null environment (a layout case) validates', () => {
    const v1 = clone(deviceDump()) as unknown as Record<string, unknown>;
    delete v1['environment'];
    expect(validateNativeDump({ ...v1, schema: 'dragon.native-dump/3', environment: null }).ok).toBe(true);
    expect(validateNativeDump({ ...v1, schema: 'dragon.native-dump/1', environment: null }).ok).toBe(false);
    expect(validateNativeDump(v1).ok).toBe(false);
    const env = (e: unknown) => validateNativeDump({ ...v1, environment: e }).ok;
    const r = READINGS;
    expect([env({ rootPx: [1, 2], dpr: 3, media: [1, 2], band: 0, readings: r }), env({ rootPx: [1], dpr: 3, media: [1, 2], band: 0, readings: r }), env({ rootPx: [1, 2], dpr: 3, media: [1, 2], band: -1, readings: r }), env({ rootPx: [1, 2], dpr: 3, media: [1, 2], band: 0.5, readings: r })]).toEqual([true, false, false, false]);
  });
  it('MQ-R2 adds only the readings to the environment record: a /2 record without them fails, and every reading is a CSS keyword', () => {
    const v = clone(deviceDump()) as unknown as Record<string, unknown>;
    const env = (e: unknown) => validateNativeDump({ ...v, environment: e }).ok;
    const base = { rootPx: [1, 2], dpr: 3, media: [1, 2], band: 0 };
    expect(env(base)).toBe(false);
    expect(validateNativeDump({ ...v, schema: 'dragon.native-dump/2' }).ok).toBe(false);
    expect(env({ ...base, readings: { ...READINGS, pointer: 'coarse', anyPointer: ['coarse', 'fine'], anyHover: 'hover', source: 'injected' } })).toBe(true);
    for (const bad of [{ pointer: 'touch' }, { hover: true }, { anyPointer: ['none'] }, { reducedMotion: 'reduced' }, { source: 'os' }, { inputs: ['4098'] }]) expect(env({ ...base, readings: { ...READINGS, ...bad } }), JSON.stringify(bad)).toBe(false);
  });
  it('a complete device dump validates, and so does a reference dump with its reference-only nulls', () => {
    expect(validateNativeDump(clone(deviceDump()))).toMatchObject({ ok: true });
    const ref = clone(deviceDump()) as unknown as Record<string, unknown> & { case: Record<string, unknown>; nodes: { lines: Record<string, unknown>[] }[] };
    ref['lane'] = REFERENCE_LANE;
    ref['pixels'] = null;
    ref['timing'] = null;
    ref.case['expectedDigest'] = null;
    for (const l of ref.nodes[2]?.lines ?? []) Object.assign(l, { baseline: null, start: null, end: null });
    expect(validateNativeDump(ref)).toMatchObject({ ok: true });
  });
});

describe('the validator', () => {
  it('rejects a missing key at every level of the description', () => {
    let n = 0;
    for (const p of PATHS) for (const f of p.fields) {
      const d = clone(deviceDump());
      delete (at(d, p.path) as Record<string, unknown>)[f.name];
      const v = validateNativeDump(d);
      expect(v.ok, `${dotted(p.path, f.name)} removed`).toBe(false);
      if (!v.ok) expect(v.errors, dotted(p.path, f.name)).toContainEqual(expect.objectContaining({ path: dotted(p.path, f.name), code: 'missing-key' }));
      n++;
    }
    expect(n).toBe(PATHS.reduce((s, p) => s + p.fields.length, 0));
  });
  it('rejects an extra key at every level of the description', () => {
    for (const p of PATHS) {
      const d = clone(deviceDump());
      (at(d, p.path) as Record<string, unknown>)['extra'] = 1;
      const v = validateNativeDump(d);
      expect(v.ok, `extra key under ${p.path.join('.')}`).toBe(false);
      if (!v.ok) expect(v.errors).toContainEqual(expect.objectContaining({ path: dotted(p.path, 'extra'), code: 'extra-key' }));
    }
  });
  it('rejects a node without an id, an empty id and a duplicate id', () => {
    const missing = clone(deviceDump()) as unknown as { nodes: Record<string, unknown>[] };
    delete missing.nodes[1]?.['id'];
    expect(validateNativeDump(missing)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: 'nodes[1].id', code: 'missing-key' })] });
    const empty = clone(deviceDump()) as unknown as { nodes: Record<string, unknown>[] };
    (empty.nodes[1] as Record<string, unknown>)['id'] = '';
    expect(validateNativeDump(empty)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: 'nodes[1].id', code: 'empty-string' })] });
    const dup = clone(deviceDump()) as unknown as { nodes: Record<string, unknown>[] };
    (dup.nodes[2] as Record<string, unknown>)['id'] = 'n3';
    (dup.nodes[2] as Record<string, unknown>)['parent'] = 'html';
    expect(validateNativeDump(dup)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: 'nodes[2].id', code: 'duplicate-id' })] });
  });
  it('rejects non-integer deviceEdges on nodes and lines', () => {
    for (const [path, set] of [['nodes[1].deviceEdges.right', (d: NativeDump) => ((d.nodes[1] as unknown as { deviceEdges: { right: number } }).deviceEdges.right = 420.5)], ['nodes[2].lines[0].deviceEdges.top', (d: NativeDump) => (((d.nodes[2] as unknown as { lines: { deviceEdges: { top: number } }[] }).lines[0] as { deviceEdges: { top: number } }).deviceEdges.top = 60.25)]] as const) {
      const d = clone(deviceDump());
      set(d);
      expect(validateNativeDump(d)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path, code: 'not-integer' })] });
    }
  });
  it('allows the reference-only nulls in a ts-reference dump only; parent is null only at the root', () => {
    const d = clone(deviceDump()) as unknown as Record<string, unknown>;
    d['pixels'] = null;
    expect(validateNativeDump(d)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: 'pixels', code: 'null-not-allowed' })] });
    const orphan = clone(deviceDump()) as unknown as { nodes: Record<string, unknown>[] };
    (orphan.nodes[1] as Record<string, unknown>)['parent'] = 'nowhere';
    expect(validateNativeDump(orphan)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: 'nodes[1].parent', code: 'unknown-parent' })] });
  });
  it('rejects wrong types, constants, enums, RGBA8 ranges and lengths', () => {
    const cases: [string, (d: Record<string, unknown>) => void, string][] = [
      ['schema', (d) => (d['schema'] = 'dragon.native-dump/4'), 'bad-const'],
      ['lane', (d) => (d['lane'] = 'robolectric'), 'bad-enum'],
      ['case.dpr', (d) => ((d['case'] as Record<string, unknown>)['dpr'] = '3'), 'wrong-type'],
      ['pixels.samples[0].rgba[0]', (d) => ((((d['pixels'] as Record<string, unknown>)['samples'] as Record<string, unknown>[])[0] as Record<string, unknown>)['rgba'] = [256, 0, 0, 255]), 'out-of-range'],
      ['pixels.samples[0].rgba', (d) => ((((d['pixels'] as Record<string, unknown>)['samples'] as Record<string, unknown>[])[0] as Record<string, unknown>)['rgba'] = [1, 2, 3]), 'bad-length'],
      ['nodes[1].applied.bad', (d) => (((d['nodes'] as Record<string, unknown>[])[1] as Record<string, Record<string, unknown>>)['applied'] as Record<string, unknown>)['bad'] = Number.NaN, 'wrong-type'],
    ];
    for (const [path, set, code] of cases) {
      const d = clone(deviceDump()) as unknown as Record<string, unknown>;
      set(d);
      const v = validateNativeDump(d);
      expect(v.ok, path).toBe(false);
      if (!v.ok) expect(v.errors, path).toContainEqual(expect.objectContaining({ path, code }));
    }
  });
});
