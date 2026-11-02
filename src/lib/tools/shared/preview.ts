// Small raster previews stored on project documents. Previews are deliberately
// capped: they live in localStorage snapshots and journal Markdown, while the
// full-resolution artwork stays in the tool project / reproducible bundle.
export const PREVIEW_MAX_WIDTH = 760;

function previewCanvas(width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / Math.max(1, width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

/** Render an existing canvas into a compact white-backed JPEG preview. */
export function canvasPreview(source: HTMLCanvasElement, maxWidth = PREVIEW_MAX_WIDTH): string {
  const scale = Math.min(1, maxWidth / Math.max(1, source.width));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** Decode an image data URL and shrink it for the hub. */
export async function imagePreview(source: string, maxWidth = PREVIEW_MAX_WIDTH): Promise<string> {
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('preview image decode failed'));
    img.src = source;
  });
  const canvas = previewCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** Rasterise an SVG string for a hub/ELN preview. */
export async function svgPreview(svg: string, width: number, height: number): Promise<string> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('preview SVG decode failed'));
      img.src = url;
    });
    const canvas = previewCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
