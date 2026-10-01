// check-layout-th.js semantics against Dragon's engine output. The DOM values are CSSOM View's, rounded to integers here, never in
// the engine: Chrome 145 rounds offset positions and offset and client sizes half up from the unrounded box (measured on 100
// fractional boxes, positive and negative). The tolerance is check-layout's own.
import type { ControlBox, LayoutBox, LayoutInput, LayoutRect } from '@dragon/layout';
import { absoluteRects, LU_PER_PX } from '@dragon/layout';
import { resolveBorder } from '../../layout/src/box.ts';
import type { Check, CheckAttribute, Sidecar } from './translate.ts';

/** check-layout-th.js assert_tolerance: |actual - expected| < 1 CSS px, otherwise exact equality with Number(expected). */
export function withinTolerance(actual: number, expected: string): boolean {
  const e = Number(expected);
  if (Number.isNaN(e) || Number.isNaN(actual) || Math.abs(actual - e) >= 1) return actual === e;
  return true;
}

/** Blink LayoutUnit::Round on raw 1/64 px units: halves round up. */
export const roundLu = (lu: number): number => Math.floor((lu + LU_PER_PX / 2) / LU_PER_PX);

/** Checks Dragon cannot evaluate yet: the test stays not-runnable with this reason. */
export function unsupportedAssertion(sidecar: Sidecar, tagOf: (node: string) => string | undefined): string | null {
  for (const s of sidecar.subtests) {
    for (const c of s.checks) {
      if (c.attribute === 'scroll-width' || c.attribute === 'scroll-height') return 'assert:scroll-size';
      if (c.attribute === 'display') return 'assert:computed-display';
      if (c.attribute.startsWith('padding-')) return 'assert:computed-padding';
      if (c.attribute.startsWith('margin-')) return 'assert:computed-margin';
      if ((c.attribute === 'client-width' || c.attribute === 'client-height') && tagOf(c.node) === 'html') return 'assert:root-client-size';
    }
  }
  return null;
}

export type Elements = ReadonlyMap<string, { readonly tag: string; readonly parent: string | null }>;

export type CheckResult = { readonly check: Check; readonly actual: number | null; readonly pass: boolean };
export type SubtestResult = { readonly name: string; readonly pass: boolean; readonly checks: readonly CheckResult[] };

/** The DOM view of one laid-out fixture: offsetParent, offset*, client* and bounding-rect values per element id. */
export class DomView {
  private readonly abs: ReadonlyMap<string, LayoutRect>;
  private readonly styles = new Map<string, LayoutBox['style']>();
  private readonly input: LayoutInput;
  private readonly elements: Elements;

  constructor(input: LayoutInput, boxes: readonly LayoutRect[], elements: Elements) {
    this.input = input;
    this.elements = elements;
    this.abs = absoluteRects(boxes);
    const walk = (b: LayoutBox | ControlBox): void => {
      this.styles.set(b.id, b.style);
      for (const c of b.children) {
        if (c.kind === 'box' || c.kind === 'control') walk(c);
        else if (c.kind === 'replaced') this.styles.set(c.id, c.style);
      }
    };
    walk(input.root);
  }

  private borders(id: string): { left: number; top: number; right: number; bottom: number } {
    const s = this.styles.get(id);
    if (s === undefined) return { left: 0, top: 0, right: 0, bottom: 0 };
    const b = resolveBorder(s, this.input.devicePixelRatio);
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  }

  /** CSSOM View offsetParent: null for html, body and box-less elements; else the nearest positioned ancestor, or body. */
  offsetParent(id: string): string | null {
    const el = this.elements.get(id);
    if (el === undefined || el.tag === 'html' || el.tag === 'body' || !this.abs.has(id)) return null;
    for (let p = el.parent; p !== null; p = this.elements.get(p)?.parent ?? null) {
      const pe = this.elements.get(p);
      if (pe === undefined) return null;
      if (pe.tag === 'body') return p;
      const s = this.styles.get(p);
      if (s !== undefined && s.position !== 'static') return p;
    }
    return null;
  }

  /** offsetLeft/offsetTop before rounding, in LU: from the offsetParent's padding edge, or the initial containing block for body. */
  private offsetLu(id: string, axis: 'x' | 'y'): number {
    const el = this.elements.get(id);
    const r = this.abs.get(id);
    if (el === undefined || r === undefined || el.tag === 'body') return 0;
    const op = this.offsetParent(id);
    const own = axis === 'x' ? r.x : r.y;
    if (op === null || this.elements.get(op)?.tag === 'body') return own;
    const pr = this.abs.get(op) as LayoutRect;
    const b = this.borders(op);
    return axis === 'x' ? own - (pr.x + b.left) : own - (pr.y + b.top);
  }

  value(node: string, attribute: CheckAttribute): number | null {
    const r = this.abs.get(node);
    const b = this.borders(node);
    switch (attribute) {
      case 'width': return r === undefined ? 0 : roundLu(r.width);
      case 'height': return r === undefined ? 0 : roundLu(r.height);
      case 'offset-x': return roundLu(this.offsetLu(node, 'x'));
      case 'offset-y': return roundLu(this.offsetLu(node, 'y'));
      case 'client-width': return r === undefined ? 0 : roundLu(r.width - b.left - b.right);
      case 'client-height': return r === undefined ? 0 : roundLu(r.height - b.top - b.bottom);
      case 'bounding-client-rect-width': return r === undefined ? 0 : r.width / LU_PER_PX;
      case 'bounding-client-rect-height': return r === undefined ? 0 : r.height / LU_PER_PX;
      case 'total-x': return (r === undefined ? 0 : roundLu(b.left)) + roundLu(this.offsetLu(node, 'x'));
      case 'total-y': return (r === undefined ? 0 : roundLu(b.top)) + roundLu(this.offsetLu(node, 'y'));
      default: return null;
    }
  }
}

/** Every subtest of the sidecar against the DOM view; a data-key check (an unknown data-* attribute) always fails, as in WPT. */
export function evaluate(sidecar: Sidecar, view: DomView): SubtestResult[] {
  return sidecar.subtests.map((s) => {
    const checks = s.checks.map((check): CheckResult => {
      if (check.attribute === 'data-key') return { check, actual: null, pass: false };
      const actual = view.value(check.node, check.attribute);
      return { check, actual, pass: actual !== null && withinTolerance(actual, check.expected) };
    });
    return { name: s.name, pass: checks.every((c) => c.pass), checks };
  });
}
