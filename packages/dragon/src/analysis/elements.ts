// The element table: the HTML tags the compiler resolves. Every other tag is refused by the projection.
export const SUPPORTED_TAGS: ReadonlySet<string> = new Set(['html', 'body', 'div']);
