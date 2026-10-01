<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { aiState } from './aiState.svelte.ts';
  import { pushToast } from './toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { 
    Send, Sparkles, Settings, RotateCcw, X, Check, Dna, 
    Layers, HelpCircle, FileText, AlertCircle, RefreshCw,
    MessageSquare, Sliders, Activity, Zap, Copy, FileSpreadsheet, Beaker
  } from 'lucide-svelte';

  const ui = { style: 'pixel', theme: 'midnight' } as const;

  let inputVal = $state('');
  let showConfig = $state(false);
  let messagesContainer = $state<HTMLDivElement | null>(null);

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
        systemPrompt: aiState.config.systemPrompt
      }));
    }
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
        if (aiState.onImportMutations && Array.isArray(muts)) {
          aiState.onImportMutations(muts);
          pushToast(
            'success',
            m.copilotToastMutSuccess(),
            m.copilotToastMutDesc({ n: muts.length })
          );
        }
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
        if (aiState.onApplyDnaSequence) {
          aiState.onApplyDnaSequence(decoded);
          pushToast(
            'success',
            m.copilotToastDnaSuccess(),
            m.copilotToastDnaDesc()
          );
        }
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

  // Parse custom formats from LLM response text
  function extractJsonMutations(text: string) {
    try {
      // Find JSON block with mutation arrays
      const regex = /```json\s*([\s\S]*?)\s*```/;
      const match = text.match(regex);
      if (match && match[1]) {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed) && parsed.every(item => 'pos' in item && 'from' in item && 'to' in item)) {
          return parsed as { pos: number; from: string; to: string }[];
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  function extractDnaSequence(text: string) {
    const regex = /```dna\s*([a-zA-Z\s]+)\s*```/;
    const match = text.match(regex);
    if (match && match[1]) {
      return match[1].replace(/[\s\n\r]/g, '').toUpperCase();
    }
    return null;
  }

  // Auto-scroll chat history to bottom
  async function scrollToBottom() {
    await tick();
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
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

    scrollToBottom();

    // Prepare complete request body
    const messagesPayload = [
      { role: 'system', content: aiState.config.systemPrompt },
      { role: 'user', content: m.aiPromptWithContextWrap({ buildContextPrompt: buildContextPrompt(), text: text }) }
    ];

    try {
      const response = await fetch(aiState.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: aiState.config.model,
          messages: messagesPayload,
          temperature: 0.7,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status code: ${response.status}`);
      }

      const resJson = await response.json();
      const rawText = resJson.choices?.[0]?.message?.content || m.copilotNoValidContent();

      // Update assistant message with actual LLM response
      const updatedMsg = aiState.messages.find(m => m.id === assistantMsgId);
      if (updatedMsg) {
        updatedMsg.text = rawText;
        updatedMsg.parsedMutations = extractJsonMutations(rawText) || undefined;
        updatedMsg.parsedSequence = extractDnaSequence(rawText) || undefined;
      }
    } catch (err: any) {
      // Handle connection error or provide smart local fallback
      const updatedMsg = aiState.messages.find(m => m.id === assistantMsgId);
      if (updatedMsg) {
        updatedMsg.text = `${m.copilotAiOfflineTitle()}\n${m.copilotAiOfflineAddr({ v1: aiState.config.endpoint })}\n\n${m.copilotAiOfflineHowHeading()}\n${m.copilotAiOfflineStep1()}\n${m.copilotAiOfflineStep2({ v1: aiState.config.model })}\n${m.copilotAiOfflineStep3()}\n\n${m.copilotAiOfflineSimHeading()}\n${getSimulatedResponse(text)}`;
        
        // Also parse mutations / DNA if simulated
        const simText = getSimulatedResponse(text);
        updatedMsg.parsedMutations = extractJsonMutations(simText) || undefined;
        updatedMsg.parsedSequence = extractDnaSequence(simText) || undefined;
      }
      pushToast('warn', m.copilotAiConnBlocked(), m.copilotAiConnBlockedDesc());
    } finally {
      aiState.isGenerating = false;
      scrollToBottom();
    }
  }

  // Pre-configured physics-informed expert templates for offline/fallback mode
  function getSimulatedResponse(prompt: string): string {
    const p = prompt.toLowerCase();
    
    if (p.includes(m.mutation()) || p.includes('mutation') || p.includes('stable') || p.includes(m.stable())) {
      return `${m.copilotSimMutTitle()}
${m.copilotSimMutAnalysis()}

${m.copilotSimMutSurfaceAdvice()}
${m.copilotSimMutRescueIntro()}

\`\`\`json
[
  {"pos": 103, "from": "Q", "to": "S", "score": 0.89},
  {"pos": 107, "from": "D", "to": "R", "score": 0.94},
  {"pos": 112, "from": "A", "to": "V", "score": 0.82}
]
\`\`\`

${m.copilotSimMutMechHeading()}
${m.copilotSimMutMechD107R()}
${m.copilotSimMutMechA112V()}

${m.copilotSimMutImportHint()}`;
    }

    if (p.includes(m.optimize()) || p.includes('codon') || p.includes(m.codon())) {
      const parentDna = aiState.geneContext.dnaSequence || 'ATGCGTACGTTAGTC';
      return `${m.copilotSimCodonTitle()}
${m.copilotSimCodonHostLine({ v1: aiState.geneContext.codonHost || m.copilotCtxHostEcoli() })}
${m.copilotSimCodonGoal()}

${m.copilotSimCodonSeqHeading()}
\`\`\`dna
ATGAGGACTGTGCTCAGCGAAGCGGCCGCGAAATTGGTGAAT
\`\`\`

${m.copilotSimCodonPropsHeading()}
${m.copilotSimCodonGcLine({ v1: aiState.geneContext.gcContent.toFixed(1) })}
${m.copilotSimCodonSitesLine()}

${m.copilotSimCodonApplyHint()}`;
    }

    if (p.includes(m.copilotPlanWord().toLowerCase()) || p.includes('sop') || p.includes('protocol') || p.includes('pcr')) {
      return `${m.copilotSimSopTitle()}
${m.copilotSimSopIntro()}

${m.copilotSimSopH1()}
   - ${m.copilotSimSopFwdStock()}
   - ${m.copilotSimSopRevStock()}
${m.copilotSimSopH2()}
   - 2x Phanta Master Mix: 25 µL
   - Template DNA (10 ng/µL): 1 µL
   - Fwd Primer (10 µM): 2 µL
   - Rev Primer (10 µM): 2 µL
   - ddH2O: 20 µL
   - *${m.copilotSimSopPcrCyclingLine()}*
${m.copilotSimSopH3()}
   - pUC19 Backbone (50 ng): 1 µL
   - Insert PCR Product (3-fold molar excess): 3 µL
   - BsaI-HF v2 (Restriction Enzyme): 1 µL
   - T4 DNA Ligase: 1 µL
   - 10x T4 Ligase Buffer: 2 µL
   - ddH2O: 12 µL
   - *${m.copilotSimSopAssemblyCycling()}*

${m.copilotSimSopOutro()}`;
    }

    return `${m.copilotSimDefaultTitle()}
${m.copilotSimDefaultIntro()}
${m.copilotSimDefaultProteinLine({ v1: aiState.proteinContext.sequence.length })}
${m.copilotSimDefaultDnaLine({ v1: aiState.geneContext.dnaSequence.length })}

${m.copilotSimDefaultAskHeading()}
${m.copilotSimDefaultQ1()}
${m.copilotSimDefaultQ2()}
${m.copilotSimDefaultQ3()}`;
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

  // Action: Apply DNA sequence to gene workbench
  function applyDna(seq: string) {
    if (aiState.onApplyDnaSequence) {
      aiState.onApplyDnaSequence(seq);
      pushToast(
        'success',
        m.copilotToastLoadDnaSuccess(),
        m.copilotToastLoadDnaDesc()
      );
    } else {
      pushToast(
        'error',
        m.copilotToastLoadFail(),
        m.copilotToastNoGeneEditor()
      );
    }
  }

  // Action: Apply protein sequence
  function applyProtein(seq: string) {
    if (aiState.onApplyProteinSequence) {
      aiState.onApplyProteinSequence(seq);
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
    if (aiState.onImportMutations) {
      aiState.onImportMutations(muts);
      pushToast(
        'success',
        m.copilotToastImportMutSuccess(),
        m.copilotToastImportMutDesc({ n: muts.length })
      );
    } else {
      pushToast(
        'error',
        m.copilotToastLoadFail(),
        m.copilotToastNoProteinMut()
      );
    }
  }

  onMount(() => {
    scrollToBottom();
  });
</script>

{#if aiState.isOpen}
  <aside class="ai-sidebar pix-panel">
    <!-- Header -->
    <header class="ai-sidebar-header">
      <div class="ai-title">
        <Sparkles size={14} class="glow" />
        <span>{m.aiWorkspaceTitle()}</span>
      </div>
      <div class="ai-actions">
        <button class="pix-btn-reset header-btn" onclick={() => showConfig = !showConfig} title={m.copilotSettings()}>
          <Settings size={13} class={showConfig ? 'active-icon' : ''} />
        </button>
        <button class="pix-btn-reset header-btn" onclick={() => aiState.clearHistory()} title={m.appReset()}>
          <RotateCcw size={13} />
        </button>
        <button class="pix-btn-reset header-close" onclick={() => aiState.isOpen = false}>
          <X size={14} />
        </button>
      </div>
    </header>

    <!-- Configuration Settings Pane -->
    {#if showConfig}
      <div class="ai-config-pane">
        <div class="config-title">{m.copilotSettings()}</div>
        <div class="form-group">
          <label for="endpoint-input">{m.aiApiEndpoint()}</label>
          <input id="endpoint-input" class="pix-input" type="text" bind:value={aiState.config.endpoint} />
        </div>
        <div class="form-group">
          <label for="model-input">{m.aiTargetModel()}</label>
          <input id="model-input" class="pix-input" type="text" bind:value={aiState.config.model} />
        </div>
        <div class="form-group">
          <label for="prompt-input">{m.aiSystemPrompt()}</label>
          <textarea id="prompt-input" class="pix-textarea" rows={6} bind:value={aiState.config.systemPrompt}></textarea>
        </div>
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
      <div class="ai-messages" bind:this={messagesContainer}>
        {#each aiState.messages as msg (msg.id)}
          <div class="msg-wrapper msg-{msg.role}">
            <div class="msg-header">
              <span class="msg-sender">{msg.role === 'user' ? 'RedElectricity' : 'SPICE AI'}</span>
              <span class="msg-time">{msg.timestamp}</span>
            </div>
            <div class="msg-body">
              {#if msg.role === 'assistant'}
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
        <textarea 
          class="pix-textarea ai-input-box" 
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
          disabled={aiState.isGenerating || !inputVal.trim()} 
          onclick={sendMessage}
        >
          {#if aiState.isGenerating}
            <RefreshCw size={13} class="spin" />
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
                      <span class="m-label">{m.copilotMetricM1()}</span>
                      <span class="m-value font-mono">{aiState.mutTool.result.m1_mad.toFixed(3)}</span>
                      <span class="m-desc">MAD Fluctuation (Å)</span>
                    </div>
                    <div class="metric-card">
                      <span class="m-label">{m.copilotMetricM3()}</span>
                      <span class="m-value font-mono">{aiState.mutTool.result.m3_hbond}</span>
                      <span class="m-desc">DSSP-Lite H-Bonds</span>
                    </div>
                    <div class="metric-card">
                      <span class="m-label">{m.copilotMetricM5()}</span>
                      <span class="m-value font-mono">{aiState.mutTool.result.m5_burial}</span>
                      <span class="m-desc">{aiState.mutTool.result.m5_burial > 25 ? 'Buried' : 'Surface'}</span>
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
  </aside>
{/if}

<style>
  .ai-sidebar {
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
