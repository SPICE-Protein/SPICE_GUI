/**
 * SPICE Gene Editor - Geometry and Label Relaxation Utilities
 * Ported and adapted from TeselaGen tg-oss (open-vector-editor)
 */

export interface OveLabel {
  id: string;
  text: string;
  color: string;
  angle: number;                  // Absolute screen angle (including rotationRadians) in radians
  annotationCenterAngle: number;  // Base sequence midpoint angle (NOT rotated) in radians
  annotationCenterRadius: number;
  x: number;                      // Center-relative horizontal position in screen space
  y: number;                      // Center-relative vertical position in screen space
  width: number;                  // Calculated layout width
  innerPoint: { x: number; y: number };
  outerPoint: { x: number; y: number };
  labelAndSublabels?: OveLabel[];
  labelIds?: Record<string, boolean>;
  highPriorityLabel?: boolean;
}

/**
 * Normalizes an angle in radians into [0, 2π)
 */
export function normalizeAngle(a: number): number {
  let val = a % (2 * Math.PI);
  if (val < 0) {
    val += 2 * Math.PI;
  }
  return val;
}

/**
 * 1:1 OVE implementation of polar to cartesian projection where 0 radians is at 12 o'clock.
 * Does NOT bake in external rotations, ensuring modular coordinate integrity.
 */
export function polarToCartesian(
  r: number,
  angleRad: number,
  center = { x: 200, y: 200 }
) {
  return {
    x: center.x + r * Math.cos(angleRad - Math.PI / 2),
    y: center.y + r * Math.sin(angleRad - Math.PI / 2)
  };
}

/**
 * 1:1 OVE getTextLengthWithCollapseSpace algorithm
 * Calculates logical character length by collapsing whitespace and weighting CJK/non-ASCII chars.
 */
export function getTextLengthWithCollapseSpace(text: string, collapseWhiteSpace = true): number {
  let displayText = text || "Unlabeled";
  if (collapseWhiteSpace) {
    displayText = displayText.replace(/\s+/g, " ");
  }
  let len = displayText.length;
  const nonEnInputReg = /[^\x00-\xff]+/g;
  const nonEnStrings = displayText.match(nonEnInputReg) || [];
  nonEnStrings.forEach(() => {
    // Add weight for Chinese/Japanese/Korean double-width characters
    len += 1; 
  });
  return len;
}

/**
 * OVE relaxLabelAngles implementation.
 * Spreads labels out vertically to prevent overlap, adjusting x dynamically to keep them on the circle radius.
 */
export function relaxLabelAngles(
  _labelPoints: OveLabel[],
  spacing: number,
  maxradius: number
): OveLabel[] {
  // Only group labels if the total count is extremely large (>100) to keep them expanded and readable
  let labels = _labelPoints.map(l => ({ ...l }));
  const maxLabelsPerQuadrant = Math.floor(maxradius / spacing) + 4;
  
  if (labels.length > 100) {
    labels = combineLabels(labels, Math.max(120, maxLabelsPerQuadrant * 4));
  }

  const totalLength = Math.PI * 2;
  const rightTopLabels: OveLabel[] = [];
  const rightBottomLabels: OveLabel[] = [];
  const leftTopLabels: OveLabel[] = [];
  const leftBottomLabels: OveLabel[] = [];

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    label.angle = normalizeAngle(label.angle);
    const c = label.angle;
    
    // Sort into four quadrants (0 represents 12 o'clock, clockwise)
    if (c <= totalLength / 4) {
      rightTopLabels.push(label);
    } else if (c > totalLength / 4 && c <= totalLength / 2) {
      rightBottomLabels.push(label);
    } else if (c > totalLength / 2 && c <= (3 * totalLength) / 4) {
      leftBottomLabels.push(label);
    } else {
      leftTopLabels.push(label);
    }
  }

  function repositionAndGroupLabels(arr: OveLabel[]): OveLabel[] {
    const extraSpaces = Math.max(maxLabelsPerQuadrant - arr.length, 0);
    let lastLabelYPosition = 0 - spacing / 2;
    let lastlabel: OveLabel | undefined;

    return arr
      .map((label, idx) => {
        if (Math.abs(lastLabelYPosition) > maxradius + 80) {
          if (lastlabel) {
            lastlabel.labelAndSublabels ??= [];
            lastlabel.labelAndSublabels.push(label);
            lastlabel.labelIds ??= {};
            lastlabel.labelIds[label.id] = true;
          }
          return null;
        }
        lastlabel = label;
        
        if (label.y < lastLabelYPosition) {
          const naturalSlot = Math.floor(Math.abs(label.y / spacing));
          if (naturalSlot > extraSpaces) {
            if (idx < naturalSlot && extraSpaces > 0) {
              lastLabelYPosition = label.y;
            }
            label.y = lastLabelYPosition;
          }
          let x = Math.sqrt(Math.pow(maxradius, 2) - Math.pow(label.y, 2));
          if (isNaN(x)) x = 0;
          label.x = label.x > 0 ? x : -x;
          lastLabelYPosition = label.y - spacing;
        } else {
          label.y = lastLabelYPosition;
          lastLabelYPosition = label.y - spacing;
        }
        return label;
      })
      .filter((l): l is OveLabel => l !== null);
  }

  const flipLabelYs = (arr: OveLabel[]) => arr.map(label => ({ ...label, y: -label.y }));
  const sortByAngle = (a: OveLabel, b: OveLabel) => a.angle - b.angle;
  const sortByAngleReverse = (a: OveLabel, b: OveLabel) => b.angle - a.angle;

  let toReturn: OveLabel[] = [];
  
  // Quadrant 1: Right-Top (Sorted biggest angle first to go bottom-up towards 12 o'clock)
  toReturn = toReturn.concat(
    repositionAndGroupLabels(rightTopLabels.sort(sortByAngleReverse))
  );

  // Quadrant 2: Right-Bottom (Sorted smallest angle first to go top-down towards 6 o'clock)
  toReturn = toReturn.concat(
    flipLabelYs(repositionAndGroupLabels(flipLabelYs(rightBottomLabels.sort(sortByAngle))))
  );

  // Quadrant 3: Left-Bottom (Sorted biggest angle first)
  toReturn = toReturn.concat(
    flipLabelYs(repositionAndGroupLabels(flipLabelYs(leftBottomLabels.sort(sortByAngleReverse))))
  );

  // Quadrant 4: Left-Top (Sorted smallest angle first)
  toReturn = toReturn.concat(
    repositionAndGroupLabels(leftTopLabels.sort(sortByAngle))
  );

  return toReturn;
}

/**
 * OVE combineLabels implementation.
 * Merges overlapping labels when they exceed high-density limits to preserve legibility.
 */
export function combineLabels(labels: OveLabel[], numberOfBuckets: number): OveLabel[] {
  const buckets: Record<number, OveLabel> = {};
  labels.forEach(label => {
    const bucket = Math.floor((label.annotationCenterAngle / (2 * Math.PI)) * numberOfBuckets);
    if (!buckets[bucket]) {
      buckets[bucket] = { 
        ...label, 
        labelAndSublabels: [label], 
        labelIds: { [label.id]: true } 
      };
    } else {
      buckets[bucket].labelAndSublabels ??= [];
      buckets[bucket].labelAndSublabels.push(label);
      buckets[bucket].labelIds ??= {};
      buckets[bucket].labelIds[label.id] = true;
    }
  });
  
  return Object.keys(buckets).map(k => {
    const b = buckets[Number(k)];
    b.labelAndSublabels ??= [];
    return b;
  });
}
