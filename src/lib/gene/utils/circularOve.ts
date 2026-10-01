/**
 * SPICE Gene Editor - OVE Circular View drawing primitives
 * Ported 1:1 from tg-oss/packages/ove/src/CircularView
 *
 * OVE uses a special polar convention where angle 0 is at 12 o'clock and
 * angles increase clockwise. The drawing helpers below match that convention.
 */

export interface CircularRange {
  start: number;
  end: number;
}

export interface RangeAngles {
  startAngle: number;
  endAngle: number;
  totalAngle: number;
  centerAngle: number;
}

/** Polar to cartesian where 0 rad points to 12 o'clock and angles grow clockwise. */
export function polarToSpecialCartesian(radius: number, angleInRadians: number) {
  return {
    x: radius * Math.cos(angleInRadians - Math.PI / 2),
    y: radius * Math.sin(angleInRadians - Math.PI / 2)
  };
}

/**
 * OVE getRangeAnglesSpecial.
 * Input range is 0-based inclusive.
 * Returns start/end/total/center angles in radians (startAngle at 12 o'clock).
 */
export function getRangeAnglesSpecial(
  range: CircularRange,
  sequenceLength: number
): RangeAngles {
  const len = Math.max(sequenceLength, 1);
  const rangeLength = (((range.end - range.start + 1) % len) + len) % len;
  const startAngle = 2 * Math.PI * (range.start / len);
  const totalAngle = (rangeLength / len) * Math.PI * 2;
  const endAngle = 2 * Math.PI * ((range.end + 1) / len);
  return {
    startAngle,
    totalAngle: totalAngle - 0.00001,
    endAngle: endAngle - 0.00001,
    centerAngle: startAngle + totalAngle / 2
  };
}

function svgArc(
  rx: number,
  ry: number,
  xAxisRotation: number,
  largeArcFlag: number,
  sweepFlag: number,
  x: number,
  y: number
) {
  return `A ${rx} ${ry} ${xAxisRotation} ${largeArcFlag} ${sweepFlag} ${x.toFixed(3)} ${y.toFixed(3)}`;
}

export interface PiePiecePath {
  /** SVG path string in the local coordinate system where the arrowhead sits at angle 0. */
  path: string;
  /** Optional SVG path string for inline labels. */
  textPath?: string;
}

/**
 * 1:1 Canvas/SVG path port of OVE drawDirectedPiePiece.
 *
 * The returned path is in local coordinates where the piece starts at angle 0
 * (arrowhead side) and sweeps to totalAngle. Callers must transform the context
 * so local 0 maps to the feature's startAngle.
 */
export function drawDirectedPiePiece(
  radius: number,
  annotationHeight: number,
  totalAngle: number,
  opts: {
    tailThickness?: number;
    arrowheadType?: 'NONE' | string;
    overlapsSelf?: boolean;
    hasLabel?: boolean;
    labelNeedsFlip?: boolean;
  } = {}
): PiePiecePath {
  const tailThickness = opts.tailThickness ?? 0.6;
  const tailHeight = annotationHeight * tailThickness;

  const arrowheadOuterRadius = radius + annotationHeight / 2;
  const arrowheadInnerRadius = radius - annotationHeight / 2;
  const tailOuterRadius = radius + tailHeight / 2;
  const tailInnerRadius = radius - tailHeight / 2;

  let arrowheadAngle = 80 / radius / (Math.PI * 2);
  if (totalAngle < arrowheadAngle) {
    arrowheadAngle = totalAngle;
  }
  if (opts.arrowheadType === 'NONE') arrowheadAngle = 0;
  const arcAngle = totalAngle - arrowheadAngle;

  const arrowheadPoint = polarToSpecialCartesian(radius, 0);
  const arrowheadBottom = polarToSpecialCartesian(arrowheadInnerRadius, arrowheadAngle);
  const arcLeftBottom = polarToSpecialCartesian(tailInnerRadius, arrowheadAngle);
  const arcRightBottom = polarToSpecialCartesian(tailInnerRadius, totalAngle);
  const arcRightTop = polarToSpecialCartesian(tailOuterRadius, totalAngle);
  const arcRightMiddle = polarToSpecialCartesian(radius, totalAngle);
  const arcRightMiddleOuter = polarToSpecialCartesian(radius, totalAngle + 0.03);
  const arcLeftTop = polarToSpecialCartesian(tailOuterRadius, arrowheadAngle);
  const arrowheadTop = polarToSpecialCartesian(arrowheadOuterRadius, arrowheadAngle);

  const stickOutThisMuch = 0.03;
  const largeArcFlag = arcAngle > Math.PI ? 1 : 0;

  function moveto(p: { x: number; y: number }) {
    return `M ${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  }
  function lineto(p: { x: number; y: number }) {
    return `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  }
  function arcto(rx: number, ry: number, large: number, sweep: number, p: { x: number; y: number }) {
    return svgArc(rx, ry, 0, large, sweep, p.x, p.y);
  }

  const pathParts: string[] = [];
  pathParts.push(moveto(arrowheadPoint));

  if (opts.overlapsSelf) {
    const arrowheadPointInner = polarToSpecialCartesian(radius, -stickOutThisMuch);
    pathParts.push(lineto(arrowheadPointInner));
    pathParts.push(lineto(arrowheadPoint));
  }

  pathParts.push(lineto(arrowheadBottom));
  pathParts.push(lineto(arcLeftBottom));

  // Inner arc from arrowheadAngle to totalAngle
  pathParts.push(arcto(tailInnerRadius, tailInnerRadius, largeArcFlag, 1, arcRightBottom));

  if (opts.overlapsSelf) {
    pathParts.push(lineto(arcRightMiddle));
    pathParts.push(lineto(arcRightMiddleOuter));
    pathParts.push(lineto(arcRightMiddle));
  }

  let textPath: string | undefined;
  if (opts.hasLabel) {
    if (opts.labelNeedsFlip) {
      const arcLeftTopZero = polarToSpecialCartesian(tailOuterRadius, 0);
      textPath = `${moveto(arcRightTop)} ${arcto(
        tailOuterRadius,
        tailOuterRadius,
        largeArcFlag,
        0,
        arcLeftTopZero
      )}`;
    } else {
      const arcLeftBottomZero = polarToSpecialCartesian(tailInnerRadius, 0);
      textPath = `${moveto(arcLeftBottomZero)} ${arcto(
        tailInnerRadius,
        tailInnerRadius,
        largeArcFlag,
        1,
        arcRightBottom
      )}`;
    }
  }

  pathParts.push(lineto(arcRightTop));
  // Outer arc from totalAngle back to arrowheadAngle (sweep 0)
  pathParts.push(arcto(tailOuterRadius, tailOuterRadius, largeArcFlag, 0, arcLeftTop));
  pathParts.push(lineto(arrowheadTop));
  pathParts.push('Z');

  return { path: pathParts.join(' '), textPath };
}

/** Returns true if text on the circle should be flipped (bottom half). */
export function shouldFlipText(angle: number): boolean {
  const a = angle > 2 * Math.PI ? angle - 2 * Math.PI : angle;
  return a > Math.PI * 0.5 && a < Math.PI * 1.5;
}

/**
 * Y-offset assignment matching OVE's drawAnnotations interval-tree logic.
 * Keeps overlapping annotations on separate concentric tracks.
 */
export function calculateYOffsets(
  annotations: CircularRange[],
  sequenceLength: number
): { annotation: CircularRange; yOffset: number }[] {
  const sorted = [...annotations].sort((a, b) => {
    const lenA = (a.end - a.start + sequenceLength) % sequenceLength;
    const lenB = (b.end - b.start + sequenceLength) % sequenceLength;
    return lenB - lenA;
  });

  const intervals: { start: number; end: number; yOffset: number }[] = [];

  function spansOrigin(r: CircularRange): boolean {
    return r.start > r.end;
  }

  function insert(start: number, end: number, yOffset: number) {
    intervals.push({ start, end, yOffset });
  }

  function getYOffset(start: number, end: number): number {
    const blocked = new Set<number>();
    for (const iv of intervals) {
      if (start < iv.end && end > iv.start) {
        blocked.add(iv.yOffset);
      }
    }
    let y = 0;
    while (blocked.has(y)) y++;
    return y;
  }

  const results = sorted.map((annotation) => {
    const { startAngle, endAngle } = getRangeAnglesSpecial(annotation, sequenceLength);
    const spans = spansOrigin(annotation);
    const expandedEndAngle = spans ? endAngle + 2 * Math.PI : endAngle;

    let yOffset: number;
    if (spans) {
      yOffset = getYOffset(startAngle, expandedEndAngle);
      insert(startAngle, expandedEndAngle, yOffset);
    } else {
      const y1 = getYOffset(startAngle, expandedEndAngle);
      const y2 = getYOffset(startAngle + 2 * Math.PI, expandedEndAngle + 2 * Math.PI);
      yOffset = Math.max(y1, y2);
      insert(startAngle, expandedEndAngle, yOffset);
      insert(startAngle + 2 * Math.PI, expandedEndAngle + 2 * Math.PI, yOffset);
    }

    return { annotation, yOffset };
  });

  const maxYOffset = results.reduce((max, cur) => Math.max(max, cur.yOffset), 0);
  return results.map((r) => ({ annotation: r.annotation, yOffset: maxYOffset - r.yOffset }));
}

/**
 * Ellipsizes a name to fit inside an arc, matching OVE's getEllipsizedName.
 */
export function getEllipsizedName(
  name: string,
  radius: number,
  annotationHeight: number,
  totalAngle: number
): string | undefined {
  if (!name) return undefined;
  const arcLength = 2 * Math.PI * (radius - annotationHeight) * totalAngle;
  const annLength = Math.max(0, Math.floor(arcLength / 55 - 3));
  let ellipsizedName: string | undefined = name.slice(0, annLength);
  if (ellipsizedName && ellipsizedName !== name) {
    if (ellipsizedName.length >= name.length - 2) {
      ellipsizedName = name;
    } else if (ellipsizedName.length > 3) {
      ellipsizedName += '..';
    } else {
      ellipsizedName = undefined;
    }
  }
  return ellipsizedName;
}

/**
 * Draw an OVE-style directed pie piece onto a Canvas 2D context.
 *
 * cx, cy         centre of the circle
 * radius         radius of the annotation centre line
 * annotationHeight
 * startAngle, endAngle, totalAngle  in OVE convention (0 at 12 o'clock, clockwise)
 * forward        true = arrow at startAngle, false = arrow at endAngle
 * color          fill colour
 * strokeColor    optional stroke colour
 * opts           passthrough to drawDirectedPiePiece
 */
export function drawOvePiePiece(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  annotationHeight: number,
  startAngle: number,
  endAngle: number,
  totalAngle: number,
  forward: boolean,
  color: string,
  strokeColor?: string,
  opts?: Parameters<typeof drawDirectedPiePiece>[3]
) {
  const { path } = drawDirectedPiePiece(radius, annotationHeight, totalAngle, opts);
  ctx.save();
  ctx.translate(cx, cy);
  if (!forward) {
    // OVE reverse transform: scale(-1,1) rotate(-endAngle)
    ctx.scale(-1, 1);
    ctx.rotate(-endAngle);
  } else {
    ctx.rotate(startAngle);
  }
  const p = new Path2D(path);
  ctx.fillStyle = color;
  ctx.fill(p);
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.5;
    ctx.stroke(p);
  }
  ctx.restore();
}
