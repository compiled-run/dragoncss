// Typed slots of a Markless style input (docs/markless-native-styles.md "Style values that follow state"): a number the app writes
// into an element's style attribute while it runs. Dragon compiles the input at sample values of each slot, finds every engine-input
// style field and write number the slot moves, and fits each piece of it (below zero, zero and up, not finite) to one rule, checked
// exactly at every sample; the device writes the rule's value in and lays out again (harness.ts runMarklessLayout).
import type { AnimProgram, ElementMotion, NativeStyleTarget, StateProgram } from 'dragon';
import { admittedAnimation, animationKind } from 'dragon';

/** A number the app computes while it runs, at its initial state; `integer` when the app writes whole numbers only. */
export type MarklessSlot = { readonly id: string; readonly initial: number; readonly integer?: true };
/** An element's style attribute as text with holes, each filled with a slot's value as JavaScript writes the number. */
export type StyleTemplate = readonly (string | { readonly slot: string })[];

export type SlotRuleName = 'line' | 'line32' | 'channel';
/** c + k·s, rounded to a 32-bit float (line32) or to Chrome's 8-bit rgb() channel (channel); not finite: c. */
export type SlotRule = readonly [rule: SlotRuleName, c: number, k: number];
export type SlotPath = readonly (string | number)[];
/** Per piece (below zero, zero and up, not finite): the field's value, and each number in it that follows the slot. */
export type SlotPiece = readonly [template: unknown, leaves: readonly (readonly [path: SlotPath, rule: SlotRule])[]];
/** An engine-input style field of a box (Dragon's id) that follows slot `slot` (its index in the input's slots). */
export type SlotField = readonly [slot: number, node: string, key: string, pieces: readonly [SlotPiece | null, SlotPiece | null, SlotPiece | null]];
/** A number inside the write of kind `write` of an export node (the input's id; a node has one write of each kind) that follows a slot. */
export type SlotWrite = readonly [slot: number, node: string, write: string, path: SlotPath, pieces: readonly [SlotRule | null, SlotRule | null, SlotRule | null]];
/** A piece is null where a sample in it does not compile (a value the web drops at parse time, which Dragon refuses): a phone given a value there stops with the piece's reason. */
export type SlotRefusal = readonly [slot: number, piece: number, reason: string];
export type SlotBindings = { readonly fields: readonly SlotField[]; readonly writes: readonly SlotWrite[]; readonly refused: readonly SlotRefusal[] };

/** The values Dragon compiles a slot at, below zero and from zero up (-1, -2 and 0, 1 first: they fix c and k). */
export const SLOT_SAMPLES = {
  number: [[-1, -2, -7.25, -100.5], [0, 1, 0.1, 2.5, 100.5, 300]],
  integer: [[-1, -2, -7, -100], [0, 1, 2, 7, 100, 300]],
} as const;

/** Why a value that is not finite stops the layout: it makes its whole declaration invalid, whatever the other slots in it hold. */
export const NOT_FINITE = 'is not a finite number (the web gets NaN or Infinity, which makes the declaration that holds it invalid)';

/** The piece a value falls in: 0 below zero, 1 zero and up (-0 too, which JavaScript writes as 0), 2 not finite. */
export const slotPiece = (s: number): 0 | 1 | 2 => (!Number.isFinite(s) ? 2 : s < 0 ? 0 : 1);

/** Chrome's 8-bit channel of an rgb() number (css/color.ts round8). */
const channel8 = (v: number): number => Math.min(255, Math.round(Math.min(255, Math.max(0, v))));

export function slotValue([rule, c, k]: SlotRule, s: number): number {
  const v = Number.isFinite(s) ? c + k * s : c;
  return rule === 'line32' ? Math.fround(v) : rule === 'channel' ? channel8(v) : v;
}

const fail = (what: string): never => {
  throw new Error(`markless style input: ${what}`);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks the input's slots and every element's styleTemplate; slots is the input's `slots` field, nodes its nodes. */
export function checkSlots(slots: unknown, nodes: readonly Record<string, unknown>[]): void {
  const ids = new Set<string>();
  if (slots !== undefined) {
    if (!Array.isArray(slots)) fail('slots is not a list');
    for (const s of slots as unknown[]) {
      if (!isRecord(s) || typeof s['id'] !== 'string' || s['id'] === '') fail(`bad slot ${JSON.stringify(s)}`);
      const slot = s as Record<string, unknown>;
      const other = Object.keys(slot).filter((k) => !['id', 'initial', 'integer'].includes(k));
      if (other.length > 0) fail(`slot ${String(slot['id'])} has ${other.join(', ')}, which the conversion does not read`);
      if (ids.has(slot['id'] as string)) fail(`slot ${String(slot['id'])} is listed twice`);
      if (slot['integer'] !== undefined && slot['integer'] !== true) fail(`slot ${String(slot['id'])}: integer is true or absent`);
      const initial = slot['initial'];
      if (typeof initial !== 'number' || !Number.isFinite(initial)) fail(`slot ${String(slot['id'])}: initial ${JSON.stringify(initial)} is not a finite number`);
      if (slot['integer'] === true && !Number.isInteger(initial)) fail(`slot ${String(slot['id'])}: initial ${String(initial)} is not a whole number`);
      ids.add(slot['id'] as string);
    }
  }
  const used = new Set<string>();
  const checkParts = (id: string, what: string, template: readonly unknown[]): void => {
    for (const part of template) {
      if (typeof part === 'string') continue;
      if (!isRecord(part) || Object.keys(part).join() !== 'slot' || typeof part['slot'] !== 'string') fail(`${id}: bad ${what} part ${JSON.stringify(part)}: a part is text or { slot }`);
      if (!ids.has((part as { slot: string }).slot)) fail(`${id}: ${what} names ${(part as { slot: string }).slot}, which is not a slot`);
      used.add((part as { slot: string }).slot);
    }
  };
  for (const n of nodes) {
    const template = n['styleTemplate'];
    const byState = n['styleByState'];
    if (template === undefined && byState === undefined) continue;
    const id = String(n['id']);
    const what = template === undefined ? 'styleByState' : 'styleTemplate';
    if (n['kind'] !== 'element') fail(`${id}: only an element has a ${what}`);
    if (template !== undefined && byState !== undefined) fail(`${id}: style is both a styleTemplate and a styleByState`);
    if (isRecord(n['attributes']) && 'style' in n['attributes']) fail(`${id}: style is both a fixed attribute and a ${what}`);
    if (isRecord(n['attributesByState']) && 'style' in n['attributesByState']) fail(`${id}: style is both an attribute by state and a ${what}`);
    if (template !== undefined) {
      if (!Array.isArray(template) || template.length === 0) fail(`${id}: styleTemplate is not a non-empty list`);
      checkParts(id, what, template as unknown[]);
    } else for (const e of byState as { template: unknown[] }[]) checkParts(id, what, e.template);
  }
  const unused = [...ids].filter((s) => !used.has(s));
  if (unused.length > 0) fail(`slot ${unused.join(', ')} is in no styleTemplate or styleByState`);
}

/** The style attribute a template gives at these values: each hole is the number as JavaScript writes it (String(n)), as the web gets it. */
export const filledStyle = (template: StyleTemplate, values: ReadonlyMap<string, number>): string =>
  template.map((p) => (typeof p === 'string' ? p : String(values.get(p.slot)))).join('');

type Json = unknown;

/** The paths of the numbers where a and b differ; null when they differ in anything else. */
function numberDiff(a: Json, b: Json, at: SlotPath = []): SlotPath[] | null {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b) ? [] : [at];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return null;
    const out: SlotPath[] = [];
    for (let i = 0; i < a.length; i++) {
      const d = numberDiff(a[i], b[i], [...at, i]);
      if (d === null) return null;
      out.push(...d);
    }
    return out;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    if (keys.join() !== Object.keys(b).join()) return null;
    const out: SlotPath[] = [];
    for (const k of keys) {
      const d = numberDiff(a[k], b[k], [...at, k]);
      if (d === null) return null;
      out.push(...d);
    }
    return out;
  }
  return a === b ? [] : null;
}

const leafAt = (v: Json, path: SlotPath): unknown => path.reduce<unknown>((x, p) => (x as Record<string | number, unknown>)[p], v);

/** The first rule that gives every sample's number exactly, or null. */
function fitRule(samples: readonly (readonly [number, number])[], piece: 0 | 1 | 2): SlotRule | null {
  const byS = new Map(samples.map(([s, y]) => [s, y]));
  const exact = (r: SlotRule): boolean => samples.every(([s, y]) => Object.is(slotValue(r, s), y));
  if (piece === 2) {
    const ys = new Set(samples.map(([, y]) => y));
    return ys.size === 1 ? ['line', samples[0]![1], 0] : null;
  }
  const [s0, s1] = piece === 1 ? [0, 1] : [-1, -2];
  const y0 = byS.get(s0);
  const y1 = byS.get(s1);
  if (y0 === undefined || y1 === undefined) throw new Error(`no sample at ${s0} and ${s1}`);
  const k = (y1 - y0) / (s1 - s0);
  const c = y0 - k * s0;
  for (const r of [['line', c, k], ['line32', c, k], ['channel', 0, 1]] as const) if (exact(r)) return r;
  return null;
}

/** One compile of the input with its slots filled at `values`: per target and assignment, each box's engine-input style by Dragon id and each export node's writes by the input's id. */
export type SlotSample = {
  readonly [T in NativeStyleTarget]?: readonly { readonly styles: ReadonlyMap<string, Readonly<Record<string, unknown>>>; readonly writes: ReadonlyMap<string, readonly Readonly<Record<string, unknown>>[]>; readonly frames: ReadonlyMap<string, { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null>; readonly other: string; readonly motion?: SlotMotion }[];
};
/**
 * With transitions or animations: each element's computed values, listings and keyframed longhands by the input's id; the animation
 * program's part for this assignment as JSON; and each colour closure write [node, longhand, source node, source longhand].
 */
export type SlotMotion = { readonly elements: ReadonlyMap<string, ElementMotion>; readonly anim: string; readonly closure: readonly (readonly [string, string, string, string])[] };

/** Planted faults of the SLOT-transitions check, for its tests only. */
export type SlotTransitionFaults = {
  readonly slotTransitionDelayIgnored?: boolean;
  readonly slotTransitionOwnElementOnly?: boolean;
  readonly slotTransitionAdmittedOnly?: boolean;
  readonly slotTransitionAnyBorder?: boolean;
  readonly slotAnimProgramInvarianceSkipped?: boolean;
};

/** An animation program's part for assignment i, as JSON: what the phone builds once, at the slots' initial values. */
export const animProgramAt = (p: AnimProgram, i: number): string => JSON.stringify({
  slots: p.slots.map((x) => [x.node, x.property, x.kind, x.range, x.values[i], x.listings[i]]),
  animations: p.animations.map((x) => [x.node, x.lists[i]]),
  keyframes: p.keyframes,
  rendered: p.rendered.map((x) => [x.node, x.values[i]]),
  bases: p.bases.map((x) => [x.node, x.property, x.values[i]]),
  closure: p.closure,
  origins: p.origins.map((x) => [x.node, x.values[i]]),
});

const CURRENTCOLOR = JSON.stringify({ kind: 'keyword', value: 'currentcolor' });

/**
 * SLOT-transitions: a pair (element, longhand) whose computed value differs between the base and a sample of the slot is refused when
 * Chrome would run a transition or animation on it as the app writes the slot: a listing (in the base or any sample, as Chrome reads
 * the after-change one) with a combined duration above 0 on a property that interpolates, keyframes that set it, or a colour closure
 * write the animator makes each frame. Then every sample's animation program must be the base's, as the phone builds it once.
 */
function refuseSlotMotion(where: string, slot: string, b: SlotMotion, all: readonly (readonly [number, { readonly motion?: SlotMotion }])[], assignments: readonly { readonly motion?: SlotMotion }[], faults: SlotTransitionFaults): void {
  const valueOf = (m: ElementMotion, p: string): string | undefined => {
    const v = m.values.get(p);
    return faults.slotTransitionAnyBorder === true && v === CURRENTCOLOR && p !== 'color' ? m.values.get('color') : v;
  };
  const moved = new Map<string, readonly [string, string]>();
  const motions = [b];
  for (const [s, a] of all) {
    const motion = a.motion ?? fail(`${where}: ${slot} at ${String(s)} has no transitions or animations where its base has`);
    motions.push(motion);
    for (const [node, m] of motion.elements) {
      const was = b.elements.get(node) ?? fail(`${where}: ${slot} at ${String(s)} changes which elements there are`);
      for (const p of m.values.keys()) if (valueOf(m, p) !== valueOf(was, p)) moved.set(JSON.stringify([node, p]), [node, p]);
    }
  }
  const transitionMessage = (p: string, node: string, l: { readonly duration: number; readonly delay: number }): string => `${where}: ${p} of ${node} follows ${slot} and has a transition (${l.duration}s, delay ${l.delay}s), which Chrome runs when the app writes a new value, and the phone writes the new value at once`;
  const keyframesMessage = (p: string, node: string, name: string): string => `${where}: ${p} of ${node} follows ${slot} and is set by the keyframes of animation ${name}, which Chrome interpolates from the value the app writes, and the phone does not`;
  const runs = (p: string, l: { readonly mode: string; readonly duration: number; readonly delay: number } | undefined): l is { readonly mode: string; readonly duration: number; readonly delay: number } => {
    if (l === undefined || l.mode !== 'listed') return false;
    if (!(faults.slotTransitionDelayIgnored === true ? l.duration > 0 : Math.max(l.duration, 0) + l.delay > 0)) return false;
    return faults.slotTransitionAdmittedOnly === true ? admittedAnimation(animationKind(p as never)) : animationKind(p as never).kind !== 'discrete';
  };
  for (const key of [...moved.keys()].sort()) {
    const [node, p] = moved.get(key)!;
    for (const m of motions) {
      const l = m.elements.get(node)?.listings.get(p as never);
      if (runs(p, l)) fail(transitionMessage(p, node, l));
    }
    for (const m of motions) {
      const k = m.elements.get(node)?.keyframed.find((x) => x.longhands.includes(p));
      if (k !== undefined) fail(keyframesMessage(p, node, k.name));
    }
    for (const m of motions) for (const [cn, cp, sn, sp] of m.closure) {
      if (cn !== node || cp !== p) continue;
      const source = assignments.flatMap((a) => (a.motion === undefined ? [] : [a.motion.elements.get(sn)]));
      const l = source.map((e) => e?.listings.get(sp as never)).find((x) => runs(sp, x));
      const k = source.flatMap((e) => e?.keyframed ?? []).find((x) => x.longhands.includes(sp));
      fail(l === undefined && k !== undefined ? keyframesMessage(p, node, k.name) : transitionMessage(p, node, l ?? { duration: 0, delay: 0 }));
    }
  }
  if (faults.slotAnimProgramInvarianceSkipped === true) return;
  for (const [s, a] of all) if (a.motion?.anim !== b.anim) fail(`${where}: ${slot} at ${String(s)} changes the page's animation program (a keyframe, a timing or a transform-origin that follows the slot), which the phone builds once at the slots' initial values`);
}

/** The engine-input boxes of a state program's assignment, by id, each with its style; `other` is the rest of the tree with no style. */
export function engineStyles(sp: StateProgram, i: number): { readonly styles: Map<string, Readonly<Record<string, unknown>>>; readonly other: string } {
  const delta = sp.deltas[i] as { readonly variant: number };
  const root = (sp.variants[delta.variant] as { readonly root: unknown }).root;
  const styles = new Map<string, Readonly<Record<string, unknown>>>();
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!isRecord(v)) return v;
    if (typeof v['id'] === 'string' && isRecord(v['style'])) {
      if (styles.has(v['id'])) throw new Error(`the engine input names ${v['id']} twice`);
      styles.set(v['id'], v['style']);
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'style' && typeof v['id'] === 'string' ? null : strip(x)]));
  };
  return { styles, other: JSON.stringify(strip(root)) };
}

/**
 * The bindings of every slot per target and assignment, from compiles of the input at the slots' initial values (`base`), at each
 * sample of one slot with the others at their initial values, and with every slot at once at each sample of a piece (`together`; a
 * slot whose piece is refused stays at its initial value), which must be what the slots' bindings give together. Refused by name: a
 * slot that moves anything other than a box's style fields and write numbers, a number that follows no rule, a field two slots move.
 */
export function slotBindings(slots: readonly MarklessSlot[], base: SlotSample, sample: (slot: number, s: number) => SlotSample | { readonly refused: string }, together: (values: readonly number[]) => SlotSample, faults: SlotTransitionFaults = {}): { readonly [T in NativeStyleTarget]?: readonly SlotBindings[] } {
  const out: { [T in NativeStyleTarget]?: SlotBindings[] } = {};
  const compiled = slots.map((slot, k) => (slot.integer === true ? SLOT_SAMPLES.integer : SLOT_SAMPLES.number).map((piece) => piece.map((s) => [s, sample(k, s)] as const)));
  const refused: SlotRefusal[] = [];
  const samples = compiled.map((pieces, k) => {
    refused.push([k, 2, `${slots[k]!.id} ${NOT_FINITE}`]);
    return [...pieces.map((piece, p) => {
      const bad = piece.find(([, x]) => 'refused' in x);
      if (bad === undefined) return piece as readonly (readonly [number, SlotSample])[];
      refused.push([k, p, `${slots[k]!.id} at ${String(bad[0])}: ${(bad[1] as { refused: string }).refused}`]);
      return null;
    }), null];
  });
  for (const [k, slot] of slots.entries()) if (samples[k]![slotPiece(slot.initial)] === null) fail(`${slot.id} does not compile at values like its initial one: ${refused.find(([j]) => j === k)?.[2] ?? ''}`);
  const combos = new Map<string, readonly number[]>();
  for (const p of [0, 1]) for (const j of SLOT_SAMPLES.number[p]!.keys()) {
    const values = slots.map((slot, k) => samples[k]![p]?.[j]?.[0] ?? slot.initial);
    combos.set(JSON.stringify(values), values);
  }
  const togethers = [...combos.values()].map((values) => [values, together(values)] as const);
  for (const t of Object.keys(base) as NativeStyleTarget[]) {
    const assignments = base[t] ?? [];
    out[t] = assignments.map((b, i): SlotBindings => {
      const fields: SlotField[] = [];
      const writes: SlotWrite[] = [];
      const owner = new Map<string, string>();
      const claim = (what: string, slot: number): void => {
        const was = owner.get(what);
        if (was !== undefined && was !== slots[slot]!.id) fail(`${t} assignment ${i}: ${what} follows both ${was} and ${slots[slot]!.id}, and a value follows one slot`);
        owner.set(what, slots[slot]!.id);
      };
      slots.forEach((slot, k) => {
        const at = (x: SlotSample, what: string): NonNullable<SlotSample[NativeStyleTarget]>[number] => {
          const a = x[t]?.[i];
          if (a === undefined || x[t]?.length !== assignments.length) return fail(`${t}: ${slot.id} at ${what} changes the assignments`);
          if (a.other !== b.other) fail(`${t} assignment ${i}: ${slot.id} at ${what} changes the box tree, which a slot does not`);
          if ([...a.styles.keys()].join() !== [...b.styles.keys()].join() || [...a.writes.keys()].join() !== [...b.writes.keys()].join()) fail(`${t} assignment ${i}: ${slot.id} at ${what} changes which nodes there are`);
          return a;
        };
        const pieces = samples[k]!.map((piece) => piece?.map(([s, x]) => [s, at(x, String(s))] as const) ?? null);
        const all = pieces.flatMap((p) => p ?? []);
        if (b.motion !== undefined) refuseSlotMotion(`${t} assignment ${i}`, slot.id, b.motion, all, assignments, faults);
        const moved = new Set<string>();
        for (const [, a] of all) for (const [id, style] of a.styles) {
          const was = b.styles.get(id) as Record<string, unknown>;
          if (Object.keys(style).join() !== Object.keys(was).join()) fail(`${t} assignment ${i}: ${slot.id} changes which style fields ${id} has`);
          for (const key of Object.keys(style)) if (JSON.stringify(style[key]) !== JSON.stringify(was[key])) moved.add(JSON.stringify([id, key]));
        }
        for (const m of [...moved].sort()) {
          const [id, key] = JSON.parse(m) as [string, string];
          claim(`the ${key} of box ${id}`, k);
          const fit = pieces.map((piece, p): SlotPiece | null => {
            if (piece === null) return null;
            const values = piece.map(([s, a]) => [s, (a.styles.get(id) as Record<string, unknown>)[key]] as const);
            const template = values[0]![1];
            const leaves = new Map<string, SlotPath>();
            for (const [s, v] of values) {
              const d = numberDiff(template, v);
              if (d === null) fail(`${t} assignment ${i}: the ${key} of box ${id} changes its shape between ${String(values[0]![0])} and ${String(s)} of ${slot.id}`);
              for (const path of d ?? []) leaves.set(JSON.stringify(path), path);
            }
            return [template, [...leaves.values()].map((path) => {
              const rule = fitRule(values.map(([s, v]) => [s, leafAt(v, path) as number]), p as 0 | 1 | 2);
              if (rule === null) fail(`${t} assignment ${i}: the ${key} of box ${id} is not a straight line of ${slot.id} ${['below zero', 'from zero up', 'when it is not finite'][p]} (at ${JSON.stringify(path)}), which a slot does not carry`);
              return [path, rule as SlotRule] as const;
            })];
          }) as unknown as SlotField[3];
          fields.push([k, id, key, fit]);
        }
        const movedWrites = new Map<string, readonly [string, number, SlotPath]>();
        for (const [s, a] of all) for (const [id, ws] of a.writes) {
          const was = b.writes.get(id) as readonly unknown[];
          const d = numberDiff(was, ws);
          if (d === null) fail(`${t} assignment ${i}: ${slot.id} at ${String(s)} changes the kinds of the writes of ${id}, which a slot does not`);
          for (const [w, ...path] of d ?? []) movedWrites.set(JSON.stringify([id, w, path]), [id, w as number, path]);
        }
        for (const key of [...movedWrites.keys()].sort()) {
          const [id, w, path] = movedWrites.get(key)!;
          const kind = String(b.writes.get(id)?.[w]?.['kind']);
          if ((b.writes.get(id) ?? []).filter((x) => x['kind'] === kind).length !== 1) fail(`${t} assignment ${i}: ${id} has more than one ${kind} write, so a phone could not tell which one ${slot.id} moves`);
          claim(`the ${kind} write ${JSON.stringify(path)} of ${id}`, k);
          const fit = pieces.map((piece, p) => {
            if (piece === null) return null;
            const rule = fitRule(piece.map(([s, a]) => [s, leafAt(a.writes.get(id)?.[w], path) as number]), p as 0 | 1 | 2);
            if (rule === null) fail(`${t} assignment ${i}: the ${kind} write of ${id} is not a straight line or an rgb() channel of ${slot.id} ${['below zero', 'from zero up', 'when it is not finite'][p]} (at ${JSON.stringify(path)}), which a slot does not carry`);
            return rule as SlotRule;
          }) as unknown as SlotWrite[4];
          writes.push([k, id, kind, path, fit]);
        }
      });
      const bindings = { fields, writes, refused };
      for (const [values, x] of togethers) {
        const want = applySlots(b, bindings, values);
        const got = x[t]?.[i];
        if (got === undefined || got.other !== b.other || JSON.stringify(want.styles) !== JSON.stringify(Object.fromEntries(got.styles)) || JSON.stringify(want.writes) !== JSON.stringify(Object.fromEntries(got.writes))) fail(`${t} assignment ${i}: the slots moved together at ${JSON.stringify(values)} do not give what each gives alone`);
      }
      const atInitial = applySlots(b, bindings, slots.map((s) => s.initial));
      if (JSON.stringify(atInitial.styles) !== JSON.stringify(Object.fromEntries(b.styles)) || JSON.stringify(atInitial.writes) !== JSON.stringify(Object.fromEntries(b.writes))) fail(`${t} assignment ${i}: the bindings at the slots' initial values are not the export`);
      return bindings;
    });
  }
  return out;
}

const withPath = (v: unknown, path: SlotPath, value: number): unknown => {
  if (path.length === 0) return value;
  const [p, ...rest] = path;
  if (Array.isArray(v)) return v.map((x, i) => (i === p ? withPath(x, rest, value) : x));
  return { ...(v as Record<string, unknown>), [p as string]: withPath((v as Record<string, unknown>)[p as string], rest, value) };
};

/** What the device gives at these slot values (runMarklessLayout's rule): each bound field and write number written into a compile at the initial values. */
export function applySlots(b: NonNullable<SlotSample[NativeStyleTarget]>[number], bindings: SlotBindings, values: readonly number[]): { readonly styles: Record<string, unknown>; readonly writes: Record<string, unknown> } {
  const styles: Record<string, Record<string, unknown>> = Object.fromEntries([...b.styles].map(([id, s]) => [id, { ...s }]));
  const writes: Record<string, unknown> = Object.fromEntries(b.writes);
  for (const [slot, id, key, pieces] of bindings.fields) {
    const s = values[slot] as number;
    const piece = pieces[slotPiece(s)];
    if (piece === null || piece === undefined) throw new Error(`slot ${slot} at ${String(s)} is in a refused piece`);
    const [template, leaves] = piece;
    styles[id]![key] = leaves.reduce((v, [path, rule]) => withPath(v, path, slotValue(rule, s)), template);
  }
  for (const [slot, id, w, path, pieces] of bindings.writes) {
    const s = values[slot] as number;
    const rule = pieces[slotPiece(s)];
    if (rule === null || rule === undefined) throw new Error(`slot ${slot} at ${String(s)} is in a refused piece`);
    const at = (writes[id] as readonly Record<string, unknown>[]).findIndex((x) => x['kind'] === w);
    writes[id] = withPath(writes[id], [at, ...path], slotValue(rule, s));
  }
  return { styles, writes };
}
