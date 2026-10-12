// SELD-R2 PR 4 (notes/T064-seld-r2-spec.md R2, R14, §0.3 P1-P12): the host trace lane. Every interaction group's derived trace
// (interaction-cases.ts deriveTrace) is driven in pinned Chrome through CDP input, and after every step Chrome's :hover, :active,
// :focus and :focus-visible matches and matchMedia('(hover: hover)') are captured into packages/parity/expected-traces/. Mouse steps
// run without touch emulation and touch steps with it (P2), so Chrome's effective hover (R2: :hover and hover media) after a tap is
// empty. After every touch step the same steps on Dragon's own web output must leave every hover candidate's computed style at its
// none-state value (R2's style check, P3). The TypeScript runtime (interaction-runtime.ts) must equal the effective trace at every
// step: hover, focus and focus-visible gated; touch :active and keyboard steps recorded, not gated (P4, R10).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Browser, CDPSession, Page } from 'playwright';
import type { InteractionFaults } from '@dragon/layout';
import { rtInteraction } from '@dragon/layout';
import type { InteractionLevelInput, InteractionProgram, NativeBackend } from 'dragon';
import { LONGHANDS, webClassMap } from 'dragon';
import { CHROME_VERSION, openPage } from './chrome.ts';
import { frames } from './forced-pseudo.ts';
import type { InteractionGroup } from './interaction-cases.ts';
import { deriveTrace, groupHit, interactionGroups, interactionProgramOf, levelInputs } from './interaction-cases.ts';
import type { InteractionSnapshot, InteractionStep } from './interaction-runtime.ts';
import { InteractionRuntime } from './interaction-runtime.ts';
import type { NativeCase } from './native-host.ts';
import { BACKEND_OF } from './native-host.ts';
import { repoPath } from './paths.ts';
import { enforcedCompile, webCssOf } from './pipeline.ts';

export const TRACE_CAPTURE_VERSION = 'dragon.trace-capture/1';
export const TRACE_TARGETS = ['ios', 'android'] as const;
export type TraceTarget = (typeof TRACE_TARGETS)[number];
export type TraceContext = 'mouse' | 'touch';

export const expectedTraceDir = (): string => repoPath('packages/parity/expected-traces');
export const expectedTracePath = (groupId: string): string => `${expectedTraceDir()}/${groupId.replace(/#/g, '~')}.trace.json`;

/** Chrome after one step: the data-dragon-id elements matching each pseudo-class in document order, and the hover media. */
export type ChromeTraceStep = {
  readonly kind: InteractionStep['kind'];
  readonly context: TraceContext;
  readonly hoverMedia: boolean;
  readonly hover: readonly string[];
  readonly active: readonly string[];
  readonly focus: readonly string[];
  readonly focusVisible: readonly string[];
  /** Touch steps only: R2's style check on Dragon's web output, "<id> <property>: <value> (none state <value>)" per difference. */
  readonly style: readonly string[] | null;
};

/** One captured run: the targets whose derived steps it was taken on (stepsSha256 pins them) and Chrome's record per step. */
export type TraceRun = { readonly targets: readonly TraceTarget[]; readonly stepsSha256: string; readonly steps: readonly ChromeTraceStep[] };

export type TraceCapture = { readonly case: string; readonly chrome: string; readonly version: string; readonly viewport: { readonly width: number; readonly height: number }; readonly direction: 'ltr' | 'rtl'; readonly runs: readonly TraceRun[] };

/** What the TS check derives for a group on a target's backend: its level inputs, interaction program and trace. */
export type TraceDerivation = { readonly backend: NativeBackend; readonly inputs: readonly InteractionLevelInput[]; readonly ip: InteractionProgram; readonly steps: readonly InteractionStep[] };

export function traceDerivation(g: InteractionGroup, target: TraceTarget): TraceDerivation {
  const backend = BACKEND_OF[target];
  const inputs = levelInputs(g, backend);
  const ip = interactionProgramOf(g, backend, inputs);
  return { backend, inputs, ip, steps: deriveTrace(g, ip, inputs, backend) };
}

export const stepsSha256 = (steps: readonly InteractionStep[]): string => createHash('sha256').update(JSON.stringify(steps)).digest('hex');

const TOUCH_KINDS: ReadonlySet<string> = new Set(['touch-down', 'touch-up', 'touch-cancel']);
const MOUSE_KINDS: ReadonlySet<string> = new Set(['move', 'exit', 'exit-start', 'frame', 'mouse-down', 'mouse-up']);
const isTouch = (k: InteractionStep['kind']): boolean => TOUCH_KINDS.has(k);

/** Holds the page after a tap long enough for the gesture Chrome derives from the touch sequence to be dispatched. */
const TAP_SETTLE_MS = 100;

type Matches = { readonly hoverMedia: boolean; readonly hover: string[]; readonly active: string[]; readonly focus: string[]; readonly focusVisible: string[] };

/** Runs in the page: every data-dragon-id element matching each pseudo-class, and the hover media. */
const readMatches = (): Matches => {
  const els = Array.from(document.querySelectorAll('[data-dragon-id]'));
  const pick = (sel: string): string[] => els.filter((e) => e.matches(sel)).map((e) => e.getAttribute('data-dragon-id') as string);
  return { hoverMedia: matchMedia('(hover: hover)').matches, hover: pick(':hover'), active: pick(':active'), focus: pick(':focus'), focusVisible: pick(':focus-visible') };
};

const effectiveText = (m: Matches): string => JSON.stringify([m.hoverMedia ? m.hover : [], m.active, m.focus, m.focusVisible]);

/**
 * One page driven by CDP input. Mouse steps run without touch emulation and touch steps with it (P2); CDP mouse events are never
 * turned into touches (setEmitTouchEventsForMouse off). A forced step clears the real pointer and focus first, so Chrome forces
 * exactly the one element (RT-6(a)), and forcing none restores them; the restored effective matches must equal those before.
 */
class TraceDriver {
  private context: TraceContext = 'mouse';
  private mouse: { x: number; y: number } | null = null;
  private pressAt: { x: number; y: number } | null = null;
  private touchAt: { x: number; y: number } | null = null;
  private forcedNode: number | null = null;
  private saved: { context: TraceContext; mouse: { x: number; y: number } | null; focused: string | null; focusVisible: boolean; matches: Matches } | null = null;

  readonly page: Page;
  private readonly cdp: CDPSession;
  private readonly root: number;

  private constructor(page: Page, cdp: CDPSession, root: number) {
    this.page = page;
    this.cdp = cdp;
    this.root = root;
  }

  static async open(browser: Browser, html: string, env: NativeCase['case']['environment']): Promise<TraceDriver> {
    const page = await openPage(browser, html, env);
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      return new TraceDriver(page, cdp, root.nodeId);
    } catch (e) {
      await page.context().close();
      throw e;
    }
  }

  async close(): Promise<void> {
    await this.page.context().close();
  }

  async nodeOf(address: string): Promise<number> {
    const { nodeId } = await this.cdp.send('DOM.querySelector', { nodeId: this.root, selector: `[data-dragon-id="${address.replace(/["\\]/g, '\\$&')}"]` });
    if (nodeId === 0) throw new Error(`no element with data-dragon-id ${address}`);
    return nodeId;
  }

  private async setContext(c: TraceContext): Promise<void> {
    if (c === this.context) return;
    await this.cdp.send('Emulation.setTouchEmulationEnabled', c === 'touch' ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
    this.context = c;
    await frames(this.page);
  }

  private async mouseEvent(type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', p: { x: number; y: number }): Promise<void> {
    const pressed = type === 'mousePressed' || (type === 'mouseMoved' && this.pressAt !== null);
    await this.cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  }

  private async touchEvent(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', p: { x: number; y: number } | null): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p === null ? [] : [{ x: p.x, y: p.y, radiusX: 0, radiusY: 0, id: 0 }] });
  }

  /** Forces each address's pseudo-classes (on a reference page, which takes no input) and returns the nodes forced. */
  async forceAll(entries: readonly (readonly [string, readonly string[]])[]): Promise<number[]> {
    const nodes: number[] = [];
    for (const [address, pseudos] of entries) {
      const nodeId = await this.nodeOf(address);
      await this.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [...pseudos] });
      nodes.push(nodeId);
    }
    await frames(this.page);
    return nodes;
  }

  async unforce(nodes: readonly number[]): Promise<void> {
    for (const nodeId of nodes) await this.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  }

  async matches(): Promise<Matches> {
    return this.page.evaluate(readMatches);
  }

  /** Runs one step and returns Chrome's matches after it; a context whose hover media disagrees with it fails closed (R2). */
  async step(s: InteractionStep): Promise<{ context: TraceContext; matches: Matches }> {
    if (MOUSE_KINDS.has(s.kind)) await this.setContext('mouse');
    if (isTouch(s.kind)) await this.setContext('touch');
    switch (s.kind) {
      case 'move':
        this.mouse = { x: s.x, y: s.y };
        await this.mouseEvent('mouseMoved', this.mouse);
        break;
      case 'exit':
        // P12: a pointer outside the viewport hovers nothing.
        this.mouse = null;
        await this.mouseEvent('mouseMoved', { x: -1, y: -1 });
        break;
      case 'exit-start':
        // R15's Android hover-exit has no Chrome event: Chrome keeps hover through a press (P4).
        break;
      case 'frame':
        break;
      case 'mouse-down':
        this.mouse = { x: s.x, y: s.y };
        this.pressAt = this.mouse;
        await this.mouseEvent('mousePressed', this.pressAt);
        break;
      case 'mouse-up':
        if (this.pressAt === null) throw new Error('mouse-up without a mouse press');
        await this.mouseEvent('mouseReleased', this.pressAt);
        this.pressAt = null;
        break;
      case 'touch-down':
        this.touchAt = { x: s.x, y: s.y };
        await this.touchEvent('touchStart', this.touchAt);
        break;
      case 'touch-up':
        if (this.touchAt === null) throw new Error('touch-up without a touch press');
        if (this.touchAt.x !== s.x || this.touchAt.y !== s.y) await this.touchEvent('touchMove', { x: s.x, y: s.y });
        await this.touchEvent('touchEnd', null);
        this.touchAt = null;
        break;
      case 'touch-cancel':
        if (this.touchAt === null) throw new Error('touch-cancel without a touch press');
        await this.touchEvent('touchCancel', null);
        this.touchAt = null;
        break;
      case 'key': {
        // A keydown without ctrl, alt or meta turns focus-visible on for the focused element (P9); Shift moves nothing.
        const key = s.modified ? { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 } : { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 };
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key, modifiers: 0 });
        break;
      }
      case 'force':
        await this.force(s);
        break;
      case 'set':
        throw new Error(`the step sets app state ${s.state}: the Chrome trace has no app setter, since each app assignment is its own document`);
    }
    if (isTouch(s.kind)) await this.page.waitForTimeout(TAP_SETTLE_MS);
    await frames(this.page);
    const m = await this.matches();
    if (this.context === 'touch' && m.hoverMedia) throw new Error(`${s.kind}: (hover: hover) matches under touch emulation`);
    if (this.context === 'mouse' && !m.hoverMedia) throw new Error(`${s.kind}: (hover: hover) does not match without touch emulation`);
    return { context: this.context, matches: m };
  }

  private async force(s: InteractionStep & { kind: 'force' }): Promise<void> {
    if (this.forcedNode !== null) {
      await this.cdp.send('CSS.forcePseudoState', { nodeId: this.forcedNode, forcedPseudoClasses: [] });
      this.forcedNode = null;
    }
    if (s.pseudo === 'none') {
      const saved = this.saved;
      if (saved === null) return;
      this.saved = null;
      await this.setContext(saved.context);
      if (saved.context === 'mouse' && saved.mouse !== null) {
        this.mouse = saved.mouse;
        await this.mouseEvent('mouseMoved', saved.mouse);
      }
      if (saved.focused !== null) {
        await this.page.evaluate(([id, visible]) => {
          const el = document.querySelector(`[data-dragon-id="${CSS.escape(id)}"]`) as HTMLElement | null;
          el?.focus({ preventScroll: true, focusVisible: visible } as FocusOptions);
        }, [saved.focused, saved.focusVisible] as const);
      }
      await frames(this.page);
      const now = await this.matches();
      if (effectiveText(now) !== effectiveText(saved.matches)) throw new Error(`forcing none did not restore Chrome's matches: ${effectiveText(now)}, before forcing ${effectiveText(saved.matches)}`);
      return;
    }
    if (s.address === null) throw new Error(`force ${s.pseudo} names no element`);
    if (this.pressAt !== null || this.touchAt !== null) throw new Error(`force ${s.pseudo} during a press`);
    if (this.saved === null) {
      const matches = await this.matches();
      const focused = await this.page.evaluate(() => {
        const el = document.querySelector('[data-dragon-id]:focus');
        return el === null ? null : { id: el.getAttribute('data-dragon-id') as string, visible: el.matches(':focus-visible') };
      });
      this.saved = { context: this.context, mouse: this.mouse, focused: focused?.id ?? null, focusVisible: focused?.visible ?? false, matches };
      await this.setContext('mouse');
      // Always: a tap leaves Chrome's synthetic hover (P1), which this.mouse does not track.
      await this.mouseEvent('mouseMoved', { x: -1, y: -1 });
      this.mouse = null;
      await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
    const nodeId = await this.nodeOf(s.address);
    await this.cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [s.pseudo] });
    this.forcedNode = nodeId;
  }
}

/** Runs in the page: the computed longhands of each address. */
const readStyles = ([ids, props]: [string[], string[]]): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {};
  for (const id of ids) {
    const el = document.querySelector(`[data-dragon-id="${CSS.escape(id)}"]`);
    if (el === null) throw new Error(`no element with data-dragon-id ${id}`);
    const cs = getComputedStyle(el);
    out[id] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  }
  return out;
};

/**
 * R2's style check after a touch step: the hover candidates' computed longhands on the web output page against a reference page of
 * the same output that no pointer ever reached, with the output page's :active, :focus and :focus-visible forced on it, so the two
 * differ only by hover.
 */
async function styleCheck(output: TraceDriver, reference: TraceDriver, candidates: readonly string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const m = await output.matches();
  const byAddress = new Map<string, string[]>();
  for (const [pseudo, ids] of [['active', m.active], ['focus', m.focus], ['focus-visible', m.focusVisible]] as const) {
    for (const id of ids) byAddress.set(id, [...(byAddress.get(id) ?? []), pseudo]);
  }
  const forced = await reference.forceAll([...byAddress]);
  try {
    const props = [...LONGHANDS];
    const got = await output.page.evaluate(readStyles, [[...candidates], props] as [string[], string[]]);
    const none = await reference.page.evaluate(readStyles, [[...candidates], props] as [string[], string[]]);
    const out: string[] = [];
    for (const id of candidates) for (const p of props) {
      const a = got[id]?.[p];
      const b = none[id]?.[p];
      if (a !== b) out.push(`${id} ${p}: ${String(a)} (none state ${String(b)})`);
    }
    return out;
  } finally {
    await reference.unforce(forced);
  }
}

/** Dragon's web output of a group's case: its enforced web compile's CSS and class map. */
function webOutputHtml(g: InteractionGroup, n: NativeCase): string {
  const compiled = enforcedCompile(g.spec, g.direction);
  const css = webCssOf(compiled);
  const classOf = webClassMap(compiled, n.case.assignment);
  if (css === null || classOf === null) throw new Error(`${g.id}: the web output is not ready`);
  return n.case.compiledHtml(css, classOf);
}

/** Chrome's trace of one derivation: the authored page records the matches, the web output page takes R2's style check. */
async function captureRun(browser: Browser, g: InteractionGroup, d: TraceDerivation): Promise<ChromeTraceStep[]> {
  const app = d.ip.program.initial;
  const n = g.cases[app] as NativeCase;
  const env = n.case.environment;
  const candidates = (d.inputs[app] as InteractionLevelInput).partition.candidates.hover;
  const drivers: TraceDriver[] = [];
  try {
    const authored = await TraceDriver.open(browser, n.case.authoredHtml, env);
    drivers.push(authored);
    const html = webOutputHtml(g, n);
    const output = await TraceDriver.open(browser, html, env);
    drivers.push(output);
    const reference = await TraceDriver.open(browser, html, env);
    drivers.push(reference);
    const out: ChromeTraceStep[] = [];
    for (const [i, s] of d.steps.entries()) {
      try {
        const r = await authored.step(s);
        await output.step(s);
        const style = isTouch(s.kind) ? await styleCheck(output, reference, candidates) : null;
        out.push({ kind: s.kind, context: r.context, ...r.matches, style });
      } catch (e) {
        throw new Error(`${g.id} step ${i} (${s.kind}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out;
  } finally {
    for (const dr of drivers) await dr.close();
  }
}

/** A group's capture: one run per distinct derived trace of the native targets (usually one for both). */
export async function captureTraces(browser: Browser, g: InteractionGroup): Promise<TraceCapture> {
  const runs: { targets: TraceTarget[]; stepsSha256: string; steps: ChromeTraceStep[] }[] = [];
  for (const target of TRACE_TARGETS) {
    const d = traceDerivation(g, target);
    const sha = stepsSha256(d.steps);
    const same = runs.find((r) => r.stepsSha256 === sha);
    if (same !== undefined) {
      same.targets.push(target);
      continue;
    }
    runs.push({ targets: [target], stepsSha256: sha, steps: await captureRun(browser, g, d) });
  }
  const env = (g.cases[0] as NativeCase).case.environment;
  return { case: g.id, chrome: CHROME_VERSION, version: TRACE_CAPTURE_VERSION, viewport: env.viewport, direction: g.direction, runs };
}

/** The capture as text: one step per line. */
export function traceCaptureJson(c: TraceCapture): string {
  const runs = c.runs.map((r) => `    {\n      "targets": ${JSON.stringify(r.targets)},\n      "stepsSha256": ${JSON.stringify(r.stepsSha256)},\n      "steps": [\n${r.steps.map((s) => `        ${JSON.stringify(s)}`).join(',\n')}\n      ]\n    }`);
  const head = JSON.stringify({ case: c.case, chrome: c.chrome, version: c.version, viewport: c.viewport, direction: c.direction }, null, 2).replace(/\n}$/, ',');
  return `${head}\n  "runs": [\n${runs.join(',\n')}\n  ]\n}\n`;
}

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === 'string');
const KINDS: ReadonlySet<string> = new Set([...MOUSE_KINDS, ...TOUCH_KINDS, 'key', 'force', 'set']);

function validStep(s: unknown): s is ChromeTraceStep {
  if (typeof s !== 'object' || s === null) return false;
  const x = s as Record<string, unknown>;
  return typeof x.kind === 'string' && KINDS.has(x.kind) && (x.context === 'mouse' || x.context === 'touch') && typeof x.hoverMedia === 'boolean'
    && isStrings(x.hover) && isStrings(x.active) && isStrings(x.focus) && isStrings(x.focusVisible) && (x.style === null || isStrings(x.style))
    && (x.style === null) === !TOUCH_KINDS.has(x.kind);
}

/** The committed capture of a group; a missing or malformed file throws, naming what is wrong. */
export function committedTraces(groupId: string): TraceCapture {
  const path = expectedTracePath(groupId);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`${groupId}: no readable trace capture at ${path} (${e instanceof Error ? e.message : String(e)}); run pnpm run parity:trace-capture`);
  }
  return parseTraceCapture(groupId, text, path);
}

/** A capture's text, checked: the group, Chrome and capture version, every step's shape, and one run per native target. */
export function parseTraceCapture(groupId: string, text: string, path: string): TraceCapture {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${groupId}: the trace capture at ${path} is not JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  const c = raw as Partial<TraceCapture>;
  const targets = Array.isArray(c.runs) ? c.runs.flatMap((r) => (typeof r === 'object' && r !== null && Array.isArray(r.targets) ? r.targets : [])) : [];
  const ok = c.case === groupId && c.chrome === CHROME_VERSION && c.version === TRACE_CAPTURE_VERSION && Array.isArray(c.runs)
    && c.runs.every((r) => typeof r === 'object' && r !== null && Array.isArray(r.targets) && r.targets.length > 0 && typeof r.stepsSha256 === 'string' && Array.isArray(r.steps) && r.steps.every(validStep))
    && targets.length === TRACE_TARGETS.length && TRACE_TARGETS.every((t) => targets.includes(t));
  if (!ok) throw new Error(`${groupId}: the trace capture at ${path} is malformed, misses a target or is from another Chrome or capture version`);
  return c as TraceCapture;
}

/** One difference between the TS trace and Chrome's effective trace; gated ones fail the lane, the others are recorded (R14). */
export type TraceMismatch = { readonly group: string; readonly target: TraceTarget; readonly step: number; readonly kind: string; readonly dimension: 'hover' | 'active' | 'focus' | 'focus-visible' | 'style'; readonly gated: boolean; readonly ts: string; readonly chrome: string };

/** Whether a dimension is gated at a step kind: keyboard steps and touch :active are recorded only (P4, R10). */
export function gated(kind: InteractionStep['kind'], dimension: TraceMismatch['dimension']): boolean {
  if (kind === 'key') return false;
  return !(dimension === 'active' && isTouch(kind));
}

/** Chrome's effective matches after a step (R2): :hover counts only under (hover: hover). */
export const effective = (s: ChromeTraceStep): { hover: readonly string[]; active: readonly string[]; focus: readonly string[]; focusVisible: readonly string[] } =>
  ({ hover: s.hoverMedia ? s.hover : [], active: s.active, focus: s.focus, focusVisible: s.focusVisible });

const setText = (xs: readonly string[]): string => JSON.stringify([...xs].sort());

/**
 * The TS runtime, driven as the host check drives it, against a capture at every step of each target's run. stale: the run was
 * taken on other derived steps. Every touch step's style check differences are gated mismatches.
 */
export function compareTraces(g: InteractionGroup, c: TraceCapture, faults: InteractionFaults = rtInteraction.NO_INTERACTION_FAULTS): { readonly steps: number; readonly mismatches: readonly TraceMismatch[]; readonly problems: readonly string[] } {
  const mismatches: TraceMismatch[] = [];
  const problems: string[] = [];
  let steps = 0;
  for (const target of TRACE_TARGETS) {
    const run = c.runs.find((r) => r.targets.includes(target));
    if (run === undefined) {
      problems.push(`${g.id} ${target}: no captured run`);
      continue;
    }
    const d = traceDerivation(g, target);
    if (stepsSha256(d.steps) !== run.stepsSha256 || d.steps.length !== run.steps.length || d.steps.some((s, i) => s.kind !== run.steps[i]?.kind)) {
      problems.push(`${g.id} ${target}: the capture was taken on other derived steps; run pnpm run parity:trace-capture`);
      continue;
    }
    const rt = new InteractionRuntime(d.ip, groupHit(g, d.inputs), faults);
    for (const [i, s] of d.steps.entries()) {
      let got: InteractionSnapshot;
      try {
        got = rt.step(s);
      } catch (e) {
        problems.push(`${g.id} ${target} step ${i} (${s.kind}): ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      steps++;
      const chrome = run.steps[i] as ChromeTraceStep;
      const e = effective(chrome);
      const pairs: [TraceMismatch['dimension'], readonly string[], readonly string[]][] = [
        ['hover', got.hover, e.hover],
        ['active', got.active, e.active],
        ['focus', got.focus === null ? [] : [got.focus], e.focus],
        ['focus-visible', got.focusVisible === null ? [] : [got.focusVisible], e.focusVisible],
      ];
      for (const [dimension, ts, ch] of pairs) {
        if (setText(ts) !== setText(ch)) mismatches.push({ group: g.id, target, step: i, kind: s.kind, dimension, gated: gated(s.kind, dimension), ts: setText(ts), chrome: setText(ch) });
      }
      for (const diff of chrome.style ?? []) mismatches.push({ group: g.id, target, step: i, kind: s.kind, dimension: 'style', gated: true, ts: 'none state', chrome: diff });
    }
  }
  return { steps, mismatches, problems };
}

/** Every group the trace lane covers: interaction-cases.ts interactionGroups. */
export const traceGroups = (): readonly InteractionGroup[] => interactionGroups();

export const mismatchText = (m: TraceMismatch): string => `${m.group} ${m.target} step ${m.step} (${m.kind}) ${m.dimension}: TS ${m.ts}, Chrome ${m.chrome}`;
