// The element table: the HTML tags the compiler resolves, each with captured Chrome UA defaults (ua/chrome-145.*.generated.ts).
// Every other tag is refused by the projection. pre is refused: white-space: pre is not supported.
export const SUPPORTED_TAGS: ReadonlySet<string> = new Set([
  'html', 'body', 'div',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'address', 'hr', 'dl', 'dt', 'dd',
]);
