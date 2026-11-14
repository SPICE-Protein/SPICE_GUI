// Pure TypeScript NGS read mapping and SNV calling.
//
// Scope (v1): short reads, ungapped end-to-end alignment, k-mer seeding on
// both strands, and single-nucleotide variant calling from a simple pileup.
// No external dependencies and no I/O so the module can run in Node/Vitest,
// a web worker, or the Tauri frontend.

export interface FastqRead {
  id: string;
  sequence: string;
}

export interface MappingConfig {
  /** Seed length used to build the reference k-mer index. Default 11. */
  k?: number;
  /** Minimum accepted identity over the full read. Default 0.9. */
  minIdentity?: number;
  /** Maximum number of hits reported per read. Default 1 (best hit only). */
  maxHitsPerRead?: number;
  /** Search the reverse-complement strand as well. Default true. */
  bothStrands?: boolean;
}

export interface ReadMapping {
  readId: string;
  /** 0-based start on the forward reference. Inclusive. */
  refStart: number;
  /** 0-based end on the forward reference. Exclusive. */
  refEnd: number;
  strand: "+" | "-";
  mismatches: number;
  /** Matches divided by read length, in [0, 1]. */
  identity: number;
  /** Heuristic confidence score in [0, 60]. See mapReads documentation. */
  mapq: number;
}

export interface MappingResult {
  referenceLength: number;
  mappings: ReadMapping[];
  /** Number of reads with no accepted mapping. */
  unmapped: number;
}

export interface VariantCall {
  /** 0-based position on the forward reference. */
  position: number;
  ref: string;
  alt: string;
  depth: number;
  altCount: number;
  /** altCount / depth, in (0, 1]. */
  alleleFrequency: number;
  /**
   * Absolute imbalance of alt observations between strands:
   * |plus - minus| / altCount. 0 means balanced, 1 means all on one strand.
   */
  strandBias?: number;
}

export interface VariantConfig {
  /** Minimum total valid depth at a position. Default 3. */
  minDepth?: number;
  /** Minimum alt allele frequency. Default 0.2. */
  minAlleleFrequency?: number;
  /** Minimum mapping quality for a read to contribute to the pileup. Default 0. */
  minMapq?: number;
}

const DEFAULT_K = 11;
const DEFAULT_MIN_IDENTITY = 0.9;
const DEFAULT_MAX_HITS = 1;
const DEFAULT_MIN_DEPTH = 3;
const DEFAULT_MIN_ALLELE_FREQUENCY = 0.2;
const DEFAULT_MIN_MAPQ = 0;

/** Complement table used for reverse-complementing reads. */
const COMPLEMENT: Record<string, string> = {
  A: "T",
  C: "G",
  G: "C",
  T: "A"
};

/** Return true when every character is an unambiguous DNA base. */
function isAcgtSequence(sequence: string): boolean {
  for (let i = 0; i < sequence.length; i++) {
    if (!COMPLEMENT[sequence[i]]) return false;
  }
  return true;
}

/** Return true for a single unambiguous DNA base. */
function isAcgtBase(base: string | undefined): boolean {
  return base !== undefined && COMPLEMENT[base] !== undefined;
}

/** Uppercase a sequence and strip whitespace. */
function normalizeSequence(sequence: string): string {
  return sequence.replace(/\s+/g, "").toUpperCase();
}

/** Reverse complement of a DNA sequence; unknown characters become N. */
function reverseComplement(sequence: string): string {
  let result = "";
  for (let i = sequence.length - 1; i >= 0; i--) {
    result += COMPLEMENT[sequence[i]] ?? "N";
  }
  return result;
}

/**
 * Build a k-mer seed index mapping each k-mer to its 0-based start positions.
 * K-mers containing ambiguous bases are skipped.
 */
function buildSeedIndex(reference: string, k: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let start = 0; start + k <= reference.length; start++) {
    const kmer = reference.slice(start, start + k);
    if (!isAcgtSequence(kmer)) continue;
    const positions = index.get(kmer);
    if (positions) positions.push(start);
    else index.set(kmer, [start]);
  }
  return index;
}

interface Candidate {
  strand: "+" | "-";
  /** Alignment start on the forward reference. */
  start: number;
}

interface EvaluatedHit {
  strand: "+" | "-";
  start: number;
  mismatches: number;
  identity: number;
}

/**
 * Map reads to a reference using ungapped end-to-end alignment.
 *
 * Seeding: a k-mer index is built for the reference forward strand and, when
 * `bothStrands` is true, for its reverse complement. Reads are scanned on
 * their forward sequence against both indexes; a hit against the
 * reverse-complement index produces a "-" mapping with coordinates converted
 * back to the forward reference.
 *
 * Scoring: candidate alignments are compared base by base with no gaps, and
 * identity is matches / read length. Candidates below `minIdentity` are
 * discarded. Hits are ranked by identity, then mismatches, then start.
 *
 * MAPQ heuristic: let `best` be the top identity and `runnerUp` the best
 * identity at a different forward start. Uniqueness is
 * clamp((best - runnerUp) / 0.05, 0, 1); with no rival it is 1. The score is
 * 60 * best.identity * uniqueness, rounded and clamped to [0, 60]. Identical
 * hits at two loci therefore score 0, while a unique perfect hit scores 60.
 *
 * When a read is shorter than the configured k, all ungapped start positions
 * are considered directly so short reads are still mapped.
 */
export function mapReads(
  reference: string,
  reads: FastqRead[],
  config: MappingConfig = {}
): MappingResult {
  const ref = normalizeSequence(reference);
  const k = Math.max(1, Math.floor(config.k ?? DEFAULT_K));
  const minIdentity = config.minIdentity ?? DEFAULT_MIN_IDENTITY;
  const maxHitsPerRead = Math.max(1, Math.floor(config.maxHitsPerRead ?? DEFAULT_MAX_HITS));
  const bothStrands = config.bothStrands ?? true;

  const forwardIndex = buildSeedIndex(ref, k);
  const reverseIndex = bothStrands ? buildSeedIndex(reverseComplement(ref), k) : null;

  const mappings: ReadMapping[] = [];
  let unmapped = 0;

  for (const read of reads) {
    const readSequence = normalizeSequence(read.sequence);
    const readLength = readSequence.length;

    if (readLength === 0 || readLength > ref.length) {
      unmapped++;
      continue;
    }

    // Collect unique (strand, start) candidates from shared k-mers.
    const candidateKeys = new Set<string>();
    const candidates: Candidate[] = [];
    const addCandidate = (strand: "+" | "-", start: number): void => {
      if (start < 0 || start + readLength > ref.length) return;
      const key = `${strand}:${start}`;
      if (candidateKeys.has(key)) return;
      candidateKeys.add(key);
      candidates.push({ strand, start });
    };

    if (readLength < k) {
      // Short read: seeding cannot work with this k, so test every start.
      for (let start = 0; start + readLength <= ref.length; start++) {
        addCandidate("+", start);
        if (bothStrands) addCandidate("-", start);
      }
    } else {
      for (let offset = 0; offset + k <= readLength; offset++) {
        const kmer = readSequence.slice(offset, offset + k);
        if (!isAcgtSequence(kmer)) continue;

        for (const position of forwardIndex.get(kmer) ?? []) {
          addCandidate("+", position - offset);
        }

        if (reverseIndex) {
          // The read k-mer matched the reverse-complement reference. Convert
          // the reverse-complement start to a forward-reference start.
          for (const position of reverseIndex.get(kmer) ?? []) {
            const rcStart = position - offset;
            addCandidate("-", ref.length - rcStart - readLength);
          }
        }
      }
    }

    if (candidates.length === 0) {
      unmapped++;
      continue;
    }

    const reverseRead = bothStrands ? reverseComplement(readSequence) : "";

    const hits: EvaluatedHit[] = [];
    for (const candidate of candidates) {
      // For "-" mappings compare the reverse-complemented read to the forward
      // reference; this is equivalent to comparing the read to the
      // reverse-complement reference and keeps one coordinate system.
      const query = candidate.strand === "+" ? readSequence : reverseRead;
      const target = ref.slice(candidate.start, candidate.start + readLength);

      let mismatches = 0;
      for (let i = 0; i < readLength; i++) {
        if (query[i] !== target[i]) mismatches++;
      }

      const identity = (readLength - mismatches) / readLength;
      if (identity < minIdentity - 1e-12) continue;

      hits.push({
        strand: candidate.strand,
        start: candidate.start,
        mismatches,
        identity
      });
    }

    if (hits.length === 0) {
      unmapped++;
      continue;
    }

    hits.sort(
      (a, b) =>
        b.identity - a.identity ||
        a.mismatches - b.mismatches ||
        a.start - b.start ||
        (a.strand === "+" ? -1 : 1)
    );

    const best = hits[0];
    let runnerUpIdentity = -Infinity;
    for (const hit of hits) {
      if (hit.start !== best.start && hit.identity > runnerUpIdentity) {
        runnerUpIdentity = hit.identity;
      }
    }

    const uniqueness =
      runnerUpIdentity === -Infinity
        ? 1
        : Math.min(1, Math.max(0, (best.identity - runnerUpIdentity) / 0.05));
    const mapq = Math.min(
      60,
      Math.max(0, Math.round(60 * best.identity * uniqueness))
    );

    for (const hit of hits.slice(0, maxHitsPerRead)) {
      mappings.push({
        readId: read.id,
        refStart: hit.start,
        refEnd: hit.start + readLength,
        strand: hit.strand,
        mismatches: hit.mismatches,
        identity: hit.identity,
        mapq
      });
    }
  }

  return {
    referenceLength: ref.length,
    mappings,
    unmapped
  };
}

/**
 * Parse strict 4-line FASTQ records: header, sequence, plus line, quality.
 * The read id is the first whitespace-delimited token after "@".
 * Malformed records are skipped.
 */
export function extractReadsFromFastq(text: string): FastqRead[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const reads: FastqRead[] = [];

  for (let i = 0; i + 3 < lines.length; i += 4) {
    const header = lines[i];
    const sequence = lines[i + 1].trim();
    const plus = lines[i + 2];

    if (!header.startsWith("@") || header.length < 2) continue;
    if (!plus.startsWith("+") || sequence.length === 0) continue;

    const id = header.slice(1).trim().split(/\s+/)[0] || `read_${reads.length + 1}`;
    reads.push({ id, sequence });
  }

  return reads;
}

interface PileupEntry {
  depth: number;
  plus: Record<string, number>;
  minus: Record<string, number>;
}

/**
 * Call single-nucleotide variants from mapped reads.
 *
 * A pileup is built by walking each mapping over the forward reference.
 * Reverse-strand reads are reverse-complemented first so their bases are
 * compared in the same orientation as the reference. Positions or bases that
 * are not A/C/G/T are ignored, as are reads below `minMapq`.
 *
 * For every non-reference allele the caller computes total depth, alt count,
 * allele frequency, and strand bias. Calls are kept when depth >= minDepth and
 * allele frequency >= minAlleleFrequency, then sorted by position and alt base.
 * Indels and multi-base variants are intentionally out of scope for v1.
 */
export function callVariants(
  reference: string,
  mappings: ReadMapping[],
  reads: FastqRead[],
  config: VariantConfig = {}
): VariantCall[] {
  const ref = normalizeSequence(reference);
  const minDepth = config.minDepth ?? DEFAULT_MIN_DEPTH;
  const minAlleleFrequency = config.minAlleleFrequency ?? DEFAULT_MIN_ALLELE_FREQUENCY;
  const minMapq = config.minMapq ?? DEFAULT_MIN_MAPQ;

  const readById = new Map<string, string>();
  for (const read of reads) {
    if (!readById.has(read.id)) {
      readById.set(read.id, normalizeSequence(read.sequence));
    }
  }

  const pileup = new Map<number, PileupEntry>();

  for (const mapping of mappings) {
    if (mapping.mapq < minMapq) continue;

    const readSequence = readById.get(mapping.readId);
    if (!readSequence) continue;

    const alignedLength = Math.min(
      readSequence.length,
      mapping.refEnd - mapping.refStart
    );
    if (alignedLength <= 0) continue;

    const oriented =
      mapping.strand === "+" ? readSequence : reverseComplement(readSequence);

    for (let offset = 0; offset < alignedLength; offset++) {
      const position = mapping.refStart + offset;
      if (position < 0 || position >= ref.length) break;

      const readBase = oriented[offset];
      const refBase = ref[position];
      if (!isAcgtBase(readBase) || !isAcgtBase(refBase)) continue;

      let entry = pileup.get(position);
      if (!entry) {
        entry = { depth: 0, plus: {}, minus: {} };
        pileup.set(position, entry);
      }

      entry.depth++;
      const strandCounts = mapping.strand === "+" ? entry.plus : entry.minus;
      strandCounts[readBase] = (strandCounts[readBase] ?? 0) + 1;
    }
  }

  const calls: VariantCall[] = [];

  for (const [position, entry] of pileup) {
    if (entry.depth < minDepth) continue;

    const refBase = ref[position];
    const altBases = new Set([
      ...Object.keys(entry.plus),
      ...Object.keys(entry.minus)
    ]);

    for (const alt of altBases) {
      if (alt === refBase) continue;

      const plusCount = entry.plus[alt] ?? 0;
      const minusCount = entry.minus[alt] ?? 0;
      const altCount = plusCount + minusCount;
      if (altCount === 0) continue;

      const alleleFrequency = altCount / entry.depth;
      if (alleleFrequency < minAlleleFrequency) continue;

      calls.push({
        position,
        ref: refBase,
        alt,
        depth: entry.depth,
        altCount,
        alleleFrequency,
        strandBias: Math.abs(plusCount - minusCount) / altCount
      });
    }
  }

  calls.sort((a, b) => a.position - b.position || a.alt.localeCompare(b.alt));
  return calls;
}
