// Deterministic plate assignment engine.
//
// The engine places controls, blanks, reserved edge wells and sample
// replicates on a fixed plate geometry. It never silently drops a constraint:
// every shortfall is returned as a localized-key issue and as an unplaced
// entry so the UI can show exactly what happened.

import {
  buildWellCells,
  clampInt,
  formatGeometry,
  isEdgeWell,
  requiredReplicates,
  wellId,
  type LayoutIssue,
  type PlateFormat,
  type PlateGeometry,
  type PlateRules,
  type SampleRow,
  type UnplacedSample,
  type WellAssignment,
  type WellCell,
} from './types';
import { mulberry32, shuffleInPlace, shuffled } from './random';

export const CONTROL_GROUP = 'Control';
export const BLANK_GROUP = 'Blank';

export interface AssignResult {
  assignments: Record<string, WellAssignment>;
  issues: LayoutIssue[];
  unplaced: UnplacedSample[];
  seed: number;
  reservedCount: number;
  stats: {
    assigned: number;
    sampleWells: number;
    controlWells: number;
    blankWells: number;
  };
}

export interface ValidateInput {
  format: PlateFormat;
  samples: SampleRow[];
  rules: PlateRules;
  assignments: Record<string, WellAssignment>;
}

export interface ValidationResult {
  issues: LayoutIssue[];
  unplaced: UnplacedSample[];
}

function pushIssue(
  list: LayoutIssue[],
  key: string,
  severity: LayoutIssue['severity'],
  params?: Record<string, string | number>,
) {
  list.push(params ? { key, severity, params } : { key, severity });
}

function dedupeIssues(list: LayoutIssue[]): LayoutIssue[] {
  const seen = new Set<string>();
  const out: LayoutIssue[] = [];
  for (const issue of list) {
    const token = `${issue.key}|${JSON.stringify(issue.params ?? {})}`;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(issue);
  }
  const weight: Record<LayoutIssue['severity'], number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => weight[a.severity] - weight[b.severity]);
}

/** Number of orthogonally connected components in a set of wells. */
function connectedGroups(cells: WellAssignment[]): number {
  if (cells.length < 2) return cells.length;
  const keys = new Set(cells.map((cell) => `${cell.row},${cell.col}`));
  const seen = new Set<string>();
  let groups = 0;
  for (const key of keys) {
    if (seen.has(key)) continue;
    groups++;
    seen.add(key);
    const stack = [key];
    while (stack.length) {
      const current = stack.pop() as string;
      const [row, col] = current.split(',').map(Number);
      const neighbours = [
        `${row + 1},${col}`,
        `${row - 1},${col}`,
        `${row},${col + 1}`,
        `${row},${col - 1}`,
      ];
      for (const next of neighbours) {
        if (keys.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  }
  return groups;
}

export function validateLayout(input: ValidateInput): ValidationResult {
  const { format, samples, rules, assignments } = input;
  const geometry = formatGeometry(format);
  const list = Object.values(assignments);
  const issues: LayoutIssue[] = [];
  const unplaced: UnplacedSample[] = [];

  // Duplicate guard. The internal map cannot hold two values for one well, but
  // imported or hand-built data can still be checked through this path.
  const seenWells = new Set<string>();
  for (const assignment of list) {
    if (seenWells.has(assignment.well)) {
      pushIssue(issues, 'plateIssueDuplicate', 'error', { well: assignment.well });
    }
    seenWells.add(assignment.well);
  }

  if (samples.length === 0) {
    pushIssue(issues, 'plateIssueNoSamples', 'info');
  }

  // Sample-list sanity checks.
  let blankNameReported = false;
  const nameCount = new Map<string, { label: string; count: number }>();
  for (const sample of samples) {
    const name = sample.name.trim();
    if (!name) {
      if (!blankNameReported) {
        pushIssue(issues, 'plateSampleNameRequired', 'warn');
        blankNameReported = true;
      }
      continue;
    }
    const key = name.toLowerCase();
    const entry = nameCount.get(key);
    if (entry) entry.count++;
    else nameCount.set(key, { label: name, count: 1 });
  }
  for (const entry of nameCount.values()) {
    if (entry.count > 1) {
      pushIssue(issues, 'plateDuplicateName', 'warn', { name: entry.label });
    }
  }

  // Capacity: reserved edge wells are unavailable to samples. Controls and
  // blanks may still use them, so the hard limit is checked separately.
  const sampleNeed = samples.reduce((sum, sample) => sum + requiredReplicates(sample, rules), 0);
  const auxNeed = Math.max(0, rules.controls) + Math.max(0, rules.blanks);
  const edgeCount = buildWellCells(geometry).filter((cell) => cell.edge).length;
  const interiorCount = geometry.total - edgeCount;
  if (rules.reserveEdge && sampleNeed > interiorCount) {
    pushIssue(issues, 'plateIssueCapacity', 'error', {
      needed: sampleNeed,
      available: interiorCount,
    });
  } else if (sampleNeed + auxNeed > geometry.total) {
    pushIssue(issues, 'plateIssueCapacity', 'error', {
      needed: sampleNeed + auxNeed,
      available: geometry.total,
    });
  }

  // Sample placement checks.
  for (const sample of samples) {
    const requested = requiredReplicates(sample, rules);
    const cells = list
      .filter((assignment) => assignment.type === 'sample' && assignment.sampleId === sample.id)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    const placed = cells.length;
    const missing = Math.max(0, requested - placed);
    if (missing > 0) {
      pushIssue(issues, 'plateIssueReplicatesMissing', 'error', {
        name: sample.name || sample.id,
        placed,
        requested,
      });
      unplaced.push({
        sampleId: sample.id,
        name: sample.name || sample.id,
        requested,
        placed,
        missing,
      });
    }
    if (cells.length > 1 && rules.keepTogether && connectedGroups(cells) > 1) {
      pushIssue(issues, 'plateIssueGroupSplit', 'warn', {
        name: sample.name || sample.id,
      });
    }
    if ((rules.avoidEdge || rules.reserveEdge) && cells.some((cell) => isEdgeWell(cell.row, cell.col, geometry.rows, geometry.cols))) {
      pushIssue(issues, 'plateIssueEdgeUsed', 'warn', {
        name: sample.name || sample.id,
      });
    }
  }

  // Controls and blanks.
  const controlPlaced = list.filter((assignment) => assignment.type === 'control').length;
  const blankPlaced = list.filter((assignment) => assignment.type === 'blank').length;
  if (controlPlaced < rules.controls) {
    pushIssue(issues, 'plateIssueControlsMissing', 'warn', {
      placed: controlPlaced,
      requested: rules.controls,
    });
  }
  if (blankPlaced < rules.blanks) {
    pushIssue(issues, 'plateIssueBlanksMissing', 'warn', {
      placed: blankPlaced,
      requested: rules.blanks,
    });
  }

  return { issues: dedupeIssues(issues), unplaced };
}

function sampleAssignment(cell: WellCell, sample: SampleRow, replicate: number): WellAssignment {
  return {
    well: cell.id,
    row: cell.row,
    col: cell.col,
    type: 'sample',
    sampleId: sample.id,
    sampleName: sample.name,
    group: sample.group,
    replicate,
    color: sample.color,
    manual: false,
  };
}

export function assignPlate(format: PlateFormat, samples: SampleRow[], rules: PlateRules): AssignResult {
  const geometry: PlateGeometry = formatGeometry(format);
  const allCells = buildWellCells(geometry);
  const assignments: Record<string, WellAssignment> = {};
  const used = new Set<string>();
  const internalIssues: LayoutIssue[] = [];
  const random = mulberry32(rules.seed);
  const cellAt = (row: number, col: number) => allCells[row * geometry.cols + col];
  const sampleEligible = (cell: WellCell) =>
    rules.reserveEdge || rules.avoidEdge ? !cell.edge : true;
  const usable = (cell: WellCell) => !used.has(cell.id) && sampleEligible(cell);

  const put = (cell: WellCell, value: WellAssignment): boolean => {
    if (assignments[cell.id]) {
      pushIssue(internalIssues, 'plateIssueDuplicate', 'error', { well: cell.id });
      return false;
    }
    assignments[cell.id] = value;
    used.add(cell.id);
    return true;
  };

  /** Controls and blanks prefer the edge ring, then the interior. */
  const takeAuxCells = (count: number): WellCell[] => {
    const wanted = clampInt(count, 0, geometry.total, 0);
    if (wanted === 0) return [];
    const pools: WellCell[][] = [
      allCells.filter((cell) => cell.edge),
      allCells.filter((cell) => !cell.edge),
    ];
    const picked: WellCell[] = [];
    for (const pool of pools) {
      if (picked.length >= wanted) break;
      const available = pool.filter((cell) => !used.has(cell.id));
      if (rules.randomize) shuffleInPlace(available, random);
      for (const cell of available.slice(0, wanted - picked.length)) {
        used.add(cell.id);
        picked.push(cell);
      }
    }
    return picked;
  };

  const takeFrom = (pool: WellCell[], count: number): WellCell[] => {
    const available = pool.filter((cell) => !used.has(cell.id));
    if (rules.randomize) shuffleInPlace(available, random);
    const picked = available.slice(0, count);
    for (const cell of picked) used.add(cell.id);
    return picked;
  };

  const placeScattered = (count: number): WellCell[] => {
    const pool = allCells.filter(usable);
    const picked = takeFrom(pool, count);
    // Edge avoidance is best effort: when the interior is exhausted the
    // remaining replicates go to edge wells and validation reports it.
    if (picked.length < count && rules.avoidEdge && !rules.reserveEdge) {
      picked.push(...takeFrom(allCells.filter((cell) => cell.edge), count - picked.length));
    }
    return picked;
  };

  const rowCandidates = (count: number): WellCell[][] => {
    if (count > geometry.cols) return [];
    const out: WellCell[][] = [];
    for (let row = 0; row < geometry.rows; row++) {
      for (let col = 0; col + count <= geometry.cols; col++) {
        const cells: WellCell[] = [];
        let ok = true;
        for (let step = 0; step < count; step++) {
          const cell = cellAt(row, col + step);
          if (!usable(cell)) {
            ok = false;
            break;
          }
          cells.push(cell);
        }
        if (ok) out.push(cells);
      }
    }
    return out;
  };

  const columnCandidates = (count: number): WellCell[][] => {
    if (count > geometry.rows) return [];
    const out: WellCell[][] = [];
    for (let col = 0; col < geometry.cols; col++) {
      for (let row = 0; row + count <= geometry.rows; row++) {
        const cells: WellCell[] = [];
        let ok = true;
        for (let step = 0; step < count; step++) {
          const cell = cellAt(row + step, col);
          if (!usable(cell)) {
            ok = false;
            break;
          }
          cells.push(cell);
        }
        if (ok) out.push(cells);
      }
    }
    return out;
  };

  const blockDimensions = (count: number): { rows: number; cols: number } => {
    let blockCols = rules.groupColumns > 0 ? Math.min(rules.groupColumns, geometry.cols) : 0;
    let blockRows = rules.groupRows > 0 ? Math.min(rules.groupRows, geometry.rows) : 0;
    if (blockCols > 0 && blockRows > 0) {
      while (blockCols * blockRows < count) {
        if (blockCols < geometry.cols) blockCols++;
        else if (blockRows < geometry.rows) blockRows++;
        else break;
      }
      return { rows: blockRows, cols: blockCols };
    }
    if (blockCols > 0) {
      return { rows: Math.min(geometry.rows, Math.ceil(count / blockCols)), cols: blockCols };
    }
    if (blockRows > 0) {
      return { rows: blockRows, cols: Math.min(geometry.cols, Math.ceil(count / blockRows)) };
    }
    let best = {
      rows: Math.min(geometry.rows, count),
      cols: Math.min(geometry.cols, Math.ceil(count / Math.min(geometry.rows, count))),
    };
    let bestScore = Number.POSITIVE_INFINITY;
    for (let width = 1; width <= Math.min(count, geometry.cols); width++) {
      const height = Math.ceil(count / width);
      if (height > geometry.rows) continue;
      const waste = width * height - count;
      const score = waste * 20 + Math.abs(width - height);
      if (score < bestScore) {
        bestScore = score;
        best = { rows: height, cols: width };
      }
    }
    return best;
  };

  const blockCandidates = (count: number): WellCell[][] => {
    const dims = blockDimensions(count);
    if (dims.rows < 1 || dims.cols < 1) return [];
    if (dims.rows > geometry.rows || dims.cols > geometry.cols) return [];
    const out: WellCell[][] = [];
    for (let row = 0; row + dims.rows <= geometry.rows; row++) {
      for (let col = 0; col + dims.cols <= geometry.cols; col++) {
        const cells: WellCell[] = [];
        let ok = true;
        for (let r = 0; r < dims.rows && ok; r++) {
          for (let c = 0; c < dims.cols; c++) {
            const cell = cellAt(row + r, col + c);
            if (!usable(cell)) {
              ok = false;
              break;
            }
            if (cells.length < count) cells.push(cell);
          }
        }
        if (ok) out.push(cells);
      }
    }
    return out;
  };

  const chooseCandidate = (candidates: WellCell[][]): WellCell[] | null => {
    if (candidates.length === 0) return null;
    // First-fit packing keeps groups adjacent instead of scattering them into
    // holes. Randomization still applies to the sample order and to scattered
    // wells, so a different seed gives a different layout.
    return candidates[0];
  };

  const placeGrouped = (count: number): WellCell[] => {
    const layout = rules.groupLayout;
    const order: Array<'row' | 'column' | 'block'> =
      layout === 'auto' ? ['row', 'column', 'block'] : [layout];
    for (const strategy of order) {
      const candidates =
        strategy === 'row'
          ? rowCandidates(count)
          : strategy === 'column'
            ? columnCandidates(count)
            : blockCandidates(count);
      const choice = chooseCandidate(candidates);
      if (choice && choice.length === count) {
        for (const cell of choice) used.add(cell.id);
        return choice;
      }
    }
    // Grouping was requested but impossible: place scattered wells and let
    // validation report the split instead of pretending success.
    return placeScattered(count);
  };

  const orderedSamples = rules.randomize ? shuffled(samples, random) : [...samples];
  for (const sample of orderedSamples) {
    const count = requiredReplicates(sample, rules);
    const cells = rules.keepTogether ? placeGrouped(count) : placeScattered(count);
    cells.forEach((cell, index) => {
      put(cell, sampleAssignment(cell, sample, index + 1));
    });
  }

  // Controls and blanks are placed after the samples so that grouping and
  // edge avoidance are not fragmented by auxiliary wells.
  const controlCells = takeAuxCells(rules.controls);
  controlCells.forEach((cell, index) => {
    put(cell, {
      well: cell.id,
      row: cell.row,
      col: cell.col,
      type: 'control',
      sampleId: '',
      sampleName: `CTRL-${index + 1}`,
      group: CONTROL_GROUP,
      replicate: index + 1,
      color: '#b48cff',
      manual: false,
    });
  });

  const blankCells = takeAuxCells(rules.blanks);
  blankCells.forEach((cell, index) => {
    put(cell, {
      well: cell.id,
      row: cell.row,
      col: cell.col,
      type: 'blank',
      sampleId: '',
      sampleName: `BLANK-${index + 1}`,
      group: BLANK_GROUP,
      replicate: index + 1,
      color: '#7f8ba8',
      manual: false,
    });
  });

  // Remaining edge wells become explicit reserved wells when requested.
  if (rules.reserveEdge) {
    for (const cell of allCells) {
      if (!cell.edge || used.has(cell.id)) continue;
      put(cell, {
        well: cell.id,
        row: cell.row,
        col: cell.col,
        type: 'reserved',
        sampleId: '',
        sampleName: '',
        group: '',
        replicate: 0,
        color: '#26304a',
        manual: false,
      });
    }
  }

  const validation = validateLayout({ format, samples, rules, assignments });
  const issues = dedupeIssues([...internalIssues, ...validation.issues]);
  const reservedCount = Object.values(assignments).filter(
    (assignment) => assignment.type === 'reserved',
  ).length;

  return {
    assignments,
    issues,
    unplaced: validation.unplaced,
    seed: rules.seed,
    reservedCount,
    stats: {
      assigned: Object.keys(assignments).length,
      sampleWells: Object.values(assignments).filter((assignment) => assignment.type === 'sample').length,
      controlWells: Object.values(assignments).filter((assignment) => assignment.type === 'control').length,
      blankWells: Object.values(assignments).filter((assignment) => assignment.type === 'blank').length,
    },
  };
}

/** Creates a manual sample assignment for the paint tool. */
export function manualSampleAssignment(
  geometry: PlateGeometry,
  sample: SampleRow,
  row: number,
  col: number,
  replicate: number,
): WellAssignment {
  return {
    well: wellId(row, col),
    row,
    col,
    type: 'sample',
    sampleId: sample.id,
    sampleName: sample.name,
    group: sample.group,
    replicate,
    color: sample.color,
    manual: true,
  };
}

export function manualAuxAssignment(
  geometry: PlateGeometry,
  type: 'control' | 'blank',
  row: number,
  col: number,
  replicate: number,
): WellAssignment {
  return {
    well: wellId(row, col),
    row,
    col,
    type,
    sampleId: '',
    sampleName: type === 'control' ? `CTRL-${replicate}` : `BLANK-${replicate}`,
    group: type === 'control' ? CONTROL_GROUP : BLANK_GROUP,
    replicate,
    color: type === 'control' ? '#b48cff' : '#7f8ba8',
    manual: true,
  };
}
