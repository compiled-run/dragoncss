// A Markless component's style input (markless.native-style-input/0, written by @markless/mobile's nativeStyleInput from its
// compiler's facts) as Dragon's FrontEndResult, and its dragon.native-style-export/1 through compileNativeStyles
// (docs/markless-native-styles.md "From a Markless style input"). The input carries no spans into the .tsrx, so every origin is
// the span of the input file itself; its CSS is its own source, whole.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import type { BrotliDecompress, ClassSymbol, Condition, FontMap, FrontEndResult, NativeStyles, NativeStylesConfig, NativeStyleTarget, Rgba8, RuntimeImageLayout, SourceFile, TreeNode } from 'dragon';
import { BAND_KEY, compiledCases, compileNativeStylesWith, decodeFontFile, isTreeNodeId, LISTED_OPTIONS_ATTRIBUTE, nativeBands, parseStylesheet, resolvedInteractionTextTransforms, resolvedTextTransforms, TREE_SCHEMA_REVISION } from 'dragon';
import type { LayoutInput, rtBand } from '@dragon/layout';
import { layout, textDecoration } from '@dragon/layout';
import { referenceMeasurer } from './native-host.ts';
import { systemMeasurer } from './system-fonts/measurer.ts';
import { registerFace } from './text-shaper-host.ts';
import { FONT_REFERENCE_MAP } from './font-reference.ts';
import { checkPlan, HEIGHT_FEATURES, heightDependence, hexBits, PLAN_HEIGHTS, planStateProgram, slottedLayout } from './markless-plan.ts';
import type { MarklessPlan } from './markless-plan.ts';
import { withFontMapAssets } from './fixture-groups/fonts.ts';
import { DOCUMENT_ID, PROJECT_ID } from './fixture-reader.ts';
import type { ExportAssignment, ExportDevice, ExportNode, ExportTarget, NativeStyleExport } from './native-style-export.ts';
import { EXPORT_DEVICES, exportBands, nativeStyleExport, valuesOf } from './native-style-export.ts';
import { programAt } from 'dragon';
import { isWhitespaceText, rehostAddress, textAddresser } from './node-ids.ts';
import type { MarklessSlot, SlotSample, StyleTemplate } from './markless-slots.ts';
import { checkSlots, engineStyles, filledStyle, slotBindings } from './markless-slots.ts';
import { systemFontsFor } from './system-fonts/provider.ts';

export const MARKLESS_STYLE_INPUT_VERSION = 'markless.native-style-input/0';

/** A state's value: true or false, or one of the strings a cell can hold (a tab's selected value). */
export type StateValue = boolean | string;
type When = Readonly<Record<string, StateValue>>;
/** Where a node sits when it belongs to one arm of an @if or @try: the branch, and the arm's index among its arms. */
export type MarklessArm = { readonly branch: string; readonly index: number };
/** The value a branch's state takes while it shows no arm (an @if with no @else whose test fails). */
export const MARKLESS_NO_ARM = 'none';
export type MarklessStyleInput = {
  readonly version: typeof MARKLESS_STYLE_INPUT_VERSION;
  readonly component: string;
  readonly nodes: readonly (
    | { readonly kind: 'element'; readonly id: string; readonly element: string; readonly parent: string | null; readonly attributes: Readonly<Record<string, string>>; readonly classByState?: readonly { readonly when: When; readonly value: string | null }[]; readonly attributesByState?: Readonly<Record<string, readonly { readonly when: When; readonly value: string | null }[]>>; readonly boxless?: true; readonly runtimeSrc?: { readonly absent: boolean }; readonly arm?: MarklessArm; readonly row?: string; readonly styleTemplate?: StyleTemplate; readonly styleByState?: readonly { readonly when: When; readonly template: StyleTemplate }[] }
    | { readonly kind: 'text'; readonly id: string; readonly parent: string; readonly text: string; readonly textByState?: readonly { readonly when: When; readonly value: string }[]; readonly arm?: MarklessArm; readonly row?: string }
  )[];
  readonly css: string;
  /** `row`: a state each row of that list holds for itself (the outcome of a class its item decides), not the page's. */
  readonly states: readonly { readonly cell: string; readonly domain: readonly StateValue[]; readonly initial: StateValue; readonly row?: string }[];
  /**
   * Each keyed @for whose rows hold nodes: its nodes name it in `row`, and are the template of one row. Dragon lays the template out
   * once; a phone lays out one copy per row. `arm`: the arm the list sits in.
   */
  readonly repeats?: readonly { readonly id: string; readonly parent: string | null; readonly arm?: MarklessArm }[];
  /**
   * The CSS size each target lays this tree out in, when it is not the page: a system sheet's content area at one resting
   * height, measured on the device by the host that presents it. Absent: the export devices' page viewports.
   */
  readonly viewports?: { readonly [T in NativeStyleTarget]: { readonly width: number; readonly height: number } };
  /**
   * Each @font-face src url of `css` that names a file of the app: the url exactly as `css` spells it, and the file's path relative
   * to the directory of the input file.
   */
  readonly fonts?: readonly { readonly url: string; readonly file: string }[];
  /** The numbers the app writes into styleTemplates while it runs (markless-slots.ts), each with its value at the initial state. */
  readonly slots?: readonly MarklessSlot[];
  /**
   * Each @if or @try whose arms hold nodes, compiled as a state: its value is the arm it shows ("0", "1", …, or MARKLESS_NO_ARM), so
   * every combination of arms is laid out as Chrome lays that page out. `arm`: the arm the branch itself sits in.
   */
  readonly branches?: readonly { readonly id: string; readonly domain: readonly string[]; readonly initial: string; readonly arm?: MarklessArm }[];
};

/**
 * An author font file of the input, read: its url as `css` spells it, its path and bytes (what Chrome loads), and the sfnt the hosts
 * load with its SHA-256 id and its path relative to the input. For a .ttf or .otf that is the file itself; a WOFF or WOFF2 is decoded
 * at build time and its sfnt is written to DECODED_FONTS_DIR beside the input.
 */
export type MarklessFontFile = {
  readonly url: string;
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly id: string;
  readonly sfnt: Uint8Array;
  readonly sfntFile: string;
};

/** The Brotli decoder the parity layer gives Dragon's compile for WOFF2 sources: Node's zlib. */
export const NODE_BROTLI: BrotliDecompress = (data, limit) => new Uint8Array(brotliDecompressSync(data, { maxOutputLength: Math.max(1, limit) }));

/** Where the export command writes the decoded sfnt of each WOFF or WOFF2 author font, relative to the input file. */
export const DECODED_FONTS_DIR = 'dragon-decoded-fonts';

/**
 * How a Markless export resolves fonts. 'system' (what the markless:style-export command uses, owner 2026-11-18): system-ui,
 * sans-serif, serif, monospace and no font-family at all are each target's own platform font, measured at build time
 * (system-fonts/). 'pinned': Dragon's stated reference, which pins sans-serif to Inter and monospace to Noto Sans Mono
 * (font-reference.ts), as the device lanes do.
 */
export type MarklessFonts = 'system' | 'pinned';

/** The document a detached component is laid out in, as Chrome renders it for the comparison: no body margin, the pinned sans face. */
export const MARKLESS_DOCUMENT_CSS = 'body { margin: 0; font-family: sans-serif; }';
/** The document with system fonts: no body margin, and no font-family, so a text with none is the browser's default font. */
export const MARKLESS_SYSTEM_DOCUMENT_CSS = 'body { margin: 0; }';

/** The font map with system fonts: each generic a system face plays is left to the platform, which the export measures. */
export const MARKLESS_SYSTEM_FONT_MAP: FontMap = { generics: { 'system-ui': { mode: 'platform' }, 'sans-serif': { mode: 'platform' }, serif: { mode: 'platform' }, monospace: { mode: 'platform' } } };

/** The attribute a boxless element carries, and the rule that keeps its box out of the layout. */
export const MARKLESS_BOXLESS_ATTRIBUTE = 'data-markless-boxless';
const BOXLESS_CSS = `[${MARKLESS_BOXLESS_ATTRIBUTE}] { display: contents !important; }`;

/**
 * The document a tree is laid out in: the base sheet, and for a tree with boxless elements (the markup ancestors of a sheet's
 * content, there for its selectors and inheritance) the rule that gives them no box.
 */
export const marklessDocumentCss = (input: MarklessStyleInput, fonts: MarklessFonts = 'pinned'): string => {
  const base = fonts === 'system' ? MARKLESS_SYSTEM_DOCUMENT_CSS : MARKLESS_DOCUMENT_CSS;
  return input.nodes.some((n) => n.kind === 'element' && n.boxless === true) ? `${base}\n${BOXLESS_CSS}` : base;
};

/** The host shows every <dialog> with showModal(): the export lays it out shown (topLayer 'host'), and the reference document too. */
export const marklessShownModal = (n: MarklessStyleInput['nodes'][number]): boolean => n.kind === 'element' && n.element === 'dialog';

/** The value a by-state list gives under an assignment's values (keyed by cell); the input lists one entry per combination. */
export function valueUnder(entries: readonly { readonly when: Readonly<Record<string, StateValue>>; readonly value: string | null }[], values: Readonly<Record<string, unknown>>, id: string): string | null {
  const found = entries.filter((e) => Object.entries(e.when).every(([cell, v]) => values[cell] === v));
  if (found.length !== 1) throw new Error(`${id}: ${found.length} by-state entries hold for ${JSON.stringify(values)}`);
  return (found[0] as (typeof entries)[number]).value;
}

/** The ids of the document the component is laid out in, which the export keeps under these names. */
const DOCUMENT_NODES: readonly string[] = ['html', 'body'];

const fail = (what: string): never => {
  throw new Error(`markless style input: ${what}`);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const onlyKeys = (what: string, v: Record<string, unknown>, keys: readonly string[]): void => {
  const other = Object.keys(v).filter((k) => !keys.includes(k));
  if (other.length > 0) fail(`${what} has ${other.join(', ')}, which the conversion does not read`);
};

/** Checks every field the conversion reads; anything else in the input is refused rather than ignored. */
export function parseMarklessStyleInput(text: string): MarklessStyleInput {
  const v: unknown = JSON.parse(text);
  if (!isRecord(v) || v['version'] !== MARKLESS_STYLE_INPUT_VERSION) fail(`not ${MARKLESS_STYLE_INPUT_VERSION}`);
  const o = v as Record<string, unknown>;
  onlyKeys('the input', o, ['version', 'component', 'nodes', 'css', 'states', 'viewports', 'fonts', 'branches', 'repeats', 'slots']);
  const repeats = new Map<string, { parent: string | null; arm: unknown }>();
  if (o['repeats'] !== undefined) {
    if (!Array.isArray(o['repeats'])) fail('repeats is not a list');
    for (const each of o['repeats'] as unknown[]) {
      if (!isRecord(each) || !isString(each['id']) || each['id'] === '') fail(`bad repeat ${JSON.stringify(each)}`);
      const r = each as Record<string, unknown>;
      const id = r['id'] as string;
      onlyKeys(`repeat ${id}`, r, ['id', 'parent', 'arm']);
      if (repeats.has(id)) fail(`repeat ${id} is listed twice`);
      if (!(r['parent'] === null || isString(r['parent']))) fail(`repeat ${id}: parent is an element id or null`);
      repeats.set(id, { parent: r['parent'] as string | null, arm: r['arm'] });
    }
  }
  if (!isString(o['component']) || !/^[A-Z][A-Za-z0-9]*$/.test(o['component'])) fail(`component ${JSON.stringify(o['component'])} is not an identifier starting with an ASCII capital`);
  if (!isString(o['css'])) fail('css is not a string');
  if (!Array.isArray(o['states'])) fail('states is not a list');
  const cells = new Map<string, readonly StateValue[]>();
  const rowOfState = new Map<string, string>();
  for (const s of o['states'] as unknown[]) {
    if (!isRecord(s) || !isString(s['cell'])) fail(`bad state ${JSON.stringify(s)}`);
    const st = s as Record<string, unknown>;
    onlyKeys(`state ${String(st['cell'])}`, st, ['cell', 'domain', 'initial', 'row']);
    if (st['row'] !== undefined && !(isString(st['row']) && repeats.has(st['row']))) fail(`state ${String(st['cell'])}: row ${JSON.stringify(st['row'])} is not a repeat`);
    if (st['row'] !== undefined) rowOfState.set(st['cell'] as string, st['row'] as string);
    const domain = st['domain'];
    const boolean = Array.isArray(domain) && domain.length === 2 && domain[0] === false && domain[1] === true;
    const strings = Array.isArray(domain) && domain.length > 0 && domain.every(isString) && new Set(domain).size === domain.length;
    if (!boolean && !strings) fail(`${String(st['cell'])}: a state's domain is [false, true] or a list of distinct strings, not ${JSON.stringify(domain)}`);
    if (!(domain as unknown[]).includes(st['initial'])) fail(`${String(st['cell'])}: initial ${JSON.stringify(st['initial'])} is not in its domain`);
    if (cells.has(st['cell'] as string)) fail(`state ${String(st['cell'])} is listed twice`);
    cells.set(st['cell'] as string, domain as StateValue[]);
  }
  if (o['viewports'] !== undefined) {
    const viewports = o['viewports'];
    if (!isRecord(viewports) || Object.keys(viewports).sort().join() !== Object.keys(EXPORT_DEVICES).sort().join()) fail(`viewports names ${JSON.stringify(viewports)}, not one size per target (${Object.keys(EXPORT_DEVICES).join(', ')})`);
    for (const [t, size] of Object.entries(viewports as Record<string, unknown>)) {
      // Whole CSS px, as the page viewports are: Chrome, the reference the export is compared with, lays out no other size.
      const ok = isRecord(size) && Object.keys(size).sort().join() === 'height,width' && [size['width'], size['height']].every((n) => Number.isInteger(n) && (n as number) > 0);
      if (!ok) fail(`viewports.${t} is not a { width, height } of positive whole CSS px`);
    }
  }
  if (o['fonts'] !== undefined) {
    if (!Array.isArray(o['fonts'])) fail('fonts is not a list');
    const files = new Map<string, string>();
    for (const f of o['fonts'] as unknown[]) {
      const ok = isRecord(f) && Object.keys(f).sort().join() === 'file,url' && isString(f['url']) && f['url'] !== '' && isString(f['file']) && f['file'] !== '';
      if (!ok) fail(`bad fonts entry ${JSON.stringify(f)}: a font is { url, file }`);
      const { url, file } = f as { url: string; file: string };
      if (posix.isAbsolute(file) || file.split('/').includes('')) fail(`fonts: ${file} is not a path relative to the input file`);
      if (files.has(url)) fail(`fonts: ${url} is listed twice`);
      files.set(url, file);
    }
  }
  const branches = new Map<string, readonly string[]>();
  const branchArm = new Map<string, MarklessArm | undefined>();
  const checkArm = (what: string, arm: unknown): void => {
    const ok = isRecord(arm) && Object.keys(arm).sort().join() === 'branch,index' && isString(arm['branch']) && Number.isInteger(arm['index']) && (arm['index'] as number) >= 0;
    if (!ok) fail(`${what}: an arm is { branch, index } with a whole index, not ${JSON.stringify(arm)}`);
    const { branch, index } = arm as MarklessArm;
    const domain = branches.get(branch);
    if (domain === undefined) fail(`${what}: arm names ${branch}, which is not an earlier branch`);
    if (!(domain as readonly string[]).includes(String(index))) fail(`${what}: ${branch} has no arm ${index}`);
  };
  if (o['branches'] !== undefined) {
    if (!Array.isArray(o['branches'])) fail('branches is not a list');
    for (const b of o['branches'] as unknown[]) {
      if (!isRecord(b) || !isString(b['id']) || b['id'] === '') fail(`bad branch ${JSON.stringify(b)}`);
      const br = b as Record<string, unknown>;
      const id = br['id'] as string;
      onlyKeys(`branch ${id}`, br, ['id', 'domain', 'initial', 'arm']);
      if (branches.has(id) || cells.has(id)) fail(`branch ${id} is listed twice, or is also a state`);
      const domain = br['domain'];
      const arms = Array.isArray(domain) ? domain.filter((v) => v !== MARKLESS_NO_ARM) : [];
      const ok = Array.isArray(domain) && arms.length > 0 && arms.every((v, k) => v === String(k)) && domain.length - arms.length <= 1 && (domain.length === arms.length || domain[domain.length - 1] === MARKLESS_NO_ARM);
      if (!ok) fail(`branch ${id}: a domain is its arms "0", "1", … in order, then "${MARKLESS_NO_ARM}" when it can show none, not ${JSON.stringify(domain)}`);
      if (!(domain as unknown[]).includes(br['initial'])) fail(`branch ${id}: initial ${JSON.stringify(br['initial'])} is not in its domain`);
      if (br['arm'] !== undefined) checkArm(`branch ${id}`, br['arm']);
      branches.set(id, domain as string[]);
      branchArm.set(id, br['arm'] as MarklessArm | undefined);
    }
  }
  for (const [id, r] of repeats) if (r.arm !== undefined) checkArm(`repeat ${id}`, r.arm);
  const listIn = new Map<string | null, string>();
  for (const [id, r] of repeats) {
    const other = listIn.get(r.parent);
    if (other !== undefined) fail(`repeat ${id}: its parent ${r.parent ?? 'body'} holds repeat ${other} too; two lists in one parent are not supported yet`);
    listIn.set(r.parent, id);
  }
  const sameArm = (a: MarklessArm, b: MarklessArm): boolean => a.branch === b.branch && a.index === b.index;
  const nodeArm = new Map<string, MarklessArm | undefined>();
  // A node inside an element of an arm sits in that arm too, directly or through a branch nested in it.
  const checkNested = (id: string, parent: unknown, arm: MarklessArm | undefined): void => {
    const outer = isString(parent) ? nodeArm.get(parent) : undefined;
    if (outer !== undefined && !armChain(arm, branchArm).some((a) => sameArm(a, outer))) fail(`${id}: its parent ${String(parent)} is in arm ${outer.index} of ${outer.branch}, and it is not`);
    nodeArm.set(id, arm);
  };
  if (!Array.isArray(o['nodes'])) fail('nodes is not a list');
  const ids = new Set<string>();
  const nodeRow = new Map<string, string | undefined>();
  for (const n of o['nodes'] as unknown[]) {
    if (!isRecord(n) || !isString(n['id']) || n['id'] === '') fail(`bad node ${JSON.stringify(n)}`);
    const node = n as Record<string, unknown>;
    const id = node['id'] as string;
    if (ids.has(id)) fail(`node ${id} is listed twice`);
    if (DOCUMENT_NODES.includes(id)) fail(`${id}: html and body are the export's own document nodes`);
    const row = node['row'];
    if (row !== undefined && !(isString(row) && repeats.has(row))) fail(`${id}: row ${JSON.stringify(row)} is not a repeat`);
    // A row's template hangs from its list's parent; inside it, every node is the same row's.
    const parentRow = isString(node['parent']) ? nodeRow.get(node['parent']) : undefined;
    if (parentRow !== undefined && parentRow !== row) fail(`${id}: its parent ${String(node['parent'])} is in a row of ${parentRow}, and it is not`);
    if (row !== undefined && parentRow === undefined && (node['parent'] ?? null) !== (repeats.get(row as string)?.parent ?? null)) fail(`${id}: a row of ${String(row)} hangs from its list's parent, not ${String(node['parent'])}`);
    nodeRow.set(id, row as string | undefined);
    if (node['arm'] !== undefined) checkArm(id, node['arm']);
    // A row's node sits in the arm its list sits in, unless an arm inside the row holds it.
    const listArm = isString(row) ? (repeats.get(row)?.arm as MarklessArm | undefined) : undefined;
    checkNested(id, node['parent'], (node['arm'] as MarklessArm | undefined) ?? listArm);
    const checkByState = (what: string, byState: unknown, field: 'value' | 'template' = 'value'): void => {
      if (!Array.isArray(byState)) fail(`${id}: ${what} is not a list`);
      for (const e of byState as unknown[]) {
        const given = isRecord(e) ? e[field] : undefined;
        const ok = field === 'value' ? given === null || isString(given) : Array.isArray(given);
        if (!isRecord(e) || !ok || !isRecord(e['when'])) fail(`${id}: bad ${what} entry ${JSON.stringify(e)}`);
        onlyKeys(`${id}: a ${what} entry`, e as Record<string, unknown>, ['when', field]);
        const when = (e as Record<string, unknown>)['when'] as Record<string, unknown>;
        for (const [cell, value] of Object.entries(when)) if (!(cells.get(cell) ?? []).includes(value as StateValue)) fail(`${id}: ${what} names ${cell}=${JSON.stringify(value)}, which is not a state and one of its values`);
        // A row's own state reaches only that row's nodes: it differs from row to row.
        for (const cell of Object.keys(when)) {
          const own = rowOfState.get(cell);
          if (own !== undefined && own !== row && byStateVaries(byState as unknown[], cell)) fail(`${id}: ${what} follows ${cell}, a state of each row of ${own}, outside those rows`);
        }
      }
    };
    if (node['kind'] === 'text') {
      onlyKeys(id, node, ['kind', 'id', 'parent', 'text', 'textByState', 'arm', 'row']);
      if (!isString(node['parent']) || !ids.has(node['parent'])) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isString(node['text'])) fail(`${id}: text is not a string`);
      if (node['textByState'] !== undefined) {
        checkByState('textByState', node['textByState']);
        if (!(node['textByState'] as unknown[]).every((e) => isString((e as Record<string, unknown>)['value']))) fail(`${id}: textByState gives a text that is not a string`);
      }
    } else if (node['kind'] === 'element') {
      onlyKeys(id, node, ['kind', 'id', 'element', 'parent', 'attributes', 'classByState', 'attributesByState', 'boxless', 'runtimeSrc', 'arm', 'row', 'styleTemplate', 'styleByState']);
      // REPL-r1: an img whose src the app sets at run time; absent says the src may also be missing.
      const runtimeSrc = node['runtimeSrc'];
      if (runtimeSrc !== undefined && !(isRecord(runtimeSrc) && Object.keys(runtimeSrc).join() === 'absent' && typeof runtimeSrc['absent'] === 'boolean')) fail(`${id}: runtimeSrc is not { absent: boolean }`);
      if (!isString(node['element']) || !/^[a-z][a-z0-9-]*$/.test(node['element'])) fail(`${id}: bad element name ${JSON.stringify(node['element'])}`);
      if (node['parent'] !== null && !(isString(node['parent']) && ids.has(node['parent']))) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isRecord(node['attributes']) || !Object.values(node['attributes']).every(isString)) fail(`${id}: attributes are not strings`);
      if (node['boxless'] !== undefined && node['boxless'] !== true) fail(`${id}: boxless is true or absent`);
      if (MARKLESS_BOXLESS_ATTRIBUTE in (node['attributes'] as Record<string, unknown>)) fail(`${id}: ${MARKLESS_BOXLESS_ATTRIBUTE} is Dragon's own attribute`);
      if (LISTED_OPTIONS_ATTRIBUTE in (node['attributes'] as Record<string, unknown>)) fail(`${id}: ${LISTED_OPTIONS_ATTRIBUTE} is Dragon's own attribute`);
      if (node['classByState'] !== undefined) {
        if ('class' in (node['attributes'] as Record<string, unknown>)) fail(`${id}: class is both a fixed attribute and a class by state`);
        checkByState('classByState', node['classByState']);
      }
      const attributesByState = node['attributesByState'];
      if (attributesByState !== undefined) {
        if (!isRecord(attributesByState)) fail(`${id}: attributesByState is not an object`);
        for (const [name, byState] of Object.entries(attributesByState as Record<string, unknown>)) {
          if (name === 'class' || !/^[a-z][a-z0-9-]*$/.test(name)) fail(`${id}: attributesByState names ${JSON.stringify(name)}, which is not a non-class attribute name`);
          if (name in (node['attributes'] as Record<string, unknown>)) fail(`${id}: ${name} is both a fixed attribute and an attribute by state`);
          if (name === MARKLESS_BOXLESS_ATTRIBUTE || name === LISTED_OPTIONS_ATTRIBUTE) fail(`${id}: ${name} is Dragon's own attribute`);
          checkByState(`attributesByState.${name}`, byState);
        }
      }
      if (node['styleByState'] !== undefined) checkByState('styleByState', node['styleByState'], 'template');
    } else fail(`${id}: kind ${JSON.stringify(node['kind'])} is neither element nor text`);
    ids.add(id);
  }
  checkSlots(o['slots'], o['nodes'] as Record<string, unknown>[]);
  return v as MarklessStyleInput;
}

/** The input with each styleTemplate and styleByState written into its element's style attribute at the slots' initial values, and no slots. */
export function filledAtInitial(input: MarklessStyleInput): MarklessStyleInput {
  if (input.slots === undefined && !input.nodes.some((n) => n.kind === 'element' && n.styleByState !== undefined)) return input;
  const values = new Map((input.slots ?? []).map((s) => [s.id, s.initial]));
  const { slots: _, ...rest } = input;
  return {
    ...rest,
    nodes: input.nodes.map((n) => {
      if (n.kind !== 'element') return n;
      if (n.styleByState !== undefined) {
        const { styleByState, ...e } = n;
        return { ...e, attributesByState: { ...e.attributesByState, style: styleByState.map(({ when, template }) => ({ when, value: filledStyle(template, values) })) } };
      }
      if (n.styleTemplate === undefined) return n;
      const { styleTemplate, ...e } = n;
      return { ...e, attributes: { ...e.attributes, style: filledStyle(styleTemplate, values) } };
    }),
  };
}


/** Whether a by-state list gives different values as `cell` changes, the other states held: a node outside a row may list a row's state only as a key it ignores. */
function byStateVaries(entries: readonly unknown[], cell: string): boolean {
  const rest = (e: unknown): string => JSON.stringify(Object.entries(((e as Record<string, unknown>)['when'] ?? {}) as Record<string, unknown>).filter(([c]) => c !== cell).sort());
  const values = new Map<string, unknown>();
  for (const e of entries) {
    const key = rest(e);
    const v = JSON.stringify((e as Record<string, unknown>)['value']);
    if (values.has(key) && values.get(key) !== v) return true;
    values.set(key, v);
  }
  return false;
}

/** One row of a list written out: its key, the value of each of its own states, and its texts by the template's text id. */
export type MarklessRow = { readonly key: string; readonly states: Readonly<Record<string, StateValue>>; readonly texts: ReadonlyMap<string, string> };

/**
 * The input as the web renders it with these rows: each row a copy of its list's template named "<id>@<key>", in the list's arm,
 * with its classes and attributes at its own states' values and its own texts; the lists and the rows' states are gone.
 */
export function marklessWithRows(input: MarklessStyleInput, rows: ReadonlyMap<string, readonly MarklessRow[]>): MarklessStyleInput {
  const nodes: MarklessStyleInput['nodes'][number][] = [];
  const placed = new Set<string>();
  for (const n of input.nodes) {
    if (n.row === undefined) {
      nodes.push(n);
      continue;
    }
    if (placed.has(n.row)) continue;
    placed.add(n.row);
    const repeat = (input.repeats ?? []).find((r) => r.id === n.row);
    if (repeat === undefined) fail(`${n.id}: row ${n.row} is not a repeat`);
    const list = repeat as NonNullable<typeof repeat>;
    for (const row of rows.get(list.id) ?? []) {
      for (const t of input.nodes.filter((x) => x.row === list.id)) {
        const parent = t.parent === list.parent ? t.parent : `${t.parent}@${row.key}`;
        const arm = t.arm ?? list.arm;
        const place = arm === undefined ? {} : { arm };
        if (t.kind === 'text') {
          nodes.push({ kind: 'text', id: `${t.id}@${row.key}`, parent: parent as string, text: row.texts.get(t.id) ?? shownText(t, row.states), ...place });
          continue;
        }
        const attributes: Record<string, string> = { ...t.attributes };
        const cls = t.classByState === undefined ? undefined : valueUnder(t.classByState, row.states, t.id);
        if (cls !== undefined && cls !== null) attributes['class'] = cls;
        for (const [name, entries] of Object.entries(t.attributesByState ?? {})) {
          const v = valueUnder(entries, row.states, t.id);
          if (v !== null) attributes[name] = v;
        }
        nodes.push({ kind: 'element', id: `${t.id}@${row.key}`, element: t.element, parent, attributes, ...(t.boxless === true ? { boxless: true as const } : {}), ...(t.runtimeSrc === undefined ? {} : { runtimeSrc: t.runtimeSrc }), ...(t.styleTemplate === undefined ? {} : { styleTemplate: t.styleTemplate }), ...place });
      }
    }
  }
  const { repeats: _, ...rest } = input;
  return { ...rest, nodes, states: input.states.filter((st) => st.row === undefined) };
}

/** HTML's class attribute: a set of tokens separated by ASCII whitespace. */
const classTokens = (value: string): string[] => value.split(/[\t\n\f\r ]+/).filter((t) => t !== '');

/** Every combination of the input's states, each as its value per cell, in the input's order. */
export const stateCombinations = (input: MarklessStyleInput): Record<string, StateValue>[] =>
  input.states.reduce<Record<string, StateValue>[]>((all, s) => all.flatMap((p) => s.domain.map((value) => ({ ...p, [s.cell]: value }))), [{}]);

/** Every combination the export lays out: the input's states, then each branch's arm, by branch id. */
export const assignmentCombinations = (input: MarklessStyleInput): Record<string, StateValue>[] =>
  (input.branches ?? []).reduce<Record<string, StateValue>[]>((all, b) => all.flatMap((p) => b.domain.map((value) => ({ ...p, [b.id]: value }))), stateCombinations(input));

/** An arm and every arm around it, innermost first. */
export function armChain(arm: MarklessArm | undefined, armOfBranch: ReadonlyMap<string, MarklessArm | undefined>): MarklessArm[] {
  const out: MarklessArm[] = [];
  for (let at = arm; at !== undefined; at = armOfBranch.get(at.branch)) out.push(at);
  return out;
}

/** The branches around a node, each with the arm it must show for the node to be shown. */
export const armsAround = (input: MarklessStyleInput, arm: MarklessArm | undefined): MarklessArm[] =>
  armChain(arm, new Map((input.branches ?? []).map((b) => [b.id, b.arm])));

/** Whether a node of one of the input's arms is shown where the branches take `values` (a node in no arm always is). */
export const armShown = (input: MarklessStyleInput, arm: MarklessArm | undefined, values: Readonly<Record<string, unknown>>): boolean =>
  armsAround(input, arm).every((a) => values[a.branch] === String(a.index));

/** The input's state for a cell or branch, named s<k> in Dragon (a cell id such as "state:liked" is not a state identifier). */
const stateIds = (input: MarklessStyleInput): Map<string, string> => new Map([...input.states.map((s) => s.cell), ...(input.branches ?? []).map((b) => b.id)].map((key, k) => [key, `s${k}`]));

/**
 * Dragon's tree id for each node of the input: an element's own id where Dragon accepts it (Markless names a component's nodes
 * by their path, `component-edge:0/h0`), else, and for every text node, an `m<k>` no input node uses.
 */
export function dragonNodeIds(input: MarklessStyleInput): Map<string, string> {
  const taken = new Set(input.nodes.map((n) => n.id));
  const out = new Map<string, string>();
  let k = 0;
  for (const n of input.nodes) {
    if (n.kind === 'element' && isTreeNodeId(n.id)) {
      out.set(n.id, n.id);
      continue;
    }
    while (taken.has(`m${k}`)) k++;
    taken.add(`m${k}`);
    out.set(n.id, `m${k}`);
  }
  return out;
}

/** The input's author font files, read by the caller (who owns file access) from each path relative to the input file. */
export function marklessFontFiles(input: MarklessStyleInput, read: (file: string) => Uint8Array): MarklessFontFile[] {
  return (input.fonts ?? []).map(({ url, file }) => {
    const bytes = read(file);
    // A file that does not decode is compiled as it is, so Dragon reports it (DRAGON_FONT_UNREADABLE).
    const decoded = decodeFontFile(bytes, NODE_BROTLI);
    const sfnt = decoded.ok ? decoded.sfnt : bytes;
    const hex = createHash('sha256').update(sfnt).digest('hex');
    const sfntFile = decoded.ok && decoded.container !== 'sfnt' ? `${DECODED_FONTS_DIR}/${hex}.${String.fromCharCode(...sfnt.subarray(0, 4)) === 'OTTO' ? 'otf' : 'ttf'}` : file;
    return { url, file, bytes, id: `sha256:${hex}`, sfnt, sfntFile };
  });
}

/** The snapshot asset id of an author font file. */
const fontAssetId = (file: string): string => `markless-font:${file}`;

/** The string a text node shows under an assignment's values (keyed by cell). */
export const shownText = (n: Extract<MarklessStyleInput['nodes'][number], { kind: 'text' }>, values: Readonly<Record<string, unknown>>): string =>
  n.textByState === undefined ? n.text : (valueUnder(n.textByState, values, n.id) as string);

/**
 * The input's id of a node named by Dragon's address rule (node-ids.ts) under elements named elementId(id), in one assignment
 * (values keyed by cell): an element's text child is its input text node by the text it shows there, and any other node keeps its
 * suffix after its element's input id ("m0::backdrop" to "component-edge:0::backdrop").
 */
export function marklessNodeId(input: MarklessStyleInput, elementId: (id: string) => string, values: Readonly<Record<string, unknown>>): (address: string) => string {
  const textOf = new Map<string, string>();
  const elementOf = new Map<string, string>();
  for (const e of input.nodes) {
    if (e.kind !== 'element') continue;
    elementOf.set(elementId(e.id), e.id);
    const address = textAddresser(elementId(e.id));
    // Only the texts this assignment shows are numbered: a sibling in an arm it does not show has no box, so no address.
    for (const c of input.nodes) if (c.kind === 'text' && c.parent === e.id && armShown(input, c.arm, values)) textOf.set(address(shownText(c, values)), c.id);
  }
  return (address) => textOf.get(address) ?? rehostAddress(address, (tree) => elementOf.get(tree));
}

export function marklessFrontEnd(slotted: MarklessStyleInput, inputText: string, inputPath: string, fonts: readonly MarklessFontFile[] = [], mode: MarklessFonts = 'pinned'): FrontEndResult {
  const input = filledAtInitial(slotted);
  const unread = (input.fonts ?? []).filter((f) => !fonts.some((r) => r.url === f.url && r.file === f.file));
  if (unread.length > 0) fail(`the font file ${unread.map((f) => f.file).join(', ')} was not read`);
  const dragonId = dragonNodeIds(input);
  const taken = new Set([...input.nodes.map((n) => n.id), ...dragonId.values()]);
  let k = 0;
  const fresh = (): string => {
    while (taken.has(`m${k}`)) k++;
    taken.add(`m${k}`);
    return `m${k}`;
  };
  const file = (name: string, text: string): SourceFile => ({ ref: { uri: `dragon-source://${PROJECT_ID}/markless/${input.component}/${name}`, revision: 'markless', hash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}` }, text, displayPath: name === 'input.json' ? inputPath : `${inputPath}#${name}` });
  const src = file('input.json', inputText);
  const css = file('component.css', input.css);
  const documentCss = marklessDocumentCss(input, mode);
  const doc = file('document.css', documentCss);
  const origin = { kind: 'authored' as const, span: { source: src.ref, start: 0, end: inputText.length } };
  const states = stateIds(input);
  const combos = stateCombinations(input);
  const eq = (cell: string, value: StateValue): Condition => ({ kind: 'eq', ref: { instance: '.', state: states.get(cell) as string }, value });
  const all = (when: When): Condition => {
    const terms = Object.entries(when).map(([cell, value]) => eq(cell, value));
    return terms.length === 1 ? (terms[0] as Condition) : { kind: 'and', values: terms };
  };
  const symbol = (name: string): ClassSymbol => ({ owner: DOCUMENT_ID, sheet: 'component', name });
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  type ByStateList = readonly { readonly when: When; readonly value: string | null }[];
  // One entry per combination of the states, so each value's condition is exactly the combinations that carry it.
  const entriesOf = (id: string, what: string, byState: ByStateList): ByStateList => {
    const entries = combos.map((c) => {
      const found = byState.filter((e) => Object.keys(e.when).length === Object.keys(c).length && Object.entries(e.when).every(([cell, v]) => c[cell] === v));
      if (found.length !== 1) fail(`${id}: ${what} has ${found.length} entries for ${JSON.stringify(c)}`);
      return found[0] as ByStateList[number];
    });
    if (byState.length !== combos.length) fail(`${id}: ${what} has ${byState.length} entries for ${combos.length} combinations`);
    return entries;
  };
  const node = (n: MarklessStyleInput['nodes'][number]): TreeNode => {
    type ByState = readonly { readonly when: When; readonly value: string | null }[];
    if (n.kind === 'text') {
      if (n.textByState === undefined) return { kind: 'text', id: dragonId.get(n.id) as string, text: n.text, origin } as TreeNode;
      // A text that follows state: one arm per distinct string, each holding exactly the combinations that give it, so every
      // assignment lays out the string it shows.
      const entryOf = entriesOf(n.id, 'textByState', n.textByState);
      const values = [...new Set(entryOf.map((e) => e.value as string))];
      const arm = (k: number): TreeNode => {
        const text = { kind: 'text', id: fresh(), text: values[k] as string, origin } as TreeNode;
        if (k === values.length - 1) return text;
        const on = entryOf.filter((e) => e.value === values[k]);
        const when: Condition = on.length === 1 ? all((on[0] as ByState[number]).when) : { kind: 'or', values: on.map((e) => all(e.when)) };
        return { kind: 'branch', id: fresh(), when, then: [text], else: [arm(k + 1)], origin } as TreeNode;
      };
      return arm(0);
    }
    let classes: { value: { when: Condition; value: ClassSymbol | null }[]; origin: typeof origin }[];
    if (n.classByState === undefined) classes = classTokens(n.attributes['class'] ?? '').map((t) => ({ value: [{ when: { kind: 'true' }, value: symbol(t) }], origin }));
    else {
      const byState = n.classByState;
      const entryOf = entriesOf(n.id, 'classByState', byState);
      const tokens = [...new Set(entryOf.flatMap((e) => classTokens(e.value ?? '')))];
      classes = tokens.map((t) => {
        const on = entryOf.filter((e) => classTokens(e.value ?? '').includes(t));
        if (on.length === combos.length) return { value: [{ when: { kind: 'true' }, value: symbol(t) }], origin };
        const when: Condition = on.length === 1 ? all((on[0] as (typeof byState)[number]).when) : { kind: 'or', values: on.map((e) => all(e.when)) };
        return { value: [{ when, value: symbol(t) }, { when: { kind: 'not', value: when }, value: null }], origin };
      });
    }
    return {
      kind: 'element',
      id: dragonId.get(n.id) as string,
      tag: n.element,
      classes,
      attributes: [
        ...Object.entries(n.attributes).filter(([name]) => name !== 'class').map(([name, value]) => ({ name, value: [{ when: { kind: 'true' }, value }], origin })),
        ...(marklessShownModal(n) && !('open' in n.attributes) ? [{ name: 'open', value: [{ when: { kind: 'true' }, value: '' }], origin }] : []),
        ...(n.boxless === true ? [{ name: MARKLESS_BOXLESS_ATTRIBUTE, value: [{ when: { kind: 'true' }, value: '' }], origin }] : []),
        // FORM-b S4: a select holding a list's rows has only the template option here, so Dragon keeps its widest-option refusals.
        ...(n.kind === 'element' && n.element === 'select' && input.nodes.some((k) => k.parent === n.id && k.row !== undefined) ? [{ name: LISTED_OPTIONS_ATTRIBUTE, value: [{ when: { kind: 'true' }, value: '' }], origin }] : []),
        // An attribute that follows state: each distinct value (null: absent) holds in exactly the combinations that give it.
        ...Object.entries(n.attributesByState ?? {}).map(([name, byState]) => {
          const entryOf = entriesOf(n.id, `attributesByState.${name}`, byState);
          const values = [...new Set(entryOf.map((e) => e.value))];
          return {
            name,
            value: values.map((value) => {
              const on = entryOf.filter((e) => e.value === value);
              const when: Condition = on.length === combos.length ? { kind: 'true' } : on.length === 1 ? all((on[0] as ByState[number]).when) : { kind: 'or', values: on.map((e) => all(e.when)) };
              return { when, value };
            }),
            origin,
          };
        }),
      ],
      children: (children.get(n.id) ?? []).map((c) => placed(c, n.arm)),
      origin,
      ...(n.runtimeSrc === undefined ? {} : { runtimeSrc: n.runtimeSrc }),
    } as TreeNode;
  };
  // A node in an arm its parent is not in is laid out only where its branch, and each branch around it, shows that arm.
  const placed = (n: MarklessStyleInput['nodes'][number], outer: MarklessArm | undefined): TreeNode => {
    const inside = n.arm === undefined || (outer !== undefined && n.arm.branch === outer.branch && n.arm.index === outer.index);
    if (inside) return node(n);
    const arms = armsAround(input, n.arm);
    const terms = arms.map((a) => eq(a.branch, String(a.index)));
    const when: Condition = terms.length === 1 ? (terms[0] as Condition) : { kind: 'and', values: terms };
    return { kind: 'branch', id: fresh(), when, then: [node(n)], else: [], origin } as TreeNode;
  };
  const body = { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], children: (children.get(null) ?? []).map((c) => placed(c, undefined)), origin } as TreeNode;
  const html = { kind: 'element', id: 'html', tag: 'html', classes: [], attributes: [], children: [body], origin } as TreeNode;
  return {
    producer: { name: 'markless-native-style-input', version: '0', schemaRevision: TREE_SCHEMA_REVISION },
    snapshot: {
      projectId: PROJECT_ID,
      revision: 'markless',
      sources: [src, css, doc],
      assets: [...new Map(fonts.map((f) => [fontAssetId(f.file), { id: fontAssetId(f.file), hash: `sha256:${createHash('sha256').update(f.bytes).digest('hex')}`, bytes: f.bytes }])).values()],
      resolutions: fonts.map((f) => ({ from: css.ref, specifier: f.url, kind: 'asset', to: fontAssetId(f.file) })),
    },
    diagnostics: [],
    tree: {
      schema: 'dragon/tree@0',
      schemaRevision: TREE_SCHEMA_REVISION,
      modules: [{ id: 'component', source: src.ref.uri }],
      components: [{
        id: input.component,
        module: 'component',
        params: [],
        states: [
          ...input.states.map((s) => ({ id: states.get(s.cell) as string, domain: [...s.domain], initial: s.initial, origin })),
          ...(input.branches ?? []).map((b) => ({ id: states.get(b.id) as string, domain: [...b.domain], initial: b.initial, origin })),
        ],
        slots: [],
        root: [html],
        origin,
      }],
      documents: [{ id: DOCUMENT_ID, rootInstance: input.component, documentElement: 'html', styles: ['document', 'component'], initial: [] }],
      styles: [
        { id: 'document', css: { source: doc.ref, start: 0, end: documentCss.length }, scope: { kind: 'document' } },
        { id: 'component', css: { source: css.ref, start: 0, end: input.css.length }, scope: { kind: 'document' } },
      ],
    },
    completeness: 'closed-application',
  } as unknown as FrontEndResult;
}

/** The devices an export is asked to be laid out at instead of the input's own (a phone's own size and ratio). */
export type MarklessAtSize = { readonly [T in NativeStyleTarget]: ExportDevice };

/** The device each target lays the input out on: `at` when it was asked for, else the export devices at the input's viewports when it gives them. */
export const marklessDevices = (parsed: MarklessStyleInput, at?: MarklessAtSize): { readonly [T in NativeStyleTarget]: ExportDevice } =>
  at !== undefined ? at : parsed.viewports === undefined ? EXPORT_DEVICES : { ios: { ...EXPORT_DEVICES.ios, viewport: parsed.viewports.ios }, android: { ...EXPORT_DEVICES.android, viewport: parsed.viewports.android } };

/**
 * REPL-r1: each target's export device, laid out with the measurer its export measures with (its system fonts, or the reference
 * faces and the input's own), so an img whose src is set at run time is proven where the export lays it out.
 */
function marklessRuntimeLayout(devices: { readonly [T in NativeStyleTarget]: ExportDevice }, fonts: readonly MarklessFontFile[], mode: MarklessFonts): RuntimeImageLayout {
  const faces = new Map(fonts.map((f) => [registerFace(f.sfnt), f.sfnt] as const));
  return {
    devices: (['ios', 'android'] as const).map((t) => ({
      ...devices[t].viewport,
      dpr: devices[t].dpr,
      layout: (input: LayoutInput) => {
        const m = mode === 'system' ? systemMeasurer(systemFontsFor(t, devices[t].dpr), input, [...faces.keys()], devices[t].dpr, faces) : referenceMeasurer([...faces.keys()]);
        const r = layout(input, m);
        return r.kind === 'ok' ? null : r.unsupported;
      },
    })),
  };
}

/** The input compiled as the device lanes compile (support 'lanes'), with the font map of its font mode; a compile error is refused. */
function compileMarkless(parsed: MarklessStyleInput, inputText: string, inputPath: string, fonts: readonly MarklessFontFile[], mode: MarklessFonts, at?: MarklessAtSize): { readonly input: FrontEndResult; readonly styles: NativeStyles; readonly compiled: object; readonly devices: { readonly [T in NativeStyleTarget]: ExportDevice } } {
  const map = mode === 'system' ? MARKLESS_SYSTEM_FONT_MAP : FONT_REFERENCE_MAP;
  const input = withFontMapAssets(marklessFrontEnd(parsed, inputText, inputPath, fonts, mode), map);
  const devices = marklessDevices(parsed, at);
  const config: NativeStylesConfig = { projectId: PROJECT_ID, name: parsed.component, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, fonts: map, viewport: devices.ios.viewport, support: 'lanes', topLayer: 'host', canvas: 'host', forms: 'host', textEditing: 'host', output: 'program', brotliDecompress: NODE_BROTLI, ...(mode === 'system' ? { systemFonts: 'measured' as const } : {}), runtimeImageLayout: marklessRuntimeLayout(devices, fonts, mode) };
  const { styles, compiled } = compileNativeStylesWith(config, input);
  const errors = styles.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) fail(`${parsed.component} does not compile:\n${errors.map((d) => `  ${d.code} [${d.target ?? 'all'}] ${d.message}`).join('\n')}`);
  return { input, styles, compiled, devices };
}

/** Dragon keys a state "<instance>#s<k>"; the hosts know the cell. */
function cellKey(parsed: MarklessStyleInput): (key: string) => string {
  const cellOf = new Map([...parsed.states.map((s) => s.cell), ...(parsed.branches ?? []).map((b) => b.id)].map((key, k) => [`s${k}`, key]));
  return (key) => {
    if (key === BAND_KEY) return key;
    const cell = cellOf.get(key.slice(key.lastIndexOf('#') + 1));
    if (cell === undefined) fail(`Dragon's state ${key} is not one of the input's`);
    return cell as string;
  };
}

/**
 * What the input compiles to per target, keyed as the export keys it: the states, the @media bands, the device it is laid out on,
 * and its state machine: each assignment's values, the initial one and the setter transitions (indices into `assignments`).
 */
export type MarklessCompiledTarget = Pick<ExportTarget, 'states' | 'bands' | 'viewport' | 'dpr' | 'initial' | 'next'> & { readonly assignments: readonly Readonly<Record<string, unknown>>[] };

/** The targets the input compiles to, compiled as marklessStyleExport compiles it with these font files in this font mode (and `at`). */
export function marklessCompiledTargets(parsed: MarklessStyleInput, fonts: readonly MarklessFontFile[] = [], mode: MarklessFonts = 'pinned', at?: MarklessAtSize): { readonly [T in NativeStyleTarget]?: MarklessCompiledTarget } {
  const { styles, devices } = compileMarkless(parsed, JSON.stringify(parsed), `${parsed.component}.native-style-input.json`, fonts, mode, at);
  const rekey = cellKey(parsed);
  const out: { [T in NativeStyleTarget]?: MarklessCompiledTarget } = {};
  for (const [t, o] of Object.entries(styles.targets) as [NativeStyleTarget, (typeof styles.targets)[NativeStyleTarget]][]) {
    if (o === undefined) continue;
    if (o.kind !== 'emitted') return fail(`${t} is blocked: ${o.reason}`);
    out[t] = {
      states: o.program.states.map((s) => ({ key: rekey(s.key), domain: s.domain })),
      ...exportBands(o),
      viewport: devices[t].viewport,
      dpr: devices[t].dpr,
      assignments: o.program.assignments.map((a) => Object.fromEntries(Object.entries(valuesOf(a.assignment)).map(([k, v]) => [rekey(k), v]))),
      initial: o.program.initial,
      next: o.program.next,
    };
  }
  return out;
}

/**
 * The input compiled as the device lanes compile (support 'lanes'), exported with the cells' own keys: with system fonts each
 * target measures its platform's own fonts at build time; pinned, the stated reference's font map.
 * `decoded`: the sfnt of each WOFF or WOFF2 author font, by its path relative to the input (DECODED_FONTS_DIR), which the export
 * lists with `from: 'input'` and the caller writes there.
 */
export function marklessStyleExport(inputText: string, inputPath: string, readFont?: (file: string) => Uint8Array, mode: MarklessFonts = 'pinned', at?: MarklessAtSize, plan = false): { readonly input: FrontEndResult; readonly exported: MarklessStyleExport; readonly decoded: readonly { readonly file: string; readonly bytes: Uint8Array }[] } {
  const parsed = parseMarklessStyleInput(inputText);
  if ((parsed.fonts ?? []).length > 0 && readFont === undefined) fail('the input names font files, and no reader for them was given');
  const fonts = readFont === undefined ? [] : marklessFontFiles(parsed, readFont);
  const done = exportMarkless(parsed, inputText, inputPath, fonts, mode, at, plan);
  const slots = parsed.slots ?? [];
  if (slots.length === 0) return done;
  if (!plan) fail(`${parsed.component} has style values that follow state (slots ${slots.map((s) => s.id).join(', ')}), which a phone applies only with the layout plan (--plan)`);
  const sampleOf = (values: readonly number[]): SlotSample => {
    const input = { ...parsed, slots: slots.map((s, k) => ({ ...s, initial: values[k] as number })) };
    const { styles, exported } = exportMarkless(input, inputText, inputPath, fonts, mode, at, false);
    return Object.fromEntries(Object.entries(exported.targets).map(([t, x]) => {
      const o = styles.targets[t as NativeStyleTarget];
      if (o?.kind !== 'emitted') return fail(`${t} is blocked`);
      return [t, x.assignments.map((a, i) => ({ ...engineStyles(o.program, i), writes: new Map(a.nodes.map((n) => [n.id, n.writes])), frames: new Map(a.nodes.map((n) => [n.id, n.frame])) }))];
    }));
  };
  const initial = slots.map((s) => s.initial);
  const base = sampleOf(initial);
  const tried = (values: readonly number[]): SlotSample | { readonly refused: string } => {
    try {
      return sampleOf(values);
    } catch (e) {
      return { refused: (e as Error).message };
    }
  };
  const compiled: (readonly [readonly number[], SlotSample])[] = [];
  const bindings = slotBindings(slots, base, (k, v) => {
    const values = initial.map((x, j) => (j === k ? v : x));
    const got = tried(values);
    if (!('refused' in got)) compiled.push([values, got]);
    return got;
  }, (values) => {
    const got = tried(values);
    if ('refused' in got) return fail(`the slots together at ${JSON.stringify(values)} do not compile: ${got.refused}`);
    compiled.push([values, got]);
    return got;
  });
  const targets = Object.fromEntries(Object.entries(done.exported.targets).map(([t, x]) => {
    // The slot bindings cover the program's assignments only; a pressed or focused state would lay out at the initial slot values.
    if (x.interaction !== undefined) fail(`${parsed.component} has style values that follow state (slots ${slots.map((s) => s.id).join(', ')}) and interaction states (:hover, :active, :focus) together, which a phone does not apply yet`);
    const plan = x.plan;
    const per = bindings[t as NativeStyleTarget];
    if (plan === undefined || per === undefined) return fail(`${t}: no plan to carry the slots in`);
    const slotted = { ...plan, slots: slots.map((s) => [s.id, s.integer === true ? 'integer' : 'number'] as const), assignments: plan.assignments.map((a, i) => ({ ...a, slotFields: per[i]?.fields ?? [], slotWrites: per[i]?.writes ?? [], slotRefusals: per[i]?.refused ?? [] })) };
    const read = JSON.parse(checkPlan(JSON.stringify(slotted))) as readonly unknown[];
    if (read[0] !== 'ok') fail(`${t}: the device cannot read this page's slots: ${String(read[1] ?? read[0])}`);
    // At every sample the phone's function lays the page out as that sample's own compile does (text it shapes is text the plan recorded).
    for (const [values, sample] of compiled) for (const [i, a] of (sample[t as NativeStyleTarget] ?? []).entries()) {
      const names = new Map(done.exported.targets[t as NativeStyleTarget]?.planNames?.[i] ?? []);
      const got = slottedLayout(slotted, i, x.viewport, x.dpr, values);
      if (got[0] !== 'ok') fail(`${t} assignment ${i}: at ${JSON.stringify(values)} the phone cannot lay this page out (${String(got[1])}); a slot that changes how a text is shaped or broken is not carried, as the plan records text at the initial values`);
      for (const n of got[2] as unknown[][]) {
        const id = names.get(n[0] as string) ?? (n[0] as string);
        const want = a.frames.get(id);
        const frame = (n[1] as string[]).map(hexBits);
        if (want !== undefined && want !== null && JSON.stringify([want.x, want.y, want.width, want.height]) !== JSON.stringify(frame)) fail(`${t} assignment ${i}: at ${JSON.stringify(values)} the phone lays ${id} out at ${JSON.stringify(frame)}, and that value's own compile at ${JSON.stringify(want)}`);
      }
    }
    return [t, { ...x, plan: slotted }];
  }));
  return { ...done, exported: { ...done.exported, slots: slots.map((s) => ({ ...s })), targets } as MarklessStyleExport };
}

/**
 * Per target, what may make the page's text change with the viewport height (markless-plan.ts heightDependence), or null when
 * Dragon's analysis proves it cannot, so the layout plan does not check its text at PLAN_HEIGHTS' heights.
 */
export function marklessTextHeightProof(inputText: string, inputPath: string, readFont?: (file: string) => Uint8Array, mode: MarklessFonts = 'system'): { readonly [T in NativeStyleTarget]?: string | null } {
  const parsed = parseMarklessStyleInput(inputText);
  const fonts = readFont === undefined ? [] : marklessFontFiles(parsed, readFont);
  const { styles } = compileMarkless(parsed, inputText, inputPath, fonts, mode);
  const out: { [T in NativeStyleTarget]?: string | null } = {};
  for (const t of ['ios', 'android'] as const) {
    const o = styles.targets[t];
    if (o?.kind === 'emitted') out[t] = heightDependence(planStateProgram(o.program, o.interaction), (o.bands?.table.atoms ?? []).map((a) => a.feature));
  }
  return out;
}

/**
 * What makes a target's page depend on the viewport's height, each named: an @media feature that reads it, and each node whose
 * frame differs when the page is laid out at `width` and each of `heights` and PLAN_HEIGHTS' (vh units, percentage heights that
 * resolve against the viewport, text sized by the height). Empty when the page depends on the width alone.
 */
export function marklessHeightDependence(parsed: MarklessStyleInput, fonts: readonly MarklessFontFile[], mode: MarklessFonts, t: NativeStyleTarget, width: number, dpr: number, heights: readonly number[]): string[] {
  const text = JSON.stringify(parsed);
  const path = `${parsed.component}.native-style-input.json`;
  const out = new Set<string>();
  const o = compileMarkless(parsed, text, path, fonts, mode).styles.targets[t];
  for (const a of o?.kind === 'emitted' ? o.bands?.table.atoms ?? [] : []) if (HEIGHT_FEATURES.has(a.feature)) out.add(`@media (${a.feature})`);
  const laidOut = [...new Set([...heights, PLAN_HEIGHTS.min, PLAN_HEIGHTS.max])].map((height) => {
    const device = { viewport: { width, height }, dpr };
    const x = exportMarkless(parsed, text, path, fonts, mode, { ios: device, android: device }, false).exported.targets[t];
    if (x === undefined) return fail(`the export has no ${t} target`);
    return x.assignments.map((a) => new Map(a.nodes.map((n) => [n.id, JSON.stringify(n.frame)])));
  });
  const [first, ...rest] = laidOut;
  for (const other of rest) for (const [i, nodes] of (first ?? []).entries()) {
    const there = other[i];
    for (const [id, frame] of nodes) if (there?.get(id) !== frame) out.add(`node ${id}`);
  }
  return [...out];
}

/** Whether a node is an option or optgroup inside a select, or a node inside such an option: Chrome's closed control draws only the shown label, so it has no box. */
export function inSelectOptions(byId: ReadonlyMap<string, MarklessStyleInput['nodes'][number]>, n: MarklessStyleInput['nodes'][number]): boolean {
  let at: MarklessStyleInput['nodes'][number] | undefined = n;
  let listed = false;
  while (at !== undefined) {
    if (at.kind === 'element' && at.element === 'select') return listed;
    if (at.kind === 'element' && (at.element === 'option' || at.element === 'optgroup')) listed = true;
    at = at.parent === null ? undefined : byId.get(at.parent);
  }
  return false;
}

type PlanNode = { readonly id: string; readonly kind: string; readonly children?: readonly PlanNode[] };

/**
 * The plan with every text leaf the build lays out with a text-transform in any case and band (resolve.ts transformRun) listed in
 * `transformed`, which the phone refuses to replace with a page text, as it would lay out that text as typed.
 */
function withTransformed(plan: MarklessPlan, compiled: object): MarklessPlan {
  const on = new Set<string>();
  const elements = new Set<string>();
  const bands = nativeBands(compiled);
  for (let band = 0; band < (bands === null ? 1 : bands.table.bands.length); band++) {
    for (const c of compiledCases(compiled)) {
      const transforms = resolvedTextTransforms(compiled, c.assignment, band);
      if (transforms === null) return fail(`a case did not resolve in band ${band}`);
      // An interaction state's own text-transform counts too: the phone lays that state's text out as the plan recorded it.
      for (const map of [transforms, ...(resolvedInteractionTextTransforms(compiled, c.assignment, band) ?? [])]) {
        for (const [address, transform] of map) {
          elements.add(address);
          if (transform !== 'none') on.add(address);
        }
      }
    }
  }
  const leaves = new Set<string>();
  const walk = (n: PlanNode, element: string | null): void => {
    const own = elements.has(n.id) ? n.id : element;
    if (n.kind === 'text' && own !== null && on.has(own)) leaves.add(n.id);
    for (const child of n.children ?? []) walk(child, own);
  };
  for (const v of plan.variants) walk(v.root as unknown as PlanNode, null);
  return leaves.size === 0 ? plan : { ...plan, transformed: [...leaves].sort() };
}


/** Each Dragon id an assignment's plan geometry names, with the input's id for it, where they differ. */
const planNamesOf = (a: ExportAssignment, rename: (id: string) => string): (readonly [string, string])[] => a.nodes.map((n) => [n.id, rename(n.id)] as const).filter(([d, m]) => d !== m);

/** Every interaction state's assignment of a target, in level order. */
const interactionStates = (x: NativeStyleExport['targets'][NativeStyleTarget] & object): readonly ExportAssignment[] => x.interaction?.levels.flatMap((l) => l.states) ?? [];

function exportMarkless(parsed: MarklessStyleInput, inputText: string, inputPath: string, fonts: readonly MarklessFontFile[], mode: MarklessFonts, at: MarklessAtSize | undefined, plan: boolean): { readonly input: FrontEndResult; readonly styles: NativeStyles; readonly exported: MarklessStyleExport; readonly decoded: readonly { readonly file: string; readonly bytes: Uint8Array }[] } {
  const { input, styles, compiled, devices } = compileMarkless(parsed, inputText, inputPath, fonts, mode, at);
  const raw = nativeStyleExport(styles, parsed.component, inputPath, devices, fonts.map((f) => ({ id: f.id, file: f.sfntFile, bytes: f.sfnt })), mode === 'system' ? systemFontsFor : null, plan);
  const rekey = cellKey(parsed);
  const cellValues = (a: ExportAssignment): Record<string, unknown> => Object.fromEntries(Object.entries(a.values).map(([k, v]) => [rekey(k), v]));
  const dragonIds = dragonNodeIds(parsed);
  const rowOfNode = new Map(parsed.nodes.flatMap((n) => (n.row === undefined ? [] : [[n.id, n.row] as const])));
  const renameIn = (a: ExportAssignment): ((id: string) => string) => marklessNodeId(parsed, (id) => dragonIds.get(id) as string, cellValues(a));
  const renamed = (a: ExportAssignment): ExportAssignment => {
    const rename = renameIn(a);
    return { ...a, nodes: a.nodes.map((n) => ({ ...n, id: rename(n.id), parent: n.parent === null ? null : rename(n.parent) })) };
  };
  const exported: NativeStyleExport = {
    ...raw,
    targets: Object.fromEntries(Object.entries(raw.targets).map(([t, x]) => [t, {
      ...x,
      assignments: x.assignments.map(renamed),
      // An interaction state is laid out under its assignment's values, so it takes that assignment's names.
      ...(x.interaction === undefined ? {} : { interaction: { levels: x.interaction.levels.map((l, i) => {
        const rename = renameIn(x.assignments[i] as ExportAssignment);
        const one = (id: string | null): string | null => (id === null ? null : rename(id));
        const addresses = l.addresses.map(rename);
        return {
          ...l,
          addresses,
          // A list row's node is the template a phone copies per row: the state applies to the copy the touch or focus is in.
          rows: Object.fromEntries(addresses.flatMap((id) => {
            const row = rowOfNode.get(id);
            return row === undefined ? [] : [[id, row] as const];
          })),
          states: l.states.map((st) => ({ ...st, nodes: st.nodes.map((n) => ({ ...n, id: rename(n.id), parent: n.parent === null ? null : rename(n.parent) })) })),
          matches: l.matches.map((m) => ({ hover: m.hover.map(rename), active: m.active.map(rename), focus: one(m.focus), focusVisible: one(m.focusVisible), force: m.force.map((f) => ({ ...f, address: rename(f.address) })) })),
        };
      }) } }),
      // The plan lays out Dragon's own ids; a host names each assignment's geometry with the input's, by the export's rule.
      ...(x.plan === undefined ? {} : { plan: withTransformed(x.plan, compiled), planNames: [
        ...x.assignments.map((a) => planNamesOf(a, renameIn(a))),
        ...(x.interaction?.levels.flatMap((l, i) => l.states.map((st) => planNamesOf(st, renameIn(x.assignments[i] as ExportAssignment)))) ?? []),
      ], planRepeats: planRepeats(parsed, dragonIds) }),
    }])),
  };
  for (const [t, x] of Object.entries(exported.targets)) for (const a of [...x.assignments, ...interactionStates(x)]) {
    const have = new Set(a.nodes.map((n) => n.id));
    if (have.size !== a.nodes.length) fail(`${t}: the export names ${a.nodes.length - have.size} node(s) by an id another node has`);
  }
  // The animator keeps one state for the page, so a row's copies would share one clock and a row added later would never run.
  const inRows = new Map(parsed.nodes.flatMap((n) => (n.row === undefined ? [] : [[dragonIds.get(n.id) as string, n.id] as const])));
  for (const [t, x] of Object.entries(exported.targets)) {
    if (x.anim === undefined) continue;
    const animated = [...x.anim.slots, ...x.anim.animations, ...x.anim.bases].map((e) => e.node);
    const row = animated.find((node) => inRows.has(node));
    if (row !== undefined) fail(`${t}: ${inRows.get(row)} has a transition or animation inside a @for row, which a phone runs only for the page, not per row, yet`);
  }
  // Named with no frame: an element a hidden attribute (fixed or by state) or a style state another assignment shows it in hides here, and its contents.
  const boxless = (a: ExportAssignment, shown: ReadonlySet<string>): ExportAssignment => {
    const have = new Set(a.nodes.map((n) => n.id));
    const values = cellValues(a);
    const hiddenHere = new Set<string>();
    const named = new Set<string>();
    const inputParent = new Map(parsed.nodes.map((n) => [n.id, n.parent]));
    // Its parent in the export: the nearest ancestor the export has (a boxless one has no node), else body.
    const parentOf = (id: string): string => {
      let p = inputParent.get(id) ?? null;
      while (p !== null && !have.has(p) && !named.has(p)) p = inputParent.get(p) ?? null;
      return p ?? 'body';
    };
    const added = parsed.nodes.flatMap((n): ExportNode[] => {
      if (have.has(n.id)) return [];
      const byState = n.kind === 'element' ? n.attributesByState?.['hidden'] : undefined;
      // The boxless rule's display: contents !important beats hidden's UA display: none, so a boxless element hides nothing.
      const own = n.kind === 'element'
        ? n.boxless !== true && ('hidden' in n.attributes || (byState !== undefined && valueUnder(byState, values, n.id) !== null) || shown.has(n.id))
        : !armShown(parsed, n.arm, values);
      if (!own && !hiddenHere.has(n.parent ?? '')) return [];
      hiddenHere.add(n.id);
      if (n.kind === 'element' && n.boxless === true) return [];
      named.add(n.id);
      return [{ id: n.id, parent: parentOf(n.id), kind: n.kind, native: n.kind === 'text' ? 'DragonTextView' : 'DragonBoxView', text: n.kind === 'text' ? shownText(n, values) : null, frame: null, borderWidths: null, writes: [] }];
    });
    return { ...a, nodes: [...a.nodes, ...added] };
  };
  for (const x of Object.values(exported.targets)) {
    const shown = new Set([...x.assignments, ...interactionStates(x)].flatMap((a) => a.nodes.map((n) => n.id)));
    (x as { assignments: unknown }).assignments = x.assignments.map((a) => boxless(a, shown));
    if (x.interaction !== undefined) (x as { interaction: unknown }).interaction = { levels: x.interaction.levels.map((l) => ({ ...l, states: l.states.map((st) => boxless(st, shown)) })) };
  }
  const byId = new Map(parsed.nodes.map((n) => [n.id, n]));
  const inSelectList = (n: MarklessStyleInput['nodes'][number]): boolean => inSelectOptions(byId, n);
  for (const [t, x] of Object.entries(exported.targets)) for (const a of [...x.assignments, ...interactionStates(x)]) {
    const have = new Set(a.nodes.map((n) => n.id));
    const values = cellValues(a);
    const boxless = (n: MarklessStyleInput['nodes'][number]): boolean => n.kind === 'element' && n.boxless === true;
    const boxed = parsed.nodes.filter((n) => boxless(n) && have.has(n.id)).map((n) => n.id);
    if (boxed.length > 0) fail(`${t}: ${boxed.join(', ')} must generate no box (an ancestor in the markup, there for selectors and inheritance), but the CSS gives it a display other than contents`);
    // Whitespace-only text Dragon drops where it collapses away, as Chrome generates no box for it.
    // A textarea's text is its editor's text leaf, <textarea id>::editor:text0, absent while it is empty.
    const editorText = (n: MarklessStyleInput['nodes'][number]): boolean => {
      if (n.kind !== 'text') return false;
      const parent = byId.get(n.parent);
      return parent !== undefined && parent.kind === 'element' && parent.element === 'textarea' && (shownText(n, values) === '' || have.has(`${parent.id}::editor:text0`));
    };
    const missing = parsed.nodes.filter((n) => !boxless(n) && !inSelectList(n) && !editorText(n) && !have.has(n.id) && !(n.kind === 'text' && isWhitespaceText(shownText(n, values)))).map((n) => n.id);
    if (missing.length > 0) fail(`${t}: the export has no node ${missing.join(', ')} of the input`);
  }
  if ((parsed.repeats ?? []).length > 0) checkRows(parsed, inputPath, exported, styles, compiled, fonts, mode, at);
  const targets = Object.fromEntries(Object.entries(exported.targets).map(([t, x]) => {
    const out = styles.targets[t as NativeStyleTarget];
    if (out?.kind !== 'emitted' || out.schemes.length !== x.assignments.length) fail(`${t}: the compile gives no colour scheme for each assignment`);
    const schemes = (out as Extract<typeof out, { kind: 'emitted' }>).schemes;
    return [t, {
      ...x,
      states: x.states.map((s) => ({ ...s, key: rekey(s.key) })),
      assignments: x.assignments.map((a, i) => ({
        ...a,
        values: cellValues(a),
        colorScheme: (schemes[i] as UsedScheme).colorScheme,
        ...rootPaint(a.nodes, `${t} assignment ${i}`, bandScheme(x.bands, a.values[BAND_KEY]), schemes[i] as UsedScheme),
      })),
      ...(x.interaction === undefined ? {} : { interaction: { levels: x.interaction.levels.map((l, i) => ({
        ...l,
        states: l.states.map((a, k) => ({
          ...a,
          values: cellValues(a),
          colorScheme: (schemes[i] as UsedScheme).colorScheme,
          ...rootPaint(a.nodes, `${t} assignment ${i} interaction state ${k}`, bandScheme(x.bands, a.values[BAND_KEY]), schemes[i] as UsedScheme),
        })),
      })) } }),
    }];
  }));
  const decoded = [...new Map(fonts.filter((f) => f.sfntFile !== f.file).map((f) => [f.sfntFile, { file: f.sfntFile, bytes: f.sfnt }])).values()];
  return { input, styles, exported: { ...exported, fontMode: mode, targets }, decoded };
}

/**
 * Each list of the input as a phone lays its rows out (harness.ts runMarklessRowsLayout): the box its rows hang from and the ids of
 * one row's top boxes in order, as the plan names them. A row is elements at its top; text right in a row has no box to copy. A list
 * of a select's options has no rows to lay out: the closed control draws only the shown label.
 */
function planRepeats(parsed: MarklessStyleInput, dragonIds: ReadonlyMap<string, string>): { readonly id: string; readonly parent: string; readonly template: readonly string[] }[] {
  const byId = new Map(parsed.nodes.map((n) => [n.id, n] as const));
  return (parsed.repeats ?? []).flatMap((r) => {
    const top = parsed.nodes.filter((n) => n.row === r.id && n.parent === r.parent);
    if (top.length > 0 && top.every((n) => inSelectOptions(byId, n))) return [];
    const text = top.find((n) => n.kind === 'text');
    if (text !== undefined) fail(`${text.id}: text right inside a row of ${r.id} has no box a phone can copy per row; wrap it in an element`);
    if (top.length === 0) fail(`${r.id}: its rows hold no node`);
    return [{ id: r.id, parent: r.parent === null ? 'body' : (dragonIds.get(r.parent) as string), template: top.map((n) => dragonIds.get(n.id) as string) }];
  });
}

type ParsedRule = ReturnType<typeof parseStylesheet>[number];
type ParsedSelector = ParsedRule['selectors'][number];
type ParsedCompound = ParsedSelector['parts'][number]['compound'];
type InputElement = Extract<MarklessStyleInput['nodes'][number], { readonly kind: 'element' }>;

/** The compounds an element must match, all of them, for one part of a selector; an :is(), :where() or "of S" argument's subject also its host's. */
type Subject = readonly ParsedCompound[];

/** Part j's subject in `sel`: an argument's subject (j 0) is also its `host`, unless the argument is negated (:not()), when only the host's. */
function subjectAt(sel: ParsedSelector, host: Subject | null, negated: boolean): (j: number) => Subject {
  return (j) => {
    const own = (sel.parts[j] as ParsedSelector['parts'][number]).compound;
    return j === 0 && host !== null ? (negated ? host : [...host, own]) : [own];
  };
}

/** Whether a compound may match an element in some state: its type, and each class and id it names among those the element takes. */
function mayMatch(c: ParsedCompound, n: InputElement): boolean {
  if (c.tag !== null && c.tag !== n.element) return false;
  const taken = (name: string): Set<string> => {
    const values = [n.attributes[name], ...(name === 'class' ? (n.classByState ?? []).map((e) => e.value) : []), ...(n.attributesByState?.[name] ?? []).map((e) => e.value)];
    return new Set(values.flatMap((v) => (typeof v === 'string' ? (name === 'class' ? classTokens(v) : [v]) : [])));
  };
  const classes = taken('class');
  const ids = taken('id');
  return c.classes.every((x) => classes.has(x)) && c.ids.every((x) => ids.has(x));
}

/**
 * Refuses a selector, as Dragon parses the input's sheet, that tests where an element sits among the children of a list's parent
 * (:first-child, :nth-child() and the rest, :only-child, or + and ~ beside it): those children are the rows and their siblings,
 * whose positions a phone's copies of the template do not see, at any row count.
 */
function checkRowPositions(parsed: MarklessStyleInput, rules: readonly ParsedRule[]): void {
  const parents = new Set((parsed.repeats ?? []).map((r) => r.parent));
  const children = parsed.nodes.filter((n): n is InputElement => n.kind === 'element' && parents.has(n.parent));
  const reaches = (c: Subject): string[] => children.filter((n) => c.every((x) => mayMatch(x, n))).map((n) => n.id);
  const positional = (sel: ParsedSelector, host: Subject | null, negated = false): string[] => {
    const at = subjectAt(sel, host, negated);
    return sel.parts.flatMap((p, i) => [
      ...(p.combinator === '+' || p.combinator === '~' ? [...reaches(at(i)), ...reaches(at(i - 1))] : []),
      ...p.compound.pseudos.flatMap((ps) => {
        if (ps.kind === 'nth') return [...reaches(at(i)), ...(ps.of ?? []).flatMap((s) => positional(s, at(i)))];
        if (ps.kind === 'only') return reaches(at(i));
        if (ps.kind === 'is' || ps.kind === 'not') return ps.selectors.flatMap((s) => positional(s, at(i), ps.kind === 'not'));
        if (ps.kind === 'has') return ps.selectors.flatMap((s) => [...(s.anchor === '+' || s.anchor === '~' ? reaches(at(i)) : []), ...positional(s, null)]);
        return [];
      }),
    ]);
  };
  for (const rule of rules) {
    if (rule.declarations.length === 0) continue;
    const ids = [...new Set(rule.selectors.filter((sel) => !sel.dropped).flatMap((sel) => positional(sel, null)))];
    if (ids.length > 0) fail(`a selector tests where ${ids.join(', ')} sits among a list's rows (:first-child, :nth-child(), :only-child, + or ~); a style that depends on a row's position is not supported yet`);
  }
}

/** The input's sheet as Dragon parses it. */
function inputRules(parsed: MarklessStyleInput): ParsedRule[] {
  const ref = { uri: `dragon-source://${PROJECT_ID}/markless/${parsed.component}/component.css`, revision: 'markless', hash: 'sha256:0' };
  return parseStylesheet(parsed.css, { source: ref, start: 0, end: parsed.css.length }, { id: 'component', owner: DOCUMENT_ID, scope: 'document' }, 0, []);
}

/** Whether a compound may match the document's own html or body, which hold no classes or ids. */
const mayMatchDocument = (c: ParsedCompound, tag: 'html' | 'body'): boolean => (c.tag === null || c.tag === tag) && c.classes.length === 0 && c.ids.length === 0;

/**
 * Refuses a selector that tests whether a list holds rows, or what a row's text holds, which a phone's rows and the build's one
 * template answer differently: :empty on a list's parent or on a row's element that holds a row's text, or :has() (on any subject)
 * whose argument may match an element of a row and may reach one from its subject: down from a list's parent or an ancestor, or,
 * through + or ~, from beside one of those. A :has() on a row's element that only descends stays in that row.
 */
function checkRowCount(parsed: MarklessStyleInput, rules: readonly ParsedRule[]): void {
  const byId = new Map(parsed.nodes.map((n) => [n.id, n] as const));
  const above = new Set<string | null>();
  for (const r of parsed.repeats ?? []) {
    for (let at: string | null = r.parent; ; at = byId.get(at)?.parent ?? null) {
      above.add(at);
      if (at === null) break;
    }
  }
  const elements = parsed.nodes.filter((n): n is InputElement => n.kind === 'element');
  const rowTexts = new Set(parsed.nodes.filter((n) => n.kind === 'text' && n.row !== undefined).map((n) => n.parent));
  const holders = new Set<string | null>([...(parsed.repeats ?? []).map((r) => r.parent), ...rowTexts]);
  const beside = new Set(elements.filter((n) => above.has(n.parent)).map((n) => n.id));
  // null is the document's body, which holds every list; html is above it.
  const reaches = (c: Subject, ids: ReadonlySet<string | null>, document: boolean): string[] => [...elements.filter((n) => ids.has(n.id) && c.every((x) => mayMatch(x, n))).map((n) => n.id), ...(document && c.every((x) => mayMatchDocument(x, 'body')) ? ['body'] : []), ...(document && c.every((x) => mayMatchDocument(x, 'html')) ? ['html'] : [])];
  const rowElements = elements.filter((n) => n.row !== undefined);
  const counted = (sel: ParsedSelector, host: Subject | null, negated = false): string[] => {
    const at = subjectAt(sel, host, negated);
    return sel.parts.flatMap((p, i) => p.compound.pseudos.flatMap((ps) => {
      if (ps.kind === 'empty') return reaches(at(i), holders, holders.has(null));
      if (ps.kind === 'nth') return (ps.of ?? []).flatMap((s) => counted(s, at(i)));
      if (ps.kind === 'is' || ps.kind === 'not') return ps.selectors.flatMap((s) => counted(s, at(i), ps.kind === 'not'));
      if (ps.kind === 'has') {
        return ps.selectors.flatMap((s) => {
          const row = s.parts.some((q) => rowElements.some((n) => mayMatch(q.compound, n)));
          const sideways = s.anchor === '+' || s.anchor === '~' || s.parts.some((q) => q.combinator === '+' || q.combinator === '~');
          return [...(row ? [...reaches(at(i), above, true), ...(sideways ? reaches(at(i), beside, false) : [])] : []), ...counted(s, null)];
        });
      }
      return [];
    }));
  };
  for (const rule of rules) {
    if (rule.declarations.length === 0) continue;
    const ids = [...new Set(rule.selectors.filter((sel) => !sel.dropped).flatMap((sel) => counted(sel, null)))];
    if (ids.length > 0) fail(`a selector tests whether a list holds rows from ${ids.join(', ')} (:empty, or :has() reaching a row); a style that depends on how many rows a list has, or on a row's text, is not supported yet`);
  }
}

/** Each combination of the values of the states each row of `repeat` holds for itself. */
function rowStateCombinations(parsed: MarklessStyleInput, repeat: string): Record<string, StateValue>[] {
  return parsed.states.filter((st) => st.row === repeat).reduce<Record<string, StateValue>[]>((acc, st) => acc.flatMap((c) => st.domain.map((v) => ({ ...c, [st.cell]: v }))), [{}]);
}

/**
 * A phone copies a row's template, so every row must be styled as the template is, whatever its position and the other rows, and a
 * row's own state must change only its own row. Refuses a selector that tests a row's position (checkRowPositions), and a style
 * that follows another row: the page compiled with each list's rows written out at each combination of their own states, each
 * twice, must style each row as the template at those states. Refuses a node outside the rows whose style follows a row's own
 * state (`:has()`), a style that follows how many rows a list holds (checkRowCount), and a row's text that the build transforms.
 */
function checkRows(parsed: MarklessStyleInput, inputPath: string, exported: NativeStyleExport, mainStyles: NativeStyles, compiled: object, fonts: readonly MarklessFontFile[], mode: MarklessFonts, at: MarklessAtSize | undefined): void {
  const rules = inputRules(parsed);
  checkRowPositions(parsed, rules);
  const mainIds = dragonNodeIds(parsed);
  // The build lays out a text transformed (resolve.ts transformRun); a phone gets a row's text as typed.
  const bands = nativeBands(compiled);
  for (let band = 0; band < (bands === null ? 1 : bands.table.bands.length); band++) {
    for (const c of compiledCases(compiled)) {
      const transforms = resolvedTextTransforms(compiled, c.assignment, band);
      if (transforms === null) return fail(`a case of ${parsed.component} did not resolve in band ${band}`);
      for (const n of parsed.nodes) {
        if (n.kind !== 'text' || n.row === undefined) continue;
        const transform = transforms.get(mainIds.get(n.parent) as string);
        if (transform !== undefined && transform !== 'none') fail(`${n.id}: a row's text with text-transform: ${transform}${bands === null ? '' : ` (under ${bands.conditions[band] ?? `band ${band}`})`} is not supported yet; a phone lays out the text it is given`);
      }
    }
  }
  const rowStates = new Set(parsed.states.filter((st) => st.row !== undefined).map((st) => st.cell));
  const rowsOf = new Map((parsed.repeats ?? []).map((r) => {
    const combos = rowStateCombinations(parsed, r.id);
    return [r.id, [...combos, ...combos].map((states, k): MarklessRow => ({ key: `r${k}`, states, texts: new Map() }))] as const;
  }));
  const written = marklessWithRows(parsed, rowsOf);
  const writtenStyles = compileMarkless(written, JSON.stringify(written), inputPath, fonts, mode, at).styles;
  const writtenIds = dragonNodeIds(written);
  const mainKey = cellKey(parsed);
  const writtenKey = cellKey(written);
  // Each box's layout style and paint writes in the program's assignment whose page states are `page`, by Dragon id.
  const lookOf = (styles: NativeStyles, t: NativeStyleTarget, rekey: (k: string) => string, wanted: Readonly<Record<string, unknown>>): Map<string, string> | null => {
    const o = styles.targets[t];
    if (o === undefined || o.kind !== 'emitted') return null;
    const sp = o.program;
    const i = sp.assignments.findIndex((a) => {
      const values = Object.fromEntries(Object.entries(valuesOf(a.assignment)).map(([k, v]) => [rekey(k), v]));
      return Object.entries(wanted).every(([k, v]) => values[k] === v);
    });
    if (i < 0) return null;
    const out = new Map<string, string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) {
        for (const item of v) walk(item);
        return;
      }
      if (v === null || typeof v !== 'object') return;
      const box = v as Record<string, unknown>;
      if (typeof box['id'] === 'string' && box['style'] !== undefined) out.set(box['id'], JSON.stringify(box['style']));
      for (const [k, child] of Object.entries(box)) if (k !== 'style') walk(child);
    };
    walk((sp.variants[(sp.deltas[i] as { readonly variant: number }).variant] as { readonly root: unknown }).root);
    for (const n of programAt(sp, i).nodes) out.set(n.id, `${out.get(n.id) ?? ''}${JSON.stringify(n.writes)}`);
    return out;
  };
  // A box outside the rows keeps its own style and writes at every row state; its frame may move as rows change size, and the rows layout places it again on the phone.
  const outside = parsed.nodes.filter((n) => n.row === undefined && n.kind === 'element').map((n) => mainIds.get(n.id) as string);
  for (const t of Object.keys(exported.targets) as NativeStyleTarget[]) {
    const o = mainStyles.targets[t];
    if (o === undefined || o.kind !== 'emitted') continue;
    const byPage = new Map<string, Map<string, string>>();
    for (const a of o.program.assignments) {
      const values = Object.fromEntries(Object.entries(valuesOf(a.assignment)).map(([k, v]) => [mainKey(k), v]));
      const look = lookOf(mainStyles, t, mainKey, values);
      if (look === null) continue;
      const page = JSON.stringify(Object.entries(values).filter(([k]) => !rowStates.has(k)).sort());
      const first = byPage.get(page);
      if (first === undefined) {
        byPage.set(page, look);
        continue;
      }
      for (const id of ['html', 'body', ...outside]) if (first.has(id) && look.has(id) && first.get(id) !== look.get(id)) fail(`${t}: ${id} is outside the rows, and its style follows a row's own state; a phone styles each row by itself`);
    }
  }
  for (const t of Object.keys(exported.targets) as NativeStyleTarget[]) {
    const o = mainStyles.targets[t];
    if (o === undefined || o.kind !== 'emitted') continue;
    for (const a of o.program.assignments) {
      const values = Object.fromEntries(Object.entries(valuesOf(a.assignment)).map(([k, v]) => [mainKey(k), v]));
      const template = lookOf(mainStyles, t, mainKey, values);
      const copies = lookOf(writtenStyles, t, writtenKey, Object.fromEntries(Object.entries(values).filter(([k]) => !rowStates.has(k))));
      if (template === null || copies === null) continue;
      for (const [list, rows] of rowsOf) {
        for (const row of rows.filter((r) => Object.entries(r.states).every(([k, v]) => values[k] === v))) {
          for (const n of parsed.nodes) {
            if (n.row !== list || n.kind !== 'element') continue;
            const own = template.get(mainIds.get(n.id) as string);
            const copy = copies.get(writtenIds.get(`${n.id}@${row.key}`) as string);
            if (own !== undefined && copy !== undefined && copy !== own) fail(`${t}: ${n.id} is styled differently in row ${row.key} of the ${rows.length} written out than alone at its states ${JSON.stringify(row.states)}; a style that depends on a row's position or on another row (:first-child, :nth-child, +, ~, :has() across rows) is not supported yet`);
          }
        }
      }
    }
  }
  checkRowCount(parsed, rules);
}

type UsedScheme = { readonly colorScheme: 'light' | 'dark'; readonly canvas: Rgba8 };

/**
 * An assignment of a Markless export: also the colour of the canvas, which the host paints behind the page and the system bars,
 * the colour body paints in its own box (its frame) when html's background is the canvas, else null, and the root's used colour
 * scheme, whose UA colours the nodes' writes already carry.
 */
export type MarklessExportAssignment = ExportAssignment & { readonly canvas: Rgba8; readonly bodyBackground: Rgba8 | null; readonly colorScheme: 'light' | 'dark' };
/** `fontMode`: how the export resolved fonts, which the comparisons draw Chrome's text with. */
export type MarklessStyleExport = Omit<NativeStyleExport, 'targets'> & {
  readonly fontMode: MarklessFonts;
  /** Only for an input with slots: its slots, in the order runMarklessLayout's `slots` gives their values; the export is laid out at each one's initial value. */
  readonly slots?: readonly MarklessSlot[];
  readonly targets: { readonly [T in NativeStyleTarget]?: Omit<ExportTarget, 'assignments'> & { readonly assignments: readonly MarklessExportAssignment[] } };
};

const isRgba8 = (v: unknown): v is Rgba8 => isRecord(v) && Object.keys(v).sort().join() === 'alpha,b,g,r' && ['r', 'g', 'b', 'alpha'].every((k) => Number.isInteger(v[k]) && (v[k] as number) >= 0 && (v[k] as number) <= 255);

/** Refuses, naming the field, an export without the font mode and each assignment's canvas, body background and colour scheme. */
export function checkMarklessExport(exported: NativeStyleExport): MarklessStyleExport {
  const o = exported as unknown as Record<string, unknown>;
  if (o['fontMode'] !== 'system' && o['fontMode'] !== 'pinned') throw new Error(`the export's fontMode ${JSON.stringify(o['fontMode'] ?? null)} is neither system nor pinned`);
  for (const [t, x] of Object.entries(exported.targets)) {
    const states = (x?.interaction?.levels ?? []).flatMap((l, i) => l.states.map((a, k) => [`${i} interaction state ${k}`, a] as const));
    for (const [i, a] of [...(x?.assignments ?? []).entries(), ...states]) {
      const p = a as unknown as Record<string, unknown>;
      if (!isRgba8(p['canvas'])) throw new Error(`${t} assignment ${i}: canvas ${JSON.stringify(p['canvas'] ?? null)} is not a colour`);
      if (p['bodyBackground'] !== null && !isRgba8(p['bodyBackground'])) throw new Error(`${t} assignment ${i}: bodyBackground ${JSON.stringify(p['bodyBackground'])} is not a colour or null`);
      if (p['colorScheme'] !== 'light' && p['colorScheme'] !== 'dark') throw new Error(`${t} assignment ${i}: colorScheme ${JSON.stringify(p['colorScheme'] ?? null)} is neither light nor dark`);
    }
  }
  return exported as unknown as MarklessStyleExport;
}

const backgroundOf = (nodes: readonly ExportNode[], id: string): Rgba8 => {
  const color = nodes.find((n) => n.id === id)?.writes.find((w) => w['kind'] === 'background-color')?.['color'];
  if (!isRecord(color) || !['r', 'g', 'b', 'alpha'].every((k) => typeof color[k] === 'number')) fail(`the export has no background colour for ${id}`);
  return color as Rgba8;
};

/** The writes html and body may carry: the hosts draw the canvas and body's background, and no border, image or effect of either. */
const ROOT_WRITES: ReadonlySet<string> = new Set(['background-color', 'border-widths', 'border-styles', 'border-colors']);

/**
 * The hosts draw a pre-composited group without cc's per-tile fold, so the export holds only groups cc never folds on any tiling:
 * no box of it one draw op (a lone fill, a lone border, or a member's outline ring; text never folds, and a group's own outline lies in
 * its box's item).
 */
function checkHostGroups(nodes: readonly ExportNode[], where: string): void {
  const kids = new Map<string, ExportNode[]>();
  for (const n of nodes) if (n.parent !== null) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const ops = (n: ExportNode): number => {
    const fill = n.writes.some((w) => w['kind'] === 'background-color' && isRecord(w['color']) && (w['color'] as Rgba8).alpha > 0) ? 1 : 0;
    const styles = n.writes.find((w) => w['kind'] === 'border-styles')?.['styles'];
    const widths = n.borderWidths === null ? [0, 0, 0, 0] : [n.borderWidths.top, n.borderWidths.right, n.borderWidths.bottom, n.borderWidths.left];
    const sides = widths.filter((w, k) => (w ?? 0) > 0 && Array.isArray(styles) && styles[k] !== 'none' && styles[k] !== 'hidden').length;
    return fill + (sides === 4 ? 1 : sides);
  };
  for (const g of nodes) {
    if (!g.writes.some((w) => w['kind'] === 'opacity-group' || w['kind'] === 'filter-group')) continue;
    if (ops(g) === 1) fail(`${where}: ${g.id} is a see-through group whose own box is one draw op, which cc may fold; the hosts draw no per-tile fold`);
    const visit = (n: ExportNode): void => {
      for (const c of kids.get(n.id) ?? []) {
        if (c.kind !== 'text' && (ops(c) === 1 || c.writes.some((w) => w['kind'] === 'outline'))) fail(`${where}: ${c.id} inside the see-through group ${g.id} is one draw op, which cc may fold; the hosts draw no per-tile fold`);
        visit(c);
      }
    };
    visit(g);
  }
}

function checkRootPaint(nodes: readonly ExportNode[], id: string, where: string): void {
  const node = nodes.find((n) => n.id === id);
  for (const w of node?.writes ?? []) {
    if (!ROOT_WRITES.has(w['kind'] as string)) fail(`${where}: ${id} has a ${String(w['kind'])} write, which the hosts do not draw on ${id}`);
  }
  if (Object.values(node?.borderWidths ?? {}).some((v) => v !== 0)) fail(`${where}: ${id} has a border, which the hosts do not draw on ${id}`);
}

type Bands = NonNullable<NativeStyleExport['targets']['ios']>['bands'];

/** The colour scheme whose readings make a band's atoms true; a band no scheme reaches, or another feature, is refused. */
export function schemeOf(bands: Bands, band: number): 'light' | 'dark' {
  const want = bands?.bands[band];
  if (bands === undefined || want === undefined) throw new Error(`no band ${band}`);
  const truth = (dark: boolean): boolean[] => bands.atoms.map((a) => {
    const atom = a as { feature: string; comparisons: readonly unknown[]; keyword: string };
    if (atom.feature !== 'prefers-color-scheme' || atom.comparisons.length > 0) throw new Error(`the comparison reads prefers-color-scheme only, not ${atom.feature}`);
    return atom.keyword === 'any' || (atom.keyword === 'dark') === dark;
  });
  for (const scheme of ['light', 'dark'] as const) if (truth(scheme === 'dark').every((v, i) => v === want[i])) return scheme;
  throw new Error(`no colour scheme reaches band ${band}`);
}

/** The colour scheme an assignment's band reads, or null for a band of another media feature. */
function bandScheme(bands: Bands, band: unknown): 'light' | 'dark' | null {
  if (typeof band !== 'number') return 'light';
  return bands !== undefined && bands.atoms.every((a) => (a as { feature: string }).feature === 'prefers-color-scheme') ? schemeOf(bands, band) : null;
}

/** Skia's src-over of a colour onto an opaque pixel, as Chrome rasterises a background fill (textDecoration.blendOver). */
const over = (dst: Rgba8, src: Rgba8): Rgba8 => {
  if (src.alpha === 255) return src;
  const p = textDecoration.blendOver({ r: dst.r, g: dst.g, b: dst.b, a: 255 }, { r: src.r, g: src.g, b: src.b, a: src.alpha }, 256);
  return { r: p.r, g: p.g, b: p.b, alpha: 255 };
};

/**
 * The root background blended into the opaque base colour, as Chrome combines them into one fill: each channel
 * (base·(255 − a) + colour·a) / 255 rounded to nearest, Chrome 145's pixel for 744 measured colours over both bases (alpha 0.01 to 0.99).
 */
const onBase = (base: Rgba8, src: Rgba8): Rgba8 => {
  const mix = (d: number, s: number): number => Math.round((d * (255 - src.alpha) + s * src.alpha) / 255);
  return { r: mix(base.r, src.r), g: mix(base.g, src.g), b: mix(base.b, src.b), alpha: 255 };
};

/**
 * The canvas colour Chrome paints (css-backgrounds-3 §2.11.2): html's background, else body's (propagated, so body's box paints
 * none), drawn over the base background of a top-level page, Chrome's Canvas colour in the root's used scheme (white, or
 * rgb(18, 18, 18) under dark). When html has its own background, body keeps its own for its box, which lies on the canvas; that
 * box's colour is given composited, as Chrome shows it.
 */
function rootPaint(nodes: readonly ExportNode[], where: string, band: 'light' | 'dark' | null, used: UsedScheme): { readonly canvas: Rgba8; readonly bodyBackground: Rgba8 | null } {
  checkRootPaint(nodes, 'html', where);
  checkRootPaint(nodes, 'body', where);
  checkHostGroups(nodes, where);
  const html = backgroundOf(nodes, 'html');
  const body = backgroundOf(nodes, 'body');
  // Owner ruling: a light page keeps the white base in a dark band, where Chrome 145 uses rgb(18, 18, 18), so see-through is refused there.
  const seeThrough = (html.alpha === 0 ? body : html).alpha;
  if (used.colorScheme === 'light' && band !== 'light' && seeThrough !== 0 && seeThrough !== 255) fail(`${where}: the page background is see-through in a ${band === 'dark' ? 'dark-mode band' : 'band of another media feature'}, where Chrome's base colour under it is not known to be white`);
  if (html.alpha === 0) return { canvas: onBase(used.canvas, body), bodyBackground: null };
  const canvas = onBase(used.canvas, html);
  return { canvas, bodyBackground: body.alpha === 0 ? null : over(canvas, body) };
}
