// The user-select refusal (T154): no native text is selectable until package P6c (T077) builds selection, so on iOS and Android
// an author's user-select compiles only at none, the one value whose Chrome behaviour (nothing selectable) native already has.
// The parity lanes compile the other values on native anyway (project.ts, lane-only): such a case proves web rows only.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import type { ResolvedElement } from './resolve.ts';

/** Refuses, per native target, every element whose winning author user-select computes to anything but none. */
export function checkSelectable(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const walk = (el: ResolvedElement): void => {
    const v = el.props.get('user-select') as ResolvedValue | undefined;
    if (v === undefined) throw new Error(`${el.element.address}: user-select did not resolve`);
    if (v.value.kind !== 'keyword') throw new Error(`${el.element.address}: user-select did not compute to a keyword`);
    const k = v.value.value;
    if (v.declaration !== null && v.origin !== 'inherited' && k !== 'none') {
      for (const t of targets) {
        if (t === 'web') continue;
        const id = `${t}|user-select|${el.element.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: authored(v.declaration.valueSpan),
          target: t,
          message: `${el.element.address} has user-select ${k}, which makes its text selectable in Chrome; no ${t} text is selectable until package P6c (T077) builds selection, so Dragon compiles user-select: none only`,
          manual: 'Use user-select: none, or leave user-select undeclared.',
          basis: 'computed-value',
        }));
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
}
