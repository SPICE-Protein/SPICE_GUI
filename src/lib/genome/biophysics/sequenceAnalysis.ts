/**
 * SPICE Homology, Evolution, and Sequence Analysis Engine (Features 7, 8, 9 & 10)
 * 
 * Provides rigorous mathematical and structural algorithms for local BLAST alignments, 
 * Neighbor-Joining evolutionary trees, Shannon entropy Sequence Logos, and 2D Dot Plots.
 */

import { getReverseComplementSequenceString } from "../sequence";
import * as m from "$lib/paraglide/messages.js";

// ──────────────────────────────── 7: Local BLAST Seed-and-Extend ────────────────────────────────

export interface BlastHit {
  subjectName: string;
  score: number;
  identity: number; // 0..100
  queryStart: number;
  queryEnd: number;
  subjectStart: number;
  subjectEnd: number;
  alignmentStr: string; // vertical matching lines
}

/**
 * Executes a high-performance local Seed-and-Extend alignment (simplified BLAST).
 * Seeds using k-mer lookups (k=11), then extends matching segments.
 */
export function runLocalBlast(
  query: string,
  subjects: { name: string; seq: string }[],
  k = 11
): BlastHit[] {
  const qSeq = query.toUpperCase();
  const hits: BlastHit[] = [];

  for (const sub of subjects) {
    const sSeq = sub.seq.toUpperCase();
    
    // 1. Build k-mer seed index for Subject
    const sIdxMap = new Map<string, number[]>();
    for (let i = 0; i <= sSeq.length - k; i++) {
      const kmer = sSeq.slice(i, i + k);
      if (!sIdxMap.has(kmer)) sIdxMap.set(kmer, []);
      sIdxMap.get(kmer)!.push(i);
    }

    // 2. Scan Query for matching seeds
    for (let qPos = 0; qPos <= qSeq.length - k; qPos++) {
      const kmer = qSeq.slice(qPos, qPos + k);
      if (sIdxMap.has(kmer)) {
        const sPositions = sIdxMap.get(kmer)!;
        // Low complexity filter: skip seeds that match too many times to prevent N^2 freeze
        if (sPositions.length > 8) continue;
        
        for (const sPos of sPositions) {
          // 3. Extend seed on both sides
          let qLeft = qPos;
          let sLeft = sPos;
          while (qLeft > 0 && sLeft > 0 && qSeq[qLeft - 1] === sSeq[sLeft - 1]) {
            qLeft--;
            sLeft--;
          }

          let qRight = qPos + k;
          let sRight = sPos + k;
          while (qRight < qSeq.length && sRight < sSeq.length && qSeq[qRight] === sSeq[sRight]) {
            qRight++;
            sRight++;
          }

          const matchLen = qRight - qLeft;
          if (matchLen >= k + 4) { // Only record significant hits
            const alignmentSliceQuery = qSeq.slice(qLeft, qRight);
            const alignmentSliceSubject = sSeq.slice(sLeft, sRight);
            
            // Calculate identity %
            let matches = 0;
            let alignmentStr = "";
            for (let i = 0; i < matchLen; i++) {
              if (alignmentSliceQuery[i] === alignmentSliceSubject[i]) {
                matches++;
                alignmentStr += "|";
              } else {
                alignmentStr += " ";
              }
            }

            const identity = (matches / matchLen) * 100;
            const score = matches * 2 - (matchLen - matches) * 1; // standard match/mismatch score

            // Prevent recording duplicates of the same extended window
            const exists = hits.some(h => h.subjectName === sub.name && h.subjectStart === sLeft && h.queryStart === qLeft);
            if (!exists) {
              hits.push({
                subjectName: sub.name,
                score,
                identity: Number(identity.toFixed(1)),
                queryStart: qLeft,
                queryEnd: qRight - 1,
                subjectStart: sLeft,
                subjectEnd: sRight - 1,
                alignmentStr: `${alignmentSliceQuery}\n${alignmentStr}\n${alignmentSliceSubject}`
              });

              if (hits.length >= 100) {
                return hits.sort((a, b) => b.score - a.score);
              }
            }
          }
        }
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score);
}

// ──────────────────────────────── 8: Neighbor-Joining (NJ) Phylogenetic Tree ────────────────────────────────

export interface PhylogenyNode {
  id: string;
  name: string;
  branchLength: number;
  children: PhylogenyNode[];
  isLeaf: boolean;
}

/**
 * Reconstructs a Neighbor-Joining (NJ) phylogenetic tree from an evolution distance matrix.
 * Outputs standard Newick format string and a hierarchical node tree.
 */
export function buildPhylogeneticTree(
  names: string[],
  distanceMatrix: number[][] // symmetric matrix N x N
): { newick: string; root: PhylogenyNode } {
  const n = names.length;
  if (n === 0) {
    throw new Error(m.seqNoSequencesForTree());
  }

  // Local helper clones
  let activeNodes = names.map((name, idx) => ({
    id: `node_${idx}`,
    name,
    isLeaf: true,
    branchLength: 0.0,
    children: [] as PhylogenyNode[],
    index: idx
  }));

  let matrix = distanceMatrix.map(row => [...row]);
  let nextNodeId = n;

  // Neighbor Joining loop until 2 nodes remain
  while (activeNodes.length > 2) {
    const len = activeNodes.length;
    
    // 1. Calculate net divergence r_i for each active node
    const r = Array(len).fill(0);
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let j = 0; j < len; j++) {
        if (i !== j) {
          sum += matrix[activeNodes[i].index][activeNodes[j].index];
        }
      }
      r[i] = sum;
    }

    // 2. Find closest pair based on Q-criterion:
    // Q_ij = (L - 2) * d_ij - r_i - r_j
    let minQ = Infinity;
    let u = -1, v = -1; // indices in activeNodes

    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        const d_ij = matrix[activeNodes[i].index][activeNodes[j].index];
        const q_ij = (len - 2) * d_ij - r[i] - r[j];
        if (q_ij < minQ) {
          minQ = q_ij;
          u = i;
          v = j;
        }
      }
    }

    // 3. Connect nodes u and v into a new parent node
    const nodeU = activeNodes[u];
    const nodeV = activeNodes[v];
    const d_uv = matrix[nodeU.index][nodeV.index];

    // Branch lengths from parent (W) to children (U and V)
    // d_wu = 0.5 * d_uv + (r_u - r_v) / (2 * (L - 2))
    const d_wu = 0.5 * d_uv + (r[u] - r[v]) / (2 * (len - 2));
    const d_wv = d_uv - d_wu;

    const parentNode = {
      id: `node_${nextNodeId++}`,
      name: `Internal_${nextNodeId}`,
      isLeaf: false,
      branchLength: 0.0,
      children: [
        { id: nodeU.id, name: nodeU.name, branchLength: Math.max(0, Number(d_wu.toFixed(5))), children: nodeU.children, isLeaf: nodeU.isLeaf },
        { id: nodeV.id, name: nodeV.name, branchLength: Math.max(0, Number(d_wv.toFixed(5))), children: nodeV.children, isLeaf: nodeV.isLeaf }
      ] as PhylogenyNode[],
      index: matrix.length // new row in distance matrix
    };

    // 4. Update Distance Matrix with new node distances:
    // d_wj = 0.5 * (d_uj + d_vj - d_uv)
    const newDistances = Array(matrix.length).fill(0);
    for (let j = 0; j < matrix.length; j++) {
      newDistances[j] = 0.5 * (matrix[nodeU.index][j] + matrix[nodeV.index][j] - d_uv);
    }
    
    // Add new row and column
    matrix.push([...newDistances, 0]);
    for (let rIdx = 0; rIdx < matrix.length - 1; rIdx++) {
      matrix[rIdx].push(newDistances[rIdx]);
    }

    // 5. Re-index active nodes
    activeNodes = activeNodes.filter((_, idx) => idx !== u && idx !== v);
    activeNodes.push(parentNode);
  }

  // Connect last 2 nodes with standard root
  const rootU = activeNodes[0];
  const rootV = activeNodes[1];
  const d_last = matrix[rootU.index][rootV.index];

  const rootNode: PhylogenyNode = {
    id: "root",
    name: "Root",
    branchLength: 0.0,
    isLeaf: false,
    children: [
      { id: rootU.id, name: rootU.name, branchLength: Number((d_last / 2).toFixed(5)), children: rootU.children, isLeaf: rootU.isLeaf },
      { id: rootV.id, name: rootV.name, branchLength: Number((d_last / 2).toFixed(5)), children: rootV.children, isLeaf: rootV.isLeaf }
    ]
  };

  // Convert to Standard Newick string recursively
  function toNewick(node: PhylogenyNode): string {
    if (node.isLeaf) {
      return `${node.name}:${node.branchLength}`;
    }
    const childrenStr = node.children.map(c => toNewick(c)).join(",");
    return `(${childrenStr})${node.id === "root" ? ";" : `:${node.branchLength}`}`;
  }

  return {
    newick: toNewick(rootNode),
    root: rootNode
  };
}

// ──────────────────────────────── 9: Shannon Information Entropy Sequence Logo ────────────────────────────────

export interface SequenceLogoPosition {
  position: number;
  totalEntropyBits: number; // conserved bits
  frequencies: { char: string; bitsScaled: number; pct: number }[];
}

/**
 * Computes the Shannon information entropy logo profile from multiple aligned sequences.
 */
export function calculateSequenceLogo(alignedSeqs: string[]): SequenceLogoPosition[] {
  const n = alignedSeqs.length;
  if (n === 0) return [];
  const len = alignedSeqs[0].length;
  
  const logo: SequenceLogoPosition[] = [];

  // Shannon max bits (4 for DNA, ~4.32 for RNA, 4.32 for 20aa)
  const maxBits = Math.log2(4); // default nucleic

  for (let i = 0; i < len; i++) {
    const counts: Record<string, number> = {};
    let totalValid = 0;

    for (const seq of alignedSeqs) {
      const char = seq[i]?.toUpperCase() || "-";
      if (char !== "-" && char !== " ") {
        counts[char] = (counts[char] || 0) + 1;
        totalValid++;
      }
    }

    if (totalValid === 0) continue;

    // Calculate Shannon entropy
    let entropy = 0;
    const freqs: { char: string; pct: number }[] = [];
    for (const [char, count] of Object.entries(counts)) {
      const p = count / totalValid;
      entropy -= p * Math.log2(p);
      freqs.push({ char, pct: Number((p * 100).toFixed(1)) });
    }

    // Information content R_i = maxBits - H_i
    const r_i = Math.max(0, maxBits - entropy);

    logo.push({
      position: i + 1,
      totalEntropyBits: Number(r_i.toFixed(3)),
      frequencies: freqs.map(f => ({
        char: f.char,
        bitsScaled: Number((r_i * (f.pct / 100)).toFixed(3)),
        pct: f.pct
      })).sort((a, b) => b.bitsScaled - a.bitsScaled)
    });
  }

  return logo;
}

// ──────────────────────────────── 10: Dot Plot 2D Similarity Matrix ────────────────────────────────

export interface DotPlotMatchPoint {
  x: number; // index on seq1
  y: number; // index on seq2
}

/**
 * Calculates Dot Plot matching points over a 2D diagonal matrix using a sliding window.
 */
export function calculateDotPlot(
  seq1: string,
  seq2: string,
  windowSize = 15,
  threshold = 12 // minimum matches out of windowSize
): DotPlotMatchPoint[] {
  const clean1 = seq1.toUpperCase();
  const clean2 = seq2.toUpperCase();
  const points: DotPlotMatchPoint[] = [];

  const maxCheck = 200; // Limit rendering resolution for instant canvas feedback
  const step1 = Math.max(1, Math.floor(clean1.length / maxCheck));
  const step2 = Math.max(1, Math.floor(clean2.length / maxCheck));

  for (let i = 0; i <= clean1.length - windowSize; i += step1) {
    const sub1 = clean1.slice(i, i + windowSize);
    
    for (let j = 0; j <= clean2.length - windowSize; j += step2) {
      const sub2 = clean2.slice(j, j + windowSize);
      
      // Calculate local matching bases
      let matchCount = 0;
      for (let k = 0; k < windowSize; k++) {
        if (sub1[k] === sub2[k]) {
          matchCount++;
        }
      }

      if (matchCount >= threshold) {
        points.push({ x: i, y: j });
        if (points.length >= 1500) {
          return points; // Protect Svelte DOM from low-complexity rendering overload
        }
      }
    }
  }

  return points;
}
