# Panel Reference

Every panel in the Gene Editor and Protein Workstation has its own page: what it computes, which inputs it takes, where the result goes, and what it refuses to do. The pages are grouped by the menu that opens them.

Each page states the exact menu path. A panel is a floating window unless the page says otherwise; floating windows can be dragged by their header and closed with `[X]`.

## Gene Editor

### File

| Panel | Opens from |
|---|---|
| [Ensembl import](gene/ensembl.md) | **File → Import from Ensembl...** |
| [NCBI import](gene/ncbi.md) | **File → Import from NCBI...** |
| [UniProt import](gene/uniprot.md) | **File → Import from UniProt...** |
| [External BLAST](gene/blast.md) | **File → External BLAST…** |
| [SPD Gene Library](gene/spd.md) | **File → SPD Gene Library** |
| [Project Collections](gene/collections.md) | **File → Project Collections...** |
| [Export Current Sequence](gene/export.md) | **File → Export Current Sequence...** |

### Edit

| Panel | Opens from |
|---|---|
| [Feature Editor](gene/feature-editor.md) | **Edit → Add Feature...** |
| [Auto-Annotate](gene/auto-annotate.md) | **Edit → Auto-Annotate** |
| [Sequence Search](gene/search.md) | **Edit → Sequence Search** |

### Cloning & Design

| Panel | Opens from |
|---|---|
| [Restriction Enzymes](gene/enzymes.md) | **Cloning & Design → Restriction Enzymes** |
| [Codon Optimization](gene/codon.md) | **Cloning & Design → Codon Optimization** |
| [PCR Primer Table](gene/primer-table.md) | **Cloning & Design → PCR Primer Table** |
| [PCR Simulator](gene/pcr.md) | **Cloning & Design → PCR Simulator** |
| [Agarose Gel Simulation](gene/gel.md) | **Cloning & Design → Agarose Gel Simulation** |
| [Cloning Simulation Wizard](gene/cloning-wizard.md) | **Cloning & Design → Cloning Simulation Wizard...** |
| [Expression Cassette Builder](gene/expression-cassette.md) | **Cloning & Design → Expression cassette builder** |
| [Vector Template Assembly](gene/vector-template.md) | **Cloning & Design → Vector template assembly** |
| [CRISPR Design Cabin](gene/crispr.md) | **Cloning & Design → CRISPR Design Cabin** |
| [Reaction Calculators](gene/calculators.md) | **Cloning & Design → Reaction Calculators** |
| [Synthetic Gene Designer QC](gene/qc.md) | **Cloning & Design → Synthetic Gene Designer QC** |
| [NGS & Genomics Engine](gene/ngs.md) | **Cloning & Design → NGS & Genomics Engine** |
| [Advanced Cloning & Markers](gene/cloning-extension.md) | **Cloning & Design → Advanced Cloning & Markers** |
| [Co-Design Panel](gene/codesign.md) | **Cloning & Design → Co-Design Panel** |
| [Lua Scripts](gene/scripts.md) | **Cloning & Design → Lua Scripts** |
| [Anneal Oligos](gene/anneal.md) | **Cloning & Design → Anneal Oligos** |
| [Silent Mutagenesis](gene/silent-mut.md) | **Cloning & Design → Silent Mutagenesis** |
| [Reverse Translate](gene/reverse-translate.md) | **Cloning & Design → Reverse Translate** |
| [Primer Modifier](gene/primer-modifier.md) | **Cloning & Design → Primer Modifier** |
| [DNA End Modification](gene/end-mod.md) | **Cloning & Design → DNA End Modification** |
| [Fusion Frame Check](gene/fusion-check.md) | **Cloning & Design → Fusion Frame Check** |
| [Ribosomal Slippage](gene/slippage.md) | **Cloning & Design → Ribosomal Slippage** |

### Analysis & Views

| Panel | Opens from |
|---|---|
| [Protein Multi-View](gene/protein-view.md) | **Analysis & Views → Protein Multi-View** |
| [RNA Folding Structure](gene/rna.md) | **Analysis & Views → RNA Folding Structure** |
| [Sanger Trace Viewer](gene/sanger-trace.md) | **Analysis & Views → Sanger Trace Viewer** |
| [Sanger Clone Validator](gene/sanger-validator.md) | **Analysis & Views → Sanger Clone Validator** |
| [Advanced Genomics Tools](gene/genomics.md) | **Analysis & Views → Advanced Genomics Tools** |
| [Synthetic Biology CAD](gene/synbio.md) | **Analysis & Views → Synthetic Biology CAD** |
| [Diagnostics](gene/diagnostics.md) | **Analysis & Views → Diagnostics** |
| [Sequence BLAST & Evolution](gene/blast-evolution.md) | **Analysis & Views → Sequence BLAST & Evolution** |
| [Sequence Alignment](gene/alignment.md) | **Analysis & Views → Sequence Alignment** |
| [GC Sliding Window](gene/gc-window.md) | **Analysis & Views → GC Sliding Window** |

### Window

| Panel | Opens from |
|---|---|
| [Edit History Tree](gene/history.md) | **Window → Edit History Tree** |
| [Activity Log](gene/logger.md) | **Window → Activity Log** |
| [Customize Settings](gene/settings.md) | **Window → Customize Settings** |

## Protein Workstation

The right-hand pane switches between five work panes; each has a page.

| Pane | Opens from |
|---|---|
| [Structure Folding Panel](protein/folding.md) | **Window → Structure Folding Panel** |
| [Dynamics Trajectory Panel](protein/md.md) | **Window → Dynamics Trajectory Panel** |
| [Environmental Phase Panel](protein/phase.md) | **Window → Environmental Phase Panel** |
| [Mutation Analysis Panel](protein/mutation.md) | **Window → Mutation Analysis Panel** |
| [Batch Design Screening Panel](protein/batch.md) | **Window → Batch Design Screening Panel** |

## See also

- [Gene Editor](../gene-editor.md) — the workspace these panels belong to.
- [Protein Workstation](../protein-workstation.md) — folding, simulation, and mutation context.
- [Lua Scripting](../scripting.md) — scripted access to the same document state.
