// NA-NATIVE: what an element's ::-webkit-scrollbar rules do, per resolution (analysis/webkit-scrollbar.ts records it in resolveTree).
// Kept apart from the matching, so the web emitter and native lowering read it from the resolved element alone.
import type { Longhand } from '../css/properties.ts';
import type { Span } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

export type ScrollbarVerdict = { readonly kind: 'hidden' } | { readonly kind: 'refused'; readonly span: Span; readonly message: string };

const VERDICTS = new WeakMap<ReadonlyMap<Longhand, ResolvedValue>, ScrollbarVerdict>();

/** Records the verdict of the element whose resolved props are props. */
export const recordScrollbarVerdict = (props: ReadonlyMap<Longhand, ResolvedValue>, v: ScrollbarVerdict): void => void VERDICTS.set(props, v);

/** The recorded verdict of el, or null when its scrollbar rules do nothing. */
export const scrollbarVerdict = (el: ResolvedElement): ScrollbarVerdict | null => VERDICTS.get(el.props) ?? null;

/** Whether el's ::-webkit-scrollbar rules hide its scrollbars: native hides its scroll indicators, web writes the hiding rule. */
export const webkitScrollbarHidden = (el: ResolvedElement): boolean => scrollbarVerdict(el)?.kind === 'hidden';
