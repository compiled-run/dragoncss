// The touch-action refusal (pointerevents-3 §10.2): in Chrome a pan that starts on a box moves the page or a scroll container only in
// the directions the box's touch-action, intersected with its ancestors' up to that scroller, allows (the spec's effective touch
// action). Native views pan every scroll view in every direction it scrolls and zoom nothing,
// so on iOS and Android a computed touch-action is compiled only when it allows every pan direction: auto, manipulation and pan-x
// pan-y, which differ from each other only in pinch and double-tap zoom, neither of which native output has. Any other value is
// refused where it applies: the spec applies touch-action to every element but a non-replaced inline box, a table row, column or
// their groups, and a box that generates none (display contents or none) has no area a touch could start on.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { touchActionPans } from '../css/properties/touch-action.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import { isReplacedTag } from './elements/replaced.ts';
import type { ResolvedElement } from './resolve.ts';

const IGNORED_DISPLAY: readonly string[] = ['contents', 'none', 'table-row', 'table-row-group', 'table-header-group', 'table-footer-group', 'table-column', 'table-column-group'];

/** Refuses, per native target, a touch-action on el that stops a pan direction, where Chrome applies it. */
export function checkTouchAction(el: ResolvedElement, nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('touch-action') as ResolvedValue | undefined;
  if (v === undefined) throw new Error(`${el.element.address}: touch-action did not resolve`);
  if (v.value.kind !== 'keyword') throw new Error(`${el.element.address}: touch-action did not compute to a keyword`);
  const k = v.value.value;
  if (touchActionPans(k).size === 4) return;
  const display = el.props.get('display') as ResolvedValue | undefined;
  const d = display?.value.kind === 'keyword' ? display.value.value : null;
  if (d !== null && IGNORED_DISPLAY.includes(d)) return;
  if (d === 'inline' && !isReplacedTag(el.element.tag) && el.element.tag !== 'svg') return;
  for (const t of nativeTargets) {
    const id = `${t}|touch-action|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan),
      target: t,
      message: `${el.element.address} has touch-action ${k}, so Chrome stops a pan that starts on it from scrolling ${k === 'none' || k === 'pinch-zoom' ? 'in any direction' : 'in the directions it leaves out'}; ${t} views pan in every direction, so Dragon compiles touch-action at auto, manipulation or pan-x pan-y only`,
      manual: `Remove touch-action from ${el.element.address}, or set it to manipulation.`,
      basis: 'computed-value',
    }));
  }
}
