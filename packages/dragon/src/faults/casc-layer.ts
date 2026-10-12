// CASC 3: cascade layers (css-cascade-5 §6.4).

export type CascLayerFaults = {
  /** Every declaration is unlayered, as a cascade that read the rules inside @layer blocks but not their layers would. */
  readonly layersIgnored: boolean;
  /** !important declarations order the layers among themselves as normal ones do, as a cascade that never reversed them would. */
  readonly layerImportantNotReversed: boolean;
};

export const CASC_LAYER_FAULTS: CascLayerFaults = { layersIgnored: false, layerImportantNotReversed: false };
