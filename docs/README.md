# SPICE GUI Documentation

SPICE GUI is a local-first desktop workbench for gene editing, protein work, and bench analysis. This documentation is a task-oriented manual: each page explains the interface, the workflow, the exports, and the limits.

**Version:** matches SPICE GUI v0.0.9. The interface is available in Simplified Chinese, English, Japanese, Korean, German, Dutch, and Swedish. Screenshots use English, and labels in the manual match the English UI.

## Start here

- [Laboratory guide overview](lab-guide.md) — the map of the documentation, learning paths by role, and the principles that apply across tools.
- [Getting started](getting-started.md) — install, first launch, language and theme, models, storage modes, and a first 15-minute session.

## Workspaces

- [Gene Editor](gene-editor.md) — maps, sequence editing, features, restriction enzymes, primers, PCR, cloning, CRISPR, analysis panels, QC, history, and ELN notes.
- [Protein Workstation](protein-workstation.md) — folding, structure import, MD verification, pockets, phase scans, mutation design, high-throughput screening, and export.
- [Project Hub](project-hub.md) — projects, embedded documents, journal pages, Presenter, ELN signing, attachments, and backups.
- [AI Co-Pilot](ai-copilot.md) — endpoint setup, context, structured imports, tools, agent mode, MCP, and audit.
- [Settings](settings.md) — language, theme, models, SPD, ORCID, database syncs, keymap, and save semantics.

## Bench tools

- [Bench tools overview](tools/README.md) — shared workflow, project mode, autosave, reproducibility bundles, batch limits, and GelGenie.
- [Gel figure tool](tools/gel.md)
- [Western blot densitometry](tools/blot.md)
- [qPCR analysis](tools/qpcr.md)
- [Plate layout designer](tools/plate.md)
- [Colony counter](tools/colony.md)
- [Image annotator](tools/annotate.md)
- [Phylogenetic tree tool](tools/tree.md)
- [Figure Studio](tools/figure.md)

## Reference

- [Data and safety](data-and-safety.md) — where data lives, what leaves the machine, credentials, ELN signature limits, and backups.
- [Troubleshooting](troubleshooting.md) — models, detection, exports, projects, ELN, SPD, AI, performance, and reporting a problem.
- [Project README](../README.md) — architecture, development, and build instructions.
- [Latest release and installers](https://github.com/SPICE-Protein/SPICE_GUI/releases)

## Conventions

- Menu paths are written as **File → Open Sequence File...**.
- Labels in bold match the English interface.
- `Mod` means Command on macOS and Ctrl on Windows and Linux.
- File paths and filenames are illustrative unless stated otherwise.
- "Current build" marks behaviour that is implemented but may change in a later release.
