// Properties Chrome 145 does not know: it drops every declaration of one at parse time, whatever its value, so it never applies
// (css-syntax-3 §5.4.6). Dragon drops them the same way, with a DRAGON_PROPERTY_DROPPED warning, instead of refusing them, so a
// sheet that writes one beside the standard property (Tailwind's hyphens-* utilities) compiles as Chrome renders it. Each entry is
// pinned against Chrome: CSS.supports is false and the declaration changes nothing.
// - -webkit-hyphens (TXT2-i): css_properties.json5 lists no alias for hyphens (packages/parity/test/hyphens-chrome.test.ts, and
//   and packages/parity/test/text-hyphens-webkit.test.ts, against the same text without it).
export const CHROME_DROPPED_PROPERTIES: ReadonlySet<string> = new Set(['-webkit-hyphens']);
