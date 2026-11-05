// Parsing and validation for structured blocks emitted by the Co-Pilot.
//
// The model is asked for fenced ```json mutation arrays and ```dna sequences.
// These helpers are deliberately strict: a model reply is untrusted input, and
// an invalid block must never reach an editor callback.

export interface MutationSuggestion {
  pos: number;
  from: string;
  to: string;
  score?: number;
}

const AMINO_ACIDS = new Set('ACDEFGHIKLMNPQRSTVWY');
const DNA_IUPAC = /^[ACGTUNRYSWKMBDHV]+$/;
const FENCE = /```([a-zA-Z0-9_-]*)\s*\n?([\s\S]*?)```/g;

function fencedBlocks(text: string, language: string): string[] {
  const out: string[] = [];
  for (const match of String(text ?? '').matchAll(FENCE)) {
    const tag = (match[1] || '').toLowerCase();
    if (tag === language) out.push(match[2].trim());
  }
  return out;
}

function finiteScore(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Collect mutation arrays from every ```json block. Invalid rows are
 *  discarded here; `validateMutations` reports why. */
export function parseMutationBlocks(text: string): MutationSuggestion[] {
  const out: MutationSuggestion[] = [];
  for (const block of fencedBlocks(text, 'json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { mutations?: unknown })?.mutations)
        ? (parsed as { mutations: unknown[] }).mutations
        : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const pos = Number(record.pos);
      const from = typeof record.from === 'string' ? record.from.trim().toUpperCase() : '';
      const to = typeof record.to === 'string' ? record.to.trim().toUpperCase() : '';
      if (!Number.isInteger(pos) || pos < 1 || !from || !to) continue;
      out.push({ pos, from, to, score: finiteScore(record.score) });
    }
  }
  return out;
}

/** Return the first non-empty ```dna block, whitespace-stripped and uppercased. */
export function parseDnaBlocks(text: string): string | null {
  for (const block of fencedBlocks(text, 'dna')) {
    const sequence = block.replace(/[\s\n\r\t]/g, '').toUpperCase();
    if (sequence) return sequence;
  }
  return null;
}

/** Validate mutation suggestions against the active sequence. Rows whose
 *  wild-type residue does not match the sequence are rejected rather than
 *  silently applied to the wrong position. */
export function validateMutations(
  rows: unknown,
  sequence?: string,
): { valid: MutationSuggestion[]; errors: string[] } {
  const valid: MutationSuggestion[] = [];
  const errors: string[] = [];
  const list = Array.isArray(rows) ? rows : [];
  const seq = (sequence ?? '').toUpperCase();

  for (const row of list) {
    if (!row || typeof row !== 'object') {
      errors.push('mutation row is not an object');
      continue;
    }
    const record = row as Record<string, unknown>;
    const pos = Number(record.pos);
    const from = typeof record.from === 'string' ? record.from.trim().toUpperCase() : '';
    const to = typeof record.to === 'string' ? record.to.trim().toUpperCase() : '';
    if (!Number.isInteger(pos) || pos < 1) {
      errors.push(`invalid position: ${String(record.pos)}`);
      continue;
    }
    if (!AMINO_ACIDS.has(from) || !AMINO_ACIDS.has(to)) {
      errors.push(`invalid residue at position ${pos}`);
      continue;
    }
    if (seq) {
      if (pos > seq.length) {
        errors.push(`position ${pos} is outside the ${seq.length}-residue sequence`);
        continue;
      }
      if (seq[pos - 1] !== from) {
        errors.push(`position ${pos} is ${seq[pos - 1]}, not ${from}`);
        continue;
      }
    }
    valid.push({ pos, from, to, score: finiteScore(record.score) });
  }

  return { valid, errors };
}

/** Normalize and validate a DNA sequence from the model. Supports IUPAC
 *  ambiguity codes because the editor does; rejects RNA-only and malformed
 *  strings instead of silently deleting characters. */
export function validateDnaSequence(raw: string): { sequence: string; error: string | null } {
  const sequence = String(raw ?? '').replace(/[\s\n\r\t]/g, '').toUpperCase();
  if (!sequence) return { sequence: '', error: 'empty sequence' };
  if (!DNA_IUPAC.test(sequence)) return { sequence: '', error: 'sequence contains non-DNA characters' };
  return { sequence, error: null };
}

/** Convert a validated 1-based mutation list to the protein page's 0-based
 *  cart coordinates without losing the original wild-type residue. */
export function toCartMutations(rows: MutationSuggestion[]): MutationSuggestion[] {
  return rows.map((row) => ({ ...row, pos: row.pos - 1 }));
}
