// Figure Studio starter templates.
//
// A template is a pure document factory: no Svelte state, no bundled assets and
// no I/O. Each scene is laid out in millimetres on a reference canvas and then
// scaled uniformly when the caller asks for a different page width, so page
// bounds and relative typography stay consistent at every size.
//
// Node creation deliberately goes through the public constructors in ./types;
// templates only add layout, styling and group metadata.

import {
  clamp,
  createEllipseNode,
  createFigureDocument,
  createLineNode,
  createRectNode,
  createTextNode,
  mmToPx,
  type DashStyle,
  type EllipseNode,
  type FigureDocument,
  type FigureGroup,
  type FigureNode,
  type LineNode,
  type RectNode,
  type TextAlign,
  type TextNode,
} from './types';

export interface FigureTemplate {
  id: string;
  nameKey: string;
  descKey: string;
  build(widthMm?: number): FigureDocument;
}

/** Shared, restrained palette. Templates stay visually consistent so users can
 *  mix panels from different starters without restyling every object. */
const PALETTE = {
  ink: '#16222d',
  muted: '#5d6b78',
  line: '#8aa0ae',
  panel: '#f3f7fa',
  panelAlt: '#e8f1f6',
  accent: '#1f6f8b',
  accentDark: '#14506a',
  accentSoft: '#d9eaf1',
  warm: '#f8ede1',
  warmStroke: '#c46a1b',
  success: '#e8f4ec',
  successStroke: '#2f7d4a',
  white: '#ffffff',
} as const;

interface BoxOptions {
  fill?: string;
  stroke?: string;
  /** Millimetres. */
  strokeWidth?: number;
  dash?: DashStyle;
  /** Millimetres. */
  cornerRadius?: number;
  opacity?: number;
  name?: string;
  rotation?: number;
}

interface TextOptions {
  /** Points. Scaled with the page width. */
  fontSize?: number;
  fontWeight?: TextNode['fontWeight'];
  italic?: boolean;
  align?: TextAlign;
  color?: string;
  background?: string;
  lineHeight?: number;
  /** Millimetres. */
  padding?: number;
  opacity?: number;
  name?: string;
  rotation?: number;
}

interface LineOptions {
  stroke?: string;
  /** Millimetres. */
  strokeWidth?: number;
  dash?: DashStyle;
  headStart?: boolean;
  headEnd?: boolean;
  /** Millimetres. */
  headSize?: number;
  name?: string;
  opacity?: number;
}

interface Canvas {
  rect(x: number, y: number, w: number, h: number, options?: BoxOptions): RectNode;
  ellipse(x: number, y: number, w: number, h: number, options?: BoxOptions): EllipseNode;
  text(x: number, y: number, w: number, h: number, content: string, options?: TextOptions): TextNode;
  arrow(x: number, y: number, w: number, h: number, options?: LineOptions): LineNode;
  line(x: number, y: number, w: number, h: number, options?: LineOptions): LineNode;
  group(name: string, members: FigureNode[]): FigureGroup;
}

interface Scene {
  doc: FigureDocument;
  c: Canvas;
}

function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

function createScene(
  name: string,
  designWidthMm: number,
  designHeightMm: number,
  widthMm?: number,
): Scene {
  const requested =
    typeof widthMm === 'number' && Number.isFinite(widthMm) && widthMm > 0
      ? clamp(widthMm, 20, 1200)
      : designWidthMm;
  const scale = requested / designWidthMm;
  const heightMm = designHeightMm * scale;
  const doc = createFigureDocument(name, roundMm(requested), roundMm(heightMm));
  doc.name = name;

  const px = (mm: number) => mmToPx(mm * scale);
  const strokePx = (mm: number) => Math.max(0.4, px(mm));
  const fontPt = (pt: number) => Math.max(4, pt * scale);

  const nodes: FigureNode[] = [];
  let groupSeq = 0;

  const push = <T extends FigureNode>(node: T): T => {
    nodes.push(node);
    return node;
  };

  const c: Canvas = {
    rect(x, y, w, h, options = {}) {
      const node = createRectNode(px(x), px(y), px(w), px(h));
      node.name = options.name ?? 'Panel';
      node.fill = options.fill ?? PALETTE.panel;
      node.stroke = options.stroke ?? PALETTE.line;
      node.strokeWidth = strokePx(options.strokeWidth ?? 0.3);
      node.dash = options.dash ?? 'solid';
      node.cornerRadius = px(options.cornerRadius ?? 0);
      node.opacity = options.opacity ?? 1;
      node.rotation = options.rotation ?? 0;
      return push(node);
    },

    ellipse(x, y, w, h, options = {}) {
      const node = createEllipseNode(px(x), px(y), px(w), px(h));
      node.name = options.name ?? 'Ellipse';
      node.fill = options.fill ?? PALETTE.panelAlt;
      node.stroke = options.stroke ?? PALETTE.accent;
      node.strokeWidth = strokePx(options.strokeWidth ?? 0.3);
      node.dash = options.dash ?? 'solid';
      node.opacity = options.opacity ?? 1;
      node.rotation = options.rotation ?? 0;
      return push(node);
    },

    text(x, y, w, h, content, options = {}) {
      const node = createTextNode(px(x), px(y), content);
      node.w = px(w);
      node.h = px(h);
      node.name = options.name ?? (content.slice(0, 28) || 'Text');
      node.fontSize = fontPt(options.fontSize ?? 10);
      node.fontWeight = options.fontWeight ?? 400;
      node.italic = options.italic ?? false;
      node.align = options.align ?? 'left';
      node.lineHeight = options.lineHeight ?? 1.25;
      node.padding = px(options.padding ?? 0.4);
      node.color = options.color ?? PALETTE.ink;
      node.background = options.background ?? 'none';
      node.opacity = options.opacity ?? 1;
      node.rotation = options.rotation ?? 0;
      return push(node);
    },

    line(x, y, w, h, options = {}) {
      return lineNode(false, x, y, w, h, options);
    },

    arrow(x, y, w, h, options = {}) {
      return lineNode(true, x, y, w, h, options);
    },

    group(groupName, members) {
      groupSeq += 1;
      const group: FigureGroup = {
        id: `grp_${Date.now().toString(36)}_${groupSeq.toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        name: groupName,
        hidden: false,
        locked: false,
      };
      for (const member of members) member.groupId = group.id;
      doc.groups.push(group);
      return group;
    },
  };

  function lineNode(
    arrow: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
    options: LineOptions,
  ): LineNode {
    const node = createLineNode(px(x), px(y), px(w), px(h), arrow);
    node.name = options.name ?? (arrow ? 'Arrow' : 'Line');
    node.stroke = options.stroke ?? PALETTE.ink;
    node.strokeWidth = strokePx(options.strokeWidth ?? 0.35);
    node.dash = options.dash ?? 'solid';
    node.headStart = options.headStart ?? false;
    node.headEnd = options.headEnd ?? arrow;
    node.headSize = px(options.headSize ?? 2.6);
    node.opacity = options.opacity ?? 1;
    return push(node);
  }

  doc.nodes = nodes;
  return { doc, c };
}

// ---------------------------------------------------------------------------
// Single column — one hero panel with two supporting panels and a caption.
// ---------------------------------------------------------------------------

function buildSingleColumn(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Single column figure', 90, 110, widthMm);

  c.text(5, 5, 80, 9, 'Figure title', {
    name: 'Title',
    fontSize: 16,
    fontWeight: 700,
  });
  c.text(5, 14, 80, 5, 'Short subtitle describing the main finding', {
    name: 'Subtitle',
    fontSize: 9,
    italic: true,
    color: PALETTE.muted,
  });

  const heroPanel = c.rect(5, 21, 80, 44, {
    name: 'Panel A panel',
    fill: PALETTE.panel,
    stroke: PALETTE.accent,
    strokeWidth: 0.45,
    cornerRadius: 1.5,
  });
  const heroLabel = c.text(7, 23, 10, 5, 'A', {
    name: 'Panel A label',
    fontSize: 12,
    fontWeight: 700,
    color: PALETTE.accent,
  });
  const heroMotif = c.ellipse(28, 30, 34, 22, {
    name: 'Panel A motif',
    fill: PALETTE.accentSoft,
    stroke: PALETTE.accent,
    dash: 'dashed',
  });
  const heroText = c.text(30, 37, 30, 7, 'Overview', {
    name: 'Panel A text',
    fontSize: 10,
    fontWeight: 600,
    align: 'center',
  });
  c.group('Panel A', [heroPanel, heroLabel, heroMotif, heroText]);

  const panelB = c.rect(5, 68, 38, 25, {
    name: 'Panel B panel',
    fill: PALETTE.panelAlt,
    stroke: PALETTE.line,
    cornerRadius: 1.2,
  });
  const labelB = c.text(6.5, 69.5, 7, 4.5, 'B', {
    name: 'Panel B label',
    fontSize: 11,
    fontWeight: 700,
    color: PALETTE.accent,
  });
  const textB = c.text(7, 77, 34, 9, 'Condition B', {
    name: 'Panel B text',
    fontSize: 9,
    align: 'center',
    color: PALETTE.muted,
  });
  const panelC = c.rect(47, 68, 38, 25, {
    name: 'Panel C panel',
    fill: PALETTE.panelAlt,
    stroke: PALETTE.line,
    cornerRadius: 1.2,
  });
  const labelC = c.text(48.5, 69.5, 7, 4.5, 'C', {
    name: 'Panel C label',
    fontSize: 11,
    fontWeight: 700,
    color: PALETTE.accent,
  });
  const textC = c.text(49, 77, 34, 9, 'Condition C', {
    name: 'Panel C text',
    fontSize: 9,
    align: 'center',
    color: PALETTE.muted,
  });

  c.text(5, 97, 80, 9, 'Figure 1. Summary caption describing panels A-C and the main conclusion.', {
    name: 'Caption',
    fontSize: 8.5,
    italic: true,
    color: PALETTE.muted,
    lineHeight: 1.2,
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Double column — two balanced panels, a detail strip and a caption.
// ---------------------------------------------------------------------------

function buildDoubleColumn(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Double column figure', 180, 105, widthMm);

  c.text(8, 5, 164, 9, 'Figure title', {
    name: 'Title',
    fontSize: 18,
    fontWeight: 700,
  });
  c.text(8, 14, 164, 5, 'Subtitle for a two-column journal figure', {
    name: 'Subtitle',
    fontSize: 9.5,
    italic: true,
    color: PALETTE.muted,
  });

  const panelA = c.rect(8, 24, 80, 50, {
    name: 'Panel A panel',
    fill: PALETTE.panel,
    stroke: PALETTE.accent,
    strokeWidth: 0.4,
    cornerRadius: 1.5,
  });
  const labelA = c.text(10, 26, 8, 5, 'A', {
    name: 'Panel A label',
    fontSize: 12,
    fontWeight: 700,
    color: PALETTE.accent,
  });
  const motifA = c.ellipse(30, 35, 36, 24, {
    name: 'Panel A motif',
    fill: PALETTE.accentSoft,
    stroke: PALETTE.accent,
    dash: 'dashed',
  });
  const textA = c.text(34, 42, 28, 8, 'Signal', {
    name: 'Panel A text',
    fontSize: 9.5,
    fontWeight: 600,
    align: 'center',
  });
  c.group('Panel A', [panelA, labelA, motifA, textA]);

  const panelB = c.rect(92, 24, 80, 50, {
    name: 'Panel B panel',
    fill: PALETTE.panelAlt,
    stroke: PALETTE.line,
    cornerRadius: 1.5,
  });
  const labelB = c.text(94, 26, 8, 5, 'B', {
    name: 'Panel B label',
    fontSize: 12,
    fontWeight: 700,
    color: PALETTE.accent,
  });
  const motifB = c.ellipse(114, 35, 36, 24, {
    name: 'Panel B motif',
    fill: PALETTE.warm,
    stroke: PALETTE.warmStroke,
    dash: 'dashed',
  });
  const textB = c.text(118, 42, 28, 8, 'Control', {
    name: 'Panel B text',
    fontSize: 9.5,
    fontWeight: 600,
    align: 'center',
  });
  c.group('Panel B', [panelB, labelB, motifB, textB]);

  const detailLabels = ['Detail 1', 'Detail 2', 'Detail 3', 'Detail 4'];
  detailLabels.forEach((label, index) => {
    const x = 8 + index * 41.5;
    c.rect(x, 80, 39.5, 12, {
      name: `Detail ${index + 1}`,
      fill: PALETTE.accentSoft,
      stroke: PALETTE.line,
      strokeWidth: 0.2,
      cornerRadius: 1,
    });
    c.text(x + 1, 83, 37.5, 6, label, {
      name: `Detail ${index + 1} label`,
      fontSize: 8,
      align: 'center',
      color: PALETTE.accentDark,
    });
  });

  c.text(8, 96, 164, 7, 'Figure 1. Caption covering both conditions and the detail views.', {
    name: 'Caption',
    fontSize: 8.5,
    italic: true,
    color: PALETTE.muted,
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Slide — 16:9 title bar and three content columns for presentations.
// ---------------------------------------------------------------------------

function buildSlide(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Slide 16:9 figure', 338.7, 190.5, widthMm);

  c.rect(0, 0, 338.7, 30, {
    name: 'Title bar',
    fill: PALETTE.accent,
    stroke: 'none',
    strokeWidth: 0,
    cornerRadius: 0,
  });
  c.text(12, 6, 210, 14, 'Presentation figure', {
    name: 'Slide title',
    fontSize: 24,
    fontWeight: 700,
    color: PALETTE.white,
  });
  c.text(215, 10, 112, 8, 'SPICE Figure Studio', {
    name: 'Slide tag',
    fontSize: 10,
    italic: true,
    align: 'right',
    color: PALETTE.white,
    opacity: 0.9,
  });

  const margin = 12;
  const gap = 10;
  const columnWidth = (338.7 - margin * 2 - gap * 2) / 3;
  const columnTitles = ['Context', 'Approach', 'Result'];

  columnTitles.forEach((title, index) => {
    const x = margin + index * (columnWidth + gap);
    const members: FigureNode[] = [];
    members.push(
      c.rect(x, 44, columnWidth, 112, {
        name: `${title} panel`,
        fill: PALETTE.panel,
        stroke: PALETTE.line,
        strokeWidth: 0.25,
        cornerRadius: 1.5,
      }),
    );
    members.push(
      c.rect(x, 44, columnWidth, 11, {
        name: `${title} header`,
        fill: PALETTE.accentSoft,
        stroke: 'none',
        strokeWidth: 0,
        cornerRadius: 1.5,
      }),
    );
    members.push(
      c.ellipse(x + 4, 46.5, 6, 6, {
        name: `${title} number`,
        fill: PALETTE.accent,
        stroke: 'none',
        strokeWidth: 0,
      }),
    );
    members.push(
      c.text(x + 12, 46.5, columnWidth - 15, 7, title, {
        name: `${title} title`,
        fontSize: 10.5,
        fontWeight: 700,
      }),
    );
    members.push(
      c.ellipse(x + 16, 66, columnWidth - 32, 34, {
        name: `${title} motif`,
        fill: PALETTE.panelAlt,
        stroke: PALETTE.accent,
        dash: 'dashed',
      }),
    );
    members.push(
      c.text(x + 20, 76, columnWidth - 40, 10, `${title} visual`, {
        name: `${title} visual label`,
        fontSize: 9,
        align: 'center',
        color: PALETTE.muted,
      }),
    );
    members.push(
      c.text(x + 6, 106, columnWidth - 12, 16, 'Add microscopy images, plots or diagrams here.', {
        name: `${title} note`,
        fontSize: 8,
        color: PALETTE.muted,
        lineHeight: 1.25,
      }),
    );
    c.group(title, members);
  });

  c.text(
    12,
    164,
    314.7,
    16,
    'Figure 1. Slide-ready summary. Replace placeholders with data panels and keep the caption below the fold.',
    {
      name: 'Caption',
      fontSize: 9.5,
      italic: true,
      color: PALETTE.muted,
      lineHeight: 1.25,
    },
  );

  return doc;
}

// ---------------------------------------------------------------------------
// Graphical abstract — input, mechanism and output joined by arrows.
// ---------------------------------------------------------------------------

function buildGraphicalAbstract(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Graphical abstract', 180, 100, widthMm);

  c.text(10, 5, 160, 9, 'Graphical abstract', {
    name: 'Title',
    fontSize: 16,
    fontWeight: 700,
    align: 'center',
  });

  const inputPanel = c.rect(8, 28, 44, 42, {
    name: 'Input panel',
    fill: PALETTE.panel,
    stroke: PALETTE.line,
    cornerRadius: 1.5,
  });
  const inputHeader = c.text(10, 30, 40, 5, 'Input', {
    name: 'Input header',
    fontSize: 9,
    fontWeight: 700,
    color: PALETTE.accent,
  });
  const inputMotif = c.ellipse(16, 37, 28, 19, {
    name: 'Input motif',
    fill: PALETTE.accentSoft,
    stroke: PALETTE.accent,
    dash: 'dashed',
  });
  const inputText = c.text(18, 43, 24, 6, 'Samples', {
    name: 'Input text',
    fontSize: 8,
    align: 'center',
  });
  const inputSub = c.text(8, 71, 44, 5, 'Cells / images', {
    name: 'Input caption',
    fontSize: 8,
    align: 'center',
    color: PALETTE.muted,
  });
  c.group('Input', [inputPanel, inputHeader, inputMotif, inputText, inputSub]);

  const center = c.ellipse(68, 24, 44, 50, {
    name: 'Mechanism',
    fill: PALETTE.warm,
    stroke: PALETTE.warmStroke,
    strokeWidth: 0.5,
  });
  const centerHeader = c.text(70, 27, 40, 5, 'Mechanism', {
    name: 'Mechanism header',
    fontSize: 9,
    fontWeight: 700,
    align: 'center',
    color: PALETTE.warmStroke,
  });
  const centerText = c.text(72, 38, 36, 12, 'Model', {
    name: 'Mechanism text',
    fontSize: 10,
    fontWeight: 600,
    align: 'center',
    lineHeight: 1.2,
  });
  const centerSub = c.text(68, 76, 44, 5, 'Computation', {
    name: 'Mechanism caption',
    fontSize: 8,
    align: 'center',
    color: PALETTE.muted,
  });
  c.group('Mechanism', [center, centerHeader, centerText, centerSub]);

  const outputPanel = c.rect(128, 28, 44, 42, {
    name: 'Output panel',
    fill: PALETTE.success,
    stroke: PALETTE.successStroke,
    cornerRadius: 1.5,
  });
  const outputHeader = c.text(130, 30, 40, 5, 'Output', {
    name: 'Output header',
    fontSize: 9,
    fontWeight: 700,
    color: PALETTE.successStroke,
  });
  const outputMotif = c.ellipse(136, 37, 28, 19, {
    name: 'Output motif',
    fill: PALETTE.white,
    stroke: PALETTE.successStroke,
    dash: 'dashed',
  });
  const outputText = c.text(138, 43, 24, 6, 'Result', {
    name: 'Output text',
    fontSize: 8,
    align: 'center',
  });
  const outputSub = c.text(128, 71, 44, 5, 'Figure / report', {
    name: 'Output caption',
    fontSize: 8,
    align: 'center',
    color: PALETTE.muted,
  });
  c.group('Output', [outputPanel, outputHeader, outputMotif, outputText, outputSub]);

  c.arrow(52, 49, 16, 0, { name: 'Input to mechanism' });
  c.arrow(112, 49, 16, 0, { name: 'Mechanism to output' });

  c.text(10, 86, 160, 10, 'A one-sentence take-home message belongs here.', {
    name: 'Caption',
    fontSize: 8.5,
    italic: true,
    align: 'center',
    color: PALETTE.muted,
    lineHeight: 1.2,
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Mechanism — vertical numbered pathway with stages and connectors.
// ---------------------------------------------------------------------------

function buildMechanism(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Mechanism diagram', 180, 120, widthMm);

  c.text(8, 5, 164, 9, 'Proposed mechanism', {
    name: 'Title',
    fontSize: 16,
    fontWeight: 700,
  });
  c.text(8, 14, 164, 5, 'Each stage is numbered and connected in order', {
    name: 'Subtitle',
    fontSize: 9,
    italic: true,
    color: PALETTE.muted,
  });

  const stages = [
    { title: 'Recognition', detail: 'The sensor binds the target with high selectivity.', tag: 'Step 1' },
    { title: 'Activation', detail: 'Conformational change exposes the catalytic site.', tag: 'Step 2' },
    { title: 'Amplification', detail: 'A cascade converts the input into a measurable signal.', tag: 'Step 3' },
    { title: 'Readout', detail: 'The signal is captured and normalised for quantification.', tag: 'Step 4' },
  ];

  stages.forEach((stage, index) => {
    const y = 26 + index * 22;
    const members: FigureNode[] = [];
    members.push(
      c.rect(20, y, 140, 16, {
        name: `${stage.title} panel`,
        fill: index % 2 === 0 ? PALETTE.panel : PALETTE.panelAlt,
        stroke: index % 2 === 0 ? PALETTE.accent : PALETTE.line,
        strokeWidth: 0.35,
        cornerRadius: 1.2,
      }),
    );
    members.push(
      c.ellipse(24, y + 3, 10, 10, {
        name: `${stage.title} number`,
        fill: PALETTE.accent,
        stroke: 'none',
        strokeWidth: 0,
      }),
    );
    members.push(
      c.text(24, y + 3, 10, 10, String(index + 1), {
        name: `${stage.title} number text`,
        fontSize: 9,
        fontWeight: 700,
        align: 'center',
        color: PALETTE.white,
      }),
    );
    members.push(
      c.text(38, y + 2, 80, 6, stage.title, {
        name: `${stage.title} title`,
        fontSize: 10.5,
        fontWeight: 700,
      }),
    );
    members.push(
      c.text(38, y + 8.5, 116, 5.5, stage.detail, {
        name: `${stage.title} detail`,
        fontSize: 8,
        color: PALETTE.muted,
      }),
    );
    members.push(
      c.text(128, y + 5, 28, 5, stage.tag, {
        name: `${stage.title} tag`,
        fontSize: 7.5,
        align: 'right',
        color: PALETTE.accent,
      }),
    );
    c.group(stage.title, members);

    if (index < stages.length - 1) {
      c.arrow(90, y + 16, 0, 6, {
        name: `Stage ${index + 1} connector`,
        strokeWidth: 0.4,
      });
    }
  });

  c.text(8, 111, 164, 6, 'Figure 2. Schematic of the proposed mechanism with numbered stages.', {
    name: 'Caption',
    fontSize: 8.5,
    italic: true,
    color: PALETTE.muted,
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Workflow — four numbered steps, connectors and an outcome band.
// ---------------------------------------------------------------------------

function buildWorkflow(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Workflow diagram', 180, 100, widthMm);

  c.text(8, 5, 164, 9, 'Experimental workflow', {
    name: 'Title',
    fontSize: 16,
    fontWeight: 700,
  });
  c.text(8, 14, 164, 5, 'Four steps from sample to validated result', {
    name: 'Subtitle',
    fontSize: 9,
    italic: true,
    color: PALETTE.muted,
  });

  const cardWidth = (164 - 3 * 6) / 4;
  const cards = [
    { title: 'Prepare', note: 'Collect samples and set up controls.' },
    { title: 'Acquire', note: 'Run the assay and capture raw data.' },
    { title: 'Analyse', note: 'Process signals and fit the model.' },
    { title: 'Validate', note: 'Confirm with an independent replicate.' },
  ];

  cards.forEach((card, index) => {
    const x = 8 + index * (cardWidth + 6);
    const members: FigureNode[] = [];
    members.push(
      c.rect(x, 26, cardWidth, 44, {
        name: `${card.title} card`,
        fill: PALETTE.panel,
        stroke: PALETTE.line,
        strokeWidth: 0.3,
        cornerRadius: 1.3,
      }),
    );
    members.push(
      c.rect(x, 26, cardWidth, 4, {
        name: `${card.title} accent`,
        fill: PALETTE.accent,
        stroke: 'none',
        strokeWidth: 0,
        cornerRadius: 0,
      }),
    );
    members.push(
      c.ellipse(x + 4, 33, 9, 9, {
        name: `${card.title} number`,
        fill: PALETTE.accentSoft,
        stroke: PALETTE.accent,
        strokeWidth: 0.3,
      }),
    );
    members.push(
      c.text(x + 4, 33, 9, 9, String(index + 1), {
        name: `${card.title} number text`,
        fontSize: 8,
        fontWeight: 700,
        align: 'center',
        color: PALETTE.accentDark,
      }),
    );
    members.push(
      c.text(x + 4, 44, cardWidth - 8, 6, card.title, {
        name: `${card.title} title`,
        fontSize: 9,
        fontWeight: 700,
      }),
    );
    members.push(
      c.text(x + 4, 51, cardWidth - 8, 14, card.note, {
        name: `${card.title} note`,
        fontSize: 7.5,
        color: PALETTE.muted,
        lineHeight: 1.2,
      }),
    );
    c.group(card.title, members);

    if (index < cards.length - 1) {
      c.arrow(x + cardWidth + 0.5, 48, 5, 0, {
        name: `Step ${index + 1} connector`,
        strokeWidth: 0.35,
      });
    }
  });

  c.rect(8, 76, 164, 12, {
    name: 'Outcome band',
    fill: PALETTE.accentSoft,
    stroke: PALETTE.accent,
    strokeWidth: 0.2,
    cornerRadius: 1.2,
  });
  c.text(10, 78, 160, 8, 'Outcome: validated, publication-ready figure', {
    name: 'Outcome text',
    fontSize: 9,
    fontWeight: 700,
    align: 'center',
    color: PALETTE.accentDark,
  });

  c.text(8, 91, 164, 6, 'Figure 3. Workflow from sample preparation to validation.', {
    name: 'Caption',
    fontSize: 8.5,
    italic: true,
    color: PALETTE.muted,
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Comparison — side-by-side conditions with a central versus marker.
// ---------------------------------------------------------------------------

function buildComparison(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Comparison figure', 180, 110, widthMm);

  c.text(8, 5, 164, 9, 'Condition comparison', {
    name: 'Title',
    fontSize: 16,
    fontWeight: 700,
  });
  c.text(8, 14, 164, 5, 'Side-by-side view of two experimental conditions', {
    name: 'Subtitle',
    fontSize: 9,
    italic: true,
    color: PALETTE.muted,
  });

  const leftPanel = c.rect(8, 26, 74, 62, {
    name: 'Condition A panel',
    fill: PALETTE.panel,
    stroke: PALETTE.accent,
    strokeWidth: 0.4,
    cornerRadius: 1.5,
  });
  const leftHeader = c.rect(8, 26, 74, 10, {
    name: 'Condition A header',
    fill: PALETTE.accent,
    stroke: 'none',
    strokeWidth: 0,
    cornerRadius: 1.5,
  });
  const leftTitle = c.text(11, 28, 68, 6, 'Condition A', {
    name: 'Condition A title',
    fontSize: 9.5,
    fontWeight: 700,
    color: PALETTE.white,
  });
  const leftBullet1 = c.text(12, 41, 66, 5, '• Baseline signal', {
    name: 'Condition A bullet 1',
    fontSize: 8.5,
    color: PALETTE.muted,
  });
  const leftBullet2 = c.text(12, 50, 66, 5, '• Untreated control', {
    name: 'Condition A bullet 2',
    fontSize: 8.5,
    color: PALETTE.muted,
  });
  const leftBullet3 = c.text(12, 59, 66, 5, '• Reference condition', {
    name: 'Condition A bullet 3',
    fontSize: 8.5,
    color: PALETTE.muted,
  });
  const leftNote = c.text(12, 72, 66, 7, 'n = 3 independent replicates', {
    name: 'Condition A note',
    fontSize: 7.5,
    italic: true,
    color: PALETTE.muted,
  });
  c.group('Condition A', [
    leftPanel,
    leftHeader,
    leftTitle,
    leftBullet1,
    leftBullet2,
    leftBullet3,
    leftNote,
  ]);

  const rightPanel = c.rect(98, 26, 74, 62, {
    name: 'Condition B panel',
    fill: PALETTE.success,
    stroke: PALETTE.successStroke,
    strokeWidth: 0.4,
    cornerRadius: 1.5,
  });
  const rightHeader = c.rect(98, 26, 74, 10, {
    name: 'Condition B header',
    fill: PALETTE.successStroke,
    stroke: 'none',
    strokeWidth: 0,
    cornerRadius: 1.5,
  });
  const rightTitle = c.text(101, 28, 68, 6, 'Condition B', {
    name: 'Condition B title',
    fontSize: 9.5,
    fontWeight: 700,
    color: PALETTE.white,
  });
  const rightBullet1 = c.text(102, 41, 66, 5, '• Enhanced signal', {
    name: 'Condition B bullet 1',
    fontSize: 8.5,
    color: PALETTE.muted,
  });
  const rightBullet2 = c.text(102, 50, 66, 5, '• Treated sample', {
    name: 'Condition B bullet 2',
    fontSize: 8.5,
    color: PALETTE.muted,
  });
  const rightBullet3 = c.text(102, 59, 66, 5, '• Test condition', {
    name: 'Condition B bullet 3',
    fontSize: 8.5,
    color: PALETTE.muted,
  });
  const rightNote = c.text(102, 72, 66, 7, 'n = 3 independent replicates', {
    name: 'Condition B note',
    fontSize: 7.5,
    italic: true,
    color: PALETTE.muted,
  });
  c.group('Condition B', [
    rightPanel,
    rightHeader,
    rightTitle,
    rightBullet1,
    rightBullet2,
    rightBullet3,
    rightNote,
  ]);

  const versus = c.ellipse(82, 50, 16, 16, {
    name: 'Versus marker',
    fill: PALETTE.white,
    stroke: PALETTE.ink,
    strokeWidth: 0.4,
  });
  c.text(82, 54.5, 16, 6, 'vs', {
    name: 'Versus text',
    fontSize: 9,
    fontWeight: 700,
    align: 'center',
  });
  c.group('Versus', [versus]);

  c.text(8, 94, 164, 8, 'Figure 4. Direct comparison of conditions A and B.', {
    name: 'Caption',
    fontSize: 8.5,
    italic: true,
    color: PALETTE.muted,
  });

  return doc;
}

// ---------------------------------------------------------------------------
// Timeline — horizontal milestones with alternating labels.
// ---------------------------------------------------------------------------

function buildTimeline(widthMm?: number): FigureDocument {
  const { doc, c } = createScene('Timeline figure', 180, 90, widthMm);

  c.text(8, 4, 164, 8, 'Project timeline', {
    name: 'Title',
    fontSize: 16,
    fontWeight: 700,
  });
  c.text(8, 12, 164, 5, 'Key milestones from inception to completion', {
    name: 'Subtitle',
    fontSize: 8.5,
    italic: true,
    color: PALETTE.muted,
  });

  c.line(14, 49, 152, 0, {
    name: 'Timeline axis',
    stroke: PALETTE.line,
    strokeWidth: 0.6,
  });

  const milestones = [
    { date: 'Q1', label: 'Planning' },
    { date: 'Q2', label: 'Data collection' },
    { date: 'Q3', label: 'Analysis' },
    { date: 'Q4', label: 'Submission' },
  ];

  milestones.forEach((milestone, index) => {
    const cx = 30 + index * 40;
    const above = index % 2 === 0;
    const members: FigureNode[] = [];
    members.push(
      c.ellipse(cx - 4, 45, 8, 8, {
        name: `${milestone.label} marker`,
        fill: PALETTE.accent,
        stroke: PALETTE.white,
        strokeWidth: 0.5,
      }),
    );
    if (above) {
      members.push(
        c.line(cx, 38, 0, 7, {
          name: `${milestone.label} connector`,
          stroke: PALETTE.line,
          strokeWidth: 0.3,
        }),
      );
      members.push(
        c.text(cx - 20, 22, 40, 5, milestone.date, {
          name: `${milestone.label} date`,
          fontSize: 8,
          fontWeight: 700,
          align: 'center',
          color: PALETTE.accent,
        }),
      );
      members.push(
        c.text(cx - 20, 27, 40, 10, milestone.label, {
          name: `${milestone.label} label`,
          fontSize: 8.5,
          align: 'center',
        }),
      );
    } else {
      members.push(
        c.line(cx, 53, 0, 7, {
          name: `${milestone.label} connector`,
          stroke: PALETTE.line,
          strokeWidth: 0.3,
        }),
      );
      members.push(
        c.text(cx - 20, 60, 40, 9, milestone.label, {
          name: `${milestone.label} label`,
          fontSize: 8.5,
          align: 'center',
        }),
      );
      members.push(
        c.text(cx - 20, 69, 40, 5, milestone.date, {
          name: `${milestone.label} date`,
          fontSize: 8,
          fontWeight: 700,
          align: 'center',
          color: PALETTE.accent,
        }),
      );
    }
    c.group(milestone.label, members);
  });

  c.text(8, 78, 164, 6, 'Figure 5. Timeline of project milestones.', {
    name: 'Caption',
    fontSize: 8.5,
    italic: true,
    align: 'center',
    color: PALETTE.muted,
  });

  return doc;
}

export const FIGURE_TEMPLATES: FigureTemplate[] = [
  {
    id: 'single-column',
    nameKey: 'figTemplateSingle',
    descKey: 'figTemplateSingleDesc',
    build: buildSingleColumn,
  },
  {
    id: 'double-column',
    nameKey: 'figTemplateDouble',
    descKey: 'figTemplateDoubleDesc',
    build: buildDoubleColumn,
  },
  {
    id: 'slide',
    nameKey: 'figTemplateSlide',
    descKey: 'figTemplateSlideDesc',
    build: buildSlide,
  },
  {
    id: 'graphical-abstract',
    nameKey: 'figTemplateAbstract',
    descKey: 'figTemplateAbstractDesc',
    build: buildGraphicalAbstract,
  },
  {
    id: 'mechanism',
    nameKey: 'figTemplateMechanism',
    descKey: 'figTemplateMechanismDesc',
    build: buildMechanism,
  },
  {
    id: 'workflow',
    nameKey: 'figTemplateWorkflow',
    descKey: 'figTemplateWorkflowDesc',
    build: buildWorkflow,
  },
  {
    id: 'comparison',
    nameKey: 'figTemplateComparison',
    descKey: 'figTemplateComparisonDesc',
    build: buildComparison,
  },
  {
    id: 'timeline',
    nameKey: 'figTemplateTimeline',
    descKey: 'figTemplateTimelineDesc',
    build: buildTimeline,
  },
];

/** Apply a template by id. Unknown ids fall back to the single-column starter
 *  so the editor always receives a usable document. */
export function applyFigureTemplate(id: string, widthMm?: number): FigureDocument {
  const template = FIGURE_TEMPLATES.find((candidate) => candidate.id === id) ?? FIGURE_TEMPLATES[0];
  return template.build(widthMm);
}
