import { getReverseComplementSequenceString } from "./sequence";

export type OverhangType = "5-overhang" | "3-overhang" | "blunt";

export interface LinearDnaEnd {
  overhangType: OverhangType;
  overhangSeq: string;       // Sequence of the single-stranded overhang
  phosphorylated: boolean;   // Whether the 5' end has a phosphate group (necessary for ligation)
}

export interface LinearDna {
  sequence: string;
  leftEnd: LinearDnaEnd;
  rightEnd: LinearDnaEnd;
}

/**
 * High-performance physical simulation of DNA end modifications (Klenow Fill-in / T4 Chew-back).
 * Crucial for modeling non-circular vector and insert preparation in molecular cloning.
 */
export class EndModificationEngine {
  /**
   * Simulates DNA Polymerase I, Large (Klenow) Fragment activity.
   * Fills in 5'-overhangs by adding complementary nucleotides on the shorter strand.
   * Blunt and 3'-overhangs are left untouched.
   */
  static fillIn(dna: LinearDna): LinearDna {
    let seq = dna.sequence;
    let left = { ...dna.leftEnd };
    let right = { ...dna.rightEnd };

    // Left End Fill-in: a 5'-overhang at the left end belongs to the TOP strand;
    // Klenow fills in the recessed BOTTOM strand, so the top-strand sequence
    // (dnaSeq) is UNCHANGED — the old code wrongly prepended the complement.
    if (left.overhangType === "5-overhang") {
      left.overhangType = "blunt";
      left.overhangSeq = "";
    }

    // Right End Fill-in: a 5'-overhang at the right end belongs to the BOTTOM
    // strand; Klenow extends the top strand's 3' end. Strands are antiparallel,
    // so the appended bases are the REVERSE complement of the overhang
    // (plain complement was only accidentally right for palindromes like AATT).
    if (right.overhangType === "5-overhang" && right.overhangSeq !== "") {
      seq = seq + getReverseComplementSequenceString(right.overhangSeq);
      right.overhangType = "blunt";
      right.overhangSeq = "";
    }

    return { sequence: seq, leftEnd: left, rightEnd: right };
  }

  /**
   * Simulates T4 DNA Polymerase activity.
   * Chews back 3'-overhangs using its strong 3'->5' exonuclease activity to create flat blunt ends.
   * Blunt and 5'-overhangs are left untouched.
   */
  static chewBack(dna: LinearDna): LinearDna {
    let seq = dna.sequence;
    let left = { ...dna.leftEnd };
    let right = { ...dna.rightEnd };

    // Left End Chew-back: the 3'-overhang at the left end is on the BOTTOM
    // strand — removing it does not change the top-strand sequence.
    if (left.overhangType === "3-overhang") {
      left.overhangType = "blunt";
      left.overhangSeq = "";
    }

    // Right End Chew-back: the 3'-overhang at the right end IS the top strand's
    // own tail — the exonuclease shortens the sequence by the overhang length.
    if (right.overhangType === "3-overhang") {
      const n = right.overhangSeq.length;
      seq = seq.slice(0, Math.max(0, seq.length - n));
      right.overhangType = "blunt";
      right.overhangSeq = "";
    }

    return { sequence: seq, leftEnd: left, rightEnd: right };
  }

  /**
   * Simulates Alkaline Phosphatase (AP/CIP) or T4 Polynucleotide Kinase (PNK) treatment.
   * Adjusts the 5'-phosphorylation state of the DNA ends.
   */
  static setPhosphorylation(dna: LinearDna, phosphorylated: boolean): LinearDna {
    return {
      sequence: dna.sequence,
      leftEnd: { ...dna.leftEnd, phosphorylated },
      rightEnd: { ...dna.rightEnd, phosphorylated }
    };
  }
}
