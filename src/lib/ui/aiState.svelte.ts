// Svelte 5 reactive global store for the SPICE AI Co-Pilot (using runes).

import * as m from '$lib/paraglide/messages.js';
import { pushToast } from './toast.svelte.ts';
import { predictMutationalStabilityDdG } from '$lib/genome/biophysics/proteinAnalysis';
import { calculateCai, optimizeCodons, getAminoAcidOfCodon, CODON_WEIGHTS, type CodonHost } from '$lib/genome/codon';
import { calculateSantaLuciaTm } from '$lib/genome/tm';
import { getReverseComplementSequenceString } from '$lib/genome/sequence';
import { addMemory, loadMemory, removeMemory, type MemoryEntry } from '$lib/ai/memory';
import { appendAudit, clearAudit, loadAudit, type AuditEntry, type AuditKind } from '$lib/ai/audit';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  /** True when the message is a local error/status note rather than model
   *  output. Error notes are not replayed as conversation history. */
  error?: boolean;
  parsedMutations?: { pos: number; from: string; to: string; score?: number }[];
  parsedSequence?: string;
  parsedSop?: string;
  /** Human-readable names of tools used while producing this message. */
  toolNotes?: string[];
}

export interface AiConfig {
  endpoint: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
}

class AiStateStore {
  // Is the AI Sidebar open globally
  isOpen = $state(false);
  
  // Current Active Workspace page: 'protein' | 'gene' | 'project' | 'general'
  currentWorkspace = $state<'protein' | 'gene' | 'project' | 'general'>('protein');
  
  // Active Tab: 'chat' | 'tools'
  activeTab = $state<'chat' | 'tools'>('chat');

  // Active Tool in the Toolbox: 'mutation' | 'codon' | 'sop'
  activeTool = $state<'mutation' | 'codon' | 'sop'>('mutation');

  // Is the LLM generating a response
  isGenerating = $state(false);

  // --- Toolbox States ---
  
  // 1. Mutation Stabilizer Tool State
  mutTool = $state({
    pos: 103,
    fromRes: 'Q',
    toRes: 'S',
    ph: 7.0,
    tempK: 310,
    isCalculating: false,
    result: null as null | {
      ddG: number;            // kcal/mol, from the app's ddG predictor
      classification: string; // Stabilizing / Neutral / Destabilizing
      chargeChange: number;
      solventNeutralize: string; // "Na+" or "Cl-" or "Neutral"
      isStable: boolean;
      explanation: string;
    }
  });

  // 2. Codon Optimizer Tool State
  codonTool = $state({
    host: 'E. coli',
    targetGc: 50,
    avoidBsaI: true,
    avoidBsmBI: true,
    avoidEcoRI: true,
    isOptimizing: false,
    result: null as null | {
      optimizedDna: string;
      initialGc: number;
      optimizedGc: number;
      initialCai: number;
      optimizedCai: number;
      avoidedCount: number;
      mutatedCodonsCount: number;
    }
  });

  // 3. SOP Generator Tool State
  sopTool = $state({
    method: 'Golden Gate',
    enzyme: 'BsaI',
    polymerase: 'Phanta MasterMix',
    isGenerating: false,
    result: null as null | {
      title: string;
      fwdPrimer: string;
      revPrimer: string;
      primerTm: number;
      productLength: number;
      extensionTimeS: number;
      pcrRecipe: { component: string; volume: number; note: string }[];
      assemblyRecipe: { component: string; volume: number; note: string }[];
      pcrCycles: { step: string; temp: string; time: string; note: string }[];
      assemblyCycles: { step: string; temp: string; time: string; note: string }[];
    }
  });
  
  // Configuration for local/remote LLM endpoint
  config = $state<AiConfig>({
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:7b-instruct',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: `You are the SPICE AI Co-Pilot, a state-of-the-art computational biophysics and synthetic biology assistant.
SPICE (Sequence-Protein Interaction under Conditional Environments) uses physics (all-atom Molecular Dynamics) as an online teacher to design and evaluate protein stability under non-native conditions (pH, temperature, ionic strength).

Your core strengths & topics of expertise:
1. Solvent Reuse & Water Pruning (build_mutant_by_solvent_reuse): Directly reusing the parent's water and ions to avoid slow full re-solvation when mutants are placed, pruning solvent waters within 2.2 Å of mutated sidechains, followed by fast L-BFGS minimization.
2. Robust thermal fluctuations via MAD Fluctuation (MAD * 1.4826) as m_1 metric.
3. Fast O(N_heavy) Burial Counting (Cα radius 6 Å, <= 30 neighbors = surface) as m_5 metric.
4. DSSP-Lite main-chain H-bonds tracking as m_3 metric.
5. Velocity-Reset thermostat offset correction (+65-75K water thermostat offset fix).
6. SPICE-SAC reinforcement learning (asymmetric features, continuous/discrete trunks).

When suggesting mutations or interpreting physical outputs, always relate your explanation to the thermodynamic and biophysical principles (e.g. salt bridge breakages under pH perturbations, hydrophobic collapse, hydrogen bonding networks).

Agent rules:
- Inspect the workspace with tools before making claims about the loaded sequence, environment, project, or past experiments.
- Never invent tool results. If a tool fails, say so and continue with the information you have.
- Tools that modify the editor require explicit user approval; do not claim a change was applied unless the tool result says it succeeded.
- Use search_workspace for project documents and journal context, and remember_fact only when the user asks you to remember something.

If you generate mutations, output them as a structured JSON block somewhere in your text so the user can import them with one click:
\`\`\`json
[{"pos": 103, "from": "Q", "to": "S"}]
\`\`\`
If you generate a DNA sequence, output it as:
\`\`\`dna
ATGCGTACGT...
\`\`\`
`
  });

  // Message history
  messages = $state<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      text: m.copilotWelcomeIntro(),
      timestamp: new Date().toLocaleTimeString(),
    }
  ]);

  // Context objects automatically fed by current active page
  proteinContext = $state<{
    sequence: string;
    env: { ph: number; tempK: number; pressureBar: number; ionicStrengthM: number };
    metrics: any;
    phaseScanCount?: number;
  }>({
    sequence: '',
    env: { ph: 7.0, tempK: 310, pressureBar: 1.0, ionicStrengthM: 0.0 },
    metrics: null,
  });

  geneContext = $state<{
    dnaSequence: string;
    plasmidName: string;
    gcContent: number;
    codonHost: string;
  }>({
    dnaSequence: '',
    plasmidName: '',
    gcContent: 0,
    codonHost: '',
  });

  // Callbacks supplied by pages to inject sequences or mutations
  onApplyProteinSequence: ((seq: string) => void) | null = null;
  onApplyDnaSequence: ((seq: string) => void) | null = null;
  onImportMutations: ((muts: { pos: number; from: string; to: string }[]) => void) | null = null;
  onUndoAiChange = $state<(() => void) | null>(null);

  // Agent mode can be disabled to use plain streaming chat without tools.
  agentEnabled = $state(true);

  // Durable memory and audit trail are exposed to the UI.
  memory = $state<MemoryEntry[]>([]);
  audit = $state<AuditEntry[]>([]);

  constructor() {
    if (typeof localStorage !== 'undefined') {
      this.memory = loadMemory();
      this.audit = loadAudit();

      const savedConfig = localStorage.getItem('spice_ai_config');
      if (savedConfig) {
        try {
          const parsed = JSON.parse(savedConfig);
          if (parsed.endpoint) this.config.endpoint = parsed.endpoint;
          if (parsed.model) this.config.model = parsed.model;
          if (parsed.systemPrompt) this.config.systemPrompt = parsed.systemPrompt;
          if (typeof parsed.apiKey === 'string') this.config.apiKey = parsed.apiKey;
          if (typeof parsed.temperature === 'number') this.config.temperature = parsed.temperature;
          if (typeof parsed.maxTokens === 'number') this.config.maxTokens = parsed.maxTokens;
        } catch (e) {}
      }

      const savedMutTool = localStorage.getItem('spice_ai_mut_tool');
      if (savedMutTool) {
        try {
          const parsed = JSON.parse(savedMutTool);
          if (parsed.pos !== undefined) this.mutTool.pos = parsed.pos;
          if (parsed.fromRes !== undefined) this.mutTool.fromRes = parsed.fromRes;
          if (parsed.toRes !== undefined) this.mutTool.toRes = parsed.toRes;
          if (parsed.ph !== undefined) this.mutTool.ph = parsed.ph;
          if (parsed.tempK !== undefined) this.mutTool.tempK = parsed.tempK;
        } catch (e) {}
      }

      const savedCodonTool = localStorage.getItem('spice_ai_codon_tool');
      if (savedCodonTool) {
        try {
          const parsed = JSON.parse(savedCodonTool);
          if (parsed.host !== undefined) this.codonTool.host = parsed.host;
          if (parsed.targetGc !== undefined) this.codonTool.targetGc = parsed.targetGc;
          if (parsed.avoidBsaI !== undefined) this.codonTool.avoidBsaI = parsed.avoidBsaI;
          if (parsed.avoidBsmBI !== undefined) this.codonTool.avoidBsmBI = parsed.avoidBsmBI;
          if (parsed.avoidEcoRI !== undefined) this.codonTool.avoidEcoRI = parsed.avoidEcoRI;
        } catch (e) {}
      }

      const savedSopTool = localStorage.getItem('spice_ai_sop_tool');
      if (savedSopTool) {
        try {
          const parsed = JSON.parse(savedSopTool);
          if (parsed.method !== undefined) this.sopTool.method = parsed.method;
          if (parsed.enzyme !== undefined) this.sopTool.enzyme = parsed.enzyme;
          if (parsed.polymerase !== undefined) this.sopTool.polymerase = parsed.polymerase;
        } catch (e) {}
      }

      const savedMessages = localStorage.getItem('spice_ai_messages');
      if (savedMessages) {
        try {
          const parsed = JSON.parse(savedMessages);
          if (Array.isArray(parsed)) {
            const restored = parsed
              .filter((msg) => msg
                && typeof msg.id === 'number'
                && (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system')
                && typeof msg.text === 'string'
                && typeof msg.timestamp === 'string')
              .slice(-120)
              .map((msg) => ({
                id: msg.id,
                role: msg.role,
                text: msg.text,
                timestamp: msg.timestamp,
                error: msg.error === true,
                parsedMutations: Array.isArray(msg.parsedMutations) ? msg.parsedMutations : undefined,
                parsedSequence: typeof msg.parsedSequence === 'string' ? msg.parsedSequence : undefined,
                parsedSop: typeof msg.parsedSop === 'string' ? msg.parsedSop : undefined,
                toolNotes: Array.isArray(msg.toolNotes) ? msg.toolNotes.filter((note: unknown) => typeof note === 'string') : undefined,
              }));
            if (restored.length) this.messages = restored;
          }
        } catch (e) {}
      }

      this.agentEnabled = localStorage.getItem('spice_ai_agent_enabled') !== '0';
    }
  }

  setAgentEnabled(enabled: boolean) {
    this.agentEnabled = enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice_ai_agent_enabled', enabled ? '1' : '0');
    }
  }

  rememberFact(text: string, tags: string[] = []) {
    this.memory = addMemory(this.memory, text, tags);
    return this.memory;
  }

  forgetMemory(id: string) {
    this.memory = removeMemory(this.memory, id);
  }

  recordAudit(entry: {
    kind: AuditKind;
    tool: string;
    permission: 'read' | 'write';
    approved?: boolean;
    ok: boolean;
    summary: string;
    args?: unknown;
  }) {
    this.audit = appendAudit(this.audit, entry);
  }

  clearAuditLog() {
    this.audit = clearAudit();
  }

  toggle() {
    this.isOpen = !this.isOpen;
  }

  clearHistory() {
    this.messages = [
      {
        id: 1,
        role: 'assistant',
        text: m.copilotHistoryClearedIntro(),
        timestamp: new Date().toLocaleTimeString(),
      }
    ];
  }

  // --- Bioinformatic and Biophysical Simulation Methods ---

  runMutationCalculation() {
    this.mutTool.isCalculating = true;
    const pos = this.mutTool.pos;
    const activeSeq = this.proteinContext.sequence;

    if (!activeSeq) {
      this.mutTool.isCalculating = false;
      pushToast('error', m.copilotMutEstimateFailed(), m.copilotUnlinkedProtein());
      return;
    }
    if (pos < 1 || pos > activeSeq.length) {
      pushToast('error', m.copilotMutEstimateFailed(), m.copilotMutResidueOutOfRange({ v1: pos, v2: activeSeq.length }));
      this.mutTool.isCalculating = false;
      return;
    }

    const fromRes = activeSeq[pos - 1].toUpperCase();
    const toRes = this.mutTool.toRes.toUpperCase();
    if (!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(toRes)) {
      this.mutTool.isCalculating = false;
      pushToast('error', m.copilotMutEstimateFailed(), m.copilotInvalidProteinDesc());
      return;
    }
    const ph = this.mutTool.ph;
    this.mutTool.fromRes = fromRes;

    // Use the same empirical ddG predictor as the protein analysis panel.
    const prediction = predictMutationalStabilityDdG(fromRes, pos, toRes);
    const ddG = Math.round(prediction.ddG * 100) / 100;

    const getCharge = (residue: string, phVal: number) => {
      if (residue === 'K' || residue === 'R') return 1.0;
      if (residue === 'H') return phVal < 6.0 ? 1.0 : (phVal < 7.5 ? 0.4 : 0.0);
      if (residue === 'D' || residue === 'E') return phVal > 4.5 ? -1.0 : (phVal > 3.5 ? -0.5 : 0.0);
      return 0.0;
    };
    const chargeChange = getCharge(toRes, ph) - getCharge(fromRes, ph);
    let solventNeutralize = 'Neutral';
    if (chargeChange > 0.1) solventNeutralize = 'Cl-';
    else if (chargeChange < -0.1) solventNeutralize = 'Na+';

    const chargeNote = solventNeutralize === 'Neutral'
      ? ''
      : `\n\n${m.copilotExplSolventNeutralize({ v1: `${chargeChange > 0 ? '+' : ''}${chargeChange}`, v2: solventNeutralize })}`;

    this.mutTool.result = {
      ddG,
      classification: prediction.classification,
      chargeChange,
      solventNeutralize,
      isStable: ddG < -0.2,
      explanation: `${prediction.details}${chargeNote}`,
    };
    this.mutTool.isCalculating = false;
  }

  runCodonOptimization() {
    this.codonTool.isOptimizing = true;
    const raw = (this.geneContext.dnaSequence || '').toUpperCase().replace(/[\s\n\r\t]/g, '');
    if (!raw || raw.length < 3) {
      this.codonTool.isOptimizing = false;
      pushToast('error', m.copilotCodonBtnRun(), m.copilotUnlinkedGene());
      return;
    }
    if (!/^[ACGT]+$/.test(raw)) {
      this.codonTool.isOptimizing = false;
      pushToast('error', m.copilotCodonBtnRun(), m.copilotCodonInvalidAlphabet());
      return;
    }
    if (raw.length % 3 !== 0) {
      this.codonTool.isOptimizing = false;
      pushToast('error', m.copilotCodonBtnRun(), m.copilotCodonFrameError({ n: raw.length }));
      return;
    }

    const hostMap: Record<string, CodonHost> = { 'E. coli': 'ecoli', Yeast: 'yeast', Human: 'human' };
    const host = hostMap[this.codonTool.host] ?? 'ecoli';

    const { optimized } = optimizeCodons(raw, host, true);
    let optimizedDna = optimized;

    // Remove enabled restriction sites by swapping synonymous codons while
    // keeping the translated sequence identical.
    const motifs = [
      { seq: 'GGTCTC', enabled: this.codonTool.avoidBsaI },
      { seq: 'GAGACC', enabled: this.codonTool.avoidBsaI },
      { seq: 'CGTCTC', enabled: this.codonTool.avoidBsmBI },
      { seq: 'GAGACG', enabled: this.codonTool.avoidBsmBI },
      { seq: 'GAATTC', enabled: this.codonTool.avoidEcoRI },
    ].filter((motif) => motif.enabled).map((motif) => motif.seq);

    const alternativesFor = (codon: string): string[] => {
      const aa = getAminoAcidOfCodon(codon);
      if (!aa) return [];
      const weights = CODON_WEIGHTS[host][aa] ?? {};
      return Object.entries(weights).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    };
    const hasMotif = (dna: string) => motifs.some((motif) => dna.includes(motif));

    let avoidedCount = 0;
    for (const motif of motifs) {
      let guard = 0;
      while (optimizedDna.includes(motif) && guard < 500) {
        guard += 1;
        const idx = optimizedDna.indexOf(motif);
        const firstCodon = Math.floor(idx / 3);
        const lastCodon = Math.floor((idx + motif.length - 1) / 3);
        let replaced = false;
        for (let codonIndex = firstCodon; codonIndex <= lastCodon && !replaced; codonIndex += 1) {
          const codon = optimizedDna.slice(codonIndex * 3, codonIndex * 3 + 3);
          for (const alt of alternativesFor(codon)) {
            if (alt === codon) continue;
            const next = `${optimizedDna.slice(0, codonIndex * 3)}${alt}${optimizedDna.slice(codonIndex * 3 + 3)}`;
            if (!hasMotif(next)) {
              optimizedDna = next;
              avoidedCount += 1;
              replaced = true;
              break;
            }
          }
        }
        if (!replaced) break;
      }
    }

    const initial = calculateCai(raw, host);
    const final = calculateCai(optimizedDna, host);
    let mutatedCodonsCount = 0;
    const count = Math.min(Math.floor(raw.length / 3), Math.floor(optimizedDna.length / 3));
    for (let i = 0; i < count; i += 1) {
      if (raw.slice(i * 3, i * 3 + 3) !== optimizedDna.slice(i * 3, i * 3 + 3)) mutatedCodonsCount += 1;
    }

    this.codonTool.result = {
      optimizedDna,
      initialGc: Math.round(initial.gc * 10) / 10,
      optimizedGc: Math.round(final.gc * 10) / 10,
      initialCai: Math.round(initial.cai * 100) / 100,
      optimizedCai: Math.round(final.cai * 100) / 100,
      avoidedCount,
      mutatedCodonsCount,
    };
    this.codonTool.isOptimizing = false;
  }

  runSopGeneration() {
    this.sopTool.isGenerating = true;
    const seq = (this.geneContext.dnaSequence || '').toUpperCase().replace(/[^ATCG]/g, '');
    if (!seq) {
      this.sopTool.isGenerating = false;
      pushToast('error', m.copilotSopTitle(), m.copilotUnlinkedGene());
      return;
    }

    const len = seq.length;
    const pm = this.sopTool.polymerase;
    const method = this.sopTool.method;
    const enzyme = this.sopTool.enzyme;

    // Use the real nearest-neighbor Tm on the annealing portion of each primer.
    const fwdAnneal = seq.slice(0, Math.min(20, len));
    const revAnneal = getReverseComplementSequenceString(seq.slice(Math.max(0, len - 20)));
    const tmOf = (primer: string) => {
      const value = calculateSantaLuciaTm(primer);
      return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
    };
    const primerTm = tmOf(fwdAnneal) ?? tmOf(revAnneal) ?? 60;

    let speedSecPerKb = 30;
    if (pm.includes('Q5')) speedSecPerKb = 20;
    else if (pm.includes('Taq')) speedSecPerKb = 60;

    const extTime = Math.max(10, Math.round((len / 1000) * speedSecPerKb));

    const pcrRecipe = [
      { component: `2× ${pm}`, volume: 25.0, note: m.copilotSopNoteHifiMix() },
      { component: 'Fwd Primer (10 µM)', volume: 2.0, note: m.copilotSopNoteFwdTm({ v1: primerTm }) },
      { component: 'Rev Primer (10 µM)', volume: 2.0, note: m.copilotSopNoteRevTm({ v1: primerTm }) },
      { component: 'Template DNA (10 ng/µL)', volume: 1.0, note: m.copilotSopNoteTemplate() },
      { component: 'Nuclease-free H2O', volume: 20.0, note: m.copilotSopNoteFillTo50() }
    ];

    const pcrCycles = [
      { step: m.copilotSopStepInitialDenat(), temp: '95°C', time: '3 min', note: m.copilotSopNoteMeltTemplate() },
      { step: m.denaturationDenaturation(), temp: '98°C', time: '10 s', note: m.copilotSopNoteRun30Cycles() },
      { step: m.annealingAnnealing(), temp: `${Math.max(50, primerTm - 3)}°C`, time: '15 s', note: m.copilotSopNotePrimerTmAnneal() },
      { step: m.extensionExtension(), temp: '72°C', time: `${extTime} s`, note: m.copilotSopNoteExtSpeed({ v1: speedSecPerKb }) },
      { step: m.copilotSopStepFinalExt(), temp: '72°C', time: '5 min', note: m.copilotSopNoteFinishPartial() },
      { step: m.copilotSopStepHoldTemp(), temp: '4°C', time: '∞', note: m.copilotSopNoteStableHold() }
    ];

    let assemblyRecipe: any[] = [];
    let assemblyCycles: any[] = [];

    if (method === 'Golden Gate') {
      assemblyRecipe = [
        { component: 'pUC19 Vector (50 ng/µL)', volume: 1.5, note: m.copilotSopNotePuc19Scaffold() },
        { component: m.copilotSopCompInsert31(), volume: 3.5, note: m.copilotSopNoteInsertFragment() },
        { component: `Restriction Enzyme ${enzyme}`, volume: 1.0, note: m.copilotSopNoteIISenzyme() },
        { component: 'T4 DNA Ligase', volume: 1.0, note: m.copilotSopNoteLigateEnds() },
        { component: '10× T4 DNA Ligase Buffer', volume: 2.0, note: m.copilotSopNoteLigBufferAtp() },
        { component: 'Nuclease-free H2O', volume: 11.0, note: m.copilotSopNoteFillTo20() }
      ];

      assemblyCycles = [
        { step: m.copilotSopStepDigestion(), temp: '37°C', time: '3 min', note: m.copilotSopNoteDigestLigateCycles() },
        { step: m.ligationReactionLigation(), temp: '16°C', time: '4 min', note: '' },
        { step: m.copilotSopStepInactivation(), temp: '80°C', time: '10 min', note: m.copilotSopNoteStopReaction() }
      ];
    } else {
      assemblyRecipe = [
        { component: '2× Gibson Assembly Mix', volume: 10.0, note: m.copilotSopNoteGibsonEnzymes() },
        { component: 'Linearized Vector (50 ng)', volume: 2.0, note: m.copilotSopNoteLinearizedArm() },
        { component: 'PCR Insert (3:1 ratio)', volume: 4.0, note: m.copilotSopNoteHomologyMatch() },
        { component: 'ddH2O', volume: 4.0, note: m.copilotSopNoteGibsonWater() }
      ];

      assemblyCycles = [
        { step: m.copilotSopStepIsothermal(), temp: '50°C', time: '60 min', note: m.copilotSopNoteOnePotAssembly() },
        { step: m.saveHold(), temp: '4°C', time: '∞', note: m.copilotSopNoteTransformReady() }
      ];
    }

    this.sopTool.result = {
      title: `${method} ${m.copilotSopTitle()}`,
      fwdPrimer: `5'-${fwdAnneal}-3'`,
      revPrimer: `5'-${revAnneal}-3'`,
      primerTm,
      productLength: len,
      extensionTimeS: extTime,
      pcrRecipe,
      assemblyRecipe,
      pcrCycles,
      assemblyCycles
    };
    this.sopTool.isGenerating = false;
  }
}

export const aiState = new AiStateStore();
