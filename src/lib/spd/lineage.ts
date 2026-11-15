// Sequence lineage helpers. SPD stores the declared mutation array verbatim
// and joins it to /sequences/{id}/mutation-map by 1-based position, so the GUI
// only has to produce that array when a new sequence descends from a previous
// publish of the same protein.
import type { SpdSequenceMutation } from './types';

/** Residue substitutions between two sequences of equal length, 1-based.
 *  SPD's mutation tree records substitutions; a length change (insertion or
 *  deletion) returns null so the caller publishes a plain record instead of
 *  claiming a parent relationship it cannot describe. */
export function substitutionDiff(parent: string, child: string): SpdSequenceMutation[] | null {
  const from = parent.toUpperCase();
  const to = child.toUpperCase();
  if (!from || !to || from.length !== to.length) return null;
  const mutations: SpdSequenceMutation[] = [];
  for (let index = 0; index < to.length; index += 1) {
    if (from[index] !== to[index]) {
      mutations.push({ position: index + 1, from: from[index], to: to[index] });
    }
  }
  return mutations;
}
