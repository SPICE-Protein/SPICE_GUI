// Gel figure project model (v2).
//
// Coordinates are normalised to the *processed full image* (orientation and
// fine rotation applied, before cropping), so changing the crop only selects
// which wells are shown and never moves names, markers or annotations.
import type { GelKind } from './ladders';
import { defaultDetectConfig, type GelDetectConfig } from './presets';

export type GelType = GelKind;
export type DisplayMode = 'gray' | 'color';
export type Unit = 'bp' | 'kDa';

export interface GelExposure {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  mime: string;
  /** Raw file bytes, base64. Kept for the "original data" export. */
  originalBase64?: string;
  sha256?: string;
}

export interface GelBand {
  /** Normalised y in the processed full image. */
  y: number;
  intensity: number;
  size?: number;
  /** Label/tick visible on the figure. Hiding keeps calibration. */
  showSize?: boolean;
  /** Typed in by hand instead of fitted; survives re-fitting of others. */
  manual?: boolean;
  /** Size lies outside the ladder range or disagrees between markers. */
  approx?: boolean;
  /** Non-specific band mark: '*' | '#' | '†'. */
  mark?: string;
  hidden?: boolean;
}

export interface LaneStyle {
  fontSize?: number;
  angle?: number;
  italic?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  red?: boolean;
}

export interface GelLane {
  id: string;
  /** Normalised x in the processed full image. */
  x: number;
  /** Normalised lane width used for band detection. */
  width: number;
  name: string;
  isMarker: boolean;
  ladderId?: string;
  bands: GelBand[];
  /** Lane removed from the figure but kept in the project/report. */
  removed?: boolean;
  splice?: 'none' | 'gap' | 'line';
  style?: LaneStyle;
}

export interface GelGroup {
  id: string;
  name: string;
  laneIds: string[];
}

export interface ConditionRow {
  id: string;
  label: string;
  /** laneId -> '+' | '-' | '' */
  cells: Record<string, string>;
}

export interface GelLadderFit {
  ladderId: string;
  laneIds: string[];
  /** log10(size) = a + b*y + c*y^2 (c = 0 for a straight fit). */
  a: number;
  b: number;
  c: number;
  degree: 1 | 2;
  r2: number;
  n: number;
}

export type AnnotationColor = 'default' | 'red';

export interface ArrowAnnotation {
  id: string;
  type: 'arrow';
  laneId: string;
  bandIndex: number;
  side: 'left' | 'right';
  label?: string;
  color: AnnotationColor;
  fontSize?: number;
}

export interface BoxAnnotation {
  id: string;
  type: 'box';
  /** Normalised to the processed full image. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** Draw an enlarged copy beside the gel. */
  enlarge: boolean;
  color: AnnotationColor;
  fontSize?: number;
}

export interface BracketAnnotation {
  id: string;
  type: 'bracket';
  /** Vertical brackets span y; horizontal brackets span x. */
  side: 'left' | 'right' | 'top' | 'bottom';
  /** Normalised start/end along the bracket axis (y for left/right, x for top/bottom). */
  start: number;
  end: number;
  label: string;
  color: AnnotationColor;
  fontSize?: number;
}

export interface SideTextAnnotation {
  id: string;
  type: 'sideText';
  side: 'left' | 'right' | 'top' | 'bottom';
  /** 0..1 along the edge. */
  pos: number;
  text: string;
  color: AnnotationColor;
  fontSize?: number;
}

export type Annotation = ArrowAnnotation | BoxAnnotation | BracketAnnotation | SideTextAnnotation;

export type FontFamily = 'Arial' | 'Times New Roman' | 'Helvetica' | 'Calibri' | 'Cambria';

export interface GelLayoutSettings {
  fontFamily: FontFamily;
  nameFontSize: number;
  labelFontSize: number;
  /** Degrees, 0 keeps horizontal names. */
  nameAngle: number;
  /** Red annotations and lane names on request. */
  red: boolean;
  /** Default false: names hug the gel, condition rows stack below them. */
  conditionsNearestGel: boolean;
  /** Printed figure width in millimetres. */
  figureWidthMm: number;
  /** Group labels that do not fit: wrap, shrink or one line. */
  groupLabelFit: 'wrap' | 'shrink' | 'one';
}

export interface GelProject {
  version: 2;
  imageName: string;
  exposures: GelExposure[];
  activeExposureId: string;
  display: DisplayMode;
  /** Fine rotation, -45..45 degrees. */
  rotation: number;
  /** Quarter turns clockwise, 0..3. */
  orient: number;
  mirrorH: boolean;
  mirrorV: boolean;
  /** Grayscale remains the default for publication figures. */
  adjust: {
    grayscale: boolean;
    invert: boolean;
    contrast: number;
    brightness: number;
    gamma: number;
    gammaLocked: boolean;
  };
  crop: { left: number; top: number; right: number; bottom: number };
  gelType: GelType;
  /** Stain preset and advanced lane/band detection settings. */
  detect: GelDetectConfig;
  unit: Unit;
  ladderId: string;
  /** Local, project-resident ladder definitions. */
  customLadders: import('./ladders').LadderDef[];
  /** Ladder ids the user actually uses; preferred when matching. */
  favorites: string[];
  lanes: GelLane[];
  groups: GelGroup[];
  conditionRows: ConditionRow[];
  annotations: Annotation[];
  layout: GelLayoutSettings;
  fit: GelLadderFit | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function newId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export const newLaneId = () => newId('lane');

export function emptyLayout(): GelLayoutSettings {
  return {
    fontFamily: 'Arial',
    nameFontSize: 9,
    labelFontSize: 8,
    nameAngle: 0,
    red: false,
    conditionsNearestGel: false,
    figureWidthMm: 120,
    groupLabelFit: 'wrap',
  };
}

export function emptyProject(): GelProject {
  const now = new Date().toISOString();
  return {
    version: 2,
    imageName: '',
    exposures: [],
    activeExposureId: '',
    display: 'gray',
    rotation: 0,
    orient: 0,
    mirrorH: false,
    mirrorV: false,
    adjust: {
      grayscale: true,
      invert: false,
      contrast: 1,
      brightness: 0,
      gamma: 1,
      gammaLocked: true,
    },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    gelType: 'dna',
    detect: defaultDetectConfig(),
    unit: 'bp',
    ladderId: 'gr1kb',
    customLadders: [],
    favorites: [],
    lanes: [],
    groups: [],
    conditionRows: [],
    annotations: [],
    layout: emptyLayout(),
    fit: null,
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function activeExposure(p: GelProject): GelExposure | null {
  return p.exposures.find((e) => e.id === p.activeExposureId) ?? p.exposures[0] ?? null;
}

export function touch(p: GelProject) {
  p.updatedAt = new Date().toISOString();
}

/** v1 projects stored a single image and a flat ladder-size list. */
export interface GelProjectV1 {
  version: 1;
  imageName: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  rotation: number;
  adjust: GelProject['adjust'];
  crop: GelProject['crop'];
  lanes: GelLane[];
  groups: GelGroup[];
  ladderSizes: number[];
  unit: Unit;
}

export function isGelProject(value: unknown): value is GelProject {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<GelProject>;
  return (
    v.version === 2 &&
    Array.isArray(v.exposures) &&
    Array.isArray(v.lanes) &&
    Array.isArray(v.annotations) &&
    !!v.layout &&
    !!v.adjust &&
    !!v.crop
  );
}

export function migrateV1(v1: GelProjectV1): GelProject {
  const p = emptyProject();
  const exposure: GelExposure = {
    id: newId('exp'),
    name: v1.imageName || 'image',
    dataUrl: v1.imageDataUrl,
    width: v1.imageWidth,
    height: v1.imageHeight,
    mime: 'image/png',
  };
  p.imageName = v1.imageName;
  p.exposures = [exposure];
  p.activeExposureId = exposure.id;
  p.rotation = v1.rotation ?? 0;
  p.adjust = { ...p.adjust, ...v1.adjust, gammaLocked: true };
  p.crop = { ...p.crop, ...v1.crop };
  p.unit = v1.unit === 'kDa' ? 'kDa' : 'bp';
  p.gelType = p.unit === 'kDa' ? 'protein' : 'dna';
  p.lanes = (v1.lanes ?? []).map((l) => ({
    ...l,
    bands: (l.bands ?? []).map((b) => ({ ...b, showSize: b.showSize ?? true })),
  }));
  p.groups = v1.groups ?? [];
  // A one-off ladder defined by the old size list is preserved as a custom one.
  const sizes = [...(v1.ladderSizes ?? [])].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => b - a);
  if (sizes.length >= 2) {
    const def = { id: newId('custom'), name: `Custom ladder (${sizes.length} bands)`, kind: p.gelType, sizes, ref: [], custom: true };
    p.customLadders = [def];
    p.ladderId = def.id;
  } else {
    p.ladderId = p.gelType === 'protein' ? 'biorad_dual' : 'gr1kb';
  }
  return p;
}

/** Snapshot for localStorage: drop the raw originals, which can be huge. */
export function forStorage(p: GelProject): GelProject {
  return {
    ...p,
    exposures: p.exposures.map((e) => ({ ...e, originalBase64: undefined })),
  };
}
