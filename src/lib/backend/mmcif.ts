// mmCIF export for SPICE fold results.
// Uses standard mmCIF fields (entity / entity_poly / entity_poly_seq / atom_site)
// plus a custom SPICE data block recording the adaptation environment,
// folding method and two-path confidence — "Folded by SPICE".
import { oneToThree } from './preprocess';

export interface MmcifMeta {
  title: string; // e.g. "SPICE folded structure"
  foldedBy: string; // "SPICE"
  method: string; // e.g. "SPICE Pre-train (Head A)"
  environment: string; // e.g. "pH=7.0;T=310K;ionic=0.15M"
  confidenceA?: number;
  confidenceB?: number;
}

function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildMmcif(seq: string, coords: number[], meta: MmcifMeta): string {
  const clean = seq.replace(/[^A-Za-z]/g, '').toUpperCase();
  const L = Math.min(clean.length, Math.floor(coords.length / 3));
  const res3 = (i: number) => oneToThree(clean[i] ?? 'X');

  const out: string[] = [];
  out.push(`#\ndata_SPICE\n#`);
  out.push(`_spice.folded_by    ${q(meta.foldedBy)}`);
  out.push(`_spice.method       ${q(meta.method)}`);
  out.push(`_spice.environment  ${q(meta.environment)}`);
  out.push(`_spice.length       ${L}`);
  if (meta.confidenceA !== undefined) out.push(`_spice.confidence_path_a ${meta.confidenceA.toFixed(4)}`);
  if (meta.confidenceB !== undefined) out.push(`_spice.confidence_path_b ${meta.confidenceB.toFixed(4)}`);
  out.push('#');

  out.push(`data_structure\n#`);
  out.push(`_entry.id        'spice_fold'`);
  out.push(`_struct.title    ${q(meta.title)}`);
  out.push(`_struct.entry_id 'spice_fold'`);
  out.push(`_struct_keywords.pdbx_keywords 'protein folding'`);
  out.push('#');

  out.push(`loop_\n_entity.id\n_entity.type\n_entity.pdbx_description`);
  out.push(`1 'polypeptide(L)' ${q(meta.title)}`);
  out.push('#');

  out.push(`loop_\n_entity_poly.entity_id\n_entity_poly.type\n_entity_poly.nstd_linkage`);
  out.push(`1 'polypeptide(L)' no`);
  out.push('#');

  out.push(`loop_\n_entity_poly_seq.entity_id\n_entity_poly_seq.num\n_entity_poly_seq.mon_id`);
  for (let i = 0; i < L; i++) out.push(`1 ${i + 1} ${res3(i)}`);
  out.push('#');

  out.push(`loop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.occupancy\n_atom_site.B_iso_or_equiv`);
  for (let i = 0; i < L; i++) {
    const x = coords[i * 3] ?? 0;
    const y = coords[i * 3 + 1] ?? 0;
    const z = coords[i * 3 + 2] ?? 0;
    out.push(
      `ATOM ${i + 1} C CA ${res3(i)} A ${i + 1} ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)} 1.00 0.00`
    );
  }
  out.push('#');
  out.push('end');
  return out.join('\n');
}
