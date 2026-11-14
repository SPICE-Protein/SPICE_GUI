// Shared types for external BLAST searches (NCBI BLAST URL API and the EBI
// Job Dispatcher NCBI BLAST service backed by UniProt databases).

export type BlastProvider = 'ncbi' | 'ebi';
export type BlastProgram = 'blastn' | 'blastp';

export interface BlastSearchRequest {
  provider: BlastProvider;
  program: BlastProgram;
  database: string;
  sequence: string;
  /** Expectation-value threshold. */
  expect?: number;
  maxHits?: number;
  /** Required by EBI; optional for NCBI (used only for job notices). */
  email?: string;
}

export interface BlastHsp {
  bitScore: number;
  score: number;
  evalue: number;
  /** Percent identity over the alignment, 0-100. */
  identity: number;
  alignLen: number;
  gaps: number;
  queryFrom: number;
  queryTo: number;
  hitFrom: number;
  hitTo: number;
  queryStrand: string;
  hitStrand: string;
  qseq: string;
  hseq: string;
  midline: string;
}

export interface BlastHit {
  /** Accession usable for a follow-up fetch. */
  accession: string;
  /** Provider-specific identifier (GI, UniProt entry name, ...). */
  id: string;
  title: string;
  organism: string;
  length: number;
  hsps: BlastHsp[];
}

export interface BlastResult {
  provider: BlastProvider;
  program: BlastProgram;
  database: string;
  queryLength: number;
  hits: BlastHit[];
}

export interface BlastProgress {
  phase: 'submitting' | 'waiting' | 'fetching';
  /** Provider run identifier (NCBI RID or EBI job id) once known. */
  jobId?: string;
  elapsedMs?: number;
}
