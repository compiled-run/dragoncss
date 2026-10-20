// Stage 3 of docs/api.md §4.1 for web: CSS emitted from the resolved result (stage 1), never from a backend lowering.
// One rule per element with every milestone longhand written, so the output does not depend on the UA stylesheet. The inset
// longhands are the one exception: they are written when any of them is not auto. Auto is their initial value and no Chrome UA
// rule sets them on a supported tag (ua.test.ts), so leaving them out gives the same computed values. The outline longhands are the
// other: they are written only when an author declaration sets one (in any band or interaction state of the element), since
// Chrome's UA :focus-visible rule (outline: auto 1px -webkit-focus-ring-color) draws the focus ring an explicit none would hide.
// The line-clamp longhands are written only where one is not initial, and a line-clamp container writes display: -webkit-box (TXT2-g).
// clip is written only where it is not auto, and clip-path only where it is not none: their initial values, which no Chrome UA rule sets.
// So are the mask longhands, written only where one is not initial (of those MASK-CLIP accepts, only -webkit-mask-composite: source-over),
// and so are the border image longhands (MISC-PAINT likewise), and appearance, written only where it is not none (no Chrome UA rule
// sets it on a supported tag), and caret-color and accent-color, written on every element of a case where any element's is not auto
// (FORM-b). -webkit-user-modify is never written: Dragon accepts only its initial read-only, which no Chrome UA rule on a supported tag
// changes (TOUCH).
// A colour from the UA origin (a hyperlink's, TDEC-a analysis/text-decoration.ts applyAnyLink) is written `color: revert`, and every
// colour inherited below it `color: inherit`: an author rule writing the captured -webkit-link colour would beat Chrome's UA
// a:-webkit-any-link:active rule (color: -webkit-activelink) and its visited colour. revert gives the UA origin's value, which is
// the resolved one.
import type { ResolvedElement, ResolvedValue } from '../analysis/resolve.ts';
import { markerOf } from '../analysis/resolve.ts';
import { serializeColor } from '../css/color.ts';
import { serializeString } from '../css/escapes.ts';
import { LONGHANDS } from '../css/properties.ts';
import { OUTLINE_LONGHANDS } from '../css/properties/outline.ts';
import { LINE_CLAMP_LONGHANDS } from '../css/properties/line-clamp.ts';
import { isInitialMask, MASK_LONGHANDS, maskDeclarationName } from '../css/properties/mask.ts';
import { BORDER_IMAGE_LONGHANDS, isInitialBorderImage } from '../css/properties/border-image.ts';
import { webDisplayOf, writesLineClamp } from '../analysis/line-clamp.ts';
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

/** CSS2 §9.3.2 box offsets, written only when one of them is not auto. */
export const INSET_LONGHANDS: readonly (typeof LONGHANDS)[number][] = ['top', 'right', 'bottom', 'left'];

function writesInsets(el: ResolvedElement): boolean {
  return INSET_LONGHANDS.some((p) => {
    const v = (el.props.get(p) as ResolvedValue).value;
    return !(v.kind === 'keyword' && v.value === 'auto');
  });
}

/** Whether an element's clip is not auto, its initial value. */
function writesClip(el: ResolvedElement): boolean {
  const v = (el.props.get('clip') as ResolvedValue).value;
  return !(v.kind === 'keyword' && v.value === 'auto');
}

/** Whether an element's clip-path is not none, its initial value. */
function writesClipPath(el: ResolvedElement): boolean {
  const v = (el.props.get('clip-path') as ResolvedValue).value;
  return !(v.kind === 'keyword' && v.value === 'none');
}

/** Whether an element's caret-color or accent-color is not auto, their initial value. */
function writesUiColors(el: ResolvedElement): boolean {
  return (['caret-color', 'accent-color'] as const).some((p) => {
    const v = (el.props.get(p) as ResolvedValue).value;
    return !(v.kind === 'keyword' && v.value === 'auto');
  });
}

/** Whether an element's appearance is not none, its initial value. */
function writesAppearance(el: ResolvedElement): boolean {
  const v = (el.props.get('appearance') as ResolvedValue).value;
  return !(v.kind === 'keyword' && v.value === 'none');
}

/**
 * Whether an author declaration sets an outline longhand of the element. revert and revert-layer roll back to the UA origin, whose
 * :focus-visible rule the output must keep, so they do not count.
 */
export function authorsOutline(el: ResolvedElement): boolean {
  return OUTLINE_LONGHANDS.some((p) => {
    const r = el.props.get(p as never) as ResolvedValue | undefined;
    if (r === undefined) throw new Error(`${el.element.address}: ${p} is not resolved`);
    return r.declaration !== null && !(r.declared?.kind === 'keyword' && (r.declared.value === 'revert' || r.declared.value === 'revert-layer'));
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

/**
 * A background-image value with each mapped url() src written as its data: URL (images/compile.ts webUrls). The resolved text holds
 * every url() as background.ts urlText serializes it, so the token is matched whole.
 */
export function backgroundImageText(v: CssValue, imageUrls: ReadonlyMap<string, string>): string {
  let text = valueText(v);
  for (const [src, data] of imageUrls) text = text.split(`url(${serializeString(src)})`).join(`url(${serializeString(data)})`);
  return text;
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

/**
 * GEN-a: a ::before or ::after box of the resolved tree (analysis/generated.ts), read from the resolved element's tag alone, so the
 * emitter still reads only the resolved result.
 */
const isGeneratedElement = (el: ResolvedElement): boolean => el.element.tag === '::before' || el.element.tag === '::after';

/** One emitted part of a class: the element (suffix '') or one of its generated boxes ('::before', '::after'). */
type Part = {
  readonly suffix: string;
  readonly decls: readonly string[];
  readonly diffs: readonly (readonly string[])[];
  readonly own: readonly { readonly band: number; readonly conditions: InteractionCondition[]; readonly lines: string[] }[];
};

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
export function emitWebCss(cases: readonly WebCase[], digest: string, fonts: WebFontContext | null = null, bands: readonly WebBand[] = [], animations: WebAnimations | null = null, baseCondition: string = 'all', gateHover = true, webkitBoxEmittedAsFlowRoot = false, imageUrls: ReadonlyMap<string, string> = new Map()): WebEmit {
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
    if (p === 'color' && r.origin === 'user-agent') return '  color: revert;';
    // TXT2-g: a line-clamp container writes its authored -webkit-box (analysis/line-clamp.ts).
    const legacy = p === 'display' ? webDisplayOf(el, { webkitBoxEmittedAsFlowRoot }) : null;
    if (legacy !== null) return `  display: ${legacy};`;
    const v = r.value;
    // A folded order calculation that is not a whole number stays a calculation, which Chrome rounds as the engine does.
    if (p === 'order' && v.kind === 'number' && !Number.isInteger(v.value)) return `  ${p}: calc(${valueText(v)});`;
    // MASK-CLIP: mask-composite's source-over is written under -webkit-mask-composite, the one name that parses it.
    if (p === 'mask-composite') return `  ${maskDeclarationName(p, v)}: ${valueText(v)};`;
    if (p === 'background-image') return `  ${p}: ${backgroundImageText(v, imageUrls)};`;
    return `  ${p}: ${p === 'font-family' ? familyText(v) : valueText(v)};`;
  };
  const classOf = new Map<string, Map<string, string>>();
  const variants = new Map<string, string>();
  const rules: string[] = [];
  const bandRules: string[][] = bands.map(() => []);
  // SELD-R2: per class, per band (the first, then each later one), its interaction states: the condition of every combination a
  // state stands for (R5), and the declarations that differ from the band's none state.
  const pending: { subject: string; root: boolean; states: Part['own'] }[] = [];
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
    // Each band's interaction states as address maps, against that band's own resolution of the case.
    const bandCase = [c, ...bands.map((b) => b.cases.find((x) => x.key === c.key) as WebCase)];
    const states = bandCase.map((bc) => (bc.interaction?.states ?? []).map((st) => ({ conditions: st.members.map((m) => interactionCondition(m, (bc.interaction as WebInteraction).candidates)), at: byAddress(st.root) })));
    const bandBase = bandCase.map((bc) => byAddress(bc.root));
    // FORM-b: caret-color and accent-color are inherited, so they are written on every element of the case or none: an auto left out
    // under a written colour would inherit it.
    const uiColors = [...bandBase, ...states.flat().map((st) => st.at)].some((m) => [...m.values()].some(writesUiColors));
    // One part: an element, or one of its ::before and ::after boxes (GEN-a R7), whose rule is the element's class with the
    // pseudo-element appended. Its lines, its diffs in each later band, and its interaction states against each band's none state.
    const partOf = (el: ResolvedElement, suffix: string, under: boolean, withAnimations: boolean): Part => {
      const insets = writesInsets(el);
      // The outline longhands are written for every resolution of the element or none (an unwritten one is Chrome's UA value).
      const at = (m: ReadonlyMap<string, ResolvedElement>): ResolvedElement[] => {
        const x = m.get(el.element.address);
        return x === undefined ? [] : [x];
      };
      const resolutions = [el, ...inBands.flatMap(at), ...states.flatMap((list) => list.flatMap((st) => at(st.at)))];
      const outline = resolutions.some(authorsOutline);
      // TXT2-g: the line-clamp longhands are written for every resolution of the element or none (both are inert at their initial values).
      const clamp = resolutions.some(writesLineClamp);
      // MASK-CLIP: clip is written for every resolution of the element or none.
      const clip = resolutions.some(writesClip);
      const clipPath = resolutions.some(writesClipPath);
      const mask = resolutions.some((r) => MASK_LONGHANDS.some((p) => !isInitialMask(p, (r.props.get(p) as ResolvedValue).value)));
      const borderImage = resolutions.some((r) => BORDER_IMAGE_LONGHANDS.some((p) => !isInitialBorderImage(p, (r.props.get(p) as ResolvedValue).value)));
      const appearance = resolutions.some(writesAppearance);
      const decls = LONGHANDS.filter((p) => (insets || !INSET_LONGHANDS.includes(p)) && (outline || !(OUTLINE_LONGHANDS as readonly string[]).includes(p)) && (clamp || !(LINE_CLAMP_LONGHANDS as readonly string[]).includes(p)) && (clip || p !== 'clip') && (clipPath || p !== 'clip-path') && (mask || !(MASK_LONGHANDS as readonly string[]).includes(p)) && (borderImage || !(BORDER_IMAGE_LONGHANDS as readonly string[]).includes(p)) && (appearance || p !== 'appearance') && (uiColors || (p !== 'caret-color' && p !== 'accent-color')) && p !== '-webkit-user-modify').map((p) => declLine(el, p, under));
      // T065 R15: an element's transition and animation lists, resolved per element and state.
      if (animations !== null && withAnimations) decls.push(...animations.lines(c.key, el.element.address));
      // Every longhand whose value in the band differs from the first band's (an inset left out there is auto, its value).
      const diffs = inBands.map((m) => {
        const other = m.get(el.element.address);
        if (other === undefined) throw new Error(`${el.element.address} is not resolved in every band`);
        return LONGHANDS.map((p) => declLine(other, p, under)).filter((line, k) => line !== declLine(el, LONGHANDS[k] as (typeof LONGHANDS)[number], under));
      });
      const own = states.flatMap((list, band) => list.flatMap((st) => {
        const here = st.at.get(el.element.address);
        const base = (bandBase[band] as Map<string, ResolvedElement>).get(el.element.address);
        if (here === undefined || base === undefined) throw new Error(`${el.element.address} is not resolved in every interaction state`);
        // T065 R9 holds in every state: under an animated colour, an inherited colour stays `inherit`.
        const lines = LONGHANDS.map((p) => declLine(here, p, under)).filter((line, k) => line !== declLine(base, LONGHANDS[k] as (typeof LONGHANDS)[number], under));
        return lines.length === 0 ? [] : [{ band, conditions: st.conditions, lines }];
      }));
      return { suffix, decls, diffs, own };
    };
    // css-lists-3 §3.1: a list item's ::marker part, written only when its color is not inherited from the item in some band or
    // state; an item that is no list item there has no marker, so inherit stands for it.
    const markerPart = (el: ResolvedElement): Part[] => {
      const line = (item: ResolvedElement | undefined): string => {
        const m = item === undefined ? undefined : markerOf(item);
        const v = m === undefined ? undefined : (m.props.get('color') as ResolvedValue);
        return v === undefined || v.origin === 'inherited' ? '  color: inherit;' : `  color: ${valueText(v.value)};`;
      };
      const base = line(el);
      const diffs = inBands.map((m) => (line(m.get(el.element.address)) === base ? [] : [line(m.get(el.element.address))]));
      const own = states.flatMap((list, band) => list.flatMap((st) => {
        const here = line(st.at.get(el.element.address));
        return here === line((bandBase[band] as Map<string, ResolvedElement>).get(el.element.address)) ? [] : [{ band, conditions: st.conditions, lines: [here] }];
      }));
      const inherit = base === '  color: inherit;' && diffs.every((d) => d.length === 0) && own.length === 0;
      return inherit ? [] : [{ suffix: '::marker', decls: [base], diffs, own }];
    };
    const visit = (el: ResolvedElement, under: boolean): void => {
      // Below a UA colour, an inherited colour stays inherited, so it follows a link's :active and visited colours.
      const uaColor = (el.props.get('color') as ResolvedValue).origin === 'user-agent';
      const below = under || sources.has(el.element.address) || uaColor;
      // GEN-a: a generated box has no DOM element; it is emitted with its host as the host's class plus ::before or ::after.
      const generated = el.children.filter((ch): ch is ResolvedElement => ch.kind === 'element' && isGeneratedElement(ch));
      const parts = [partOf(el, '', under, true), ...generated.map((g) => partOf(g, g.element.tag, below, false)), ...markerPart(el)];
      const keyOf = (pt: Part): string => `${pt.suffix}\u0000${pt.decls.join('\n')}${pt.diffs.some((d) => d.length > 0) ? `\u0000${JSON.stringify(pt.diffs)}` : ''}${pt.own.length > 0 ? `\u0001${JSON.stringify(pt.own)}` : ''}`;
      const variant = `${el.element.address}${parts.map(keyOf).join('\u0002')}`;
      let cls = variants.get(variant);
      if (cls === undefined) {
        cls = `dg${variants.size}`;
        variants.set(variant, cls);
        for (const pt of parts) {
          const subject = `.${cls}${pt.suffix}`;
          rules.push(`${subject} {\n${pt.decls.join('\n')}\n}`);
          pt.diffs.forEach((d, k) => {
            if (d.length > 0) (bandRules[k] as string[]).push(`${subject} {\n${d.join('\n')}\n}`);
          });
          if (pt.own.length > 0) pending.push({ subject, root: el === c.root, states: pt.own });
        }
        const list = classesOf.get(el.element.address) ?? [];
        list.push(cls);
        classesOf.set(el.element.address, list);
      }
      map.set(el.element.address, cls);
      for (const ch of el.children) if (ch.kind === 'element' && !isGeneratedElement(ch)) visit(ch, below);
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
        list.push(p.root ? `${cond}${p.subject}` : `${cond} ${p.subject}`);
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
