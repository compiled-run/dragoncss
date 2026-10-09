// dragon.native-dump/1 (docs/research/native-strategy.md 3.2; notes/T002-device-lanes.md 1.2): one data description of every
// field, its type, whether it is required and when it may be null. The TS types are inferred from it and the validator walks it,
// so neither can drift from it; P4 emits the Swift and Kotlin encoders from the same description.

export type Nullable = 'never' | 'always' | 'reference-lane';

export type FieldType =
  | { readonly kind: 'string'; readonly nonEmpty: boolean }
  | { readonly kind: 'const'; readonly value: string }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'number' }
  | { readonly kind: 'integer'; readonly min: number | null; readonly max: number | null }
  | { readonly kind: 'object'; readonly fields: readonly Field[] }
  | { readonly kind: 'array'; readonly items: FieldType; readonly length: number | null }
  | { readonly kind: 'map'; readonly values: FieldType }
  | { readonly kind: 'json' };

/** One key of an object: every key is required; nullable says when null is allowed ('reference-lane': only in a ts-reference dump). */
export type Field = { readonly name: string; readonly type: FieldType; readonly required: boolean; readonly nullable: Nullable; readonly doc: string };

function field<const N extends string, const X extends FieldType>(name: N, type: X, doc: string): { readonly name: N; readonly type: X; readonly required: true; readonly nullable: 'never'; readonly doc: string } {
  return { name, type, required: true, nullable: 'never', doc };
}
function orNull<const N extends string, const X extends FieldType, const U extends Exclude<Nullable, 'never'>>(name: N, type: X, doc: string, nullable: U): { readonly name: N; readonly type: X; readonly required: true; readonly nullable: U; readonly doc: string } {
  return { name, type, required: true, nullable, doc };
}
const str = { kind: 'string', nonEmpty: false } as const;
const id = { kind: 'string', nonEmpty: true } as const;
const num = { kind: 'number' } as const;
const int = { kind: 'integer', min: null, max: null } as const;
const obj = <const Fs extends readonly Field[]>(fields: Fs): { readonly kind: 'object'; readonly fields: Fs } => ({ kind: 'object', fields });
const arr = <const X extends FieldType>(items: X, length: number | null = null): { readonly kind: 'array'; readonly items: X; readonly length: number | null } => ({ kind: 'array', items, length });

const FRAME = obj([field('x', num, 'css px, absolute to the fixture root'), field('y', num, 'css px'), field('width', num, 'css px'), field('height', num, 'css px')]);
const DEVICE_EDGES = obj([field('left', int, 'device px'), field('top', int, 'device px'), field('right', int, 'device px'), field('bottom', int, 'device px')]);

/** The lanes that write a dump: the two device lanes, and the TS engine plus snapRect reference (no text engine, no pixels). */
export const DUMP_LANES = ['ios-sim', 'android-emu', 'ts-reference'] as const;
export const REFERENCE_LANE = 'ts-reference';

export const NATIVE_DUMP_SCHEMA = obj([
  field('schema', { kind: 'const', value: 'dragon.native-dump/1' }, 'the schema id'),
  field('lane', { kind: 'enum', values: DUMP_LANES }, 'the lane that wrote the dump'),
  field('case', obj([
    field('id', id, 'the parity case id; joins the Chrome capture of the same case and DPR'),
    field('fixture', id, 'the fixture id'),
    field('dpr', num, 'the device pixel ratio of the case'),
    field('viewport', obj([field('width', num, 'css px'), field('height', num, 'css px')]), 'the case viewport'),
    field('direction', { kind: 'enum', values: ['ltr', 'rtl'] }, 'the environment direction'),
    field('compilerDigest', id, 'the compilation digest of the compiled result'),
    orNull('expectedDigest', id, 'the digest of the backend expected dump', 'reference-lane'),
  ]), 'the case'),
  field('device', obj([
    field('platform', { kind: 'enum', values: ['ios', 'android'] }, 'the native target'),
    field('os', str, 'OS version and build'),
    field('model', str, 'device model or AVD name'),
    field('abi', str, 'arm64, arm64-v8a or x86_64'),
    field('scale', num, 'UIScreen scale or densityDpi / 160; equals case.dpr'),
    field('toolchain', str, 'Xcode or AGP and JDK'),
    field('renderer', str, 'simulator-metal or swiftshader_indirect'),
  ]), 'the device the dump was read on'),
  field('units', { kind: 'const', value: 'css-px' }, 'frames are device px / scale; deviceEdges keep the ints'),
  field('nodes', arr(obj([
    field('id', id, 'the compiler node id; joins data-dragon-id; a missing id fails the case'),
    orNull('parent', id, 'the parent node id; null for the fixture root', 'always'),
    field('kind', { kind: 'enum', values: ['element', 'text', 'anonymous'] }, 'the laid-out node kind'),
    field('native', id, 'the native class read back from the live tree'),
    field('frame', FRAME, 'read back from the live native tree, never from what the code meant to write'),
    field('deviceEdges', DEVICE_EDGES, 'the snapped absolute edges in whole device px'),
    field('applied', { kind: 'map', values: { kind: 'json' } }, 'backend-named properties read back from the live object'),
    field('lines', arr(obj([
      field('frame', FRAME, 'the line box, css px, absolute'),
      field('deviceEdges', DEVICE_EDGES, 'the line box in whole device px'),
      orNull('baseline', num, 'css px from the line top', 'reference-lane'),
      orNull('start', { kind: 'integer', min: 0, max: null }, 'first text offset of the line', 'reference-lane'),
      orNull('end', { kind: 'integer', min: 0, max: null }, 'text offset after the line', 'reference-lane'),
    ])), 'one entry per line box of a text node, in order; empty for other nodes'),
  ])), 'every laid-out node'),
  orNull('pixels', obj([
    field('capture', { kind: 'enum', values: ['drawHierarchy', 'PixelCopy'] }, 'the compositor capture; layer.render and View.draw are banned'),
    field('colorSpace', { kind: 'const', value: 'sRGB' }, 'the declared colour space'),
    field('width', { kind: 'integer', min: 0, max: null }, 'device px'),
    field('height', { kind: 'integer', min: 0, max: null }, 'device px'),
    field('sha256', id, 'of the RGBA8 buffer'),
    field('samples', arr(obj([
      field('x', { kind: 'integer', min: 0, max: null }, 'device px'),
      field('y', { kind: 'integer', min: 0, max: null }, 'device px'),
      field('rgba', arr({ kind: 'integer', min: 0, max: 255 }, 4), 'RGBA8'),
      field('rule', id, 'the generator rule, e.g. interior:n3'),
    ])), 'the generated sample points (samples.ts), read from the capture'),
  ]), 'numeric paint evidence', 'reference-lane'),
  orNull('timing', obj([field('settleMs', num, 'ms'), field('dumpMs', num, 'ms')]), 'informational; never compared', 'reference-lane'),
]);

// ---------------------------------------------------------------- types inferred from the description

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [k: string]: JsonValue };

type InferType<X> =
  X extends { readonly kind: 'string' } ? string
    : X extends { readonly kind: 'const'; readonly value: infer V } ? V
      : X extends { readonly kind: 'enum'; readonly values: readonly (infer V)[] } ? V
        : X extends { readonly kind: 'number' | 'integer' } ? number
          : X extends { readonly kind: 'object'; readonly fields: infer Fs extends readonly Field[] } ? InferObject<Fs>
            : X extends { readonly kind: 'array'; readonly items: infer I } ? readonly InferType<I>[]
              : X extends { readonly kind: 'map'; readonly values: infer V } ? { readonly [k: string]: InferType<V> }
                : X extends { readonly kind: 'json' } ? JsonValue
                  : never;
type InferField<F> = F extends { readonly type: infer X; readonly nullable: 'never' } ? InferType<X> : F extends { readonly type: infer X } ? InferType<X> | null : never;
type InferObject<Fs extends readonly Field[]> = { readonly [K in Fs[number] as K['name']]: InferField<K> };

export type NativeDump = InferType<typeof NATIVE_DUMP_SCHEMA>;
export type DumpNode = NativeDump['nodes'][number];
export type DumpLine = DumpNode['lines'][number];
export type DumpEdges = DumpNode['deviceEdges'];
export type DumpFrame = DumpNode['frame'];
export type DumpPixels = NonNullable<NativeDump['pixels']>;
export type DumpSample = DumpPixels['samples'][number];

// ---------------------------------------------------------------- validator

export type DumpErrorCode =
  | 'missing-key' | 'extra-key' | 'null-not-allowed' | 'wrong-type' | 'not-integer' | 'out-of-range' | 'bad-const' | 'bad-enum'
  | 'bad-length' | 'empty-string' | 'duplicate-id' | 'unknown-parent';
export type DumpError = { readonly path: string; readonly code: DumpErrorCode; readonly detail: string };
export type DumpValidation = { readonly ok: true; readonly dump: NativeDump } | { readonly ok: false; readonly errors: readonly DumpError[] };

function isJson(v: unknown): boolean {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJson);
  if (typeof v === 'object') return Object.values(v as object).every(isJson);
  return false;
}

/** Rejects a missing or extra key at every level, a null where the lane allows none, non-integer deviceEdges and duplicate node ids. */
export function validateNativeDump(value: unknown): DumpValidation {
  const errors: DumpError[] = [];
  const reference = typeof value === 'object' && value !== null && (value as { lane?: unknown }).lane === REFERENCE_LANE;
  const err = (path: string, code: DumpErrorCode, detail: string): void => {
    errors.push({ path, code, detail });
  };
  const check = (v: unknown, t: FieldType, path: string): void => {
    switch (t.kind) {
      case 'string':
        if (typeof v !== 'string') return err(path, 'wrong-type', 'expected a string');
        if (t.nonEmpty && v === '') err(path, 'empty-string', 'must not be empty');
        return;
      case 'const':
        if (v !== t.value) err(path, 'bad-const', `expected ${JSON.stringify(t.value)}`);
        return;
      case 'enum':
        if (typeof v !== 'string' || !t.values.includes(v)) err(path, 'bad-enum', `expected one of ${t.values.join(', ')}`);
        return;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) err(path, 'wrong-type', 'expected a finite number');
        return;
      case 'integer':
        if (typeof v !== 'number' || !Number.isFinite(v)) return err(path, 'wrong-type', 'expected an integer');
        if (!Number.isInteger(v)) return err(path, 'not-integer', `${v} is not an integer`);
        if ((t.min !== null && v < t.min) || (t.max !== null && v > t.max)) err(path, 'out-of-range', `${v} outside ${t.min ?? '-inf'}..${t.max ?? 'inf'}`);
        return;
      case 'json':
        if (!isJson(v)) err(path, 'wrong-type', 'expected JSON data');
        return;
      case 'map':
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return err(path, 'wrong-type', 'expected an object');
        for (const [k, x] of Object.entries(v)) check(x, t.values, `${path}.${k}`);
        return;
      case 'array':
        if (!Array.isArray(v)) return err(path, 'wrong-type', 'expected an array');
        if (t.length !== null && v.length !== t.length) err(path, 'bad-length', `expected ${t.length} items, got ${v.length}`);
        v.forEach((x, i) => check(x, t.items, `${path}[${i}]`));
        return;
      case 'object': {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return err(path, 'wrong-type', 'expected an object');
        const o = v as Record<string, unknown>;
        for (const f of t.fields) {
          const p = path === '' ? f.name : `${path}.${f.name}`;
          if (!Object.hasOwn(o, f.name)) {
            if (f.required) err(p, 'missing-key', `${f.name} is required`);
            continue;
          }
          const x = o[f.name];
          if (x === null) {
            if (!(f.nullable === 'always' || (f.nullable === 'reference-lane' && reference))) err(p, 'null-not-allowed', f.nullable === 'reference-lane' ? 'null only in a ts-reference dump' : 'never null');
            continue;
          }
          check(x, f.type, p);
        }
        for (const k of Object.keys(o)) if (!t.fields.some((f) => f.name === k)) err(path === '' ? k : `${path}.${k}`, 'extra-key', `${k} is not in dragon.native-dump/1`);
        return;
      }
    }
  };
  check(value, NATIVE_DUMP_SCHEMA, '');
  if (errors.length === 0) {
    const nodes = (value as NativeDump).nodes;
    const ids = new Set<string>();
    nodes.forEach((n, i) => {
      if (ids.has(n.id)) err(`nodes[${i}].id`, 'duplicate-id', `${n.id} appears twice`);
      ids.add(n.id);
    });
    nodes.forEach((n, i) => {
      if (n.parent !== null && !ids.has(n.parent)) err(`nodes[${i}].parent`, 'unknown-parent', `${n.parent} is not a node of the dump`);
    });
    // INL1a: a device dump's element lines (an inline box's fragments) have no text of their own.
    if (!reference) {
      nodes.forEach((n, i) => {
        if (n.kind === 'text') return;
        n.lines.forEach((l, j) => {
          if (l.start !== 0 || l.end !== 0) err(`nodes[${i}].lines[${j}]`, 'out-of-range', `${n.id}:line${j} has no own text; start and end are 0`);
        });
      });
    }
  }
  return errors.length === 0 ? { ok: true, dump: value as NativeDump } : { ok: false, errors };
}

/** The frame a platform writes for snapped device edges: edge / scale, sizes from the snapped edges (native-strategy.md 3.3). */
export function frameOf(e: DumpEdges, scale: number): DumpFrame {
  return { x: e.left / scale, y: e.top / scale, width: (e.right - e.left) / scale, height: (e.bottom - e.top) / scale };
}
