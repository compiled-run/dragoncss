// Minimal types for the css-tree 3.2.1 parse API the authored renderer uses to find class tokens (the package ships none).
declare module 'css-tree' {
  export type CssNode = { readonly type: string; readonly loc?: { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } } | null } & { readonly [key: string]: unknown };
  export function parse(text: string, options?: { positions?: boolean; onParseError?: (error: { message: string }) => void }): CssNode;
}
