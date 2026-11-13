// SPD BioBrick parts: publish the current DNA as a reusable part, search the
// catalog, and load a part (plus its linked vector templates) into the gene
// workbench.
//
// Unlike a gene record, a BioBrick is a single short part: one sequence and a
// part type. The list endpoint is intentionally shallow (no sequence), so a
// load always performs a detail read.
import { configureSpdClient } from './store.svelte';
import type {
  SpdBiobrickInput, SpdBiobrickReceipt, SpdBiobrickRecord,
  SpdBiobrickSummary, SpdBiobrickVectorLink,
} from './types';

export const BIOBRICK_PART_TYPES = [
  'promoter', 'rbs', 'terminator', 'cds', 'protein_tag', 'regulatory', 'other',
] as const;

export type BiobrickPartType = (typeof BIOBRICK_PART_TYPES)[number];

export interface BiobrickWorkspaceInput {
  name: string;
  sequence: string;
  description?: string;
  partType?: string;
  metadata?: unknown;
  categories?: string[];
}

export interface LoadedSpdBiobrick {
  record: SpdBiobrickRecord;
  /** DNA-canvas form: RNA U is converted to T; other IUPAC ambiguity codes
   *  are preserved so coordinates stay true to the deposited part. */
  sequence: string;
  sourceMolecule: 'dna' | 'rna';
  vectors: SpdBiobrickVectorLink[];
}

/** Normalize exactly the way the server does before hashing: trim, uppercase,
 *  and drop whitespace. Do not drop ambiguity codes — the part coordinates
 *  belong to this exact string. */
export function normalizeBiobrickSequence(sequence: string): string {
  const normalized = String(sequence ?? '').replace(/[ \t\n\r\f\v]/g, '').toUpperCase();
  if (normalized.length < 4) throw new Error('biobrick sequence must be at least 4 nt');
  if (!/^[ACGTRYSWKMBDHVNU]+$/.test(normalized)) {
    throw new Error('biobrick sequence contains characters outside the IUPAC nucleotide alphabet');
  }
  return normalized;
}

export function isBiobrickPartType(value: string): value is BiobrickPartType {
  return (BIOBRICK_PART_TYPES as readonly string[]).includes(value);
}

/** Publish the current workspace sequence as a BioBrick part. The server
 *  rejects duplicate names and duplicate sequence hashes, so errors are
 *  surfaced verbatim instead of being retried. */
export async function publishBiobrick(input: BiobrickWorkspaceInput): Promise<SpdBiobrickReceipt> {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('biobrick name is required');
  const partType = isBiobrickPartType(input.partType ?? '') ? input.partType! : 'other';
  const sequence = normalizeBiobrickSequence(input.sequence);

  const body: SpdBiobrickInput = {
    name,
    partType,
    sequence,
    description: (input.description ?? '').trim() || undefined,
    metadata: input.metadata ?? { source: 'SPICE GUI', tool: 'gene workbench' },
    categories: input.categories?.length ? input.categories : undefined,
    origin: 'submission',
  };
  const receipt = await configureSpdClient().createBiobrick(body);
  if (!receipt?.id) throw new Error('SPD did not return a biobrick id');
  return receipt;
}

/** Load one part. `sourceMolecule` is `rna` when the deposited sequence uses
 *  U; the returned sequence is still converted to DNA for the canvas. */
export async function loadBiobrick(id: string): Promise<LoadedSpdBiobrick> {
  const detail = await configureSpdClient().getBiobrick(id);
  const record = detail.biobrick;
  const raw = String(record.sequence ?? '');
  const sourceMolecule: 'dna' | 'rna' = /U/i.test(raw) ? 'rna' : 'dna';
  return {
    record,
    sequence: normalizeBiobrickSequence(raw).replace(/U/g, 'T'),
    sourceMolecule,
    vectors: detail.vectors ?? [],
  };
}

export function biobrickRowLength(row: SpdBiobrickSummary): string {
  return typeof row.length === 'number' ? `${row.length} bp` : '';
}
