// PowerPoint export for Figure Studio. Shapes and text become native slide
// objects; images and assets are rasterised to PNG at 2x so SVG assets render
// reliably in PowerPoint. Tint filters are not representable in PPTX, so the
// original artwork is embedded untinted.
import { isNodeVisible, lineEndpoints, rasterizeToPngDataUrl, renderSvg } from './render';
import { bytesToDataUrl } from '$lib/tools/shared/canvas';
import { pxToMm } from './types';
import type {
  AssetNode,
  ChartNode,
  FigureDocument,
  FigureNode,
  ImageFit,
  ImageNode,
  LineNode,
  PathNode,
  ScaleBarNode,
  TextNode,
} from './types';
import type { ResolvedAssets } from './render';

/** Points per CSS pixel (96 dpi -> 72 pt). */
const PX_TO_PT = 72 / 96;
const MM_PER_INCH = 25.4;

type PptxModule = { default?: new () => PptxInstance } & (new () => PptxInstance);
type PptxInstance = {
  defineLayout(layout: { name: string; width: number; height: number }): void;
  layout: string;
  addSlide(): PptxSlide;
  write(options: { outputType: 'arraybuffer' }): Promise<ArrayBuffer>;
  ShapeType: Record<string, string>;
};
type PptxSlide = {
  background: { color: string };
  addShape(type: string, options: Record<string, unknown>): void;
  addText(text: string, options: Record<string, unknown>): void;
  addImage(options: Record<string, unknown>): void;
};

function colorHex(value: string | undefined, fallback = 'FFFFFF'): string {
  const text = (value ?? '').trim();
  const short = /^#?([0-9a-f]{3})$/i.exec(text);
  if (short) return short[1].split('').map((c) => c + c).join('').toUpperCase();
  const full = /^#?([0-9a-f]{6})$/i.exec(text);
  if (full) return full[1].toUpperCase();
  return fallback;
}

function isNone(value: string | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return !text || text === 'none' || text === 'transparent';
}

function dashType(node: FigureNode): string | undefined {
  if (node.dash === 'dashed') return 'dash';
  if (node.dash === 'dotted') return 'sysDot';
  return undefined;
}

function transparency(opacity: number): number {
  return Math.max(0, Math.min(100, Math.round((1 - Math.max(0, Math.min(1, opacity))) * 100)));
}

function fillOptions(node: FigureNode): Record<string, unknown> {
  const alpha = transparency(node.opacity);
  if (isNone(node.fill)) return { color: 'FFFFFF', transparency: 100 };
  return { color: colorHex(node.fill), transparency: alpha };
}

function lineOptions(node: FigureNode): Record<string, unknown> {
  const alpha = transparency(node.opacity);
  if (isNone(node.stroke)) return { color: 'FFFFFF', transparency: 100, width: 0 };
  return {
    color: colorHex(node.stroke, '000000'),
    width: Math.max(0.25, node.strokeWidth * PX_TO_PT),
    dashType: dashType(node),
    transparency: alpha,
  };
}

function shapeTypeForRect(node: FigureNode): string {
  return node.cornerRadius > 0 ? 'roundRect' : 'rect';
}

function imageFitSizing(fit: ImageFit, w: number, h: number): Record<string, unknown> | undefined {
  if (fit === 'stretch') return undefined;
  return { type: fit, w, h };
}

function imageSource(node: AssetNode | ImageNode, assets: ResolvedAssets | undefined): string | undefined {
  if (node.type === 'image') return node.dataUrl || undefined;
  return assets?.get(node.assetId)?.dataUrl ?? (node.svgFile || undefined);
}

function textOptions(node: TextNode): Record<string, unknown> {
  const options: Record<string, unknown> = {
    x: node.x / 96,
    y: node.y / 96,
    w: node.w / 96,
    h: node.h / 96,
    fontFace: node.fontFamily,
    fontSize: node.fontSize,
    color: colorHex(node.color, '111827'),
    bold: node.fontWeight >= 600,
    italic: node.italic,
    align: node.align,
    valign: 'top',
    margin: node.padding * PX_TO_PT,
    rotate: node.rotation || undefined,
    transparency: transparency(node.opacity),
  };
  if (!isNone(node.background)) {
    options.fill = { color: colorHex(node.background, 'FFFFFF'), transparency: 0 };
  }
  return options;
}

async function addImageNode(
  slide: PptxSlide,
  node: AssetNode | ImageNode,
  assets: ResolvedAssets | undefined,
): Promise<void> {
  const source = imageSource(node, assets);
  if (!source) return;
  const png = await rasterizeToPngDataUrl(source, node.w, node.h, 2);
  const w = node.w / 96;
  const h = node.h / 96;
  const options: Record<string, unknown> = {
    data: png,
    x: node.x / 96,
    y: node.y / 96,
    rotate: node.rotation || undefined,
    flipH: node.flipX || undefined,
    flipV: node.flipY || undefined,
  };
  const fit: ImageFit = node.type === 'image' ? node.fit : 'contain';
  const sizing = imageFitSizing(fit, w, h);
  if (sizing) {
    options.sizing = sizing;
  } else {
    options.w = w;
    options.h = h;
  }
  slide.addImage(options);
}

/**
 * Charts and scale bars are vector in SVG/PDF exports but PowerPoint has no
 * direct equivalent for either. Rasterise just that node (transparent
 * background) so the slide keeps the exact Figure Studio appearance.
 */
async function addRasterisedNode(
  slide: PptxSlide,
  node: ChartNode | ScaleBarNode | ImageNode | PathNode,
  doc: FigureDocument,
  assets: ResolvedAssets | undefined,
): Promise<void> {
  const widthPx = Math.max(1, node.w);
  const heightPx = Math.max(1, node.h);
  const mini: FigureDocument = {
    ...doc,
    name: node.name,
    widthMm: pxToMm(widthPx),
    heightMm: pxToMm(heightPx),
    background: 'none',
    nodes: [{ ...node, x: 0, y: 0, rotation: 0, hidden: false, locked: false }],
    groups: [],
  };
  const svg = renderSvg(mini, assets);
  const dataUrl = await bytesToDataUrl(new TextEncoder().encode(svg), 'image/svg+xml');
  const png = await rasterizeToPngDataUrl(dataUrl, widthPx, heightPx, 2);
  slide.addImage({
    data: png,
    x: node.x / 96,
    y: node.y / 96,
    w: node.w / 96,
    h: node.h / 96,
    rotate: node.rotation || undefined,
  });
}

function addLineNode(slide: PptxSlide, node: LineNode, pptx: PptxInstance): void {
  const { x1, y1, x2, y2 } = lineEndpoints(node);
  const line = lineOptions(node);
  if (node.type === 'arrow') {
    if (node.headStart) line.beginArrowType = 'triangle';
    if (node.headEnd) line.endArrowType = 'triangle';
  }
  slide.addShape(pptx.ShapeType.line, {
    x: x1 / 96,
    y: y1 / 96,
    w: (x2 - x1) / 96,
    h: (y2 - y1) / 96,
    line,
    rotate: node.rotation || undefined,
  });
}

/**
 * Build an editable PPTX: native shapes/text and rasterised images on a slide
 * sized to the document's physical dimensions.
 */
export async function renderPptx(doc: FigureDocument, assets?: ResolvedAssets): Promise<Uint8Array> {
  const imported = (await import('pptxgenjs')) as unknown as PptxModule;
  const PptxGen = imported.default ?? imported;
  const pptx = new PptxGen();
  const widthIn = Math.max(0.1, doc.widthMm / MM_PER_INCH);
  const heightIn = Math.max(0.1, doc.heightMm / MM_PER_INCH);
  pptx.defineLayout({ name: 'FIGURE_STUDIO', width: widthIn, height: heightIn });
  pptx.layout = 'FIGURE_STUDIO';

  const slide = pptx.addSlide();
  slide.background = { color: isNone(doc.background) ? 'FFFFFF' : colorHex(doc.background, 'FFFFFF') };

  for (const node of doc.nodes) {
    if (!isNodeVisible(doc, node)) continue;
    switch (node.type) {
      case 'rect':
      case 'ellipse': {
        const type = node.type === 'rect' ? shapeTypeForRect(node) : pptx.ShapeType.ellipse;
        const options: Record<string, unknown> = {
          x: node.x / 96,
          y: node.y / 96,
          w: node.w / 96,
          h: node.h / 96,
          fill: fillOptions(node),
          line: lineOptions(node),
          rotate: node.rotation || undefined,
        };
        if (node.type === 'rect' && node.cornerRadius > 0) {
          options.rectRadius = node.cornerRadius / 96;
        }
        slide.addShape(type, options);
        break;
      }
      case 'line':
      case 'arrow':
        addLineNode(slide, node, pptx);
        break;
      case 'text':
        slide.addText(node.text, textOptions(node));
        break;
      case 'image':
        if (node.crop) await addRasterisedNode(slide, node, doc, assets);
        else await addImageNode(slide, node, assets);
        break;
      case 'asset':
        await addImageNode(slide, node, assets);
        break;
      case 'chart':
      case 'scalebar':
      case 'path':
        await addRasterisedNode(slide, node, doc, assets);
        break;
    }
  }

  const out = await pptx.write({ outputType: 'arraybuffer' });
  return new Uint8Array(out);
}
