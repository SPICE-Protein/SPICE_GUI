// SPICE_PROJECT adapter for the image annotator. Kept free of Svelte state so
// the capture/write-back logic can be tested and reused by the tool page.
import {
  PX_PER_MM,
  normalizeProject,
  type AnnotateProject,
  type ProfileAnnotation,
} from './types';
import { buildFigureGeometry } from './layout';

export const ANNOTATE_DOC_KIND = 'annotate' as const;

export function normalizeAnnotatePayload(value: unknown): AnnotateProject | null {
  return normalizeProject(value);
}

export function annotateDocName(project: AnnotateProject): string {
  const name = project.name.trim();
  return name || 'Figure';
}

export function annotateProfileAnnotations(project: AnnotateProject): ProfileAnnotation[] {
  return project.annotations.filter((ann): ann is ProfileAnnotation => ann.kind === 'profile');
}

/** One-line hub/ELN summary. */
export function annotateSummary(project: AnnotateProject): string {
  const geom = buildFigureGeometry(project);
  const profiles = annotateProfileAnnotations(project).length;
  const channels = project.panels
    .map((panel) => {
      const visible = [
        panel.channels.r.show ? 'R' : '',
        panel.channels.g.show ? 'G' : '',
        panel.channels.b.show ? 'B' : '',
      ].join('');
      return visible || 'none';
    })
    .filter((value, index, list) => list.indexOf(value) === index)
    .join('/');
  const base = [
    `${project.panels.length} panel${project.panels.length === 1 ? '' : 's'}`,
    `${project.layout.figureWidthMm.toFixed(1)} x ${(geom.height / PX_PER_MM).toFixed(1)} mm`,
    `${project.layout.exportDpi} dpi`,
    `${project.annotations.length} annotation${project.annotations.length === 1 ? '' : 's'}`,
  ];
  if (profiles) base.push(`${profiles} profile${profiles === 1 ? '' : 's'}`);
  if (channels) base.push(`RGB ${channels}`);
  return base.join('; ');
}

/** Processing settings recorded in parameters.json. */
export function annotateParameters(project: AnnotateProject): Record<string, unknown> {
  const geom = buildFigureGeometry(project);
  return {
    figure: {
      name: annotateDocName(project),
      widthMm: project.layout.figureWidthMm,
      heightMm: Number((geom.height / PX_PER_MM).toFixed(3)),
      exportDpi: project.layout.exportDpi,
      columns: project.layout.columns,
      flow: project.layout.flow,
      gapMm: project.layout.gapMm,
      marginMm: project.layout.marginMm,
      background: project.layout.background,
      fontFamily: project.layout.fontFamily,
      labelStyle: project.layout.labelStyle,
      labelPosition: project.layout.labelPosition,
      labelFontSizePt: project.layout.labelFontSizePt,
    },
    panels: project.panels.map((panel) => ({
      name: panel.name,
      width: panel.width,
      height: panel.height,
      mime: panel.mime,
      crop: panel.crop,
      zoom: panel.zoom,
      offsetX: panel.offsetX,
      offsetY: panel.offsetY,
      brightness: panel.brightness,
      contrast: panel.contrast,
      channels: panel.channels,
      calibration: panel.calibration,
    })),
    annotations: project.annotations.map((ann) => ({
      id: ann.id,
      kind: ann.kind,
      color: ann.color,
      ...(ann.kind === 'profile'
        ? { samples: ann.samples, x1: ann.x1, y1: ann.y1, x2: ann.x2, y2: ann.y2 }
        : {}),
    })),
    profileCount: annotateProfileAnnotations(project).length,
    profileIntensity:
      'Rec. 709 luminance (0.2126 R + 0.7152 G + 0.0722 B) of the rendered RGB composite, 0-255',
  };
}

/** Draft methods paragraph included in the reproducible bundle. */
export function annotateMethods(project: AnnotateProject): string {
  const channels = project.panels.some(
    (panel) =>
      !panel.channels.r.show ||
      !panel.channels.g.show ||
      !panel.channels.b.show ||
      panel.channels.r.gain !== 1 ||
      panel.channels.g.gain !== 1 ||
      panel.channels.b.gain !== 1 ||
      panel.channels.r.invert ||
      panel.channels.g.invert ||
      panel.channels.b.invert,
  );
  const profiles = annotateProfileAnnotations(project).length;
  const lines = [
    `Figure panels (${project.panels.length}) were assembled in the SPICE image annotator and exported at ${project.layout.exportDpi} dpi as a raster figure (PNG) and as a vector figure (SVG with embedded raster panels and editable text labels).`,
    'Panel cropping, zoom and pan were applied non-destructively; brightness and contrast were applied before annotation placement.',
  ];
  if (channels) {
    lines.push(
      'RGB channels were composited per panel with explicit show/hide flags, gain in the 0-2 range and optional per-channel inversion; every preview, annotation and export used the same composite.',
    );
  } else {
    lines.push('All three RGB channels were displayed at unit gain without inversion.');
  }
  if (profiles) {
    lines.push(
      `Intensity line profiles (${profiles}) were sampled at evenly spaced positions along each measurement line from the rendered composite. Intensity was defined as Rec. 709 luminance (0.2126 R + 0.7152 G + 0.0722 B) on the 0-255 scale and exported as profile CSV alongside the figure.`,
    );
  }
  lines.push(
    'Scale bars use the per-panel calibration (source pixels per physical unit) where available; fixed-length bars are expressed in millimetres at the figure scale.',
  );
  return lines.join(' ');
}
