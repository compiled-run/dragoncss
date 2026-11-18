// A Markless component's style input (markless.native-style-input/0, written by @markless/mobile's nativeStyleInput from its
// compiler's facts) as Dragon's FrontEndResult, and its dragon.native-style-export/1 through compileNativeStyles
// (docs/markless-native-styles.md "From a Markless style input"). The input carries no spans into the .tsrx, so every origin is
// the span of the input file itself; its CSS is its own source, whole.
import { createHash } from 'node:crypto';
import type { ClassSymbol, Condition, FrontEndResult, NativeStylesConfig, NativeStyleTarget, Rgba8, SourceFile, TreeNode } from 'dragon';
import { BAND_KEY, compileNativeStyles, TREE_SCHEMA_REVISION } from 'dragon';
import { FONT_REFERENCE_MAP } from './font-reference.ts';
import { withFontMapAssets } from './fixture-groups/fonts.ts';
import { DOCUMENT_ID, PROJECT_ID } from './fixture-reader.ts';
import type { ExportAssignment, ExportNode, ExportTarget, NativeStyleExport } from './native-style-export.ts';
import { EXPORT_DEVICES, nativeStyleExport } from './native-style-export.ts';

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
  /**
   * The CSS size each target lays this tree out in, when it is not the page: a system sheet's content area at one resting
   * height, measured on the device by the host that presents it. Absent: the export devices' page viewports.
   */
  readonly viewports?: { readonly [T in NativeStyleTarget]: { readonly width: number; readonly height: number } };
};

/** The document a detached component is laid out in, as Chrome renders it for the comparison: no body margin, the pinned sans face. */
export const MARKLESS_DOCUMENT_CSS = 'body { margin: 0; font-family: sans-serif; }';

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
  const cells = new Set<string>();
  for (const s of o['states'] as unknown[]) {
    if (!isRecord(s) || !isString(s['cell']) || typeof s['initial'] !== 'boolean') fail(`bad state ${JSON.stringify(s)}`);
    const st = s as Record<string, unknown>;
    if (!Array.isArray(st['domain']) || st['domain'].length !== 2 || st['domain'][0] !== false || st['domain'][1] !== true) fail(`${String(st['cell'])}: only boolean states are supported`);
    if (cells.has(st['cell'] as string)) fail(`state ${String(st['cell'])} is listed twice`);
    cells.add(st['cell'] as string);
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
  if (!Array.isArray(o['nodes'])) fail('nodes is not a list');
  const ids = new Set<string>();
  for (const n of o['nodes'] as unknown[]) {
    if (!isRecord(n) || !isString(n['id']) || n['id'] === '') fail(`bad node ${JSON.stringify(n)}`);
    const node = n as Record<string, unknown>;
    const id = node['id'] as string;
    if (ids.has(id)) fail(`node ${id} is listed twice`);
    if (node['arm'] !== undefined || node['row'] !== undefined) fail(`${id}: styles inside @if arms and @for rows are not supported yet`);
    if (node['kind'] === 'text') {
      if (!isString(node['parent']) || !ids.has(node['parent'])) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isString(node['text'])) fail(`${id}: text is not a string`);
    } else if (node['kind'] === 'element') {
      if (!isString(node['element']) || !/^[a-z][a-z0-9-]*$/.test(node['element'])) fail(`${id}: bad element name ${JSON.stringify(node['element'])}`);
      if (node['parent'] !== null && !(isString(node['parent']) && ids.has(node['parent']))) fail(`${id}: parent ${String(node['parent'])} is not an earlier element`);
      if (!isRecord(node['attributes']) || !Object.values(node['attributes']).every(isString)) fail(`${id}: attributes are not strings`);
      const checkByState = (what: string, byState: unknown): void => {
        if (!Array.isArray(byState)) fail(`${id}: ${what} is not a list`);
        for (const e of byState as unknown[]) {
          if (!isRecord(e) || !(e['value'] === null || isString(e['value'])) || !isRecord(e['when'])) fail(`${id}: bad ${what} entry ${JSON.stringify(e)}`);
          const when = (e as Record<string, unknown>)['when'] as Record<string, unknown>;
          for (const [cell, value] of Object.entries(when)) if (!cells.has(cell) || typeof value !== 'boolean') fail(`${id}: ${what} names ${cell}, which is not a boolean state`);
        }
      };
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

export function marklessFrontEnd(input: MarklessStyleInput, inputText: string, inputPath: string): FrontEndResult {
  const dragonId = dragonElementIds(input);
  const file = (name: string, text: string): SourceFile => ({ ref: { uri: `dragon-source://${PROJECT_ID}/markless/${input.component}/${name}`, revision: 'markless', hash: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}` }, text, displayPath: name === 'input.json' ? inputPath : `${inputPath}#${name}` });
  const src = file('input.json', inputText);
  const css = file('component.css', input.css);
  const doc = file('document.css', MARKLESS_DOCUMENT_CSS);
  const origin = { kind: 'authored' as const, span: { source: src.ref, start: 0, end: inputText.length } };
  const states = stateIds(input);
  const combos = input.states.reduce<Record<string, boolean>[]>((all, s) => all.flatMap((p) => s.domain.map((value) => ({ ...p, [s.cell]: value }))), [{}]);
  const eq = (cell: string, value: boolean): Condition => ({ kind: 'eq', ref: { instance: '.', state: states.get(cell) as string }, value });
  const all = (when: When): Condition => {
    const terms = Object.entries(when).map(([cell, value]) => eq(cell, value));
    return terms.length === 1 ? (terms[0] as Condition) : { kind: 'and', values: terms };
  };
  const symbol = (name: string): ClassSymbol => ({ owner: DOCUMENT_ID, sheet: 'component', name });
  const children = new Map<string | null, MarklessStyleInput['nodes'][number][]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const node = (n: MarklessStyleInput['nodes'][number]): TreeNode => {
    // Dragon names a text node "<parent>:text<k>" itself, as Markless does; marklessStyleExport checks the two agree.
    if (n.kind === 'text') return { kind: 'text', id: `t${input.nodes.indexOf(n)}`, text: n.text, origin } as TreeNode;
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

/** The input compiled as the device lanes compile (support 'lanes', the pinned font map), exported with the cells' own keys. */
export function marklessStyleExport(inputText: string, inputPath: string): { readonly input: FrontEndResult; readonly exported: MarklessStyleExport } {
  const parsed = parseMarklessStyleInput(inputText);
  const input = withFontMapAssets(marklessFrontEnd(parsed, inputText, inputPath), FONT_REFERENCE_MAP);
  const devices = parsed.viewports === undefined ? EXPORT_DEVICES : { ios: { ...EXPORT_DEVICES.ios, viewport: parsed.viewports.ios }, android: { ...EXPORT_DEVICES.android, viewport: parsed.viewports.android } };
  const config: NativeStylesConfig = { projectId: PROJECT_ID, name: parsed.component, targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, fonts: FONT_REFERENCE_MAP, viewport: devices.ios.viewport, support: 'lanes' };
  const styles = compileNativeStyles(config, input);
  const errors = styles.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) fail(`${parsed.component} does not compile:\n${errors.map((d) => `  ${d.code} [${d.target ?? 'all'}] ${d.message}`).join('\n')}`);
  const raw = nativeStyleExport(styles, parsed.component, inputPath, devices);
  // Back to the input's ids: an element by its own, a text node "<element>:text<k>" by its element's.
  const marklessId = new Map([...dragonElementIds(parsed)].map(([m, d]): [string, string] => [d, m]));
  const dragonIds = dragonElementIds(parsed);
  const textOf = new Map<string, string>(parsed.nodes.filter((n) => n.kind === 'element').flatMap((n) => {
    const texts = parsed.nodes.filter((c) => c.kind === 'text' && c.parent === n.id);
    return texts.map((c, k): [string, string] => [`${dragonIds.get(n.id) as string}:text${k}`, c.id]);
  }));
  const rename = (id: string): string => marklessId.get(id) ?? textOf.get(id) ?? id;
  const exported: NativeStyleExport = {
    ...raw,
    targets: Object.fromEntries(Object.entries(raw.targets).map(([t, x]) => [t, {
      ...x,
      assignments: x.assignments.map((a) => ({ ...a, nodes: a.nodes.map((n) => ({ ...n, id: rename(n.id), parent: n.parent === null ? null : rename(n.parent) })) })),
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
    const missing = parsed.nodes.filter((n) => !have.has(n.id)).map((n) => n.id);
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
