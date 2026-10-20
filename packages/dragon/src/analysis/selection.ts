// The user-select refusal (T154): no native text is selectable until package P6c (T077) builds selection. iOS and Android draw
// every element as Chrome draws it with no author user-select (the default, auto, whose text Chrome makes selectable, is the gap P6c
// closes) or with none (nothing selectable, which native already has). So on native an author's user-select compiles when its used
// value (css-ui-4 §6.1) is none, or is the used value auto would get under the same parent, which makes the declaration change
// nothing in Chrome: auto everywhere, and text, inherit or unset under a parent whose used value is text. Every other value
// (text or all that makes text selectable where the default would not, or selects it as a unit) is refused until P6c.
// The parity lanes compile the refused values on native anyway (project.ts, lane-only): such a case proves web rows only.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import type { ResolvedElement } from './resolve.ts';

/** A used user-select value: auto resolves against the parent. */
export type UsedUserSelect = 'text' | 'none' | 'all';

/**
 * css-ui-4 §6.1 used value of user-select: auto is none under a parent whose used value is none, all under all, else text (the
 * root's parent counts as text; nothing compiled is editable, so contain never arises).
 */
export function usedUserSelect(computed: string, parent: UsedUserSelect): UsedUserSelect {
  if (computed === 'none' || computed === 'text' || computed === 'all') return computed;
  if (computed !== 'auto') throw new Error(`user-select computed to ${computed}`);
  return parent === 'none' || parent === 'all' ? parent : 'text';
}

/** Refuses, per native target, every element whose winning author user-select changes what Chrome selects beyond none. */
export function checkSelectable(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const walk = (el: ResolvedElement, parent: UsedUserSelect): void => {
    const v = el.props.get('user-select') as ResolvedValue | undefined;
    if (v === undefined) throw new Error(`${el.element.address}: user-select did not resolve`);
    if (v.value.kind !== 'keyword') throw new Error(`${el.element.address}: user-select did not compute to a keyword`);
    const k = v.value.value;
    const used = usedUserSelect(k, parent);
    if (v.declaration !== null && v.origin !== 'inherited' && used !== 'none' && used !== usedUserSelect('auto', parent)) {
      for (const t of targets) {
        if (t === 'web') continue;
        const id = `${t}|user-select|${el.element.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: authored(v.declaration.valueSpan),
          target: t,
          message: `${el.element.address} has user-select ${k}, whose used value in Chrome is ${used} where the default's is ${usedUserSelect('auto', parent)}; no ${t} text is selectable until package P6c (T077) builds selection, so Dragon compiles user-select only where it is none or changes nothing`,
          manual: 'Use user-select: none or auto, or leave user-select undeclared.',
          basis: 'computed-value',
        }));
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, used);
  };
  walk(root, 'text');
}
