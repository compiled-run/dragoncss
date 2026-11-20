// Exports the Markless counter's style as data for the Markless native-contract proof: Dragon's lowered per-backend writes for
// every node and the box frames the reference engine lays out at each proof device's viewport and DPR.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The proof devices: the iPhone 17 simulator's safe-area width in points, and the Pixel 7 emulator's width in whole dp (Chrome viewports are integers; the device is 411.43 dp) at 420 dpi. */
export const DEVICES = {
  ios: { backend: 'uikit', viewport: { width: 402, height: 778 }, dpr: 3 },
  android: { backend: 'android-views', viewport: { width: 411, height: 818 }, dpr: 2.625 },
} as const;

const html = readFileSync(new URL('../counter.html', import.meta.url), 'utf8');
const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG }, fonts: FONT_REFERENCE_MAP }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: 'ua-default', foldViewport: ENVIRONMENT.viewport, nativeRealFaces: true, interactionLanes: true });
const compiled = project.compile(withFontMapAssets(fixtureToInput('markless-counter', html), FONT_REFERENCE_MAP));
const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
if (!compiled.ok || errors.length > 0) throw new Error(`the counter does not compile: ${errors.map((d) => d.code).join(', ')}`);
const programs = nativePrograms(compiled, []);
if (programs.kind !== 'ready') throw new Error(`no native programs: ${programs.reason}`);

const fontDir = repoPath('vendor/fonts');
const faceFiles = new Map<string, string>();
const walk = (dir: string, rel: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`, `${rel}${e.name}/`);
    else if (/\.(ttf|otf)$/.test(e.name)) faceFiles.set(`sha256:${createHash('sha256').update(readFileSync(`${dir}/${e.name}`)).digest('hex')}`, `${rel}${e.name}`);
  }
};
walk(fontDir, '');

const styles = new Map<string, LayoutBox['style']>();
const collect = (b: LayoutBox): void => {
  styles.set(b.id, b.style);
  for (const c of (b as { children?: readonly unknown[] }).children ?? []) if (c !== null && typeof c === 'object' && 'style' in c && 'id' in c) collect(c as LayoutBox);
};

const faces = new Set<string>();
const targets = Object.fromEntries(Object.entries(DEVICES).map(([target, d]) => {
  const program = programs.programs[d.backend];
  collect(program.root);
  const boxes = new Map(engineBoxes(program, d.viewport, d.dpr).map((b) => [b.id, b]));
  const px = (v: number): number => v / LU_PER_PX;
  const nodes = program.nodes.map((n) => {
    const box = boxes.get(n.id);
    const style = styles.get(n.id);
    for (const w of n.writes) if (w.kind === 'font') faces.add(w.font.family);
    return {
      id: n.id, parent: n.parent, kind: n.kind, native: n.native, text: n.text,
      frame: box === undefined ? null : { x: px(box.x), y: px(box.y), width: px(box.width), height: px(box.height) },
      borderWidths: style === undefined ? null : Object.fromEntries(Object.entries(resolveBorder(style, d.dpr)).map(([k, v]) => [k, px(v) * d.dpr])),
      writes: n.writes.map(({ css: _css, detail: _detail, technique: _technique, ...w }) => w),
    };
  });
  return [target, { backend: d.backend, viewport: d.viewport, dpr: d.dpr, nodes }];
}));

const out = {
  schema: 'dragon.native-style-export/0',
  units: 'device px; frames relative to the parent box',
  compiler: compiled.digest,
  source: 'examples/markless-counter/counter.html',
  warnings: compiled.diagnostics.filter((d) => d.severity !== 'error').map((d) => ({ code: d.code, message: d.message })),
  fonts: [...faces].sort().map((id) => {
    const file = faceFiles.get(id);
    if (file === undefined) throw new Error(`face ${id} is not a vendored font`);
    return { id, file: `vendor/fonts/${file}` };
  }),
  targets,
};
mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../out/counter.native-style.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote out/counter.native-style.json: ${out.fonts.length} faces, ${Object.keys(targets).length} targets`);
