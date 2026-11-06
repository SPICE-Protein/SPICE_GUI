# Troubleshooting

This page covers the problems that come up most often: installation, models, detection quality, exports, projects, ELN signing, SPD, the AI Co-Pilot, and performance. For a description of normal behaviour, follow the link to the relevant manual.

## 1. First checks

1. Confirm you are on the current release from the [releases page](https://github.com/SPICE-Protein/SPICE_GUI/releases).
2. Open the activity log or the relevant tool's message area; many failures report a specific reason there.
3. Check **Settings** for model status, paths, SPD health, and ORCID status.
4. Try the same operation with a small example file. If the example works, the problem is in the input, not the app.
5. Keep the original file. Do not overwrite it while debugging.

## 2. Install and launch

**The app does not start on Windows.** Use the current installer for your architecture. If SmartScreen blocks an unsigned build, verify the download source, then choose the option to run it. Install per-user if the machine restricts programme files.

**The window is blank on macOS.** Use a current build. Very old builds linked against older SDKs can draw a blank WKWebView on newer macOS versions. If a current build is still blank, quit and relaunch; if it persists, check the console output from a terminal launch and report it.

**Linux: missing libraries.** The `.deb` and `.rpm` packages declare their dependencies. On a minimal distribution you may need WebKitGTK and related runtime packages. Install the package with your package manager rather than extracting it manually.

**Android: the interface asks me to rotate.** The workbench requires landscape. Rotate the device or enable auto-rotate. Some file and model workflows are easier on a desktop.

**The engine chip stays at CONNECTING.** A failed ping does not switch the chip to an explicit offline state. Check whether folding or MD also fails; if they do, restart the app and check the activity log. Local editing and bench tools do not depend on the engine.

## 3. Models

### 3.1 GelGenie

**`AI detect (GelGenie)` is disabled or reports the model is missing.** Load an image first; the button is also disabled while another import or detection is running. Then open **Settings → General Settings → GelGenie detection model** and download the model. Wait for `GelGenie model is ready`.

**The download fails.** Check the proxy field and your network. The default URL is checksum-verified; a custom URL is downloaded without the default check. Retry after the network is stable. A partial file should be downloaded again rather than used.

**The first AI detection is slow.** The first inference loads the model into memory. Later runs are faster. Very large images are downscaled or processed in tiles; crop first if you need speed.

**AI detection finds nothing.** Check that the image is a gel or blot and that the polarity is sensible. GelGenie handles light backgrounds automatically, but an over-exposed or nearly blank image has nothing to segment. Compare with the classical detector on the same crop.

### 3.2 SPICE protein model

**Fold reports an ONNX error.** No model is loaded. Enter an absolute checkpoint path and click **Apply**, or download the weights. The manual path override lasts only for the current process; after a restart, set it again or place the checkpoint in a default location.

**The model loads but results look wrong.** The checkpoint is still under development, and some output heads are not trained. Check **Output Heads** in Settings and read the caveats in [Protein Workstation](protein-workstation.md). Do not treat exploratory folds, mutations, or MD as publication-ready.

**Model files do not travel with the project.** They are not embedded. Copy or download them on the new machine.

## 4. Gel and blot detection

**The lane count is wrong.** Crop out labels, scanner borders, and empty margins. A dark border often becomes a false lane. Raise the minimum lane width or adjust the lane threshold. If the gel smiles, correct lane geometry before trusting band volumes.

**Bands are missing on a faint blot.** Increase sensitivity or lower band prominence, check the display inversion and polarity, and try **AI detect (GelGenie)** as a second opinion. A band below the image's usable dynamic range cannot be recovered by analysis.

**Too many bands.** Raise band prominence or minimum area, lower sensitivity, and remove dye fronts and shadows. If the artefact is in the image, fix the image.

**The marker fit has a low R².** Check that the marker lane is assigned, the correct ladder is selected, and the detected marker bands match the ladder. One misassigned marker band can distort the whole fit. Create a custom ladder rather than forcing a closest match.

**Band sizes are shifted.** Recheck the ladder, the marker lane, and the gel type. A smiling gel or an incorrect run time changes migration. Re-run the physical gel if sizes matter.

**A blot cannot be normalized.** Assign a loading control per lane, or switch to total protein. Fold change is undefined without a control group.

## 5. Quantification

**A band is flagged as saturated.** Re-expose or dilute and run again. Saturation is a warning, not a correction; excluding the band changes n and the statistics.

**The qPCR result is missing.** Check that a reference target, a control group, and a Ct for each required well exist. A missing reference invalidates that sample's ΔCt. A well reported as Undetermined is not a high Ct.

**The qPCR columns are mapped incorrectly.** Use **Column mapping** to assign the source column for each field. Check the delimiter (tab, comma, semicolon). Confirm that Ct is numeric and that sample and group names match exactly.

**The statistics look surprising.** Check n after exclusions, whether technical replicates were treated as biological replicates, and whether the control group is correct. The tests are descriptive; nested plate and batch effects need a mixed model.

**The colony count is low on a dense plate.** Touching colonies undercount even with splitting. Dilute and plate again; do not extrapolate a confluent plate.

**CFU/mL is wrong.** Confirm the dilution factor and plated volume, and use the included count. The formula is `count × dilution factor ÷ plated volume`.

## 6. Exports

**The figure looks soft.** Check the effective dpi. Use 300 dpi for raster submission and prefer SVG or PDF where the journal accepts vectors. Upscaling a low-resolution source cannot add detail.

**Text is too small in print.** Set the final physical width and the font size together. A figure designed at 180 mm and reduced to 90 mm halves the effective font size. Use the publication check in Figure Studio and the pre-flight check in the gel tool.

**PNG export is huge or slow.** Reduce the dpi, the page size, or the image resolution. TIFF and 600 dpi exports of large pages are memory-intensive. Export SVG when possible.

**The CSV opens with garbled characters in Excel.** The bench-tool CSVs use a UTF-8 BOM and CRLF for Excel compatibility. If another program still misreads them, import as UTF-8 rather than double-clicking.

**The colour classification is unavailable.** The colony image is grayscale. Use a colour photo or classify markers manually.

**A download did not appear.** Check the browser/download folder and any download prompt. In the desktop app, a native save dialog may be behind the main window. In the browser build, the browser may block multiple automatic downloads.

**The original image is missing after reopening a gel project.** Autosave intentionally strips the original image to control size. Re-import the source or use the saved project JSON that references it.

## 7. Projects and autosave

**The project cannot be opened.** Confirm the file is a `.spiceproj` from a compatible version and that it is not truncated. Keep the original and try a backup. Older gzip-JSON and plain-JSON generations are importable; a file that is neither reports a parse error with technical detail.

**The project is too large / autosave fails.** Attachments and embedded documents count toward local-storage quota. Export the project to disk, reduce or remove large attachments, and save again. The `.spiceproj` file is authoritative; local snapshots are not.

**My work disappeared after opening the Gene Editor.** Autosave may have restored a cached document over the workspace. Look in **Window → Edit History Tree** and the activity log, and check the autosave cache. Save named files rather than relying on the cache. If this happens repeatedly, turn off real-time autosave while switching between unrelated constructs.

**Undo does not restore a change.** Not every action pushes a snapshot. Codon optimisation, Co-Design apply, Synthetic Gene Designer QC fixes, and protein back-mutation are examples. Export before using them.

**A closed project reopens from an old snapshot.** The Known Projects registry and snapshots are local and may be older than the `.spiceproj`. Use **Open Project** for the authoritative file.

**Two windows overwrite each other.** The app has no cross-window lock. Open a project in one window at a time.

**The project opens on another computer but models are missing.** Models are stored outside the project. Download or copy them separately.

## 8. Gene Editor specifics

**Typing inserts at the start of the sequence.** You are in Edit Mode with the cursor before base 1. Click the intended base first.

**A restriction site is flagged `[Blocked]`.** The site overlaps a Dam, Dcm, or EcoKI methylation motif and will not cut in a typical E. coli prep. Use a methylation-insensitive enzyme or a different host.

**The virtual gel is empty.** It is not filled from the selected digest. Type the expected fragment sizes into a lane, or send a PCR product to the gel.

**`Cut plasmid here` is unavailable.** It exists only on the Linear Map. The circular map's `Rotate ring` is a visual rotation, not a sequence rotation.

**A Customize Settings toggle does nothing.** Some stored display options are not connected to the renderer in the current build. Use the toolbar track icons and the map itself.

**A panel is off-screen.** Panels can be dragged but not reset. Drag it back by the header, or reload; unsaved edits may be lost, so save first.

**Auto-annotate finds nothing.** The library is curated and not exhaustive. Absence of a feature is not evidence of absence; add the feature manually if you know it is there.

## 9. ELN signing

**Signing is blocked.** Resolve the ORCID profile first. Signing requires a verified ORCID identity; if the public ORCID API is unreachable, try again later. A missing ORCID reports `ORCID iD required`.

**The page is locked and I need to correct it.** Signed pages are immutable by design. Create a new page, reference the signed one, and record the correction there.

**The signature does not verify elsewhere.** The digest is an unkeyed SHA-256 of the page and metadata. It verifies only against the same canonical content and a retained digest. It is not a private-key signature.

## 10. SPD and external services

**`Configure an API token in Settings → Public Integrations first`.** Create a Universal API Token on the SPD site after ORCID login, paste it, and click **Verify token**. Check **Check health** for the base URL.

**Publishing fails only in the packaged app.** SPD publishing is desktop-only because of CORS; use the desktop build. Requests go through the native bridge.

**A database sync reports success but the data looks old.** The app can fall back to a curated local dataset. Check the cached count and the last-sync time, and retry when the network is available.

**A lookup fails for one identifier.** The record may not exist in that database, or the identifier type may be wrong (for example, a gene symbol where an accession is expected). NCBI ignores the species selector when you enter an accession.

## 11. AI Co-Pilot

**The assistant cannot connect.** Check the endpoint URL, the API key, and whether the model name exists on that server. A local Ollama endpoint must be running and reachable from the app. Some remote endpoints reject requests from a packaged app; use a server that permits it.

**Streaming stops mid-answer.** Check the network and the endpoint's timeout. Retry with a smaller context. Very long sequences or images can exceed the model's context window.

**A tool action is blocked.** Mutating actions require approval. Approve the specific action shown; approval does not carry over to later actions. If a tool is unavailable, it may be disabled for the current workspace.

**The assistant cites something that does not exist.** Treat generated citations and calculations as drafts. Verify against primary sources and against the app's own calculators.

**Sensitive data concerns.** Use a local endpoint for confidential sequences. A remote endpoint receives the conversation and injected context under that provider's policy.

## 12. Settings, language, and keyboard

**The language did not change.** Choose it in **Settings → General Settings**. Language applies immediately and is stored locally. If a label still shows the old language, reopen the page.

**The theme palette did not apply.** Display mode applies immediately; a palette change may need a reload in the current build.

**A shortcut does nothing.** Check **Settings → Keymap Settings** for a conflict. Shortcuts are muted while focus is in an input, editor, or console. On macOS, `Mod` means Command.

**Two actions share a binding.** The editor flags `Conflict: Duplicated with ...` but does not revert it. Rebind one action.

## 13. Performance

- Large images: crop before detection; working images are capped (colony detection at 1400 px, general working size at 4096 px).
- Batch jobs: use a consistent imaging series and review the summary; batch settings are not per-image.
- Figure export: reduce page size or dpi, or export SVG.
- Long sessions: save and restart if memory grows; the Gene Editor keeps up to 100 undo snapshots.

## 14. Reporting a problem

Include:

1. The app version and platform.
2. The exact menu path and the label you clicked.
3. The input file type and approximate size.
4. The error text from the activity log or message area.
5. Whether the example data reproduces the problem.

Do not attach confidential sequences or unpublished images to a public issue. Describe the shape of the data instead, or use a minimal synthetic example.

For normal workflows, see [Getting Started](getting-started.md), [Gene Editor](gene-editor.md), [Protein Workstation](protein-workstation.md), and [Bench tools](tools/README.md).
