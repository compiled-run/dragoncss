// Minimal types for the css-tree 3.2.1 parse API the flattening pre-pass uses (the package ships none).
declare module 'css-tree' {
  export type List<T> = { toArray(): T[] };
  export type CssNode = { readonly type: string; readonly loc?: { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } } | null } & { readonly [key: string]: unknown };
  export function parse(text: string, options?: { positions?: boolean; parseValue?: boolean; parseAtrulePrelude?: boolean; parseRulePrelude?: boolean; onParseError?: (error: { message: string; offset: number }) => void }): CssNode;
}
