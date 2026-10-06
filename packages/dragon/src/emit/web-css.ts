// Stage 3 of docs/api.md §4.1 for web: CSS emitted from the resolved result (stage 1), never from a backend lowering.
// One rule per element with every milestone longhand written, so the output does not depend on the UA stylesheet. The inset
// longhands are the one exception: they are written when any of them is not auto. Auto is their initial value and no Chrome UA
// rule sets them on a supported tag (ua.test.ts), so leaving them out gives the same computed values.
import type { ResolvedElement, ResolvedValue } from '../analysis/resolve.ts';
import { rangePartOf } from '../analysis/resolve.ts';
import { serializeColor } from '../css/color.ts';
import { serializeString } from '../css/escapes.ts';
import { LONGHANDS } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import { familyListText } from '../css/values.ts';
import { parseFamilyList } from '../fonts/family-list.ts';
import { outputFamilyName, rewriteFamilyList } from '../fonts/font-map.ts';
import type { FontMap } from '../fonts/font-map.ts';
import type { GeneratedFile } from '../types.ts';

export type WebEmit = {
  readonly files: readonly GeneratedFile[];
  /** Per case key: element address to the class of its resolved variant; internal to the harness, never public. */
  readonly classOf: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

export const WEB_CSS_PATH = 'dragon.css';

/** The track and thumb of range input el (analysis/resolve.ts), with the pseudo-element that styles each. */
function rangeStyledParts(el: ResolvedElement): { readonly pseudo: string; readonly el: ResolvedElement }[] {
  const out: { pseudo: string; el: ResolvedElement }[] = [];
  let at: ResolvedElement = el;
  for (;;) {
    const next = at.children.find((c): c is ResolvedElement => c.kind === 'element' && rangePartOf(c) !== undefined);
    if (next === undefined) return out;
    const part = (rangePartOf(next) as { part: string | null }).part;
    if (part === 'track') out.push({ pseudo: '-webkit-slider-runnable-track', el: next });
    if (part === 'thumb') out.push({ pseudo: '-webkit-slider-thumb', el: next });
    at = next;
  }
}

/** CSS2 §9.3.2 box offsets, written only when one of them is not auto. */
export const INSET_LONGHANDS: readonly (typeof LONGHANDS)[number][] = ['top', 'right', 'bottom', 'left'];

function writesInsets(el: ResolvedElement): boolean {
  return INSET_LONGHANDS.some((p) => {
    const v = (el.props.get(p) as ResolvedValue).value;
    return !(v.kind === 'keyword' && v.value === 'auto');
  });
}

/** A CSS <number> without exponent notation, so every emitted value is valid CSS text. */
function cssNumber(n: number): string {
  const s = String(n === 0 ? 0 : n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m === null) return s;
  const sign = m[1] as string;
  const frac = m[3] === undefined ? '' : m[3];
  const digits = `${m[2] as string}${frac}`;
  const exp = Number(m[4]);
  return exp < 0 ? `${sign}0.${'0'.repeat(-exp - 1)}${digits}` : `${sign}${digits}${'0'.repeat(exp - frac.length)}`;
}

export function valueText(v: CssValue): string {
  switch (v.kind) {
    case 'keyword':
      return v.value;
    case 'family':
      return outputFamilyName(v.value);
    case 'length':
      return `${cssNumber(v.value)}${v.unit}`;
    case 'percentage':
      return `${cssNumber(v.value)}%`;
    case 'number':
      return cssNumber(v.value);
    case 'color':
      return serializeColor(v.value);
    case 'ratio':
      return `${v.auto ? 'auto ' : ''}${cssNumber(v.width)} / ${cssNumber(v.height)}`;
    case 'position':
      return `${cssNumber(v.x.value)}${v.x.unit} ${cssNumber(v.y.value)}${v.y.unit}`;
    case 'other':
      return v.text;
  }
}

/** The parts of an interaction state the web output reads (analysis/interaction.ts InteractionValue): who matches each pseudo-class. */
type StateMatch = { readonly hover: readonly string[]; readonly active: readonly string[]; readonly focus: string | null; readonly focusVisible: string | null };
type Candidates = { readonly hover: readonly string[]; readonly active: readonly string[]; readonly focus: readonly string[]; readonly focusVisible: readonly string[] };

/** A case's interaction states (SELD-R2): the candidates of its partition and each distinct state but none, resolved. */
export type WebInteraction = { readonly candidates: Candidates; readonly states: readonly { readonly members: readonly StateMatch[]; readonly root: ResolvedElement }[] };

type WebCase = { readonly key: string; readonly root: ResolvedElement; readonly interaction?: WebInteraction | undefined };

type Pseudo = 'hover' | 'active' | 'focus' | 'focus-visible';
/** A generated state condition: the candidates that match each pseudo-class (on) and those that do not (off). */
export type InteractionCondition = { readonly on: readonly (readonly [string, Pseudo])[]; readonly off: readonly (readonly [string, Pseudo])[] };

/**
 * The condition of one interaction state: every candidate's membership is fixed, so the conditions of two states of one partition
 * differ in some candidate and never hold together.
 */
export function interactionCondition(v: StateMatch, candidates: Candidates): InteractionCondition {
  const on: [string, Pseudo][] = [];
  const off: [string, Pseudo][] = [];
  for (const a of candidates.hover) (v.hover.includes(a) ? on : off).push([a, 'hover']);
  for (const a of candidates.active) (v.active.includes(a) ? on : off).push([a, 'active']);
  for (const a of candidates.focus) (v.focus === a ? on : off).push([a, 'focus']);
  for (const a of candidates.focusVisible) (v.focusVisible === a ? on : off).push([a, 'focus-visible']);
  return { on, off };
}

/** Whether two conditions can never hold together: one needs a candidate state the other excludes. */
export function conditionsExclusive(a: InteractionCondition, b: InteractionCondition): boolean {
  const has = (list: InteractionCondition['on'], [x, p]: readonly [string, Pseudo]): boolean => list.some(([y, q]) => x === y && p === q);
  return a.on.some((t) => has(b.off, t)) || b.on.some((t) => has(a.off, t));
}

/** R3: the media query that gates :hover conditions, as Tailwind's hover variant does, and its complement. */
export const HOVER_MEDIA = '(hover: hover)';
export const NO_HOVER_MEDIA = 'not all and (hover: hover)';

/**
 * R3: where a state condition is emitted. A condition with a :hover candidate on holds only under (hover: hover), so a tap never
 * leaves a hover style; one with :hover candidates only off holds in full under (hover: hover), and without its :hover terms
 * elsewhere, where hover never counts. gate false (the plant webHoverUngated) emits every condition in full, ungated.
 */
export function gatedConditions(c: InteractionCondition, gate: boolean): { readonly media: string | null; readonly condition: InteractionCondition }[] {
  const hover = ([, p]: readonly [string, Pseudo]): boolean => p === 'hover';
  if (!gate || (!c.on.some(hover) && !c.off.some(hover))) return [{ media: null, condition: c }];
  if (c.on.some(hover)) return [{ media: HOVER_MEDIA, condition: c }];
  return [{ media: HOVER_MEDIA, condition: c }, { media: NO_HOVER_MEDIA, condition: { on: c.on, off: c.off.filter((t) => !hover(t)) } }];
}

/** One band after the first (MQ-a): its condition text and every case resolved in it. */
export type WebBand = { readonly condition: string; readonly cases: readonly WebCase[] };

function byAddress(root: ResolvedElement): Map<string, ResolvedElement> {
  const out = new Map<string, ResolvedElement>();
  const visit = (el: ResolvedElement): void => {
    out.set(el.element.address, el);
    for (const ch of el.children) if (ch.kind === 'element') visit(ch);
  };
  visit(root);
  return out;
}

/**
 * The project's fonts, for a web output that uses any: font-family values are rewritten through the font map (a pinned generic
 * or family becomes its bundled family), and prelude gives the @font-face rules of the pinned families used and of every
 * declared face. rewrite false and an empty prelude are the planted faults pinnedGenericNotRewritten and fontFaceNotEmitted.
 */
export type WebFontContext = {
  readonly map: FontMap | null;
  readonly declared: ReadonlySet<string>;
  readonly rewrite: boolean;
  readonly prelude: (usedPinned: ReadonlySet<string>) => string;
};

/** T065 R15: an element's resolved transition and animation lines per case, and the used @keyframes (lower/anim-program.ts). */
export type WebAnimations = {
  readonly lines: (caseKey: string, address: string) => readonly string[];
  /** The addresses that declare an animation longhand in a case: a colour they animate reaches inheriting descendants (R9). */
  readonly sources: (caseKey: string) => ReadonlySet<string>;
  readonly keyframes: string;
};

/**
 * One class per resolved variant: an element address gets a new class for each distinct resolved style across the cases.
 * Deterministic: classes are numbered in case order, then element preorder; declarations follow LONGHANDS order. fonts: null
 * when the project declares and maps no font, which leaves the output as it was before fonts. cases are resolved in the first
 * @media band; each later band (MQ-a) gets one @media block with the declarations that differ from it, per class.
 */
export function emitWebCss(cases: readonly WebCase[], digest: string, fonts: WebFontContext | null = null, bands: readonly WebBand[] = [], animations: WebAnimations | null = null, baseCondition: string = 'all', gateHover = true): WebEmit {
  const usedPinned = new Set<string>();
  const familyText = (v: CssValue): string => {
    const text = familyListText(v);
    const list = text === null || fonts === null ? null : parseFamilyList(text);
    if (list === null || fonts === null) return valueText(v);
    const rewritten = rewriteFamilyList(list, fonts.map ?? { generics: {} }, fonts.declared);
    for (const r of rewritten.resolutions) if (r.kind === 'pinned') usedPinned.add(r.family);
    return fonts.rewrite ? rewritten.value : valueText(v);
  };
  const declLine = (el: ResolvedElement, p: (typeof LONGHANDS)[number], underSource = false): string => {
    const r = el.props.get(p) as ResolvedValue;
    // T065 R9: under an element that may animate its colour, an inherited colour stays inherited, so it follows each frame (the
    // static value is the same: the parent's resolved colour).
    if (p === 'color' && underSource && r.origin === 'inherited') return '  color: inherit;';
    const v = r.value;
    // A folded order calculation that is not a whole number stays a calculation, which Chrome rounds as the engine does.
    if (p === 'order' && v.kind === 'number' && !Number.isInteger(v.value)) return `  ${p}: calc(${valueText(v)});`;
    return `  ${p}: ${p === 'font-family' ? familyText(v) : valueText(v)};`;
  };
  const classOf = new Map<string, Map<string, string>>();
  const variants = new Map<string, string>();
  const rules: string[] = [];
  const bandRules: string[][] = bands.map(() => []);
  // SELD-R2: per class, per band (the first, then each later one), its interaction states: the condition of every combination a
  // state stands for (R5), and the declarations that differ from the band's none state.
  const pending: { cls: string; pseudo: string | null; root: boolean; states: { band: number; conditions: InteractionCondition[]; lines: string[] }[] }[] = [];
  const classesOf = new Map<string, string[]>();
  for (const c of cases) {
    const map = new Map<string, string>();
    classOf.set(c.key, map);
    const inBands = bands.map((b) => {
      const other = b.cases.find((x) => x.key === c.key);
      if (other === undefined) throw new Error(`case ${c.key} is not resolved in the band ${b.condition}`);
      return byAddress(other.root);
    });
    const sources = animations === null ? new Set<string>() : animations.sources(c.key);
    // Every longhand whose value in a band differs from the first band's (an inset left out there is auto, its value).
    const bandDiffs = (el: ResolvedElement, under: boolean): string[][] =>
      inBands.map((m) => {
        const other = m.get(el.element.address);
        if (other === undefined) throw new Error(`${el.element.address} is not resolved in every band`);
        return LONGHANDS.map((p) => declLine(other, p, under)).filter((line, k) => line !== declLine(el, LONGHANDS[k] as (typeof LONGHANDS)[number], under));
      });
    // Each band's interaction states as address maps, against that band's own resolution of the case.
    const bandCase = [c, ...bands.map((b) => b.cases.find((x) => x.key === c.key) as WebCase)];
    const states = bandCase.map((bc) => (bc.interaction?.states ?? []).map((st) => ({ conditions: st.members.map((m) => interactionCondition(m, (bc.interaction as WebInteraction).candidates)), at: byAddress(st.root) })));
    const bandBase = bandCase.map((bc) => byAddress(bc.root));
    // Every interaction state, per band, whose declarations for el differ from that band's none state.
    const stateDiffs = (el: ResolvedElement, under: boolean): { band: number; conditions: InteractionCondition[]; lines: string[] }[] =>
      states.flatMap((list, band) => list.flatMap((st) => {
        const here = st.at.get(el.element.address);
        const base = (bandBase[band] as Map<string, ResolvedElement>).get(el.element.address);
        if (here === undefined || base === undefined) throw new Error(`${el.element.address} is not resolved in every interaction state`);
        // T065 R9 holds in every state: under an animated colour, an inherited colour stays `inherit`.
        const lines = LONGHANDS.map((p) => declLine(here, p, under)).filter((line, k) => line !== declLine(base, LONGHANDS[k] as (typeof LONGHANDS)[number], under));
        return lines.length === 0 ? [] : [{ band, conditions: st.conditions, lines }];
      }));
    const visit = (el: ResolvedElement, under: boolean): void => {
      const insets = writesInsets(el);
      const decls = LONGHANDS.filter((p) => insets || !INSET_LONGHANDS.includes(p)).map((p) => declLine(el, p, under));
      // T065 R15: an element's transition and animation lists, resolved per element and state.
      if (animations !== null) decls.push(...animations.lines(c.key, el.element.address));
      const diffs = bandDiffs(el, under);
      const own = stateDiffs(el, under);
      const below = under || sources.has(el.element.address);
      // FORM-a A4: a range's track and thumb are styled through their pseudo-elements on the input's class (in every band and
      // interaction state); its container takes only UA and inherited values, which the input's own rules reproduce.
      const parts = rangePartOf(el)?.part === null
        ? rangeStyledParts(el).map((p) => ({ pseudo: p.pseudo, decls: LONGHANDS.filter((q) => writesInsets(p.el) || !INSET_LONGHANDS.includes(q)).map((q) => declLine(p.el, q, below)), diffs: bandDiffs(p.el, below), states: stateDiffs(p.el, below) }))
        : [];
      const variant = `${el.element.address}\u0000${decls.join('\n')}${diffs.some((d) => d.length > 0) ? `\u0000${JSON.stringify(diffs)}` : ''}${own.length > 0 ? `\u0001${JSON.stringify(own)}` : ''}${parts.map((p) => `\u0000${p.pseudo}\u0000${p.decls.join('\n')}\u0000${JSON.stringify(p.diffs)}${p.states.length > 0 ? `\u0001${JSON.stringify(p.states)}` : ''}`).join('')}`;
      let cls = variants.get(variant);
      if (cls === undefined) {
        cls = `dg${variants.size}`;
        variants.set(variant, cls);
        rules.push(`.${cls} {\n${decls.join('\n')}\n}`);
        diffs.forEach((d, k) => {
          if (d.length > 0) (bandRules[k] as string[]).push(`.${cls} {\n${d.join('\n')}\n}`);
        });
        for (const p of parts) {
          rules.push(`.${cls}::${p.pseudo} {\n${p.decls.join('\n')}\n}`);
          p.diffs.forEach((d, k) => {
            if (d.length > 0) (bandRules[k] as string[]).push(`.${cls}::${p.pseudo} {\n${d.join('\n')}\n}`);
          });
          if (p.states.length > 0) pending.push({ cls, pseudo: p.pseudo, root: el === c.root, states: p.states });
        }
        if (own.length > 0) pending.push({ cls, pseudo: null, root: el === c.root, states: own });
        const list = classesOf.get(el.element.address) ?? [];
        list.push(cls);
        classesOf.set(el.element.address, list);
      }
      map.set(el.element.address, cls);
      for (const ch of el.children) if (ch.kind === 'element' && (rangePartOf(ch)?.part ?? null) === null) visit(ch, below);
    };
    visit(c.root, false);
  }
  const blocks = bands.flatMap((b, k) => ((bandRules[k] as string[]).length === 0 ? [] : [`@media ${b.condition} {\n${(bandRules[k] as string[]).join('\n')}\n}`]));
  // The generated state rules: a condition on :root built from dg classes and the pseudo-classes, then the subject's class. Every
  // class of a candidate is named, so the condition holds for that element alone in every case; no author selector is copied.
  const test = (address: string, pseudo: Pseudo, isRoot: (a: string) => boolean): string => {
    if (isRoot(address)) return `:${pseudo}`;
    const own = classesOf.get(address) ?? [];
    if (own.length === 0) throw new Error(`the interaction candidate ${address} has no class`);
    return `:has(${own.length === 1 ? `.${own[0] as string}` : `:is(${own.map((k) => `.${k}`).join(', ')})`}:${pseudo})`;
  };
  const rootAddress = cases[0] === undefined ? null : cases[0].root.element.address;
  const isRoot = (a: string): boolean => a === rootAddress;
  // Per band, the state rules by their R3 media gate (null: ungated), each gate's rules in emission order.
  const stateRules: Map<string | null, string[]>[] = [new Map(), ...bands.map(() => new Map<string | null, string[]>())];
  for (const p of pending) {
    for (const st of p.states) {
      const selectors = new Map<string | null, string[]>();
      for (const g of st.conditions.flatMap((c) => gatedConditions(c, gateHover))) {
        const cond = `:root${g.condition.on.map(([a, ps]) => test(a, ps, isRoot)).join('')}${g.condition.off.map(([a, ps]) => `:not(${test(a, ps, isRoot)})`).join('')}`;
        const list = selectors.get(g.media) ?? [];
        const subject = `.${p.cls}${p.pseudo === null ? '' : `::${p.pseudo}`}`;
        list.push(p.root ? `${cond}${subject}` : `${cond} ${subject}`);
        selectors.set(g.media, list);
      }
      const byGate = stateRules[st.band] as Map<string | null, string[]>;
      for (const [media, list] of selectors) byGate.set(media, [...(byGate.get(media) ?? []), `${list.join(',\n')} {\n${st.lines.join('\n')}\n}`]);
    }
  }
  const conditions = [baseCondition, ...bands.map((b) => b.condition)];
  const gated = (byGate: Map<string | null, string[]>): string[] =>
    [null, HOVER_MEDIA, NO_HOVER_MEDIA].flatMap((m) => {
      const r = byGate.get(m) ?? [];
      return r.length === 0 ? [] : m === null ? r : [`@media ${m} {\n${r.join('\n')}\n}`];
    });
  const stateBlocks = stateRules.flatMap((byGate, k) => {
    const r = gated(byGate);
    return r.length === 0 ? [] : bands.length === 0 ? r : [`@media ${conditions[k] as string} {\n${r.join('\n')}\n}`];
  });
  const prelude = fonts === null ? '' : fonts.prelude(usedPinned);
  const keyframes = animations === null || animations.keyframes === '' ? [] : [animations.keyframes];
  const text = `/* Generated by Dragon from compilation ${digest}. Do not edit. */\n${prelude === '' ? '' : `${prelude}\n`}${[...rules, ...blocks, ...stateBlocks, ...keyframes].join('\n')}\n`;
  return { files: [{ path: WEB_CSS_PATH, text }], classOf };
}
