# E2E fixtures

Small real-world files used by the desktop E2E suite.

| File | Source | Purpose |
|---|---|---|
| `310.ab1` | [Biopython `Tests/Abi/310.ab1`](https://github.com/biopython/biopython/tree/master/Tests/Abi) (Biopython License Agreement / BSD-3-Clause) | Sanger trace import (`File → Import Sanger Trace`) |
| `1CRN.pdb` | [RCSB PDB 1CRN](https://www.rcsb.org/structure/1CRN) (public domain) | Protein structure import |
| `phix174.fasta` | [NCBI RefSeq NC_001422.1](https://www.ncbi.nlm.nih.gov/nuccore/NC_001422.1) (public domain) | Gene sequence import |
| `agarose_gel.jpg` | [Wikimedia Commons: Gel electrophoresis 2.jpg](https://commons.wikimedia.org/wiki/File:Gel_electrophoresis_2.jpg), Mnolf, CC BY-SA 3.0 | Real 6-track agarose gel; lane and band detection |
| `western_blot.jpg` | [Wikimedia Commons: Western blot (2).jpg](https://commons.wikimedia.org/wiki/File:Western_blot_(2).jpg), CC BY-SA 3.0 | Real Western blot; band auto-detection |
| `colonies.jpg` | [Wikimedia Commons: Agar plate with colonies square.jpg](https://commons.wikimedia.org/wiki/File:Agar_plate_with_colonies_square.jpg), public domain | Real colony plate; colony counting |

The Tauri embedded WebDriver does not implement `uploadFile`, so the tests
construct a `File` in the page from these bytes and dispatch the input's
`change` event. This still exercises the real parsers with real data.
