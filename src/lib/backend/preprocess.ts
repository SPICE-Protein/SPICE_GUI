// Preprocessing helpers that mirror the Python pipeline (`spice_pre/data/preprocessing.py`)
// and the ONNX contract in `model/docs/ONNX_USAGE.md`.

import { ONE_TO_THREE } from './types';
import * as m from '$lib/paraglide/messages.js';

/** AA order used by the tokenizer (1..20). Anything else -> 21 (unknown). */
const AA = 'ACDEFGHIKLMNPQRSTVWY';

/** Tokenize a 1-letter sequence. */
export function seqToTokens(seq: string): Int32Array {
  const out = new Int32Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    const idx = AA.indexOf(seq[i]);
    out[i] = idx >= 0 ? idx + 1 : 21;
  }
  return out;
}

/** Normalize raw env to ~[0,1]³ — must match `normalize_env` in Python. */
export function normalizeEnv(ph: number, tempK: number, ionicM: number): [number, number, number] {
  const p = clamp((ph - 0) / (14 - 0), 0, 1);
  const t = clamp((tempK - 150) / (400 - 150), 0, 1);
  const ionic = clamp(ionicM, 1e-3, 1.0);
  const i = clamp(Math.log10(ionic) / Math.log10(1e3), 0, 1);
  return [p, t, i];
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** 3-letter residue from a 1-letter amino acid. */
export function oneToThree(c: string): string {
  return ONE_TO_THREE[c] ?? 'UNK';
}

const THREE_TO_ONE: Record<string, string> = Object.fromEntries(
  Object.entries(ONE_TO_THREE).map(([k, v]) => [v, k])
);

/** Extract the 1-letter chain-A sequence from a PDB or mmCIF text (best-effort). */
export function seqFromPdb(text: string): string {
  const seen = new Map<string, string>();
  const order: string[] = [];
  
  const isCif = text.includes('_atom_site.');
  
  if (isCif) {
    // Robust mmCIF sequence parser
    let inAtomSiteLoop = false;
    let headers: string[] = [];
    
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      if (trimmed.startsWith('loop_')) {
        inAtomSiteLoop = false;
        headers = [];
        continue;
      }
      
      if (trimmed.startsWith('_atom_site.')) {
        inAtomSiteLoop = true;
        headers.push(trimmed);
        continue;
      }
      
      if (inAtomSiteLoop) {
        if (trimmed.startsWith('#') || trimmed.startsWith('_') || trimmed.startsWith('loop_')) {
          inAtomSiteLoop = false;
          continue;
        }
        
        const parts = trimmed.split(/\s+/);
        if (parts.length < headers.length) continue;
        
        const groupIdx = headers.indexOf('_atom_site.group_PDB');
        const atomIdIdx = headers.indexOf('_atom_site.label_atom_id');
        const compIdx = headers.indexOf('_atom_site.label_comp_id');
        const asymIdx = headers.indexOf('_atom_site.label_asym_id');
        const seqIdIdx = headers.indexOf('_atom_site.label_seq_id');
        const altIdIdx = headers.indexOf('_atom_site.label_alt_id');
        
        if (groupIdx === -1 || atomIdIdx === -1 || compIdx === -1 || asymIdx === -1 || seqIdIdx === -1) {
          continue;
        }
        
        const group = parts[groupIdx];
        const atomId = parts[atomIdIdx];
        const altId = altIdIdx !== -1 ? parts[altIdIdx] : '.';
        const compId = parts[compIdx];
        const asymId = parts[asymIdx];
        const seqId = parts[seqIdIdx];
        
        if (group !== 'ATOM' || atomId !== 'CA') continue;
        if (asymId !== 'A') continue; // typically chain A
        if (altId !== '.' && altId !== 'A') continue;
        
        const key = seqId;
        if (seen.has(key)) continue;
        
        const one = THREE_TO_ONE[compId] ?? 'X';
        seen.set(key, one);
        order.push(key);
      }
    }
  } else {
    // Standard PDB parser
    for (const line of text.split('\n')) {
      if (!line.startsWith('ATOM  ')) continue;
      if (line.length < 27) continue;
      const resSeq = line.slice(22, 26).trim();
      const key = resSeq;
      if (seen.has(key)) continue;
      const resName = line.slice(17, 20).trim();
      const one = THREE_TO_ONE[resName] ?? 'X';
      seen.set(key, one);
      order.push(key);
    }
  }
  return order.map((k) => seen.get(k)).join('');
}

export function validateSeq(seq: string): string | null {
  const trimmed = seq.replace(/\s+/g, '');
  if (!trimmed) return m.seqValidateEmpty();
  if (trimmed.length > 1024) return m.seqValidateTooLong({ len: trimmed.length });
  for (const c of trimmed) {
    if (!AA.includes(c) && c !== 'U') return m.seqValidateNonStandardAa({ char: c });
  }
  return null;
}

/** Clean a sequence: strip whitespace/digits, uppercase. */
export function cleanSeq(seq: string): string {
  return seq.replace(/[^A-Za-z]/g, '').toUpperCase();
}

/**
 * Generate a minimal PDB text from a Cα trace + sequence for Mol* rendering.
 * Only CA atoms + SEQRES are emitted; Mol* builds the polymer from CA.
 * Uses exact PDB fixed-column layout (78 columns).
 */
export function pdbFromCoords(seq: string, coords: number[]): string {
  const l = Math.min(seq.length, Math.floor(coords.length / 3));
  const lines: string[] = [];
  const clean = cleanSeq(seq).slice(0, l);
  // SEQRES
  for (let s = 0; s < clean.length; s += 17) {
    const chunk = clean.slice(s, s + 17);
    const res = chunk.split('').map((c) => oneToThree(c).padStart(3, ' ')).join(' ');
    lines.push(`SEQRES ${Math.floor(s / 17) + 1} A ${clean.length} ${res}`);
  }
  for (let i = 0; i < l; i++) {
    lines.push(pdbAtomLine(i + 1, 'CA', oneToThree(clean[i]), 'A', i + 1,
      coords[i * 3], coords[i * 3 + 1], coords[i * 3 + 2], 1.0, 'C'));
  }
  lines.push('TER');
  lines.push('END');
  return lines.join('\n');
}

/** Fixed-column PDB ATOM record (78 columns). */
function pdbAtomLine(
  serial: number, atomName: string, resName: string, chain: string,
  resSeq: number, x: number, y: number, z: number, occ: number, elem: string
): string {
  let s = 'ATOM  ';
  s += String(serial).padStart(5);
  s += ' ';
  s += atomName.padEnd(4); // cols 12-15
  s += ' '; // col 16 altLoc
  s += resName.padStart(3); // cols 17-19
  s += ' ';
  s += chain; // col 21
  s += String(resSeq).padStart(4); // cols 22-25
  s += ' '; // col 26 iCode
  s += '   '; // cols 27-29
  s += x.toFixed(3).padStart(8); // cols 30-37
  s += y.toFixed(3).padStart(8); // cols 38-45
  s += z.toFixed(3).padStart(8); // cols 46-53
  s += occ.toFixed(2).padStart(6); // cols 54-59
  s += '  0.00'; // tempFactor cols 60-65
  s += '          '; // cols 66-75
  s += elem.padStart(2); // cols 76-77
  return s;
}

/** Standard α-helix example sequence (~20 aa) used as a demo input. */
export const EXAMPLE_SEQS: { id: string; label: string; seq: string }[] = [
  {
    id: 'mini',
    label: m.exampleLabelMiniHelix(),
    seq: 'AAAAKAAAAKAAAAKAAAAK',
  },
  {
    id: 'lysozyme',
    label: m.exampleLabelLysozyme(),
    seq:
      'KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL',
  },
  {
    id: 'ubiquitin',
    label: m.exampleLabelUbiquitin(),
    seq: 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG',
  },
  {
    id: 'green',
    label: m.exampleLabelGfp(),
    seq:
      'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK',
  },
];
