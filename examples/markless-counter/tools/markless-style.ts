// Turns a Markless component's style input (markless.native-style-input/0, written by @markless/mobile from its compiler's
// facts) into dragon.native-style-export/1: per proof device, one complete node list per combination of the states that
// decide a class, with the transition table. Each combination is compiled by Dragon as its own element tree.
// Usage: node --conditions=dragon-internal examples/markless-counter/tools/markless-style.ts <input.json> <output.json>
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../../../packages/dragon/src/internal.ts';
import { LU_PER_PX, resolveBorder } from '../../../packages/layout/src/index.ts';
import type { LayoutBox } from '../../../packages/layout/src/index.ts';
import { FONT_REFERENCE_MAP } from '../../../packages/parity/src/font-reference.ts';
import { withFontMapAssets } from '../../../packages/parity/src/fixture-groups/fonts.ts';
import { fixtureToInput, PROJECT_ID } from '../../../packages/parity/src/fixture-reader.ts';
import { ENVIRONMENT } from '../../../packages/parity/src/fixtures.ts';
import { REFERENCE_PLATFORM } from '../../../packages/parity/src/platform.ts';
import { NATIVE_CONFIG } from '../../../packages/parity/src/native-compile.ts';
import { engineBoxes } from '../../../packages/parity/src/native-host.ts';
import { repoPath } from '../../../packages/parity/src/paths.ts';
import { DEVICES } from './devices.ts';

type Value = boolean;
type StyleInput = {
  readonly version: 'markless.native-style-input/0';
  readonly component: string;
  readonly css: string;
  readonly states: readonly { readonly cell: string; readonly domain: readonly Value[]; readonly initial: Value }[];
  readonly nodes: readonly (
    | { kind: 'element'; id: string; element: string; parent: string | null; attributes: Record<string, string>; classByState?: { when: Record<string, Value>; value: string | null }[]; arm?: unknown; row?: unknown }
    | { kind: 'text'; id: string; parent: string; text: string; arm?: unknown; row?: unknown }
  )[];
};

/** The document a detached component is laid out in: no body margin, and the pinned sans face as the initial font. */
const DOCUMENT_CSS = 'body { margin: 0; font-family: sans-serif; }';

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text: string): string => escapeHtml(text).replace(/"/g, '&quot;');

export function readStyleInput(path: string): StyleInput {
  const input = JSON.parse(readFileSync(path, 'utf8')) as StyleInput;
  if (input.version !== 'markless.native-style-input/0') throw new Error(`${path} is not markless.native-style-input/0`);
  for (const node of input.nodes) if (node.arm !== undefined || node.row !== undefined) throw new Error(`${node.id}: styles inside @if arms and @for rows are not exported yet`);
  for (const state of input.states) if (state.domain.length !== 2 || state.domain[0] !== false || state.domain[1] !== true) throw new Error(`${state.cell}: only boolean states are exported`);
  return input;
}

/** Every combination of the input's states, in the order Markless enumerates them (the first state varies slowest). */
export function combinations(input: StyleInput): Record<string, Value>[] {
  return input.states.reduce<Record<string, Value>[]>((all, state) => all.flatMap((partial) => state.domain.map((value) => ({ ...partial, [state.cell]: value }))), [{}]);
}

/** The component's element tree under one combination, as the HTML Dragon's fixture reader takes (ids as data-dragon-id). */
export function documentHtml(input: StyleInput, when: Record<string, Value>): string {
  const children = new Map<string | null, StyleInput['nodes'][number][]>();
  for (const node of input.nodes) children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  const render = (node: StyleInput['nodes'][number]): string => {
    if (node.kind === 'text') return escapeHtml(node.text);
    const variant = node.classByState?.find((entry) => Object.entries(entry.when).every(([cell, value]) => when[cell] === value));
    const classes = node.classByState ? variant?.value ?? null : node.attributes['class'] ?? null;
    const attributes = Object.entries(node.attributes).filter(([name]) => name !== 'class' && !name.startsWith('aria-') && name !== 'title');
    const open = [`<${node.element} data-dragon-id="${escapeAttribute(node.id)}"`, ...(classes ? [`class="${escapeAttribute(classes)}"`] : []), ...attributes.map(([name, value]) => `${name}="${escapeAttribute(value)}"`)].join(' ');
    return `${open}>${(children.get(node.id) ?? []).map(render).join('')}</${node.element}>`;
  };
  return `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${DOCUMENT_CSS}\n${input.css}\n</style>\n</head>\n<body data-dragon-id="body">${(children.get(null) ?? []).map(render).join('')}</body>\n</html>\n`;
}

function faceFiles(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${rel}${entry.name}/`);
      else if (entry.name.endsWith('.ttf') || entry.name.endsWith('.otf')) out.set(`sha256:${createHash('sha256').update(readFileSync(`${dir}/${entry.name}`)).digest('hex')}`, `vendor/fonts/${rel}${entry.name}`);
    }
  };
  walk(repoPath('vendor/fonts'), '');
  return out;
}

export function exportStyles(input: StyleInput, source: string): unknown {
  const combos = combinations(input);
  const faces = new Set<string>();
  const warnings = new Map<string, string>();
  const digests: string[] = [];
  const perCombo = combos.map((when) => {
    const html = documentHtml(input, when);
    const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG }, fonts: FONT_REFERENCE_MAP }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ua-default', foldViewport: ENVIRONMENT.viewport, nativeRealFaces: true, interactionLanes: true });
    const compiled = project.compile(withFontMapAssets(fixtureToInput(`markless-${input.component}`, html), FONT_REFERENCE_MAP));
    const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
    if (!compiled.ok || errors.length > 0) throw new Error(`${input.component} ${JSON.stringify(when)} does not compile: ${errors.map((d) => `${d.code} ${d.message}`).join('; ')}`);
    for (const d of compiled.diagnostics) warnings.set(`${d.code} ${d.message}`, d.code);
    digests.push(compiled.digest);
    const programs = nativePrograms(compiled, []);
    if (programs.kind !== 'ready') throw new Error(`no native programs: ${programs.reason}`);
    return { when, programs };
  });
  const targets = Object.fromEntries(Object.entries(DEVICES).map(([target, device]) => {
    const assignments = perCombo.map(({ when, programs }) => {
      const program = programs.programs[device.backend];
      const styles = new Map<string, LayoutBox['style']>();
      const collect = (box: LayoutBox): void => {
        styles.set(box.id, box.style);
        for (const child of (box as { children?: readonly unknown[] }).children ?? []) if (child !== null && typeof child === 'object' && 'style' in child && 'id' in child) collect(child as LayoutBox);
      };
      collect(program.root);
      const boxes = new Map(engineBoxes(program, device.viewport, device.dpr).map((box) => [box.id, box]));
      const px = (v: number): number => v / LU_PER_PX;
      return {
        values: when,
        nodes: program.nodes.map((n) => {
          const box = boxes.get(n.id);
          const style = styles.get(n.id);
          for (const w of n.writes) if (w.kind === 'font') faces.add(w.font.family);
          return {
            id: n.id, parent: n.parent, kind: n.kind, native: n.native, text: n.text,
            frame: box === undefined ? null : { x: px(box.x), y: px(box.y), width: px(box.width), height: px(box.height) },
            borderWidths: style === undefined ? null : Object.fromEntries(Object.entries(resolveBorder(style, device.dpr)).map(([k, v]) => [k, px(v) * device.dpr])),
            writes: n.writes.map(({ css: _css, detail: _detail, technique: _technique, ...w }) => w),
          };
        }),
      };
    });
    const indexOf = (values: Record<string, Value>): number => assignments.findIndex((a) => input.states.every((s) => a.values[s.cell] === values[s.cell]));
    const initial = indexOf(Object.fromEntries(input.states.map((s) => [s.cell, s.initial])));
    const next = assignments.map((a) => input.states.map((s) => s.domain.map((v) => indexOf({ ...a.values, [s.cell]: v }))));
    return [target, { backend: device.backend, viewport: device.viewport, dpr: device.dpr, states: input.states.map((s) => ({ key: s.cell, domain: s.domain })), initial, assignments, next }];
  }));
  const files = faceFiles();
  return {
    schema: 'dragon.native-style-export/1',
    units: 'frames and borderWidths in device px, frames relative to the parent box; lengths inside writes in CSS px',
    compiler: createHash('sha256').update(digests.join('\n')).digest('hex'),
    component: input.component,
    source,
    warnings: [...warnings].map(([text, code]) => ({ code, message: text.slice(code.length + 1) })),
    fonts: [...faces].sort().map((id) => {
      const file = files.get(id);
      if (file === undefined) throw new Error(`face ${id} is not a vendored font`);
      return { id, file };
    }),
    targets,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('usage: markless-style.ts <input.json> <output.json>');
  const out = exportStyles(readStyleInput(inputPath), inputPath.split('/').slice(-2).join('/'));
  writeFileSync(outputPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${outputPath}`);
}
