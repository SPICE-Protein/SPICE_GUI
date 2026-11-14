import { describe, expect, it } from 'vitest';
import {
  callVariants,
  extractReadsFromFastq,
  mapReads,
  type FastqRead
} from '$lib/genome/ngs/mapping';

const REFERENCE = 'GATTACAGGCCTAGATCGATGGCATCAGTTCGACTGACCTAGGTACCGATTCGAGCATCGATCGT';
const READ_START = 10;
const READ_LENGTH = 20;
const EXACT_READ = REFERENCE.slice(READ_START, READ_START + READ_LENGTH);

function reverseComplement(sequence: string): string {
  const complement: Record<string, string> = {
    A: 'T',
    C: 'G',
    G: 'C',
    T: 'A'
  };
  let result = '';
  for (let i = sequence.length - 1; i >= 0; i--) {
    result += complement[sequence[i]] ?? 'N';
  }
  return result;
}

function mutateBase(sequence: string, index: number, base: string): string {
  return sequence.slice(0, index) + base + sequence.slice(index + 1);
}

describe('mapReads', () => {
  it('maps an exact read to the correct start and forward strand', () => {
    const reads: FastqRead[] = [{ id: 'read-1', sequence: EXACT_READ }];
    const result = mapReads(REFERENCE, reads, { k: 7 });

    expect(result.referenceLength).toBe(REFERENCE.length);
    expect(result.unmapped).toBe(0);
    expect(result.mappings).toHaveLength(1);

    const mapping = result.mappings[0];
    expect(mapping.readId).toBe('read-1');
    expect(mapping.refStart).toBe(READ_START);
    expect(mapping.refEnd).toBe(READ_START + READ_LENGTH);
    expect(mapping.strand).toBe('+');
    expect(mapping.mismatches).toBe(0);
    expect(mapping.identity).toBeCloseTo(1, 10);
    expect(mapping.mapq).toBeGreaterThan(0);
  });

  it('maps a reverse-complement read to the minus strand', () => {
    const readSequence = reverseComplement(EXACT_READ);
    const result = mapReads(REFERENCE, [{ id: 'read-rc', sequence: readSequence }], {
      k: 7
    });

    expect(result.unmapped).toBe(0);
    expect(result.mappings).toHaveLength(1);

    const mapping = result.mappings[0];
    expect(mapping.strand).toBe('-');
    expect(mapping.refStart).toBe(READ_START);
    expect(mapping.refEnd).toBe(READ_START + READ_LENGTH);
    expect(mapping.mismatches).toBe(0);
  });

  it('accepts a mismatch above the identity threshold and rejects it below', () => {
    const mutated = mutateBase(EXACT_READ, 10, 'A');

    const accepted = mapReads(REFERENCE, [{ id: 'read-mm', sequence: mutated }], {
      k: 7,
      minIdentity: 0.9
    });
    expect(accepted.unmapped).toBe(0);
    expect(accepted.mappings).toHaveLength(1);
    expect(accepted.mappings[0].mismatches).toBe(1);
    expect(accepted.mappings[0].identity).toBeCloseTo(0.95, 10);

    const rejected = mapReads(REFERENCE, [{ id: 'read-mm', sequence: mutated }], {
      k: 7,
      minIdentity: 0.99
    });
    expect(rejected.mappings).toHaveLength(0);
    expect(rejected.unmapped).toBe(1);
  });

  it('reports unmapped reads that do not resemble the reference', () => {
    const result = mapReads(REFERENCE, [{ id: 'noise', sequence: 'GGGGGGGGGGGGGGGGGGGG' }], {
      k: 7
    });

    expect(result.mappings).toHaveLength(0);
    expect(result.unmapped).toBe(1);
  });
});

describe('callVariants', () => {
  const VARIANT_POSITION = READ_START + 10;
  const REF_BASE = REFERENCE[VARIANT_POSITION];
  const ALT_BASE = REF_BASE === 'A' ? 'C' : 'A';

  function buildReads(altCount: number, refCount: number): FastqRead[] {
    const reads: FastqRead[] = [];
    const altRead = mutateBase(EXACT_READ, 10, ALT_BASE);

    for (let i = 0; i < refCount; i++) {
      reads.push({ id: `ref-${i}`, sequence: EXACT_READ });
    }
    for (let i = 0; i < altCount; i++) {
      reads.push({ id: `alt-${i}`, sequence: altRead });
    }
    return reads;
  }

  it('calls an SNV at the expected position with depth and allele frequency', () => {
    const reads = buildReads(5, 5);
    const mappingResult = mapReads(REFERENCE, reads, { k: 7 });
    expect(mappingResult.unmapped).toBe(0);

    const calls = callVariants(REFERENCE, mappingResult.mappings, reads, {
      minDepth: 5,
      minAlleleFrequency: 0.25
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.position).toBe(VARIANT_POSITION);
    expect(call.ref).toBe(REF_BASE);
    expect(call.alt).toBe(ALT_BASE);
    expect(call.depth).toBe(10);
    expect(call.altCount).toBe(5);
    expect(call.alleleFrequency).toBeCloseTo(0.5, 10);
    // Every alt read maps to the forward strand, so the bias is maximal.
    expect(call.strandBias).toBeCloseTo(1, 10);
  });

  it('counts alt alleles from both strands without orientation bias', () => {
    const altRead = mutateBase(EXACT_READ, 10, ALT_BASE);
    const reads: FastqRead[] = [
      { id: 'ref-fwd', sequence: EXACT_READ },
      { id: 'ref-rev', sequence: reverseComplement(EXACT_READ) },
      { id: 'alt-fwd', sequence: altRead },
      { id: 'alt-rev', sequence: reverseComplement(altRead) }
    ];

    const mappingResult = mapReads(REFERENCE, reads, { k: 7 });
    expect(mappingResult.unmapped).toBe(0);

    const calls = callVariants(REFERENCE, mappingResult.mappings, reads, {
      minDepth: 4,
      minAlleleFrequency: 0.4
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].altCount).toBe(2);
    expect(calls[0].depth).toBe(4);
    expect(calls[0].alleleFrequency).toBeCloseTo(0.5, 10);
    expect(calls[0].strandBias).toBeCloseTo(0, 10);
  });

  it('filters calls below the minimum depth', () => {
    const reads = buildReads(2, 0);
    const mappingResult = mapReads(REFERENCE, reads, { k: 7 });

    const calls = callVariants(REFERENCE, mappingResult.mappings, reads, {
      minDepth: 3
    });

    expect(calls).toHaveLength(0);
  });

  it('filters calls below the minimum allele frequency', () => {
    const reads = buildReads(1, 9);
    const mappingResult = mapReads(REFERENCE, reads, { k: 7 });

    const calls = callVariants(REFERENCE, mappingResult.mappings, reads, {
      minDepth: 5,
      minAlleleFrequency: 0.2
    });

    expect(calls).toHaveLength(0);
  });
});

describe('extractReadsFromFastq', () => {
  it('parses strict four-line FASTQ records', () => {
    const fastq = [
      '@read1 some description',
      'ACGTACGT',
      '+',
      'IIIIIIII',
      '@read2',
      'TTTTGGGG',
      '+read2',
      '!!!!####'
    ].join('\n');

    expect(extractReadsFromFastq(fastq)).toEqual([
      { id: 'read1', sequence: 'ACGTACGT' },
      { id: 'read2', sequence: 'TTTTGGGG' }
    ]);
  });

  it('handles CRLF line endings and skips malformed records', () => {
    const fastq =
      '@keep\r\nACGTACGT\r\n+\r\nIIIIIIII\r\n' +
      'not-a-header\r\nACGT\r\n+\r\nIIII\r\n' +
      '@keep2\r\nTTTT\r\nnot-a-plus\r\nIIII\r\n';

    expect(extractReadsFromFastq(fastq)).toEqual([
      { id: 'keep', sequence: 'ACGTACGT' }
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(extractReadsFromFastq('')).toEqual([]);
  });
});
