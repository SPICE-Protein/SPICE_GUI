# SPICE GUI: Laboratory Guide Overview

**Applies to:** SPICE GUI v0.0.9 (Windows, macOS, Linux; Android build available)

**Audience:** bench scientists, lab managers, and students who need to design constructs, record experiments, analyse gels and blots, and assemble figures without sending data to a server.

This page is the map. Each workspace has a detailed manual; start here, then follow the page for the work you are doing.

> **Local-first.** Sequences, images, projects, and results stay on your computer. Nothing is uploaded unless you explicitly publish to SPD, query an online database, or point the AI Co-Pilot at a remote endpoint.

> **Model status.** The SPICE protein model is still under development. Fold, mutation, and MD results are exploratory and not publication-ready. The GelGenie image model is a separate, released model for gel and western-blot segmentation.

## 1. Documentation map

| You want to… | Read |
|---|---|
| Install, choose a language, set up models, do a first session | [Getting started](getting-started.md) |
| Learn every Gene Editor menu, panel, and design workflow | [Gene Editor](gene-editor.md) |
| Fold, import, simulate, scan, or mutate a protein | [Protein Workstation](protein-workstation.md) |
| Archive documents, write a journal, sign an ELN, use Presenter | [Project Hub](project-hub.md) |
| Quantify gels, blots, qPCR, plates, colonies, microscopy, trees, figures | [Bench tools](tools/README.md) |
| Configure language, theme, models, SPD, ORCID, databases, keys | [Settings](settings.md) |
| Use the optional assistant and its approval model | [AI Co-Pilot](ai-copilot.md) |
| Understand what leaves the machine and how to back up | [Data and safety](data-and-safety.md) |
| Fix a specific problem | [Troubleshooting](troubleshooting.md) |

The bench-tool pages are listed individually in [Bench tools](tools/README.md): [Gel](tools/gel.md), [Western blot](tools/blot.md), [qPCR](tools/qpcr.md), [Plate layout](tools/plate.md), [Colony counter](tools/colony.md), [Image annotator](tools/annotate.md), [Phylogenetic tree](tools/tree.md), and [Figure Studio](tools/figure.md).

## 2. What each workspace is for

| Workspace | What it does | Detailed manual |
|---|---|---|
| **Gene Editor** | Maps, sequence editing, features, restriction digests, primers, PCR, cloning, CRISPR, codon usage, QC, ELN pages. | [Gene Editor](gene-editor.md) |
| **Protein Workstation** | Fold, import PDB/mmCIF, short MD verification, stability scans, pocket analysis, mutation design, high-throughput screening. | [Protein Workstation](protein-workstation.md) |
| **Project Hub** | One `.spiceproj` file with embedded gene, protein, and tool documents, journal pages, attachments, and presenter slides. | [Project Hub](project-hub.md) |
| **Tools** | Eight focused bench editors for images, plates, counts, trees, and figures. | [Bench tools](tools/README.md) |
| **Settings** | Language, theme, models, databases, ORCID, SPD, keymap, engine defaults. | [Settings](settings.md) |
| **AI Co-Pilot** | Optional chat with workspace context, structured imports, and approval-gated tools. | [AI Co-Pilot](ai-copilot.md) |

A typical experiment moves through four stages: design in the Gene Editor, record in the Project Hub, measure in Tools, and assemble the figure.

## 3. Two storage modes

**Standalone.** Open a tool from the Tools hub and use its own **Save project** or JSON export. Good for a quick check. Not connected to a study.

**Project.** Create or open a `.spiceproj` in the Project Hub and open documents from there. The project embeds the documents, journal pages, and attachments. Use this for anything that must be archived, shared, or defended.

A project is a single file. Copying it to lab storage is the primary backup. Local snapshots and the Known Projects registry are convenience features, not portable records.

## 4. Choose a learning path

### 4.1 New user: first hour

1. Install the current release and set **Settings → General Settings → Interface Language**.
2. Download the GelGenie model if you plan to analyse images.
3. Create a project in the Project Hub.
4. Open a GenBank or FASTA file in the Gene Editor and inspect the map, features, and enzymes.
5. Import one real gel and one real blot in Tools; run the classical detector, then compare with **AI detect (GelGenie)**.
6. Capture the tool results into the project and write a journal page.
7. Save the `.spiceproj`.

The full sequence is in [Getting started](getting-started.md).

### 4.2 Molecular cloning path

1. [Gene Editor §2–§8](gene-editor.md): import, maps, editing, features, restriction enzymes.
2. [Gene Editor §9–§12](gene-editor.md): primers, PCR simulation, cloning wizard, Golden Gate, CRISPR.
3. [Gene Editor §14](gene-editor.md): codon optimisation and synthetic gene QC.
4. [Gene Editor §15](gene-editor.md): history, undo, autosave, and what is not undoable.
5. [Project Hub](project-hub.md): archive the construct and sign the ELN page.

### 4.3 Protein path

1. [Protein Workstation](protein-workstation.md): interface, folding, import, MD.
2. Pocket, phase scan, mutation, and high-throughput screening sections.
3. [Settings §2](settings.md): model path and output heads.
4. [Data and safety](data-and-safety.md): model files and SPD publishing.

### 4.4 Bench analysis and figures path

1. [Bench tools](tools/README.md): shared workflow, autosave, repro bundles, batch limits.
2. The specific tool: [gel](tools/gel.md), [blot](tools/blot.md), [qPCR](tools/qpcr.md), [plate](tools/plate.md), [colony](tools/colony.md), [annotate](tools/annotate.md), [tree](tools/tree.md).
3. [Figure Studio](tools/figure.md) for the multi-panel figure.
4. [Project Hub §11](project-hub.md) for the backup checklist.

### 4.5 Lab manager or PI path

1. [Project Hub](project-hub.md): project structure, journal, Presenter, ELN signing, backup checklist.
2. [Data and safety](data-and-safety.md): where data lives, what leaves the machine, retention.
3. [Settings §8](settings.md): credential storage and shared-workstation notes.
4. [Troubleshooting](troubleshooting.md): the failure modes to expect.

## 5. Before you trust a result

These apply across every tool.

- **Keep the original.** Preserve the uncropped, unmodified image and the raw instrument export. Analysis exports are derived data.
- **Check saturation and dynamic range.** A saturated band, a clipped image, or a confluent plate cannot support a quantitative claim.
- **Review automatic detection.** No detector is trusted blindly. Correct lanes, bands, colonies, and panels, and record what you changed.
- **State n and the test.** Biological replicates are not technical replicates. Name the statistical test and what the error bars represent.
- **State the normalization.** Loading control, total protein, or none. Do not switch between compared groups.
- **Follow image-integrity rules.** Do not selectively erase, clone, move, or enhance individual bands.
- **Verify predictions.** CRISPR guides, codon designs, folds, and detector outputs are drafts until checked experimentally or against primary sources.

## 6. File formats

| Extension | What it is |
|---|---|
| `.spiceproj` | Project container: metadata, embedded documents, journal pages, attachments. |
| `.spiceg` | Gene document: sequence, features, enzymes, selection notes, notebook pages. |
| `.spicep` | Protein package: sequence, environment, coordinates, simulation history, metrics. |
| `.json` | Tool project or import/export payload. |
| `.csv`, `.tsv` | Results, sample sheets, plate maps, marker tables, trees metadata. |
| `.svg`, `.png`, `.tiff`, `.pdf`, `.pptx` | Figure and presentation exports. |
| `.zip` | Reproducibility bundle or batch output. |
| `.nwk`, `.newick` | Phylogenetic tree input and export. |

## 7. Keyboard and language

The interface is available in Simplified Chinese, English, Japanese, Korean, German, Dutch, and Swedish. Screenshots use English; labels in these manuals match the English UI.

Gene Editor shortcuts are editable in **Settings → Keymap Settings**. `Mod` means Command on macOS and Ctrl elsewhere. A few shortcuts are workspace-specific; each manual lists the ones that matter for that workspace.

## 8. Where to get help

- [Troubleshooting](troubleshooting.md) for models, detection, exports, projects, ELN, SPD, and AI.
- [Data and safety](data-and-safety.md) for privacy, credentials, and backups.
- The [releases page](https://github.com/SPICE-Protein/SPICE_GUI/releases) for installers and release notes.
- The [project README](../README.md) for architecture and development setup.

When reporting a problem, include the app version, platform, menu path, input type and size, the exact error text, and whether the example data reproduces it. Do not attach confidential sequences or unpublished images to a public issue.
