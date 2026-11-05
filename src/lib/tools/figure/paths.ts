// Polyline/path node renderer. Points are normalised inside the node bounds so
// moving, resizing and rotating the node transforms the path with it.
import type { PathNode } from './types';

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 10000) / 10000);
}

function esc(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isNone(value: string | undefined): boolean {
  const text = (value ?? '').trim().toLowerCase();
  return !text || text === 'none' || text === 'transparent';
}

function dashArray(node: PathNode): string | undefined {
  if (node.dash === 'dashed') {
    return `${num(Math.max(3, node.strokeWidth * 3))} ${num(Math.max(2, node.strokeWidth * 2))}`;
  }
  if (node.dash === 'dotted') {
    return `${num(Math.max(0.75, node.strokeWidth))} ${num(Math.max(1.5, node.strokeWidth * 2))}`;
  }
  return undefined;
}

export function pathNodePoints(node: PathNode): Array<{ x: number; y: number }> {
  const points = node.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: node.x + Math.max(0, Math.min(1, point.x)) * node.w,
      y: node.y + Math.max(0, Math.min(1, point.y)) * node.h,
    }));
  return points.length >= 2 ? points : [
    { x: node.x, y: node.y },
    { x: node.x + node.w, y: node.y + node.h },
  ];
}

function headPoints(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  size: number,
): string {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = 0.45;
  const ax = tipX - size * Math.cos(angle - spread);
  const ay = tipY - size * Math.sin(angle - spread);
  const bx = tipX - size * Math.cos(angle + spread);
  const by = tipY - size * Math.sin(angle + spread);
  return `${num(tipX)},${num(tipY)} ${num(ax)},${num(ay)} ${num(bx)},${num(by)}`;
}

function meaningfulNeighbour(
  points: Array<{ x: number; y: number }>,
  start: number,
  step: number,
): { x: number; y: number } | null {
  const tip = points[start];
  for (let index = start + step; index >= 0 && index < points.length; index += step) {
    const point = points[index];
    if (Math.hypot(point.x - tip.x, point.y - tip.y) > 0.01) return point;
  }
  return null;
}

export function renderPathNode(node: PathNode): string {
  const points = pathNodePoints(node);
  const list = points.map((point) => `${num(point.x)},${num(point.y)}`).join(' ');
  const out: string[] = [];
  if (node.closed) {
    out.push(
      `<polygon points="${list}" fill="${isNone(node.fill) ? 'none' : esc(node.fill)}" stroke="${isNone(node.stroke) ? 'none' : esc(node.stroke)}" stroke-width="${num(node.strokeWidth)}" stroke-linejoin="round"${dashArray(node) ? ` stroke-dasharray="${dashArray(node)}"` : ''}/>`,
    );
  } else {
    out.push(
      `<polyline points="${list}" fill="${isNone(node.fill) ? 'none' : esc(node.fill)}" stroke="${isNone(node.stroke) ? 'none' : esc(node.stroke)}" stroke-width="${num(node.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${dashArray(node) ? ` stroke-dasharray="${dashArray(node)}"` : ''}/>`,
    );
  }
  if (node.headSize > 0 && !isNone(node.stroke)) {
    const color = esc(node.stroke);
    if (node.headStart) {
      const tip = points[0];
      const from = meaningfulNeighbour(points, 0, 1);
      if (from) {
        out.push(`<polygon points="${headPoints(tip.x, tip.y, from.x, from.y, node.headSize)}" fill="${color}"/>`);
      }
    }
    if (node.headEnd) {
      const tip = points[points.length - 1];
      const from = meaningfulNeighbour(points, points.length - 1, -1);
      if (from) {
        out.push(`<polygon points="${headPoints(tip.x, tip.y, from.x, from.y, node.headSize)}" fill="${color}"/>`);
      }
    }
  }
  return out.join('');
}
