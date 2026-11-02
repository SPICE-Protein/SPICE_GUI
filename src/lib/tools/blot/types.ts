// Western blot densitometry project model. Coordinates are normalised to the
// processed (orientation + fine-rotation applied) image, independent of crop.

export type BlotDisplay = 'gray' | 'color';
export type BlotBackgroundMode = 'ring' | 'lane' | 'global' | 'manual';
export type BlotNormalizeMode = 'none' | 'loading' | 'total';
export type BlotChartMetric = 'normalized' | 'fold';

export interface BlotAdjust {
  display: BlotDisplay;
  contrast: number;
  brightness: number;
  gamma: number;
  invert: boolean;
}

export interface BlotCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BlotBand {
  id: string;
  /** Vertical centre as a fraction of the processed image height. */
  y: number;
  /** ROI height as a fraction of the processed image height. */
  height: number;
  /** ROI width as a fraction of the processed image width. */
  width: number;
  manual?: boolean;
  excluded?: boolean;
}

export interface BlotLane {
  id: string;
  /** Lane centre as a fraction of the processed image width. */
  x: number;
  /** Lane width as a fraction of the processed image width. */
  width: number;
  name: string;
  sample: string;
  group: string;
  excluded?: boolean;
  bands: BlotBand[];
}

export interface BlotNormalization {
  mode: BlotNormalizeMode;
  loadingLaneId: string | null;
  controlGroup: string;
}

export interface BlotProject {
  version: 1;
  createdAt: string;
  updatedAt: string;
  imageName: string;
  /** Normalised PNG data URL of the imported image. */
  imageDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  adjust: BlotAdjust;
  /** Clockwise quarter turns, 0..3. */
  orient: number;
  /** Fine rotation in degrees, -15..15. */
  rotation: number;
  crop: BlotCrop;
  lanes: BlotLane[];
  normalization: BlotNormalization;
  backgroundMode: BlotBackgroundMode;
  /** Manual background level in signal units (0..1). */
  manualBackground: number;
  chartMetric: BlotChartMetric;
  title: string;
  chartTitle: string;
  exportDpi: 300 | 600;
  showRoi: boolean;
  showLaneLabels: boolean;
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function emptyProject(): BlotProject {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    imageName: '',
    imageDataUrl: '',
    sourceWidth: 0,
    sourceHeight: 0,
    adjust: {
      display: 'gray',
      contrast: 1,
      brightness: 0,
      gamma: 1,
      invert: false,
    },
    orient: 0,
    rotation: 0,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    lanes: [],
    normalization: {
      mode: 'none',
      loadingLaneId: null,
      controlGroup: '',
    },
    backgroundMode: 'ring',
    manualBackground: 0,
    chartMetric: 'normalized',
    title: '',
    chartTitle: '',
    exportDpi: 300,
    showRoi: true,
    showLaneLabels: true,
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Accepts older or hand-edited projects and repairs missing fields. */
export function sanitizeProject(input: unknown): BlotProject | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<BlotProject> & Record<string, unknown>;
  if (raw.version !== 1) return null;
  if (typeof raw.imageDataUrl !== 'string' || !raw.imageDataUrl) return null;
  const base = emptyProject();
  const adjust = (raw.adjust ?? {}) as Partial<BlotAdjust>;
  const crop = (raw.crop ?? {}) as Partial<BlotCrop>;
  const normalization = (raw.normalization ?? {}) as Partial<BlotNormalization>;
  const lanes: BlotLane[] = Array.isArray(raw.lanes)
    ? raw.lanes
        .filter((lane): lane is BlotLane => !!lane && typeof lane === 'object')
        .map((lane, index) => ({
          id: typeof lane.id === 'string' ? lane.id : newId('lane'),
          x: clamp(finiteNumber(lane.x, 0.5), 0, 1),
          width: clamp(finiteNumber(lane.width, 0.05), 0.005, 0.5),
          name: typeof lane.name === 'string' ? lane.name : String(index + 1),
          sample: typeof lane.sample === 'string' ? lane.sample : '',
          group: typeof lane.group === 'string' ? lane.group : '',
          excluded: lane.excluded === true,
          bands: Array.isArray(lane.bands)
            ? lane.bands
                .filter((band): band is BlotBand => !!band && typeof band === 'object')
                .map((band) => ({
                  id: typeof band.id === 'string' ? band.id : newId('band'),
                  y: clamp(finiteNumber(band.y, 0.5), 0, 1),
                  height: clamp(finiteNumber(band.height, 0.035), 0.004, 0.5),
                  width: clamp(finiteNumber(band.width, lane.width || 0.05), 0.004, 0.8),
                  manual: band.manual === true,
                  excluded: band.excluded === true,
                }))
            : [],
        }))
    : [];
  return {
    ...base,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    imageName: typeof raw.imageName === 'string' ? raw.imageName : '',
    imageDataUrl: raw.imageDataUrl,
    sourceWidth: finiteNumber(raw.sourceWidth, 0),
    sourceHeight: finiteNumber(raw.sourceHeight, 0),
    adjust: {
      display: adjust.display === 'color' ? 'color' : 'gray',
      contrast: clamp(finiteNumber(adjust.contrast, 1), 0.1, 5),
      brightness: clamp(finiteNumber(adjust.brightness, 0), -1, 1),
      gamma: clamp(finiteNumber(adjust.gamma, 1), 0.1, 5),
      invert: adjust.invert === true,
    },
    orient: ((finiteNumber(raw.orient, 0) % 4) + 4) % 4,
    rotation: clamp(finiteNumber(raw.rotation, 0), -15, 15),
    crop: {
      left: clamp(finiteNumber(crop.left, 0), 0, 0.9),
      top: clamp(finiteNumber(crop.top, 0), 0, 0.9),
      right: clamp(finiteNumber(crop.right, 0), 0, 0.9),
      bottom: clamp(finiteNumber(crop.bottom, 0), 0, 0.9),
    },
    lanes,
    normalization: {
      mode:
        normalization.mode === 'loading' || normalization.mode === 'total'
          ? normalization.mode
          : 'none',
      loadingLaneId:
        typeof normalization.loadingLaneId === 'string' ? normalization.loadingLaneId : null,
      controlGroup: typeof normalization.controlGroup === 'string' ? normalization.controlGroup : '',
    },
    backgroundMode:
      raw.backgroundMode === 'lane' || raw.backgroundMode === 'global' || raw.backgroundMode === 'manual'
        ? raw.backgroundMode
        : 'ring',
    manualBackground: clamp(finiteNumber(raw.manualBackground, 0), 0, 1),
    chartMetric: raw.chartMetric === 'fold' ? 'fold' : 'normalized',
    title: typeof raw.title === 'string' ? raw.title : '',
    chartTitle: typeof raw.chartTitle === 'string' ? raw.chartTitle : '',
    exportDpi: raw.exportDpi === 600 ? 600 : 300,
    showRoi: raw.showRoi !== false,
    showLaneLabels: raw.showLaneLabels !== false,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Project snapshot without the image payload, used by undo/redo. */
export function snapshotProject(project: BlotProject): string {
  const { imageDataUrl: _image, ...rest } = project;
  void _image;
  return JSON.stringify(rest);
}

export function restoreSnapshot(snapshot: string, imageDataUrl: string): BlotProject | null {
  try {
    const parsed = JSON.parse(snapshot) as Partial<BlotProject>;
    return sanitizeProject({ ...parsed, imageDataUrl });
  } catch {
    return null;
  }
}
