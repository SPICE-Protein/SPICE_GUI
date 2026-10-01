import { getReverseComplementSequenceString, getComplementSequenceString } from "./sequence";

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

    // Left End Fill-in
    if (left.overhangType === "5-overhang" && left.overhangSeq !== "") {
      // Add complementary bases to the 3' end of the top strand
      const complement = getComplementSequenceString(left.overhangSeq);
      seq = complement + seq;
      left.overhangType = "blunt";
      left.overhangSeq = "";
    }

    // Right End Fill-in
    if (right.overhangType === "5-overhang" && right.overhangSeq !== "") {
      // Add complementary bases to the 3' end of the bottom strand
      const complement = getComplementSequenceString(right.overhangSeq);
      seq = seq + complement;
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

    // Left End Chew-back
    if (left.overhangType === "3-overhang") {
      // Exonuclease removes the single-stranded 3' overhang
      left.overhangType = "blunt";
      left.overhangSeq = "";
    }

    // Right End Chew-back
    if (right.overhangType === "3-overhang") {
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
