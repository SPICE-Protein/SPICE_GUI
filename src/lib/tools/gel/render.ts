// Raster and vector rendering of a FigureLayout.
import type { FigureItem, FigureLayout, TextStyle } from './figure';
import type { GelProject } from './types';

function withText(ctx: CanvasRenderingContext2D, style: TextStyle) {
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px ${style.family}`;
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = style.baseline ?? 'alphabetic';
}

export function drawFigure(
  ctx: CanvasRenderingContext2D,
  layout: FigureLayout,
  processed: HTMLCanvasElement,
  scale = 1,
) {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.width, layout.height);
  const { crop } = layout;
  const visW = 1 - crop.left - crop.right;
  const visH = 1 - crop.top - crop.bottom;

  for (const item of layout.items) {
    switch (item.kind) {
      case 'image': {
        if (item.source === 'gel') {
          ctx.drawImage(
            processed,
            crop.left * processed.width,
            crop.top * processed.height,
            visW * processed.width,
            visH * processed.height,
            item.x,
            item.y,
            item.w,
            item.h,
          );
        } else {
          ctx.drawImage(
            processed,
            item.box.x * processed.width,
            item.box.y * processed.height,
            item.box.w * processed.width,
            item.box.h * processed.height,
            item.x,
            item.y,
            item.w,
            item.h,
          );
        }
        break;
      }
      case 'text': {
        withText(ctx, item.style);
        const angle = item.style.angle ?? 0;
        ctx.save();
        ctx.translate(item.x, item.y);
        if (angle) ctx.rotate((angle * Math.PI) / 180);
        if (item.halo) {
          const w = ctx.measureText(item.text).width;
          const ax = item.style.align === 'center' ? -w / 2 : item.style.align === 'right' ? -w : 0;
          const top = item.style.baseline === 'middle' ? -item.style.size * 0.65 : -item.style.size * 0.95;
          ctx.fillStyle = 'rgba(255,255,255,0.82)';
          ctx.fillRect(ax - 1, top, w + 2, item.style.size * 1.35);
          ctx.fillStyle = item.style.color;
        }
        ctx.fillText(item.text, 0, 0);
        ctx.restore();
        break;
      }
      case 'line': {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.width;
        ctx.setLineDash(item.dash ?? []);
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'rect': {
        if (item.fill) {
          ctx.fillStyle = item.fill;
          ctx.fillRect(item.x, item.y, item.w, item.h);
        }
        if (item.width > 0) {
          ctx.strokeStyle = item.color;
          ctx.lineWidth = item.width;
          ctx.strokeRect(item.x, item.y, item.w, item.h);
        }
        break;
      }
      case 'arrow': {
        ctx.strokeStyle = item.color;
        ctx.fillStyle = item.color;
        ctx.lineWidth = item.width;
        ctx.beginPath();
        ctx.moveTo(item.x1, item.y1);
        ctx.lineTo(item.x2, item.y2);
        ctx.stroke();
        const ang = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
        ctx.beginPath();
        ctx.moveTo(item.x2, item.y2);
        ctx.lineTo(item.x2 - item.head * Math.cos(ang - 0.42), item.y2 - item.head * Math.sin(ang - 0.42));
        ctx.lineTo(item.x2 - item.head * Math.cos(ang + 0.42), item.y2 - item.head * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }
  ctx.restore();
}

/** Render the figure at a target dots-per-inch. */
export function rasterizeFigure(
  layout: FigureLayout,
  processed: HTMLCanvasElement,
  dpi: number,
): HTMLCanvasElement {
  const scale = Math.max(1, dpi / 96);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.width * scale);
  canvas.height = Math.round(layout.height * scale);
  const ctx = canvas.getContext('2d')!;
  drawFigure(ctx, layout, processed, scale);
  return canvas;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** SVG keeps text and lines editable; the gel is embedded once and cropped
 *  with a nested viewBox. */
export function figureToSvg(
  layout: FigureLayout,
  imageHref: string,
  imageWidth: number,
  imageHeight: number,
): string {
  const { crop } = layout;
  const visW = 1 - crop.left - crop.right;
  const visH = 1 - crop.top - crop.bottom;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
  );
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  for (const item of layout.items) {
    switch (item.kind) {
      case 'image': {
        const vb =
          item.source === 'gel'
            ? { x: crop.left * imageWidth, y: crop.top * imageHeight, w: visW * imageWidth, h: visH * imageHeight }
            : {
                x: item.box.x * imageWidth,
                y: item.box.y * imageHeight,
                w: item.box.w * imageWidth,
                h: item.box.h * imageHeight,
              };
        out.push(
          `<svg x="${item.x.toFixed(2)}" y="${item.y.toFixed(2)}" width="${item.w.toFixed(2)}" height="${item.h.toFixed(2)}" viewBox="${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.h.toFixed(2)}" preserveAspectRatio="none"><image href="${imageHref}" width="${imageWidth}" height="${imageHeight}"/></svg>`,
        );
        break;
      }
      case 'text': {
        const s = item.style;
        const anchor = s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start';
        const dominant = s.baseline === 'middle' ? 'central' : s.baseline === 'top' ? 'text-before-edge' : 'auto';
        const transform = s.angle ? ` transform="rotate(${s.angle} ${item.x} ${item.y})"` : '';
        if (item.halo) {
          const approx = Math.max(4, item.text.length * s.size * 0.58);
          const x = s.align === 'center' ? item.x - approx / 2 : s.align === 'right' ? item.x - approx : item.x;
          const y = s.baseline === 'middle' ? item.y - s.size * 0.65 : item.y - s.size;
          out.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${approx.toFixed(2)}" height="${(s.size * 1.35).toFixed(2)}" fill="#ffffff" opacity="0.82"${transform}/>`);
        }
        out.push(
          `<text x="${item.x.toFixed(2)}" y="${item.y.toFixed(2)}" font-family="${esc(s.family)}" font-size="${s.size}" font-weight="${s.bold ? 'bold' : 'normal'}" font-style="${s.italic ? 'italic' : 'normal'}" fill="${s.color}" text-anchor="${anchor}" dominant-baseline="${dominant}"${transform}>${esc(item.text)}</text>`,
        );
        break;
      }
      case 'line':
        out.push(
          `<line x1="${item.x1.toFixed(2)}" y1="${item.y1.toFixed(2)}" x2="${item.x2.toFixed(2)}" y2="${item.y2.toFixed(2)}" stroke="${item.color}" stroke-width="${item.width}"${item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : ''}/>`,
        );
        break;
      case 'rect':
        out.push(
          `<rect x="${item.x.toFixed(2)}" y="${item.y.toFixed(2)}" width="${item.w.toFixed(2)}" height="${item.h.toFixed(2)}" fill="${item.fill ?? 'none'}" stroke="${item.color}" stroke-width="${item.width}"/>`,
        );
        break;
      case 'arrow': {
        out.push(
          `<line x1="${item.x1.toFixed(2)}" y1="${item.y1.toFixed(2)}" x2="${item.x2.toFixed(2)}" y2="${item.y2.toFixed(2)}" stroke="${item.color}" stroke-width="${item.width}"/>`,
        );
        const ang = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
        const p1 = `${(item.x2 - item.head * Math.cos(ang - 0.42)).toFixed(2)},${(item.y2 - item.head * Math.sin(ang - 0.42)).toFixed(2)}`;
        const p2 = `${(item.x2 - item.head * Math.cos(ang + 0.42)).toFixed(2)},${(item.y2 - item.head * Math.sin(ang + 0.42)).toFixed(2)}`;
        out.push(
          `<polygon points="${item.x2.toFixed(2)},${item.y2.toFixed(2)} ${p1} ${p2}" fill="${item.color}"/>`,
        );
        break;
      }
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

/** Full processed image with the crop frame, well numbers and splice marks. */
export function renderUncropped(project: GelProject, processed: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(processed.width * scale);
  canvas.height = Math.round(processed.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(processed, 0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  const w = processed.width;
  const h = processed.height;
  const { left, top, right, bottom } = project.crop;
  ctx.strokeStyle = '#ff8f1f';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(left * w, top * h, (1 - left - right) * w, (1 - top - bottom) * h);
  ctx.setLineDash([]);
  ctx.font = `${Math.max(10, Math.round(h * 0.018))}px monospace`;
  ctx.fillStyle = '#ff8f1f';
  project.lanes.forEach((lane, i) => {
    const x = lane.x * w;
    ctx.fillText(`${i + 1}`, x - 4, Math.max(12, top * h - 5));
    if (lane.removed) {
      ctx.strokeStyle = '#ff2d2d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, top * h);
      ctx.lineTo(x, (1 - bottom) * h);
      ctx.stroke();
    }
  });
  ctx.restore();
  return canvas;
}
