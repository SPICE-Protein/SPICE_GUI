// Data model for the colony counter. All marker coordinates and areas are
// expressed in the current working-image pixel space (see imaging.ts) so they
// survive rotation, cropping and detection downscaling.

export type ColonyPolarity = 'auto' | 'dark' | 'bright';
export type ColonySource = 'auto' | 'manual';

export interface ColonyAdjust {
  grayscale: boolean;
  invert: boolean;
  /** -100..100, added after contrast. */
  brightness: number;
  /** 0.1..3, applied around mid-gray. */
  contrast: number;
}

export interface ColonyCrop {
  /** Fractions of the rotated image removed from each edge (0..0.4). */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ColonyParams {
  autoThreshold: boolean;
  /** Manual threshold in 0..255 gray levels. */
  manualThreshold: number;
  /** Gaussian blur radius in working-image pixels. */
  blurRadius: number;
  /** Minimum object area in working-image px squared (0 disables). */
  minArea: number;
  /** Maximum object area in working-image px squared (0 disables). */
  maxArea: number;
  /** Minimum circularity 0..1 (0 disables). */
  minCircularity: number;
  splitTouching: boolean;
  polarity: ColonyPolarity;
}

export interface ColonyMarker {
  id: number;
  /** Centroid in working-image canvas coordinates. */
  x: number;
  y: number;
  /** Equivalent radius in working-image pixels. */
  radius: number;
  area: number;
  /** Mean adjusted intensity 0..255 inside the object. */
  meanIntensity: number;
  circularity: number;
  included: boolean;
  source: ColonySource;
}

export interface ColonyProject {
  version: 1;
  savedAt: string;
  imageDataUrl: string;
  imageName: string;
  /** Dimensions of the decoded source image. */
  imageWidth: number;
  imageHeight: number;
  /** Dimensions of the working image the markers refer to. */
  workWidth: number;
  workHeight: number;
  rotate: number;
  crop: ColonyCrop;
  adjust: ColonyAdjust;
  params: ColonyParams;
  markers: ColonyMarker[];
  dpi: 300 | 600;
  dilutionFactor: number;
  platedVolume: number;
}

export interface ColonyStats {
  total: number;
  included: number;
  excluded: number;
  manual: number;
  meanArea: number;
  medianArea: number;
  meanIntensity: number;
  meanCircularity: number;
}

export function defaultAdjust(): ColonyAdjust {
  return { grayscale: true, invert: false, brightness: 0, contrast: 1 };
}

export function defaultCrop(): ColonyCrop {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

export function defaultParams(): ColonyParams {
  return {
    autoThreshold: true,
    manualThreshold: 128,
    blurRadius: 1,
    minArea: 30,
    maxArea: 0,
    minCircularity: 0,
    splitTouching: true,
    polarity: 'auto',
  };
}

export function emptyProject(): ColonyProject {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    imageDataUrl: '',
    imageName: '',
    imageWidth: 0,
    imageHeight: 0,
    workWidth: 0,
    workHeight: 0,
    rotate: 0,
    crop: defaultCrop(),
    adjust: defaultAdjust(),
    params: defaultParams(),
    markers: [],
    dpi: 300,
    dilutionFactor: 1e6,
    platedVolume: 0.1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Runtime validation for imported project files and stored snapshots. */
export function isColonyProject(value: unknown): value is ColonyProject {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.imageDataUrl !== 'string') return false;
  if (typeof value.imageName !== 'string') return false;
  if (!isRecord(value.crop) || !isRecord(value.adjust) || !isRecord(value.params)) return false;
  if (!Array.isArray(value.markers)) return false;
  return value.markers.every(
    (marker) =>
      isRecord(marker) &&
      typeof marker.id === 'number' &&
      typeof marker.x === 'number' &&
      typeof marker.y === 'number' &&
      typeof marker.area === 'number' &&
      typeof marker.radius === 'number' &&
      typeof marker.meanIntensity === 'number' &&
      typeof marker.circularity === 'number' &&
      typeof marker.included === 'boolean' &&
      (marker.source === 'auto' || marker.source === 'manual'),
  );
}

/** Fill fields that may be missing from older or hand-edited snapshots. */
export function normalizeProject(project: ColonyProject): ColonyProject {
  const base = emptyProject();
  const params = { ...base.params, ...project.params };
  return {
    ...base,
    ...project,
    crop: { ...base.crop, ...project.crop },
    adjust: { ...base.adjust, ...project.adjust },
    params,
    markers: project.markers.map((marker, index) => ({
      ...marker,
      id: Number.isFinite(marker.id) ? marker.id : index + 1,
      radius: Number.isFinite(marker.radius) ? marker.radius : Math.sqrt(Math.max(0, marker.area) / Math.PI),
      included: marker.included !== false,
      source: marker.source === 'manual' ? 'manual' : 'auto',
    })),
  };
}
