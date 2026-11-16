# Diagnostics

Diagnostics lists what is wrong or worth checking in the current document: structural errors, scientific observations about annotated coding sequences, and matches against the two local risk databases. It computes from the open snapshot and stores nothing in the file.

**Menu:** **Analysis & Views → Diagnostics** · **Type:** floating panel

## What it does

Every finding has a severity, a location, and a stable identity for the current document version. Structural problems that would corrupt the document are **blocking**. Biological observations are **warning** or **info**, because the editor does not decide biology for you. A Commec must-flag profile match is **blocking** until a person resolves it; an exact AMRFinderPlus entry is a warning, since a common lab marker must not stall export.

Findings are derived data. Editing the sequence or a feature recomputes them; closing the panel stops the calculation. Nothing is written to the `.spiceg`, and findings do not travel with the project.

## How to use

1. Open the panel from **Analysis & Views → Diagnostics**.
2. Read the coverage line: it names the catalog origin and the number of loaded records, or says that no catalog is loaded.
3. Click **Locate** on a finding to select its span or feature and switch to the matching tab.
4. If a finding offers a fix, click it. The fix is a typed edit, recorded as one undo step.
5. For a risk match, inspect the span and the catalog origin. Sequence export, SBOL export and SPD gene publishing stay refused while a blocking match is unresolved.

## Inputs and results

| Section | What it checks |
|---|---|
| Structural | Non-IUPAC bases, empty sequences, invalid topology, feature ranges outside the sequence, duplicate feature ids, unnamed features. A feature that crosses the origin of a circular document is stored with its start past its end and is not an error; the same range in a linear document is. |
| CDS | Length not a multiple of three, missing common start codon, internal stop codon, selected restriction sites inside the coding sequence. |
| Annotations | Duplicate feature names, with a rename fix; opposite-strand overlaps. |
| Sequence | GC outside 30–70% for sequences of at least 100 bp; homopolymer runs of eight or more bases. |
| AMR catalogue | Exact DNA matches in the NCBI AMRFinderPlus catalogue, searched on both strands and across the origin of circular documents. Entries the catalogue classes as virulence factors or stress-response genes are labelled as such, not as resistance markers. |
| Biorisk | Commec profile-HMM matches in six translated frames. A must-flag model is blocking; a virulence-factor model is a warning. |
| Coverage | AMR catalogue origin and record count; Commec version and model count, or that the database is not installed. |

| Severity | Meaning |
|---|---|
| Blocking | The document or plan is unsafe to accept as-is. |
| Warning | Worth checking before you rely on the construct. |
| Info | A property of the sequence, not a defect. |

## Limits and caveats

- The engine checks sequence and annotation consistency. It does not predict protein function, promoter strength, or whether a construct will work.
- Start-codon and internal-stop checks translate with the standard code. Alternative genetic codes and programmed readthrough are not modelled.
- Restriction-site checks use the enzymes currently selected in the editor. An unselected enzyme is not scanned.
- AMR screening is an exact catalogue search, not an identity search. A match does not prove a functional element, and a miss is not clearance. The bundled five-signature sample is a placeholder; sync AMRFinderPlus in **Settings → Gene Editor → Database syncs** for real coverage.
- Biorisk screening runs the Commec biorisk step only. Commec's taxonomy step needs the full NCBI nucleotide and protein databases and is not included. Sequences shorter than 50 bp are not screened; a scan of a typical plasmid takes well under a second once the 245 MB profile database is loaded. The sequence is screened as written, so a gene that crosses the origin of a circular document can be missed.
- The biorisk scan runs while this panel is open, after the sequence stops changing. Export and publish checks run their own scan. A scan that fails reports the error in the coverage line and yields no biorisk findings; that is not a clearance, and the export decision then rests on the results that were available.
- Short catalogue signatures are labelled as such. Confirm them manually.
- Neither database is regulatory clearance. Review any hit with your institution's biosafety process.
- The panel is a fixed-width floating window with internal scrolling.

## Related

- [Synthetic Biology CAD](synbio.md) — the same catalog matches, with copy-number and assembly checks.
- [Gene Editor](../../gene-editor.md)
- [Settings](../../settings.md)
