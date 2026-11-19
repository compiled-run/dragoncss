// The web column of a Markless export with system fonts: every frame of every assignment against the boxes the phone's own browser
// lays the same element tree out at (Safari in an iOS simulator, Chrome on an Android emulator), under the device lanes' gate.
// Chrome on the Mac stands in for neither phone's system fonts on iOS (markless-style-compare.ts), so the phones measure it.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { authoredFontHtml } from './cases.ts';
import { collectNodes } from './capture.ts';
import type { CapturedNode } from './capture.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import { marklessDocumentHtml } from './markless-style-compare.ts';
import type { CompareRow } from './markless-style-compare.ts';
import type { MarklessFontFile, MarklessStyleInput } from './markless-style-input.ts';
import type { NativeStyleExport } from './native-style-export.ts';

/** A phone whose browser measures the page: an iOS simulator by UDID (Safari), or an Android emulator by adb serial (Chrome). */
export type WebColumnDevice = { readonly target: 'ios'; readonly udid: string } | { readonly target: 'android'; readonly serial: string };

/** A compared box: the gate's row, with both frames in device px from the page's top left. */
export type WebColumnRow = CompareRow & { readonly web: Frame; readonly dragon: Frame };
type Frame = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
type Measured = { readonly dpr: number; readonly innerWidth: number; readonly innerHeight: number; readonly vh: number; readonly layoutWidth: number; readonly nodes: readonly CapturedNode[]; readonly userAgent: string };

const run = (cmd: string, args: readonly string[]): string => execFileSync(cmd, [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The page of one assignment: the comparison's document with system fonts, and a script that posts every box back. */
function pageOf(input: MarklessStyleInput, values: Readonly<Record<string, unknown>>, files: ReadonlyMap<string, Uint8Array>, post: string, width: number | null): string {
  const html = authoredFontHtml(marklessDocumentHtml(input, values, 'system'), files);
  // The export lays out at whole CSS px (a Pixel 7 is 411.43 wide); the root box takes that width so both lay out the same line length.
  const viewport = `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="format-detection" content="telephone=no, date=no, address=no, email=no"><style>:where(html){-webkit-text-size-adjust:100%;text-size-adjust:100%${width === null ? '' : `;width:${width}px`}}</style>`;
  const script = `<script>addEventListener('load',()=>document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const nodes=(${collectNodes.toString()})([]);const probe=document.createElement('div');probe.style.cssText='position:absolute;top:0;left:0;width:0;height:100vh';document.body.appendChild(probe);const vh=probe.getBoundingClientRect().height;probe.remove();fetch(${JSON.stringify(post)},{method:'POST',body:JSON.stringify({dpr:devicePixelRatio,innerWidth,innerHeight,vh,layoutWidth:document.documentElement.clientWidth,userAgent:navigator.userAgent,nodes})});}))));</script>`;
  return html.replace('<head>', `<head>\n${viewport}`).replace('</body>', `${script}</body>`);
}

/** Opens a URL in the device's browser; Chrome starts with its first-run screens off (a debug-app command line). */
function open(device: WebColumnDevice, url: string): void {
  if (device.target === 'ios') {
    run('xcrun', ['simctl', 'openurl', device.udid, url]);
    return;
  }
  const adb = (...args: string[]): string => run('adb', ['-s', device.serial, ...args]);
  adb('shell', 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line');
  adb('shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome');
  // One tab for every page: Chrome reuses the tab an application id opened, so a run does not pile up tabs.
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, '--es', 'com.android.browser.application_id', 'dragon-web-column', 'com.android.chrome');
}

function screenshot(device: WebColumnDevice, file: string): void {
  if (device.target === 'ios') run('xcrun', ['simctl', 'io', device.udid, 'screenshot', file]);
  else execFileSync('sh', ['-c', `adb -s "$1" exec-out screencap -p > "$2"`, 'sh', device.serial, file]);
}

/** The browser's own layout size: whole CSS px wide and tall, at its device pixel ratio. */
export type BrowserSize = { readonly width: number; readonly height: number; readonly vh: number; readonly dpr: number };

/**
 * Measures every assignment of the export's target on the device and compares its frames. The page is served on 127.0.0.1
 * (an emulator reaches it through adb reverse). The device must show the export's viewport width in CSS px, unless `anySize`:
 * then the browser lays the page out at the device's own width, and the export's frames are compared as a host draws them on
 * that device (each frame's CSS px, export px / export dpr, at the device's dpr).
 */
/** What a phone drew: one assignment's boxes in points (iOS) or dp (Android) from the page's top left, by node id. */
export type NativeLayout = { readonly assignment: number; readonly boxes: ReadonlyMap<string, Frame> };

export async function webColumn(input: MarklessStyleInput, exported: NativeStyleExport, device: WebColumnDevice, fonts: readonly MarklessFontFile[] = [], screenshots?: string, anySize = false, native?: NativeLayout): Promise<{ readonly browser: string; readonly size: BrowserSize; readonly compared: number; readonly failed: number; readonly rows: readonly WebColumnRow[] }> {
  const t = exported.targets[device.target];
  if (t === undefined) throw new Error(`the export has no ${device.target} target`);
  const files = new Map(fonts.map((f) => [f.url, f.bytes]));
  const inputIds = new Set(input.nodes.map((n) => n.id));
  const results = new Map<number, (m: Measured) => void>();
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const i = Number(u.searchParams.get('i'));
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
        results.get(i)?.(JSON.parse(body) as Measured);
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(pageOf(input, assignment.values, files, `/result?i=${i}`, anySize ? null : t.viewport.width));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const rows: WebColumnRow[] = [];
  let browser = '';
  let size: BrowserSize = { width: 0, height: 0, vh: 0, dpr: 0 };
  try {
    if (device.target === 'android') run('adb', ['-s', device.serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    for (const [index, assignment] of t.assignments.entries()) {
      if (native !== undefined && native.assignment !== index) continue;
      const measured = new Promise<Measured>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${device.target}: the browser did not post assignment ${index} within 90 s`)), 90_000);
        results.set(index, (m) => {
          clearTimeout(timer);
          resolve(m);
        });
      });
      open(device, `http://127.0.0.1:${port}/page?i=${index}&n=${Date.now()}`);
      const m = await measured;
      browser = m.userAgent;
      size = { width: anySize ? m.layoutWidth : m.innerWidth, height: m.innerHeight, vh: m.vh, dpr: m.dpr };
      if (!anySize && (Math.abs(m.dpr - t.dpr) > 1e-6 || Math.abs(m.innerWidth - t.viewport.width) > 1)) throw new Error(`${device.target}: the browser lays out ${m.innerWidth} CSS px at ${m.dpr}x, the export ${t.viewport.width} at ${t.dpr}x; use the export's proof device`);
      if (screenshots !== undefined) screenshot(device, `${screenshots}/${device.target}-web-${index}.png`);
      const byId = new Map(assignment.nodes.map((n) => [n.id, n]));
      const absolute = (id: string): Frame => {
        const n = byId.get(id);
        if (n === undefined || n.frame === null) throw new Error(`${id} has no frame`);
        const p = n.parent === null ? { x: 0, y: 0 } : absolute(n.parent);
        return { x: p.x + n.frame.x, y: p.y + n.frame.y, width: n.frame.width, height: n.frame.height };
      };
      for (const c of m.nodes) {
        const node = byId.get(c.id);
        if (!c.hasBox || c.kind === 'line' || node === undefined || node.frame === null) continue;
        // A phone draws the input's nodes; Dragon's html and body place them and have no view of their own.
        if (native !== undefined && !inputIds.has(c.id)) continue;
        const scale = anySize ? m.dpr / t.dpr : 1;
        const drawn = native?.boxes.get(c.id);
        if (native !== undefined && drawn === undefined) throw new Error(`${device.target}: the phone drew no box for ${c.id}, which the browser lays out`);
        const e = drawn === undefined ? absolute(c.id) : { x: drawn.x * t.dpr, y: drawn.y * t.dpr, width: drawn.width * t.dpr, height: drawn.height * t.dpr };
        const d = { x: e.x * scale, y: e.y * scale, width: e.width * scale, height: e.height * scale };
        const web = { x: c.x * m.dpr, y: c.y * m.dpr, width: c.width * m.dpr, height: c.height * m.dpr };
        const delta = Math.max(...(['x', 'y', 'width', 'height'] as const).map((k) => Math.abs(web[k] - d[k])));
        const round = (f: Frame): Frame => ({ x: Number(f.x.toFixed(4)), y: Number(f.y.toFixed(4)), width: Number(f.width.toFixed(4)), height: Number(f.height.toFixed(4)) });
        rows.push({ target: device.target, values: assignment.values, id: c.id, maxDeltaDevicePx: Number(delta.toFixed(4)), pass: delta <= GATE_DEVICE_PX, web: round(web), dragon: round(d) });
      }
    }
  } finally {
    if (device.target === 'android') {
      run('adb', ['-s', device.serial, 'reverse', '--remove', `tcp:${port}`]);
      run('adb', ['-s', device.serial, 'shell', 'rm', '-f', '/data/local/tmp/chrome-command-line']);
    }
    server.closeAllConnections();
    server.close();
  }
  return { browser, size, compared: rows.length, failed: rows.filter((r) => !r.pass).length, rows };
}
