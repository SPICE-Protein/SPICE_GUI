// Gel project document helpers shared by the SPICE_PROJECT bridge, the
// reproducible bundle and the folder batch mode.
//
// The sanitizer is deliberately defensive: project documents travel through
// localStorage, .spiceproj files and handoffs, so a single bad number must not
// break the editor. It keeps the v1 migration path and normalises every field
// the figure renderer reads.
import type {
  Annotation,
  ArrowAnnotation,
  BoxAnnotation,
  BracketAnnotation,
  ConditionRow,
  GelBand,
  GelExposure,
  GelGroup,
  GelLadderFit,
  GelLane,
  GelLayoutSettings,
  GelProject,
  GelProjectV1,
  LaneStyle,
  SideTextAnnotation,
  Unit,
} from './types';
import { activeExposure, emptyProject, isGelProject, migrateV1, newId, newLaneId } from './types';
import { ladderById, normalizeSizes, type LadderDef } from './ladders';
import { buildFigure } from './figure';
import { rasterizeFigure } from './render';
import { loadImageElement, renderProcessed } from './pipeline';
import { canvasPreview } from '$lib/tools/shared/preview';

const SIDES = ['left', 'right', 'top', 'bottom'] as const;
type Side = (typeof SIDES)[number];

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asSide(value: unknown, fallback: Side = 'left'): Side {
  return SIDES.includes(value as Side) ? (value as Side) : fallback;
}

function sanitizeLadders(value: unknown): LadderDef[] {
  if (!Array.isArray(value)) return [];
  const out: LadderDef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const l = raw as Record<string, unknown>;
    if (typeof l.id !== 'string' || !l.id || typeof l.name !== 'string') continue;
    const sizes = normalizeSizes(
      Array.isArray(l.sizes) ? l.sizes.filter((n): n is number => typeof n === 'number') : [],
    );
    if (sizes.length < 2) continue;
    const ref = normalizeSizes(
      Array.isArray(l.ref) ? l.ref.filter((n): n is number => typeof n === 'number') : [],
    ).filter((n) => sizes.includes(n));
    out.push({
      id: l.id,
      name: l.name,
      kind: l.kind === 'protein' ? 'protein' : 'dna',
      sizes,
      ref,
      custom: true,
    });
  }
  return out;
}

function sanitizeLaneStyle(value: unknown): LaneStyle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const style: LaneStyle = {};
  if (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize)) {
    style.fontSize = clamp(raw.fontSize, 4, 40);
  }
  if (typeof raw.angle === 'number' && Number.isFinite(raw.angle)) {
    style.angle = clamp(raw.angle, -90, 90);
  }
  if (raw.italic === true) style.italic = true;
  if (raw.superscript === true) style.superscript = true;
  if (raw.subscript === true) style.subscript = true;
  if (raw.red === true) style.red = true;
  return Object.keys(style).length ? style : undefined;
}

function sanitizeBands(value: unknown): GelBand[] {
  if (!Array.isArray(value)) return [];
  const out: GelBand[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    const band: GelBand = {
      y: clamp(num(b.y, 0), 0, 1),
      intensity: num(b.intensity, 0),
      showSize: b.showSize !== false,
    };
    if (typeof b.size === 'number' && Number.isFinite(b.size) && b.size > 0) band.size = b.size;
    if (b.manual === true) band.manual = true;
    if (b.approx === true) band.approx = true;
    if (typeof b.mark === 'string' && b.mark) band.mark = b.mark;
    if (b.hidden === true) band.hidden = true;
    out.push(band);
  }
  return out;
}

function sanitizeLanes(value: unknown): GelLane[] {
  if (!Array.isArray(value)) return [];
  const out: GelLane[] = [];
  const used = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const l = raw as Record<string, unknown>;
    let id = typeof l.id === 'string' && l.id && !used.has(l.id) ? l.id : newLaneId();
    while (used.has(id)) id = newLaneId();
    used.add(id);
    const lane: GelLane = {
      id,
      x: clamp(num(l.x, 0.5), 0, 1),
      width: clamp(num(l.width, 0.05), 0.005, 1),
      name: typeof l.name === 'string' ? l.name : String(index + 1),
      isMarker: l.isMarker === true,
      bands: sanitizeBands(l.bands),
    };
    if (typeof l.ladderId === 'string') lane.ladderId = l.ladderId;
    if (l.removed === true) lane.removed = true;
    if (l.splice === 'gap' || l.splice === 'line') lane.splice = l.splice;
    const style = sanitizeLaneStyle(l.style);
    if (style) lane.style = style;
    out.push(lane);
  }
  return out;
}

function sanitizeGroups(value: unknown, laneIds: Set<string>): GelGroup[] {
  if (!Array.isArray(value)) return [];
  const out: GelGroup[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    if (typeof g.id !== 'string' || !g.id) continue;
    const ids = Array.isArray(g.laneIds)
      ? [...new Set(g.laneIds.filter((id): id is string => typeof id === 'string' && laneIds.has(id)))]
      : [];
    if (!ids.length) continue;
    out.push({ id: g.id, name: asString(g.name), laneIds: ids });
  }
  return out;
}

function sanitizeConditionRows(value: unknown, laneIds: Set<string>): ConditionRow[] {
  if (!Array.isArray(value)) return [];
  const out: ConditionRow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id) continue;
    const cells: Record<string, string> = {};
    if (row.cells && typeof row.cells === 'object') {
      for (const [laneId, mark] of Object.entries(row.cells as Record<string, unknown>)) {
        if (laneIds.has(laneId) && typeof mark === 'string') cells[laneId] = mark;
      }
    }
    out.push({ id: row.id, label: asString(row.label), cells });
  }
  return out;
}

function sanitizeAnnotations(value: unknown, laneIds: Set<string>): Annotation[] {
  if (!Array.isArray(value)) return [];
  const out: Annotation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const id = typeof a.id === 'string' && a.id ? a.id : newId('ann');
    const color = a.color === 'red' ? 'red' : 'default';
    const fontSize =
      typeof a.fontSize === 'number' && Number.isFinite(a.fontSize)
        ? clamp(a.fontSize, 4, 60)
        : undefined;
    if (a.type === 'arrow') {
      if (typeof a.laneId !== 'string' || !laneIds.has(a.laneId)) continue;
      const bandIndex = Math.floor(num(a.bandIndex, -1));
      if (bandIndex < 0) continue;
      const arrow: ArrowAnnotation = {
        id,
        type: 'arrow',
        laneId: a.laneId,
        bandIndex,
        side: a.side === 'right' ? 'right' : 'left',
        color,
      };
      if (typeof a.label === 'string' && a.label) arrow.label = a.label;
      if (fontSize !== undefined) arrow.fontSize = fontSize;
      out.push(arrow);
    } else if (a.type === 'box') {
      const box: BoxAnnotation = {
        id,
        type: 'box',
        x: clamp(num(a.x, 0), 0, 1),
        y: clamp(num(a.y, 0), 0, 1),
        w: clamp(num(a.w, 0.1), 0.001, 1),
        h: clamp(num(a.h, 0.1), 0.001, 1),
        label: asString(a.label),
        enlarge: a.enlarge === true,
        color,
      };
      if (fontSize !== undefined) box.fontSize = fontSize;
      out.push(box);
    } else if (a.type === 'bracket') {
      const bracket: BracketAnnotation = {
        id,
        type: 'bracket',
        side: asSide(a.side),
        start: clamp(num(a.start, 0), 0, 1),
        end: clamp(num(a.end, 1), 0, 1),
        label: asString(a.label),
        color,
      };
      if (fontSize !== undefined) bracket.fontSize = fontSize;
      out.push(bracket);
    } else if (a.type === 'sideText') {
      const text: SideTextAnnotation = {
        id,
        type: 'sideText',
        side: asSide(a.side),
        pos: clamp(num(a.pos, 0.5), 0, 1),
        text: asString(a.text),
        color,
      };
      if (fontSize !== undefined) text.fontSize = fontSize;
      out.push(text);
    }
  }
  return out;
}

function sanitizeAdjust(value: unknown): GelProject['adjust'] {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    grayscale: raw.grayscale !== false,
    invert: raw.invert === true,
    contrast: clamp(num(raw.contrast, 1), 0.05, 10),
    brightness: clamp(num(raw.brightness, 0), -1, 1),
    gamma: clamp(num(raw.gamma, 1), 0.1, 5),
    gammaLocked: raw.gammaLocked !== false,
  };
}

function sanitizeCrop(value: unknown): GelProject['crop'] {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  // Each side is capped below 0.5 so the remaining window never collapses.
  return {
    left: clamp(num(raw.left, 0), 0, 0.49),
    top: clamp(num(raw.top, 0), 0, 0.49),
    right: clamp(num(raw.right, 0), 0, 0.49),
    bottom: clamp(num(raw.bottom, 0), 0, 0.49),
  };
}

const FONT_FAMILIES: GelLayoutSettings['fontFamily'][] = [
  'Arial',
  'Times New Roman',
  'Helvetica',
  'Calibri',
  'Cambria',
];

function sanitizeLayout(value: unknown): GelLayoutSettings {
  const base = emptyProject().layout;
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    fontFamily: FONT_FAMILIES.includes(raw.fontFamily as GelLayoutSettings['fontFamily'])
      ? (raw.fontFamily as GelLayoutSettings['fontFamily'])
      : base.fontFamily,
    nameFontSize: clamp(num(raw.nameFontSize, base.nameFontSize), 4, 40),
    labelFontSize: clamp(num(raw.labelFontSize, base.labelFontSize), 4, 40),
    nameAngle: clamp(num(raw.nameAngle, base.nameAngle), 0, 90),
    red: raw.red === true,
    conditionsNearestGel: raw.conditionsNearestGel === true,
    figureWidthMm: clamp(num(raw.figureWidthMm, base.figureWidthMm), 40, 600),
    groupLabelFit:
      raw.groupLabelFit === 'shrink' || raw.groupLabelFit === 'one'
        ? (raw.groupLabelFit as 'shrink' | 'one')
        : 'wrap',
  };
}

function sanitizeFit(value: unknown): GelLadderFit | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.ladderId !== 'string' || !raw.ladderId) return null;
  if (!Array.isArray(raw.laneIds)) return null;
  const laneIds = raw.laneIds.filter((id): id is string => typeof id === 'string');
  const a = num(raw.a, NaN);
  const b = num(raw.b, NaN);
  const c = num(raw.c, 0);
  if (![a, b, c].every(Number.isFinite)) return null;
  return {
    ladderId: raw.ladderId,
    laneIds,
    a,
    b,
    c,
    degree: raw.degree === 2 ? 2 : 1,
    r2: clamp(num(raw.r2, 0), 0, 1),
    n: Math.max(0, Math.round(num(raw.n, 0))),
  };
}

function sanitizeExposures(value: unknown): GelExposure[] {
  if (!Array.isArray(value)) return [];
  const out: GelExposure[] = [];
  const used = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.dataUrl !== 'string' || !e.dataUrl.startsWith('data:image/')) continue;
    let id = typeof e.id === 'string' && e.id && !used.has(e.id) ? e.id : newId('exp');
    while (used.has(id)) id = newId('exp');
    used.add(id);
    const exposure: GelExposure = {
      id,
      name: asString(e.name, `image ${out.length + 1}`),
      dataUrl: e.dataUrl,
      width: Math.max(1, Math.round(num(e.width, 1))),
      height: Math.max(1, Math.round(num(e.height, 1))),
      mime: asString(e.mime, 'image/png'),
    };
    if (typeof e.originalBase64 === 'string' && e.originalBase64) exposure.originalBase64 = e.originalBase64;
    if (typeof e.sha256 === 'string' && e.sha256) exposure.sha256 = e.sha256;
    out.push(exposure);
  }
  return out;
}

function normalizeProject(p: GelProject): GelProject {
  const base = emptyProject();
  const exposures = sanitizeExposures(p.exposures);
  const lanes = sanitizeLanes(p.lanes);
  const laneIds = new Set(lanes.map((l) => l.id));
  const activeExposureId = exposures.some((e) => e.id === p.activeExposureId)
    ? p.activeExposureId
    : exposures[0]?.id ?? '';
  const unit: Unit = p.unit === 'kDa' ? 'kDa' : 'bp';
  const gelType = p.gelType === 'protein' ? 'protein' : 'dna';
  return {
    version: 2,
    imageName: asString(p.imageName, exposures[0]?.name ?? ''),
    exposures,
    activeExposureId,
    display: p.display === 'color' ? 'color' : 'gray',
    rotation: clamp(num(p.rotation, 0), -45, 45),
    orient: ((Math.round(num(p.orient, 0)) % 4) + 4) % 4,
    mirrorH: p.mirrorH === true,
    mirrorV: p.mirrorV === true,
    adjust: sanitizeAdjust(p.adjust),
    crop: sanitizeCrop(p.crop),
    gelType,
    unit,
    ladderId: typeof p.ladderId === 'string' && p.ladderId ? p.ladderId : base.ladderId,
    customLadders: sanitizeLadders(p.customLadders),
    favorites: Array.isArray(p.favorites)
      ? p.favorites.filter((id): id is string => typeof id === 'string')
      : [],
    lanes,
    groups: sanitizeGroups(p.groups, laneIds),
    conditionRows: sanitizeConditionRows(p.conditionRows, laneIds),
    annotations: sanitizeAnnotations(p.annotations, laneIds),
    layout: sanitizeLayout(p.layout),
    fit: sanitizeFit(p.fit),
    notes: asString(p.notes),
    createdAt: typeof p.createdAt === 'string' && p.createdAt ? p.createdAt : base.createdAt,
    updatedAt: typeof p.updatedAt === 'string' && p.updatedAt ? p.updatedAt : base.updatedAt,
  };
}

/** Validate and migrate a SPICE_PROJECT gel document payload. */
export function sanitizeGelProject(value: unknown): GelProject | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const raw = value as { version?: unknown };
    if (raw.version === 1) return normalizeProject(migrateV1(value as unknown as GelProjectV1));
    if (!isGelProject(value)) return null;
    return normalizeProject(value);
  } catch {
    return null;
  }
}

/** One-line summary stored on the project document and shown in the hub. */
export function gelSummary(project: GelProject): string {
  const lanes = project.lanes.filter((l) => !l.removed);
  const bands = lanes.reduce((n, l) => n + l.bands.length, 0);
  const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
  const parts = [`${lanes.length} lanes`, `${bands} bands`];
  if (ladder) parts.push(ladder.name);
  if (project.fit) parts.push(`R2 ${project.fit.r2.toFixed(3)}`);
  return parts.join(' · ');
}

/** Raster preview rendered through the normal figure pipeline. */
export async function gelProjectPreview(project: GelProject): Promise<string | null> {
  try {
    const exposure = activeExposure(project);
    if (!exposure) return null;
    const img = await loadImageElement(exposure.dataUrl);
    const processed = renderProcessed(exposure, project, img);
    const layout = buildFigure(project, processed.canvas);
    const canvas = rasterizeFigure(layout, processed.canvas, 96);
    return canvasPreview(canvas) || null;
  } catch {
    return null;
  }
}

/** Every setting that influences the rendered figure, for parameters.json. */
export function gelParameters(project: GelProject, exportDpi = 300): Record<string, unknown> {
  const exposure = activeExposure(project);
  const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
  return {
    schema: 'SPICE_GEL_PROJECT',
    projectVersion: project.version,
    exportDpi,
    image: exposure
      ? {
          name: exposure.name,
          width: exposure.width,
          height: exposure.height,
          mime: exposure.mime,
          sha256: exposure.sha256 ?? null,
        }
      : null,
    exposures: project.exposures.map((e) => ({
      name: e.name,
      width: e.width,
      height: e.height,
      mime: e.mime,
      sha256: e.sha256 ?? null,
    })),
    processing: {
      display: project.display,
      rotation: project.rotation,
      orient: project.orient,
      mirrorH: project.mirrorH,
      mirrorV: project.mirrorV,
      adjust: project.adjust,
      crop: project.crop,
    },
    gel: {
      type: project.gelType,
      unit: project.unit,
      ladderId: project.ladderId,
      ladderName: ladder?.name ?? null,
      ladderSizes: ladder?.sizes ?? null,
      favoriteLadders: project.favorites,
    },
    lanes: project.lanes.map((lane, index) => ({
      index: index + 1,
      name: lane.name,
      x: lane.x,
      width: lane.width,
      marker: lane.isMarker,
      removed: !!lane.removed,
      splice: lane.splice ?? 'none',
      bandCount: lane.bands.length,
    })),
    fit: project.fit,
    annotations: project.annotations,
    layout: project.layout,
    notes: project.notes,
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Per-band data table included in the reproducible bundle. */
export function gelCsv(project: GelProject): string {
  const rows: string[] = [
    [
      'lane',
      'lane_name',
      'marker',
      'band',
      'y',
      'size',
      'unit',
      'approx',
      'visible',
      'intensity',
    ].join(','),
  ];
  for (const [laneIndex, lane] of project.lanes.entries()) {
    for (const [bandIndex, band] of lane.bands.entries()) {
      rows.push(
        [
          laneIndex + 1,
          lane.name,
          lane.isMarker,
          bandIndex + 1,
          band.y.toFixed(5),
          band.size === undefined ? '' : Number(band.size.toPrecision(6)),
          project.unit,
          band.approx === true,
          band.hidden !== true && band.showSize !== false,
          Number(band.intensity.toPrecision(6)),
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return `${rows.join('\n')}\n`;
}

/** Draft methods text for the reproducible bundle. */
export function gelMethods(project: GelProject): string {
  const ladder = ladderById(project.fit?.ladderId ?? project.ladderId, project.customLadders);
  const mirror =
    project.mirrorH || project.mirrorV
      ? ` Mirrored ${project.mirrorH ? 'horizontally' : ''}${project.mirrorH && project.mirrorV ? ' and ' : ''}${project.mirrorV ? 'vertically' : ''}.`
      : '';
  const calibration = project.fit
    ? `Band sizes were calibrated against ${ladder?.name ?? project.fit.ladderId} using ${project.fit.n} marker bands (${project.fit.degree}-degree fit of log10 size against band position, R2 = ${project.fit.r2.toFixed(3)}). Size estimates outside the fitted marker range are marked as approximate.`
    : 'No marker ladder calibration was applied; band positions are reported without interpolated sizes.';
  return [
    'Gel images were processed and figures assembled in SPICE GUI. All image transforms and measurements were performed locally on the original exposure file.',
    `Gel type: ${project.gelType === 'protein' ? 'protein' : 'DNA'}; size unit: ${project.unit}. Fine rotation ${project.rotation.toFixed(1)} degrees; quarter-turn orientation ${project.orient * 90} degrees.${mirror}`,
    `Display: ${project.display}; grayscale ${project.adjust.grayscale ? 'on' : 'off'}; contrast ${project.adjust.contrast}; brightness ${project.adjust.brightness}; gamma ${project.adjust.gamma}; invert ${project.adjust.invert ? 'on' : 'off'}.`,
    `Visible lanes: ${project.lanes.filter((l) => !l.removed).length}; detected bands: ${project.lanes.reduce((n, l) => n + l.bands.length, 0)}.`,
    calibration,
    'The figure PNG, editable SVG, project JSON, band table CSV and parameters.json in this bundle were generated from the same in-memory project state.',
  ].join('\n\n');
}
