// CASC 3: cascade layers (css-cascade-5 §6.4).

export type CascLayerFaults = {
  /** Every declaration is unlayered, as a cascade that read the rules inside @layer blocks but not their layers would. */
  readonly layersIgnored: boolean;
  /** !important declarations order the layers among themselves as normal ones do, as a cascade that never reversed them would. */
  readonly layerImportantNotReversed: boolean;
  /** revert-layer rolls back to the user-agent origin as revert does, as a cascade that never looked at the layers below would. */
  readonly revertLayerAsRevert: boolean;
};

export const CASC_LAYER_FAULTS: CascLayerFaults = { layersIgnored: false, layerImportantNotReversed: false, revertLayerAsRevert: false };
