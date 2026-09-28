// The chrome-dual lane (docs/api.md §7, first check): authored CSS and Dragon's compiled web CSS rendered in the same Chrome,
// on the same markup with the same Ahem face. Boxes must be equal (Chrome reports them in 1/64 px steps; compared exactly),
// every milestone longhand's getComputedStyle string must be equal, and Dragon's resolved colour channels must equal
// Chrome's authored channels exactly. A text node has no computed style of its own, so Dragon's resolved text colour is compared
// with its parent element's computed color in both renderings. A fixture's computedExtra background longhands must equal, in both
// renderings, the initial value Dragon holds them at. There is no tolerance anywhere in this lane.
import type { ElementColors, Rgba8 } from 'dragon';
import { BACKGROUND_RESET_LONGHANDS, COLOR_LONGHANDS, LONGHANDS, parseComputedColor, serializeColor } from 'dragon';
import type { WebCapture } from './capture.ts';

export type DualNode = {
  readonly id: string;
  readonly kind: 'element' | 'text' | 'line';
  readonly boxesEqual: boolean;
  readonly valuesCompared: number;
  readonly valuesEqual: number;
  readonly channelsCompared: number;
  readonly channelsEqual: number;
};

export type DualComparison = {
  readonly pass: boolean;
  readonly nodes: readonly DualNode[];
  readonly boxesCompared: number;
  readonly boxesEqual: number;
  readonly valuesCompared: number;
  readonly valuesEqual: number;
  readonly channelsCompared: number;
  readonly channelsEqual: number;
  readonly problems: readonly string[];
};

const sameChannels = (a: Rgba8, b: Rgba8): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.alpha === b.alpha;

/** The element a captured text node belongs to: "<element>:text<k>" or "<element>:space<k>". */
export function textParent(id: string): string {
  const m = /^(.*):(?:text|space)\d+$/.exec(id);
  if (m === null) throw new Error(`${id} is not a text node id`);
  return m[1] as string;
}

export function compareDual(authored: WebCapture, compiled: WebCapture, colors: ReadonlyMap<string, ElementColors>, textColors: ReadonlyMap<string, Rgba8>, extra: readonly string[] = []): DualComparison {
  const problems: string[] = [];
  const nodes: DualNode[] = [];
  if (authored.devicePixelRatio !== compiled.devicePixelRatio || authored.direction !== compiled.direction || authored.viewport.width !== compiled.viewport.width || authored.viewport.height !== compiled.viewport.height) {
    problems.push('authored and compiled renderings ran in different environments');
  }
  const ids = (c: WebCapture): string => c.nodes.map((n) => n.id).join(' ');
  if (ids(authored) !== ids(compiled)) problems.push('authored and compiled renderings have different nodes');
  const byId = new Map(compiled.nodes.map((n) => [n.id, n]));
  const authoredById = new Map(authored.nodes.map((n) => [n.id, n]));
  for (const a of authored.nodes) {
    const c = byId.get(a.id);
    if (c === undefined) continue;
    const boxesEqual = a.hasBox === c.hasBox && a.x === c.x && a.y === c.y && a.width === c.width && a.height === c.height;
    if (!boxesEqual) problems.push(`${a.id}: box authored ${JSON.stringify([a.x, a.y, a.width, a.height])} compiled ${JSON.stringify([c.x, c.y, c.width, c.height])}`);
    let valuesCompared = 0;
    let valuesEqual = 0;
    let channelsCompared = 0;
    let channelsEqual = 0;
    if (a.kind === 'element') {
      const ac = a.computed;
      const cc = c.computed;
      if (ac === null || cc === null) {
        problems.push(`${a.id}: missing computed values`);
      } else {
        for (const p of LONGHANDS) {
          valuesCompared++;
          if (ac[p] === cc[p]) valuesEqual++;
          else problems.push(`${a.id}: ${p} authored "${String(ac[p])}" compiled "${String(cc[p])}"`);
        }
        for (const p of extra) {
          valuesCompared++;
          const mine = (BACKGROUND_RESET_LONGHANDS as { readonly [k: string]: string | undefined })[p];
          if (mine !== undefined && ac[p] === mine && cc[p] === mine) valuesEqual++;
          else problems.push(`${a.id}: ${p} authored "${String(ac[p])}" compiled "${String(cc[p])}" Dragon "${mine === undefined ? 'none' : mine}"`);
        }
        const captured = Object.keys(ac).length;
        if (captured !== LONGHANDS.length + extra.length || Object.keys(cc).length !== captured) problems.push(`${a.id}: captured ${captured} authored and ${Object.keys(cc).length} compiled computed values, expected ${LONGHANDS.length + extra.length}`);
        const dragon = colors.get(a.id);
        if (dragon === undefined) problems.push(`${a.id}: Dragon resolved no colours`);
        for (const p of COLOR_LONGHANDS) {
          if (dragon === undefined) break;
          channelsCompared++;
          const fromAuthored = parseComputedColor(String(ac[p]));
          const fromCompiled = parseComputedColor(String(cc[p]));
          const mine = dragon[p];
          if (fromAuthored !== null && fromCompiled !== null && sameChannels(fromAuthored, mine) && sameChannels(fromCompiled, mine)) channelsEqual++;
          else problems.push(`${a.id}: ${p} channels authored "${String(ac[p])}" compiled "${String(cc[p])}" Dragon "${serializeColor(mine)}"`);
        }
      }
    }
    if (a.kind === 'text') {
      const parent = textParent(a.id);
      const ap = authoredById.get(parent);
      const cp = byId.get(parent);
      const mine = textColors.get(a.id);
      channelsCompared++;
      const fromAuthored = ap === undefined || ap.computed === null ? null : parseComputedColor(String(ap.computed['color']));
      const fromCompiled = cp === undefined || cp.computed === null ? null : parseComputedColor(String(cp.computed['color']));
      if (mine !== undefined && fromAuthored !== null && fromCompiled !== null && sameChannels(fromAuthored, mine) && sameChannels(fromCompiled, mine)) channelsEqual++;
      else problems.push(`${a.id}: text color authored parent "${String(ap?.computed?.['color'])}" compiled parent "${String(cp?.computed?.['color'])}" Dragon "${mine === undefined ? 'none' : serializeColor(mine)}"`);
    }
    nodes.push({ id: a.id, kind: a.kind, boxesEqual, valuesCompared, valuesEqual, channelsCompared, channelsEqual });
  }
  const total = (f: (n: DualNode) => number): number => nodes.reduce((s, n) => s + f(n), 0);
  return {
    pass: problems.length === 0,
    nodes,
    boxesCompared: nodes.length,
    boxesEqual: nodes.filter((n) => n.boxesEqual).length,
    valuesCompared: total((n) => n.valuesCompared),
    valuesEqual: total((n) => n.valuesEqual),
    channelsCompared: total((n) => n.channelsCompared),
    channelsEqual: total((n) => n.channelsEqual),
    problems,
  };
}
