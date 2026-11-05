// SVG -> Figure Studio vector import.
//
// The importer lives in the browser: it injects a sanitised copy of the source
// SVG into an offscreen host so getComputedStyle(), getBBox() and getCTM()
// resolve real styles and geometry, then walks the drawable elements and maps
// them onto the Figure Studio node model. Every node is emitted in a local
// coordinate space whose top-left corner is (0, 0); placeVectorImport() fits
// that space onto a page at insert time.
//
// The geometry helpers deliberately fall back to attribute based maths when a
// DOM implementation does not implement the SVG geometry APIs (jsdom is the
// common case, and it keeps the unit tests meaningful without a real browser).

import {
  clamp,
  createEllipseNode,
  createFigureId,
  createImageNode,
  createPathNode,
  createRectNode,
  createTextNode,
  nodeBounds,
  DEFAULT_FIGURE_FONT,
  type DashStyle,
  type FigureGroup,
  type FigureNode,
  type ImageFit,
  type PathPoint,
  type TextAlign,
} from './types';

export interface VectorImportResult {
  nodes: FigureNode[];
  groups: FigureGroup[];
  width: number;
  height: number;
  warnings: string[];
}

interface Point {
  x: number;
  y: number;
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ConvertContext {
  root: SVGSVGElement;
  warnings: string[];
  warned: Set<string>;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const DRAWABLE = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'image',
]);

// Tag names are compared after toLowerCase(), so SVG camelCase names are lower.
const UNSUPPORTED = new Set([
  'use',
  'foreignobject',
  'clippath',
  'mask',
  'marker',
  'pattern',
  'symbol',
  'filter',
  'script',
]);

// Styling is consumed through getComputedStyle(), so <style> is not "skipped".
const IGNORED = new Set(['defs', 'title', 'desc', 'metadata', 'style']);

const INHERITED_STYLES = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'fill-opacity',
  'stroke-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'color',
  'visibility',
  'marker-start',
  'marker-mid',
  'marker-end',
]);

// jsdom exposes getComputedStyle() but returns SVG defaults instead of
// presentation attributes (for example fill is always rgb(0, 0, 0)). When the
// native geometry APIs are missing we read style/attributes directly instead.
const NATIVE_SVG_STYLES =
  typeof SVGSVGElement !== 'undefined' &&
  typeof (SVGSVGElement.prototype as unknown as { getBBox?: unknown }).getBBox === 'function';

// --------------------------------------------------------------------- matrix

function multiply(a: Matrix, b: Matrix): Matrix {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

function translate(x: number, y: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function scaleMatrix(x: number, y: number): Matrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function rotateMatrix(degrees: number): Matrix {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

function applyMatrix(matrix: Matrix, x: number, y: number): Point {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function numbersIn(value: string): number[] {
  return (value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [])
    .map(Number)
    .filter((number) => Number.isFinite(number));
}

/** Parse one `transform` attribute into a matrix. */
function parseTransform(value: string | null): Matrix {
  if (!value) return IDENTITY;
  let matrix = IDENTITY;
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(value))) {
    const name = match[1].toLowerCase();
    const args = numbersIn(match[2]);
    let current = IDENTITY;
    switch (name) {
      case 'matrix':
        if (args.length >= 6) {
          current = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] };
        }
        break;
      case 'translate':
        current = translate(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale': {
        const sx = args[0] ?? 1;
        current = scaleMatrix(sx, args[1] ?? sx);
        break;
      }
      case 'rotate': {
        const angle = args[0] ?? 0;
        const rotation = rotateMatrix(angle);
        current =
          args.length >= 3
            ? multiply(multiply(translate(args[1], args[2]), rotation), translate(-args[1], -args[2]))
            : rotation;
        break;
      }
      case 'skewx':
        current = { ...IDENTITY, c: Math.tan(((args[0] ?? 0) * Math.PI) / 180) };
        break;
      case 'skewy':
        current = { ...IDENTITY, b: Math.tan(((args[0] ?? 0) * Math.PI) / 180) };
        break;
      default:
        break;
    }
    matrix = multiply(matrix, current);
  }
  return matrix;
}

function isUsableMatrix(matrix: Matrix): boolean {
  return (
    Number.isFinite(matrix.a) &&
    Number.isFinite(matrix.b) &&
    Number.isFinite(matrix.c) &&
    Number.isFinite(matrix.d) &&
    Number.isFinite(matrix.e) &&
    Number.isFinite(matrix.f)
  );
}

/**
 * Transform from an element's local user space into the import coordinate
 * space. Browsers supply getCTM(); the fallback composes transform attributes
 * and the root viewBox offset so jsdom and older engines still work.
 */
function elementMatrix(element: Element, root: SVGSVGElement, rootMatrix: Matrix): Matrix {
  const withCtm = element as Element & { getCTM?: () => DOMMatrix | SVGMatrix | null };
  if (typeof withCtm.getCTM === 'function') {
    try {
      const native = withCtm.getCTM();
      if (native) {
        const matrix = { a: native.a, b: native.b, c: native.c, d: native.d, e: native.e, f: native.f };
        if (isUsableMatrix(matrix)) return matrix;
      }
    } catch {
      /* fall through to the attribute based path */
    }
  }

  const chain: Element[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    chain.push(current);
    current = current.parentElement;
  }
  let matrix = rootMatrix;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    matrix = multiply(matrix, parseTransform(chain[index].getAttribute('transform')));
  }
  return matrix;
}

interface DecomposedMatrix {
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/** Decompose scale/rotation; skew is approximated by the column lengths. */
function decomposeMatrix(matrix: Matrix): DecomposedMatrix {
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const scaleY = scaleX > 1e-9 ? Math.abs(determinant) / scaleX : Math.hypot(matrix.c, matrix.d);
  const rotation = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
  return {
    scaleX: Math.max(scaleX, 1e-9),
    scaleY: Math.max(scaleY, 1e-9),
    rotation: Number.isFinite(rotation) ? rotation : 0,
  };
}

function uniformScale(decomposed: DecomposedMatrix): number {
  return Math.sqrt(decomposed.scaleX * decomposed.scaleY) || Math.max(decomposed.scaleX, decomposed.scaleY);
}

// ---------------------------------------------------------------------- units

function parseLength(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toLowerCase();
  switch (unit) {
    case '':
    case 'px':
      return amount;
    case 'pt':
      return (amount * 96) / 72;
    case 'pc':
      return amount * 16;
    case 'mm':
      return (amount * 96) / 25.4;
    case 'cm':
      return (amount * 96) / 2.54;
    case 'in':
      return amount * 96;
    case '%':
      return null;
    default:
      return amount;
  }
}

function numberAttribute(element: Element, name: string, fallback = 0): number {
  return parseLength(element.getAttribute(name)) ?? fallback;
}

function parseViewBox(value: string | null): BBox | null {
  if (!value) return null;
  const parts = numbersIn(value);
  if (parts.length < 4) return null;
  const [x, y, width, height] = parts;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

// --------------------------------------------------------------------- styles

function rawStyleValue(element: Element, property: string): string {
  const raw = element.getAttribute('style');
  if (!raw) return '';
  const wanted = property.toLowerCase();
  for (const declaration of raw.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    if (declaration.slice(0, separator).trim().toLowerCase() === wanted) {
      return declaration.slice(separator + 1).trim();
    }
  }
  return '';
}

function ownStyleValue(element: Element, property: string): string {
  if (NATIVE_SVG_STYLES && typeof window !== 'undefined') {
    try {
      const computed = window.getComputedStyle(element).getPropertyValue(property);
      if (computed && computed.trim() && computed.trim() !== 'auto') return computed.trim();
    } catch {
      /* not rendered */
    }
  }
  const inline = rawStyleValue(element, property);
  if (inline && inline !== 'auto') return inline;
  const attribute = element.getAttribute(property);
  if (attribute && attribute.trim() && attribute.trim() !== 'auto') return attribute.trim();
  return '';
}

/** Read a style, walking ancestors for inherited SVG presentation values. */
function styleValue(element: Element, property: string): string {
  let current: Element | null = element;
  while (current) {
    const value = ownStyleValue(current, property);
    if (value) return value;
    if (!INHERITED_STYLES.has(property)) return '';
    current = current.parentElement;
  }
  return '';
}

function ownOpacity(element: Element): number {
  const raw = ownStyleValue(element, 'opacity');
  if (!raw) return 1;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

function effectiveOpacity(element: Element): number {
  let value = ownOpacity(element);
  let current = element.parentElement;
  while (current) {
    value *= ownOpacity(current);
    current = current.parentElement;
  }
  return clamp(value, 0, 1);
}

function paintOpacity(element: Element, fill: string, stroke: string): number {
  const fillOpacity = numberInUnitRange(styleValue(element, 'fill-opacity'));
  const strokeOpacity = numberInUnitRange(styleValue(element, 'stroke-opacity'));
  if (fill !== 'none' && stroke !== 'none') return Math.max(fillOpacity, strokeOpacity);
  if (fill !== 'none') return fillOpacity;
  if (stroke !== 'none') return strokeOpacity;
  return 1;
}

function numberInUnitRange(value: string): number {
  if (!value) return 1;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 1;
}

function findById(root: SVGSVGElement, id: string): Element | null {
  if (root.getAttribute('id') === id) return root;
  const all = root.querySelectorAll('[id]');
  for (const element of all) {
    if (element.getAttribute('id') === id) return element;
  }
  return null;
}

function rgbToColor(value: string): string | null {
  const match = /rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)/i.exec(
    value,
  );
  if (!match) return null;
  const component = (text: string) => clamp(Math.round(Number(text)), 0, 255);
  const red = component(match[1]);
  const green = component(match[2]);
  const blue = component(match[3]);
  const alphaText = match[4];
  if (alphaText !== undefined) {
    const alpha = match[5] === '%' ? Number(alphaText) / 100 : Number(alphaText);
    if (Number.isFinite(alpha)) {
      if (alpha <= 0.001) return 'none';
      if (alpha < 0.999) return `rgba(${red}, ${green}, ${blue}, ${Math.round(alpha * 1000) / 1000})`;
    }
  }
  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue
    .toString(16)
    .padStart(2, '0')}`;
}

function firstGradientStop(root: SVGSVGElement, id: string): string {
  const gradient = findById(root, id);
  if (!gradient) return '';
  const stops = gradient.querySelectorAll('stop');
  for (const stop of stops) {
    const color = styleValue(stop, 'stop-color');
    if (!color || color === 'none' || /^url\(/i.test(color)) continue;
    const opacity = Number.parseFloat(styleValue(stop, 'stop-opacity') || '1');
    if (Number.isFinite(opacity) && opacity <= 0.001) continue;
    return color;
  }
  return '';
}

function normalizeColor(value: string, element: Element, root: SVGSVGElement): string {
  const text = value.trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  if (lower === 'none' || lower === 'transparent') return 'none';
  if (lower === 'currentcolor') {
    const inherited = styleValue(element, 'color');
    return inherited ? normalizeColor(inherited, element, root) : '#000000';
  }
  const gradient = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(text);
  if (gradient) {
    const stop = firstGradientStop(root, decodeURIComponent(gradient[1]));
    return stop ? normalizeColor(stop, element, root) : 'none';
  }
  if (/^rgba?\(/i.test(text)) return rgbToColor(text) ?? text;
  return text;
}

function resolvePaint(element: Element, root: SVGSVGElement, property: 'fill' | 'stroke'): string {
  const raw = styleValue(element, property);
  // SVG paints black by default; strokes are absent by default.
  if (!raw) return property === 'fill' ? '#000000' : 'none';
  return normalizeColor(raw, element, root) || (property === 'fill' ? '#000000' : 'none');
}

function resolveStrokeWidth(element: Element, scale: number): number {
  const raw = styleValue(element, 'stroke-width');
  const parsed = parseLength(raw);
  return Math.max(0, (parsed ?? 1) * scale);
}

function resolveDash(element: Element, strokeWidth: number): DashStyle {
  const raw = styleValue(element, 'stroke-dasharray').toLowerCase();
  if (!raw || raw === 'none' || raw === 'solid') return 'solid';
  const values = numbersIn(raw).filter((number) => number > 0);
  if (!values.length) return 'solid';
  return values[0] <= strokeWidth * 1.5 + 0.5 ? 'dotted' : 'dashed';
}

function parseFontSize(element: Element): number {
  const raw = styleValue(element, 'font-size');
  const parsed = parseLength(raw);
  return parsed && parsed > 0 ? parsed : 16;
}

function parseFontFamily(element: Element): string {
  const raw = styleValue(element, 'font-family');
  if (!raw) return DEFAULT_FIGURE_FONT;
  const first = raw.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  return first || DEFAULT_FIGURE_FONT;
}

function parseFontWeight(element: Element): 400 | 500 | 600 | 700 | 800 {
  const raw = styleValue(element, 'font-weight').toLowerCase();
  if (!raw) return 400;
  if (raw === 'normal') return 400;
  if (raw === 'bold' || raw === 'bolder') return 700;
  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric)) return 400;
  if (numeric <= 400) return 400;
  if (numeric <= 500) return 500;
  if (numeric <= 600) return 600;
  if (numeric <= 700) return 700;
  return 800;
}

function parseTextAlign(element: Element): TextAlign {
  const anchor = styleValue(element, 'text-anchor').toLowerCase();
  if (anchor === 'middle') return 'center';
  if (anchor === 'end') return 'right';
  return 'left';
}

function isItalic(element: Element): boolean {
  return /italic|oblique/i.test(styleValue(element, 'font-style'));
}

/** SVG arrows are markers; the node model stores triangle heads instead. */
function hasMarker(element: Element, property: 'marker-start' | 'marker-end'): boolean {
  const value = styleValue(element, property).trim().toLowerCase();
  return !!value && value !== 'none';
}

// ------------------------------------------------------------------- geometry

function bboxOf(element: Element): BBox | null {
  const withBBox = element as Element & { getBBox?: () => DOMRect | null };
  if (typeof withBBox.getBBox === 'function') {
    try {
      const native = withBBox.getBBox();
      if (native && (native.width > 0 || native.height > 0)) {
        return { x: native.x, y: native.y, width: native.width, height: native.height };
      }
    } catch {
      /* fall through */
    }
  }
  return attributeBBox(element);
}

function attributeBBox(element: Element): BBox | null {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'rect':
    case 'image':
    case 'foreignobject': {
      const x = numberAttribute(element, 'x');
      const y = numberAttribute(element, 'y');
      const width = Math.max(0, numberAttribute(element, 'width'));
      const height = Math.max(0, numberAttribute(element, 'height'));
      return tlwh(x, y, width, height);
    }
    case 'circle': {
      const cx = numberAttribute(element, 'cx');
      const cy = numberAttribute(element, 'cy');
      const r = Math.max(0, numberAttribute(element, 'r'));
      return tlwh(cx - r, cy - r, r * 2, r * 2);
    }
    case 'ellipse': {
      const cx = numberAttribute(element, 'cx');
      const cy = numberAttribute(element, 'cy');
      const rx = Math.max(0, numberAttribute(element, 'rx'));
      const ry = Math.max(0, numberAttribute(element, 'ry'));
      return tlwh(cx - rx, cy - ry, rx * 2, ry * 2);
    }
    case 'line': {
      const x1 = numberAttribute(element, 'x1');
      const y1 = numberAttribute(element, 'y1');
      const x2 = numberAttribute(element, 'x2');
      const y2 = numberAttribute(element, 'y2');
      return tlwh(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    case 'polyline':
    case 'polygon': {
      const points = parsePointsAttribute(element.getAttribute('points') ?? '');
      return pointsBBox(points);
    }
    case 'text': {
      const lines = elementText(element).split('\n');
      const fontSize = parseFontSize(element);
      const width = Math.max(1, Math.max(...lines.map((line) => line.length)) * fontSize * 0.6);
      const height = Math.max(fontSize, lines.length * fontSize * 1.2);
      let x = numberAttribute(element, 'x');
      const y = numberAttribute(element, 'y');
      const anchor = styleValue(element, 'text-anchor').toLowerCase();
      if (anchor === 'middle') x -= width / 2;
      else if (anchor === 'end') x -= width;
      return tlwh(x, y - fontSize * 0.8, width, height);
    }
    case 'path': {
      const parsed = parsePathData(element.getAttribute('d') ?? '');
      return pointsBBox(parsed.points);
    }
    default:
      return null;
  }
}

function tlwh(x: number, y: number, width: number, height: number): BBox {
  return { x, y, width, height };
}

function pointsBBox(points: Point[]): BBox | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return tlwh(minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY));
}

function parsePointsAttribute(value: string): Point[] {
  const numbers = numbersIn(value);
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

// ---------------------------------------------------------------- path parser

function tokenizePathData(data: string): string[] {
  return (data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).filter(
    (token) => token.length > 0,
  );
}

function cubicAt(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  };
}

function quadraticAt(start: Point, control: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
    y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
  };
}

/**
 * Fallback path flattener used when getTotalLength() is unavailable. Curves are
 * sampled, arcs are approximated by their endpoints. Multiple subpaths are
 * flattened into one polyline (the node model only stores one).
 */
function parsePathData(data: string): { points: Point[]; closed: boolean } {
  const tokens = tokenizePathData(data);
  const points: Point[] = [];
  let index = 0;
  let command = '';
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let previousControl: Point | null = null;
  let closed = false;

  const push = (point: Point) => {
    points.push(point);
    current = point;
  };
  const read = (): number => {
    const value = Number.parseFloat(tokens[index] ?? '');
    index += 1;
    return Number.isFinite(value) ? value : 0;
  };
  const absolute = (x: number, y: number, relative: boolean): Point =>
    relative ? { x: current.x + x, y: current.y + y } : { x, y };

  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[a-zA-Z]$/.test(token)) {
      command = token;
      index += 1;
      if (command.toLowerCase() === 'z') {
        closed = true;
        push({ x: start.x, y: start.y });
        previousControl = null;
      }
      continue;
    }
    if (!command) {
      index += 1;
      continue;
    }

    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    switch (upper) {
      case 'M': {
        const point = absolute(read(), read(), relative);
        start = point;
        push(point);
        // Additional coordinate pairs after a moveto are treated as lineto.
        command = relative ? 'l' : 'L';
        previousControl = null;
        break;
      }
      case 'L': {
        push(absolute(read(), read(), relative));
        previousControl = null;
        break;
      }
      case 'H': {
        const x = read();
        push({ x: relative ? current.x + x : x, y: current.y });
        previousControl = null;
        break;
      }
      case 'V': {
        const y = read();
        push({ x: current.x, y: relative ? current.y + y : y });
        previousControl = null;
        break;
      }
      case 'C': {
        const origin = current;
        const control1 = absolute(read(), read(), relative);
        const control2 = absolute(read(), read(), relative);
        const end = absolute(read(), read(), relative);
        for (let step = 1; step <= 8; step += 1) {
          push(cubicAt(origin, control1, control2, end, step / 8));
        }
        previousControl = control2;
        break;
      }
      case 'S': {
        const origin = current;
        const control1: Point = previousControl
          ? { x: 2 * origin.x - previousControl.x, y: 2 * origin.y - previousControl.y }
          : origin;
        const control2 = absolute(read(), read(), relative);
        const end = absolute(read(), read(), relative);
        for (let step = 1; step <= 8; step += 1) {
          push(cubicAt(origin, control1, control2, end, step / 8));
        }
        previousControl = control2;
        break;
      }
      case 'Q': {
        const origin = current;
        const control: Point = absolute(read(), read(), relative);
        const end = absolute(read(), read(), relative);
        for (let step = 1; step <= 8; step += 1) {
          push(quadraticAt(origin, control, end, step / 8));
        }
        previousControl = control;
        break;
      }
      case 'T': {
        const origin = current;
        const control: Point = previousControl
          ? { x: 2 * origin.x - previousControl.x, y: 2 * origin.y - previousControl.y }
          : origin;
        const end = absolute(read(), read(), relative);
        for (let step = 1; step <= 8; step += 1) {
          push(quadraticAt(origin, control, end, step / 8));
        }
        previousControl = control;
        break;
      }
      case 'A': {
        // Arc flags are skipped; the endpoint keeps the diagram connected.
        read();
        read();
        read();
        read();
        read();
        push(absolute(read(), read(), relative));
        previousControl = null;
        break;
      }
      default: {
        index += 1;
        break;
      }
    }
  }

  return { points, closed };
}

function dedupePoints(points: Point[], closed: boolean): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const previous = output[output.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1e-9) continue;
    output.push(point);
  }
  if (closed && output.length > 1) {
    const first = output[0];
    const last = output[output.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-9) output.pop();
  }
  return output;
}

function resample(points: Point[], closed: boolean, count: number): Point[] {
  const source = closed && points.length > 1 ? [...points, points[0]] : points;
  if (source.length < 2) return points.slice();
  let total = 0;
  const lengths: number[] = [0];
  for (let index = 1; index < source.length; index += 1) {
    total += Math.hypot(source[index].x - source[index - 1].x, source[index].y - source[index - 1].y);
    lengths.push(total);
  }
  if (total <= 1e-9) return points.slice();
  const output: Point[] = [];
  for (let sample = 0; sample < count; sample += 1) {
    const target = (total * sample) / (count - 1);
    let segment = 1;
    while (segment < lengths.length - 1 && lengths[segment] < target) segment += 1;
    const span = lengths[segment] - lengths[segment - 1] || 1;
    const t = clamp((target - lengths[segment - 1]) / span, 0, 1);
    output.push({
      x: source[segment - 1].x + (source[segment].x - source[segment - 1].x) * t,
      y: source[segment - 1].y + (source[segment].y - source[segment - 1].y) * t,
    });
  }
  return dedupePoints(output, closed);
}

function sampleNativePath(element: SVGPathElement, closed: boolean): Point[] | null {
  if (
    typeof element.getTotalLength !== 'function' ||
    typeof element.getPointAtLength !== 'function'
  ) {
    return null;
  }
  try {
    const total = element.getTotalLength();
    if (!Number.isFinite(total) || total <= 1e-9) return null;
    const count = clamp(Math.ceil(total / 6) + 1, 4, 200);
    const points: Point[] = [];
    for (let index = 0; index < count; index += 1) {
      const distance = (total * index) / (count - 1);
      const point = element.getPointAtLength(distance);
      points.push({ x: point.x, y: point.y });
    }
    return dedupePoints(points, closed);
  } catch {
    return null;
  }
}

function pathPoints(
  element: Element,
): { points: Point[]; closed: boolean; bounds: Point[] } | null {
  const data = element.getAttribute('d') ?? '';
  if (!data.trim()) return null;
  const closed = /z/i.test(data);
  const native = sampleNativePath(element as SVGPathElement, closed);
  const parsed = parsePathData(data);
  // Keep the original vertices for the bounding box: uniform sampling can
  // clip a sharp corner, which would otherwise leave a gap in the node box.
  const bounds = parsed.points.length ? parsed.points : [];
  if (native && native.length >= 2) {
    return { points: native, closed, bounds: bounds.length ? bounds : native };
  }
  const count = clamp(parsed.points.length * 2, 4, 200);
  return {
    points: resample(parsed.points, parsed.closed || closed, count),
    closed: parsed.closed || closed,
    bounds: bounds.length ? bounds : parsed.points,
  };
}

// ----------------------------------------------------------------------- text

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .trim();
}

function elementText(element: Element): string {
  const tspans = Array.from(element.querySelectorAll('tspan'));
  if (tspans.length) {
    const leaves = tspans.filter((tspan) => !tspan.querySelector('tspan'));
    const lines = leaves.map((tspan) => normalizeText(tspan.textContent ?? ''));
    // Drop leading/trailing blank lines but keep intentional spacing inside.
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    if (lines.length) return lines.join('\n');
  }
  return normalizeText(element.textContent ?? '');
}

// ------------------------------------------------------------------ traversal

function groupIdentity(element: Element): boolean {
  return (
    element.hasAttribute('data-name') ||
    element.hasAttribute('data-label') ||
    element.hasAttribute('aria-label') ||
    element.hasAttribute('inkscape:label') ||
    element.hasAttribute('id')
  );
}

function isNodeGroup(element: Element): boolean {
  return /(^|\s)node(\s|$)/.test(` ${element.getAttribute('class') ?? ''} `);
}

function isClusterGroup(element: Element): boolean {
  return /(^|\s)cluster(\s|$)/.test(` ${element.getAttribute('class') ?? ''} `);
}

function groupName(element: Element): string {
  for (const attribute of ['data-name', 'aria-label', 'inkscape:label', 'data-label']) {
    const value = normalizeText(element.getAttribute(attribute) ?? '');
    if (value) return value.slice(0, 60);
  }
  const label = elementText(element).split('\n')[0] ?? '';
  if (label) return label.slice(0, 60);
  const id = element.getAttribute('id') ?? '';
  return id ? id.slice(0, 60) : 'Group';
}

function isDisplayNone(element: Element): boolean {
  const display = styleValue(element, 'display').toLowerCase();
  if (display === 'none') return true;
  if (typeof window !== 'undefined') {
    try {
      return window.getComputedStyle(element).display === 'none';
    } catch {
      return false;
    }
  }
  return false;
}

function isVisibilityHidden(element: Element): boolean {
  return styleValue(element, 'visibility').toLowerCase() === 'hidden';
}

function warnOnce(context: ConvertContext, key: string, message: string): void {
  if (context.warned.has(key)) return;
  context.warned.add(key);
  context.warnings.push(message);
}

function applyCommon(
  node: FigureNode,
  element: Element,
  context: ConvertContext,
  groupId: string | null,
  scale: number,
): void {
  node.fill = resolvePaint(element, context.root, 'fill');
  node.stroke = resolvePaint(element, context.root, 'stroke');
  node.strokeWidth = resolveStrokeWidth(element, scale);
  node.dash = resolveDash(element, node.strokeWidth);
  node.opacity = clamp(effectiveOpacity(element) * paintOpacity(element, node.fill, node.stroke), 0, 1);
  if (groupId) node.groupId = groupId;
}

function convertRect(
  element: Element,
  context: ConvertContext,
  groupId: string | null,
  matrix: Matrix,
): FigureNode | null {
  const bbox = bboxOf(element);
  if (!bbox) return null;
  const decomposed = decomposeMatrix(matrix);
  const scale = uniformScale(decomposed);
  const center = applyMatrix(matrix, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  const width = Math.max(0.01, bbox.width * decomposed.scaleX);
  const height = Math.max(0.01, bbox.height * decomposed.scaleY);
  const node = createRectNode(center.x - width / 2, center.y - height / 2, width, height);
  node.rotation = decomposed.rotation;
  const radius = parseLength(element.getAttribute('rx')) ?? parseLength(element.getAttribute('ry')) ?? 0;
  node.cornerRadius = Math.max(0, radius * decomposed.scaleX);
  applyCommon(node, element, context, groupId, scale);
  const id = element.getAttribute('id');
  if (id) node.name = id;
  return node;
}

function convertEllipse(
  element: Element,
  context: ConvertContext,
  groupId: string | null,
  matrix: Matrix,
): FigureNode | null {
  const bbox = bboxOf(element);
  if (!bbox) return null;
  const decomposed = decomposeMatrix(matrix);
  const scale = uniformScale(decomposed);
  const center = applyMatrix(matrix, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  const width = Math.max(0.01, bbox.width * decomposed.scaleX);
  const height = Math.max(0.01, bbox.height * decomposed.scaleY);
  const node = createEllipseNode(center.x - width / 2, center.y - height / 2, width, height);
  node.rotation = decomposed.rotation;
  applyCommon(node, element, context, groupId, scale);
  const id = element.getAttribute('id');
  if (id) node.name = id;
  return node;
}

function convertText(
  element: Element,
  context: ConvertContext,
  groupId: string | null,
  matrix: Matrix,
): FigureNode | null {
  const content = elementText(element);
  if (!content) return null;
  const bbox = bboxOf(element);
  if (!bbox) return null;
  const decomposed = decomposeMatrix(matrix);
  const scale = uniformScale(decomposed);
  const center = applyMatrix(matrix, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  const width = Math.max(1, bbox.width * decomposed.scaleX);
  const height = Math.max(1, bbox.height * decomposed.scaleY);
  const node = createTextNode(center.x - width / 2, center.y - height / 2, content);
  node.w = width;
  node.h = height;
  node.rotation = decomposed.rotation;
  node.name = content.split('\n')[0].slice(0, 28) || 'Text';
  node.fontFamily = parseFontFamily(element);
  // The SVG coordinate space is CSS pixels at 96 dpi; the model stores points.
  node.fontSize = Math.max(1, parseFontSize(element) * scale * 0.75);
  node.fontWeight = parseFontWeight(element);
  node.italic = isItalic(element);
  node.align = parseTextAlign(element);
  node.lineHeight = 1.2;
  node.padding = 0;
  const fill = resolvePaint(element, context.root, 'fill');
  node.color = fill === 'none' ? '#000000' : fill;
  node.background = 'none';
  node.fill = 'none';
  node.stroke = 'none';
  node.strokeWidth = 0;
  node.opacity = clamp(
    effectiveOpacity(element) * numberInUnitRange(styleValue(element, 'fill-opacity')),
    0,
    1,
  );
  if (groupId) node.groupId = groupId;
  return node;
}

function convertImage(
  element: Element,
  context: ConvertContext,
  groupId: string | null,
  matrix: Matrix,
): FigureNode | null {
  const href =
    element.getAttribute('href') ??
    element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    element.getAttribute('xlink:href') ??
    '';
  if (!/^data:image\//i.test(href)) {
    warnOnce(
      context,
      'image-external',
      'Skipped an image that is not embedded as a data: URL. Export it as a data URL first.',
    );
    return null;
  }
  const bbox = bboxOf(element);
  if (!bbox) return null;
  const decomposed = decomposeMatrix(matrix);
  const scale = uniformScale(decomposed);
  const width = Math.max(1, bbox.width * decomposed.scaleX);
  const height = Math.max(1, bbox.height * decomposed.scaleY);
  const center = applyMatrix(matrix, bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
  const mime = /^data:([^;,]+)/i.exec(href)?.[1] ?? 'image/png';
  const node = createImageNode(href, mime, center.x - width / 2, center.y - height / 2, width, height);
  const preserve = (element.getAttribute('preserveAspectRatio') ?? '').toLowerCase();
  const fit: ImageFit = preserve.includes('none')
    ? 'stretch'
    : preserve.includes('slice')
      ? 'cover'
      : 'contain';
  node.fit = fit;
  node.rotation = decomposed.rotation;
  node.fill = 'none';
  node.stroke = resolvePaint(element, context.root, 'stroke');
  node.strokeWidth = resolveStrokeWidth(element, scale);
  node.opacity = effectiveOpacity(element);
  if (groupId) node.groupId = groupId;
  return node;
}

function convertPath(
  element: Element,
  context: ConvertContext,
  groupId: string | null,
  matrix: Matrix,
): FigureNode | null {
  const tag = element.tagName.toLowerCase();
  let localPoints: Point[] = [];
  let boundsPoints: Point[] = [];
  let closed = false;

  if (tag === 'line') {
    localPoints = [
      { x: numberAttribute(element, 'x1'), y: numberAttribute(element, 'y1') },
      { x: numberAttribute(element, 'x2'), y: numberAttribute(element, 'y2') },
    ];
    boundsPoints = localPoints;
  } else if (tag === 'polyline' || tag === 'polygon') {
    localPoints = parsePointsAttribute(element.getAttribute('points') ?? '');
    boundsPoints = localPoints;
    closed = tag === 'polygon';
  } else {
    const data = element.getAttribute('d') ?? '';
    if ((data.match(/[Mm]/g) ?? []).length > 1) {
      warnOnce(
        context,
        'path:subpaths',
        'Flattened a path with multiple subpaths into a single editable outline.',
      );
    }
    const sampled = pathPoints(element);
    if (!sampled) return null;
    localPoints = sampled.points;
    boundsPoints = sampled.bounds;
    closed = sampled.closed;
  }

  if (localPoints.length < 2) return null;
  const points = localPoints.map((point) => applyMatrix(matrix, point.x, point.y));
  const bounds = boundsPoints.map((point) => applyMatrix(matrix, point.x, point.y));
  const bbox = pointsBBox([...points, ...bounds]) ?? pointsBBox(points);
  if (!bbox) return null;
  const width = Math.max(1, bbox.width);
  const height = Math.max(1, bbox.height);
  const normalized: PathPoint[] = points.map((point) => ({
    x: clamp(bbox.width > 1e-9 ? (point.x - bbox.x) / bbox.width : 0, 0, 1),
    y: clamp(bbox.height > 1e-9 ? (point.y - bbox.y) / bbox.height : 0, 0, 1),
  }));
  const decomposed = decomposeMatrix(matrix);
  const scale = uniformScale(decomposed);
  const node = createPathNode(normalized, bbox.x, bbox.y, width, height, closed);
  node.name = tag === 'line' ? 'Line' : tag === 'polyline' ? 'Polyline' : tag === 'polygon' ? 'Polygon' : 'Path';
  applyCommon(node, element, context, groupId, scale);
  // Keep Mermaid-style edges: markers become triangle heads on the path node.
  node.headStart = hasMarker(element, 'marker-start');
  node.headEnd = hasMarker(element, 'marker-end');
  node.headSize = Math.max(6, node.strokeWidth * 4);
  return node;
}

function convertElement(
  element: Element,
  context: ConvertContext,
  groupId: string | null,
  rootMatrix: Matrix,
): FigureNode | null {
  const tag = element.tagName.toLowerCase();
  if (isVisibilityHidden(element)) return null;
  if (effectiveOpacity(element) <= 0.001) return null;
  const matrix = elementMatrix(element, context.root, rootMatrix);
  switch (tag) {
    case 'rect':
      return convertRect(element, context, groupId, matrix);
    case 'circle':
    case 'ellipse':
      return convertEllipse(element, context, groupId, matrix);
    case 'line':
    case 'polyline':
    case 'polygon':
    case 'path':
      return convertPath(element, context, groupId, matrix);
    case 'text':
      return convertText(element, context, groupId, matrix);
    case 'image':
      return convertImage(element, context, groupId, matrix);
    default:
      return null;
  }
}

function walk(
  element: Element,
  context: ConvertContext,
  rootMatrix: Matrix,
  groupId: string | null,
  nodes: FigureNode[],
  groups: FigureGroup[],
): void {
  const tag = element.tagName.toLowerCase();

  if (IGNORED.has(tag)) return;
  if (tag !== 'svg' && tag !== 'g' && tag !== 'a') {
    if (UNSUPPORTED.has(tag)) {
      warnOnce(context, `tag:${tag}`, `Skipped unsupported <${tag}> element.`);
      return;
    }
    if (DRAWABLE.has(tag)) {
      if (isDisplayNone(element)) return;
      const node = convertElement(element, context, groupId, rootMatrix);
      if (node) nodes.push(node);
      // Text children are consumed by convertText.
      return;
    }
    // Unknown wrapper (for example <switch>); recurse to keep its drawables.
  }

  if (isDisplayNone(element)) return;

  let nextGroup = groupId;
  if (tag === 'g' || tag === 'a') {
    const nodeGroup = isNodeGroup(element);
    const clusterGroup = isClusterGroup(element);
    const generic = !nodeGroup && !clusterGroup;
    // Generic identity groups are only created at the top of a branch so a
    // Mermaid label wrapper never steals a node's shape from its group.
    const allowed = !generic || groupId === null;
    if (allowed && (nodeGroup || clusterGroup || groupIdentity(element))) {
      const id = createFigureId('group');
      groups.push({
        id,
        name: groupName(element),
        hidden: false,
        locked: false,
      });
      nextGroup = id;
    }
  }

  for (const child of Array.from(element.children)) {
    walk(child, context, rootMatrix, nextGroup, nodes, groups);
  }
}

// -------------------------------------------------------------- entry points

function sanitizeClone(root: SVGSVGElement, warnings: string[]): SVGSVGElement {
  const foreignObjects = root.querySelectorAll('foreignObject');
  if (foreignObjects.length) {
    warnings.push(
      `Skipped ${foreignObjects.length} <foreignObject> element${foreignObjects.length === 1 ? '' : 's'}.`,
    );
  }
  root.querySelectorAll('script, foreignObject').forEach((element) => element.remove());

  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of all) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      } else if (
        (name === 'href' || name === 'xlink:href') &&
        /^\s*javascript:/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return root;
}

function requireDocument(): Document {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    throw new Error('SVG import requires a browser environment.');
  }
  return document;
}

/**
 * Parse SVG markup and convert supported drawables into Figure Studio nodes.
 * The returned nodes are normalised to a local (0, 0) origin; the result also
 * carries the local width/height so placeVectorImport() can fit them to a page.
 */
export async function importSvgMarkup(svgText: string): Promise<VectorImportResult> {
  const doc = requireDocument();
  if (typeof svgText !== 'string' || !svgText.trim()) {
    throw new Error('SVG markup is empty.');
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgText, 'image/svg+xml');
  const parserError = parsed.querySelector('parsererror');
  if (parserError) {
    throw new Error('Could not parse the SVG markup. Check that the file is valid SVG XML.');
  }
  const sourceRoot = parsed.documentElement;
  if (!sourceRoot || sourceRoot.tagName.toLowerCase() !== 'svg') {
    throw new Error('The selected file is not an SVG document.');
  }

  const sourceSvg = sourceRoot as unknown as SVGSVGElement;
  const viewBox = parseViewBox(sourceSvg.getAttribute('viewBox'));
  const viewportWidth = viewBox?.width ?? parseLength(sourceSvg.getAttribute('width')) ?? 800;
  const viewportHeight = viewBox?.height ?? parseLength(sourceSvg.getAttribute('height')) ?? 600;
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) {
    throw new Error('The SVG has no usable width or height.');
  }

  const warnings: string[] = [];
  const root = sanitizeClone(doc.importNode(sourceRoot, true) as unknown as SVGSVGElement, warnings);
  // Use viewBox user units as the import coordinate space; a root width/height
  // different from the viewBox would only add a uniform scale we normalise away.
  root.setAttribute('width', String(viewportWidth));
  root.setAttribute('height', String(viewportHeight));
  root.style.width = `${viewportWidth}px`;
  root.style.height = `${viewportHeight}px`;

  const host = doc.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = `${viewportWidth}px`;
  host.style.height = `${viewportHeight}px`;
  host.style.overflow = 'hidden';
  host.style.pointerEvents = 'none';

  try {
    doc.body.appendChild(host);
    host.appendChild(root);

    const rootMatrix = viewBox ? translate(-viewBox.x, -viewBox.y) : IDENTITY;
    const context: ConvertContext = { root, warnings, warned: new Set() };
    const nodes: FigureNode[] = [];
    const groups: FigureGroup[] = [];

    for (const child of Array.from(root.children)) {
      walk(child, context, rootMatrix, null, nodes, groups);
    }

    if (!nodes.length) {
      throw new Error('No supported vector elements were found in this SVG.');
    }

    // Normalise to a local origin and derive the bounding box of the import.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const bounds = nodeBounds(node);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.w);
      maxY = Math.max(maxY, bounds.y + bounds.h);
    }
    for (const node of nodes) {
      node.x -= minX;
      node.y -= minY;
    }

    // Drop empty groups so the layer panel never shows invisible containers.
    const usedGroups = new Set(nodes.map((node) => node.groupId).filter((id): id is string => !!id));
    const keptGroups = groups.filter((group) => usedGroups.has(group.id));
    const keptIds = new Set(keptGroups.map((group) => group.id));
    for (const node of nodes) {
      if (node.groupId && !keptIds.has(node.groupId)) delete node.groupId;
    }

    return {
      nodes,
      groups: keptGroups,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      warnings,
    };
  } finally {
    host.remove();
  }
}

/**
 * Fit an imported vector onto a page.
 *
 * The importer emits CSS-pixel geometry (96 dpi). A uniform scale `s` is
 * applied to position, size, stroke width, corner radius, arrow/head size and
 * text font size in points, so the diagram keeps its visual proportions when
 * it is enlarged or reduced to the page. Group ids are carried through; the
 * caller owns id de-duplication when inserting into an existing document.
 */
export function placeVectorImport(
  result: VectorImportResult,
  pageWidth: number,
  pageHeight: number,
  marginRatio = 0.08,
): { nodes: FigureNode[]; groups: FigureGroup[] } {
  const margin = clamp(marginRatio, 0, 0.45);
  const innerWidth = Math.max(1, pageWidth * (1 - margin * 2));
  const innerHeight = Math.max(1, pageHeight * (1 - margin * 2));
  const sourceWidth = Math.max(1, result.width);
  const sourceHeight = Math.max(1, result.height);
  const scale = Math.min(innerWidth / sourceWidth, innerHeight / sourceHeight);
  const offsetX = (pageWidth - sourceWidth * scale) / 2;
  const offsetY = (pageHeight - sourceHeight * scale) / 2;

  const nodes = result.nodes.map((node) => {
    const copy = { ...node } as FigureNode;
    copy.x = offsetX + copy.x * scale;
    copy.y = offsetY + copy.y * scale;
    copy.w = copy.w * scale;
    copy.h = copy.h * scale;
    copy.strokeWidth = copy.strokeWidth * scale;
    copy.cornerRadius = copy.cornerRadius * scale;
    if (copy.type === 'text') {
      copy.fontSize = copy.fontSize * scale;
      copy.padding = copy.padding * scale;
    }
    if (copy.type === 'path' || copy.type === 'line' || copy.type === 'arrow') {
      copy.headSize = copy.headSize * scale;
    }
    if (copy.type === 'scalebar') {
      copy.thickness = copy.thickness * scale;
      copy.fontSize = copy.fontSize * scale;
    }
    if (copy.type === 'chart') {
      copy.fontSize = copy.fontSize * scale;
    }
    return copy;
  });

  return {
    nodes,
    groups: result.groups.map((group) => ({ ...group })),
  };
}
