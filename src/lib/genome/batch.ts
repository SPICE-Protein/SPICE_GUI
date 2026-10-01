import { type SequenceData } from "./clone";
import { getCutsitesFromSequenceFlat, type Cutsite, getEnzymeByName } from "./enzymes";
import { designPrimersForCloning, type PrimerDesignResult } from "./primerAnalysis";
import { serializeSequenceData, type SeqFileFormat } from "./formats";

export interface BatchDigestResult {
  sequenceName: string;
  cutsitesCount: number;
  cutsites: Cutsite[];
}

export interface BatchPrimerResult {
  sequenceName: string;
  primers: PrimerDesignResult;
}

export interface BatchExportResult {
  sequenceName: string;
  content: string;
  format: SeqFileFormat;
}

/**
 * Advanced high-throughput molecular CAD batch execution pipeline.
 * Designed for parallel or queued multi-file processing of plasmid/genomic sequences.
 */
export class BatchEngine {
  /**
   * Run a restriction digestion across multiple sequences.
   * Useful for high-throughput screening of plasmid backbones for a target cutter.
   */
  static batchDigest(
    sequences: SequenceData[],
    enzymeNames: string[],
    circular = true
  ): BatchDigestResult[] {
    const enzymes = enzymeNames
      .map((name) => getEnzymeByName(name))
      .filter((e) => e !== undefined);

    if (enzymes.length === 0) return [];

    return sequences.map((seq) => {
      const cuts = getCutsitesFromSequenceFlat(seq.sequence, seq.circular ?? circular, enzymes as any);
      return {
        sequenceName: seq.name || "Untitled",
        cutsitesCount: cuts.length,
        cutsites: cuts
      };
    });
  }

  /**
   * Run automated primer design on a batch of sequences.
   * Designs primers centered on a relative range or specific features for all files.
   */
  static batchDesignPrimers(
    sequences: SequenceData[],
    options: {
      relativeStart: number;
      relativeEnd: number;
      targetTm?: number;
      homologyArmLength?: number;
    }
  ): BatchPrimerResult[] {
    const { relativeStart, relativeEnd, targetTm = 60, homologyArmLength = 20 } = options;

    return sequences.map((seq) => {
      const len = seq.sequence.length;
      const start = Math.max(0, Math.min(relativeStart, len - 1));
      const end = Math.max(start, Math.min(relativeEnd, len - 1));

      const primers = designPrimersForCloning({
        templateSequence: seq.sequence,
        targetRange: { start, end },
        targetTm,
        homologyArmLength
      });

      return {
        sequenceName: seq.name || "Untitled",
        primers
      };
    });
  }

  /**
   * Batch serialize and export sequences into a specified file format.
   */
  static batchExport(
    sequences: SequenceData[],
    format: SeqFileFormat
  ): BatchExportResult[] {
    return sequences.map((seq) => {
      const content = serializeSequenceData(seq, format);
      return {
        sequenceName: seq.name || "Untitled",
        content,
        format
      };
    });
  }
}
