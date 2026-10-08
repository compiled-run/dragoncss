import type { FontSpec, InlineBox, InlineChild, LayoutBox, LayoutStyle, LineBreak, LineStrut, ReplacedLeaf, SafeAreaInsets, TextLeaf, Viewport, ViewportUnitSizes } from '../src/index.ts';
/** Test-only: the CSS initial values for a block div, spelled out so each test states what it overrides. */
export declare const divStyle: LayoutStyle;
type Child = LayoutBox | ReplacedLeaf | InlineChild;
/** The strut the compiler writes for inline content: the container's font and line-height, here its first text leaf's (or 10px Ahem). */
export declare function strutFor(children: readonly Child[]): LineStrut | null;
export declare function box(id: string, style: Partial<LayoutStyle>, children?: Child[], strut?: LineStrut | null): LayoutBox;
export declare function anon(id: string, style: Partial<LayoutStyle>, children?: Child[], strut?: LineStrut | null): LayoutBox;
/** An inline box (display inline) with a 10px Ahem font and line-height normal unless given. */
export declare function span(id: string, children: InlineChild[], over?: Partial<Omit<InlineBox, 'kind' | 'id' | 'children'>>): InlineBox;
/** A <br> with a 10px Ahem font and line-height normal unless given. */
export declare function br(id: string, over?: Partial<Omit<LineBreak, 'kind' | 'id'>>): LineBreak;
/** A 10px Ahem text leaf, already collapsed, with the inherited text properties the compiler writes onto it. */
export declare function text(id: string, value: string, over?: Partial<TextLeaf>): TextLeaf;
export declare const px: (value: number) => {
    readonly kind: "px";
    readonly value: number;
};
export declare const pct: (value: number) => {
    readonly kind: "percent";
    readonly value: number;
};
/** An Ahem font at a px size: the specified size is that px leaf, absolute, and the computed size at the reference environment. */
export declare function ahemFont(size: number): FontSpec;
/** The environment inputs of a case at a viewport: every viewport unit reads it, no safe area, and a 16px root font size. */
export declare function neutralEnvironment(viewport: Viewport): {
    readonly viewportUnits: ViewportUnitSizes;
    readonly safeArea: SafeAreaInsets;
    readonly rootFontSize: number;
};
export {};
