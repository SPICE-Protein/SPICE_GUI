// Scale-bar node renderer. A scale bar is a labelled graphic: the physical
// meaning comes from the label the user types, while the bar length follows the
// node width so it can be dragged and rotated like any other object.
import { PT_TO_PX, type ScaleBarNode } from './types';

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

export function renderScaleBarNode(node: ScaleBarNode): string {
  const color = isNone(node.stroke) ? '#111827' : node.stroke;
  const textColor = isNone(node.textColor) ? color : node.textColor;
  const thickness = Math.max(0.5, node.thickness);
  const inset = Math.min(node.w * 0.12, 14);
  const x1 = node.x + inset;
  const x2 = node.x + node.w - inset;
  const y = node.y + node.h - Math.max(thickness, node.fontSize * 0.6);
  const fontPx = Math.max(5, node.fontSize * PT_TO_PX);
  const tick = Math.max(thickness * 2.2, 8);
  const out: string[] = [
    `<line x1="${num(x1)}" y1="${num(y)}" x2="${num(x2)}" y2="${num(y)}" stroke="${esc(color)}" stroke-width="${num(thickness)}" stroke-linecap="square"/>`,
  ];
  if (node.ticks) {
    out.push(
      `<line x1="${num(x1)}" y1="${num(y - tick / 2)}" x2="${num(x1)}" y2="${num(y + tick / 2)}" stroke="${esc(color)}" stroke-width="${num(thickness)}"/>`,
      `<line x1="${num(x2)}" y1="${num(y - tick / 2)}" x2="${num(x2)}" y2="${num(y + tick / 2)}" stroke="${esc(color)}" stroke-width="${num(thickness)}"/>`,
    );
  }
  if (node.label.trim()) {
    out.push(
      `<text x="${num((x1 + x2) / 2)}" y="${num(node.y + fontPx * 1.1)}" font-family="${esc(node.fontFamily)}" font-size="${num(fontPx)}" fill="${esc(textColor)}" text-anchor="middle" dominant-baseline="middle">${esc(node.label)}</text>`,
    );
  }
  return out.join('');
}
