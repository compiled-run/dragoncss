// glyph-b3 --write-bottom-pins's worker: the bottom-scanline counts of its share of the (target, DPR, case) items, in item order.
import { parentPort, workerData } from 'node:worker_threads';
import type { NativeProgram } from 'dragon';
import { bottomScanlines } from '../pixel-reference.ts';

export type PinItem = { readonly program: NativeProgram; readonly viewport: { readonly width: number; readonly height: number }; readonly dpr: number };

parentPort?.postMessage((workerData as readonly PinItem[]).map((it) => bottomScanlines(it.program, it.viewport, it.dpr)));
