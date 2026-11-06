# AI Co-Pilot

The AI Co-Pilot is an optional assistant inside SPICE GUI. It can answer questions, inspect the current workspace, propose mutations or DNA sequences, and run a small set of approval-gated tools.

> **Privacy.** The default endpoint is a local Ollama server. If you configure a remote OpenAI-compatible endpoint, the conversation and injected workspace context leave your computer under that provider's policy. Use local Ollama for sensitive data.

## 1. Open the panel

Click **AI Co-Pilot** in the top bar. The sidebar has two tabs: **AI Copilot** and **Toolbox**.

The header has a settings gear, a reset button, and a close button. The live-context banner shows the active workspace, sequence prefix and length, pH, temperature, and — when available — m1, GC%, and host.

Type in **Type your question...**. `Enter` sends; `Shift+Enter` inserts a newline. While a response is streaming, the send button becomes a stop button.

## 2. Connect a model

Open the settings gear.

- **API Endpoint** defaults to `http://localhost:11434/v1/chat/completions`, the local Ollama endpoint.
- **Target Model** defaults to `qwen2.5:7b-instruct`. The field is backed by the endpoint's model list when available.
- **API Key** is optional. Use it for a hosted OpenAI-compatible service.
- **Temperature** defaults to 0.7.
- **System Prompt** is editable. The default prompt describes the SPICE context and the expected structured output.
- **Test connection** checks the endpoint and lists the available models.

Any OpenAI-compatible chat-completions endpoint can be used. In the desktop app, if a direct request fails because of CORS or a network restriction, the client retries through the native Rust bridge.

Common errors are reported explicitly: authentication failure, unreachable service, timeout, rate limiting, and server errors.

## 3. What context is sent

Every turn can include:

- The active workspace and page.
- The current protein sequence prefix and length, pH, temperature, ionic strength, and metrics.
- The current plasmid name, DNA length, GC%, and codon host.
- Up to four retrieved snippets from open project documents, journal pages, attachment metadata, active sequences, and agent memory.

Retrieved snippets are labelled as local, untrusted data. The prompt tells the model not to follow instructions found inside them. This is a mitigation, not a guarantee; review retrieved content if a project contains third-party text.

The chat sends the last 40 turns and drops older turns to stay inside an estimated 8192-token context. The default reply budget is 2048 tokens. The conversation is stored locally and restored on start.

## 4. Structured imports

The assistant can emit two kinds of actionable blocks.

### 4.1 Mutation list

A fenced `json` array of objects such as `{"pos": 15, "from": "V", "to": "A", "score": 0.8}` is rendered as **Recommended mutation set ({n} items)** with **Import mutation list to cart**.

The app validates each row against the active protein sequence. Positions must be in range and the wild-type residue must match. Invalid rows are rejected.

### 4.2 DNA sequence

A fenced `dna` block is rendered as **Optimized DNA sequence detected ({n} bp)** with **Apply DNA sequence to editor**.

The app validates the IUPAC DNA alphabet, then asks for confirmation before replacing the construct. The Gene Editor records an undo snapshot first. A DNA block is only actionable in the Gene Editor.

### 4.3 Undo

When the host page provides an undo callback, **Undo last AI change** appears. It uses the Gene Editor's history undo or the Protein Workstation's AI-state snapshot. It is a single-step safety net, not a full history.

## 5. Local Toolbox

The **Toolbox** tab contains three bundled local calculators. They are heuristics, not calls to the SPICE engine or the AI model.

### 5.1 Mutation

Requires the Protein Workstation. Enter **Mutation Position**, **Wildtype (From)** (auto-filled from the sequence), **Mutant (To)**, **pH Environment**, and **Simulation Temp (K)**. Click **Run SPICE Biophysics Prediction** to get a ΔΔG estimate, classification, solvent neutralisation ions, net charge, and an explanation. The result can be imported into the mutation cart.

### 5.2 Codon GC

Requires the Gene Editor. Choose the **Target Expression Host** (E. coli, S. cerevisiae, H. sapiens), set **Target Smooth GC Content (%)**, choose restriction sites to avoid (BsaI, BsmBI, EcoRI), and run **Execute Intelligent Codon Optimization**. The result reports GC and CAI before/after, the number of changed codons, avoided sites, and an optimized DNA sequence that can be applied to the editor.

The sequence must be unambiguous A/C/G/T and its length must be divisible by three.

### 5.3 SOP

Requires the Gene Editor. Choose a cloning method (Golden Gate or Gibson), a restriction enzyme for Golden Gate, and a high-fidelity polymerase. The tool generates a primer pair with Tm and product size, a PCR recipe, thermal cycling, assembly recipe, incubation program, and a Markdown block you can copy.

These outputs are drafts. Verify primer sequences, Tm, and recipes against your lab's protocols before ordering or running anything.

## 6. Agent mode

**Agent mode** lets the model inspect workspace data and call tools. It is enabled by default. The loop allows at most six model steps per user turn.

### 6.1 Read-only tools

Read-only tools run without approval. They include workspace-context lookup, mutation ΔΔG prediction, DNA analysis, primer design, codon usage, ORF finding, reverse complement, Tm calculation, document listing, workspace search, and memory recall.

### 6.2 Write tools

Write tools require an approval modal titled **Approve agent action**. The modal shows the tool name, permission, a human-readable preview, a **Raw arguments** expander, and **Approve** / **Reject** buttons.

Write tools include:

- `apply_dna_sequence` — replace the gene construct.
- `apply_protein_sequence` — replace the protein sequence.
- `import_mutations` — add mutations to the protein cart.
- `remember_fact` — add a durable memory.
- `figure_add_chart` — add a chart to Figure Studio.
- Any MCP tool whose server does not declare `readOnlyHint: true`.

Rejection is a normal outcome. The model is told that the user rejected the action.

## 7. MCP servers

The settings pane has an **MCP servers** section.

- **Add server** creates a row with **Enabled**, **Server name**, **Command**, **Arguments**, and **Environment JSON**.
- **Refresh tools** lists the tools exposed by each enabled server.
- Tools are named `mcp__<serverId>__<tool>` in the model's tool list.
- MCP is desktop-only.
- A tool is treated as read-only only when the server sets `readOnlyHint: true`; everything else requires approval.

MCP servers are arbitrary local commands. Only add servers you trust, and keep secrets out of environment JSON when possible.

## 8. Memory and audit

**Agent memory** stores up to 200 facts. Each fact is limited to 2000 characters and 12 tags. Duplicate text is ignored. The agent can add a fact only through the approval-gated `remember_fact` tool.

**Agent activity** is an audit log of tool calls, approvals, and applied changes. It keeps the most recent 500 entries and shows the latest 15. Secret-like argument keys are redacted. **Clear log** wipes the trail.

Memory, audit entries, chat history, API keys, and MCP environments are stored unencrypted in local storage. Clear them before sharing a workstation.

## 9. Good use and bad use

Good uses:

- Draft a cloning SOP, then verify it against your protocol.
- Summarise the current project documents.
- Propose codon changes for a construct, then inspect them in the editor.
- Ask for a checklist before a figure submission.

Bad uses:

- Accepting a mutation or DNA sequence without sequence-level review.
- Treating the local ΔΔG or codon score as a validated prediction.
- Sending patient or unpublished confidential data to a remote endpoint.
- Trusting an MCP server you have not inspected.
- Treating a generated SOP as approved by your institution.

The assistant is a drafting and navigation aid. The scientific judgement, sequence verification, and records remain yours.

## 10. Limitations

- Retrieval is local lexical matching, not a vector database or semantic search.
- No file upload or image input; only text and structured blocks.
- The agent is bounded to six model steps and an estimated 8192-token context.
- The local Toolbox is heuristic, not a validated biophysics engine.
- The assistant cannot see tool results that are not in the workspace context or retrieved documents.
- A remote endpoint receives the current sequence, environment, metrics, snippets, and conversation.
- The chat, memory, and audit log are local and unencrypted.

For model configuration, see [Settings](settings.md). For the molecular workflows the assistant can edit, see [Gene Editor](gene-editor.md) and [Protein Workstation](protein-workstation.md).
