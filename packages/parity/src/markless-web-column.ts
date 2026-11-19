// The web column of a Markless export with system fonts: every frame of every assignment against the boxes the phone's own browser
// lays the same element tree out at (Safari in an iOS simulator, Chrome on an Android emulator), under the device lanes' gate.
// Chrome on the Mac stands in for neither phone's system fonts on iOS (markless-style-compare.ts), so the phones measure it.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { authoredFontHtml } from './cases.ts';
import type { NativeStyleTarget } from 'dragon';
import { collectNodes, nameCollected } from './capture.ts';
import type { CapturedNode, CollectedElement } from './capture.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { BAND_KEY } from 'dragon';
import { checkCoverage, checkInputFonts, checkTargets, collectBackdrops, documentMismatch, marklessDocumentHtml, marklessDocumentTree, modalIds, pairBoxes, readDocumentTree, readRootProbe, usedScheme, withCleanup } from './markless-style-compare.ts';
import type { BoxProblem, CompareRow, DocumentNode, RootProbe } from './markless-style-compare.ts';
import type { MarklessAtSize, MarklessExportAssignment, MarklessFontFile, MarklessStyleInput } from './markless-style-input.ts';
import { checkMarklessExport, marklessCompiledTargets, marklessHeightDependence, schemeOf } from './markless-style-input.ts';
import type { ExportAssignment, ExportTarget, NativeStyleExport } from './native-style-export.ts';

/** A phone whose browser measures the page: an iOS simulator by UDID (Safari), or an Android emulator by adb serial (Chrome). */
export type WebColumnDevice = { readonly target: 'ios'; readonly udid: string } | { readonly target: 'android'; readonly serial: string };

/** A compared box: the gate's row, with both frames in device px from the page's top left. */
export type WebColumnRow = CompareRow & { readonly maxDeltaDevicePx: number; readonly web: Frame; readonly dragon: Frame };
type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Measured = { readonly dpr: number; readonly innerWidth: number; readonly layoutWidth: number; readonly elements: readonly CollectedElement[]; readonly backdrops: readonly CapturedNode[]; readonly tree: DocumentNode; readonly probe: RootProbe; readonly userAgent: string };

/** How the web column reaches the device: a command's stdout, opening a URL in its browser, a screenshot, and waiting. */
export type WebColumnHost = {
  readonly run: (cmd: string, args: readonly string[]) => string;
  readonly open: (device: WebColumnDevice, url: string) => void;
  readonly screenshot: (device: WebColumnDevice, file: string) => void;
  readonly wait: (ms: number) => Promise<void>;
};
const run = (cmd: string, args: readonly string[]): string => execFileSync(cmd, [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The page of one assignment: the comparison's document with system fonts, and a script in its head that posts the tree and every box back. */
function pageOf(input: MarklessStyleInput, values: Readonly<Record<string, unknown>>, files: ReadonlyMap<string, Uint8Array>, post: string, width: number | null): string {
  const html = authoredFontHtml(marklessDocumentHtml(input, values, 'system'), files);
  // The export lays out at whole CSS px (a Pixel 7 is 411.43 wide); the root box takes that width so both lay out the same line length.
  const viewport = `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="format-detection" content="telephone=no, date=no, address=no, email=no"><style>:where(html){-webkit-text-size-adjust:100%;text-size-adjust:100%${width === null ? '' : `;width:${width}px`}}</style>`;
  const script = `<script>addEventListener('load',()=>document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const tree=(${readDocumentTree.toString()})();const elements=(${collectNodes.toString()})([]);const backdrops=(${collectBackdrops.toString()})(${JSON.stringify(modalIds(input)).replace(/</g, '\\u003c')});const probe=(${readRootProbe.toString()})();fetch(${JSON.stringify(post)},{method:'POST',body:JSON.stringify({dpr:devicePixelRatio,innerWidth,layoutWidth:document.documentElement.clientWidth,userAgent:navigator.userAgent,tree,elements,backdrops,probe})});}))));</script>`;
  return html.replace('<head>', `<head>${viewport}${script}`);
}

/** Opens a URL in the device's browser (Android's Chrome starts with the command line webColumn writes). */
function open(device: WebColumnDevice, url: string): void {
  if (device.target === 'ios') run('xcrun', ['simctl', 'openurl', device.udid, url]);
  // One tab for every page: Chrome reuses the tab an application id opened, so a run does not pile up tabs.
  else run('adb', ['-s', device.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, '--es', 'com.android.browser.application_id', 'dragon-web-column', 'com.android.chrome']);
}

function screenshot(device: WebColumnDevice, file: string): void {
  if (device.target === 'ios') run('xcrun', ['simctl', 'io', device.udid, 'screenshot', file]);
  else execFileSync('sh', ['-c', `adb -s "$1" exec-out screencap -p > "$2"`, 'sh', device.serial, file]);
}

/** The browser's own layout size: whole CSS px wide and tall, at its device pixel ratio. */
export type BrowserSize = { readonly width: number; readonly height: number; readonly vh: number; readonly dpr: number };

/** What a phone drew: one assignment's boxes in points (iOS) or dp (Android) from the page's top left, by node id, at its viewport in CSS px and its ratio. */
export type NativeLayout = { readonly assignment: number; readonly viewport: { readonly width: number; readonly height: number }; readonly scale: number; readonly boxes: ReadonlyMap<string, Frame> };

/**
 * The size the browser must lay the page out at. `proof`: the export's viewport and ratio, which `at` names when the export was laid
 * out at a phone's own size (marklessStyleExport's `at`) instead of the input's. `scaled`: the device's own size, the export's
 * proof-device frames scaled to it. `native`: the size a phone drew `layout` at, its boxes in place of the export's frames.
 */
export type WebColumnSize = { readonly kind: 'proof'; readonly at?: MarklessAtSize } | { readonly kind: 'scaled' } | { readonly kind: 'native'; readonly layout: NativeLayout };

/**
 * A size the compared boxes were laid out at: `by` names who laid them out, `fix` what to do when the browser's page is another size.
 * `widthOnly`: the page was refused unless its layout reads the width alone, so the browser's height is not compared (a phone's page
 * area is not its browser's 100vh: on an iPhone 17 Safari's 100vh is 754 CSS px and an app's page area 778).
 */
export type LaidOutAt = { readonly viewport: { readonly width: number; readonly height: number }; readonly dpr: number; readonly by: string; readonly fix: string; readonly widthOnly?: boolean };

/**
 * How one assignment's browser boxes are compared: `browserDpr` is the browser's ratio; with `anySize` the browser laid the page out
 * at its own width and the export's frames are scaled to it; with `phone` the boxes a phone drew for the input's nodes (`ids`)
 * stand in for the export's frames.
 */
export type WebColumnView = { readonly browserDpr: number; readonly anySize: boolean; readonly phone?: { readonly boxes: ReadonlyMap<string, Frame>; readonly ids: ReadonlySet<string> } };

const DEVICE_HOST: WebColumnHost = { run, open, screenshot, wait: (ms) => new Promise((r) => setTimeout(r, ms)) };

type Appearance = 'light' | 'dark';
/** The device's appearance setting as it reads back: iOS's light or dark, Android's night mode (yes, no, auto or custom). */
type DeviceAppearance = { readonly target: 'ios'; readonly value: Appearance } | { readonly target: 'android'; readonly value: 'yes' | 'no' | 'auto' | 'custom' };

function readAppearance(host: WebColumnHost, device: WebColumnDevice): DeviceAppearance {
  if (device.target === 'ios') {
    const out = host.run('xcrun', ['simctl', 'ui', device.udid, 'appearance']).trim();
    if (out !== 'light' && out !== 'dark') throw new Error(`ios: the simulator's appearance reads ${JSON.stringify(out)}, neither light nor dark`);
    return { target: 'ios', value: out };
  }
  const out = host.run('adb', ['-s', device.serial, 'shell', 'cmd', 'uimode', 'night']).trim();
  const m = /^Night mode: (yes|no|auto|custom)$/.exec(out);
  if (m === null) throw new Error(`android: the emulator's night mode reads ${JSON.stringify(out)}, not "Night mode: yes|no|auto|custom"`);
  return { target: 'android', value: m[1] as 'yes' | 'no' | 'auto' | 'custom' };
}

function setAppearance(host: WebColumnHost, device: WebColumnDevice, value: DeviceAppearance['value']): void {
  if (device.target === 'ios') host.run('xcrun', ['simctl', 'ui', device.udid, 'appearance', value]);
  else host.run('adb', ['-s', device.serial, 'shell', 'cmd', 'uimode', 'night', value]);
}

const nightOf = (a: Appearance): 'yes' | 'no' => (a === 'dark' ? 'yes' : 'no');

/** How many times the page is read after the device's appearance changes, a second apart, before the browser's preference must have followed. */
export const PREFERENCE_READS = 30;
const PREFERENCE_READ_MS = 1000;


const PROBLEM: { readonly [K in BoxProblem]: string } = {
  'no-node': 'has a box in the browser and no node in the export',
  'no-frame': 'has a box in the browser and no frame in the export',
  'no-box': 'has a frame in the export and no box in the browser',
  unseen: 'has a frame in the export and no box in the browser\'s page',
  anonymous: 'is an anonymous box whose nodes are not all in the browser\'s page',
};

/**
 * Refuses a browser whose page is not the one compared with for this assignment: another ratio, width or height (100vh and the
 * viewport's height, which vh units, percentage heights and a modal dialog read; not with `widthOnly`) than `laid` (the export's own,
 * unless given; null when the compared frames are scaled to the browser's size), the other colour-scheme preference from the one the assignment's band
 * reads, or a root used colour scheme other than the export's.
 */
export function checkBrowserPage(target: WebColumnDevice['target'], t: Pick<ExportTarget, 'viewport' | 'dpr' | 'bands'>, assignment: MarklessExportAssignment, m: Pick<Measured, 'dpr' | 'innerWidth' | 'probe'>, index: number, laid: LaidOutAt | null = { viewport: t.viewport, dpr: t.dpr, by: 'the export', fix: "use the export's proof device" }): void {
  if (laid !== null) {
    if (Math.abs(m.dpr - laid.dpr) > 1e-6 || Math.abs(m.innerWidth - laid.viewport.width) > 1) throw new Error(`${target}: the browser lays out ${m.innerWidth} CSS px at ${m.dpr}x, ${laid.by} ${laid.viewport.width} at ${laid.dpr}x; ${laid.fix}`);
    const { vh, viewportHeight, innerHeight } = m.probe;
    if (laid.widthOnly !== true && (Math.abs(vh - laid.viewport.height) > 1 || Math.abs(viewportHeight - laid.viewport.height) > 1)) throw new Error(`${target}: the browser lays out 100vh at ${vh} and its viewport at ${viewportHeight} CSS px tall (innerHeight ${innerHeight}), ${laid.by} at ${laid.viewport.height}; ${laid.fix}`);
  }
  const want = wantScheme(t, assignment);
  if (m.probe.prefersDark !== (want === 'dark')) throw new Error(`${target} assignment ${index}: the browser prefers ${m.probe.prefersDark ? 'dark' : 'light'}, and this assignment is laid out for ${want}; set the device's appearance to ${want}`);
  const used = usedScheme(m.probe);
  if (used !== assignment.colorScheme) throw new Error(`${target} assignment ${index}: the browser's root uses the ${used} colour scheme, the export's colorScheme is ${assignment.colorScheme}`);
}

/** The colour-scheme preference an assignment's band reads: light for an unbanded export. */
function wantScheme(t: Pick<ExportTarget, 'bands'>, assignment: MarklessExportAssignment): Appearance {
  const band = assignment.values[BAND_KEY];
  return typeof band === 'number' ? schemeOf(t.bands, band) : 'light';
}

/**
 * One assignment's rows; a node one side gives a box and the other does not is an error, never skipped. The browser's boxes are
 * paired with the export's nodes by the export's naming rule (pairBoxes) whether the export's frames or a phone's boxes are compared.
 */
export function webColumnRows(input: MarklessStyleInput, target: WebColumnDevice['target'], dpr: number, assignment: ExportAssignment, measured: readonly CapturedNode[], index: number, view: WebColumnView = { browserDpr: dpr, anySize: false }): WebColumnRow[] {
  const where = `${target} assignment ${index}`;
  const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
  const absolute = (id: string): Frame => {
    const n = byId.get(id);
    if (n === undefined || n.frame === null) throw new Error(`${id} has no frame`);
    const p = n.parent === null ? { x: 0, y: 0 } : absolute(n.parent);
    return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
  };
  const round = (f: Frame): Frame => ({ x: Number(f.x.toFixed(4)), y: Number(f.y.toFixed(4)), width: Number(f.width.toFixed(4)), height: Number(f.height.toFixed(4)) });
  const scale = view.anySize ? view.browserDpr / dpr : 1;
  const { pairs, problems } = pairBoxes(input, assignment, measured);
  const first = problems[0];
  if (first !== undefined) throw new Error(`${where}: ${first.id} ${PROBLEM[first.kind]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}`);
  const phone = view.phone;
  if (phone !== undefined) {
    const boxed = new Set(pairs.map((p) => p.id));
    for (const [id, f] of phone.boxes) if (phone.ids.has(id) && !boxed.has(id) && (f.width > 0 || f.height > 0)) throw new Error(`${where}: the phone drew a box for ${id}, which the browser does not lay out`);
  }
  const rows: WebColumnRow[] = [];
  for (const { id, c } of pairs) {
    let e: Frame;
    if (phone !== undefined) {
      // A phone draws the input's nodes; Dragon's html and body place them and have no view of their own.
      if (!phone.ids.has(id)) continue;
      const drawn = phone.boxes.get(id);
      if (drawn === undefined) throw new Error(`${where}: the phone drew no box for ${id}, which the browser lays out`);
      e = { x: drawn.x * dpr, y: drawn.y * dpr, width: drawn.width * dpr, height: drawn.height * dpr };
    } else e = absolute(id);
    const d = { x: e.x * scale, y: e.y * scale, width: e.width * scale, height: e.height * scale };
    const web = { x: c.x * view.browserDpr, y: c.y * view.browserDpr, width: c.width * view.browserDpr, height: c.height * view.browserDpr };
    const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(web[k] - d[k])));
    rows.push({ target, values: assignment.values, id, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX, web: round(web), dragon: round(d) });
  }
  return rows;
}

/**
 * Measures every assignment of the export's target on the device and compares its frames. The page is served on 127.0.0.1
 * (an emulator reaches it through adb reverse). The device must show the page at the size `size` names (WebColumnSize). Before
 * each assignment the device's appearance is set to the colour scheme its band reads, and the page is read again until the browser
 * prefers it; every device change is undone afterwards, also on failure. Scaled, the export's frames are compared as a host draws
 * them on the device (each frame's CSS px, export px / export dpr, at the device's dpr).
 */
export async function webColumn(input: MarklessStyleInput, given: NativeStyleExport, device: WebColumnDevice, fonts: readonly MarklessFontFile[] = [], screenshots?: string, size: WebColumnSize = { kind: 'proof' }, host: WebColumnHost = DEVICE_HOST): Promise<{ readonly browser: string; readonly size: BrowserSize; readonly compared: number; readonly failed: number; readonly rows: readonly WebColumnRow[] }> {
  const exported = checkMarklessExport(given);
  if (exported.fontMode !== 'system') throw new Error(`the export resolved fonts as ${exported.fontMode}; the web column measures the phone's own system fonts, so it compares only an export with system fonts`);
  const t = exported.targets[device.target];
  if (t === undefined) throw new Error(`the export has no ${device.target} target`);
  const at = size.kind === 'proof' ? size.at : undefined;
  const compiled = marklessCompiledTargets(input, fonts, 'system', at);
  checkTargets(input, exported, compiled);
  checkInputFonts(exported, fonts);
  for (const [target, x] of Object.entries(exported.targets)) if (x !== undefined) checkCoverage(input, compiled[target as NativeStyleTarget], target, x);
  const files = new Map(fonts.map((f) => [f.url, f.bytes]));
  const inputIds = new Set(input.nodes.map((n) => n.id));
  const native = size.kind === 'native' ? size.layout : undefined;
  const anySize = size.kind !== 'proof';
  if (native !== undefined && t.assignments[native.assignment] === undefined) throw new Error(`the phone drew assignment ${native.assignment}, which the export's ${device.target} target does not have`);
  if (native !== undefined) {
    const reads = marklessHeightDependence(input, fonts, 'system', device.target, native.viewport.width, native.scale, [t.viewport.height, native.viewport.height]);
    if (reads.length > 0) throw new Error(`${device.target}: the page's layout depends on the viewport's height through ${reads.join(', ')}; a phone's page area is not its browser's 100vh, so a phone's layout is compared only for a page laid out by its width`);
  }
  const laid: LaidOutAt | null | undefined = size.kind === 'scaled' ? null
    : native !== undefined ? { viewport: native.viewport, dpr: native.scale, by: 'the phone', fix: 'measure on the device the phone drew on', widthOnly: true }
    : at !== undefined ? { viewport: t.viewport, dpr: t.dpr, by: 'the export laid out at size', fix: "lay the export out at this device's own size" }
    : undefined;
  const results = new Map<number, (m: Measured | Error) => void>();
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const raw = u.searchParams.get('i');
    const i = raw !== null && /^(0|[1-9][0-9]*)$/.test(raw) ? Number(raw) : NaN;
    const assignment = t.assignments[i];
    if (!Number.isInteger(i) || assignment === undefined) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf8')));
      req.on('end', () => {
        res.writeHead(200).end('ok');
        let m: Measured | Error;
        try {
          m = JSON.parse(body) as Measured;
        } catch (e) {
          m = new Error(`${device.target}: the browser posted assignment ${i}'s result as no JSON: ${(e as Error).message}`);
        }
        results.get(i)?.(m);
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(pageOf(input, assignment.values, files, `/result?i=${i}`, anySize ? null : t.viewport.width));
  });
  const rows: WebColumnRow[] = [];
  let browser = '';
  let browserSize: BrowserSize = { width: 0, height: 0, vh: 0, dpr: 0 };
  await withCleanup(async (undo) => {
    await new Promise<void>((r, reject) => server.once('error', reject).listen(0, '127.0.0.1', r));
    undo('close the page server', () => {
      server.closeAllConnections();
      server.close();
    });
    const port = (server.address() as AddressInfo).port;
    if (device.target === 'android') {
      const adb = (...args: string[]): string => host.run('adb', ['-s', device.serial, ...args]);
      undo('remove Chrome\'s command line', () => void adb('shell', 'rm', '-f', '/data/local/tmp/chrome-command-line'));
      adb('shell', 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
      const debugApp = adb('shell', 'settings', 'get', 'global', 'debug_app').trim();
      undo('restore the debug app', () => void (debugApp === 'null' || debugApp === '' ? adb('shell', 'am', 'clear-debug-app') : adb('shell', 'am', 'set-debug-app', '--persistent', debugApp)));
      adb('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome');
      adb('reverse', `tcp:${port}`, `tcp:${port}`);
      undo('remove the adb reverse', () => void adb('reverse', '--remove', `tcp:${port}`));
    }
    const original = readAppearance(host, device);
    let current: DeviceAppearance['value'] = original.value;
    undo('restore the device\'s appearance', () => {
      if (current !== original.value) setAppearance(host, device, original.value);
    });
    const measure = (index: number): Promise<Measured> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const measured = new Promise<Measured>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${device.target}: the browser did not post assignment ${index} within 90 s`)), 90_000);
        results.set(index, (m) => {
          clearTimeout(timer);
          if (m instanceof Error) reject(m);
          else resolve(m);
        });
      });
      try {
        host.open(device, `http://127.0.0.1:${port}/page?i=${index}&n=${Date.now()}`);
      } catch (e) {
        clearTimeout(timer);
        results.delete(index);
        throw e;
      }
      return measured;
    };
    for (const [index, assignment] of t.assignments.entries()) {
      if (native !== undefined && native.assignment !== index) continue;
      const want = wantScheme(t, assignment);
      const value = device.target === 'ios' ? want : nightOf(want);
      const switched = current !== value;
      if (switched) {
        current = value;
        setAppearance(host, device, value);
      }
      let m = await measure(index);
      for (let read = 1; switched && m.probe.prefersDark !== (want === 'dark'); read++) {
        if (read >= PREFERENCE_READS) throw new Error(`${device.target} assignment ${index}: the browser still prefers ${m.probe.prefersDark ? 'dark' : 'light'} ${read} reads after the device's appearance was set to ${want}`);
        await host.wait(PREFERENCE_READ_MS);
        m = await measure(index);
      }
      browser = m.userAgent;
      browserSize = { width: anySize ? m.layoutWidth : m.innerWidth, height: m.probe.innerHeight, vh: m.probe.vh, dpr: m.dpr };
      checkBrowserPage(device.target, t, assignment, m, index, laid);
      if (screenshots !== undefined) host.screenshot(device, `${screenshots}/${device.target}-web-${index}.png`);
      const mismatch = documentMismatch(marklessDocumentTree(input, assignment.values), m.tree);
      if (mismatch !== null) throw new Error(`${device.target} assignment ${index}: the browser's document is not the input's tree: ${mismatch}`);
      rows.push(...webColumnRows(input, device.target, t.dpr, assignment, [...nameCollected(m.elements), ...m.backdrops], index, { browserDpr: m.dpr, anySize, ...(native === undefined ? {} : { phone: { boxes: native.boxes, ids: inputIds } }) }));
    }
  });
  return { browser, size: browserSize, compared: rows.length, failed: rows.filter((r) => !r.pass).length, rows };
}
