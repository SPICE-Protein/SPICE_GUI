<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { aiState } from './aiState.svelte.ts';
  import { pushToast } from './toast.svelte.ts';
  import { streamChat, testConnection, AiRequestError, type AiChatMessage } from '$lib/ai/client';
  import { buildChatPayload } from '$lib/ai/context';
  import { parseMutationBlocks, parseDnaBlocks, validateMutations, validateDnaSequence } from '$lib/ai/parse';
  import { runAgentTurn, type AgentApprovalRequest, type AgentToolEvent } from '$lib/ai/agent';
  import { buildAgentTools, type AgentWorkspaceContext } from '$lib/ai/tools';
  import { formatRetrievalContext, retrieve, type SearchDocument } from '$lib/ai/retrieval';
  import { AGENT_SYSTEM_RULES } from '$lib/ai/prompt';
  import {
    listMcpTools,
    loadMcpServers,
    newMcpServerId,
    saveMcpServers,
    splitArgs,
    type McpServerConfig,
    type McpToolDescriptor,
  } from '$lib/ai/mcp';
  import { projectStore } from '$lib/project/store.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import {
    Send, Sparkles, Settings, RotateCcw, X, Check, Dna,
    Layers, HelpCircle, FileText, AlertCircle, RefreshCw, Square,
    MessageSquare, Sliders, Activity, Zap, Copy, FileSpreadsheet, Beaker,
    Bot, ShieldCheck, Play, Trash2, Plug, Plus, Undo2
  } from 'lucide-svelte';

  const ui = { style: 'pixel', theme: 'midnight' } as const;

  let inputVal = $state('');
  let showConfig = $state(false);
  let messagesContainer = $state<HTMLDivElement | null>(null);
  let generationController: AbortController | null = null;
  let connectionState = $state<'idle' | 'testing' | 'ok' | 'error'>('idle');
  let connectionDetail = $state('');
  let discoveredModels = $state<string[]>([]);

  // Agent / MCP / approval state
  let mcpServers = $state<McpServerConfig[]>([]);
  let mcpTools = $state<McpToolDescriptor[]>([]);
  let mcpErrors = $state<string[]>([]);
  let mcpLoading = $state(false);
  let mcpLoaded = $state(false);
  let showMcp = $state(false);
  let showAudit = $state(false);
  let approvalData = $state<{ toolName: string; permission: string; preview: string; args: string } | null>(null);
  let approvalResolver: ((approved: boolean) => void) | null = null;
  let agentStatus = $state('');
  let stepPrefix = '';
  let newMemory = $state('');

  // Synchronize main panel context to the offline interactive tools
  function syncContextToTools() {
    if (aiState.proteinContext && aiState.proteinContext.env) {
      aiState.mutTool.ph = aiState.proteinContext.env.ph || 7.0;
      aiState.mutTool.tempK = aiState.proteinContext.env.tempK || 310;
    }
    if (aiState.proteinContext && aiState.proteinContext.sequence) {
      const seq = aiState.proteinContext.sequence;
      // If position is out of bounds, adjust it
      if (aiState.mutTool.pos > seq.length || aiState.mutTool.pos <= 0) {
        aiState.mutTool.pos = Math.max(1, Math.min(103, seq.length));
      }
      const idx = aiState.mutTool.pos - 1;
      if (idx >= 0 && idx < seq.length) {
        aiState.mutTool.fromRes = seq[idx];
      }
    }
  }

  // Auto-sync whenever user enters tools tab or protein context changes
  $effect(() => {
    if (aiState.activeTab === 'tools') {
      syncContextToTools();
    }
  });

  // Watch position input to auto-update original residue from sequence
  $effect(() => {
    const pos = aiState.mutTool.pos;
    const seq = aiState.proteinContext?.sequence;
    if (seq && pos > 0 && pos <= seq.length) {
      aiState.mutTool.fromRes = seq[pos - 1];
    }
  });

  // Save AI endpoint configuration on changes
  $effect(() => {
    if (typeof localStorage !== 'undefined' && aiState.config) {
      localStorage.setItem('spice_ai_config', JSON.stringify({
        endpoint: aiState.config.endpoint,
        model: aiState.config.model,
        systemPrompt: aiState.config.systemPrompt,
        apiKey: aiState.config.apiKey,
        temperature: aiState.config.temperature,
        maxTokens: aiState.config.maxTokens
      }));
    }
  });

  // Persist the conversation with a short debounce so streaming does not write
  // localStorage on every token. The "Thinking..." placeholder is never saved.
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    const snapshot = aiState.messages
      .filter((msg) => !(msg.role === 'assistant' && msg.text === m.copilotThinking()))
      .slice(-120)
      .map((msg) => ({
        id: msg.id,
        role: msg.role,
        text: msg.text,
        timestamp: msg.timestamp,
        error: msg.error === true,
        parsedMutations: msg.parsedMutations,
        parsedSequence: msg.parsedSequence,
        parsedSop: msg.parsedSop,
        toolNotes: msg.toolNotes,
      }));
    const timer = setTimeout(() => {
      localStorage.setItem('spice_ai_messages', JSON.stringify(snapshot));
    }, 400);
    return () => clearTimeout(timer);
  });

  // Save AI Tools states automatically on changes
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice_ai_mut_tool', JSON.stringify({
        pos: aiState.mutTool.pos,
        fromRes: aiState.mutTool.fromRes,
        toRes: aiState.mutTool.toRes,
        ph: aiState.mutTool.ph,
        tempK: aiState.mutTool.tempK
      }));
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice_ai_codon_tool', JSON.stringify({
        host: aiState.codonTool.host,
        targetGc: aiState.codonTool.targetGc,
        avoidBsaI: aiState.codonTool.avoidBsaI,
        avoidBsmBI: aiState.codonTool.avoidBsmBI,
        avoidEcoRI: aiState.codonTool.avoidEcoRI
      }));
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice_ai_sop_tool', JSON.stringify({
        method: aiState.sopTool.method,
        enzyme: aiState.sopTool.enzyme,
        polymerase: aiState.sopTool.polymerase
      }));
    }
  });

  // Automatically select matching default tool when workspace changes
  $effect(() => {
    if (aiState.currentWorkspace === 'protein') {
      aiState.activeTool = 'mutation';
    } else if (aiState.currentWorkspace === 'gene') {
      aiState.activeTool = 'codon';
    }
  });

  function switchTool(tool: 'mutation' | 'codon' | 'sop') {
    const ws = aiState.currentWorkspace;
    if (ws === 'protein' && (tool === 'codon' || tool === 'sop')) {
      pushToast('warn', m.workspaceMismatch(), m.copilotMismatchToGeneTip());
      return;
    }
    if (ws === 'gene' && tool === 'mutation') {
      pushToast('warn', m.workspaceMismatch(), m.copilotMismatchToProteinTip());
      return;
    }
    aiState.activeTool = tool;
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushToast(
        'success',
        m.copilotToastCopySuccess(),
        m.copilotToastCopyDesc()
      );
    } catch (e: any) {
      pushToast('error', m.copilotToastCopyFail(), e.message);
    }
  }

  function getSopMarkdown(): string {
    const r = aiState.sopTool.result;
    if (!r) return "";
    let md = `# ${r.title}\n\n`;
    md += `${m.copilotMdPrimersHeading()}\n`;
    md += `${m.copilotMdFwdPrimer({ v1: r.fwdPrimer, v2: r.primerTm })}\n`;
    md += `${m.copilotMdRevPrimer({ v1: r.revPrimer, v2: r.primerTm })}\n`;
    md += `${m.copilotMdProductLength({ v1: r.productLength })}\n\n`;

    md += `${m.copilotMdPcrRecipeHeading()}\n`;
    md += `${m.copilotMdRecipeTableHeader()}\n`;
    md += `| :--- | :--- | :--- |\n`;
    r.pcrRecipe.forEach(item => {
      md += `| ${item.component} | ${item.volume} µL | ${item.note} |\n`;
    });
    md += `\n`;

    md += `${m.copilotMdPcrCyclingHeading()}\n`;
    md += m.sopTableHeader();
    md += `| :--- | :--- | :--- | :--- |\n`;
    r.pcrCycles.forEach(item => {
      md += `| ${item.step} | ${item.temp} | ${item.time} | ${item.note} |\n`;
    });
    md += `\n`;

    md += m.sopHeadingAsmMix({ method: aiState.sopTool.method });
    md += `${m.copilotMdRecipeTableHeader()}\n`;
    md += `| :--- | :--- | :--- |\n`;
    r.assemblyRecipe.forEach(item => {
      md += `| ${item.component} | ${item.volume} µL | ${item.note} |\n`;
    });
    md += `\n`;

    md += `${m.copilotMdAssemblyIncubationHeading()}\n`;
    md += m.sopTableHeader();
    md += `| :--- | :--- | :--- | :--- |\n`;
    r.assemblyCycles.forEach(item => {
      md += `| ${item.step} | ${item.temp} | ${item.time} | ${item.note} |\n`;
    });
    return md;
  }

  onMount(() => {
    // Expose global bridge functions for HTML-injected buttons in Markdown
    (window as any).applyCopilotMutations = (b64: string) => {
      try {
        const decoded = decodeURIComponent(atob(b64));
        const muts = JSON.parse(decoded);
        if (Array.isArray(muts)) importMutations(muts);
      } catch (e: any) {
        pushToast(
          'error',
          m.copilotToastMutFail(),
          e.message
        );
      }
    };

    (window as any).applyCopilotDna = (b64: string) => {
      try {
        const decoded = decodeURIComponent(atob(b64));
        applyDna(decoded);
      } catch (e: any) {
        pushToast(
          'error',
          m.copilotToastDnaFail(),
          e.message
        );
      }
    };
  });

  function renderMarkdown(text: string): string {
    if (!text) return "";
    
    let html = "";
    const lines = text.split(/\r?\n/);
    let inCodeBlock = false;
    let codeLanguage = "";
    let codeContent: string[] = [];
    let inBulletList = false;
    let inOrderedList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // 1. Handle Code Blocks
      if (trimmed.startsWith("```")) {
        if (inCodeBlock) {
          inCodeBlock = false;
          const fullCode = codeContent.join("\n");
          let buttonHtml = "";
          
          if (codeLanguage === "json") {
            buttonHtml = `<button class="pix-btn ok" style="padding: 2px 8px; font-size: 8px; margin-top: 4px; display: inline-flex; align-items: center; gap: 3px; cursor: pointer; background: var(--pix-bg-2); border: 2px solid var(--pix-border); color: var(--pix-green); font-family: inherit;" onclick="window.applyCopilotMutations('${btoa(encodeURIComponent(fullCode))}')">
              ${m.copilotCardMutBtn()}
            </button>`;
          } else if (codeLanguage === "dna") {
            buttonHtml = `<button class="pix-btn ok" style="padding: 2px 8px; font-size: 8px; margin-top: 4px; display: inline-flex; align-items: center; gap: 3px; cursor: pointer; background: var(--pix-bg-2); border: 2px solid var(--pix-border); color: var(--pix-accent-2); font-family: inherit;" onclick="window.applyCopilotDna('${btoa(encodeURIComponent(fullCode))}')">
              ${m.copilotCardDnaBtn()}
            </button>`;
          }

          html += `<div class="code-block-container" style="background: #000; border: 1px solid var(--pix-border); padding: 6px; border-radius: 4px; margin: 6px 0; font-family: monospace; font-size: 9px; overflow-x: auto; color: var(--pix-fg);">
            <pre style="margin: 0; white-space: pre-wrap; word-break: break-all;"><code class="language-${codeLanguage}">${escapeHtml(fullCode)}</code></pre>
            ${buttonHtml}
          </div>`;
          codeContent = [];
          codeLanguage = "";
        } else {
          inCodeBlock = true;
          codeLanguage = trimmed.slice(3).toLowerCase() || "text";
        }
        continue;
      }

      if (inCodeBlock) {
        codeContent.push(line);
        continue;
      }

      // Close open lists if the line is not a list item
      const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("* ");
      const isOrdered = /^\d+\.\s+/.test(trimmed);

      if (inBulletList && !isBullet) {
        html += "</ul>";
        inBulletList = false;
      }
      if (inOrderedList && !isOrdered) {
        html += "</ol>";
        inOrderedList = false;
      }

      // 2. Handle Headings
      if (trimmed.startsWith("### ")) {
        html += `<h3 style="margin: 6px 0 2px 0; font-size: 10px; color: var(--pix-cyan); font-weight: bold;">${parseInline(trimmed.slice(4))}</h3>`;
      } else if (trimmed.startsWith("## ")) {
        html += `<h2 style="margin: 8px 0 3px 0; font-size: 11px; color: var(--pix-accent-2); font-weight: bold;">${parseInline(trimmed.slice(3))}</h2>`;
      } else if (trimmed.startsWith("# ")) {
        html += `<h1 style="margin: 10px 0 4px 0; font-size: 12px; color: var(--pix-accent); font-weight: bold;">${parseInline(trimmed.slice(2))}</h1>`;
      }
      // 3. Handle Blockquotes
      else if (trimmed.startsWith("> ")) {
        html += `<blockquote style="border-left: 2px solid var(--pix-border-hi); padding-left: 6px; margin: 4px 0; color: var(--pix-fg-dim); font-style: italic;">${parseInline(trimmed.slice(2))}</blockquote>`;
      }
      // 4. Handle Lists
      else if (isBullet) {
        if (!inBulletList) {
          html += '<ul style="margin: 4px 0; padding-left: 12px; list-style-type: square; color: var(--pix-fg-dim);">';
          inBulletList = true;
        }
        html += `<li style="margin: 2px 0;">${parseInline(trimmed.slice(2))}</li>`;
      } else if (isOrdered) {
        if (!inOrderedList) {
          html += '<ol style="margin: 4px 0; padding-left: 14px; list-style-type: decimal; color: var(--pix-fg-dim);">';
          inOrderedList = true;
        }
        html += `<li style="margin: 2px 0;">${parseInline(trimmed.replace(/^\d+\.\s+/, ""))}</li>`;
      }
      // 5. Empty line
      else if (trimmed === "") {
        html += '<div style="height: 4px;"></div>';
      }
      // 6. Standard paragraph
      else {
        html += `<p style="margin: 4px 0; line-height: 1.3;">${parseInline(line)}</p>`;
      }
    }

    if (inBulletList) html += "</ul>";
    if (inOrderedList) html += "</ol>";

    return html;
  }

  function parseInline(text: string): string {
    let out = escapeHtml(text);
    out = out.replace(/\*\*([\s\S]*?)\*\*/g, '<strong style="color: var(--pix-fg); font-weight: bold;">$1</strong>');
    out = out.replace(/`([^`]+)`/g, '<code style="background: var(--pix-bg-1); border: 1px solid var(--pix-border); padding: 1px 4px; border-radius: 2px; font-family: monospace; font-size: 8.5px; color: var(--pix-cyan);">$1</code>');
    return out;
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Auto-scroll chat history to bottom
  async function scrollToBottom() {
    await tick();
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  function describeAiError(error: unknown): string {
    if (!(error instanceof AiRequestError)) return String(error);
    switch (error.kind) {
      case 'auth':
        return m.copilotErrorAuth();
      case 'network':
        return m.copilotErrorNetwork();
      case 'timeout':
        return m.copilotErrorTimeout();
      case 'rate-limit':
        return m.copilotErrorRateLimit();
      case 'server':
        return m.copilotErrorServer();
      default:
        return error.message;
    }
  }

  async function handleTestConnection() {
    connectionState = 'testing';
    connectionDetail = '';
    const result = await testConnection(aiState.config, { timeoutMs: 15_000 });
    if (result.ok) {
      connectionState = 'ok';
      discoveredModels = result.models;
      connectionDetail = m.aiConnectionOk({ n: result.models.length });
      pushToast('success', m.aiTestConnection(), connectionDetail);
    } else {
      connectionState = 'error';
      discoveredModels = [];
      connectionDetail = result.error ? describeAiError(result.error) : m.aiConnectionFailed();
      pushToast('error', m.aiConnectionFailed(), connectionDetail);
    }
  }

  // ---------------- MCP servers ----------------

  function persistMcpServers() {
    saveMcpServers($state.snapshot(mcpServers));
    mcpLoaded = false;
  }

  function addMcpServer() {
    mcpServers = [...mcpServers, {
      id: newMcpServerId(),
      name: 'Local MCP',
      command: 'npx',
      args: [],
      env: {},
      enabled: true,
    }];
    persistMcpServers();
  }

  function removeMcpServer(id: string) {
    mcpServers = mcpServers.filter((server) => server.id !== id);
    mcpTools = mcpTools.filter((tool) => tool.serverId !== id);
    persistMcpServers();
  }

  function setMcpArgs(server: McpServerConfig, value: string) {
    server.args = splitArgs(value);
    persistMcpServers();
  }

  function setMcpEnv(server: McpServerConfig, value: string) {
    try {
      const parsed = JSON.parse(value || '{}');
      server.env = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed).map(([key, val]) => [key, String(val)]))
        : {};
    } catch {
      server.env = {};
    }
    persistMcpServers();
  }

  async function refreshMcpTools(silent = false) {
    if (mcpLoading) return;
    if (!(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)) {
      mcpErrors = [m.aiMcpDesktopOnly()];
      return;
    }
    mcpLoading = true;
    try {
      const result = await listMcpTools($state.snapshot(mcpServers));
      mcpTools = result.tools;
      mcpErrors = result.errors;
      mcpLoaded = true;
      if (!silent) {
        if (result.errors.length) pushToast('warn', m.aiMcpRefresh(), result.errors[0]);
        else pushToast('success', m.aiMcpRefresh(), m.aiMcpToolsFound({ n: result.tools.length }));
      }
    } catch (error) {
      mcpErrors = [error instanceof Error ? error.message : String(error)];
      if (!silent) pushToast('error', m.aiMcpRefresh(), mcpErrors[0]);
    } finally {
      mcpLoading = false;
    }
  }

  async function ensureMcpTools() {
    const enabled = mcpServers.some((server) => server.enabled && server.command.trim());
    if (enabled && !mcpLoaded && !mcpLoading) await refreshMcpTools(true);
  }

  // ---------------- workspace context, retrieval, approvals ----------------

  function clipText(value: unknown, max = 12_000): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function buildSearchDocuments(): SearchDocument[] {
    const documents: SearchDocument[] = [];
    const project = projectStore.current;
    if (project) {
      for (const doc of project.docs) {
        documents.push({
          id: `doc:${doc.id}`,
          kind: doc.kind,
          title: doc.name,
          text: clipText(doc.payload),
        });
      }
      for (const page of project.journal.pages) {
        documents.push({
          id: `journal:${page.id}`,
          kind: 'journal',
          title: page.title || page.category || 'Journal',
          text: clipText(page.markdownContent),
        });
      }
      for (const file of project.files ?? []) {
        documents.push({
          id: `file:${file.id}`,
          kind: 'file',
          title: file.name,
          text: `${file.mime || 'file'} · ${file.size ?? 0} bytes`,
        });
      }
    }
    if (aiState.geneContext.dnaSequence) {
      documents.push({
        id: 'active:gene',
        kind: 'gene',
        title: aiState.geneContext.plasmidName || 'Active gene',
        text: clipText(aiState.geneContext.dnaSequence),
      });
    }
    if (aiState.proteinContext.sequence) {
      documents.push({
        id: 'active:protein',
        kind: 'protein',
        title: 'Active protein',
        text: clipText(aiState.proteinContext.sequence),
      });
    }
    for (const entry of aiState.memory) {
      documents.push({
        id: `memory:${entry.id}`,
        kind: 'memory',
        title: entry.tags.length ? `Memory (${entry.tags.join(', ')})` : 'Memory',
        text: entry.text,
      });
    }
    return documents;
  }

  function buildWorkspaceContext(): AgentWorkspaceContext {
    const metrics = aiState.proteinContext.metrics;
    return {
      workspace: aiState.currentWorkspace,
      protein: {
        sequence: aiState.proteinContext.sequence,
        env: { ...aiState.proteinContext.env },
        metrics: metrics
          ? Object.fromEntries(Object.entries(metrics).filter(([, value]) => Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]))
          : null,
        phaseScanCount: aiState.proteinContext.phaseScanCount,
      },
      gene: {
        dnaSequence: aiState.geneContext.dnaSequence,
        plasmidName: aiState.geneContext.plasmidName,
        gcContent: aiState.geneContext.gcContent,
        codonHost: aiState.geneContext.codonHost,
      },
      documents: buildSearchDocuments(),
      memory: [...aiState.memory],
      mcpServers: $state.snapshot(mcpServers),
      actions: {
        applyDnaSequence: aiState.onApplyDnaSequence ?? undefined,
        applyProteinSequence: aiState.onApplyProteinSequence ?? undefined,
        importMutations: aiState.onImportMutations ?? undefined,
        rememberFact: (text, tags) => aiState.rememberFact(text, tags),
        undoLastChange: aiState.onUndoAiChange ?? undefined,
      },
    };
  }

  function requestApproval(request: AgentApprovalRequest): Promise<boolean> {
    if (approvalResolver) approvalResolver(false);
    approvalData = {
      toolName: request.tool.name ?? request.tool.definition.function.name,
      permission: request.tool.permission,
      preview: request.preview,
      args: clipText(request.args, 3000),
    };
    return new Promise((resolve) => {
      approvalResolver = resolve;
    });
  }

  function resolveApproval(approved: boolean) {
    const resolver = approvalResolver;
    approvalResolver = null;
    approvalData = null;
    resolver?.(approved);
  }

  function cancelGeneration() {
    resolveApproval(false);
    generationController?.abort();
  }

  function closeCopilot() {
    resolveApproval(false);
    if (aiState.isGenerating) generationController?.abort();
    aiState.isOpen = false;
  }

  function toolNote(event: AgentToolEvent, done = false): string {
    const label = `${event.tool.name}${event.approved === false ? ' · rejected' : ''}`;
    if (!done) return `${label} · running`;
    return `${label} · ${event.result?.ok ? 'ok' : 'failed'}`;
  }

  // Build current context prompt
  function buildContextPrompt() {
    let contextStr = `${m.copilotCtxHeader()}\n`;
    
    const activeWs = aiState.currentWorkspace;
    contextStr += `${m.copilotCtxActivePage({ v1: activeWs === 'protein' ? m.proteinWsName() : activeWs === 'gene' ? m.copilotCtxGenePageName() : m.universal() })}\n`;
    contextStr += `${m.copilotCtxWorkspaceRules()}\n\n`;

    // Add protein folding/MD context
    if (aiState.proteinContext.sequence) {
      contextStr += `${m.copilotCtxProteinSeq({ v1: `${aiState.proteinContext.sequence.slice(0, 50)}${aiState.proteinContext.sequence.length > 50 ? '...' : ''}`, v2: aiState.proteinContext.sequence.length })}\n`;
      contextStr += `${m.copilotCtxPhysicalEnv({ v1: aiState.proteinContext.env.ph.toFixed(1), v2: aiState.proteinContext.env.tempK, v3: (aiState.proteinContext.env.tempK - 273.15).toFixed(1), v4: aiState.proteinContext.env.ionicStrengthM })}\n`;
      if (aiState.proteinContext.metrics) {
        contextStr += `${m.copilotCtxPhysicalMetrics()} `;
        const mList = Object.entries(aiState.proteinContext.metrics)
          .map(([k, v]) => `${k}=${Number(v).toFixed(3)}`)
          .join(', ');
        contextStr += mList + '\n';
      }
    }

    // Add Gene Cloning Context
    if (aiState.geneContext.dnaSequence) {
      contextStr += `${m.copilotCtxPlasmidName({ v1: aiState.geneContext.plasmidName || m.copilotCtxUnnamed() })}\n`;
      contextStr += `${m.copilotCtxDnaLengthGc({ v1: aiState.geneContext.dnaSequence.length, v2: aiState.geneContext.gcContent.toFixed(1) })}\n`;
      contextStr += `${m.copilotCtxCodonHostPref({ v1: aiState.geneContext.codonHost || m.copilotCtxHostEcoli() })}\n`;
    }

    return contextStr;
  }

  async function sendMessage() {
    const text = inputVal.trim();
    if (!text || aiState.isGenerating) return;

    inputVal = '';
    const userMsgId = Date.now();

    // Push user message
    aiState.messages.push({
      id: userMsgId,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString()
    });

    scrollToBottom();
    aiState.isGenerating = true;

    const assistantMsgId = Date.now() + 1;
    aiState.messages.push({
      id: assistantMsgId,
      role: 'assistant',
      text: m.copilotThinking(),
      timestamp: new Date().toLocaleTimeString()
    });
    const assistantMsg = aiState.messages[aiState.messages.length - 1];

    scrollToBottom();

    // Send the recent conversation, not just the newest turn. Local welcome,
    // error, and placeholder notes are excluded so they cannot be replayed as
    // model output or as instructions. The context builder trims oldest turns
    // again to fit the model window.
    const history: AiChatMessage[] = aiState.messages
      .slice(0, -2)
      .filter((msg) => msg.id !== 1 && !msg.error && !(msg.role === 'assistant' && msg.text === m.copilotThinking()))
      .slice(-40)
      .map((msg) => ({ role: msg.role, content: msg.text }));

    // Ground the turn in the open project and the active workspace. Retrieval
    // is local and its output is explicitly labelled as untrusted context.
    const hits = retrieve(text, buildSearchDocuments(), 4);
    const retrieved = formatRetrievalContext(hits);
    const contextPrompt = retrieved ? `${buildContextPrompt()}\n${retrieved}` : buildContextPrompt();
    const userContent = m.aiPromptWithContextWrap({ buildContextPrompt: contextPrompt, text });

    const payload = buildChatPayload({
      systemPrompt: aiState.agentEnabled
        ? `${aiState.config.systemPrompt}\n\n${AGENT_SYSTEM_RULES}`
        : aiState.config.systemPrompt,
      history,
      userContent,
      reserveTokens: aiState.config.maxTokens,
    });

    const config = {
      endpoint: aiState.config.endpoint,
      model: aiState.config.model,
      apiKey: aiState.config.apiKey,
      temperature: aiState.config.temperature,
      maxTokens: aiState.config.maxTokens,
    };

    generationController = new AbortController();
    let tokenCount = 0;
    assistantMsg.toolNotes = [];

    try {
      if (aiState.agentEnabled) {
        await ensureMcpTools();
        const workspace = buildWorkspaceContext();
        const activeMcpTools = mcpTools.filter((tool) => workspace.mcpServers.some(
          (server) => server.id === tool.serverId && server.enabled,
        ));
        const tools = buildAgentTools(workspace, activeMcpTools);
        stepPrefix = '';
        let rawText = '';

        const result = await runAgentTurn({
          config,
          messages: payload.messages,
          tools,
          context: workspace,
          maxSteps: 6,
          contextTokens: 8192,
          reserveTokens: aiState.config.maxTokens,
          signal: generationController.signal,
          onStepStart: (step) => {
            const current = assistantMsg.text;
            stepPrefix = step > 0 && current && current !== m.copilotThinking()
              ? `${current}\n\n`
              : '';
          },
          onToken: (_delta, full) => {
            assistantMsg.text = `${stepPrefix}${full}`;
            tokenCount += 1;
            if (tokenCount % 12 === 0) scrollToBottom();
          },
          onToolStart: (event) => {
            assistantMsg.toolNotes = [...(assistantMsg.toolNotes ?? []), toolNote(event)];
            agentStatus = toolNote(event);
          },
          onToolEnd: (event) => {
            const notes = [...(assistantMsg.toolNotes ?? [])];
            if (notes.length) notes[notes.length - 1] = toolNote(event, true);
            assistantMsg.toolNotes = notes;
            agentStatus = '';
          },
          requestApproval,
          audit: (record) => aiState.recordAudit(record),
        });

        rawText = result.content;
        if (!rawText.trim() && result.stoppedReason === 'max-steps') {
          assistantMsg.text = `${stepPrefix}${m.copilotMaxSteps()}`;
          assistantMsg.error = true;
        } else {
          assistantMsg.text = `${stepPrefix}${rawText}`.trim();
        }
        assistantMsg.parsedMutations = parseMutationBlocks(rawText);
        assistantMsg.parsedSequence = parseDnaBlocks(rawText) ?? undefined;
      } else {
        const rawText = await streamChat(
          config,
          payload.messages,
          {
            timeoutMs: 60_000,
            signal: generationController.signal,
            onToken: (_delta, full) => {
              assistantMsg.text = full;
              tokenCount += 1;
              if (tokenCount % 12 === 0) scrollToBottom();
            },
          },
        );

        assistantMsg.text = rawText;
        assistantMsg.parsedMutations = parseMutationBlocks(rawText);
        assistantMsg.parsedSequence = parseDnaBlocks(rawText) ?? undefined;
      }
    } catch (err) {
      const cancelled = err instanceof AiRequestError
        && err.kind === 'network'
        && err.message === 'request cancelled';
      if (cancelled) {
        assistantMsg.text = assistantMsg.text && assistantMsg.text !== m.copilotThinking()
          ? `${assistantMsg.text}\n\n_${m.copilotCancelled()}_`
          : m.copilotCancelled();
        assistantMsg.error = true;
      } else {
        const detail = describeAiError(err);
        assistantMsg.text = m.copilotRequestError({ msg: detail });
        assistantMsg.error = true;
        pushToast('error', m.copilotRequestFailed(), detail);
      }
    } finally {
      generationController = null;
      agentStatus = '';
      resolveApproval(false);
      aiState.isGenerating = false;
      scrollToBottom();
    }
  }

  function handleQuickAction(type: 'mut' | 'codon' | 'sop') {
    if (type === 'mut') {
      inputVal = m.copilotQuickMutPrompt();
    } else if (type === 'codon') {
      inputVal = m.copilotQuickCodonPrompt();
    } else {
      inputVal = m.copilotQuickSopPrompt();
    }
    sendMessage();
  }

  // Action: Apply DNA sequence to gene workbench. The model reply is
  // untrusted: validate the alphabet and confirm before replacing a construct.
  function applyDna(seq: string) {
    const checked = validateDnaSequence(seq);
    if (checked.error) {
      pushToast('error', m.copilotInvalidDna(), checked.error);
      return;
    }
    if (!aiState.onApplyDnaSequence) {
      pushToast('error', m.copilotToastLoadFail(), m.copilotToastNoGeneEditor());
      return;
    }
    if (!confirm(m.copilotConfirmDnaApply({ n: checked.sequence.length }))) return;

    aiState.onApplyDnaSequence(checked.sequence);
    pushToast(
      'success',
      m.copilotToastLoadDnaSuccess(),
      m.copilotToastLoadDnaDesc()
    );
  }

  // Action: Apply protein sequence
  function applyProtein(seq: string) {
    const clean = String(seq ?? '').trim().toUpperCase();
    if (!/^[ACDEFGHIKLMNPQRSTVWY]+$/.test(clean)) {
      pushToast('error', m.copilotInvalidProtein(), m.copilotInvalidProteinDesc());
      return;
    }
    if (aiState.onApplyProteinSequence) {
      aiState.onApplyProteinSequence(clean);
      pushToast(
        'success',
        m.copilotToastLoadProteinSuccess(),
        m.copilotToastLoadProteinDesc()
      );
    } else {
      pushToast(
        'error',
        m.copilotToastLoadFail(),
        m.copilotToastNoProteinEditor()
      );
    }
  }

  // Action: Import mutation list
  function importMutations(muts: { pos: number; from: string; to: string }[]) {
    const checked = validateMutations(muts, aiState.proteinContext.sequence);
    if (checked.errors.length) {
      pushToast('error', m.copilotInvalidMutation(), checked.errors[0]);
      return;
    }
    if (!checked.valid.length) return;
    if (!aiState.onImportMutations) {
      pushToast('error', m.copilotToastLoadFail(), m.copilotToastNoProteinMut());
      return;
    }

    aiState.onImportMutations(checked.valid);
    pushToast(
      'success',
      m.copilotToastImportMutSuccess(),
      m.copilotToastImportMutDesc({ n: checked.valid.length })
    );
  }

  onMount(() => {
    mcpServers = loadMcpServers();
    scrollToBottom();
    return () => {
      resolveApproval(false);
    };
  });
</script>

{#if aiState.isOpen}
  <aside class="ai-sidebar pix-panel" data-testid="ai-panel">
    <!-- Header -->
    <header class="ai-sidebar-header">
      <div class="ai-title">
        <Sparkles size={14} class="glow" />
        <span>{m.aiWorkspaceTitle()}</span>
      </div>
      <div class="ai-actions">
        <button class="pix-btn-reset header-btn" data-testid="ai-config-toggle" onclick={() => showConfig = !showConfig} title={m.copilotSettings()}>
          <Settings size={13} class={showConfig ? 'active-icon' : ''} />
        </button>
        <button class="pix-btn-reset header-btn" onclick={() => aiState.clearHistory()} title={m.appReset()}>
          <RotateCcw size={13} />
        </button>
        <button class="pix-btn-reset header-close" onclick={closeCopilot}>
          <X size={14} />
        </button>
      </div>
    </header>

    <!-- Configuration Settings Pane -->
    {#if showConfig}
      <div class="ai-config-pane" data-testid="ai-config-pane">
        <div class="config-title">{m.copilotSettings()}</div>
        <div class="form-group">
          <label for="endpoint-input">{m.aiApiEndpoint()}</label>
          <input id="endpoint-input" class="pix-input" type="text" bind:value={aiState.config.endpoint} />
        </div>
        <div class="form-group">
          <label for="model-input">{m.aiTargetModel()}</label>
          <input id="model-input" class="pix-input" type="text" list="ai-model-options" bind:value={aiState.config.model} />
          <datalist id="ai-model-options">
            {#each discoveredModels as model}
              <option value={model}></option>
            {/each}
          </datalist>
          <div class="connection-row">
            <button
              class="pix-btn-reset action-btn"
              onclick={handleTestConnection}
              disabled={connectionState === 'testing'}
            >
              {#if connectionState === 'testing'}
                <RefreshCw size={11} class="spin" style="margin-right: 3px;" />
              {:else}
                <Zap size={11} style="margin-right: 3px;" />
              {/if}
              {connectionState === 'testing' ? m.aiTestingConnection() : m.aiTestConnection()}
            </button>
            {#if connectionState !== 'idle' && connectionState !== 'testing'}
              <span class="connection-status {connectionState}" title={connectionDetail}>
                {connectionDetail}
              </span>
            {/if}
          </div>
        </div>
        <div class="form-group">
          <label for="api-key-input">{m.aiApiKey()}</label>
          <input id="api-key-input" class="pix-input" type="password" autocomplete="off" bind:value={aiState.config.apiKey} />
        </div>
        <div class="form-group">
          <label for="temperature-input">{m.aiTemperature()}</label>
          <input id="temperature-input" class="pix-input" type="number" min="0" max="2" step="0.1" bind:value={aiState.config.temperature} />
        </div>
        <div class="form-group">
          <label for="prompt-input">{m.aiSystemPrompt()}</label>
          <textarea id="prompt-input" class="pix-textarea" rows={6} bind:value={aiState.config.systemPrompt}></textarea>
        </div>

        <label class="agent-toggle" title={m.aiAgentModeDesc()}>
          <input
            type="checkbox"
            data-testid="ai-agent-enabled"
            checked={aiState.agentEnabled}
            onchange={(event) => aiState.setAgentEnabled(event.currentTarget.checked)}
          />
          <span><Bot size={12} /> {m.aiAgentMode()}</span>
        </label>

        <details class="config-section" bind:open={showMcp}>
          <summary><Plug size={11} /> {m.aiMcpServers()} ({mcpServers.length})</summary>
          <div class="mcp-toolbar">
            <button class="pix-btn-reset action-btn" onclick={addMcpServer}><Plus size={11} /> {m.aiMcpAdd()}</button>
            <button class="pix-btn-reset action-btn" onclick={() => refreshMcpTools()} disabled={mcpLoading}>
              <RefreshCw size={11} class={mcpLoading ? 'spin' : ''} /> {m.aiMcpRefresh()}
            </button>
          </div>
          {#each mcpServers as server (server.id)}
            <div class="mcp-server">
              <div class="mcp-row">
                <input type="checkbox" bind:checked={server.enabled} onchange={persistMcpServers} title={m.aiMcpEnabled()} />
                <input class="pix-input mcp-name" bind:value={server.name} onchange={persistMcpServers} placeholder={m.aiMcpName()} />
                <button class="pix-btn-reset mcp-remove" onclick={() => removeMcpServer(server.id)} title={m.delete()}><Trash2 size={11} /></button>
              </div>
              <input class="pix-input" bind:value={server.command} onchange={persistMcpServers} placeholder={m.aiMcpCommand()} />
              <input
                class="pix-input"
                value={server.args.join(' ')}
                onchange={(event) => setMcpArgs(server, event.currentTarget.value)}
                placeholder={m.aiMcpArgs()}
              />
              <textarea
                class="pix-textarea mcp-env"
                rows={2}
                value={JSON.stringify(server.env)}
                onchange={(event) => setMcpEnv(server, event.currentTarget.value)}
                placeholder={m.aiMcpEnv()}
              ></textarea>
            </div>
          {/each}
          {#if mcpErrors.length}
            <div class="mcp-errors">{mcpErrors.join(' · ')}</div>
          {/if}
          <div class="mcp-tools-count">{m.aiMcpToolsFound({ n: mcpTools.length })}</div>
        </details>

        <details class="config-section">
          <summary>{m.aiMemory()} ({aiState.memory.length})</summary>
          <div class="memory-add">
            <input class="pix-input" bind:value={newMemory} placeholder={m.aiMemoryPlaceholder()} />
            <button
              class="pix-btn-reset action-btn"
              disabled={!newMemory.trim()}
              onclick={() => { aiState.rememberFact(newMemory, []); newMemory = ''; }}
            ><Plus size={11} /></button>
          </div>
          {#each aiState.memory.slice(0, 20) as entry (entry.id)}
            <div class="memory-row">
              <span>{entry.text}</span>
              <button class="pix-btn-reset mcp-remove" onclick={() => aiState.forgetMemory(entry.id)} title={m.delete()}><Trash2 size={11} /></button>
            </div>
          {/each}
        </details>

        <details class="config-section" bind:open={showAudit}>
          <summary data-testid="ai-audit-summary"><Activity size={11} /> {m.aiAudit()} ({aiState.audit.length})</summary>
          {#if aiState.audit.length}
            <div class="audit-list">
              {#each aiState.audit.slice(0, 15) as entry (entry.id)}
                <div class="audit-row" data-testid="ai-audit-row">
                  <span class="audit-time">{entry.at.slice(11, 19)}</span>
                  <span class="audit-tool">{entry.tool}</span>
                  <span class="audit-kind {entry.ok ? 'ok' : 'bad'}">{entry.kind}{entry.approved === false ? ' · rejected' : ''}</span>
                  <span class="audit-summary" title={entry.summary}>{entry.summary}</span>
                </div>
              {/each}
            </div>
            <div class="mcp-toolbar">
              {#if aiState.onUndoAiChange}
                <button class="pix-btn-reset action-btn" onclick={() => aiState.onUndoAiChange?.()}><Undo2 size={11} /> {m.aiUndo()} </button>
              {/if}
              <button class="pix-btn-reset action-btn" onclick={() => aiState.clearAuditLog()}>{m.aiAuditClear()}</button>
            </div>
          {:else}
            <div class="mcp-tools-count">{m.aiAuditEmpty()}</div>
          {/if}
        </details>

        <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
          <button class="pix-btn-reset action-btn" onclick={() => showConfig = false} style="font-size: 10px;">
            <Check size={11} style="margin-right: 3px;" /> {m.copilotBtnSaveReturn()}
          </button>
        </div>
      </div>
    {/if}

    <!-- Live Context Inspector Banner -->
    <div class="ai-context-inspector">
      <div class="inspector-header">
        <div class="sync-indicator">
          <span class="pulse-dot"></span>
          <span>{m.copilotLiveContext()}</span>
        </div>
        <span class="workspace-label">
          {#if aiState.proteinContext?.sequence && aiState.onApplyProteinSequence}
            {m.tabProtStructure()}
          {:else if aiState.geneContext?.dnaSequence && aiState.onApplyDnaSequence}
            {m.tabGene()}
          {:else}
            General
          {/if}
        </span>
      </div>

      {#if aiState.proteinContext?.sequence}
        <div class="inspector-body">
          <div class="sequence-mini font-mono">
            <strong>Seq:</strong> {aiState.proteinContext.sequence.slice(0, 24)}... ({aiState.proteinContext.sequence.length} aa)
          </div>
          <div class="env-row">
            <span class="env-badge" title={m.copilotMutationPh()}>pH {aiState.proteinContext.env.ph.toFixed(1)}</span>
            <span class="env-badge" title={m.copilotEnvThermoTemp()}>T {aiState.proteinContext.env.tempK} K</span>
            {#if aiState.proteinContext.metrics}
              <span class="env-badge-accent" title={m.copilotEnvM1Fluctuation()}>m1 {Number(aiState.proteinContext.metrics.m1 || 0).toFixed(3)}</span>
            {/if}
          </div>
        </div>
      {:else}
        <div class="inspector-body">
          {#if aiState.geneContext?.dnaSequence}
            <div class="sequence-mini font-mono">
              <strong>DNA:</strong> {aiState.geneContext.dnaSequence.slice(0, 20)}... ({aiState.geneContext.dnaSequence.length} bp)
            </div>
            <div class="env-row">
              <span class="env-badge">GC {aiState.geneContext.gcContent.toFixed(1)}%</span>
              <span class="env-badge-accent" style="color: var(--pix-accent-2);">{aiState.geneContext.codonHost || 'E. coli'}</span>
            </div>
          {:else}
            <div class="sequence-empty">
              {m.copilotUnlinkedGene()}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Navigation Tabs -->
    <div class="ai-tabs-bar">
      <button 
        class="pix-btn-reset tab-btn {aiState.activeTab === 'chat' ? 'active-tab' : ''}" 
        onclick={() => aiState.activeTab = 'chat'}
      >
        <MessageSquare size={12} />
        <span>{m.copilotTabChat()}</span>
      </button>
      <button 
        class="pix-btn-reset tab-btn {aiState.activeTab === 'tools' ? 'active-tab' : ''}" 
        onclick={() => aiState.activeTab = 'tools'}
      >
        <Sliders size={12} />
        <span>{m.copilotTabTools()}</span>
      </button>
    </div>

    <!-- MAIN PANEL CONTENT -->
    {#if aiState.activeTab === 'chat'}
      <!-- 1. CHAT PANEL -->
      <div class="ai-messages" data-testid="ai-messages" bind:this={messagesContainer}>
        {#each aiState.messages as msg (msg.id)}
          <div class="msg-wrapper msg-{msg.role}" data-testid="ai-message" data-role={msg.role}>
            <div class="msg-header">
              <span class="msg-sender">{msg.role === 'user' ? 'RedElectricity' : 'SPICE AI'}</span>
              <span class="msg-time">{msg.timestamp}</span>
            </div>
            <div class="msg-body">
              {#if msg.role === 'assistant'}
                {#if msg.toolNotes?.length}
                  <div class="tool-notes" data-testid="ai-tool-notes">
                    {#each msg.toolNotes as note}
                      <span class="tool-note" data-testid="ai-tool-note"><Bot size={10} /> {note}</span>
                    {/each}
                  </div>
                {/if}
                <div class="markdown-body" style="word-break: break-word;">
                  {@html renderMarkdown(msg.text)}
                </div>

                {#if msg.parsedMutations}
                  <div class="ai-interactive-card pix-panel">
                    <div class="card-desc">
                      {m.copilotCardMutDetected({ n: msg.parsedMutations.length })}
                    </div>
                    <button class="pix-btn-reset card-action" onclick={() => importMutations(msg.parsedMutations!)}>
                      <Layers size={12} /> {m.copilotCardMutBtn()}
                    </button>
                  </div>
                {/if}

                {#if msg.parsedSequence}
                  <div class="ai-interactive-card pix-panel">
                    <div class="card-desc">
                      {m.copilotCardDnaDetected({ n: msg.parsedSequence.length })}
                    </div>
                    <button class="pix-btn-reset card-action" onclick={() => applyDna(msg.parsedSequence!)}>
                      <Dna size={12} /> {m.copilotCardDnaBtn()}
                    </button>
                  </div>
                {/if}
              {:else}
                <p style="white-space: pre-wrap; margin: 0; line-height: 1.3;">{msg.text}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>

      <!-- Quick action templates -->
      <div class="ai-quick-templates">
        <button class="pix-btn-reset template-tag" onclick={() => handleQuickAction('mut')}>
          {m.tabMut()}
        </button>
        <button class="pix-btn-reset template-tag" onclick={() => handleQuickAction('codon')}>
          {m.tabGene()}
        </button>
        <button class="pix-btn-reset template-tag" onclick={() => handleQuickAction('sop')}>
          {m.copilotToolSop()}
        </button>
      </div>

      <!-- Input area -->
      <footer class="ai-input-area">
        {#if agentStatus}
          <div class="agent-status"><RefreshCw size={10} class="spin" /> {agentStatus}</div>
        {/if}
        <textarea
          class="pix-textarea ai-input-box"
          data-testid="ai-input"
          rows={2}
          bind:value={inputVal}
          placeholder={m.copilotInputPlaceholder()}
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        ></textarea>
        <button
          class="pix-btn-reset send-btn {aiState.isGenerating ? 'loading' : ''}"
          data-testid="ai-send"
          disabled={!aiState.isGenerating && !inputVal.trim()}
          onclick={aiState.isGenerating ? cancelGeneration : sendMessage}
        >
          {#if aiState.isGenerating}
            <Square size={12} />
          {:else}
            <Send size={13} />
          {/if}
        </button>
      </footer>

    {:else}
      <!-- 2. CALCULATOR/TOOLBOX PANEL -->
      <div class="ai-toolbox">
        <!-- Sub-selector tabs -->
        <div class="toolbox-selector-bar">
          <button 
            class="pix-btn-reset tool-selector-btn {aiState.activeTool === 'mutation' ? 'active-tool' : ''} {aiState.currentWorkspace !== 'protein' ? 'tool-disabled' : ''}"
            onclick={() => switchTool('mutation')}
            title={aiState.currentWorkspace !== 'protein' ? m.copilotToolProteinOnly() : ''}
          >
            <Activity size={10} />
            <span>{m.copilotToolMutation()}</span>
          </button>
          <button 
            class="pix-btn-reset tool-selector-btn {aiState.activeTool === 'codon' ? 'active-tool' : ''} {aiState.currentWorkspace !== 'gene' ? 'tool-disabled' : ''}"
            onclick={() => switchTool('codon')}
            title={aiState.currentWorkspace !== 'gene' ? m.copilotToolGeneOnly() : ''}
          >
            <Dna size={10} />
            <span>{m.copilotToolCodon()}</span>
          </button>
          <button 
            class="pix-btn-reset tool-selector-btn {aiState.activeTool === 'sop' ? 'active-tool' : ''} {aiState.currentWorkspace !== 'gene' ? 'tool-disabled' : ''}"
            onclick={() => switchTool('sop')}
            title={aiState.currentWorkspace !== 'gene' ? m.copilotToolGeneOnly() : ''}
          >
            <Beaker size={10} />
            <span>{m.copilotToolSop()}</span>
          </button>
        </div>

        <div class="toolbox-content-container">
          <!-- TOOL 1: MUTATION STABILIZER -->
          {#if aiState.activeTool === 'mutation'}
            <div class="tool-view">
              <div class="tool-banner">
                <Zap size={12} class="flash-icon" />
                <span>{m.copilotMutationBanner()}</span>
              </div>

              <!-- Live Context Link Indicator -->
              {#if aiState.proteinContext?.sequence}
                <div class="context-linked-alert">
                  <div class="green-dot"></div>
                  <span>{m.copilotLinkedProtein({ n: aiState.proteinContext.sequence.length })}</span>
                </div>
              {:else}
                <div class="context-warning-alert">
                  <AlertCircle size={10} />
                  <span>{m.copilotUnlinkedProtein()}</span>
                </div>
              {/if}

              <!-- Input form -->
              <div class="tool-form">
                <div class="form-row-2">
                  <div class="form-item">
                    <label for="mut-pos">{m.copilotMutationPosition()}</label>
                    <input id="mut-pos" type="number" class="pix-input" min="1" max={aiState.proteinContext?.sequence?.length || 500} bind:value={aiState.mutTool.pos} />
                  </div>
                  <div class="form-item">
                    <label for="mut-from">{m.copilotMutationWildtype()}</label>
                    <input id="mut-from" type="text" class="pix-input text-center font-mono" maxlength="1" bind:value={aiState.mutTool.fromRes} placeholder="A" />
                  </div>
                </div>

                <div class="form-row-2">
                  <div class="form-item">
                    <label for="mut-to">{m.copilotMutationMutant()}</label>
                    <select id="mut-to" class="pix-select font-mono" bind:value={aiState.mutTool.toRes}>
                      {#each ['A','C','D','E','F','G','H','I','K','L','M','N','P','Q','R','S','T','V','W','Y'] as aa}
                        <option value={aa}>{aa}</option>
                      {/each}
                    </select>
                  </div>
                  <div class="form-item">
                    <label for="mut-ph">{m.copilotMutationPh()}</label>
                    <input id="mut-ph" type="number" class="pix-input" min="1" max="14" step="0.5" bind:value={aiState.mutTool.ph} />
                  </div>
                </div>

                <div class="form-item">
                  <label for="mut-temp">{m.copilotMutationTemp()}</label>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <input id="mut-temp" type="range" min="250" max="450" step="5" bind:value={aiState.mutTool.tempK} style="flex: 1; accent-color: var(--pix-accent);" />
                    <span class="font-mono text-xs" style="min-width: 45px;">{aiState.mutTool.tempK} K</span>
                  </div>
                </div>

                <button 
                  class="pix-btn-reset calc-submit-btn {aiState.mutTool.isCalculating ? 'btn-running' : ''}"
                  disabled={aiState.mutTool.isCalculating}
                  onclick={() => aiState.runMutationCalculation()}
                >
                  {#if aiState.mutTool.isCalculating}
                    <RefreshCw size={11} class="spin" /> {m.copilotMutationBtnRunning()}
                  {:else}
                    <Zap size={11} /> {m.copilotMutationBtnRun()}
                  {/if}
                </button>
              </div>

              <!-- Results display -->
              {#if aiState.mutTool.result}
                <div class="tool-results-panel pix-panel">
                  <div class="result-headline">
                    <span>{m.copilotReportHeadline()}</span>
                    <span class="ddg-badge {aiState.mutTool.result.isStable ? 'stable-ddg' : 'unstable-ddg'}">
                      ΔΔG = {aiState.mutTool.result.ddG > 0 ? '+' : ''}{aiState.mutTool.result.ddG.toFixed(2)} kcal/mol
                    </span>
                  </div>

                  <div class="metric-grid-2">
                    <div class="metric-card">
                      <span class="m-label">{m.copilotReportHeadline()}</span>
                      <span class="m-value font-mono">{aiState.mutTool.result.classification}</span>
                      <span class="m-desc">{aiState.mutTool.result.isStable ? 'Stabilizing' : 'Destabilizing'}</span>
                    </div>
                    <div class="metric-card">
                      <span class="m-label">{m.copilotMetricNeutralize()}</span>
                      <span class="m-value font-mono {aiState.mutTool.result.solventNeutralize !== 'Neutral' ? 'text-accent' : ''}">
                        {aiState.mutTool.result.solventNeutralize === 'Neutral' ? 'Neutral' : aiState.mutTool.result.solventNeutralize}
                      </span>
                      <span class="m-desc">Net Charge: {aiState.mutTool.result.chargeChange > 0 ? '+' : ''}{aiState.mutTool.result.chargeChange}e</span>
                    </div>
                  </div>

                  <div class="result-explanation">
                    {@html renderMarkdown(aiState.mutTool.result.explanation)}
                  </div>

                  <button 
                    class="pix-btn-reset result-import-btn"
                    onclick={() => importMutations([{ pos: aiState.mutTool.pos, from: aiState.mutTool.fromRes, to: aiState.mutTool.toRes }])}
                  >
                    <Layers size={11} /> {m.copilotBtnImportSingle()}
                  </button>
                </div>
              {/if}
            </div>
          {/if}

          <!-- TOOL 2: CODON OPTIMIZER -->
          {#if aiState.activeTool === 'codon'}
            <div class="tool-view">
              <div class="tool-banner">
                <Dna size={12} class="flash-icon" style="color: var(--pix-accent-2);" />
                <span>{m.copilotCodonBanner()}</span>
              </div>

              {#if aiState.geneContext?.dnaSequence}
                <div class="context-linked-alert">
                  <div class="green-dot"></div>
                  <span>{m.copilotLinkedGene({ n: aiState.geneContext.dnaSequence.length })}</span>
                </div>
              {:else}
                <div class="context-warning-alert">
                  <AlertCircle size={10} />
                  <span>{m.copilotUnlinkedGene()}</span>
                </div>
              {/if}

              <div class="tool-form">
                <div class="form-item">
                  <label for="codon-host">{m.copilotCodonHost()}</label>
                  <select id="codon-host" class="pix-select" bind:value={aiState.codonTool.host}>
                    <option value="E. coli">E. coli</option>
                    <option value="Yeast">S. cerevisiae</option>
                    <option value="Human">H. sapiens</option>
                  </select>
                </div>

                <div class="form-item">
                  <label for="codon-gc">{m.copilotCodonGc()}</label>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <input id="codon-gc" type="range" min="35" max="65" step="1" bind:value={aiState.codonTool.targetGc} style="flex: 1; accent-color: var(--pix-accent-2);" />
                    <span class="font-mono text-xs" style="min-width: 35px;">{aiState.codonTool.targetGc}%</span>
                  </div>
                </div>

                <div class="form-item">
                  <span class="form-item-label">{m.copilotCodonAvoid()}</span>
                  <div class="checkbox-row">
                    <label class="pix-checkbox-lbl">
                      <input type="checkbox" bind:checked={aiState.codonTool.avoidBsaI} />
                      <span>BsaI</span>
                    </label>
                    <label class="pix-checkbox-lbl">
                      <input type="checkbox" bind:checked={aiState.codonTool.avoidBsmBI} />
                      <span>BsmBI</span>
                    </label>
                    <label class="pix-checkbox-lbl">
                      <input type="checkbox" bind:checked={aiState.codonTool.avoidEcoRI} />
                      <span>EcoRI</span>
                    </label>
                  </div>
                </div>

                <button 
                  class="pix-btn-reset opt-submit-btn {aiState.codonTool.isOptimizing ? 'btn-running' : ''}"
                  disabled={aiState.codonTool.isOptimizing}
                  onclick={() => aiState.runCodonOptimization()}
                >
                  {#if aiState.codonTool.isOptimizing}
                    <RefreshCw size={11} class="spin" /> {m.copilotCodonBtnRunning()}
                  {:else}
                    <Dna size={11} /> {m.copilotCodonBtnRun()}
                  {/if}
                </button>
              </div>

              {#if aiState.codonTool.result}
                <div class="tool-results-panel pix-panel" style="border-color: var(--pix-accent-2);">
                  <div class="result-headline" style="color: var(--pix-accent-2);">
                    <span>{m.copilotCodonReport()}</span>
                    <span class="ddg-badge stable-ddg" style="background: rgba(0, 200, 100, 0.1); color: var(--pix-green); border-color: var(--pix-green);">
                      {m.copilotCaiBadge({ v1: Math.round(((aiState.codonTool.result.optimizedCai - aiState.codonTool.result.initialCai)/aiState.codonTool.result.initialCai)*100) })}
                    </span>
                  </div>

                  <div class="metric-comparison-row">
                    <div class="comp-col">
                      <div class="comp-hdr">{m.copilotCodonGcChange()}</div>
                      <div class="comp-val font-mono">
                        <span class="old-val">{aiState.codonTool.result.initialGc}%</span>
                        <span class="arrow">→</span>
                        <span class="new-val text-green">{aiState.codonTool.result.optimizedGc}%</span>
                      </div>
                    </div>
                    <div class="comp-col">
                      <div class="comp-hdr">{m.copilotCodonCaiChange()}</div>
                      <div class="comp-val font-mono">
                        <span class="old-val">{aiState.codonTool.result.initialCai}</span>
                        <span class="arrow">→</span>
                        <span class="new-val text-green">{aiState.codonTool.result.optimizedCai}</span>
                      </div>
                    </div>
                  </div>

                  <div class="results-meta font-mono text-xs">
                    <div>• {m.copilotCodonMutatedCount({ n: aiState.codonTool.result.mutatedCodonsCount })}</div>
                    <div>• {m.copilotCodonAvoidedCount({ n: aiState.codonTool.result.avoidedCount })}</div>
                  </div>

                  <div class="sequence-view-box">
                    <div class="seq-box-header">
                      <span>{m.copilotCodonSequenceTitle()}</span>
                      <button class="pix-btn-reset copy-seq-btn" onclick={() => {
                        if (aiState.codonTool.result) {
                          navigator.clipboard.writeText(aiState.codonTool.result.optimizedDna);
                          pushToast('success', m.copySuccess(), m.copilotCodonCopyDesc());
                        }
                      }}>{m.labelCopy()}</button>
                    </div>
                    <textarea class="seq-textarea font-mono" readonly>{aiState.codonTool.result?.optimizedDna || ''}</textarea>
                  </div>

                  <button 
                    class="pix-btn-reset result-import-btn"
                    style="color: var(--pix-accent-2); border-color: var(--pix-accent-2); background: rgba(var(--pix-accent-2-rgb), 0.1);"
                    onclick={() => applyDna(aiState.codonTool.result!.optimizedDna)}
                  >
                    <Check size={11} /> {m.copilotCodonBtnApply()}
                  </button>
                </div>
              {/if}
            </div>
          {/if}

          <!-- TOOL 3: SOP GENERATOR -->
          {#if aiState.activeTool === 'sop'}
            <div class="tool-view">
              <div class="tool-banner">
                <Beaker size={12} class="flash-icon" style="color: var(--pix-green);" />
                <span>{m.copilotSopBanner()}</span>
              </div>

              <div class="tool-form">
                <div class="form-item">
                  <label for="sop-method">{m.copilotSopMethod()}</label>
                  <select id="sop-method" class="pix-select" bind:value={aiState.sopTool.method}>
                    <option value="Golden Gate">Golden Gate Assembly</option>
                    <option value="Gibson Assembly">Gibson Assembly</option>
                  </select>
                </div>

                <div class="form-row-2">
                  <div class="form-item">
                    <label for="sop-enzyme">{m.copilotSopEnzyme()}</label>
                    <select id="sop-enzyme" class="pix-select" bind:value={aiState.sopTool.enzyme} disabled={aiState.sopTool.method !== 'Golden Gate'}>
                      <option value="BsaI">BsaI-HF v2</option>
                      <option value="BsmBI">BsmBI-v2</option>
                    </select>
                  </div>
                  <div class="form-item">
                    <label for="sop-poly">{m.copilotSopPolymerase()}</label>
                    <select id="sop-poly" class="pix-select" bind:value={aiState.sopTool.polymerase}>
                      <option value="Phanta MasterMix">Phanta Max</option>
                      <option value="Q5 High-Fidelity">Q5 Polymerase</option>
                      <option value="Taq Polymerase">Taq Mix</option>
                    </select>
                  </div>
                </div>

                <button 
                  class="pix-btn-reset sop-submit-btn {aiState.sopTool.isGenerating ? 'btn-running' : ''}"
                  disabled={aiState.sopTool.isGenerating}
                  onclick={() => aiState.runSopGeneration()}
                >
                  {#if aiState.sopTool.isGenerating}
                    <RefreshCw size={11} class="spin" /> {m.copilotSopBtnRunning()}
                  {:else}
                    <Beaker size={11} /> {m.copilotSopBtnRun()}
                  {/if}
                </button>
              </div>

              {#if aiState.sopTool.result}
                <div class="tool-results-panel pix-panel" style="border-color: var(--pix-green);">
                  <div class="result-headline" style="color: var(--pix-green);">
                    <span>{aiState.sopTool.result.title}</span>
                    <button class="pix-btn-reset copy-seq-btn" style="border-color: var(--pix-green); color: var(--pix-green);" onclick={() => copyToClipboard(getSopMarkdown())}>
                      <Copy size={10} /> {m.copyMarkdown()}
                    </button>
                  </div>

                  <!-- Primers -->
                  <div class="primers-card">
                    <div class="primer-title">{m.copilotSopPrimersTitle()}</div>
                    <div class="primer-row">
                      <span class="p-lbl">Fwd Primer (5'-3'):</span>
                      <span class="p-val font-mono">{aiState.sopTool.result.fwdPrimer}</span>
                    </div>
                    <div class="primer-row">
                      <span class="p-lbl">Rev Primer (5'-3'):</span>
                      <span class="p-val font-mono">{aiState.sopTool.result.revPrimer}</span>
                    </div>
                    <div class="primer-meta font-mono text-xs">
                      {m.copilotSopPrimersMeta({ tm: aiState.sopTool.result.primerTm, len: aiState.sopTool.result.productLength })}
                    </div>
                  </div>

                  <!-- PCR Recipe -->
                  <div class="recipe-section">
                    <div class="section-title">{m.copilotSopStep1()}</div>
                    <table class="recipe-table font-mono">
                      <thead>
                        <tr>
                          <th>{m.copilotSopTableComponent()}</th>
                          <th>{m.copilotSopTableVolume()}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each aiState.sopTool.result.pcrRecipe as row}
                          <tr>
                            <td>{row.component}</td>
                            <td class="text-right">{row.volume.toFixed(1)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>

                  <!-- PCR Cycling -->
                  <div class="recipe-section">
                    <div class="section-title">{m.copilotSopStep2()}</div>
                    <table class="recipe-table font-mono cycling-table">
                      <thead>
                        <tr>
                          <th>{m.copilotSopTableStep()}</th>
                          <th>{m.copilotSopTableParams()}</th>
                          <th>{m.copilotSopTableTime()}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each aiState.sopTool.result.pcrCycles as cycle}
                          <tr>
                            <td class="cycle-step">{cycle.step}</td>
                            <td>{cycle.temp}</td>
                            <td>{cycle.time}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>

                  <!-- Assembly Recipe -->
                  <div class="recipe-section">
                    <div class="section-title">{m.copilotSopStep3({ method: aiState.sopTool.method })}</div>
                    <table class="recipe-table font-mono">
                      <thead>
                        <tr>
                          <th>{m.copilotSopTableComponent()}</th>
                          <th>{m.copilotSopTableVolume()}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each aiState.sopTool.result.assemblyRecipe as row}
                          <tr>
                            <td>{row.component}</td>
                            <td class="text-right">{row.volume.toFixed(1)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>

                  <!-- Assembly Program -->
                  <div class="recipe-section">
                    <div class="section-title">{m.copilotSopStep4()}</div>
                    <table class="recipe-table font-mono cycling-table">
                      <thead>
                        <tr>
                          <th>{m.copilotSopTableStep()}</th>
                          <th>{m.copilotSopTableParams()}</th>
                          <th>{m.copilotSopTableTime()}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each aiState.sopTool.result.assemblyCycles as cycle}
                          <tr>
                            <td class="cycle-step">{cycle.step}</td>
                            <td>{cycle.temp}</td>
                            <td>{cycle.time}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if approvalData}
      <div class="approval-overlay" data-testid="ai-approval">
        <div class="approval-box pix-panel">
          <div class="approval-title"><ShieldCheck size={14} /> {m.aiApprovalTitle()}</div>
          <div class="approval-tool"><strong>{approvalData.toolName}</strong> · {approvalData.permission}</div>
          <pre class="approval-preview">{approvalData.preview}</pre>
          <details class="approval-args">
            <summary>{m.aiApprovalArgs()}</summary>
            <pre>{approvalData.args}</pre>
          </details>
          <div class="approval-actions">
            <button class="pix-btn-reset action-btn reject-btn" data-testid="ai-reject" onclick={() => resolveApproval(false)}>
              <X size={12} /> {m.aiApprovalReject()}
            </button>
            <button class="pix-btn-reset action-btn approve-btn" data-testid="ai-approve" onclick={() => resolveApproval(true)}>
              <Play size={12} /> {m.aiApprovalApprove()}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .ai-sidebar {
    position: relative;
    width: 320px;
    height: 100%;
    background: var(--pix-bg-3);
    border-left: 3px solid var(--pix-border);
    display: flex;
    flex-direction: column;
    z-index: 120;
    box-shadow: -4px 0 0 rgba(0, 0, 0, 0.4);
    font-family: var(--pix-font), sans-serif;
  }
  
  .ai-sidebar-header {
    flex: 0 0 auto;
    padding: 8px 12px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .ai-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: bold;
    color: var(--pix-accent);
    font-size: 11.5px;
    text-shadow: 1px 1px 0 #000;
  }

  .glow {
    filter: drop-shadow(0 0 4px var(--pix-accent));
  }

  .ai-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-btn {
    color: var(--pix-fg-dim);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
  }
  .header-btn:hover {
    color: var(--pix-accent-2);
  }

  .header-close {
    color: var(--pix-red);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
  }

  .active-icon {
    color: var(--pix-accent);
  }

  /* Configuration Pane */
  .ai-config-pane {
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 10px;
    max-height: 56vh;
    overflow-y: auto;
    flex: 0 0 auto;
  }

  .config-title {
    font-weight: bold;
    color: var(--pix-accent-2);
    margin-bottom: 4px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .form-group label {
    color: var(--pix-fg-dim);
    font-size: 9px;
  }

  .pix-input {
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    padding: 3px 6px;
    font-family: inherit;
    font-size: 10px;
  }
  .pix-input:focus {
    border-color: var(--pix-accent);
    outline: none;
  }

  .pix-textarea {
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    padding: 4px 6px;
    font-family: inherit;
    font-size: 9.5px;
    resize: none;
  }
  .pix-textarea:focus {
    border-color: var(--pix-accent);
    outline: none;
  }

  .action-btn {
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-1);
    color: var(--pix-fg);
    padding: 3px 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
  }
  .action-btn:hover {
    border-color: var(--pix-green);
    color: var(--pix-green);
  }
  .action-btn:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .connection-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }
  .connection-status {
    font-size: 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .connection-status.ok { color: var(--pix-green); }
  .connection-status.error { color: var(--pix-red); }

  .agent-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--pix-fg);
    cursor: pointer;
  }
  .agent-toggle span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .config-section {
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-1);
    padding: 5px 6px;
    font-size: 9.5px;
  }
  .config-section summary {
    cursor: pointer;
    color: var(--pix-fg-dim);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .mcp-toolbar {
    display: flex;
    gap: 5px;
    margin: 5px 0;
    flex-wrap: wrap;
  }
  .mcp-server {
    border-top: 1px dashed var(--pix-border);
    padding-top: 5px;
    margin-top: 5px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .mcp-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .mcp-name { flex: 1 1 auto; }
  .mcp-remove {
    color: var(--pix-fg-dim);
    padding: 1px 3px;
  }
  .mcp-remove:hover { color: var(--pix-red); }
  .mcp-env { min-height: 30px; }
  .mcp-errors {
    color: var(--pix-red);
    font-size: 9px;
    white-space: pre-wrap;
    margin-top: 4px;
  }
  .mcp-tools-count {
    color: var(--pix-fg-dim);
    font-size: 9px;
    margin-top: 4px;
  }
  .memory-add {
    display: flex;
    gap: 4px;
    margin: 5px 0;
  }
  .memory-add .pix-input { flex: 1 1 auto; }
  .memory-row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    border-top: 1px dashed var(--pix-border);
    padding-top: 3px;
    margin-top: 3px;
  }
  .memory-row span {
    flex: 1 1 auto;
    overflow-wrap: anywhere;
  }
  .audit-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 5px;
    max-height: 160px;
    overflow-y: auto;
  }
  .audit-row {
    display: grid;
    grid-template-columns: 42px 78px 58px 1fr;
    gap: 3px;
    align-items: center;
    font-size: 8.5px;
    border-bottom: 1px solid var(--pix-border);
    padding-bottom: 2px;
  }
  .audit-time { color: var(--pix-fg-dim); }
  .audit-tool { color: var(--pix-accent-2); overflow: hidden; text-overflow: ellipsis; }
  .audit-kind.ok { color: var(--pix-green); }
  .audit-kind.bad { color: var(--pix-red); }
  .audit-summary { color: var(--pix-fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .tool-notes {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-bottom: 5px;
  }
  .tool-note {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 8.5px;
    color: var(--pix-accent-2);
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-1);
    padding: 1px 4px;
  }
  .agent-status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    color: var(--pix-accent-2);
    padding: 2px 4px;
  }

  .approval-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px;
    z-index: 50;
  }
  .approval-box {
    width: 100%;
    max-height: 86%;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 10px;
    border-color: var(--pix-accent);
  }
  .approval-title {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: bold;
    color: var(--pix-accent-2);
  }
  .approval-tool { color: var(--pix-fg-dim); }
  .approval-preview {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--pix-bg-1);
    border: 1px solid var(--pix-border);
    padding: 6px;
    margin: 0;
    font-family: var(--pix-font-mono, monospace);
    font-size: 9px;
    color: var(--pix-fg);
  }
  .approval-args summary { cursor: pointer; color: var(--pix-fg-dim); }
  .approval-args pre {
    max-height: 120px;
    overflow: auto;
    font-size: 8.5px;
    white-space: pre-wrap;
  }
  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .approve-btn { border-color: var(--pix-green); color: var(--pix-green); }
  .reject-btn { border-color: var(--pix-red); color: var(--pix-red); }

  /* Chat Messages */
  .ai-messages {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--pix-bg-3);
  }

  .msg-wrapper {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 90%;
  }

  .msg-user {
    align-self: flex-end;
    background: rgba(var(--pix-cyan-rgb, 0, 210, 255), 0.08);
    border: 2px solid var(--pix-cyan);
    padding: 6px 10px;
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  }

  .msg-assistant {
    align-self: flex-start;
    background: var(--pix-bg-2);
    border: 2px solid var(--pix-border);
    padding: 6px 10px;
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  }

  .msg-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8px;
    border-bottom: 1px dashed var(--pix-border);
    padding-bottom: 2px;
    margin-bottom: 4px;
  }

  .msg-sender {
    font-weight: bold;
    color: var(--pix-accent-2);
  }

  .msg-user .msg-sender {
    color: var(--pix-cyan);
  }

  .msg-time {
    color: var(--pix-fg-dim);
  }

  .msg-body {
    font-size: 10px;
    line-height: 1.4;
    color: var(--pix-fg);
    word-break: break-word;
  }

  .msg-body p {
    margin: 4px 0;
  }

  .msg-body h2 {
    font-size: 11px;
    font-weight: bold;
    color: var(--pix-accent);
    margin: 8px 0 4px 0;
    border-left: 2px solid var(--pix-accent);
    padding-left: 4px;
  }

  .msg-body h3 {
    font-size: 10.5px;
    font-weight: bold;
    color: var(--pix-accent-2);
    margin: 6px 0 3px 0;
  }

  .msg-body ul, .msg-body ol {
    margin: 4px 0;
    padding-left: 14px;
  }

  .msg-body li {
    margin: 2px 0;
  }

  .code-boundary-placeholder {
    height: 1px;
    border-bottom: 1px solid var(--pix-border);
    margin: 6px 0;
  }

  /* Interactive Card */
  .ai-interactive-card {
    background: var(--pix-bg-1);
    border: 2px solid var(--pix-border-hi);
    padding: 6px;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .card-desc {
    font-size: 9px;
    font-weight: bold;
    color: var(--pix-green);
  }

  .card-action {
    background: var(--pix-bg-2);
    border: 2px solid var(--pix-border);
    padding: 4px 8px;
    color: var(--pix-accent-2);
    font-size: 9.5px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    transition: all 0.15s;
  }
  
  .card-action:hover {
    border-color: var(--pix-accent-2);
    box-shadow: 0 0 6px var(--pix-accent-2);
  }

  /* Templates */
  .ai-quick-templates {
    flex: 0 0 auto;
    padding: 4px 8px;
    background: var(--pix-bg-2);
    border-top: 1px solid var(--pix-border);
    border-bottom: 2px solid var(--pix-border);
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }

  .template-tag {
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
    padding: 2px 8px;
    font-size: 8.5px;
    color: var(--pix-fg-dim);
    cursor: pointer;
    white-space: nowrap;
    border-radius: 2px;
  }
  .template-tag:hover {
    border-color: var(--pix-accent);
    color: var(--pix-accent);
  }

  /* Footer/Input */
  .ai-input-area {
    flex: 0 0 auto;
    padding: 8px;
    background: var(--pix-bg-2);
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .ai-input-box {
    flex: 1;
    font-size: 10px;
    background: var(--pix-bg-3);
    border-color: var(--pix-border);
    height: 36px;
  }

  .send-btn {
    width: 36px;
    height: 36px;
    background: var(--pix-bg-1);
    border: 2px solid var(--pix-border);
    color: var(--pix-accent-2);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .send-btn:hover:not(:disabled) {
    border-color: var(--pix-accent-2);
    box-shadow: 0 0 6px var(--pix-accent-2);
  }
  .send-btn:disabled {
    color: var(--pix-fg-dim);
    border-color: var(--pix-border);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .spin {
    animation: rotate 1s linear infinite;
  }

  @keyframes rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ==========================================
     NEW ADDITIONS: CONTEXT INSPECTOR, TABS, TOOLBOX
     ========================================== */

  /* 1. Context Inspector Banner */
  .ai-context-inspector {
    flex: 0 0 auto;
    background: var(--pix-bg-1);
    border-bottom: 2px solid var(--pix-border);
    padding: 6px 10px;
    font-size: 9px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-left: 3px solid var(--pix-accent);
  }

  .inspector-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px dashed var(--pix-border);
    padding-bottom: 2px;
  }

  .sync-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: bold;
    color: var(--pix-green);
    text-shadow: 1px 1px 0 #000;
  }

  .pulse-dot {
    width: 5px;
    height: 5px;
    background: var(--pix-green);
    border-radius: 50%;
    box-shadow: 0 0 4px var(--pix-green);
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.9); opacity: 0.6; }
    50% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(0.9); opacity: 0.6; }
  }

  .workspace-label {
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
    padding: 0px 4px;
    color: var(--pix-cyan);
    font-size: 8px;
    font-weight: bold;
  }

  .inspector-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .sequence-mini {
    color: var(--pix-fg-dim);
    font-size: 8.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sequence-empty {
    color: var(--pix-fg-dim);
    font-style: italic;
    font-size: 8.5px;
    text-align: center;
    padding: 4px 0;
  }

  .env-row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .env-badge {
    background: var(--pix-bg-2);
    border: 1px solid var(--pix-border);
    padding: 1px 4px;
    color: var(--pix-fg);
    border-radius: 2px;
    font-size: 8px;
  }

  .env-badge-accent {
    background: rgba(var(--pix-cyan-rgb, 0, 210, 255), 0.1);
    border: 1px solid var(--pix-cyan);
    padding: 1px 4px;
    color: var(--pix-cyan);
    border-radius: 2px;
    font-size: 8px;
    font-weight: bold;
  }

  /* 2. Navigation Tabs Bar */
  .ai-tabs-bar {
    flex: 0 0 auto;
    display: flex;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
  }

  .tab-btn {
    flex: 1;
    padding: 6px 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 9.5px;
    font-weight: bold;
    color: var(--pix-fg-dim);
    cursor: pointer;
    border-right: 1px solid var(--pix-border);
    transition: all 0.15s;
  }
  .tab-btn:last-child {
    border-right: none;
  }

  .tab-btn:hover {
    color: var(--pix-accent);
    background: rgba(255, 255, 255, 0.02);
  }

  .active-tab {
    color: var(--pix-accent) !important;
    background: var(--pix-bg-3) !important;
    box-shadow: inset 0 -2px 0 var(--pix-accent);
    text-shadow: 1px 1px 0 #000;
  }

  /* 3. AI Toolbox */
  .ai-toolbox {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--pix-bg-3);
  }

  .toolbox-selector-bar {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--pix-bg-2);
    border-bottom: 1px solid var(--pix-border);
  }

  .tool-selector-btn {
    flex: 1;
    padding: 4px 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 8px;
    font-weight: bold;
    color: var(--pix-fg-dim);
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-3);
    cursor: pointer;
    border-radius: 2px;
  }

  .tool-selector-btn:hover {
    border-color: var(--pix-accent-2);
    color: var(--pix-accent-2);
  }

  .active-tool {
    color: var(--pix-accent-2) !important;
    border-color: var(--pix-accent-2) !important;
    background: rgba(var(--pix-accent-2-rgb, 255, 0, 128), 0.05) !important;
    box-shadow: 0 0 4px rgba(var(--pix-accent-2-rgb, 255, 0, 128), 0.2);
  }

  .tool-disabled {
    opacity: 0.45;
    filter: grayscale(0.85);
    cursor: not-allowed !important;
  }
  .tool-disabled:hover {
    border-color: var(--pix-border) !important;
    color: var(--pix-fg-dim) !important;
  }

  .toolbox-content-container {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 10px;
  }

  .tool-view {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tool-banner {
    background: var(--pix-bg-1);
    border: 1px solid var(--pix-border);
    padding: 5px 8px;
    font-size: 9px;
    font-weight: bold;
    color: var(--pix-fg);
    display: flex;
    align-items: center;
    gap: 6px;
    border-left: 2px solid var(--pix-accent-2);
  }

  .flash-icon {
    filter: drop-shadow(0 0 3px var(--pix-accent-2));
    animation: flash-pulse 2s infinite;
  }

  @keyframes flash-pulse {
    0% { opacity: 0.8; }
    50% { opacity: 1; filter: drop-shadow(0 0 6px var(--pix-accent-2)); }
    100% { opacity: 0.8; }
  }

  .context-linked-alert {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 8px;
    color: var(--pix-green);
    background: rgba(0, 200, 100, 0.05);
    border: 1px dashed var(--pix-green);
    padding: 4px 6px;
  }

  .green-dot {
    width: 4px;
    height: 4px;
    background: var(--pix-green);
    border-radius: 50%;
    box-shadow: 0 0 3px var(--pix-green);
  }

  .context-warning-alert {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 8px;
    color: var(--pix-red);
    background: rgba(255, 0, 0, 0.04);
    border: 1px dashed var(--pix-red);
    padding: 4px 6px;
  }

  /* Form Elements */
  .tool-form {
    background: var(--pix-bg-2);
    border: 2px solid var(--pix-border);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .form-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .form-item label, .form-item-label {
    font-size: 8.5px;
    font-weight: bold;
    color: var(--pix-fg-dim);
  }

  .pix-select {
    border: 2px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    padding: 3px;
    font-family: inherit;
    font-size: 10px;
    outline: none;
    cursor: pointer;
  }
  .pix-select:focus {
    border-color: var(--pix-accent);
  }

  .checkbox-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 2px;
  }

  .pix-checkbox-lbl {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 8.5px;
    color: var(--pix-fg);
    cursor: pointer;
  }
  .pix-checkbox-lbl input {
    cursor: pointer;
    accent-color: var(--pix-accent-2);
  }

  /* Submit buttons */
  .calc-submit-btn, .opt-submit-btn, .sop-submit-btn {
    margin-top: 4px;
    background: var(--pix-bg-1);
    border: 2px solid var(--pix-border);
    color: var(--pix-accent);
    font-weight: bold;
    font-size: 10px;
    padding: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-shadow: 1px 1px 0 #000;
  }
  .calc-submit-btn:hover {
    border-color: var(--pix-accent);
    box-shadow: 0 0 5px var(--pix-accent);
  }

  .opt-submit-btn {
    color: var(--pix-accent-2);
  }
  .opt-submit-btn:hover {
    border-color: var(--pix-accent-2);
    box-shadow: 0 0 5px var(--pix-accent-2);
  }

  .sop-submit-btn {
    color: var(--pix-green);
  }
  .sop-submit-btn:hover {
    border-color: var(--pix-green);
    box-shadow: 0 0 5px var(--pix-green);
  }

  .btn-running {
    border-color: var(--pix-border-hi) !important;
    color: var(--pix-fg-dim) !important;
    cursor: wait !important;
    box-shadow: none !important;
    background: var(--pix-bg-3) !important;
  }

  /* Results styling */
  .tool-results-panel {
    background: var(--pix-bg-2);
    border: 2px solid var(--pix-accent);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.4);
    animation: slide-up 0.25s ease-out;
  }

  @keyframes slide-up {
    from { transform: translateY(5px); opacity: 0.8; }
    to { transform: translateY(0); opacity: 1; }
  }

  .result-headline {
    font-size: 9.5px;
    font-weight: bold;
    color: var(--pix-accent);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px dashed var(--pix-border);
    padding-bottom: 4px;
  }

  .ddg-badge {
    padding: 1px 6px;
    font-size: 9px;
    font-weight: bold;
    border: 1px solid;
    border-radius: 2px;
  }

  .stable-ddg {
    background: rgba(0, 210, 255, 0.08);
    color: var(--pix-cyan);
    border-color: var(--pix-cyan);
  }

  .unstable-ddg {
    background: rgba(255, 0, 0, 0.08);
    color: var(--pix-red);
    border-color: var(--pix-red);
  }

  .metric-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .metric-card {
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-radius: 2px;
  }

  .m-label {
    font-size: 7.5px;
    color: var(--pix-fg-dim);
  }

  .m-value {
    font-size: 11px;
    font-weight: bold;
    color: var(--pix-fg);
  }

  .m-desc {
    font-size: 7px;
    color: var(--pix-fg-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-explanation {
    font-size: 9px;
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
    padding: 6px;
    color: var(--pix-fg-dim);
    max-height: 120px;
    overflow-y: auto;
  }

  .result-import-btn {
    background: var(--pix-bg-1);
    border: 2px solid var(--pix-border);
    color: var(--pix-fg);
    font-size: 9.5px;
    font-weight: bold;
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .result-import-btn:hover {
    border-color: var(--pix-green);
    color: var(--pix-green);
  }

  /* Comparison Row */
  .metric-comparison-row {
    display: flex;
    gap: 8px;
  }

  .comp-col {
    flex: 1;
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
    padding: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .comp-hdr {
    font-size: 8px;
    color: var(--pix-fg-dim);
  }

  .comp-val {
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 3px;
    font-weight: bold;
  }

  .old-val {
    color: var(--pix-fg-dim);
    text-decoration: line-through;
  }

  .arrow {
    color: var(--pix-border-hi);
  }

  .new-val {
    color: var(--pix-cyan);
  }

  .results-meta {
    background: var(--pix-bg-3);
    padding: 4px 6px;
    border-left: 2px solid var(--pix-border-hi);
    color: var(--pix-fg-dim);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* Sequence Box */
  .sequence-view-box {
    border: 1px solid var(--pix-border);
    background: #000;
    font-family: monospace;
    font-size: 8.5px;
    border-radius: 2px;
    overflow: hidden;
  }

  .seq-box-header {
    background: var(--pix-bg-2);
    border-bottom: 1px solid var(--pix-border);
    padding: 3px 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--pix-fg-dim);
  }

  .copy-seq-btn {
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    padding: 1px 5px;
    font-size: 8px;
    cursor: pointer;
  }
  .copy-seq-btn:hover {
    border-color: var(--pix-accent);
    color: var(--pix-accent);
  }

  .seq-textarea {
    width: 100%;
    height: 50px;
    background: transparent;
    border: none;
    color: var(--pix-green);
    padding: 4px;
    resize: none;
    font-family: inherit;
    font-size: inherit;
    outline: none;
  }

  /* Primers Card */
  .primers-card {
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .primer-title {
    font-weight: bold;
    font-size: 8.5px;
    color: var(--pix-cyan);
    border-bottom: 1px dashed var(--pix-border);
    padding-bottom: 2px;
  }

  .primer-row {
    display: flex;
    font-size: 8.5px;
    gap: 4px;
  }

  .p-lbl {
    color: var(--pix-fg-dim);
    font-weight: bold;
    min-width: 90px;
  }

  .p-val {
    color: var(--pix-fg);
    word-break: break-all;
  }

  .primer-meta {
    font-size: 8px;
    color: var(--pix-fg-dim);
    margin-top: 2px;
  }

  /* Recipe Sections */
  .recipe-section {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .section-title {
    font-weight: bold;
    font-size: 8.5px;
    color: var(--pix-fg);
  }

  .recipe-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8px;
    background: var(--pix-bg-3);
    border: 1px solid var(--pix-border);
  }

  .recipe-table th, .recipe-table td {
    padding: 3px 5px;
    border: 1px solid var(--pix-border);
    text-align: left;
  }

  .recipe-table th {
    background: var(--pix-bg-1);
    color: var(--pix-cyan);
    font-weight: bold;
  }

  .cycling-table th:nth-child(2), .cycling-table td:nth-child(2) {
    color: var(--pix-accent-2);
  }

  .cycle-step {
    color: var(--pix-fg-dim);
    font-weight: bold;
  }

  /* Utility classes */
  .text-right {
    text-align: right !important;
  }
  .text-center {
    text-align: center !important;
  }
  .text-green {
    color: var(--pix-green) !important;
  }
  .text-accent {
    color: var(--pix-accent) !important;
  }
</style>
