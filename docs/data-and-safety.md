# Data and Safety

SPICE GUI is local-first. Sequences, images, projects, and analysis results are files on your computer. There is no required account, no cloud sync, and no analytics service. This page describes what is stored where, what leaves the machine when you use optional features, and how to back work up.

## 1. Where your data lives

| Data | Where it is stored |
|---|---|
| Gene and protein documents | `.spiceg` / `.spicep` files, or embedded in a `.spiceproj`. |
| Projects, journal pages, attachments | The `.spiceproj` file. |
| Bench-tool documents | Tool JSON files, or embedded in a `.spiceproj`. |
| Settings, keymap, credentials | The WebView's local storage. |
| Autosave snapshots and the Known Projects registry | Local storage. |
| GelGenie model | The application data directory, for example `~/Library/Application Support/com.spice.gui/models/gelgenie_unet.onnx` on macOS. |
| SPICE protein checkpoint | A local path or the default model directory; never embedded in a project. |
| Exports | Wherever you save them. |

Local storage is per application install and per user profile. Clearing application data removes settings, snapshots, and the registry; it does not remove exported project files.

## 2. What leaves the machine

Most work is offline. The following features make network requests, and each sends only what that feature needs.

| Feature | Destination | What is sent |
|---|---|---|
| NCBI import | NCBI E-utilities | Gene symbol, accession, or search term. |
| Ensembl import | Ensembl REST | Gene name or Ensembl ID. |
| UniProt import | UniProt REST | Accession. |
| PDB / mmCIF import | RCSB, PDB-REDO | PDB ID or file request. |
| SPD health, publish, search | SPD (`d-api.spicebio.top`) | Token, and the record or query you submit. |
| SynBioHub search/import | SynBioHub | Search term. |
| ORCID profile | `pub.orcid.org` | ORCID iD. |
| REBASE / CARD / IGSC sync | The respective public sources | Standard download requests. |
| UniVec_Core sync | NCBI FTP | Standard download request. |
| GelGenie or SPICE model download | The configured URL | Standard download request, and a proxy if configured. |
| AI Co-Pilot | Your configured endpoint | The conversation and the workspace context you inject. |
| MCP servers | The configured server | The tool arguments the assistant sends. |

UniProt import and RCSB lookups are ordinary read-only requests. Publish operations are the main case where your own sequence or record is sent to a third party.

## 3. SPD publishing

SPD is optional. Publishing requires a Universal API Token created after ORCID login.

- The publish chain is `(protein | construct | variant) → sequence → fold`.
- A fold record includes its simulation environment and model identity; the checkpoint is hashed locally.
- Fold coordinates remain local; only summary records are published.
- Republishing the same record is idempotent.
- Publishing is desktop-only because the service's CORS policy excludes packaged apps; requests go through the native bridge.

Do not publish unpublished constructs, proprietary sequences, or anything your institution has not cleared. Once published, a record may be cached or indexed and cannot be assumed private even if later removed.

## 4. AI Co-Pilot and MCP

The Co-Pilot speaks to an OpenAI-compatible endpoint. The default configuration targets a local Ollama instance, in which case the conversation stays on the machine. A remote endpoint receives the conversation and any injected context under that provider's policy.

Context injection is explicit. Know what is attached before you send: a sequence, a protein environment, metrics, or an image. Sequences can be confidential; treat a remote assistant as an external service.

API keys, SPD tokens, MCP environment JSON, memory entries, and audit logs are stored unencrypted in local storage. The app does not provide a credential vault. On a shared workstation, clear credentials before handing it over.

Write actions proposed by the assistant are approval-gated. Approval applies to the specific action shown; it is not a blanket permission. See [AI Co-Pilot](ai-copilot.md) for the tool and audit model.

## 5. Electronic records

The ELN signing feature:

1. Locks the page.
2. Records the signer's ORCID identity, witness, reason, and timestamp.
3. Computes a SHA-256 digest over the page, sequence, and feature metadata.
4. Downloads a Markdown report with the audit trail and digest.
5. Saves the project.

The digest is unkeyed. It detects changes only if you retain the digest independently, for example in the downloaded report or a lab record system. It is not a private-key signature and is not a certification that your institution's 21 CFR Part 11 programme has been satisfied. Follow your local SOP for signatures, retention, and review.

A signed page cannot be edited or unsigned. Correct mistakes on a new page that references the signed one.

## 6. Project size and attachments

Attachments and embedded documents are stored inside the `.spiceproj`, so the file grows with them. Each attachment is limited to 20 MiB. Large imaging datasets should stay in the lab archive, with only the analysed export or a representative image attached.

A very large project can exceed local-storage quotas during autosave. The app warns when a quota is hit; the `.spiceproj` file remains authoritative. If autosave fails, save the project to disk and reduce attachments.

## 7. Backups and reproducibility

Use the same backup policy as raw instrument data.

1. Save the `.spiceproj` to lab-managed storage and back it up.
2. Keep original, uncropped images and raw instrument exports outside the project.
3. Export a reproducibility bundle for any analysis you may need to defend.
4. Copy or download model files separately when moving computers; models are not embedded.
5. Retain signed ELN Markdown reports with the digest.
6. Do not rely on autosave, local snapshots, or the Known Projects registry as a backup. They are local convenience features.

A reproducibility bundle typically contains the figure or result, data, project, parameters, methods, and a SHA-256 manifest. It records the analysis inputs, not the operating system, the instrument firmware, or the physical reagents. The lab notebook and instrument records still carry those.

## 8. Image integrity

The tools support adjustment, cropping, and annotation. Those operations change the displayed image.

- Keep the original file. Export the processing log and the uncropped image where the tool offers them.
- Do not selectively erase, clone, move, or enhance individual bands.
- Apply the same adjustment to compared panels, or disclose a difference.
- Check saturation; a saturated band has no quantitative dynamic range.
- Follow the journal's image-integrity policy and your institution's research-integrity rules.

## 9. Shared and public computers

- Clear credentials and local data before handing over a workstation.
- Local storage is not encrypted; anyone with access to the profile may read tokens and history.
- Projects and exports are ordinary files. Use disk encryption and access controls for confidential work.
- On the Android build, app data is stored in the app sandbox; exports go wherever you share them.

## 10. Data removal

- Deleting a project file from disk removes that copy.
- Removing a Known Projects entry does not delete the file.
- Clearing application data removes settings, credentials, snapshots, and the registry, but not files you exported.
- Removing an attachment from a project does not delete the original external file.

For the storage model in practice, see [Project Hub](project-hub.md) and [Settings](settings.md).
