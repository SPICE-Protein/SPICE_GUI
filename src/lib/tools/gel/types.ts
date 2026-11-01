/** Gel figure tool — project model.
 *
 *  All spatial values are normalized against the CROPPED image (fractions
 *  0..1), so changing the crop % never invalidates lane/band annotations.
 *  The crop is applied after rotation. */

export interface GelAdjustments {
  grayscale: boolean;
  invert: boolean;
  contrast: number;   // 0..2, 1 = unchanged
  brightness: number; // -1..1, 0 = unchanged
  gamma: number;      // 0.2..3, 1 = unchanged
}

export interface GelBand {
  /** Row position as a fraction of the cropped image height (0 = top). */
  y: number;
  /** Peak intensity (0..1) used for display emphasis. */
  intensity: number;
  /** Estimated size in the gel's unit, once a marker ladder is fitted. */
  size?: number;
  /** Draw the size label next to this band in exports. */
  showSize?: boolean;
}

export interface GelLane {
  id: string;
  /** Lane center as a fraction of the cropped image width (0..1). */
  x: number;
  /** Lane width as a fraction of the cropped image width. */
  width: number;
  name: string;
  isMarker: boolean;
  bands: GelBand[];
}

export interface GelGroup {
  id: string;
  name: string;
  laneIds: string[];
}

export interface GelCrop {
  left: number;   // fractions of the rotated image, each 0..1
  top: number;
  right: number;
  bottom: number;
}

export interface GelProject {
  version: 1;
  imageName: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  rotation: number;           // degrees applied before cropping
  adjust: GelAdjustments;
  crop: GelCrop;
  lanes: GelLane[];
  groups: GelGroup[];
  /** Marker ladder sizes, descending, in the project unit. */
  ladderSizes: number[];
  /** Unit shown by the tool: DNA in bp, protein in kDa. */
  unit: 'bp' | 'kDa';
}

export function emptyProject(): GelProject {
  return {
    version: 1,
    imageName: '',
    imageDataUrl: '',
    imageWidth: 0,
    imageHeight: 0,
    rotation: 0,
    adjust: { grayscale: true, invert: false, contrast: 1, brightness: 0, gamma: 1 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    lanes: [],
    groups: [],
    ladderSizes: [5000, 3000, 2000, 1000, 750, 500, 250, 100],
    unit: 'bp',
  };
}

let laneCounter = 0;
export function newLaneId(): string {
  laneCounter += 1;
  // Deterministic-ish unique id; projects persist ids as strings.
  return `lane_${Date.now().toString(36)}_${laneCounter}`;
}
