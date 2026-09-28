// The original WPT file in the pinned Chrome (packages/parity/src/chrome.ts launchChrome: Chrome 145, Playwright 1.58.2, the
// parity flags), served from the WPT copy over HTTP at 800x600 and DPR 1. testharnessreport.js is replaced by a reporter that
// keeps the results in the page; the vendored copy is only read.
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';
import { launchChrome } from '../../parity/src/chrome.ts';
import { withinTolerance } from './assertions.ts';
import type { Check, Sidecar } from './translate.ts';
import { WPT_VIEWPORT } from './translate.ts';

export type Browser = Awaited<ReturnType<typeof launchChrome>>;

/** Records the harness results in window.__dragonWpt instead of drawing them into the page (wptrunner does the same). */
export const REPORTER_JS = `setup({ output: false });
add_completion_callback(function (tests, status) {
  window.__dragonWpt = { status: status.status, tests: tests.map(function (t) { return { name: t.name, status: t.status }; }) };
});
`;

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.xht': 'application/xhtml+xml', '.xhtml': 'application/xhtml+xml',
};

export type WptServer = { readonly origin: string; close(): Promise<void> };

/**
 * Serves the WPT copy read-only. overlays maps a URL path prefix ("/css/dragon-test/") to another directory, for the package's
 * own synthetic test pages, which then load WPT's /resources/ like any test.
 */
export async function serveWpt(root: string, overlays: Readonly<Record<string, string>> = {}): Promise<WptServer> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/resources/testharnessreport.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(REPORTER_JS);
      return;
    }
    const overlay = Object.keys(overlays).find((p) => path.startsWith(p));
    const base = overlay === undefined ? root : (overlays[overlay] as string);
    const file = normalize(join(base, overlay === undefined ? path : path.slice(overlay.length)));
    if (!file.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export type ChromeCheck = { readonly actual: number | string | null; readonly pass: boolean };
export type ChromeOutcome = {
  /** testharness's harness status: 0 OK, 1 ERROR, 2 TIMEOUT, 3 PRECONDITION_FAILED; -1 when the page never completed. */
  readonly harness: number;
  /** testharness subtests by name, in order: pass when status is 0. */
  readonly subtests: readonly { readonly name: string; readonly pass: boolean }[];
  /** Per sidecar check, in sidecar order: Chrome's DOM value and check-layout's tolerance against it. */
  readonly checks: readonly ChromeCheck[];
  /** The harness subtests match the sidecar's names and each one's result equals the per-check results. */
  readonly agrees: boolean;
};

type RawValue = number | string | null;

/** Opens the original test and reads every checked value the way check-layout-th.js does. */
export async function runInChrome(browser: Browser, origin: string, sidecar: Sidecar): Promise<ChromeOutcome> {
  const context = await browser.newContext({ viewport: { ...WPT_VIEWPORT }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/${sidecar.source}`, { waitUntil: 'load' });
    const done = await page.waitForFunction(() => (window as unknown as { __dragonWpt?: unknown }).__dragonWpt !== undefined, undefined, { timeout: 20_000 }).then(() => true, () => false);
    const harness = done ? await page.evaluate(() => (window as unknown as { __dragonWpt: { status: number; tests: { name: string; status: number }[] } }).__dragonWpt) : { status: -1, tests: [] };
    const all: Check[] = sidecar.subtests.flatMap((s) => s.checks);
    const values: RawValue[] = await page.evaluate((checks: readonly { element: number; attribute: string; expected: string }[]) => {
      const els = document.getElementsByTagName('*');
      return checks.map((c): RawValue => {
        const el = els[c.element] as HTMLElement | undefined;
        if (el === undefined) return null;
        const cs = getComputedStyle(el);
        switch (c.attribute) {
          case 'data-key': return null;
          case 'width': return el.offsetWidth;
          case 'height': return el.offsetHeight;
          case 'offset-x': return el.offsetLeft;
          case 'offset-y': return el.offsetTop;
          case 'client-width': return el.clientWidth;
          case 'client-height': return el.clientHeight;
          case 'scroll-width': return el.scrollWidth;
          case 'scroll-height': return el.scrollHeight;
          case 'bounding-client-rect-width': return el.getBoundingClientRect().width;
          case 'bounding-client-rect-height': return el.getBoundingClientRect().height;
          case 'total-x': return el.clientLeft + el.offsetLeft;
          case 'total-y': return el.clientTop + el.offsetTop;
          case 'display': return cs.display;
          default: return cs.getPropertyValue(c.attribute).slice(0, -2);
        }
      });
    }, all.map((c) => ({ element: c.element, attribute: c.attribute, expected: c.expected })));
    const checks = all.map((c, i): ChromeCheck => {
      const actual = values[i] ?? null;
      if (actual === null) return { actual, pass: false };
      return { actual, pass: typeof actual === 'number' ? withinTolerance(actual, c.expected) : actual === c.expected };
    });
    const subtests = harness.tests.map((t) => ({ name: t.name, pass: t.status === 0 }));
    let at = 0;
    const perSubtest = sidecar.subtests.map((s) => {
      const own = checks.slice(at, at + s.checks.length);
      at += s.checks.length;
      return { name: s.name, pass: own.every((c) => c.pass) };
    });
    const agrees = harness.status === 0 && JSON.stringify(subtests) === JSON.stringify(perSubtest);
    return { harness: harness.status, subtests, checks, agrees };
  } finally {
    await context.close();
  }
}

export { launchChrome };
