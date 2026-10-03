// T065 ANIM-b1: the animation tables of one program, plain data the runtime reads (spec §3: the device never parses CSS). One
// transition slot per (element, property) a reachable state pair can transition (R8), with its endpoint and listing in every
// assignment; each element's animation list per assignment (R11); each used @keyframes once, resolved (ANIM-v makes one
// resolution per name); and the closure of writes an animated colour reaches each frame (R9: inheriting descendants and
// currentcolor users). Records are per animation and slot, never per assignment pair (R20).
import type { AnimationAnalysis, AnimationEntry, AnimValue, Listing } from '../analysis/animations.ts';
import { animValueOf, fontPx, keyframeValueOf, MAX_CLOSURE_WRITES, MAX_TRANSITION_SLOTS } from '../analysis/animations.ts';
import type { ResolvedValue } from '../analysis/computed.ts';
import type { ResolvedElement } from '../analysis/resolve.ts';
import type { LengthRange } from '../css/animation-kinds.ts';
import { admitted, animationKind } from '../css/animation-kinds.ts';
import type { AnimItem, AnimLonghand, EasingValue } from '../css/properties/animation.ts';
import { ANIM_LONGHANDS } from '../css/properties/animation.ts';
import type { CssValue } from '../css/stylesheet.ts';
import type { WebAnimations } from '../emit/web-css.ts';
import type { Longhand } from '../css/properties.ts';

export const ANIM_PROGRAM_VERSION = 'dragon.anim-program/1';

export class AnimProgramError extends Error {}

/** A slot's listing in one assignment; mode 'unlisted' or 'initial' carries a zero timing. */
export type SlotListing = { readonly mode: Listing['mode']; readonly delay: number; readonly duration: number; readonly easing: EasingValue };

export type TransitionSlot = {
  readonly node: string;
  readonly property: Longhand;
  readonly kind: 'length' | 'color';
  readonly range: LengthRange;
  /** Per assignment, in the program's assignment order: the base value (null where the node is absent) and the listing. */
  readonly values: readonly (AnimValue | null)[];
  readonly listings: readonly (SlotListing | null)[];
};

export type KeyframeTable = {
  readonly name: string;
  readonly blocks: readonly { readonly offsets: readonly number[]; readonly easing: EasingValue | null; readonly values: readonly { readonly property: Longhand; readonly value: AnimValue }[] }[];
};

export type ClosureWrite = { readonly node: string; readonly property: Longhand };

export type AnimProgram = {
  readonly version: string;
  readonly assignments: readonly string[];
  readonly slots: readonly TransitionSlot[];
  /** Per node with an animation in some assignment: its animation list per assignment (null where the node is absent). */
  readonly animations: readonly { readonly node: string; readonly lists: readonly (readonly AnimationEntry[] | null)[] }[];
  readonly keyframes: readonly KeyframeTable[];
  /** Per animated colour (node and property), the other writes its value reaches in any assignment. */
  readonly closure: readonly { readonly source: ClosureWrite; readonly writes: readonly ClosureWrite[] }[];
};

const BORDER_COLORS: readonly Longhand[] = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];

function index(root: ResolvedElement): Map<string, { el: ResolvedElement; parent: ResolvedElement | null }> {
  const out = new Map<string, { el: ResolvedElement; parent: ResolvedElement | null }>();
  const walk = (el: ResolvedElement, parent: ResolvedElement | null): void => {
    out.set(el.element.address, { el, parent });
    for (const c of el.children) if (c.kind === 'element') walk(c, el);
  };
  walk(root, null);
  return out;
}

const same = (a: AnimValue | null, b: AnimValue | null): boolean => JSON.stringify(a) === JSON.stringify(b);
const keywordIs = (v: ResolvedValue, k: string): boolean => v.value.kind === 'keyword' && v.value.value === k;

/** Lowers the analysis of one program's cases (their resolved trees, in the program's assignment order). */
export function lowerAnimProgram(analysis: AnimationAnalysis, cases: readonly { readonly key: string; readonly resolved: ResolvedElement }[]): AnimProgram {
  const byKey = new Map(analysis.cases.map((c) => [c.key, c]));
  const trees = cases.map((c) => index(c.resolved));
  const anims = cases.map((c) => {
    const a = byKey.get(c.key);
    if (a === undefined) throw new AnimProgramError(`case ${c.key} has no animation analysis`);
    return a;
  });
  const nodes = [...new Set(trees.flatMap((t) => [...t.keys()]))];

  const slots: TransitionSlot[] = [];
  for (const node of nodes) {
    const listed = new Set(anims.flatMap((a) => [...(a.elements.get(node)?.listings.keys() ?? [])]));
    for (const property of listed) {
      const kind = animationKind(property);
      if (!admitted(kind) || (kind.kind !== 'length' && kind.kind !== 'color')) continue;
      const values = trees.map((t) => {
        const at = t.get(node);
        return at === undefined ? null : animValueOf((at.el.props.get(property) as ResolvedValue).value);
      });
      const present = values.filter((v) => v !== null);
      if (present.every((v) => same(v, present[0] ?? null))) continue;
      const listings = anims.map((a) => {
        const ea = a.elements.get(node);
        if (ea === undefined) return null;
        const l = ea.listings.get(property);
        return l === undefined ? { mode: ea.otherwise, delay: 0, duration: 0, easing: { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 0, steps: 0, position: 'end', text: 'linear' } as EasingValue } : l;
      });
      slots.push({ node, property, kind: kind.kind, range: kind.kind === 'length' ? kind.range : 'all', values, listings });
    }
  }
  if (slots.length > MAX_TRANSITION_SLOTS) throw new AnimProgramError(`${slots.length} transition slots exceed the ${MAX_TRANSITION_SLOTS} a program holds`);

  const animations = nodes.flatMap((node) => {
    const lists = anims.map((a) => a.elements.get(node)?.animations.filter((e) => e.hasKeyframes) ?? null);
    return lists.some((l) => l !== null && l.length > 0) ? [{ node, lists }] : [];
  });

  // Each used @keyframes once, resolved on the first element that uses it (ANIM-v refuses a second resolution).
  const used = new Map<string, { el: ResolvedElement; root: ResolvedElement }>();
  anims.forEach((a, i) => {
    for (const ea of a.elements.values()) for (const e of ea.animations) {
      const at = (trees[i] as Map<string, { el: ResolvedElement }>).get(ea.address);
      if (e.hasKeyframes && at !== undefined && !used.has(e.name)) used.set(e.name, { el: at.el, root: (cases[i] as { resolved: ResolvedElement }).resolved });
    }
  });
  const keyframes: KeyframeTable[] = [...used].map(([name, { el, root }]) => {
    const rule = analysis.keyframes.get(name);
    if (rule === undefined) throw new AnimProgramError(`@keyframes ${name} is used and not defined`);
    const fontSize = fontPx((el.props.get('font-size') as ResolvedValue).value);
    const rootSize = fontPx((root.props.get('font-size') as ResolvedValue).value);
    return {
      name,
      blocks: rule.blocks.map((b) => ({
        offsets: b.offsets,
        easing: b.easing,
        values: b.values.filter((v) => admitted(animationKind(v.property))).map((v) => ({ property: v.property, value: keyframeValueOf(v.value, fontSize, rootSize) })),
      })),
    };
  });

  // R9: an animated colour reaches inheriting descendants' colour, and currentcolor border colours on the element and them.
  const animatedColors = new Map<string, ClosureWrite>();
  for (const s of slots) if (s.property === 'color') animatedColors.set(`${s.node}|color`, { node: s.node, property: 'color' });
  for (const a of animations) for (const list of a.lists) for (const e of list ?? []) {
    const table = keyframes.find((k) => k.name === e.name);
    if (table?.blocks.some((b) => b.values.some((v) => v.property === 'color')) === true) animatedColors.set(`${a.node}|color`, { node: a.node, property: 'color' });
  }
  let total = 0;
  const closure = [...animatedColors.values()].map((source) => {
    const writes = new Map<string, ClosureWrite>();
    for (const t of trees) {
      const at = t.get(source.node);
      if (at === undefined) continue;
      const walk = (el: ResolvedElement, self: boolean): void => {
        if (!self && (el.props.get('color') as ResolvedValue).origin !== 'inherited') return;
        if (!self) writes.set(`${el.element.address}|color`, { node: el.element.address, property: 'color' });
        for (const p of BORDER_COLORS) if (keywordIs(el.props.get(p) as ResolvedValue, 'currentcolor')) writes.set(`${el.element.address}|${p}`, { node: el.element.address, property: p });
        for (const c of el.children) if (c.kind === 'element') walk(c, false);
      };
      walk(at.el, true);
    }
    total += writes.size;
    return { source, writes: [...writes.values()] };
  });
  if (total > MAX_CLOSURE_WRITES) throw new AnimProgramError(`${total} closure writes per frame exceed the ${MAX_CLOSURE_WRITES} a program holds`);
  return { version: ANIM_PROGRAM_VERSION, assignments: cases.map((c) => c.key), slots, animations, keyframes, closure };
}

// ---------------------------------------------------------------------------------------------------------------------
// Web output (R15): the animation longhands as resolved lists per element and state, and each used @keyframes once under its
// authored name, so the compiled rendering computes the same longhands and runs the same animations as the authored one.


const IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;
const nameText = (n: string): string => (IDENT.test(n) && !['none', 'initial', 'inherit', 'unset', 'default'].includes(n.toLowerCase()) ? n : JSON.stringify(n));

function itemText(p: AnimLonghand, i: AnimItem): string {
  if (i.kind === 'time') return `${i.seconds}s`;
  if (i.kind === 'easing') return i.easing.text;
  if (i.kind === 'name') return p === 'animation-name' ? nameText(i.value) : i.value;
  if (i.kind === 'number') return String(i.value);
  if (i.kind === 'keyword') return i.value;
  return i.text;
}

/** The web form of the analysis; valueText writes a keyframe value as web-css.ts writes every resolved longhand. */
export function webAnimationsOf(analysis: AnimationAnalysis, valueText: (v: CssValue) => string): WebAnimations {
  const byKey = new Map(analysis.cases.map((c) => [c.key, c]));
  const used = new Set<string>();
  for (const c of analysis.cases) for (const ea of c.elements.values()) for (const e of ea.animations) if (e.hasKeyframes) used.add(e.name);
  const rules = [...analysis.keyframes.values()].filter((r) => used.has(r.name)).map((r) => {
    const blocks = r.blocks.map((b) => {
      const decls = [...b.values.map((v) => `${v.property}: ${valueText(v.value)};`), ...(b.easing === null ? [] : [`animation-timing-function: ${b.easing.text};`])];
      return `  ${b.labels.join(', ')} { ${decls.join(' ')} }`;
    });
    return `@keyframes ${nameText(r.name)} {\n${blocks.join('\n')}\n}`;
  });
  return {
    lines: (caseKey, address) => {
      const ea = byKey.get(caseKey)?.elements.get(address);
      if (ea === undefined || ea.declarations.length === 0) return [];
      return ANIM_LONGHANDS.map((p) => `  ${p}: ${(ea.lists.get(p) ?? []).map((i) => itemText(p, i)).join(', ')};`);
    },
    keyframes: rules.join('\n'),
  };
}
