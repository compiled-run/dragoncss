// A Markless component's style input (markless.native-style-input/0, written by @markless/mobile's nativeStyleInput from its
// compiler's facts) as Dragon's FrontEndResult, and its dragon.native-style-export/1 through compileNativeStyles
// (docs/markless-native-styles.md "From a Markless style input"). The input carries no spans into the .tsrx, so every origin is
// the span of the input file itself; its CSS is its own source, whole.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import type { BrotliDecompress, ClassSymbol, Condition, FontMap, FrontEndResult, NativeStylesConfig, NativeStyleTarget, Rgba8, SourceFile, TreeNode } from 'dragon';
import { BAND_KEY, compileNativeStyles, decodeFontFile, TREE_SCHEMA_REVISION } from 'dragon';
import { textDecoration } from '@dragon/layout';
import { FONT_REFERENCE_MAP } from './font-reference.ts';
import { withFontMapAssets } from './fixture-groups/fonts.ts';
import { DOCUMENT_ID, PROJECT_ID } from './fixture-reader.ts';
import type { ExportAssignment, ExportDevice, ExportNode, ExportTarget, NativeStyleExport } from './native-style-export.ts';
import { EXPORT_DEVICES, nativeStyleExport } from './native-style-export.ts';
import { systemFontsFor } from './system-fonts/provider.ts';

export const MARKLESS_STYLE_INPUT_VERSION = 'markless.native-style-input/0';

/** A state's value: true or false, or one of the strings a cell can hold (a tab's selected value). */
export type StateValue = boolean | string;
type When = Readonly<Record<string, StateValue>>;
export type MarklessStyleInput = {
  readonly version: typeof MARKLESS_STYLE_INPUT_VERSION;
  readonly component: string;
  readonly nodes: readonly (
    | { readonly kind: 'element'; readonly id: string; readonly element: string; readonly parent: string | null; readonly attributes: Readonly<Record<string, string>>; readonly classByState?: readonly { readonly when: When; readonly value: string | null }[]; readonly attributesByState?: Readonly<Record<string, readonly { readonly when: When; readonly value: string | null }[]>>; readonly boxless?: true; readonly arm?: unknown }
    | { readonly kind: 'text'; readonly id: string; readonly parent: string; readonly text: string; readonly textByState?: readonly { readonly when: When; readonly value: string }[]; readonly arm?: unknown }
  )[];
  readonly css: string;
  readonly states: readonly { readonly cell: string; readonly domain: readonly StateValue[]; readonly initial: StateValue }[];
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

const fail = (what: string): never => {
  throw new Error(`markless style input: ${what}`);
};
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

/** Checks every field the conversion reads; anything else in the input is refused rather than ignored. */
export function parseMarklessStyleInput(text: string): MarklessStyleInput {
  const v: unknown = JSON.parse(text);
  if (!isRecord(v) || v['version'] !== MARKLESS_STYLE_INPUT_VERSION) fail(`not ${MARKLESS_STYLE_INPUT_VERSION}`);
  const o = v as Record<string, unknown>;
  if (!isString(o['component']) || !/^[A-Z][A-Za-z0-9]*$/.test(o['component'])) fail(`component ${JSON.stringify(o['component'])} is not an identifier starting with an ASCII capital`);
  if (!isString(o['css'])) fail('css is not a string');
  if (!Array.isArray(o['states'])) fail('states is not a list');
  const cells = new Map<string, readonly StateValue[]>();
  for (const s of o['states'] as unknown[]) {
    if (!isRecord(s) || !isString(s['cell'])) fail(`bad state ${JSON.stringify(s)}`);
    const st = s as Record<string, unknown>;
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
  if (!Array.isArray(o['nodes'])) fail('nodes is not a list');
  const ids = new Set<string>();
  for (const n of o['nodes'] as unknown[]) {
    if (!isRecord(n) || !isString(n['id']) || n['id'] === '') fail(`bad node ${JSON.stringify(n)}`);
    const node = n as Record<string, unknown>;
    const id = node['id'] as string;
    if (ids.has(id)) fail(`node ${id} is listed twice`);
    if (node['arm'] !== undefined || node['row'] !== undefined) fail(`${id}: styles inside @if arms and @for rows are not supported yet`);
    const checkByState = (what: string, byState: unknown): void => {
      if (!Array.isArray(byState)) fail(`${id}: ${what} is not a list`);
      for (const e of byState as unknown[]) {
        if (!isRecord(e) || !(e['value'] === null || isString(e['value'])) || !isRecord(e['when'])) fail(`${id}: bad ${what} entry ${JSON.stringify(e)}`);
        const when = (e as Record<string, unknown>)['when'] as Record<string, unknown>;
        for (const [cell, value] of Object.entries(when)) if (!(cells.get(cell) ?? []).includes(value as StateValue)) fail(`${id}: ${what} names ${cell}=${JSON.stringify(value)}, which is not a state and one of its values`);
      }
    };
    if (node['kind'] === 'text') {
      if (!isString(node['parent']) || !ids.has(node['parent'])) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isString(node['text'])) fail(`${id}: text is not a string`);
      if (node['textByState'] !== undefined) {
        checkByState('textByState', node['textByState']);
        if (!(node['textByState'] as unknown[]).every((e) => isString((e as Record<string, unknown>)['value']))) fail(`${id}: textByState gives a text that is not a string`);
      }
    } else if (node['kind'] === 'element') {
      if (!isString(node['element']) || !/^[a-z][a-z0-9-]*$/.test(node['element'])) fail(`${id}: bad element name ${JSON.stringify(node['element'])}`);
      if (node['parent'] !== null && !(isString(node['parent']) && ids.has(node['parent']))) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isRecord(node['attributes']) || !Object.values(node['attributes']).every(isString)) fail(`${id}: attributes are not strings`);
      if (node['boxless'] !== undefined && node['boxless'] !== true) fail(`${id}: boxless is true or absent`);
      if (MARKLESS_BOXLESS_ATTRIBUTE in (node['attributes'] as Record<string, unknown>)) fail(`${id}: ${MARKLESS_BOXLESS_ATTRIBUTE} is Dragon's own attribute`);
      if (node['classByState'] !== undefined) checkByState('classByState', node['classByState']);
      const attributesByState = node['attributesByState'];
      if (attributesByState !== undefined) {
        if (!isRecord(attributesByState)) fail(`${id}: attributesByState is not an object`);
        for (const [name, byState] of Object.entries(attributesByState as Record<string, unknown>)) {
          if (name === 'class' || !/^[a-z][a-z0-9-]*$/.test(name)) fail(`${id}: attributesByState names ${JSON.stringify(name)}, which is not a non-class attribute name`);
          if (name in (node['attributes'] as Record<string, unknown>)) fail(`${id}: ${name} is both a fixed attribute and an attribute by state`);
          checkByState(`attributesByState.${name}`, byState);
        }
      }
    } else fail(`${id}: kind ${JSON.stringify(node['kind'])} is neither element nor text`);
    ids.add(id);
  }
  return v as MarklessStyleInput;
}


/** HTML's class attribute: a set of tokens separated by ASCII whitespace. */
const classTokens = (value: string): string[] => value.split(/[\t\n\f\r ]+/).filter((t) => t !== '');

/** The input's state for a cell, named s<k> in Dragon (a cell id such as "state:liked" is not a state identifier). */
const stateIds = (input: MarklessStyleInput): Map<string, string> => new Map(input.states.map((s, k) => [s.cell, `s${k}`]));

/**
 * Dragon's own id for each element of the input: the input's id where Dragon accepts it, else `m<k>` (Markless names a
 * component's nodes by their path, `component-edge:0/h0`, and Dragon's ids hold no "/" or ":").
 */
export function dragonElementIds(input: MarklessStyleInput): Map<string, string> {
  const elements = input.nodes.filter((n) => n.kind === 'element');
  const taken = new Set(elements.map((n) => n.id));
  const out = new Map<string, string>();
  let k = 0;
  for (const n of elements) {
    if (!n.id.includes('/') && !n.id.includes(':')) {
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

export function marklessFrontEnd(input: MarklessStyleInput, inputText: string, inputPath: string, fonts: readonly MarklessFontFile[] = [], mode: MarklessFonts = 'pinned'): FrontEndResult {
  const unread = (input.fonts ?? []).filter((f) => !fonts.some((r) => r.url === f.url && r.file === f.file));
  if (unread.length > 0) fail(`the font file ${unread.map((f) => f.file).join(', ')} was not read`);
  const dragonId = dragonElementIds(input);
  const file = (name: string, text: string): SourceFile => ({ ref: { uri: `dragon-source://${PROJECT_ID}/markless/${input.component}/${name}`, revision: 'markless', hash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}` }, text, displayPath: name === 'input.json' ? inputPath : `${inputPath}#${name}` });
  const src = file('input.json', inputText);
  const css = file('component.css', input.css);
  const documentCss = marklessDocumentCss(input, mode);
  const doc = file('document.css', documentCss);
  const origin = { kind: 'authored' as const, span: { source: src.ref, start: 0, end: inputText.length } };
  const states = stateIds(input);
  const combos = input.states.reduce<Record<string, StateValue>[]>((all, s) => all.flatMap((p) => s.domain.map((value) => ({ ...p, [s.cell]: value }))), [{}]);
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
    // Dragon names a text node "<parent>:text<k>" itself, as Markless does; marklessStyleExport checks the two agree.
    type ByState = readonly { readonly when: When; readonly value: string | null }[];
    if (n.kind === 'text') {
      const at = input.nodes.indexOf(n);
      if (n.textByState === undefined) return { kind: 'text', id: `t${at}`, text: n.text, origin } as TreeNode;
      // A text that follows state: one arm per distinct string, each holding exactly the combinations that give it, so every
      // assignment lays out the string it shows.
      const entryOf = entriesOf(n.id, 'textByState', n.textByState);
      const values = [...new Set(entryOf.map((e) => e.value as string))];
      const arm = (k: number): TreeNode => {
        const text = { kind: 'text', id: `t${at}v${k}`, text: values[k] as string, origin } as TreeNode;
        if (k === values.length - 1) return text;
        const on = entryOf.filter((e) => e.value === values[k]);
        const when: Condition = on.length === 1 ? all((on[0] as ByState[number]).when) : { kind: 'or', values: on.map((e) => all(e.when)) };
        return { kind: 'branch', id: `b${at}v${k}`, when, then: [text], else: [arm(k + 1)], origin } as TreeNode;
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
        // The host shows a <dialog> with showModal(), which sets open: the export lays it out shown (topLayer 'host').
        ...(n.element === 'dialog' && !('open' in n.attributes) ? [{ name: 'open', value: [{ when: { kind: 'true' }, value: '' }], origin }] : []),
        ...(n.boxless === true ? [{ name: MARKLESS_BOXLESS_ATTRIBUTE, value: [{ when: { kind: 'true' }, value: '' }], origin }] : []),
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
      children: (children.get(n.id) ?? []).map(node),
      origin,
    } as TreeNode;
  };
  const body = { kind: 'element', id: 'body', tag: 'body', classes: [], attributes: [], children: (children.get(null) ?? []).map(node), origin } as TreeNode;
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
        states: input.states.map((s) => ({ id: states.get(s.cell) as string, domain: [...s.domain], initial: s.initial, origin })),
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

/**
 * The input compiled as the device lanes compile (support 'lanes'), exported with the cells' own keys: with system fonts each
 * target measures its platform's own fonts at build time; pinned, the stated reference's font map.
 * `decoded`: the sfnt of each WOFF or WOFF2 author font, by its path relative to the input (DECODED_FONTS_DIR), which the export
 * lists with `from: 'input'` and the caller writes there.
 */
export function marklessStyleExport(inputText: string, inputPath: string, readFont?: (file: string) => Uint8Array, mode: MarklessFonts = 'pinned', at?: { readonly [T in NativeStyleTarget]: ExportDevice }, plan = false): { readonly input: FrontEndResult; readonly exported: MarklessStyleExport; readonly decoded: readonly { readonly file: string; readonly bytes: Uint8Array }[] } {
  const parsed = parseMarklessStyleInput(inputText);
  if ((parsed.fonts ?? []).length > 0 && readFont === undefined) fail('the input names font files, and no reader for them was given');
  const fonts = readFont === undefined ? [] : marklessFontFiles(parsed, readFont);
  const map = mode === 'system' ? MARKLESS_SYSTEM_FONT_MAP : FONT_REFERENCE_MAP;
  const input = withFontMapAssets(marklessFrontEnd(parsed, inputText, inputPath, fonts, mode), map);
  const devices = at !== undefined ? at : parsed.viewports === undefined ? EXPORT_DEVICES : { ios: { ...EXPORT_DEVICES.ios, viewport: parsed.viewports.ios }, android: { ...EXPORT_DEVICES.android, viewport: parsed.viewports.android } };
  const config: NativeStylesConfig = { projectId: PROJECT_ID, name: parsed.component, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, fonts: map, viewport: devices.ios.viewport, support: 'lanes', topLayer: 'host', canvas: 'host', output: 'program', brotliDecompress: NODE_BROTLI, ...(mode === 'system' ? { systemFonts: 'measured' as const } : {}) };
  const styles = compileNativeStyles(config, input);
  const errors = styles.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) fail(`${parsed.component} does not compile:\n${errors.map((d) => `  ${d.code} [${d.target ?? 'all'}] ${d.message}`).join('\n')}`);
  const raw = nativeStyleExport(styles, parsed.component, inputPath, devices, fonts.map((f) => ({ id: f.id, file: f.sfntFile, bytes: f.sfnt })), mode === 'system' ? systemFontsFor : null, plan);
  // Back to the input's ids: an element by its own, a text node "<element>:text<k>" by its element's.
  const marklessId = new Map([...dragonElementIds(parsed)].map(([m, d]): [string, string] => [d, m]));
  const dragonIds = dragonElementIds(parsed);
  const textOf = new Map<string, string>(parsed.nodes.filter((n) => n.kind === 'element').flatMap((n) => {
    const texts = parsed.nodes.filter((c) => c.kind === 'text' && c.parent === n.id);
    return texts.map((c, k): [string, string] => [`${dragonIds.get(n.id) as string}:text${k}`, c.id]);
  }));
  // A <dialog>'s ::backdrop box is named after its dialog: "<input id>::backdrop".
  const backdropOf = new Map([...marklessId].map(([d, m]): [string, string] => [`${d}::backdrop`, `${m}::backdrop`]));
  const rename = (id: string): string => marklessId.get(id) ?? textOf.get(id) ?? backdropOf.get(id) ?? id;
  const exported: NativeStyleExport = {
    ...raw,
    targets: Object.fromEntries(Object.entries(raw.targets).map(([t, x]) => [t, {
      ...x,
      assignments: x.assignments.map((a) => ({ ...a, nodes: a.nodes.map((n) => ({ ...n, id: rename(n.id), parent: n.parent === null ? null : rename(n.parent) })) })),
      // The plan lays out Dragon's own ids; a host names the geometry it returns with the input's.
      ...(x.plan === undefined ? {} : { planNames: [...new Set(x.assignments.flatMap((a) => a.nodes.map((n) => n.id)))].filter((id) => rename(id) !== id).map((id) => [id, rename(id)] as const) }),
    }])),
  };
  // An element display: none leaves (with everything inside it) has no box in that assignment: the export names it with no frame,
  // so a host hides its view there instead of keeping another assignment's box. Any other missing node is an error.
  const boxless = (a: ExportAssignment): ExportAssignment => {
    const have = new Set(a.nodes.map((n) => n.id));
    const none = new Set<string>();
    const added = parsed.nodes.flatMap((n): ExportNode[] => {
      if (have.has(n.id)) return [];
      const own = n.kind === 'element' && n.attributesByState?.['hidden'] !== undefined;
      if (!own && !none.has(n.parent ?? '')) return [];
      none.add(n.id);
      return [{ id: n.id, parent: n.parent, kind: n.kind, native: n.kind === 'text' ? 'DragonTextView' : 'DragonBoxView', text: n.kind === 'text' ? n.text : null, frame: null, borderWidths: null, writes: [] }];
    });
    return { ...a, nodes: [...a.nodes, ...added] };
  };
  for (const x of Object.values(exported.targets)) (x as { assignments: unknown }).assignments = x.assignments.map(boxless);
  for (const [t, x] of Object.entries(exported.targets)) for (const a of x.assignments) {
    const have = new Set(a.nodes.map((n) => n.id));
    const boxless = (n: MarklessStyleInput['nodes'][number]): boolean => n.kind === 'element' && n.boxless === true;
    const boxed = parsed.nodes.filter((n) => boxless(n) && have.has(n.id)).map((n) => n.id);
    if (boxed.length > 0) fail(`${t}: ${boxed.join(', ')} must generate no box (an ancestor in the markup, there for selectors and inheritance), but the CSS gives it a display other than contents`);
    const missing = parsed.nodes.filter((n) => !boxless(n) && !have.has(n.id)).map((n) => n.id);
    if (missing.length > 0) fail(`${t}: the export has no node ${missing.join(', ')} of the input`);
  }
  // Dragon keys a state "<instance>#s<k>"; the hosts know the cell.
  const cellOf = new Map(parsed.states.map((s, k) => [`s${k}`, s.cell]));
  const rekey = (key: string): string => {
    if (key === BAND_KEY) return key;
    const state = key.slice(key.lastIndexOf('#') + 1);
    const cell = cellOf.get(state);
    if (cell === undefined) fail(`Dragon's state ${key} is not one of the input's`);
    return cell as string;
  };
  const targets = Object.fromEntries(Object.entries(exported.targets).map(([t, x]) => {
    const out = styles.targets[t as NativeStyleTarget];
    if (out?.kind !== 'emitted' || out.schemes.length !== x.assignments.length) fail(`${t}: the compile gives no colour scheme for each assignment`);
    const schemes = (out as Extract<typeof out, { kind: 'emitted' }>).schemes;
    return [t, {
      ...x,
      states: x.states.map((s) => ({ ...s, key: rekey(s.key) })),
      assignments: x.assignments.map((a, i) => ({
        ...a,
        values: Object.fromEntries(Object.entries(a.values).map(([k, v]) => [rekey(k), v])),
        colorScheme: (schemes[i] as UsedScheme).colorScheme,
        ...rootPaint(a.nodes, `${t} assignment ${i}`, bandScheme(x.bands, a.values[BAND_KEY]), schemes[i] as UsedScheme),
      })),
    }];
  }));
  const decoded = [...new Map(fonts.filter((f) => f.sfntFile !== f.file).map((f) => [f.sfntFile, { file: f.sfntFile, bytes: f.sfnt }])).values()];
  return { input, exported: { ...exported, targets }, decoded };
}

type UsedScheme = { readonly colorScheme: 'light' | 'dark'; readonly canvas: Rgba8 };

/**
 * An assignment of a Markless export: also the colour of the canvas, which the host paints behind the page and the system bars,
 * the colour body paints in its own box (its frame) when html's background is the canvas, else null, and the root's used colour
 * scheme, whose UA colours the nodes' writes already carry.
 */
export type MarklessExportAssignment = ExportAssignment & { readonly canvas: Rgba8; readonly bodyBackground: Rgba8 | null; readonly colorScheme: 'light' | 'dark' };
export type MarklessStyleExport = Omit<NativeStyleExport, 'targets'> & {
  readonly targets: { readonly [T in NativeStyleTarget]?: Omit<ExportTarget, 'assignments'> & { readonly assignments: readonly MarklessExportAssignment[] } };
};

const backgroundOf = (nodes: readonly ExportNode[], id: string): Rgba8 => {
  const color = nodes.find((n) => n.id === id)?.writes.find((w) => w['kind'] === 'background-color')?.['color'];
  if (!isRecord(color) || !['r', 'g', 'b', 'alpha'].every((k) => typeof color[k] === 'number')) fail(`the export has no background colour for ${id}`);
  return color as Rgba8;
};

/** The writes html and body may carry: the hosts draw the canvas and body's background, and no border, image or effect of either. */
const ROOT_WRITES: ReadonlySet<string> = new Set(['background-color', 'border-widths', 'border-styles', 'border-colors']);

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
 * The canvas colour Chrome paints (css-backgrounds-3 §2.11.2): html's background, else body's (propagated, so body's box paints
 * none), drawn over the base background of a top-level page, Chrome's Canvas colour in the root's used scheme (white, or
 * rgb(18, 18, 18) under dark). When html has its own background, body keeps its own for its box, which lies on the canvas; that
 * box's colour is given composited, as Chrome shows it.
 */
function rootPaint(nodes: readonly ExportNode[], where: string, band: 'light' | 'dark' | null, used: UsedScheme): { readonly canvas: Rgba8; readonly bodyBackground: Rgba8 | null } {
  checkRootPaint(nodes, 'html', where);
  checkRootPaint(nodes, 'body', where);
  const html = backgroundOf(nodes, 'html');
  const body = backgroundOf(nodes, 'body');
  // Owner ruling: a light page keeps the white base in a dark band, where Chrome 145 uses rgb(18, 18, 18), so see-through is refused there.
  const seeThrough = (html.alpha === 0 ? body : html).alpha;
  if (used.colorScheme === 'light' && band !== 'light' && seeThrough !== 0 && seeThrough !== 255) fail(`${where}: the page background is see-through in a ${band === 'dark' ? 'dark-mode band' : 'band of another media feature'}, where Chrome's base colour under it is not known to be white`);
  if (html.alpha === 0) return { canvas: over(used.canvas, body), bodyBackground: null };
  const canvas = over(used.canvas, html);
  return { canvas, bodyBackground: body.alpha === 0 ? null : over(canvas, body) };
}
