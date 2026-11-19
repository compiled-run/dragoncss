// A Markless component's style input (markless.native-style-input/0, written by @markless/mobile's nativeStyleInput from its
// compiler's facts) as Dragon's FrontEndResult, and its dragon.native-style-export/1 through compileNativeStyles
// (docs/markless-native-styles.md "From a Markless style input"). The input carries no spans into the .tsrx, so every origin is
// the span of the input file itself; its CSS is its own source, whole.
import { createHash } from 'node:crypto';
import type { ClassSymbol, Condition, FrontEndResult, NativeStyles, NativeStylesConfig, NativeStyleTarget, Rgba8, SourceFile, TreeNode } from 'dragon';
import { BAND_KEY, compileNativeStyles, isTreeNodeId, TREE_SCHEMA_REVISION } from 'dragon';
import { FONT_REFERENCE_MAP } from './font-reference.ts';
import { withFontMapAssets } from './fixture-groups/fonts.ts';
import { DOCUMENT_ID, PROJECT_ID } from './fixture-reader.ts';
import type { ExportAssignment, ExportNode, ExportTarget, NativeStyleExport } from './native-style-export.ts';
import { EXPORT_DEVICES, exportBands, nativeStyleExport } from './native-style-export.ts';
import { isWhitespaceText, rehostAddress, textAddresser } from './node-ids.ts';

export const MARKLESS_STYLE_INPUT_VERSION = 'markless.native-style-input/0';

type When = Readonly<Record<string, boolean>>;
export type MarklessStyleInput = {
  readonly version: typeof MARKLESS_STYLE_INPUT_VERSION;
  readonly component: string;
  readonly nodes: readonly (
    | { readonly kind: 'element'; readonly id: string; readonly element: string; readonly parent: string | null; readonly attributes: Readonly<Record<string, string>>; readonly classByState?: readonly { readonly when: When; readonly value: string | null }[]; readonly attributesByState?: Readonly<Record<string, readonly { readonly when: When; readonly value: string | null }[]>>; readonly arm?: unknown }
    | { readonly kind: 'text'; readonly id: string; readonly parent: string; readonly text: string; readonly arm?: unknown }
  )[];
  readonly css: string;
  readonly states: readonly { readonly cell: string; readonly domain: readonly [false, true]; readonly initial: boolean }[];
};

/** The document a detached component is laid out in, as Chrome renders it for the comparison: no body margin, the pinned sans face. */
export const MARKLESS_DOCUMENT_CSS = 'body { margin: 0; font-family: sans-serif; }';

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
  onlyKeys('the input', o, ['version', 'component', 'nodes', 'css', 'states']);
  if (!isString(o['component']) || !/^[A-Z][A-Za-z0-9]*$/.test(o['component'])) fail(`component ${JSON.stringify(o['component'])} is not an identifier starting with an ASCII capital`);
  if (!isString(o['css'])) fail('css is not a string');
  if (!Array.isArray(o['states'])) fail('states is not a list');
  const cells = new Set<string>();
  for (const s of o['states'] as unknown[]) {
    if (!isRecord(s) || !isString(s['cell']) || typeof s['initial'] !== 'boolean') fail(`bad state ${JSON.stringify(s)}`);
    const st = s as Record<string, unknown>;
    onlyKeys(`state ${String(st['cell'])}`, st, ['cell', 'domain', 'initial']);
    if (!Array.isArray(st['domain']) || st['domain'].length !== 2 || st['domain'][0] !== false || st['domain'][1] !== true) fail(`${String(st['cell'])}: only boolean states are supported`);
    if (cells.has(st['cell'] as string)) fail(`state ${String(st['cell'])} is listed twice`);
    cells.add(st['cell'] as string);
  }
  if (!Array.isArray(o['nodes'])) fail('nodes is not a list');
  const ids = new Set<string>();
  for (const n of o['nodes'] as unknown[]) {
    if (!isRecord(n) || !isString(n['id']) || n['id'] === '') fail(`bad node ${JSON.stringify(n)}`);
    const node = n as Record<string, unknown>;
    const id = node['id'] as string;
    if (ids.has(id)) fail(`node ${id} is listed twice`);
    if (DOCUMENT_NODES.includes(id)) fail(`${id}: html and body are the export's own document nodes`);
    if (node['arm'] !== undefined || node['row'] !== undefined) fail(`${id}: styles inside @if arms and @for rows are not supported yet`);
    if (node['kind'] === 'text') {
      onlyKeys(id, node, ['kind', 'id', 'parent', 'text']);
      if (!isString(node['parent']) || !ids.has(node['parent'])) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isString(node['text'])) fail(`${id}: text is not a string`);
    } else if (node['kind'] === 'element') {
      onlyKeys(id, node, ['kind', 'id', 'element', 'parent', 'attributes', 'classByState', 'attributesByState']);
      if (!isString(node['element']) || !/^[a-z][a-z0-9-]*$/.test(node['element'])) fail(`${id}: bad element name ${JSON.stringify(node['element'])}`);
      if (node['parent'] !== null && !(isString(node['parent']) && ids.has(node['parent']))) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isRecord(node['attributes']) || !Object.values(node['attributes']).every(isString)) fail(`${id}: attributes are not strings`);
      const checkByState = (what: string, byState: unknown): void => {
        if (!Array.isArray(byState)) fail(`${id}: ${what} is not a list`);
        for (const e of byState as unknown[]) {
          if (!isRecord(e) || !(e['value'] === null || isString(e['value'])) || !isRecord(e['when'])) fail(`${id}: bad ${what} entry ${JSON.stringify(e)}`);
          onlyKeys(`${id}: a ${what} entry`, e as Record<string, unknown>, ['when', 'value']);
          const when = (e as Record<string, unknown>)['when'] as Record<string, unknown>;
          for (const [cell, value] of Object.entries(when)) if (!cells.has(cell) || typeof value !== 'boolean') fail(`${id}: ${what} names ${cell}, which is not a boolean state`);
        }
      };
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

/** Every combination of the input's states, each as its value per cell, in the input's order. */
export const stateCombinations = (input: MarklessStyleInput): Record<string, boolean>[] =>
  input.states.reduce<Record<string, boolean>[]>((all, s) => all.flatMap((p) => s.domain.map((value) => ({ ...p, [s.cell]: value }))), [{}]);

/** The input's state for a cell, named s<k> in Dragon (a cell id such as "state:liked" is not a state identifier). */
const stateIds = (input: MarklessStyleInput): Map<string, string> => new Map(input.states.map((s, k) => [s.cell, `s${k}`]));

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

/**
 * The input's id of a node named by Dragon's address rule (node-ids.ts) under elements named elementId(id): an element's text child
 * is its input text node, and any other node keeps its suffix after its element's input id ("m0::before" to "component-edge:0::before").
 */
export function marklessNodeId(input: MarklessStyleInput, elementId: (id: string) => string): (address: string) => string {
  const textOf = new Map<string, string>();
  const elementOf = new Map<string, string>();
  for (const e of input.nodes) {
    if (e.kind !== 'element') continue;
    elementOf.set(elementId(e.id), e.id);
    const address = textAddresser(elementId(e.id));
    for (const c of input.nodes) if (c.kind === 'text' && c.parent === e.id) textOf.set(address(c.text), c.id);
  }
  return (address) => textOf.get(address) ?? rehostAddress(address, (tree) => elementOf.get(tree));
}

export function marklessFrontEnd(input: MarklessStyleInput, inputText: string, inputPath: string): FrontEndResult {
  const dragonId = dragonNodeIds(input);
  const file = (name: string, text: string): SourceFile => ({ ref: { uri: `dragon-source://${PROJECT_ID}/markless/${input.component}/${name}`, revision: 'markless', hash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}` }, text, displayPath: name === 'input.json' ? inputPath : `${inputPath}#${name}` });
  const src = file('input.json', inputText);
  const css = file('component.css', input.css);
  const doc = file('document.css', MARKLESS_DOCUMENT_CSS);
  const origin = { kind: 'authored' as const, span: { source: src.ref, start: 0, end: inputText.length } };
  const states = stateIds(input);
  const combos = stateCombinations(input);
  const eq = (cell: string, value: boolean): Condition => ({ kind: 'eq', ref: { instance: '.', state: states.get(cell) as string }, value });
  const all = (when: When): Condition => {
    const terms = Object.entries(when).map(([cell, value]) => eq(cell, value));
    return terms.length === 1 ? (terms[0] as Condition) : { kind: 'and', values: terms };
  };
  const symbol = (name: string): ClassSymbol => ({ owner: DOCUMENT_ID, sheet: 'component', name });
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const node = (n: MarklessStyleInput['nodes'][number]): TreeNode => {
    if (n.kind === 'text') return { kind: 'text', id: dragonId.get(n.id) as string, text: n.text, origin } as TreeNode;
    type ByState = readonly { readonly when: When; readonly value: string | null }[];
    // One entry per combination of the states, so each value's condition is exactly the combinations that carry it.
    const entriesOf = (what: string, byState: ByState): ByState => {
      const entries = combos.map((c) => {
        const found = byState.filter((e) => Object.keys(e.when).length === Object.keys(c).length && Object.entries(e.when).every(([cell, v]) => c[cell] === v));
        if (found.length !== 1) fail(`${n.id}: ${what} has ${found.length} entries for ${JSON.stringify(c)}`);
        return found[0] as ByState[number];
      });
      if (byState.length !== combos.length) fail(`${n.id}: ${what} has ${byState.length} entries for ${combos.length} combinations`);
      return entries;
    };
    let classes: { value: { when: Condition; value: ClassSymbol | null }[]; origin: typeof origin }[];
    if (n.classByState === undefined) classes = classTokens(n.attributes['class'] ?? '').map((t) => ({ value: [{ when: { kind: 'true' }, value: symbol(t) }], origin }));
    else {
      const byState = n.classByState;
      const entryOf = entriesOf('classByState', byState);
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
        // An attribute that follows state: each distinct value (null: absent) holds in exactly the combinations that give it.
        ...Object.entries(n.attributesByState ?? {}).map(([name, byState]) => {
          const entryOf = entriesOf(`attributesByState.${name}`, byState);
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
    snapshot: { projectId: PROJECT_ID, revision: 'markless', sources: [src, css, doc], assets: [], resolutions: [] },
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
        { id: 'document', css: { source: doc.ref, start: 0, end: MARKLESS_DOCUMENT_CSS.length }, scope: { kind: 'document' } },
        { id: 'component', css: { source: css.ref, start: 0, end: input.css.length }, scope: { kind: 'document' } },
      ],
    },
    completeness: 'closed-application',
  } as unknown as FrontEndResult;
}

/** The input compiled as the device lanes compile (support 'lanes', the pinned font map); a compile error is refused. */
function compileMarkless(parsed: MarklessStyleInput, inputText: string, inputPath: string): { readonly input: FrontEndResult; readonly styles: NativeStyles } {
  const input = withFontMapAssets(marklessFrontEnd(parsed, inputText, inputPath), FONT_REFERENCE_MAP);
  const config: NativeStylesConfig = { projectId: PROJECT_ID, name: parsed.component, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, fonts: FONT_REFERENCE_MAP, viewport: EXPORT_DEVICES.ios.viewport, support: 'lanes' };
  const styles = compileNativeStyles(config, input);
  const errors = styles.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) fail(`${parsed.component} does not compile:\n${errors.map((d) => `  ${d.code} [${d.target ?? 'all'}] ${d.message}`).join('\n')}`);
  return { input, styles };
}

/** Dragon keys a state "<instance>#s<k>"; the hosts know the cell. */
function cellKey(parsed: MarklessStyleInput): (key: string) => string {
  const cellOf = new Map(parsed.states.map((s, k) => [`s${k}`, s.cell]));
  return (key) => {
    if (key === BAND_KEY) return key;
    const cell = cellOf.get(key.slice(key.lastIndexOf('#') + 1));
    if (cell === undefined) fail(`Dragon's state ${key} is not one of the input's`);
    return cell as string;
  };
}

/** What the input compiles to per target, keyed as the export keys it: the states and the @media bands. */
export type MarklessCompiledTarget = Pick<ExportTarget, 'states' | 'bands'>;

export function marklessCompiledTargets(parsed: MarklessStyleInput): { readonly [T in NativeStyleTarget]?: MarklessCompiledTarget } {
  const { styles } = compileMarkless(parsed, JSON.stringify(parsed), `${parsed.component}.native-style-input.json`);
  const rekey = cellKey(parsed);
  const out: { [T in NativeStyleTarget]?: MarklessCompiledTarget } = {};
  for (const [t, o] of Object.entries(styles.targets) as [NativeStyleTarget, (typeof styles.targets)[NativeStyleTarget]][]) {
    if (o === undefined) continue;
    if (o.kind !== 'emitted') return fail(`${t} is blocked: ${o.reason}`);
    out[t] = {
      states: o.program.states.map((s) => ({ key: rekey(s.key), domain: s.domain })),
      ...exportBands(o),
    };
  }
  return out;
}

/** The input compiled as the device lanes compile, exported with the cells' own keys. */
export function marklessStyleExport(inputText: string, inputPath: string): { readonly input: FrontEndResult; readonly exported: MarklessStyleExport } {
  const parsed = parseMarklessStyleInput(inputText);
  const { input, styles } = compileMarkless(parsed, inputText, inputPath);
  const raw = nativeStyleExport(styles, parsed.component, inputPath);
  const dragonIds = dragonNodeIds(parsed);
  const rename = marklessNodeId(parsed, (id) => dragonIds.get(id) as string);
  const exported: NativeStyleExport = {
    ...raw,
    targets: Object.fromEntries(Object.entries(raw.targets).map(([t, x]) => [t, {
      ...x,
      assignments: x.assignments.map((a) => ({ ...a, nodes: a.nodes.map((n) => ({ ...n, id: rename(n.id), parent: n.parent === null ? null : rename(n.parent) })) })),
    }])),
  };
  for (const [t, x] of Object.entries(exported.targets)) for (const a of x.assignments) {
    const have = new Set(a.nodes.map((n) => n.id));
    if (have.size !== a.nodes.length) fail(`${t}: the export names ${a.nodes.length - have.size} node(s) by an id another node has`);
    const missing = parsed.nodes.filter((n) => !have.has(n.id) && !(n.kind === 'text' && isWhitespaceText(n.text))).map((n) => n.id);
    if (missing.length > 0) fail(`${t}: the export has no node ${missing.join(', ')} of the input`);
  }
  const rekey = cellKey(parsed);
  const targets = Object.fromEntries(Object.entries(exported.targets).map(([t, x]) => [t, {
    ...x,
    states: x.states.map((s) => ({ ...s, key: rekey(s.key) })),
    assignments: x.assignments.map((a, i) => ({
      ...a,
      values: Object.fromEntries(Object.entries(a.values).map(([k, v]) => [rekey(k), v])),
      canvas: canvasOf(a.nodes, `${t} assignment ${i}`),
    })),
  }]));
  return { input, exported: { ...exported, targets } };
}

/** An assignment of a Markless export: also the colour of the canvas, which the host paints behind the page and the system bars. */
export type MarklessExportAssignment = ExportAssignment & { readonly canvas: Rgba8 };
export type MarklessStyleExport = Omit<NativeStyleExport, 'targets'> & {
  readonly targets: { readonly [T in NativeStyleTarget]?: Omit<ExportTarget, 'assignments'> & { readonly assignments: readonly MarklessExportAssignment[] } };
};

const backgroundOf = (nodes: readonly ExportNode[], id: string): Rgba8 => {
  const color = nodes.find((n) => n.id === id)?.writes.find((w) => w['kind'] === 'background-color')?.['color'];
  if (!isRecord(color) || !['r', 'g', 'b', 'alpha'].every((k) => typeof color[k] === 'number')) fail(`the export has no background colour for ${id}`);
  return color as Rgba8;
};

/**
 * The canvas colour Chrome paints (css-backgrounds-3 §2.11.2): html's background, else body's, else white. The hosts paint no html
 * or body box, so a background body keeps for its own box (under an html background) and a translucent canvas are refused.
 */
function canvasOf(nodes: readonly ExportNode[], where: string): Rgba8 {
  const html = backgroundOf(nodes, 'html');
  const body = backgroundOf(nodes, 'body');
  if (html.alpha !== 0 && body.alpha !== 0) fail(`${where}: body has its own background under html's, and the export draws no body box`);
  const canvas = html.alpha !== 0 ? html : body.alpha !== 0 ? body : { r: 255, g: 255, b: 255, alpha: 255 };
  if (canvas.alpha !== 255) fail(`${where}: the canvas background is translucent, which the export does not blend over white yet`);
  return canvas;
}
