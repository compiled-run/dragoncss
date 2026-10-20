// MQ-R1 (notes/T067-mq-r-spec.md R5): the TypeScript reference of the runtime that switches @media bands, over a compile's band
// program (dragon lower/band-program.ts). The host resize lanes (resize-capture.ts) judge it against Chrome, and the generated
// Swift and Kotlin runtimes follow it. It lives here, not in the core, because it runs the layout engine's band lookup, and the
// core imports the engine for types only.
import { rtBand } from '@dragon/layout';
import type { BandRuntimeFaults, MediaDevice, NativeProgram, Scalar, StateFaults, StateProgram } from 'dragon';
import { BAND_KEY, bandEnvironmentOf, bandOf, BandProgramError, bandStateIndex, DESKTOP_DEVICE, NO_BAND_RUNTIME_FAULTS, NO_STATE_FAULTS, StateRuntime } from 'dragon';

export type RootSize = { readonly widthPx: number; readonly heightPx: number };

/**
 * The TypeScript reference of the generated media runtime: a root of whole device px at a DPR, the state runtime over the band
 * program, and the viewport the engine lays out at (the root's px / dpr). Each size change is one event: the band of the new size
 * first, its delta through env#band if it changed, then one layout at the new size. App setters go through set(), which refuses
 * env#band. layouts counts the layouts a mount would run. MQ-R2: the device's readings (pointer, hover, reduced motion; its scale
 * is dpr) answer the device atoms; a reading change is one event too: the band of the new readings, its delta if it changed.
 */
export class MediaRuntime {
  readonly states: StateRuntime;
  readonly table: rtBand.BandTable;
  readonly dpr: number;
  private readonly faults: BandRuntimeFaults;
  private readonly bandState: number;
  private size: RootSize;
  private device: MediaDevice;
  private laidOutSize: RootSize;
  private laidOutProgram: NativeProgram;
  private count = 0;

  constructor(sp: StateProgram, table: rtBand.BandTable, dpr: number, root: RootSize, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS, stateFaults: StateFaults = NO_STATE_FAULTS, device: MediaDevice = DESKTOP_DEVICE) {
    this.bandState = bandStateIndex(sp);
    const domain = (sp.states[this.bandState] as StateProgram['states'][number]).domain;
    if (domain.length !== table.bands.length || domain.some((v, k) => v !== k)) throw new BandProgramError(`${BAND_KEY} has the domain ${JSON.stringify(domain)}, not the ${table.bands.length} bands of the table`);
    this.table = table;
    this.dpr = dpr;
    this.faults = faults;
    this.states = new StateRuntime(sp, stateFaults);
    this.size = root;
    this.device = { ...device, dpr };
    this.laidOutSize = root;
    // The mount's first render is in the root's own band.
    this.moveBand(this.bandAt(root));
    this.laidOutProgram = this.states.program();
    this.count = 1;
    this.states.onChange = () => {
      this.layout();
    };
  }

  /** The band the table gives a root size. */
  bandAt(root: RootSize, device: MediaDevice = this.device): number {
    return rtBand.bandAtPx(this.table, root.widthPx, root.heightPx, bandEnvironmentOf({ ...device, dpr: this.dpr }), this.faults);
  }

  /** The readings the device atoms answer from (the scale is always dpr). */
  get readings(): MediaDevice {
    return this.device;
  }

  /** MQ-R2: new readings (an injected env step or a platform change): the band of the root on them, its delta if it moved. */
  setDevice(device: MediaDevice): void {
    this.device = { ...device, dpr: this.dpr };
    this.moveBand(this.bandAt(this.size));
  }

  get band(): number {
    return bandOf(this.states.sp, this.states.assignment);
  }

  get layouts(): number {
    return this.count;
  }

  /** An app setter: env#band is internal and cannot be set. */
  set(key: string, value: Scalar): void {
    if (key === BAND_KEY) throw new BandProgramError(`${BAND_KEY} is set by the root size, not by the app`);
    this.states.set(key, value);
  }

  /** One root size change: the new band's delta, then one layout at the new size. */
  resize(root: RootSize): void {
    if (this.faults.resizeSkipsRelayout) return;
    const to = this.bandAt(root);
    this.size = root;
    if (this.faults.bandStale) {
      // Planted: the layout at the new size runs before the band delta, and the band moves silently afterwards.
      this.layout();
      const listener = this.states.onChange;
      this.states.onChange = null;
      try {
        this.moveBand(to);
      } finally {
        this.states.onChange = listener;
      }
      return;
    }
    if (to === this.band) this.layout();
    else this.moveBand(to);
  }

  private moveBand(to: number): void {
    if (to !== this.band) this.states.set(BAND_KEY, to);
  }

  private layout(): void {
    this.laidOutSize = this.size;
    this.laidOutProgram = this.states.program();
    this.count++;
  }

  /** The program on screen: the records and engine input of the last layout. */
  program(): NativeProgram {
    return this.laidOutProgram;
  }

  /** The viewport of the last layout, in CSS px. */
  viewport(): { readonly width: number; readonly height: number } {
    return { width: this.laidOutSize.widthPx / this.dpr, height: this.laidOutSize.heightPx / this.dpr };
  }
}
