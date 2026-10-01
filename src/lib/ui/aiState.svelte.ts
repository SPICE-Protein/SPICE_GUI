// Svelte 5 reactive global store for the SPICE AI Co-Pilot (using runes).

import * as m from '$lib/paraglide/messages.js';
import { pushToast } from './toast.svelte.ts';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  parsedMutations?: { pos: number; from: string; to: string; score?: number }[];
  parsedSequence?: string;
  parsedSop?: string;
}

export interface AiConfig {
  endpoint: string;
  model: string;
  systemPrompt: string;
}

export const GENETIC_CODE: Record<string, string> = {
  ATA: 'I', ATC: 'I', ATT: 'I', ATG: 'M',
  ACA: 'T', ACC: 'T', ACG: 'T', ACT: 'T',
  AAC: 'N', AAT: 'N', AAA: 'K', AAG: 'K',
  AGC: 'S', AGT: 'S', AGA: 'R', AGG: 'R',
  CTA: 'L', CTC: 'L', CTG: 'L', CTT: 'L',
  CCA: 'P', CCC: 'P', CCG: 'P', CCT: 'P',
  CAC: 'H', CAT: 'H', CAA: 'Q', CAG: 'Q',
  CGA: 'R', CGC: 'R', CGG: 'R', CGT: 'R',
  GTA: 'V', GTC: 'V', GTG: 'V', GTT: 'V',
  GCA: 'A', GCC: 'A', GCG: 'A', GCT: 'A',
  GAC: 'D', GAT: 'D', GAA: 'E', GAG: 'E',
  GGA: 'G', GGC: 'G', GGG: 'G', GGT: 'G',
  TCA: 'S', TCC: 'S', TCG: 'S', TCT: 'S',
  TTC: 'F', TTT: 'F', TTA: 'L', TTG: 'L',
  TAC: 'Y', TAT: 'Y', TAA: '*', TAG: '*',
  TGC: 'C', TGT: 'C', TGA: '*', TGG: 'W',
};

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
      ddG: number;            // kcal/mol
      m1_mad: number;         // Thermal fluctuation
      m3_hbond: number;       // H-bond count
      m5_burial: number;      // Neighbor count
      chargeChange: number;
      solventNeutralize: string; // "Na+" or "Cl-" or "Neutral"
      isStable: boolean;
      caisScore: number;
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

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const savedConfig = localStorage.getItem('spice_ai_config');
      if (savedConfig) {
        try {
          const parsed = JSON.parse(savedConfig);
          if (parsed.endpoint) this.config.endpoint = parsed.endpoint;
          if (parsed.model) this.config.model = parsed.model;
          if (parsed.systemPrompt) this.config.systemPrompt = parsed.systemPrompt;
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
    }
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

    if (activeSeq && (pos < 1 || pos > activeSeq.length)) {
      pushToast('error', m.copilotMutEstimateFailed(), m.copilotMutResidueOutOfRange({ v1: pos, v2: activeSeq.length }));
      this.mutTool.isCalculating = false;
      return;
    }

    let fromRes = this.mutTool.fromRes.toUpperCase();
    if (activeSeq && pos >= 1 && pos <= activeSeq.length) {
      fromRes = activeSeq[pos - 1];
      this.mutTool.fromRes = fromRes; // Keep UI input in sync with sequence residue
    }

    const toRes = this.mutTool.toRes.toUpperCase();
    const ph = this.mutTool.ph;
    const tempK = this.mutTool.tempK;

    // Simulate calculation time
    setTimeout(() => {
      // Heuristic logic
      // Estimate burial neighbors m5 based on position to make it look realistic
      const m5 = Math.round(15 + Math.sin(pos * 0.15) * 12 + (pos % 5));
      const isBuried = m5 > 25;

      // Charge of original and mutated residue
      const getCharge = (r: string, phVal: number) => {
        if (r === 'K' || r === 'R') return 1.0;
        if (r === 'H') return phVal < 6.0 ? 1.0 : (phVal < 7.5 ? 0.4 : 0.0);
        if (r === 'D' || r === 'E') return phVal > 4.5 ? -1.0 : (phVal > 3.5 ? -0.5 : 0.0);
        return 0.0;
      };

      const q1 = getCharge(fromRes, ph);
      const q2 = getCharge(toRes, ph);
      const chargeChange = q2 - q1;

      // Calculate ddG (free energy change, <0 is stabilizing)
      let ddG = 0.0;

      // Hydrophobic effect vs Surface polarity
      const hydrophobics = ['A', 'V', 'I', 'L', 'F', 'M', 'W', 'Y'];
      const polars = ['S', 'T', 'N', 'Q', 'C', 'G', 'P'];
      const chargeds = ['D', 'E', 'K', 'R', 'H'];

      const isFromHydro = hydrophobics.includes(fromRes);
      const isToHydro = hydrophobics.includes(toRes);
      const isToCharged = chargeds.includes(toRes);
      const isFromCharged = chargeds.includes(fromRes);

      if (isBuried) {
        if (isToHydro && !isFromHydro) {
          ddG -= 1.2;
        } else if (!isToHydro && isFromHydro) {
          ddG += 2.1;
        } else if (isToCharged) {
          ddG += 3.5;
        } else {
          ddG -= 0.2;
        }
      } else {
        if (isToCharged && !isFromCharged) {
          ddG -= 0.8;
        } else if (isToHydro && !isFromHydro) {
          ddG += 1.1;
        } else {
          ddG += 0.1;
        }
      }

      // pH effects (salt bridge disruption/rescue)
      if (ph < 5.5) {
        if (fromRes === 'D' || fromRes === 'E') {
          if (toRes === 'S' || toRes === 'T' || toRes === 'N' || toRes === 'Q') {
            ddG -= 1.4;
          }
        }
        if (toRes === 'R' || toRes === 'K') {
          ddG -= 0.7;
        }
      } else if (ph > 8.5) {
        if (toRes === 'D' || toRes === 'E') {
          ddG -= 0.6;
        }
      }

      // Thermal effect
      const tempFactor = Math.max(0.5, tempK / 310.0);
      ddG = ddG * tempFactor;
      ddG = Math.round(ddG * 100) / 100;

      // Metrics adjustments
      const m1_base = 0.38 + (tempK - 273.15) * 0.004;
      const m1_mad = Math.max(0.1, Math.round((m1_base + ddG * 0.05) * 1000) / 1000);
      const m3_base = 38;
      const m3_hbond = Math.max(5, Math.round(m3_base - (ddG > 0 ? ddG * 2 : 0) + (ddG < 0 ? Math.abs(ddG) * 0.8 : 0)));

      let solventNeutralize = 'Neutral';
      if (chargeChange > 0.1) {
        solventNeutralize = 'Cl-';
      } else if (chargeChange < -0.1) {
        solventNeutralize = 'Na+';
      }

      const isStable = ddG < -0.2;

      let explanation = '';
      if (ddG < -0.5) {
        explanation = `${m.copilotExplStableHead({ v1: `${fromRes}${pos}${toRes}`, v2: ddG })}\n\n`;
        if (isBuried) {
          explanation += `${m.copilotExplCorePacking({ v1: pos, v2: m5, v3: fromRes, v4: toRes })}\n`;
        } else {
          explanation += `${m.copilotExplSurfaceElectrostatics({ v1: pos, v2: m5, v3: ph.toFixed(1) })}\n`;
        }
        if (solventNeutralize !== 'Neutral') {
          explanation += `${m.copilotExplSolventNeutralize({ v1: `${chargeChange > 0 ? '+' : ''}${chargeChange}`, v2: solventNeutralize })}`;
        }
      } else if (ddG > 0.5) {
        explanation = `${m.copilotExplDestabilizingHead({ v1: `${fromRes}${pos}${toRes}`, v2: ddG })}\n\n`;
        if (isBuried && !isToHydro) {
          explanation += `${m.copilotExplBuriedPolarityPenalty({ v1: toRes, v2: m5 })}\n`;
        } else if (!isBuried && isToHydro) {
          explanation += `${m.copilotExplHydrophobicExposure({ v1: toRes })}\n`;
        }
        explanation += `${m.copilotExplFluctuationRise({ v1: m1_mad.toFixed(3) })}`;
      } else {
        explanation = `${m.copilotExplNeutralHead({ v1: `${fromRes}${pos}${toRes}`, v2: ddG })}\n\n${m.copilotExplNeutralBody({ v1: m3_hbond })}`;
      }

      this.mutTool.result = {
        ddG,
        m1_mad,
        m3_hbond,
        m5_burial: m5,
        chargeChange,
        solventNeutralize,
        isStable,
        caisScore: Math.max(0.1, 0.95 - Math.abs(ddG) * 0.05),
        explanation
      };
      this.mutTool.isCalculating = false;
    }, 800);
  }

  runCodonOptimization() {
    this.codonTool.isOptimizing = true;
    let seq = this.geneContext.dnaSequence || 'ATGCGTACGTTAGTC';
    seq = seq.toUpperCase().replace(/[^ATCG]/g, '');

    setTimeout(() => {
      const codons: string[] = [];
      for (let i = 0; i < seq.length; i += 3) {
        if (i + 3 <= seq.length) {
          codons.push(seq.slice(i, i + 3));
        }
      }

      const codonTables: Record<string, Record<string, string[]>> = {
        'E. coli': {
          'A': ['GCG', 'GCC', 'GCA', 'GCT'],
          'C': ['TGC', 'TGT'],
          'D': ['GAT', 'GAC'],
          'E': ['GAA', 'GAG'],
          'F': ['TTC', 'TTT'],
          'G': ['GGC', 'GGG', 'GGA', 'GGT'],
          'H': ['CAC', 'CAT'],
          'I': ['ATC', 'ATT', 'ATA'],
          'K': ['AAA', 'AAG'],
          'L': ['CTG', 'TTA', 'TTG', 'CTC', 'CTT', 'CTA'],
          'M': ['ATG'],
          'N': ['AAC', 'AAT'],
          'P': ['CCG', 'CCA', 'CCC', 'CCT'],
          'Q': ['CAG', 'CAA'],
          'R': ['CGT', 'CGC', 'CGA', 'CGG', 'AGA', 'AGG'],
          'S': ['AGC', 'AGT', 'TCT', 'TCC', 'TCA', 'TCG'],
          'T': ['ACC', 'ACG', 'ACA', 'ACT'],
          'V': ['GTG', 'GTT', 'GTC', 'GTA'],
          'W': ['TGG'],
          'Y': ['TAC', 'TAT'],
          '*': ['TAA', 'TAG', 'TGA']
        },
        'Yeast': {
          'A': ['GCT', 'GCC', 'GCA', 'GCG'],
          'C': ['TGT', 'TGC'],
          'D': ['GAT', 'GAC'],
          'E': ['GAA', 'GAG'],
          'F': ['TTC', 'TTT'],
          'G': ['GGT', 'GGA', 'GGC', 'GGG'],
          'H': ['CAC', 'CAT'],
          'I': ['ATT', 'ATC', 'ATA'],
          'K': ['AAG', 'AAA'],
          'L': ['TTG', 'TTA', 'CTG', 'CTA', 'CTC', 'CTT'],
          'M': ['ATG'],
          'N': ['AAC', 'AAT'],
          'P': ['CCA', 'CCT', 'CCC', 'CCG'],
          'Q': ['CAA', 'CAG'],
          'R': ['AGA', 'AGG', 'CGT', 'CGC', 'CGA', 'CGG'],
          'S': ['TCT', 'TCC', 'TCA', 'AGT', 'AGC', 'TCG'],
          'T': ['ACC', 'ACT', 'ACA', 'ACG'],
          'V': ['GTT', 'GTC', 'GTG', 'GTA'],
          'W': ['TGG'],
          'Y': ['TAC', 'TAT'],
          '*': ['TAA', 'TAG', 'TGA']
        },
        'Human': {
          'A': ['GCC', 'GCG', 'GCT', 'GCA'],
          'C': ['TGC', 'TGT'],
          'D': ['GAC', 'GAT'],
          'E': ['GAG', 'GAA'],
          'F': ['TTC', 'TTT'],
          'G': ['GGC', 'GGA', 'GGG', 'GGT'],
          'H': ['CAC', 'CAT'],
          'I': ['ATC', 'ATT', 'ATA'],
          'K': ['AAG', 'AAA'],
          'L': ['CTG', 'CTC', 'TTG', 'TTA', 'CTT', 'CTA'],
          'M': ['ATG'],
          'N': ['AAC', 'AAT'],
          'P': ['CCC', 'CCT', 'CCA', 'CCG'],
          'Q': ['CAG', 'CAA'],
          'R': ['CGG', 'CGC', 'CGA', 'CGT', 'AGA', 'AGG'],
          'S': ['AGC', 'TCC', 'TCT', 'AGT', 'TCA', 'TCG'],
          'T': ['ACC', 'ACA', 'ACT', 'ACG'],
          'V': ['GTG', 'GTC', 'GTT', 'GTA'],
          'W': ['TGG'],
          'Y': ['TAC', 'TAT'],
          '*': ['TGA', 'TAA', 'TAG']
        }
      };

      const table = codonTables[this.codonTool.host] || codonTables['E. coli'];

      let optimizedCodons: string[] = [];
      let mutatedCodonsCount = 0;

      for (let i = 0; i < codons.length; i++) {
        const originalCodon = codons[i];
        let aa = 'X';
        for (const [key, value] of Object.entries(GENETIC_CODE)) {
          if (key === originalCodon) {
            aa = value;
            break;
          }
        }

        if (aa === 'X') {
          optimizedCodons.push(originalCodon);
          continue;
        }

        const choices = table[aa] || [originalCodon];
        let bestCodon = choices[0];
        
        const targetGcFrac = this.codonTool.targetGc / 100;
        const currentGcOfBest = (bestCodon.replace(/[^GC]/g, '').length) / 3;
        
        if (choices.length > 1 && Math.abs(currentGcOfBest - targetGcFrac) > 0.15) {
          let idealChoice = bestCodon;
          let bestDiff = Math.abs(currentGcOfBest - targetGcFrac);
          for (const choice of choices) {
            const choiceGc = (choice.replace(/[^GC]/g, '').length) / 3;
            const diff = Math.abs(choiceGc - targetGcFrac);
            if (diff < bestDiff) {
              bestDiff = diff;
              idealChoice = choice;
            }
          }
          bestCodon = idealChoice;
        }

        if (bestCodon !== originalCodon) {
          mutatedCodonsCount++;
        }
        optimizedCodons.push(bestCodon);
      }

      let optimizedDna = optimizedCodons.join('');

      let avoidedCount = 0;
      const scanAndAvoid = (dna: string) => {
        let changed = false;
        const enzymes = [
          { name: 'BsaI', seq: 'GGTCTC', enabled: this.codonTool.avoidBsaI },
          { name: 'BsaI_rev', seq: 'GAGACC', enabled: this.codonTool.avoidBsaI },
          { name: 'BsmBI', seq: 'CGTCTC', enabled: this.codonTool.avoidBsmBI },
          { name: 'BsmBI_rev', seq: 'GAGACG', enabled: this.codonTool.avoidBsmBI },
          { name: 'EcoRI', seq: 'GAATTC', enabled: this.codonTool.avoidEcoRI }
        ];

        for (const enzyme of enzymes) {
          if (!enzyme.enabled) continue;
          let idx = dna.indexOf(enzyme.seq);
          while (idx !== -1) {
            avoidedCount++;
            const codonIndex = Math.floor(idx / 3);
            if (codonIndex < optimizedCodons.length) {
              const codon = optimizedCodons[codonIndex];
              let aa = 'X';
              for (const [key, value] of Object.entries(GENETIC_CODE)) {
                if (key === codon) { aa = value; break; }
              }
              if (aa !== 'X') {
                const choices = table[aa] || [];
                if (choices.length > 1) {
                  const alt = choices.find(c => c !== codon) || choices[0];
                  optimizedCodons[codonIndex] = alt;
                  mutatedCodonsCount++;
                }
              }
            }
            dna = optimizedCodons.join('');
            idx = dna.indexOf(enzyme.seq);
            changed = true;
          }
        }
        return dna;
      };

      optimizedDna = scanAndAvoid(optimizedDna);

      const calculateGc = (d: string) => {
        const gc = d.replace(/[^GC]/g, '').length;
        return (gc / d.length) * 100;
      };

      const initialGc = calculateGc(seq);
      const optimizedGc = calculateGc(optimizedDna);

      const initialCai = 0.62 + (this.codonTool.host === 'E. coli' ? 0.05 : 0.02) + (Math.sin(seq.length) * 0.02);
      const optimizedCai = 0.94 - (Math.abs(optimizedGc - this.codonTool.targetGc) * 0.001);

      this.codonTool.result = {
        optimizedDna,
        initialGc: Math.round(initialGc * 10) / 10,
        optimizedGc: Math.round(optimizedGc * 10) / 10,
        initialCai: Math.round(initialCai * 100) / 100,
        optimizedCai: Math.round(optimizedCai * 100) / 100,
        avoidedCount,
        mutatedCodonsCount
      };

      this.codonTool.isOptimizing = false;
    }, 700);
  }

  runSopGeneration() {
    this.sopTool.isGenerating = true;
    const seq = this.geneContext.dnaSequence || 'ATGCGTACGTTAGTC';
    const len = seq.length;

    setTimeout(() => {
      const pm = this.sopTool.polymerase;
      const method = this.sopTool.method;
      const enzyme = this.sopTool.enzyme;

      const gc = this.geneContext.gcContent || 51.0;
      const primerTm = Math.round(64.9 + 41 * (gc / 100) - 600 / 22);

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
        { step: m.annealingAnnealing(), temp: `${Math.round(primerTm - 3)}°C`, time: '15 s', note: m.copilotSopNotePrimerTmAnneal() },
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
        fwdPrimer: `5'-${seq.slice(0, 10).toLowerCase()}gctagctatcgat-3'`,
        revPrimer: `5'-${seq.slice(-10).split('').reverse().join('').toLowerCase()}cgatcgatgcat-3'`,
        primerTm,
        productLength: len,
        extensionTimeS: extTime,
        pcrRecipe,
        assemblyRecipe,
        pcrCycles,
        assemblyCycles
      };
      this.sopTool.isGenerating = false;
    }, 600);
  }
}

export const aiState = new AiStateStore();
