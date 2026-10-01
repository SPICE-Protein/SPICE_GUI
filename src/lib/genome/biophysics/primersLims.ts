/**
 * SPICE Local Primer LIMS-lite Repository (Feature 6)
 * 
 * Provides storage, Tm thermodynamics, and auto-matching algorithms
 * to link designed cloning primers to the local physical inventory.
 */

export interface StockPrimer {
  id: string;
  name: string;
  sequence: string;        // 5' -> 3'
  tm: number;              // °C
  concentration: number;   // uM
  volume: number;          // uL
  location: string;        // box details, e.g. "Box B - A3"
  orderedDate?: string;
}

/**
 * Calculates Wallace Tm for short primers (<14bp) or basic GC thermodynamic estimations for long ones.
 */
export function calculatePrimerTm(seq: string): number {
  const clean = seq.toUpperCase().replace(/[^ATCG]/g, "");
  const len = clean.length;
  if (len === 0) return 0;
  
  let g = 0, c = 0, a = 0, t = 0;
  for (const b of clean) {
    if (b === "G") g++;
    else if (b === "C") c++;
    else if (b === "A") a++;
    else if (b === "T") t++;
  }

  if (len < 14) {
    // Wallace Formula
    return 4 * (g + c) + 2 * (a + t);
  } else {
    // GC-content based empirical formula
    return 64.9 + 41 * (g + c - 16.4) / len;
  }
}

/**
 * Align and search for existing stock primers matching a query sequence.
 * Uses k-mer seeds (length 15) to check for binding capability.
 */
export function matchQueryToStockPrimers(
  primerSequence: string,
  inventory: StockPrimer[],
  minOverlap = 15
): StockPrimer[] {
  const query = primerSequence.toUpperCase().replace(/[^ATCG]/g, "");
  if (query.length < minOverlap) return [];

  const matches: StockPrimer[] = [];

  for (const item of inventory) {
    const stockSeq = item.sequence.toUpperCase().replace(/[^ATCG]/g, "");
    
    // Check if stock primer is a substring or contains a significant k-mer overlap
    if (stockSeq.includes(query) || query.includes(stockSeq)) {
      matches.push(item);
      continue;
    }

    // Slide-and-match scoring
    let maxOverlap = 0;
    const maxLen = Math.min(query.length, stockSeq.length);
    
    for (let offset = -stockSeq.length + minOverlap; offset < query.length - minOverlap; offset++) {
      let currentMatchLen = 0;
      for (let i = 0; i < stockSeq.length; i++) {
        const queryIdx = i + offset;
        if (queryIdx >= 0 && queryIdx < query.length) {
          if (stockSeq[i] === query[queryIdx]) {
            currentMatchLen++;
          } else {
            currentMatchLen = 0; // reset for contiguous overlap
          }
        }
      }
      if (currentMatchLen > maxOverlap) {
        maxOverlap = currentMatchLen;
      }
    }

    if (maxOverlap >= minOverlap) {
      matches.push(item);
    }
  }

  return matches;
}
