// Pure geometry helpers for the Figure Studio editor.
//
// Nodes store an unrotated top-left rectangle plus a rotation around their
// centre. Selection handles are kept axis-aligned around the rotated bounds so
// that resizing stays predictable, while hit testing against the node itself
// inverse-rotates the pointer. No DOM, no Svelte: every function is pure and
// reusable from the canvas, keyboard nudge code and exporters.
import { nodeBounds, type FigureNode } from './types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

/** Distance in figure pixels from the top edge to the rotate handle. */
export const ROTATE_HANDLE_OFFSET = 24;

/** Minimum node size used by resize operations. */
const MIN_SIZE = 2;

// Re-exported so callers only need this module for selection work.
export { nodeBounds };

const DEG_TO_RAD = Math.PI / 180;

function rotatePoint(point: Point, centre: Point, degrees: number): Point {
  if (!degrees) return point;
  const rad = degrees * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };
}

/** Union of the rotated bounds of all nodes, or null for an empty list. */
export function nodesBounds(nodes: readonly FigureNode[]): Rect | null {
  if (nodes.length === 0) return null;
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
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** True when the point lies inside the node, taking rotation into account. */
export function hitTestNode(node: FigureNode, px: number, py: number): boolean {
  let point = { x: px, y: py };
  if (node.rotation) {
    const centre = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
    point = rotatePoint(point, centre, -node.rotation);
  }
  return (
    point.x >= node.x &&
    point.x <= node.x + node.w &&
    point.y >= node.y &&
    point.y <= node.y + node.h
  );
}

/**
 * Handle positions around an axis-aligned rect. When `rotation` is supplied
 * each position is rotated around the rect centre, matching the rendered node.
 */
export function handlePoints(bounds: Rect, rotation = 0): Record<Handle, Point> {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const points: Record<Handle, Point> = {
    nw: { x: bounds.x, y: bounds.y },
    n: { x: cx, y: bounds.y },
    ne: { x: bounds.x + bounds.w, y: bounds.y },
    e: { x: bounds.x + bounds.w, y: cy },
    se: { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    s: { x: cx, y: bounds.y + bounds.h },
    sw: { x: bounds.x, y: bounds.y + bounds.h },
    w: { x: bounds.x, y: cy },
    rotate: { x: cx, y: bounds.y - ROTATE_HANDLE_OFFSET },
  };
  if (!rotation) return points;
  const centre = { x: cx, y: cy };
  const out = {} as Record<Handle, Point>;
  for (const key of Object.keys(points) as Handle[]) {
    out[key] = rotatePoint(points[key], centre, rotation);
  }
  return out;
}

/**
 * Nearest handle within `radius` pixels, or null. Handles are tested against
 * the node's axis-aligned rotated bounds; rotation is ignored for hit comfort.
 */
export function hitTestHandle(
  node: FigureNode,
  px: number,
  py: number,
  radius = 7,
): Handle | null {
  const bounds = nodeBounds(node);
  const points = handlePoints(bounds);
  const limit = Math.max(0, radius);
  let best: { handle: Handle; distance: number } | null = null;
  for (const key of Object.keys(points) as Handle[]) {
    const point = points[key];
    const distance = Math.hypot(point.x - px, point.y - py);
    if (distance <= limit && (!best || distance < best.distance)) {
      best = { handle: key, distance };
    }
  }
  return best?.handle ?? null;
}

/**
 * Resize a rect by dragging a handle. The opposite edge/corner stays anchored,
 * dimensions never fall below 2 px and `keepAspect` preserves the start ratio.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  keepAspect = false,
): Rect {
  if (handle === 'rotate') return { ...start };
  const moveX = Number.isFinite(dx) ? dx : 0;
  const moveY = Number.isFinite(dy) ? dy : 0;

  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (west) left += moveX;
  if (east) right += moveX;
  if (north) top += moveY;
  if (south) bottom += moveY;

  let w = Math.max(MIN_SIZE, right - left);
  let h = Math.max(MIN_SIZE, bottom - top);

  if (keepAspect && start.w > 0 && start.h > 0) {
    const aspect = start.w / start.h;
    if (handle.length === 2) {
      // Corner: follow whichever axis moved further in relative terms.
      const relW = Math.abs(w / start.w - 1);
      const relH = Math.abs(h / start.h - 1);
      if (relW >= relH) h = w / aspect;
      else w = h * aspect;
    } else if (east || west) {
      h = w / aspect;
    } else {
      w = h * aspect;
    }
    w = Math.max(MIN_SIZE, w);
    h = Math.max(MIN_SIZE, h);
  }

  // Re-anchor on the side that did not move.
  if (west) left = right - w;
  else right = left + w;
  if (north) top = bottom - h;
  else bottom = top + h;

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Snap a scalar to a grid step. Non-positive or non-finite steps are ignored. */
export function snapScalar(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function snapPoint(x: number, y: number, step: number): Point {
  return { x: snapScalar(x, step), y: snapScalar(y, step) };
}

/**
 * Snap each edge of a rect to the grid only when it is within `thresholdPx`.
 * Edges are handled independently, so a rect can snap on one axis only.
 */
export function snapNodeRect(rect: Rect, step: number, thresholdPx: number): Rect {
  if (!Number.isFinite(step) || step <= 0) return { ...rect };
  const threshold = Math.max(0, Number.isFinite(thresholdPx) ? thresholdPx : 0);
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const snappedX = snapScalar(rect.x, step);
  const snappedY = snapScalar(rect.y, step);
  const snappedRight = snapScalar(right, step);
  const snappedBottom = snapScalar(bottom, step);
  const x = Math.abs(snappedX - rect.x) <= threshold ? snappedX : rect.x;
  const y = Math.abs(snappedY - rect.y) <= threshold ? snappedY : rect.y;
  const r = Math.abs(snappedRight - right) <= threshold ? snappedRight : right;
  const b = Math.abs(snappedBottom - bottom) <= threshold ? snappedBottom : bottom;
  return { x, y, w: Math.max(MIN_SIZE, r - x), h: Math.max(MIN_SIZE, b - y) };
}

export type AlignmentKind = 'start' | 'center' | 'end';

/** A smart alignment line spanning the moving and matched rects. */
export interface AlignmentGuide {
  axis: 'x' | 'y';
  /** Document coordinate of the vertical (`x`) or horizontal (`y`) line. */
  position: number;
  /** Line extent along the perpendicular axis, in document coordinates. */
  from: number;
  to: number;
  /** Which edge of the moving rect produced the match. */
  kind: AlignmentKind;
}

/** Tolerance used to decide whether two edges are aligned after snapping. */
const ALIGN_EPSILON = 0.01;

const ALIGN_KINDS: readonly AlignmentKind[] = ['start', 'center', 'end'];

type EdgeMap = Record<AlignmentKind, number>;

function edgesOf(rect: Rect, axis: 'x' | 'y'): EdgeMap {
  const start = axis === 'x' ? rect.x : rect.y;
  const span = axis === 'x' ? rect.w : rect.h;
  return { start, center: start + span / 2, end: start + span };
}

/**
 * Smallest signed translation that aligns one of the moving edges with one of
 * the other rects' edges on `axis`. Returns 0 when nothing is in range.
 */
function nearestTranslation(
  moving: EdgeMap,
  others: readonly Rect[],
  axis: 'x' | 'y',
  threshold: number,
): number {
  let best = 0;
  let found = false;
  for (const other of others) {
    const edges = edgesOf(other, axis);
    for (const from of ALIGN_KINDS) {
      for (const to of ALIGN_KINDS) {
        const delta = edges[to] - moving[from];
        if (Math.abs(delta) <= threshold && (!found || Math.abs(delta) < Math.abs(best))) {
          best = delta;
          found = true;
        }
      }
    }
  }
  return found ? best : 0;
}

/** Guides for every edge pair that is aligned in the already-snapped rect. */
function collectGuides(
  rect: Rect,
  others: readonly Rect[],
  axis: 'x' | 'y',
): AlignmentGuide[] {
  const moving = edgesOf(rect, axis);
  const guides: AlignmentGuide[] = [];
  for (const other of others) {
    const edges = edgesOf(other, axis);
    for (const from of ALIGN_KINDS) {
      for (const to of ALIGN_KINDS) {
        if (Math.abs(moving[from] - edges[to]) > ALIGN_EPSILON) continue;
        guides.push(
          axis === 'x'
            ? {
                axis,
                position: edges[to],
                from: Math.min(rect.y, other.y),
                to: Math.max(rect.y + rect.h, other.y + other.h),
                kind: from,
              }
            : {
                axis,
                position: edges[to],
                from: Math.min(rect.x, other.x),
                to: Math.max(rect.x + rect.w, other.x + other.w),
                kind: from,
              },
        );
      }
    }
  }
  return guides;
}

/** Merge guides that share an axis and position, keeping the wider extent. */
function mergeGuides(guides: readonly AlignmentGuide[]): AlignmentGuide[] {
  const merged: AlignmentGuide[] = [];
  for (const guide of guides) {
    const existing = merged.find(
      (candidate) =>
        candidate.axis === guide.axis &&
        Math.abs(candidate.position - guide.position) <= ALIGN_EPSILON,
    );
    if (existing) {
      existing.from = Math.min(existing.from, guide.from);
      existing.to = Math.max(existing.to, guide.to);
    } else {
      merged.push({ ...guide });
    }
  }
  merged.sort((a, b) => {
    if (a.axis !== b.axis) return a.axis === 'x' ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return ALIGN_KINDS.indexOf(a.kind) - ALIGN_KINDS.indexOf(b.kind);
  });
  return merged;
}

/**
 * Snap a rect's start/centre/end to the nearest edge of any other rect on each
 * axis, then report the guides that remain aligned. Width and height never
 * change; each axis moves independently. The caller must pass `others` without
 * the moving node(s), though an identical reference is ignored defensively.
 */
export function alignmentGuides(
  moving: Rect,
  others: readonly Rect[],
  threshold: number,
): { rect: Rect; guides: AlignmentGuide[] } {
  const limit = Number.isFinite(threshold) ? Math.max(0, threshold) : 0;
  const rect: Rect = { x: moving.x, y: moving.y, w: moving.w, h: moving.h };
  const targets = others.filter((other) => other !== moving);

  const xDelta = nearestTranslation(edgesOf(rect, 'x'), targets, 'x', limit);
  if (xDelta !== 0) rect.x += xDelta;
  const yDelta = nearestTranslation(edgesOf(rect, 'y'), targets, 'y', limit);
  if (yDelta !== 0) rect.y += yDelta;

  const guides = mergeGuides([
    ...collectGuides(rect, targets, 'x'),
    ...collectGuides(rect, targets, 'y'),
  ]);
  return { rect, guides };
}

/** Keep the rect inside the page; oversized rects are shrunk to the page. */
export function clampToPage(rect: Rect, pageW: number, pageH: number): Rect {
  const width = Math.max(1, Number.isFinite(pageW) ? pageW : 1);
  const height = Math.max(1, Number.isFinite(pageH) ? pageH : 1);
  const w = Math.min(Math.max(1, rect.w), width);
  const h = Math.min(Math.max(1, rect.h), height);
  const x = Math.min(Math.max(0, rect.x), width - w);
  const y = Math.min(Math.max(0, rect.y), height - h);
  return { x, y, w, h };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Align rects against the union bounds of the group. Returns only the new
 * top-left positions, keyed by item id.
 */
export function alignRects(
  items: readonly { id: string; rect: Rect }[],
  mode: AlignMode,
): Record<string, Point> {
  const out: Record<string, Point> = {};
  if (items.length === 0) return out;
  const minX = Math.min(...items.map((item) => item.rect.x));
  const minY = Math.min(...items.map((item) => item.rect.y));
  const maxX = Math.max(...items.map((item) => item.rect.x + item.rect.w));
  const maxY = Math.max(...items.map((item) => item.rect.y + item.rect.h));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  for (const { id, rect } of items) {
    switch (mode) {
      case 'left':
        out[id] = { x: minX, y: rect.y };
        break;
      case 'hcenter':
        out[id] = { x: centerX - rect.w / 2, y: rect.y };
        break;
      case 'right':
        out[id] = { x: maxX - rect.w, y: rect.y };
        break;
      case 'top':
        out[id] = { x: rect.x, y: minY };
        break;
      case 'vcenter':
        out[id] = { x: rect.x, y: centerY - rect.h / 2 };
        break;
      case 'bottom':
        out[id] = { x: rect.x, y: maxY - rect.h };
        break;
    }
  }
  return out;
}

/**
 * Distribute items so the gaps between them are equal. The first and last
 * items keep their positions; at least three items are required.
 */
export function distributeRects(
  items: readonly { id: string; rect: Rect }[],
  axis: 'x' | 'y',
): Record<string, Point> {
  const out: Record<string, Point> = {};
  if (items.length < 3) return out;
  const size = (rect: Rect) => (axis === 'x' ? rect.w : rect.h);
  const pos = (rect: Rect) => (axis === 'x' ? rect.x : rect.y);
  const sorted = [...items].sort((a, b) => pos(a.rect) - pos(b.rect));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = pos(last.rect) + size(last.rect) - pos(first.rect);
  const total = sorted.reduce((sum, item) => sum + size(item.rect), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = pos(first.rect);
  for (const { id, rect } of sorted) {
    out[id] = axis === 'x' ? { x: cursor, y: rect.y } : { x: rect.x, y: cursor };
    cursor += size(rect) + gap;
  }
  return out;
}

/** Expand ids so any selected node brings its whole group along. */
function expandIds(nodes: readonly FigureNode[], ids: readonly string[]): Set<string> {
  const selected = new Set(ids);
  const groups = new Set<string>();
  for (const node of nodes) {
    if (selected.has(node.id) && node.groupId) groups.add(node.groupId);
  }
  for (const node of nodes) {
    if (node.groupId && groups.has(node.groupId)) selected.add(node.id);
  }
  return selected;
}

/**
 * Translate the selected nodes. Group membership expands the selection, while
 * locked and hidden nodes are left untouched.
 */
export function moveNodes(
  nodes: readonly FigureNode[],
  ids: readonly string[],
  dx: number,
  dy: number,
): FigureNode[] {
  const mx = Number.isFinite(dx) ? dx : 0;
  const my = Number.isFinite(dy) ? dy : 0;
  if (mx === 0 && my === 0) return [...nodes];
  const selected = expandIds(nodes, ids);
  return nodes.map((node) => {
    if (!selected.has(node.id) || node.locked || node.hidden) return node;
    return { ...node, x: node.x + mx, y: node.y + my };
  });
}

/** Assign `groupId` to every node whose id is listed. */
export function groupSelection(
  nodes: readonly FigureNode[],
  ids: readonly string[],
  groupId: string,
): FigureNode[] {
  const selected = new Set(ids);
  return nodes.map((node) =>
    selected.has(node.id) ? { ...node, groupId } : node,
  );
}

/** Remove a group from every member node. */
export function ungroupSelection(
  nodes: readonly FigureNode[],
  groupId: string,
): FigureNode[] {
  return nodes.map((node) => {
    if (node.groupId !== groupId) return node;
    const { groupId: _removed, ...rest } = node;
    return rest as FigureNode;
  });
}

/**
 * Centred scale that fits the page into the viewport with padding. The result
 * is clamped to 0.05..8 so extreme pages stay navigable.
 */
export function zoomToFit(
  pageW: number,
  pageH: number,
  viewportW: number,
  viewportH: number,
  padding = 32,
): { scale: number; offsetX: number; offsetY: number } {
  const width = Number.isFinite(pageW) && pageW > 0 ? pageW : 1;
  const height = Number.isFinite(pageH) && pageH > 0 ? pageH : 1;
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1;
  const vh = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 1;
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const availableW = Math.max(1, vw - pad * 2);
  const availableH = Math.max(1, vh - pad * 2);
  const raw = Math.min(availableW / width, availableH / height);
  const scale = Math.min(8, Math.max(0.05, raw));
  return {
    scale,
    offsetX: (vw - width * scale) / 2,
    offsetY: (vh - height * scale) / 2,
  };
}

/**
 * Placement of an image inside its frame. `contain` and `cover` preserve the
 * intrinsic aspect; `stretch` (and invalid sizes) fill the frame.
 */
export function imageNaturalRect(
  outerW: number,
  outerH: number,
  imageW: number,
  imageH: number,
  fit: 'contain' | 'cover' | 'stretch',
): Rect {
  const ow = Number.isFinite(outerW) && outerW > 0 ? outerW : 0;
  const oh = Number.isFinite(outerH) && outerH > 0 ? outerH : 0;
  if (fit === 'stretch' || !Number.isFinite(imageW) || !Number.isFinite(imageH) || imageW <= 0 || imageH <= 0) {
    return { x: 0, y: 0, w: ow, h: oh };
  }
  const sx = ow / imageW;
  const sy = oh / imageH;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: (ow - w) / 2, y: (oh - h) / 2, w, h };
}
