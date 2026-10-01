// Sequence alignment: pairwise Needleman-Wunsch, multiple consensus,
// and align-to-reference for Sanger / clone verification.
// Pure TypeScript, no external dependencies.

import type { Range } from "./range";

// ──────────────────────────────── Types ────────────────────────────────

export type AlignmentMode = "global" | "local" | "semi-global";

export interface AlignmentCell {
  score: number;
  trace: "diag" | "up" | "left" | null;
}

export interface PairwiseAlignment {
  query: string;
  target: string;
  alignedQuery: string;
  alignedTarget: string;
  midline: string;
  score: number;
  identity: number; // 0..1
  queryStart: number;
  queryEnd: number;
  targetStart: number;
  targetEnd: number;
  gaps: number;
  mode: AlignmentMode;
}

export interface MultiAlignmentRow {
  id: string;
  name: string;
  alignedSeq: string;
  ungappedSeq: string;
  start: number;
  end: number;
  isRef?: boolean;
}

export interface MultiAlignment {
  rows: MultiAlignmentRow[];
  consensus: string;
  conservation: number[]; // 0..1 per column
  width: number;
  identity: number;
}

export interface AlignToReferenceResult {
  reference: string;
  query: string;
  alignedRef: string;
  alignedQuery: string;
  midline: string;
  identity: number;
  mismatches: number;
  gaps: number;
  deletions: { start: number; end: number; length: number }[];
  insertions: { start: number; end: number; length: number }[];
  intronAnnotations: { start: number; end: number; type: string }[];
  warnings: string[];
}

// ──────────────────────────────── Scoring ────────────────────────────────

const DEFAULT_MATCH = 2;
const DEFAULT_MISMATCH = -1;
const DEFAULT_GAP_OPEN = -5;
const DEFAULT_GAP_EXTEND = -1;

interface Scoring {
  match: number;
  mismatch: number;
  gapOpen: number;
  gapExtend: number;
}

function defaultScoring(): Scoring {
  return { match: DEFAULT_MATCH, mismatch: DEFAULT_MISMATCH, gapOpen: DEFAULT_GAP_OPEN, gapExtend: DEFAULT_GAP_EXTEND };
}

// ──────────────────────────────── Pairwise ────────────────────────────────

export function pairwiseAlign(
  query: string,
  target: string,
  mode: AlignmentMode = "global",
  scoring?: Partial<Scoring>
): PairwiseAlignment {
  const s = { ...defaultScoring(), ...scoring };
  const q = query.toUpperCase();
  const t = target.toUpperCase();
  const m = q.length;
  const n = t.length;

  if (m === 0 || n === 0) {
    return {
      query, target,
      alignedQuery: q || "-".repeat(n),
      alignedTarget: t || "-".repeat(m),
      midline: " ".repeat(Math.max(m, n)),
      score: 0, identity: 0,
      queryStart: 0, queryEnd: 0,
      targetStart: 0, targetEnd: 0,
      gaps: Math.max(m, n),
      mode,
    };
  }

  // DP matrix
  const rows = m + 1;
  const cols = n + 1;
  const dp: AlignmentCell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ score: 0, trace: null as AlignmentCell["trace"] }))
  );

  // Initialize: semi-global means no penalty for gaps at query ends
  for (let i = 0; i < rows; i++) {
    if (mode === "local") {
      dp[i][0] = { score: 0, trace: null };
    } else if (mode === "semi-global") {
      dp[i][0] = { score: 0, trace: null };
    } else {
      dp[i][0] = { score: s.gapOpen + (i - 1) * s.gapExtend, trace: "up" };
    }
  }
  for (let j = 0; j < cols; j++) {
    if (mode === "local") {
      dp[0][j] = { score: 0, trace: null };
    } else if (mode === "semi-global") {
      dp[0][j] = { score: s.gapOpen + (j - 1) * s.gapExtend, trace: "left" };
    } else {
      dp[0][j] = { score: s.gapOpen + (j - 1) * s.gapExtend, trace: "left" };
    }
  }
  dp[0][0] = { score: 0, trace: null };

  // Fill
  let bestI = 0, bestJ = 0, bestScore = 0;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const matchScore = q[i - 1] === t[j - 1] ? s.match : s.mismatch;
      const diag = dp[i - 1][j - 1].score + matchScore;
      const up = dp[i - 1][j].score + (dp[i - 1][j].trace === "up" ? s.gapExtend : s.gapOpen + s.gapExtend);
      const left = dp[i][j - 1].score + (dp[i][j - 1].trace === "left" ? s.gapExtend : s.gapOpen + s.gapExtend);
      let maxScore = diag;
      let trace: AlignmentCell["trace"] = "diag";
      if (up > maxScore) { maxScore = up; trace = "up"; }
      if (left > maxScore) { maxScore = left; trace = "left"; }
      if (mode === "local" && maxScore < 0) { maxScore = 0; trace = null; }
      dp[i][j] = { score: maxScore, trace };
      if (mode === "local" && maxScore > bestScore) {
        bestScore = maxScore; bestI = i; bestJ = j;
      }
    }
  }

  // Traceback
  let aq: string[] = [];
  let at: string[] = [];
  let i = mode === "local" ? bestI : rows - 1;
  let j = mode === "local" ? bestJ : cols - 1;

  // For semi-global: find best endpoint on last row or col
  if (mode === "semi-global") {
    let bestEnd = 0;
    for (let ii = 0; ii < rows; ii++) {
      if (dp[ii][cols - 1].score >= bestEnd) { bestEnd = dp[ii][cols - 1].score; i = ii; j = cols - 1; }
    }
    for (let jj = 0; jj < cols; jj++) {
      if (dp[rows - 1][jj].score >= bestEnd) { bestEnd = dp[rows - 1][jj].score; i = rows - 1; j = jj; }
    }
  }

  const qEndIdx = i;
  const tEndIdx = j;

  while (i > 0 || j > 0) {
    if (mode === "local" && dp[i][j].score === 0) break;
    const cell = dp[i][j];
    if (i > 0 && j > 0 && cell.trace === "diag") {
      aq.push(q[i - 1]);
      at.push(t[j - 1]);
      i--; j--;
    } else if (i > 0 && (cell.trace === "up" || j === 0)) {
      aq.push(q[i - 1]);
      at.push("-");
      i--;
    } else {
      aq.push("-");
      at.push(t[j - 1]);
      j--;
    }
  }

  aq.reverse();
  at.reverse();

  const alignedQuery = aq.join("");
  const alignedTarget = at.join("");
  const score = dp[qEndIdx][tEndIdx].score;

  // Identity
  let matches = 0;
  let gaps = 0;
  let midline = "";
  for (let k = 0; k < alignedQuery.length; k++) {
    if (alignedQuery[k] === alignedTarget[k] && alignedQuery[k] !== "-") {
      matches++;
      midline += "|";
    } else if (alignedQuery[k] === "-" || alignedTarget[k] === "-") {
      gaps++;
      midline += " ";
    } else {
      midline += ".";
    }
  }
  const identity = alignedQuery.length > 0 ? matches / alignedQuery.length : 0;

  return {
    query, target,
    alignedQuery, alignedTarget, midline,
    score, identity,
    queryStart: i, queryEnd: qEndIdx,
    targetStart: j, targetEnd: tEndIdx,
    gaps, mode,
  };
}

// ──────────────────────────────── Multiple Alignment ────────────────────────────────

export function multipleAlign(
  sequences: { id: string; name: string; seq: string }[],
  refIdx = 0
): MultiAlignment {
  if (sequences.length === 0) {
    return { rows: [], consensus: "", conservation: [], width: 0, identity: 0 };
  }
  if (sequences.length === 1) {
    const row: MultiAlignmentRow = {
      id: sequences[0].id, name: sequences[0].name,
      alignedSeq: sequences[0].seq.toUpperCase(),
      ungappedSeq: sequences[0].seq.toUpperCase(),
      start: 0, end: sequences[0].seq.length - 1,
      isRef: true,
    };
    const consensus = row.alignedSeq;
    const conservation = consensus.split("").map(() => 1);
    return { rows: [row], consensus, conservation, width: consensus.length, identity: 1 };
  }

  // Progressive alignment: align each sequence to the reference, then merge.
  const ref = sequences[refIdx];
  const aligned: MultiAlignmentRow[] = [];
  let masterAln = ref.seq.toUpperCase();
  const gapMap: number[] = []; // masterAln pos -> ungapped pos

  // Add reference as first row
  aligned.push({
    id: ref.id, name: ref.name,
    alignedSeq: masterAln,
    ungappedSeq: ref.seq.toUpperCase(),
    start: 0, end: ref.seq.length - 1,
    isRef: true,
  });
  for (let k = 0; k < masterAln.length; k++) gapMap.push(k);

  // Align each other sequence to the current master
  for (let s = 0; s < sequences.length; s++) {
    if (s === refIdx) continue;
    const seq = sequences[s].seq.toUpperCase();
    const aln = pairwiseAlign(seq, masterAln.replace(/-/g, ""), "semi-global");
    // Build new master by inserting gaps where needed
    const newMaster: string[] = [];
    const newSeqAligned: string[] = [];
    let qi = 0; // index into alignedQuery
    let ri = 0; // index into ungapped ref (master)
    const aq = aln.alignedQuery;
    const at = aln.alignedTarget;
    for (let k = 0; k < aq.length; k++) {
      if (at[k] === "-") {
        // Gap in ref -> insert gap into master for all previous rows
        newMaster.push("-");
        newSeqAligned.push(aq[k]);
      } else if (aq[k] === "-") {
        // Gap in query
        newMaster.push(masterAln[ri] || "-");
        newSeqAligned.push("-");
        ri++;
      } else {
        newMaster.push(masterAln[ri] || "-");
        newSeqAligned.push(aq[k]);
        ri++;
      }
    }

    // Update all previously aligned rows by inserting gaps
    const newMasterStr = newMaster.join("");
    const gapsToAdd: number[] = [];
    for (let k = 0; k < newMasterStr.length; k++) {
      if (newMasterStr[k] === "-") gapsToAdd.push(k);
    }
    // Rebuild previous rows with new gaps inserted at the right positions
    // (We need to map old master positions to new master positions)
    const oldToNew: number[] = [];
    let newIdx = 0;
    for (let k = 0; k < newMasterStr.length; k++) {
      if (newMasterStr[k] !== "-") {
        oldToNew.push(k);
      }
    }
    for (let r = 0; r < aligned.length; r++) {
      const oldSeq = aligned[r].alignedSeq;
      const rebuilt: string[] = new Array(newMasterStr.length).fill("-");
      for (let old = 0; old < oldSeq.length; old++) {
        if (oldToNew[old] !== undefined) {
          rebuilt[oldToNew[old]] = oldSeq[old];
        }
      }
      aligned[r].alignedSeq = rebuilt.join("");
    }
    masterAln = newMasterStr;
    aligned.push({
      id: sequences[s].id, name: sequences[s].name,
      alignedSeq: newSeqAligned.join(""),
      ungappedSeq: seq,
      start: 0, end: seq.length - 1,
    });
  }

  const width = masterAln.length;

  // Consensus + conservation
  let consensus = "";
  const conservation: number[] = [];
  for (let col = 0; col < width; col++) {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const row of aligned) {
      const ch = row.alignedSeq[col] || "-";
      counts[ch] = (counts[ch] || 0) + 1;
      total++;
    }
    let best = "-";
    let bestCount = 0;
    for (const [ch, c] of Object.entries(counts)) {
      if (c > bestCount) { best = ch; bestCount = c; }
    }
    consensus += best;
    conservation.push(total > 0 ? bestCount / total : 0);
  }

  // Overall identity
  let matchCols = 0;
  for (let col = 0; col < width; col++) {
    const ch = aligned[0]?.alignedSeq[col];
    if (ch && aligned.every(r => r.alignedSeq[col] === ch)) matchCols++;
  }
  const identity = width > 0 ? matchCols / width : 0;

  return { rows: aligned, consensus, conservation, width, identity };
}

// ──────────────────────────────── Align to Reference ────────────────────────────────

export function alignToReference(
  reference: string,
  query: string,
  options: { isCDna?: boolean } = {}
): AlignToReferenceResult {
  const warnings: string[] = [];
  const aln = pairwiseAlign(query, reference, "semi-global");

  const deletions: { start: number; end: number; length: number }[] = [];
  const insertions: { start: number; end: number; length: number }[] = [];
  const intronAnnotations: { start: number; end: number; type: string }[] = [];

  let refPos = 0;
  let queryPos = 0;
  let gapStartRef = -1;
  let gapStartQuery = -1;

  for (let k = 0; k < aln.alignedQuery.length; k++) {
    const q = aln.alignedQuery[k];
    const r = aln.alignedTarget[k];
    if (q === "-" && r !== "-") {
      // Deletion in query relative to reference
      if (gapStartRef === -1) gapStartRef = refPos;
    } else {
      if (gapStartRef !== -1) {
        const len = refPos - gapStartRef;
        if (options.isCDna && len >= 15) {
          // Splicing-aware alignment: shift coordinates locally to align with GT-AG consensus
          let bestShift = 0;
          let foundConsensus = false;
          for (let shift = -5; shift <= 5; shift++) {
            const donorStart = gapStartRef + shift;
            const acceptorEnd = refPos - 1 + shift;
            if (donorStart >= 0 && acceptorEnd < reference.length) {
              const donor = reference.slice(donorStart, donorStart + 2).toUpperCase();
              const acceptor = reference.slice(acceptorEnd - 1, acceptorEnd + 1).toUpperCase();
              if ((donor === "GT" && acceptor === "AG") || (donor === "GU" && acceptor === "AG")) {
                bestShift = shift;
                foundConsensus = true;
                break;
              }
            }
          }
          const s = gapStartRef + bestShift;
          const e = refPos - 1 + bestShift;
          const finalLen = e - s + 1;
          deletions.push({ start: s, end: e, length: finalLen });
          intronAnnotations.push({
            start: s,
            end: e,
            type: `intron${foundConsensus ? " (GT-AG verified)" : ""}`
          });
        } else {
          deletions.push({ start: gapStartRef, end: refPos - 1, length: len });
          if (options.isCDna && len >= 10) {
            intronAnnotations.push({ start: gapStartRef, end: refPos - 1, type: "intron" });
          }
        }
        gapStartRef = -1;
      }
    }
    if (r === "-" && q !== "-") {
      // Insertion in query
      if (gapStartQuery === -1) gapStartQuery = refPos;
    } else {
      if (gapStartQuery !== -1) {
        const len = refPos - gapStartQuery;
        insertions.push({ start: gapStartQuery, end: refPos - 1, length: len });
        gapStartQuery = -1;
      }
    }
    if (r !== "-") refPos++;
    if (q !== "-") queryPos++;
  }
  // Close trailing gaps
  if (gapStartRef !== -1) {
    const len = refPos - gapStartRef;
    if (options.isCDna && len >= 15) {
      let bestShift = 0;
      let foundConsensus = false;
      for (let shift = -5; shift <= 5; shift++) {
        const donorStart = gapStartRef + shift;
        const acceptorEnd = refPos - 1 + shift;
        if (donorStart >= 0 && acceptorEnd < reference.length) {
          const donor = reference.slice(donorStart, donorStart + 2).toUpperCase();
          const acceptor = reference.slice(acceptorEnd - 1, acceptorEnd + 1).toUpperCase();
          if ((donor === "GT" && acceptor === "AG") || (donor === "GU" && acceptor === "AG")) {
            bestShift = shift;
            foundConsensus = true;
            break;
          }
        }
      }
      const s = gapStartRef + bestShift;
      const e = refPos - 1 + bestShift;
      const finalLen = e - s + 1;
      deletions.push({ start: s, end: e, length: finalLen });
      intronAnnotations.push({
        start: s,
        end: e,
        type: `intron${foundConsensus ? " (GT-AG verified)" : ""}`
      });
    } else {
      deletions.push({ start: gapStartRef, end: refPos - 1, length: len });
      if (options.isCDna && len >= 10) {
        intronAnnotations.push({ start: gapStartRef, end: refPos - 1, type: "intron" });
      }
    }
  }
  if (gapStartQuery !== -1) {
    insertions.push({ start: gapStartQuery, end: refPos - 1, length: refPos - gapStartQuery });
  }

  let mismatches = 0;
  for (let k = 0; k < aln.alignedQuery.length; k++) {
    const q = aln.alignedQuery[k];
    const r = aln.alignedTarget[k];
    if (q !== "-" && r !== "-" && q !== r) mismatches++;
  }

  if (aln.identity < 0.95) {
    warnings.push(`Low identity (${(aln.identity * 100).toFixed(1)}%) — verify sequence integrity`);
  }

  return {
    reference, query,
    alignedRef: aln.alignedTarget,
    alignedQuery: aln.alignedQuery,
    midline: aln.midline,
    identity: aln.identity,
    mismatches,
    gaps: aln.gaps,
    deletions, insertions, intronAnnotations,
    warnings,
  };
}
