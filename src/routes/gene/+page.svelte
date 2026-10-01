<script lang="ts">
  import { onMount, untrack, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { Textarea, Button, Tabs, Select, TextEditor } from 'svelte-multistyle-ui';
  import { backend } from '$lib/backend/api';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import ProjectDocBanner from '$lib/project/ProjectDocBanner.svelte';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import Toaster from '$lib/ui/Toaster.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { localizeInline } from '$lib/i18nMsg';
  import { Save, FileUp, Sparkles } from 'lucide-svelte';
 import { Undo2, Redo2, RotateCw, FlipHorizontal2, Circle, Spline, Dna, FlaskConical, Globe, AlignLeft, Microscope, Scissors, Check } from 'lucide-svelte';
import { Settings, Palette, ListTree, FileUp as FileUpIcon, Layers } from 'lucide-svelte';
import { Search, Plus, Trash2, GitMerge, FlaskConical as FlaskIcon, CaseSensitive, Activity, BookOpen, Download, Folder, History, Terminal } from 'lucide-svelte';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import { identityStore } from '$lib/identity/store.svelte';
  import { createElnSignatureSnapshot, digestElnSignatureSnapshot } from '$lib/genome/biophysics/limsCollaboration';
  import { currentLocale } from '$lib/i18n.svelte.ts';
  function t(zh: string, en: string): string {
    return currentLocale.value === 'zh' ? zh : en;
  }
  import { loadKeymap, getEventShortcutString, type Shortcut } from '$lib/gene/utils/keymap';

  // Import modular Svelte 5 components
  import PlasmidMap from '$lib/gene/PlasmidMap.svelte';
  import DnaViewer from '$lib/gene/DnaViewer.svelte';
  import EnzymeSelector from '$lib/gene/EnzymeSelector.svelte';
  import PrimerTable from '$lib/gene/PrimerTable.svelte';
  import VirtualGel from '$lib/gene/VirtualGel.svelte';
  import CodonOptimizer from '$lib/gene/CodonOptimizer.svelte';
  import CloningSimulator from '$lib/gene/CloningSimulator.svelte';
  import HistoryTree from '$lib/gene/HistoryTree.svelte';
  import CrisprDesigner from '$lib/gene/CrisprDesigner.svelte';
  import CloningValidator from '$lib/gene/CloningValidator.svelte';
  import SyntheticGeneQc from '$lib/gene/SyntheticGeneQc.svelte';
  import ReactionCalculators from '$lib/gene/ReactionCalculators.svelte';

  // Imported modular panels
  import RibosomalSlippagePanel from '$lib/gene/panels/RibosomalSlippagePanel.svelte';
  import ProteinViewPanel from '$lib/gene/panels/ProteinViewPanel.svelte';
  import PcrSimulationPanel from '$lib/gene/panels/PcrSimulationPanel.svelte';
  import NgsGenomicsPanel from '$lib/gene/panels/NgsGenomicsPanel.svelte';
  import AdvancedGenomicsPanel from '$lib/gene/panels/AdvancedGenomicsPanel.svelte';
  import SyntheticBiologyCadPanel from '$lib/gene/panels/SyntheticBiologyCadPanel.svelte';
  import PrimerLimsPanel from '$lib/gene/panels/PrimerLimsPanel.svelte';
  import SequenceEvolutionPanel from '$lib/gene/panels/SequenceEvolutionPanel.svelte';
  import CloningExtensionPanel from '$lib/gene/panels/CloningExtensionPanel.svelte';
  import CollectionsBatchPanel from '$lib/gene/panels/CollectionsBatchPanel.svelte';
  import CodesignParetoPanel from '$lib/gene/panels/CodesignParetoPanel.svelte';
  import ReverseTranslationPanel from '$lib/gene/panels/ReverseTranslationPanel.svelte';
  import ExpressionCassetteBuilder from '$lib/gene/ExpressionCassetteBuilder.svelte';
  import VectorTemplatePanel from '$lib/gene/VectorTemplatePanel.svelte';
  import type { AssemblyResult, ExpressionCassette, VectorTemplate } from '$lib/genome/expressionCassette';
  import MilkdownEditor from '$lib/ui/MilkdownEditor.svelte';
  import SangerChromatogram from '$lib/gene/SangerChromatogram.svelte';

  // Genome core ported from TeselaGen tg-oss (battle-tested algorithms)
  import {
    calculatePercentGC,
    getAminoAcidStringFromSequenceString,
    getCutsitesFromSequenceFlat,
    getDigestFragmentsForCutsites,
    calculateNebTm,
    getEnzymeByName,
    enzymeFromSite,
    getReverseComplementSequenceString,
    parseSequenceFile,
    serializeSequenceData,
    detectFormat,
    HistoryManager,
    type HistorySnapshot,
    buildProteinView,
    formatMw,
    nussinovFold,
    findRnaStructures,
    isRnaSequence,
    generateSyntheticTrace,
    validateSangerAgainstRef,
    assembleContigs,
    renderTraceSvg,
    pairwiseAlign,
    multipleAlign,
    alignToReference,
    analyzePrimer,
   simulatePCR,
   simulateOverlapExtensionPCR,
  simulateSiteDirectedMutagenesis
   ,
   findOrfsInPlasmid,
   annealOligos,
   simulateSilentMutagenesis,
   searchSequence,
   autoAnnotate,
   annotateFeatures,
   getCommonFeatureLibrary,
   swHitsToFeatures,
   gcSlidingWindow,
   checkFusionReadingFrame,
   parseAlignmentFile,
   BatchEngine,
   EndModificationEngine,
   parseSnapGeneDna,
   defaultEnzymesByName,
   simulateRibosomalSlippage,
   parseUniProtGff,
   buildLifecyleTraceMap,
   applyBackMutationWithOptimization,
   predictChouFasman,
   calculateKyteDoolittleProfile,
   predictProteinDomains,
   analyzeGeneticCircuits,
   checkBioBrickCompatibility,
   verifyMoCloAssembly,
   estimateTransformationEfficiency,
   exportToSBOL,
   predictTfbsMotifs,
   calculateRbsStrength,
   predictPromoters,
   predictSignalPeptide,
   predictTransmembraneHelices,
   calculateSequenceDiff,
   calculateDilution,
   calculateLigationMass,
   calculatePcrMasterMix,
   calculatePrimerTm,
   matchQueryToStockPrimers,
   runLocalBlast,
   buildPhylogeneticTree,
   calculateSequenceLogo,
   calculateDotPlot,
   calculateSkew,
   detectCpGIslands,
   detectTandemRepeats,
   codonHarmonization,
   optimizeMrna5PrimeFolding,
   predictSolubilityAndAggregation,
   predictMutationalStabilityDdG,
   estimateCopyNumberAndIncompatibility,
   auditBiosecurityScreening,
   parseGFF3,
   parseGTF,
   parseBED,
   detectCrypticSpliceSites,
   eliminateCrypticSpliceSites,
   detectCrypticPolyASignals,
   eliminateCrypticPolyASignals,
   analyzeKozak,
   optimizeKozak,
   detectPrematureStopCodons,
   calculateCpbScore,
   optimizeCodonPairs,
   detectLowComplexityRegions,
   maskLowComplexityRegions,
   predictPeptideMassFingerprint,
   comparePmfWTvsMutant,
   predictDisulfideBonds,
   predictImmunogenicityAndAntigenicity,
   calculateProteinChargeDistribution,
   analyzeFastqQuality,
   autoIdentifyAndRemoveAdapters,
   predictProkaryoticGenes,
   detectCrisprArrays,
   simulateRecombinaseCloning,
   designSsrMarkers,
   designSnpGenotypingPrimers,
   analyzeRflp,
   convertDnaConcentration,
   optimizeGradientPcr,
   estimateGelBandSizes,
   fitElisaStandardCurve,
   calculateEnzymeKinetics,
   exportPrimerOrderFormat,
   manageElnRecord,
   generate2DGrid
} from '$lib/genome';
 import { parseAb1, parseScf } from '$lib/genome/sangerTrace';
  import { simulateCloning, type CloningMethod } from '$lib/genome/cloningMethods';
  import { loadOveDemoPlasmid } from '$lib/genome/demo';

  // Ported OVE demo plasmid (pJ5_00001, 5299 bp) — full data model
  const oveDemo = loadOveDemoPlasmid();

  const ui = { style: 'pixel', theme: 'midnight' } as const;

  // ---------------- SELECTION STATES (SnapGene Parity) ----------------
  let selectionStart = $state(1);
  let selectionEnd = $state(1);

  // Draggable floating panel action (Svelte 5 action)
  function drag(node: HTMLElement, headerSelector: string) {
    let active = false;
    let initialX = 0;
    let initialY = 0;
    let xOffset = 0;
    let yOffset = 0;

    const header = node.querySelector(headerSelector) as HTMLElement;
    if (!header) return;

    // Preserve any base transform (e.g. translate(-50%,-50%) centering) so dragging
    // offsets the window instead of clobbering its initial transform and causing a jump.
    const baseTransform = (node.style.transform || '').trim();

    header.style.cursor = 'move';
    header.addEventListener('pointerdown', dragStart);

    // Initialize global maxZIndex on window if not present
    if (typeof window !== 'undefined' && !(window as any).maxZIndex) {
      (window as any).maxZIndex = 100;
    }

    // Bring this floating window to the front on click/pointerdown anywhere inside it
    node.addEventListener('pointerdown', bringToFront);

    function bringToFront() {
      if (typeof window !== 'undefined') {
        (window as any).maxZIndex += 1;
        node.style.zIndex = (window as any).maxZIndex.toString();
      }
    }

    function dragStart(e: PointerEvent) {
      if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) {
        return;
      }
      active = true;
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      header.setPointerCapture(e.pointerId);
      header.addEventListener('pointermove', handlePointerMove);
      header.addEventListener('pointerup', dragEnd);
    }

    function handlePointerMove(e: PointerEvent) {
      if (!active) return;
      e.preventDefault();
      xOffset = e.clientX - initialX;
      yOffset = e.clientY - initialY;
      node.style.transform = (baseTransform ? baseTransform + ' ' : '') + `translate3d(${xOffset}px, ${yOffset}px, 0)`;
    }

    function dragEnd(e: PointerEvent) {
      active = false;
      header.releasePointerCapture(e.pointerId);
      header.removeEventListener('pointermove', handlePointerMove);
      header.removeEventListener('pointerup', dragEnd);
    }

    return {
      destroy() {
        header.removeEventListener('pointerdown', dragStart);
        node.removeEventListener('pointerdown', bringToFront);
      }
    };
  }

  // Custom SPICE Gene format specification
  interface SpiceGeneFile {
    format: 'SPICE_GENE';
    version: '1.0';
    meta: {
      plasmidName: string;
      hostPreference: 'ecoli' | 'yeast' | 'human';
      createdAt: string;
    };
    sequence: string;
    features: {
      name: string;
      start: number;
      end: number;
      type: string;
      color: string;
      forward?: boolean;
    }[];
    selectedEnzymes: string[];
    selectionNotes?: {
      start: number;
      end: number;
      text: string;
    }[];
    notes?: string;
    notebookPages?: any[];
  }

  // ---------------- MASTER STATES ----------------
  let dnaSeq = $state(oveDemo.sequence);
  let plasmidName = $state(oveDemo.name);
  let codonHost = $state<'ecoli' | 'yeast' | 'human'>('ecoli');

  // AI Co-Pilot Context Synchronization
  $effect(() => {
    aiState.currentWorkspace = 'gene';
    aiState.geneContext.dnaSequence = dnaSeq;
    aiState.geneContext.plasmidName = plasmidName;
    aiState.geneContext.codonHost = codonHost;
    aiState.geneContext.gcContent = calculatePercentGC(dnaSeq);
  });

  // Save selected enzymes to localStorage whenever they change
  $effect(() => {
    if (typeof localStorage !== 'undefined' && selectedEnzymes) {
      localStorage.setItem('spice_selected_enzymes', JSON.stringify(selectedEnzymes));
    }
  });

  onMount(() => {
    aiState.onApplyDnaSequence = (newSeq: string) => {
      dnaSeq = newSeq;
    };
    
    // Load primer inventory from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('spice_primer_inventory');
      if (saved) {
        try {
          primerInventory = JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse saved primer inventory:', e);
        }
      }
    }

    return () => {
      aiState.onApplyDnaSequence = null;
    };
  });
  function getInitialSelectedEnzymes(): string[] {
    if (typeof localStorage === 'undefined') {
      return ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NdeI', 'SacI', 'SalI', 'KpnI'];
    }
    const saved = localStorage.getItem('spice_selected_enzymes');
    if (!saved) {
      return ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NdeI', 'SacI', 'SalI', 'KpnI'];
    }
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
        return parsed;
      }
    } catch (e) {}
    return ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NdeI', 'SacI', 'SalI', 'KpnI'];
  }

  let selectedEnzymes = $state<string[]>(getInitialSelectedEnzymes());
  let activeFeatureId = $state<number | null>(null);
  let quickDbId = $state('');
  let log: string[] = $state([]);
  let isDragging = $state(false);

  // Ported OVE demo primers + parts (pJ5_00001)
  let ovePrimers = $state(oveDemo.primers);
  let oveParts = $state(oveDemo.parts);

  let showCloningModal = $state(false);
  let showExportModal = $state(false);
  let activeTab = $state<'circular' | 'linear' | 'sequence' | 'features' | 'properties' | 'notes'>('circular');
  let geneFileInput = $state<HTMLInputElement | null>(null);

  const activeTabsList = $derived.by(() => {
    const labels = {
      circular: m.tabCircularMap(),
      linear: m.tabLinearMap(),
      sequence: m.tabSequenceMap(),
      features: m.tabFeatures(),
      properties: m.tabProperties(),
      notes: m.tabNotes()
    };
    return (['circular', 'linear', 'sequence', 'features', 'properties', 'notes'] as const).map((id) => ({ id, label: labels[id] }));
  });

  // Draggable split between the left pane and the sequence viewer
  const SPLIT_MIN = 320;
  function clampW(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
  function splitMax() { return typeof window !== 'undefined' ? Math.max(SPLIT_MIN, window.innerWidth - 360) : 1200; }
  let leftW = $state((typeof localStorage !== 'undefined' && Number(localStorage.getItem('spice_gene_split_l'))) || 640);
  function persistSplit() { try { localStorage.setItem('spice_gene_split_l', String(leftW)); } catch { /* ignore */ } }
  function startLeftResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftW;
    let lastX = startX;
    let frameId: number | null = null;
    const apply = () => { frameId = null; leftW = clampW(startLeft + (lastX - startX), SPLIT_MIN, splitMax()); };
    const onMove = (ev: PointerEvent) => { lastX = ev.clientX; if (frameId === null) frameId = requestAnimationFrame(apply); };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (frameId !== null) { cancelAnimationFrame(frameId); frameId = null; }
      apply();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      persistSplit();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  function nudgeSplit(dir: -1 | 1) { leftW = clampW(leftW + dir * 16, SPLIT_MIN, splitMax()); persistSplit(); }

// SnapGene parity: Features view
 // Features tab state: sort/filter/search
 let featureSortKey = $state<'name' | 'start' | 'size' | 'type' | 'color'>('start');
 let featureFilterType = $state<string>('all');
 let featureSearchText = $state('');
 // Settings panel
 let showSettingsPanel = $state(false);
 // Sanger file import
 let sangerFileInput = $state<HTMLInputElement | null>(null);
 // Multiple alignment
 let alignmentMultiMode = $state(false);
 let alignmentMultiText = $state('');
 let alignmentMultiResult = $state<any>(null);
 // History tree component toggle
 let showHistoryTree = $state(false);
  // linear view is driven by the "Linear Map" tab (single source of truth)
  const linear = $derived(activeTab === 'linear');
  
  // SnapGene parity: History / Undo-Redo
  const histMgr = new HistoryManager(100);
  let showHistoryPanel = $state(false);
  let canUndo = $state(false);
  let canRedo = $state(false);
  
  // SnapGene parity: Protein view
  let showProteinView = $state(false);

  // Automatically calculate modified ranges on sequence changes (Feature 5)
  let modifiedRanges = $derived.by(() => {
    const snaps = histMgr.getAll();
    if (snaps.length < 2) return [];
    const prevSnap = snaps[snaps.length - 2];
    const currentSnap = snaps[snaps.length - 1];
    if (prevSnap && currentSnap && currentSnap.sequence === dnaSeq) {
      return calculateSequenceDiff(prevSnap.sequence, currentSnap.sequence);
    }
    return [];
  });



  // Tabbed Workspace Document Manager (Feature 10)
  interface WorkspaceTab {
    id: string;
    name: string;
    dnaSeq: string;
    plasmidName: string;
    features: any[];
    /** Set when this tab hosts an embedded SPICE_PROJECT doc. */
    docId?: string;
    workspaceKind?: 'standalone' | 'project';
  }

  let tabsList = $state<WorkspaceTab[]>([]);
  let activeTabId = $state<string>('');

  // Initial tab setup with localStorage crash recovery and persistence
  onMount(() => {
    if (typeof localStorage !== 'undefined') {
      const savedTabs = localStorage.getItem('spice_gene_workspace_tabs_list');
      const savedActiveId = localStorage.getItem('spice_gene_workspace_active_tab_id');
      const savedPages = localStorage.getItem('spice_gene_active_notebook_pages');

      if (savedTabs && savedActiveId) {
        try {
          tabsList = JSON.parse(savedTabs);
          activeTabId = savedActiveId;
          const activeTab = tabsList.find(t => t.id === activeTabId);
          if (activeTab) {
            dnaSeq = activeTab.dnaSeq;
            plasmidName = activeTab.plasmidName;
            geneFeatures = [...activeTab.features];
          }
          if (savedPages) {
            notebookPages = JSON.parse(savedPages);
            if (notebookPages.length > 0) {
              const page = notebookPages[currentPageIdx] || notebookPages[0];
              propNotesMarkdown = page.markdownContent;
              elnTitle = page.title;
              elnCategory = page.category;
              elnTagsString = page.tags.join(', ');
              elnWitness = page.witness || '';
              elnReason = page.reason || m.elnDefaultReason();
            }
          }
          pushLog(m.logWorkspaceSessionRecovered());
          return;
        } catch (e) {
          console.error("Failed to restore workspace session:", e);
        }
      }
    }

    // Default pUC19 tab fallback on first load
    tabsList = [{
      id: 'tab_default',
      name: 'pUC19_cloning_vector.gb',
      dnaSeq: oveDemo.sequence,
      plasmidName: 'pUC19_cloning_vector',
      features: [...oveDemo.features]
    }];
    activeTabId = 'tab_default';
  });

  // SPICE_PROJECT handoff consumer: either capture the live workspace into
  // the open project, or load an embedded doc into a dedicated project tab.
  onMount(() => {
    const h = projectStore.takeHandoff();
    if (!h) return;
    if (h.type === 'capture' && h.kind === 'gene') {
      try {
        projectStore.addDoc('gene', plasmidName || 'Gene', serializeSpiceGeneFile());
        pushToast('success', m.projectDocAddedToast(), plasmidName);
      } catch (e: any) {
        pushToast('error', m.projectSaveFailedToast(), String(e?.message ?? e));
      }
      goto('/project');
      return;
    }
    if (h.type === 'openDoc' && h.kind === 'gene') {
      const doc = projectStore.getDoc(h.docId);
      if (!doc) return;
      const tabId = `tab_proj_${doc.id}`;
      if (!tabsList.some(t => t.id === tabId)) {
        tabsList = [...tabsList, { id: tabId, name: '', dnaSeq: '', plasmidName: '', features: [], docId: doc.id, workspaceKind: 'project' }];
      }
      activeTabId = tabId; // set BEFORE apply so sync-back mirrors into this tab
      applySpiceGeneFile(doc.payload as SpiceGeneFile);
      projectStore.activeDocId = doc.id;
      pushLog(m.logProjectDocLoaded({ v1: doc.name }));
    }
  });

  // Save workspace tabs, active tab ID, and ELN pages reactively in real-time
  $effect(() => {
    if (typeof localStorage !== 'undefined' && tabsList && tabsList.length > 0) {
      localStorage.setItem('spice_gene_workspace_tabs_list', JSON.stringify(tabsList));
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined' && activeTabId) {
      localStorage.setItem('spice_gene_workspace_active_tab_id', activeTabId);
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined' && notebookPages && notebookPages.length > 0) {
      localStorage.setItem('spice_gene_active_notebook_pages', JSON.stringify(notebookPages));
    }
  });

  let isSwitchingTab = false;

  // Swapping active tabs explicitly to prevent Svelte 5 reactive race conditions (Feature 10)
  async function switchActiveTab(tabId: string) {
    if (tabId === activeTabId) return;

    // 1. Synchronously save the old tab state first
    if (activeTabId) {
      tabsList = tabsList.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            dnaSeq: dnaSeq,
            plasmidName: plasmidName,
            name: `${plasmidName}.gb`,
            features: [...geneFeatures]
          };
        }
        return t;
      });
    }

    // 2. Load the next tab's state
    const nextTab = tabsList.find(t => t.id === tabId);
    if (nextTab) {
      isSwitchingTab = true; // Lock reactive syncing

      activeTabId = tabId;
      dnaSeq = nextTab.dnaSeq;
      plasmidName = nextTab.plasmidName;
      geneFeatures = [...nextTab.features];
      
      // Reset selections to safe 1bp
      selectionStart = 1;
      selectionEnd = 1;

      // Yield to Svelte to update dependencies before releasing lock
      await tick();
      isSwitchingTab = false; // Unlock reactive syncing
      pushLog(m.logWorkspaceTabSwitch({ name: nextTab.name }));
    }
  }

  // Synchronize edits back to the active tab (Feature 10)
  $effect(() => {
    const currentSeq = dnaSeq;
    const currentName = plasmidName;
    const currentFeats = geneFeatures;

    // ONLY sync if we are not switching tabs and initial load is complete
    if (activeTabId && !isSwitchingTab && initialLoadComplete) {
      untrack(() => {
        tabsList = tabsList.map(t => {
          if (t.id === activeTabId) {
            return {
              ...t,
              dnaSeq: currentSeq,
              plasmidName: currentName,
              name: `${currentName}.gb`,
              features: [...currentFeats]
            };
          }
          return t;
        });
      });
    }
  });

  // SPICE_PROJECT write-back: mirror master state into the embedded doc
  // payload whenever a project doc is the active workspace. Reads only the
  // MASTER states (never tabsList reactively — sync-back rewrites its array
  // identity on every edit, which would double-fire this effect).
  $effect(() => {
    const docId = projectStore.activeDocId;
    const kind = projectStore.activeDocKind;
    const tabId = activeTabId;
    const _s = dnaSeq;
    const _f = geneFeatures;
    const _sn = selectionNotes;
    const _e = selectedEnzymes;
    const _n = propNotesMarkdown;
    const _p = notebookPages;
    const _h = codonHost;
    const _pn = plasmidName;
    void _s; void _f; void _sn; void _e; void _n; void _p; void _h; void _pn;
    if (kind !== 'gene' || !docId || isSwitchingTab || !initialLoadComplete) return;
    untrack(() => {
      const tab = tabsList.find(t => t.id === tabId);
      if (!tab || tab.docId !== docId) {
        // User navigated to a standalone tab while a project doc was
        // "active" — disarm write-back until the doc is opened again.
        projectStore.activeDocId = null;
        return;
      }
      projectStore.commitGeneDoc(serializeSpiceGeneFile());
    });
  });

  // Create a new blank tab
  function createNewTab() {
    // 1. Explicitly save current active tab first
    if (activeTabId) {
      tabsList = tabsList.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            dnaSeq: dnaSeq,
            plasmidName: plasmidName,
            name: `${plasmidName}.gb`,
            features: [...geneFeatures]
          };
        }
        return t;
      });
    }

    const newId = `tab_${Date.now()}`;
    const newName = `Construct_${tabsList.length + 1}`;
    const newTab: WorkspaceTab = {
      id: newId,
      name: `${newName}.gb`,
      dnaSeq: "ATGGTGTCTAAGGGCGAAGAGCTGATTAAGGAGAACATGCACATGAAGCTGTACATGGAGGGCACCGTGGACAACCATCACTTCAAGTGCACATCCGAGGGCGAAGGCAAGCCCTACGAGGGCACCCAGACCATGAGAATCAAGGTGGTCGA",
      plasmidName: newName,
      features: [
        { id: 1, name: "Starter_CDS", start: 1, end: 60, type: "cds", color: "#b48cff" }
      ]
    };

    isSwitchingTab = true; // Lock syncing
    tabsList = [...tabsList, newTab];
    activeTabId = newId;
    dnaSeq = newTab.dnaSeq;
    plasmidName = newTab.plasmidName;
    geneFeatures = [...newTab.features];
    selectionStart = 1;
    selectionEnd = 1;

    setTimeout(() => {
      isSwitchingTab = false; // Unlock syncing safely after mount
    }, 50);

    pushToast('success', m.labelCreateDocSuccess(), `${newName}.gb`);
    pushLog(m.logCreateDocSuccess({ name: newName }));
  }

  // Close a tab
  function closeTab(id: string, e: Event) {
    e.stopPropagation();
    if (tabsList.length <= 1) {
      pushToast('warn', m.labelCannotCloseOnlyTab(), m.labelWorkspaceMustHaveTab());
      return;
    }
    const idx = tabsList.findIndex(t => t.id === id);
    const tabName = tabsList[idx].name;
    
    tabsList = tabsList.filter(t => t.id !== id);
    if (activeTabId === id) {
      // Load next active tab explicitly using our explicit switch handler
      const nextId = tabsList[Math.max(0, idx - 1)].id;
      isSwitchingTab = true;
      activeTabId = nextId;
      const nextTab = tabsList.find(t => t.id === nextId)!;
      dnaSeq = nextTab.dnaSeq;
      plasmidName = nextTab.plasmidName;
      geneFeatures = [...nextTab.features];
      selectionStart = 1;
      selectionEnd = 1;
      
      setTimeout(() => {
        isSwitchingTab = false;
      }, 50);
    }
    pushToast('info', m.labelClosedDoc(), tabName);
    pushLog(m.logClosedDoc({ name: tabName }));
  }
  
  // Advanced Genomics Tools
  let showGenomicsTools = $state(false);
  
  // Synthetic Biology CAD Tools
  let showSynBioTools = $state(false);

  // Feature 5: PCR & Cloning Reaction Calculators
  let showCalculatorsPanel = $state(false);

  // Feature 6: Primer LIMS-lite Inventory
  let showPrimersLimsPanel = $state(false);

  let primerInventory = $state<any[]>([
    { id: "p1", name: "pUC19_Fwd_Seq", sequence: "GTTTTCCCAGTCACGAC", tm: 54, concentration: 100, volume: 45, location: "A1" },
    { id: "p2", name: "pUC19_Rev_Seq", sequence: "CAGGAAACAGCTATGAC", tm: 54, concentration: 100, volume: 38, location: "A2" },
    { id: "p3", name: "EGFP_C_term_His", sequence: "CATCACCATCACCATCACCATTAA", tm: 58, concentration: 100, volume: 50, location: "C4" }
  ]);

  $effect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('spice_primer_inventory', JSON.stringify(primerInventory));
    }
  });


  // Features 7, 8, 9 & 10: Sequence & Evolution Analysis Panel
  let showSeqAnalysisPanel = $state(false);
  
  // SnapGene parity: RNA structure view
  let showRnaStructure = $state(false);
  let rnaResult = $state<any>(null);
  let isRnaLoading = $state(false);

  $effect(() => {
    if (showRnaStructure && dnaSeq) {
      isRnaLoading = true;
      const isRna = isRnaSequence(dnaSeq);
      backend.findRnaStructuresRust(dnaSeq, isRna, 120, 60, -10).then(r => {
        rnaResult = r.data;
        isRnaLoading = false;
      });
    }
  });
  
  // SnapGene parity: Sanger trace
  let showSangerPanel = $state(false);
  let sangerTraces = $state<any[]>([]);
  let sangerQuery = $state('');

  // SnapGene parity: Alignment
  let showAlignmentPanel = $state(false);
  let alignmentResult = $state<any>(null);
  let alignmentQuery = $state('');
  let alignmentMode = $state<'global' | 'local' | 'semi-global'>('semi-global');
  
  // SnapGene parity: PCR simulation
  let showPcrPanel = $state(false);
  
  // SnapGene parity: Ensembl import
  let ensemblQuery = $state('');
  let ensemblLoading = $state(false);
  let showEnsemblPanel = $state(false);

  // SnapGene parity: Project Collections and Batch operations (Gaps 6 & 7)
  let showCollectionsPanel = $state(false);

  // SnapGene parity: Custom feature types (Gap 9)
  let customFeatureTypes = $state<string[]>([]);
  const allFeatureTypes = $derived([...new Set([
    'cds', 'promoter', 'terminator', 'ori', 'primer_bind', 'misc_feature', 
    'gene', 'exon', 'intron', 'rRNA', 'tRNA', 'mRNA', ...customFeatureTypes
  ])]);

  // SnapGene parity: Rich Properties fields (Gap 17)
  let propCreatedDate = $state('Oct 25, 2005');
  let propModifiedDate = $state('Oct 25, 2005');
  let propDnaType = $state('Natural DNA');
  let propLabHost = $state('Komagataella pastoris (Pichia pastoris)');
  let propSequenceClass = $state('PLN - plant, fungal, and algal');
  let propDescription = $state('Pichia pastoris Sec16 (SEC16) gene, complete cds.');
  let propAccession = $state('DQ115396');
  let propCodeNumber = $state('');
  // ELN/signature author is bound to the verified ORCID profile name
  // (see identity store; derived below after `identity`).
  let propComments = $state('');
  let propReferences = $state('1. Connerly PL, Esaki M, Montegna EA, Strongin DE, Levi S, Soderholm J, Glick BS. Sec16 is a determinant of transitional ER organization.');

  // Notes state (Markdown content)
  let propNotesMarkdown = $state(`# SPICE notes for OVE_Demo\n\nThis plasmid contains standard cloning vectors, including an AmpR antibiotic selection marker and pUC replication origin.\n\n### Experimental Protocol\n1. Run **Restriction Digest** with SalI / KpnI.\n2. Ligate the insert (mTagBFP2).\n3. Transform into E. coli chemically competent cells.`);

  // Selection Annotations/Notes (Gap 17)
  let selectionNotes = $state<{ start: number; end: number; text: string }[]>([]);
  let newSelectionNoteText = $state('');

  let initialLoadComplete = $state(false);
  let isProjectDirty = $state(false);
  let seqTool = $state<'browse' | 'edit' | 'annotate'>('browse');

  // Advanced Biophysics & CAD panels states (26 Features)
  let showSyntheticGeneQc = $state(false);
  let showNgsGenomicsPanel = $state(false);
  let showCloningExtensionPanel = $state(false);
  let showCodesignPanel = $state(false);
  




  // LIMS, ELN & 2D Grid
  let elnTitle: string = $state(m.elnDefaultTitle());
  let elnCategory = $state<'Cloning' | 'PCR' | 'Cell_Transformation' | 'Electrophoresis' | 'General'>('Cloning');
  let elnTagsString = $state('SPICE, ELN, Auto_Sign');

  let notebookPages = $state<any[]>([]);
  let currentPageIdx = $state<number>(0);
  let showPageManagerModal = $state(false);
  let editorRef = $state<any>(null);

  let elnWitness = $state('');
  let elnReason = $state(m.elnDefaultReason());
  const identity = identityStore;
  let identityLoading = $state(false);

  // Canonical author name: ONLY from the verified ORCID profile (empty until
  // the profile resolves — signing is additionally guarded in signCurrentEln).
  const propAuthor = $derived(identity.value.profile ? identity.displayName : '');

  // Re-verify the saved ORCID on mount so the author field is populated
  // without waiting for a signing attempt.
  onMount(() => {
    void resolveElnIdentity();
  });

  async function resolveElnIdentity() {
    const savedOrcid = typeof localStorage !== 'undefined' ? localStorage.getItem('spice_orcid') || '' : '';
    identity.setOrcid(savedOrcid);
    if (!identity.value.orcid) return null;
    identityLoading = true;
    try {
      return await identity.load();
    } catch {
      return null;
    } finally {
      identityLoading = false;
    }
  }

  async function signCurrentEln() {
    syncCurrentPage();
    const profile = identity.value.profile || await resolveElnIdentity();
    if (!profile) {
      pushToast('error', m.elnOrcidRequired(), m.elnOrcidRequiredDesc());
      return;
    }
    const page = notebookPages[currentPageIdx];
    if (!page || page.locked) return;
    const signedAt = new Date().toISOString();
    const signature = createElnSignatureSnapshot({
      signer: `${propAuthor} (${profile.orcid})`,
      signedAt,
      reason: elnReason,
      witness: elnWitness,
      witnessSignedAt: elnWitness ? signedAt : undefined
    });
    const digest = await digestElnSignatureSnapshot(signature);
    page.signature = signature;
    page.signatureDigest = digest;
    page.orcid = profile.orcid;
    page.locked = true;
    page.witness = elnWitness;
    page.reason = elnReason;
    page.witnessDate = new Date().toLocaleString();
    addAuditTrail(currentPageIdx, 'Page Signed & Locked', `Signed by ${propAuthor} (${profile.orcid}). Digest: ${digest}`);

    const tagsArray = elnTagsString.split(',').map(t => t.trim()).filter(Boolean);
    const elnResult = manageElnRecord('create', {
      id: page.id, title: elnTitle, author: propAuthor, date: page.date,
      category: elnCategory, markdownContent: propNotesMarkdown,
      linkedSequenceName: plasmidName, linkedSequenceLength: dnaSeq.length,
      tags: tagsArray, signature
    }, []);
    let auditTrailMd = '\n\n### 4. GxP Compliance Audit Trail (21 CFR Part 11)\n';
    auditTrailMd += '| Timestamp | Operator | Action | Details |\n| :--- | :--- | :--- | :--- |\n';
    for (const entry of page.auditTrail || []) auditTrailMd += `| ${entry.timestamp} | ${entry.operator} | ${entry.action} | ${entry.details} |\n`;
    const finalMarkdown = `${elnResult.formattedMarkdown}${auditTrailMd}\n\n**Signature digest (SHA-256):** ${digest}`;
    const blob = new Blob([finalMarkdown], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `SPICE_ELN_${elnTitle.replace(/\s+/g, '_')}_${Date.now()}.md`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(link.href);
    isProjectDirty = true;
    saveProjectAsSpiceg();
    pushToast('success', m.elnSignedSuccess(), digest.slice(0, 16));
    pushLog(`[ELN] Signed and locked "${elnTitle}" by ORCID ${profile.orcid}; digest ${digest}`);
  }

  function addAuditTrail(pageIdx: number, action: string, details: string) {
    if (pageIdx !== null && pageIdx >= 0 && pageIdx < notebookPages.length) {
      const entry = {
        timestamp: new Date().toLocaleString(),
        operator: propAuthor || 'System',
        action,
        details
      };
      if (!notebookPages[pageIdx].auditTrail) {
        notebookPages[pageIdx].auditTrail = [];
      }
      const trail = notebookPages[pageIdx].auditTrail;
      if (trail.length > 0 && trail[trail.length - 1].action === action && trail[trail.length - 1].details === details) {
        return;
      }
      notebookPages[pageIdx].auditTrail.push(entry);
    }
  }

  function generateDefaultPlasmidTemplate() {
    let featuresListString = "";
    if (geneFeatures.length > 0) {
      featuresListString = geneFeatures.map((f, i) => {
        return `${i + 1}. **${f.name}** [${f.start}..${f.end} bp] | Type: ${f.type.toUpperCase()} | Direction: ${f.forward !== false ? 'Forward' : 'Reverse'}`;
      }).join('\n');
    } else {
      featuresListString = m.elnMdNoFeatures();
    }

    return [
      `# 📔 SPICE ELN Research Log — ${plasmidName}`,
      m.elnMdSectionMetadata(),
      `- **Plasmid Name:** ${plasmidName}`,
      `- **Length:** ${dnaSeq.length} bp`,
      `- **Topology:** ${linear ? m.elnMdTopologyLinear() : m.elnMdTopologyCircular()}`,
      `- **GC Content:** ${dnaGcContent.toFixed(1)}%`,
      `- **Laboratory Host:** ${propLabHost}`,
      `- **Sequence Author:** ${propAuthor}`,
      `- **Date Created:** ${new Date().toLocaleDateString()}`,
      ``,
      m.elnMdSectionFeatures(),
      m.elnMdFeatureCountLine({ v1: geneFeatures.length }),
      featuresListString,
      ``,
      m.elnMdSectionProtocols(),
      m.elnMdSubsectionCloned(),
      m.elnMdCheckDigest(),
      m.elnMdCheckPcr(),
      m.elnMdCheckLigation(),
      ``,
      m.elnMdSubsectionNotes(),
      m.elnMdNotesPrompt()
    ].join('\n');
  }

  // Auto-initialize first default page with audit trail and dynamic plasmid-aware template
  $effect(() => {
    if (notebookPages.length === 0) {
      const dynamicTemplate = generateDefaultPlasmidTemplate();
      notebookPages = [{
        id: `eln_${Date.now()}`,
        title: m.elnPageDefaultTitle({ v1: plasmidName }),
        author: propAuthor,
        date: new Date().toLocaleDateString(),
        category: elnCategory,
        markdownContent: dynamicTemplate,
        tags: elnTagsString.split(',').map(t => t.trim()).filter(Boolean),
        locked: false,
        witness: '',
        reason: '',
        auditTrail: [{
          timestamp: new Date().toLocaleString(),
          operator: propAuthor,
          action: "Page Created",
          details: "First default ELN page created automatically with active plasmid template."
        }]
      }];
      propNotesMarkdown = dynamicTemplate;
      elnTitle = m.elnPageDefaultTitle({ v1: plasmidName });
    }
  });

  function syncCurrentPage() {
    if (currentPageIdx !== null && currentPageIdx >= 0 && currentPageIdx < notebookPages.length) {
      notebookPages[currentPageIdx].markdownContent = propNotesMarkdown;
      notebookPages[currentPageIdx].title = elnTitle;
      notebookPages[currentPageIdx].category = elnCategory;
      notebookPages[currentPageIdx].tags = elnTagsString.split(',').map(t => t.trim()).filter(Boolean);
      if (!notebookPages[currentPageIdx].locked) {
        notebookPages[currentPageIdx].witness = elnWitness;
        notebookPages[currentPageIdx].reason = elnReason;
      }
    }
  }

  function selectPage(idx: number) {
    syncCurrentPage();
    currentPageIdx = idx;
    const p = notebookPages[idx];
    propNotesMarkdown = p.markdownContent;
    elnTitle = p.title;
    elnCategory = p.category;
    elnTagsString = p.tags.join(', ');
    elnWitness = p.witness || '';
    elnReason = p.reason || m.elnDefaultReason();
    addAuditTrail(idx, "Page Viewed", `Researcher viewed page ${idx + 1}`);
  }

  function newElnPage() {
    syncCurrentPage();
    const page = {
      id: `eln_${Date.now()}`,
      title: `${plasmidName} - Page ${notebookPages.length + 1}`,
      author: propAuthor,
      date: new Date().toLocaleDateString(),
      category: elnCategory,
      markdownContent: '',
      tags: [] as string[],
      locked: false,
      witness: '',
      reason: '',
      auditTrail: [{
        timestamp: new Date().toLocaleString(),
        operator: propAuthor,
        action: 'Page Created',
        details: 'New blank ELN page created from Page Manager.'
      }]
    };
    notebookPages = [...notebookPages, page];
    currentPageIdx = notebookPages.length - 1;
    propNotesMarkdown = '';
    elnTitle = page.title;
    elnTagsString = '';
    elnWitness = '';
    elnReason = m.elnDefaultReason();
    isProjectDirty = true;
    pushLog(`[ELN] Created new page ${currentPageIdx + 1}: ${page.title}`);
  }

  function deleteElnPage(idx: number) {
    if (notebookPages.length <= 1) {
      pushToast('warn', m.elnDelete(), m.toastElnMinOnePageDesc());
      return;
    }
    const removed = notebookPages[idx];
    if (removed?.locked) {
      pushToast('error', m.elnLockedState(), m.toastElnSignedNoDelete({ v1: removed.title }));
      return;
    }
    const next = notebookPages.filter((_, i) => i !== idx);
    notebookPages = next;
    const newIdx = Math.min(idx, next.length - 1);
    const p = next[newIdx];
    currentPageIdx = newIdx;
    propNotesMarkdown = p.markdownContent || '';
    elnTitle = p.title;
    elnCategory = p.category;
    elnTagsString = (p.tags || []).join(', ');
    elnWitness = p.witness || '';
    elnReason = p.reason || m.elnDefaultReason();
    isProjectDirty = true;
    pushLog(`[ELN] Deleted page ${idx + 1}: ${removed?.title ?? ''}`);
  }

  function insertDnaBlock() {
    const start = selectionStart;
    const end = selectionEnd;
    let seqStr = "";
    let rawSeq = "";
    let name = "Sequence Fragment";
    
    if (start !== 1 || end !== 1) {
      const s = Math.min(start, end);
      const e = Math.max(start, end);
      rawSeq = dnaSeq.substring(s - 1, e);
      name = m.elnBlockSelectionDnaName({ v1: s, v2: e });
    } else {
      rawSeq = dnaSeq;
      name = m.elnBlockFullDnaName({ v1: plasmidName });
    }
    
    // Format the DNA sequence: group into blocks of 10 bases, 5 blocks per line (50 bases)
    const cleanSeq = rawSeq.toLowerCase().replace(/[^atcgn]/g, '');
    const blocks = [];
    for (let i = 0; i < cleanSeq.length; i += 10) {
      blocks.push(cleanSeq.substring(i, i + 10));
    }
    
    const lines = [];
    for (let i = 0; i < blocks.length; i += 5) {
      lines.push(blocks.slice(i, i + 5).join(' '));
    }
    seqStr = lines.join('\n');
    
    const dnaBlockMarkdown = `\n\n### 🧬 DNA Sequence Block - ${name} [${rawSeq.length} bp]\n\`\`\`dna\n${seqStr}\n\`\`\`\n`;
    
    if (editorRef) {
      editorRef.insertMarkdown(dnaBlockMarkdown);
      pushToast('success', m.toastElnDnaBlockInserted(), `${rawSeq.length} bp`);
      pushLog(m.logElnDnaBlockInserted({ v1: name, v2: rawSeq.length }));
      addAuditTrail(currentPageIdx, "DNA Block Inserted", `Inserted DNA block: ${name} (${rawSeq.length} bp)`);
    } else {
      propNotesMarkdown += dnaBlockMarkdown;
    }
  }

  function insertProteinBlock() {
    const start = selectionStart;
    const end = selectionEnd;
    let dnaSegment = "";
    let name = "Protein Fragment";
    
    if (start !== 1 || end !== 1) {
      const s = Math.min(start, end);
      const e = Math.max(start, end);
      dnaSegment = dnaSeq.substring(s - 1, e);
      name = m.elnBlockSelectionProteinName({ v1: s, v2: e });
    } else {
      dnaSegment = dnaSeq;
      name = m.elnBlockFullProteinName({ v1: plasmidName });
    }
    
    // Translate DNA segment to Protein (amino acid single letter codes)
    const aaSeq = getAminoAcidStringFromSequenceString(dnaSegment, { forward: true });
    
    // Format amino acids: group into blocks of 10, 5 blocks per line (50 aa)
    const cleanSeq = aaSeq.toUpperCase().replace(/[^a-zA-Z]/g, '');
    const blocks = [];
    for (let i = 0; i < cleanSeq.length; i += 10) {
      blocks.push(cleanSeq.substring(i, i + 10));
    }
    
    const lines = [];
    for (let i = 0; i < blocks.length; i += 5) {
      lines.push(blocks.slice(i, i + 5).join(' '));
    }
    const formattedAaSeq = lines.join('\n');
    
    const proteinBlockMarkdown = `\n\n### 🧪 Protein Sequence Block - ${name} [${aaSeq.length} aa]\n\`\`\`protein\n${formattedAaSeq}\n\`\`\`\n`;
    
    if (editorRef) {
      editorRef.insertMarkdown(proteinBlockMarkdown);
      pushToast('success', m.toastElnProteinBlockInserted(), `${aaSeq.length} aa`);
      pushLog(m.logElnProteinBlockInserted({ v1: name, v2: aaSeq.length }));
      addAuditTrail(currentPageIdx, "Protein Block Inserted", `Inserted Protein block: ${name} (${aaSeq.length} aa)`);
    } else {
      propNotesMarkdown += proteinBlockMarkdown;
    }
  }

  let currentProjectFilePath = $state<string | null>(null);
  let autoSaveEnabled = $state(false);

  // Auto-save effect: triggers silently whenever project becomes dirty (Settings-Gene Editor)
  $effect(() => {
    if (autoSaveEnabled && isProjectDirty) {
      syncCurrentPage();
      if (currentProjectFilePath) {
        saveProjectAsSpiceg({ silent: true });
      } else {
        // Silently save the entire project state to localStorage as a local cache (Feature 10 Auto-save)
        localStorage.setItem('spice_gene_active_autosave_cache', JSON.stringify(serializeSpiceGeneFile()));
        isProjectDirty = false; // Reset dirty state silently
        pushLog(m.logAutosaveOffline());
      }
    }
  });

  // Svelte 5 reactive effect to track edits after initial load
  $effect(() => {
    // Register dependencies reactively
    const _seq = dnaSeq;
    const _feats = geneFeatures;
    const _notes = selectionNotes;
    const _enz = selectedEnzymes;
    const _mainNotes = propNotesMarkdown;
    const _elnTitle = elnTitle;
    const _elnCategory = elnCategory;
    const _elnTags = elnTagsString;
    const _pages = notebookPages;

    if (!initialLoadComplete) {
      initialLoadComplete = true;
      return;
    }
    isProjectDirty = true;
  });

  // Reactive auto-sync of active page attributes in memory
  $effect(() => {
    const _md = propNotesMarkdown;
    const _title = elnTitle;
    const _cat = elnCategory;
    const _tags = elnTagsString;
    untrack(() => {
      if (currentPageIdx !== null && currentPageIdx >= 0 && currentPageIdx < notebookPages.length) {
        notebookPages[currentPageIdx].markdownContent = propNotesMarkdown;
        notebookPages[currentPageIdx].title = elnTitle;
        notebookPages[currentPageIdx].category = elnCategory;
        notebookPages[currentPageIdx].tags = elnTagsString.split(',').map(t => t.trim()).filter(Boolean);
      }
    });
  });

  let collectionsList = $state<any[]>([]);

  // Save collectionsList to localStorage automatically on changes
  $effect(() => {
    if (typeof localStorage !== 'undefined' && collectionsList) {
      localStorage.setItem('spice_gene_collections_list', JSON.stringify(collectionsList));
    }
  });

  // Save interface customization preferences on changes
  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      const config = {
        bgColor,
        showSingleStrand,
        colorTheme,
        showFeatures,
        showOrfs,
        showTranslations,
        showPrimersOnMap,
        showCutsites,
        showEnzymeSelector,
        showCodonOptimizer,
        showPrimerTable,
        showVirtualGel,
        showLogger,
        showCrisprDesigner,
        showCloningValidator
      };
      localStorage.setItem('spice_gene_view_config', JSON.stringify(config));
    }
  });

  // Save default host preference on changes
  $effect(() => {
    if (typeof localStorage !== 'undefined' && codonHost) {
      localStorage.setItem('spice_default_host', codonHost);
    }
  });

  // Advanced Collections filter & custom metadata columns (Feature 9)
  let colSearch = $state('');
  let colSelectedTag = $state('All');
  



  
  // SnapGene parity: Interface customization
  let bgColor = $state('#070a12');
  let showSingleStrand = $state(false);
  let colorTheme = $state('monochrome');
  let showFeatures = $state(true);
  let showOrfs = $state(false);
  let showTranslations = $state(true);
  let showPrimersOnMap = $state(true);
  let showCutsites = $state(true);

  let showEnzymeSelector = $state(true);
  let showCodonOptimizer = $state(false);
  let showPrimerTable = $state(false);
  let showVirtualGel = $state(false);
  let showLogger = $state(false);
  let showCrisprDesigner = $state(false);
  let showCloningValidator = $state(false);

  // SnapGene parity: Ribosomal Slippage (PRF) state variables (Gap 10)
  let showSlippagePanel = $state(false);
  let slippageStartPos = $state(1);
  let slippageSitePattern = $state('TTTAAAC');
  let slippageShift = $state(-1);
  let slippageResult = $state<any>(null);

  // SnapGene parity: Sequence Search
  let showSearchBar = $state(false);
  let searchQuery = $state('');
  let searchResults = $state<any>(null);

  // SnapGene parity: Manual Feature Annotation
  let showFeatureEditor = $state(false);
  let editingFeature = $state<{ id?: number; name: string; start: number; end: number; type: string; color: string; forward: boolean }>({ name: '', start: 1, end: 1, type: 'cds', color: '#4cd6ff', forward: true });

  // SnapGene parity: NCBI import
  let ncbiQuery = $state('');
  let ncbiLoading = $state(false);
  let showNcbiPanel = $state(false);
  let ncbiOrganism = $state((typeof localStorage !== 'undefined' && localStorage.getItem('spice_ncbi_organism')) || 'Homo sapiens');
  $effect(() => { try { localStorage.setItem('spice_ncbi_organism', ncbiOrganism); } catch { /* ignore */ } });
  const NCBI_ORGANISMS = $derived<{ v: string; label: string }[]>([
    { v: '', label: m.ncbiOrgAny() },
    { v: 'Homo sapiens', label: m.ncbiOrgHuman() },
    { v: 'Mus musculus', label: m.ncbiOrgMouse() },
    { v: 'Rattus norvegicus', label: m.ncbiOrgRat() },
    { v: 'Danio rerio', label: m.ncbiOrgZebrafish() },
    { v: 'Xenopus tropicalis', label: m.ncbiOrgXenopus() },
    { v: 'Gallus gallus', label: m.ncbiOrgChicken() },
    { v: 'Drosophila melanogaster', label: m.ncbiOrgFruitfly() },
    { v: 'Caenorhabditis elegans', label: m.ncbiOrgRoundworm() },
    { v: 'Saccharomyces cerevisiae', label: m.ncbiOrgYeast() },
    { v: 'Escherichia coli', label: m.ncbiOrgEcoli() },
    { v: 'Arabidopsis thaliana', label: m.ncbiOrgAthaliana() },
    { v: 'Oryza sativa', label: m.ncbiOrgRice() },
    { v: 'Nicotiana tabacum', label: m.ncbiOrgTobacco() },
    { v: 'Solanum lycopersicum', label: m.ncbiOrgTomato() },
    { v: 'Glycine max', label: m.ncbiOrgSoybean() },
    { v: 'Zea mays', label: m.ncbiOrgMaize() },
    { v: 'Agrobacterium tumefaciens', label: m.ncbiOrgAgrobacterium() },
  ]);

  // SnapGene parity: UniProt direct import (Gap 13)
  let uniprotQuery = $state('');
  let uniprotLoading = $state(false);
  let showUniprotPanel = $state(false);

  // SnapGene parity: Advanced tools panels
  let showAnnealPanel = $state(false);
  let annealForward = $state('');
  let annealReverse = $state('');
  let annealResult = $state<any>(null);

  let showSilentMutPanel = $state(false);
  let silentMutSite = $state('GAATTC');
  let silentMutMode = $state<'add' | 'remove'>('add');
  let silentMutResult = $state<any>(null);

  let showReverseTranslatePanel = $state(false);

  // Expression design panels
  let showExpressionCassettePanel = $state(false);
  let showVectorTemplatePanel = $state(false);
  let expressionCassette = $state<ExpressionCassette>({ id: 'cassette-1', parts: [], topology: 'linear' });
  let vectorTemplate = $state<VectorTemplate>({
    id: 'vector-1', name: '', topology: 'circular', sequence: '', features: [], insertionSites: []
  });

  function applyAssemblyResult(result: AssemblyResult) {
    const sequence = typeof result?.sequence === 'string' ? result.sequence.toUpperCase() : '';
    if (!sequence) return;
    dnaSeq = sequence;
    geneFeatures = (result.features ?? []).map((feature, index) => ({
      id: index + 1,
      name: feature.name || feature.id || `assembly_feature_${index + 1}`,
      start: Math.max(1, Number(feature.start ?? 0) + 1),
      end: Math.max(1, Number(feature.end ?? feature.start ?? 0) + 1),
      type: feature.type || feature.role || 'misc_feature',
      color: typeof feature.color === 'string' ? feature.color : 'var(--pix-accent-2)',
      forward: feature.strand !== -1
    }));
    pushHistory(m.expressionAssemblyApplied(), 'edit');
    pushLog(m.logExpressionAssemblyApplied({ length: sequence.length }));
  }

  let showAutoAnnotatePanel = $state(false);
  // Synced public feature database (REBASE-style): UniVec_Core vector/part elements.
  let unevecDb = $state<{ name: string; seq: string }[]>([]);
  let useUnevec = $state((typeof localStorage === 'undefined' || localStorage.getItem('spice_use_unevec') !== '0'));
  let annAlgorithm = $state<string>((typeof localStorage !== 'undefined' && localStorage.getItem('spice_ann_algo')) || 'kmer');
  let annDbSyncing = $state(false);
  let annBusy = $state(false);
  $effect(() => { try { localStorage.setItem('spice_use_unevec', useUnevec ? '1' : '0'); } catch { /* ignore */ } });
  $effect(() => { try { localStorage.setItem('spice_ann_algo', annAlgorithm); } catch { /* ignore */ } });

  // SnapGene parity: Unique cutters filter
  let showUniqueCutters = $state(false);

  // SnapGene parity: Primer 5' modifications
  let showPrimerModifier = $state(false);
  let primerModSeq = $state('');
  let primerModEnzyme = $state('EcoRI');
  let primerModProtectBases = $state(2);
  let primerModPhosphorylated = $state(false);
  let primerModResult = $state<any>(null);

  // SnapGene parity: DNA End Modification
  let showEndModPanel = $state(false);
  let endModLeftType = $state<'blunt' | '5-overhang' | '3-overhang'>('blunt');
  let endModLeftSeq = $state('');
  let endModLeftPhos = $state(true);
  let endModRightType = $state<'blunt' | '5-overhang' | '3-overhang'>('blunt');
  let endModRightSeq = $state('');
  let endModRightPhos = $state(true);

  // SnapGene parity: Virtual Gel lanes state (lifted for interoperability)
  let gelLanes = $state<any[]>([
    { id: 'lane1', name: 'Digest', bands: [], color: '#ff9f1c' }
  ]);

  // SnapGene parity: GC sliding window
  let showGcWindow = $state(false);
  let gcWindowResult = $state<any[]>([]);

  // SnapGene parity: Fusion reading frame check
  let showFusionCheckPanel = $state(false);
  let fusionFeat1Start = $state(1);
  let fusionFeat1End = $state(100);
  let fusionFeat2Start = $state(101);
  let fusionFeat2End = $state(200);
  let fusionResult = $state<any>(null);

  // SnapGene parity: Alignment file import
  let alignmentFileInput = $state<HTMLInputElement | null>(null);

  // SnapGene parity: History click-to-trace
  let selectedHistoryIdx = $state<number | null>(null);

 let cloningHistory = $state<{
    productName: string;
    size: number;
    timestamp: string;
    parentVector: string;
    parentVectorSize: number;
    insertName: string;
    insertSize: number;
    leftEnzyme: string;
    rightEnzyme: string;
  }[]>([]);

  function handleCloneSuccess(newSeq: string, newName: string, node: any) {
    if (!newSeq) return;
    dnaSeq = newSeq;
    plasmidName = newName || plasmidName;
    
    // Calculate estimated insertion coordinates based on the left enzyme position
    const leftEnz = node?.leftEnzyme || 'SalI';
    const rightEnz = node?.rightEnzyme || 'KpnI';
    const leftRef = (node?.leftEnzyme ? enzymeDatabase[node.leftEnzyme] : null) || { seq: 'GTCGAC', cut: 1, color: '#ff5df6' };
    const leftIndex = leftRef.seq ? dnaSeq.toUpperCase().indexOf(leftRef.seq) : -1;
    const insertStart = leftIndex !== -1 ? leftIndex + leftRef.cut + 1 : 1;
    const insertSize = node?.insertSize || 0;
    const insertEnd = insertSize > 0 ? insertStart + insertSize - 1 : insertStart;

    const insertName = node?.insertName || 'Insert';
    const shortName = insertName.split(' ')[0] || 'Insert';

    geneFeatures = [
      ...geneFeatures,
      {
        id: geneFeatures.length + 1,
        name: shortName,
        start: insertStart,
        end: insertEnd,
        type: 'cds',
        color: 'var(--pix-accent-2)'
      }
    ];

    if (node) {
      cloningHistory = [...cloningHistory, node];
    }
    pushHistory(`Clone: ${node?.productName || newName} (${leftEnz}+${rightEnz})`, 'clone');
    pushLog(m.logCloneSuccess({ name: newName, length: newSeq.length }));
    pushLog(m.logFeatureRegistered({ name: shortName, start: insertStart, end: insertEnd }));
    
    if (node?.leftEnzyme && !selectedEnzymes.includes(node.leftEnzyme)) selectedEnzymes = [...selectedEnzymes, node.leftEnzyme];
    if (node?.rightEnzyme && !selectedEnzymes.includes(node.rightEnzyme)) selectedEnzymes = [...selectedEnzymes, node.rightEnzyme];
  }

  function pushLog(msg: string) {
    const ts = new Date().toLocaleTimeString();
    log = [...log.slice(-100), `[${ts}] ${localizeInline(msg)}`];
  }

  // SnapGene parity: Undo/Redo via HistoryManager
  function pushHistory(label: string, operationType: any = 'edit') {
    histMgr.push({
      label,
      operationType,
      sequence: dnaSeq,
      features: [...geneFeatures],
    });
    canUndo = histMgr.canUndo();
    canRedo = histMgr.canRedo();
  }

  function undo() {
    const snap = histMgr.undo();
    if (snap) {
      dnaSeq = snap.sequence;
      if (snap.features) geneFeatures = [...snap.features];
      canUndo = histMgr.canUndo();
      canRedo = histMgr.canRedo();
      pushLog(`[UNDO] ${snap.label}`);
    }
  }

  function redo() {
    const snap = histMgr.redo();
    if (snap) {
      dnaSeq = snap.sequence;
      if (snap.features) geneFeatures = [...snap.features];
      canUndo = histMgr.canUndo();
      canRedo = histMgr.canRedo();
      pushLog(`[REDO] ${snap.label}`);
    }
  }

  // SnapGene parity: Ensembl import
  async function importFromEnsembl() {
    if (!ensemblQuery.trim()) {
      pushToast('error', m.ensemblImport(), m.plsInputGeneNameOrId());
      return;
    }
    ensemblLoading = true;
    pushLog(m.logEnsemblRetrieving({ query: ensemblQuery }));
    try {
      const res = await backend.importFromEnsembl(ensemblQuery.trim());
      if (res.data?.sequence) {
        dnaSeq = res.data.sequence.toUpperCase();
        plasmidName = res.data.name || ensemblQuery;
        if (res.data.features) {
          geneFeatures = res.data.features.map((f: any, i: number) => ({
            id: i + 1, name: f.name || 'feature',
            start: f.start + 1, end: f.end + 1,
            type: f.type || f.ftype || 'misc', color: 'var(--pix-accent-2)',
            forward: f.strand !== undefined ? f.strand >= 0 : true
          }));
        }
        pushHistory(m.ensemblImportEnsemblQuery({ ensemblQuery: ensemblQuery }), 'import');
        pushLog(m.logEnsemblImportSuccess({ v1: plasmidName, v2: dnaSeq.length }));
        pushToast('success', m.ensemblImportSuccess(), plasmidName);
      } else {
        pushLog(m.ensemblNoResultFail({ errorNotfound: res.error || m.notFound() }));
        pushToast('error', m.ensemblImportFailed(), res.error || m.notFound());
      }
    } catch (e: any) {
      pushLog(m.ensemblImportFail({ messagee: e.message ?? e }));
      pushToast('error', m.ensemblImportError(), e.message ?? e);
    }
    ensemblLoading = false;
  }

  // SnapGene parity: Circularize / Linearize / Flip
  function circularizeSequence() {
    pushHistory('Circularize sequence', 'edit');
    activeTab = 'circular';
    pushLog(m.logEditCircularize());
  }
  function linearizeSequence() {
    pushHistory('Linearize sequence', 'edit');
    activeTab = 'linear';
    pushLog(m.logEditLinearize());
  }
  function flipSequence() {
    pushHistory('Flip sequence', 'edit');
    dnaSeq = getReverseComplementSequenceString(dnaSeq);
    geneFeatures = geneFeatures.map(f => ({
      ...f,
      forward: !f.forward,
      start: dnaSeq.length - f.end + 1,
      end: dnaSeq.length - f.start + 1,
    }));
    pushLog(m.logEditFlip());
  }

  onMount(() => {
    pushLog(m.logMountSuccess());
    pushLog(m.logLoadingRebase());

    // Load auto-save setting
    autoSaveEnabled = localStorage.getItem('spice_auto_save_gene_proj') === 'true';

    // Load default host preference from settings
    const savedHost = localStorage.getItem('spice_default_host');
    if (savedHost) {
      codonHost = savedHost as 'ecoli' | 'yeast' | 'human';
    }

    // Offer to restore silent auto-save cache if it exists (Feature 10 Auto-save).
    // NEVER when a SPICE_PROJECT doc is active — it would clobber the doc.
    const cachedProj = localStorage.getItem('spice_gene_active_autosave_cache');
    if (cachedProj && !projectStore.hasActiveDoc) {
      try {
        loadSpiceg(cachedProj).then(() => {
          pushLog(m.logAutosaveRecovered());
          pushToast('info', m.labelCacheRecovered(), m.labelCacheRecoveredDesc());
        });
      } catch (e) {}
    }

    // Load custom feature types and colors from localStorage (Gap 9)
    const savedCustomTypes = localStorage.getItem('spice.gene.customFeatureTypes');
    if (savedCustomTypes) {
      try {
        customFeatureTypes = JSON.parse(savedCustomTypes);
        (window as any).tg_featureTypeOverrides = customFeatureTypes.map(t => ({ name: t, color: '#ff5df6' }));
      } catch (e) {}
    }

    // Load collections list from localStorage (Project Collection Management Persistence)
    const savedCollections = localStorage.getItem('spice_gene_collections_list');
    if (savedCollections) {
      try {
        collectionsList = JSON.parse(savedCollections);
      } catch (e) {
        console.error("Error loading persisted collectionsList:", e);
      }
    } else {
      // Set the default list if none exists
      collectionsList = [
        { 
          id: "col_1", 
          name: "pUC19_cloning_vector.gb", 
          size: 2686, 
          format: "GenBank", 
          tags: ["Cloning Vector", "pUC Origin", "AmpR"], 
          copyNumber: "High (500-700)",
          resistance: "AmpR",
          seq: "GATCTTCG" + "GATC".repeat(14) + "A".repeat(2622) // Contains exactly 15 Dam (GATC) methylation sites
        },
        { 
          id: "col_2", 
          name: "pcDNA3.1_mammalian_expression.gb", 
          size: 5428, 
          format: "GenBank", 
          tags: ["Expression", "CMV Promoter", "NeoR"], 
          copyNumber: "Medium (30-40)",
          resistance: "AmpR, NeoR",
          seq: "GATC" + "GATC".repeat(7) + "G".repeat(5396) // Contains exactly 8 Dam (GATC) sites
        },
        { 
          id: "col_3", 
          name: "pET28a_protein_expression.gb", 
          size: 5369, 
          format: "GenBank", 
          tags: ["Bacterial", "T7 Promoter", "KanR"], 
          copyNumber: "Low (15-20)",
          resistance: "KanR",
          seq: "GATC" + "GATC".repeat(11) + "C".repeat(5321) // Contains exactly 12 Dam (GATC) sites
        },
        { 
          id: "col_4", 
          name: "egfp_reporter_gene.fasta", 
          size: 720, 
          format: "FASTA", 
          tags: ["Reporter", "GFP"], 
          copyNumber: "N/A",
          resistance: "None",
          seq: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA" // Real actual EGFP CDS sequence containing exactly 1 GATC site
        }
      ];
    }

    // Load interface customization preferences (SnapGene parity view config)
    const savedConfig = localStorage.getItem('spice_gene_view_config');
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig);
        if (config.bgColor !== undefined) bgColor = config.bgColor;
        if (config.showSingleStrand !== undefined) showSingleStrand = config.showSingleStrand;
        if (config.colorTheme !== undefined) colorTheme = config.colorTheme;
        if (config.showFeatures !== undefined) showFeatures = config.showFeatures;
        if (config.showOrfs !== undefined) showOrfs = config.showOrfs;
        if (config.showTranslations !== undefined) showTranslations = config.showTranslations;
        if (config.showPrimersOnMap !== undefined) showPrimersOnMap = config.showPrimersOnMap;
        if (config.showCutsites !== undefined) showCutsites = config.showCutsites;
        
        if (config.showEnzymeSelector !== undefined) showEnzymeSelector = config.showEnzymeSelector;
        if (config.showCodonOptimizer !== undefined) showCodonOptimizer = config.showCodonOptimizer;
        if (config.showPrimerTable !== undefined) showPrimerTable = config.showPrimerTable;
        if (config.showVirtualGel !== undefined) showVirtualGel = config.showVirtualGel;
        if (config.showLogger !== undefined) showLogger = config.showLogger;
        if (config.showCrisprDesigner !== undefined) showCrisprDesigner = config.showCrisprDesigner;
        if (config.showCloningValidator !== undefined) showCloningValidator = config.showCloningValidator;
      } catch (e) {
        console.error("Error loading persisted view config:", e);
      }
    }

    backend.syncRebaseDb().then(res => {
      const db: Record<string, { seq: string; cut: number; color: string }> = {};
      res.data.forEach(item => {
        db[item.name] = {
          seq: item.motif,
          cut: item.cutIndex,
          color: getEnzymeColor(item.name)
        };
      });
      enzymeDatabase = db;
      pushLog(m.logRebaseLoadSuccess({ count: res.data.length }));
    }).catch(err => {
      pushLog(m.logRebaseLoadFail());
    });

    backend.syncUnevecDb().then(res => {
      unevecDb = res.data || [];
      if (typeof localStorage !== 'undefined' && unevecDb.length) {
        try { localStorage.setItem('spice_unevec_db', JSON.stringify(unevecDb)); } catch { /* ignore */ }
      }
      pushLog(m.logUnevecLoaded({ v1: unevecDb.length, v2: res.demo ? m.logUnevecLocalCacheSuffix() : '' }));
    }).catch(() => {
      pushLog(m.logUnevecSyncFail());
    });
  });

  function addCustomFeatureType(name: string, color = '#ff5df6') {
    const clean = name.trim().toLowerCase();
    if (!clean || customFeatureTypes.includes(clean)) return;
    customFeatureTypes = [...customFeatureTypes, clean];
    localStorage.setItem('spice.gene.customFeatureTypes', JSON.stringify(customFeatureTypes));
    
    // Register in OVE overrides
    const overrides = customFeatureTypes.map(t => ({ name: t, color }));
    (window as any).tg_featureTypeOverrides = overrides;
    pushLog(m.logFeatureCustomAdded({ name: clean, color }));
  }

  // ---------------- COMPUTED PROPERTIES ----------------
  const dnaGcContent = $derived(calculatePercentGC(dnaSeq));

  const translatedProtein = $derived(getAminoAcidStringFromSequenceString(dnaSeq, { forward: true }));

  function getEnzymeColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      '#ff5d5d', '#ff9f1c', '#ffd23f', '#4cd6ff', '#b48cff',
      '#53d769', '#ff5df6', '#53d7a9', '#ff9e9e', '#5df6ff'
    ];
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
  }

  const getInitialEnzymeDb = () => {
    const db: Record<string, { seq: string; cut: number; color: string }> = {};

    // 1. Try to load from persistent synced REBASE database in localStorage
    if (typeof localStorage !== 'undefined') {
      const savedDb = localStorage.getItem('spice_rebase_db');
      if (savedDb) {
        try {
          const parsed = JSON.parse(savedDb) as { name: string; motif: string; cutIndex: number; isBlunt: boolean }[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed.forEach(enz => {
              if (enz && enz.name) {
                db[enz.name] = {
                  seq: enz.motif.replace(/\^/g, '').toUpperCase(),
                  cut: enz.cutIndex,
                  color: getEnzymeColor(enz.name)
                };
              }
            });
            return db;
          }
        } catch (e) {
          console.error("Failed to parse persistent REBASE database:", e);
        }
      }
    }

    // 2. Fallback to defaultEnzymesByName
    Object.keys(defaultEnzymesByName).forEach(key => {
      const enz = (defaultEnzymesByName as any)[key];
      if (enz && enz.name) {
        db[enz.name] = {
          seq: enz.site.replace(/\^/g, '').toUpperCase(),
          cut: enz.topSnipOffset,
          color: getEnzymeColor(enz.name)
        };
      }
    });
    if (Object.keys(db).length === 0) {
      return {
        'EcoRI': { seq: 'GAATTC', cut: 1, color: '#ff5d5d' },
        'BamHI': { seq: 'GGATCC', cut: 1, color: '#ff9f1c' },
        'HindIII': { seq: 'AAGCTT', cut: 1, color: '#ffd23f' },
        'XhoI': { seq: 'CTCGAG', cut: 1, color: '#4cd6ff' },
        'NdeI': { seq: 'CATATG', cut: 2, color: '#b48cff' },
        'SacI': { seq: 'GAGCTC', cut: 5, color: '#53d769' },
        'SalI': { seq: 'GTCGAC', cut: 1, color: '#ff5df6' },
        'KpnI': { seq: 'GGTACC', cut: 5, color: '#53d7a9' }
      };
    }
    return db;
  };

  let enzymeDatabase = $state<Record<string, { seq: string; cut: number; color: string }>>(getInitialEnzymeDb());

  // Annotations — ported OVE demo features (pJ5_00001)
  let geneFeatures = $state<{ id: number; name: string; start: number; end: number; type: string; color: string; forward?: boolean }[]>(oveDemo.features);

  // Build an enzyme definition for the cutsite engine: prefer the tg-oss DB,
  // fall back to a generated definition from the synced REBASE data.
  function resolveEnzymeFor(name: string) {
    const fromDb = getEnzymeByName(name);
    if (fromDb) return fromDb;
    const fb = enzymeDatabase[name];
    if (fb) return enzymeFromSite(name, fb.seq, fb.cut);
    return undefined;
  }

  // Restriction sites computed with the ported OVE cutsite engine.
  // We scan a curated set of common enzymes (like OVE) + the user's selection,
  // so the ring shows a readable number of staggered labels (not the whole DB).
  const COMMON_ENZYMES = [
    'EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NdeI', 'SacI', 'SalI', 'KpnI',
    'EcoRV', 'XbaI', 'SpeI', 'PstI', 'SphI', 'NotI', 'AatII', 'BglII',
    'SmaI', 'XmaI', 'NcoI', 'NheI', 'AflII', 'AvrII', 'BspEI', 'BstBI',
    'ClaI', 'DraI', 'HaeIII', 'HpaI', 'MluI', 'MscI', 'NruI', 'PvuII',
    'SacII', 'ScaI', 'StuI', 'SwaI', 'BsaI', 'BbsI', 'BsmBI', 'BtgZI',
    'SapI', 'BspQI', 'AarI', 'FokI', 'EcoO109I', 'HincII', 'Sse8387I'
  ];

  const restrictionSites = $derived.by(() => {
 const sites: { name: string; pos: number; seq: string; color: string; methylated: boolean; methylationType?: string; topSnipPosition: number; bottomSnipPosition: number; recognitionSiteRange: { start: number; end: number }; topSnipBeforeBottom: boolean; forward: boolean }[] = [];
 const upperDna = dnaSeq.toUpperCase();

    // curated common enzymes + whatever the user selected in the enzyme selector
    const allNames = [...new Set([...COMMON_ENZYMES, ...selectedEnzymes])];
    const enzymes = allNames
      .map(resolveEnzymeFor)
      .filter((e): e is NonNullable<typeof e> => !!e);

    // Dam methylation target motif (GATC)
    const damPositions = new Set<number>();
    let damPos = upperDna.indexOf('GATC');
    while (damPos !== -1) {
      for (let i = 0; i < 4; i++) damPositions.add(damPos + i);
      damPos = upperDna.indexOf('GATC', damPos + 1);
    }
    // Dcm methylation target motif (CCWGG -> CCAAGG or CCTGGG)
    const dcmPositions = new Set<number>();
    const dcmRegex = /CC[AT]GG/g;
    let dcmMatch;
    while ((dcmMatch = dcmRegex.exec(upperDna)) !== null) {
      const start = dcmMatch.index;
      for (let i = 0; i < 5; i++) dcmPositions.add(start + i);
    }

    // EcoKI methylation target motif (AAC(N6)GTGC / GCAC(N6)GTT)
    const ecokiPositions = new Set<number>();
    const ecokiFwdRegex = /AAC[ATGCN].{5}GTGC/g;
    let ecokiMatch;
    while ((ecokiMatch = ecokiFwdRegex.exec(upperDna)) !== null) {
      const start = ecokiMatch.index;
      for (let i = 0; i < 13; i++) ecokiPositions.add(start + i);
    }
    const ecokiRevRegex = /GCAC[ATGCN].{5}GTT/g;
    while ((ecokiMatch = ecokiRevRegex.exec(upperDna)) !== null) {
      const start = ecokiMatch.index;
      for (let i = 0; i < 13; i++) ecokiPositions.add(start + i);
    }

    // The plasmid is circular
    const cutsites = getCutsitesFromSequenceFlat(dnaSeq, true, enzymes);

    cutsites.forEach(cs => {
      const db = enzymeDatabase[cs.name];
      const siteSeq = cs.restrictionEnzyme?.site?.toUpperCase() || db?.seq || '';
      // Check whether the recognition sequence overlaps a methylated region
      let isDam = false;
      let isDcm = false;
      let isEcoKI = false;
      for (let i = 0; i < siteSeq.length; i++) {
        const idx = cs.recognitionSiteRange.start + i;
        if (damPositions.has(idx)) isDam = true;
        if (dcmPositions.has(idx)) isDcm = true;
        if (ecokiPositions.has(idx)) isEcoKI = true;
      }
      const methylated = isDam || isDcm || isEcoKI;
      const mTypes: string[] = [];
      if (isDam) mTypes.push('Dam');
      if (isDcm) mTypes.push('Dcm');
      if (isEcoKI) mTypes.push('EcoKI');
      const mType = mTypes.length > 0 ? mTypes.join('/') : undefined;

      sites.push({
        name: cs.name,
        pos: cs.topSnipPosition + 1, // 1-based snip position for display
        seq: siteSeq,
       color: methylated ? 'var(--pix-red)' : db?.color ?? 'var(--pix-accent)',
       methylated,
       methylationType: mType,
        topSnipPosition: cs.topSnipPosition,
        bottomSnipPosition: cs.bottomSnipPosition,
        recognitionSiteRange: cs.recognitionSiteRange,
        topSnipBeforeBottom: cs.topSnipBeforeBottom,
        forward: cs.forward
     });
   });

    sites.sort((a, b) => a.pos - b.pos);
    return sites;
  });

  const digestionFragments = $derived.by(() => {
    if (dnaSeq.length === 0) return [];
    const enzymes = selectedEnzymes
      .map(resolveEnzymeFor)
      .filter((e): e is NonNullable<typeof e> => !!e);
    const cutsites = getCutsitesFromSequenceFlat(dnaSeq, true, enzymes);
    if (cutsites.length === 0) {
      // Circular plasmid was not cut
      return [dnaSeq.length];
    }
    const fragments = getDigestFragmentsForCutsites(dnaSeq.length, true, cutsites);
    return fragments
      .map(f => f.size)
      .sort((a, b) => b - a); // sort by descending length
  });

  // Primer design using the ported NEB Tm calculator (SantaLucia + Owczarzy salt correction)
  const pcrPrimers = $derived.by(() => {
    if (dnaSeq.length < 40) return [];

    const fwdSeq = dnaSeq.slice(0, 20).toUpperCase();
    const last20 = dnaSeq.slice(-20).toUpperCase();
    const revSeq = getReverseComplementSequenceString(last20);

    // Default monovalent cation: 50 mM, primer concentration: 500 nM
    const fwdTm = calculateNebTm(fwdSeq, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
    const revTm = calculateNebTm(revSeq, { monovalentCationConc: 0.05, primerConc: 0.0000005 });

    return [
      { name: m.primerForward(), seq: fwdSeq, tm: typeof fwdTm === 'number' ? Math.round(fwdTm * 10) / 10 : 0, gc: calculatePercentGC(fwdSeq), len: 20 },
      { name: m.primerReverse(), seq: revSeq, tm: typeof revTm === 'number' ? Math.round(revTm * 10) / 10 : 0, gc: calculatePercentGC(revSeq), len: 20 }
    ];
  });

  // ---------------- FILE EXPORT ----------------
  let exportFormat = $state<'spiceg' | 'genbank' | 'fasta' | 'embl' | 'fasta'>('spiceg');
  
  async function exportSequence(format: 'spiceg' | 'genbank' | 'fasta' | 'embl' = exportFormat) {
    if (format === 'spiceg') {
    syncCurrentPage();
    const fileData: SpiceGeneFile = {
      format: 'SPICE_GENE',
      version: '1.0',
      meta: {
        plasmidName,
        hostPreference: codonHost,
        createdAt: new Date().toISOString()
      },
      sequence: dnaSeq,
      features: geneFeatures.map(f => ({
        name: f.name,
        start: f.start,
        end: f.end,
        type: f.type,
        color: f.color,
        forward: f.forward
      })),
      selectedEnzymes,
      selectionNotes: selectionNotes.map(n => ({
        start: n.start,
        end: n.end,
        text: n.text
      })),
      notes: propNotesMarkdown,
      notebookPages: notebookPages
    };

    const text = JSON.stringify(fileData, null, 2);
    const fileName = `${plasmidName}.spiceg`;
    const r = await backend.saveExport(fileName, text);
    if (r.data?.path) {
      pushLog(m.logExportSuccess({ path: r.data.path }));
      pushToast('success', m.exportSpicegSuccess(), r.data.path);
    } else if (r.error) {
      pushLog(m.spicegExportFail({ error: r.error }));
      pushToast('error', m.exportSpicegFailed(), r.error);
    }
    } else {
      // Export using standard bioinformatics formats
      const seqData = {
        sequence: dnaSeq,
        name: plasmidName,
        circular: !linear,
        features: geneFeatures.map(f => ({
          name: f.name,
          type: f.type,
          start: f.start - 1, // 0-based for genome core
          end: f.end - 1,
          forward: f.forward ?? true
        }))
      };
      const ext = format === 'genbank' ? 'gb' : format === 'fasta' ? 'fa' : format === 'embl' ? 'embl' : 'fa';
      const text = serializeSequenceData(seqData, format);
      const fileName = `${plasmidName}.${ext}`;
      const r = await backend.saveExport(fileName, text);
      if (r.data?.path) {
        pushLog(m.exportFmtLogOk({ toUpperCase: format.toUpperCase(), path: r.data.path }));
        pushToast('success', m.exportFmtToastOk({ toUpperCase: format.toUpperCase() }), r.data.path);
      } else if (r.error) {
        pushLog(m.exportFmtLogFail({ toUpperCase: format.toUpperCase(), error: r.error }));
        pushToast('error', m.exportFmtToastFail({ toUpperCase: format.toUpperCase() }), r.error);
      }
    }
  }

  // Keep backwards compat
  function exportSpiceg() { return exportSequence('spiceg'); }

  function serializeSpiceGeneFile(): SpiceGeneFile {
    syncCurrentPage();
    return {
      format: 'SPICE_GENE',
      version: '1.0',
      meta: {
        plasmidName,
        hostPreference: codonHost,
        createdAt: new Date().toISOString()
      },
      sequence: dnaSeq,
      features: geneFeatures.map(f => ({
        name: f.name,
        start: f.start,
        end: f.end,
        type: f.type,
        color: f.color,
        forward: f.forward
      })),
      selectedEnzymes,
      selectionNotes: selectionNotes.map(n => ({
        start: n.start,
        end: n.end,
        text: n.text
      })),
      notes: propNotesMarkdown,
      notebookPages: notebookPages
    };
  }

  async function saveProjectAsSpiceg(opts?: { silent?: boolean }) {
    syncCurrentPage();

    // SPICE_PROJECT doc: write back into the embedded payload, then let the
    // project store own file IO (silent = never raise a native dialog).
    if (projectStore.activeDocKind === 'gene' && projectStore.activeDocId) {
      projectStore.commitGeneDoc(serializeSpiceGeneFile());
      const r = await projectStore.saveActiveDoc({ silent: !!opts?.silent });
      if (r.ok) {
        isProjectDirty = false;
        if (r.path) pushLog(m.logProjectDocSaved({ v1: r.path }));
        else if (!opts?.silent) pushToast('info', m.projectSavedToast(), m.projectNeverSaved());
      } else if (r.error && !opts?.silent) {
        pushToast('error', m.projectSaveFailedToast(), r.error);
      }
      return;
    }

    const fileData = serializeSpiceGeneFile();
    const text = JSON.stringify(fileData, null, 2);

    if (currentProjectFilePath) {
      // Direct silent overwrite (Auto-Save Flow)
      const r = await backend.saveFileDirect(currentProjectFilePath, text);
      if (r.data) {
        isProjectDirty = false;
        pushLog(m.logAutosavePath({ path: currentProjectFilePath }));
      }
    } else {
      // First save or manual save: prompt save dialog
      const fileName = `${plasmidName}.spiceg`;
      const r = await backend.saveExport(fileName, text);
      if (r.data?.path) {
        currentProjectFilePath = r.data.path; // Store the saved path!
        isProjectDirty = false; // Reset dirty state upon successful save!
        pushLog(m.logProjectSaved({ path: r.data.path }));
        pushToast('success', m.projectSaveSuccess(), r.data.path);
      } else if (r.error) {
        pushLog(m.projectSaveFailLog({ error: r.error }));
        pushToast('error', m.projectSaveFailed(), r.error);
      }
    }
  }

  // ---------------- FILE IMPORT (.SPICEG) ----------------
  async function loadSpiceg(text: string) {
    try {
      const data = JSON.parse(text) as SpiceGeneFile;
      if (data.format !== 'SPICE_GENE') {
        throw new Error(m.errorInvalidSpicegFile());
      }
      const wasProjectDoc = projectStore.activeDocKind === 'gene';
      applySpiceGeneFile(data);
      // Explicitly opening a standalone file detaches the workspace from the
      // embedded project doc (its payload stays untouched).
      if (wasProjectDoc) {
        projectStore.activeDocId = null;
        pushToast('info', m.projectDetachToast());
      }
      pushLog(m.logLoadSpicegSuccess({ name: plasmidName, fCount: geneFeatures.length, nCount: selectionNotes.length }));
      pushToast('success', m.loadSpicegSuccess(), plasmidName);
    } catch (e: any) {
      pushLog(m.logParseSpicegFail({ error: e.message ?? e }));
      pushToast('error', m.loadSpicegFailed(), e.message ?? e);
    }
  }

  function applySpiceGeneFile(data: SpiceGeneFile) {
    initialLoadComplete = false; // Temporarily block dirty tracking during load
    dnaSeq = data.sequence ?? '';
    plasmidName = data.meta.plasmidName;
    codonHost = data.meta.hostPreference;
    selectedEnzymes = data.selectedEnzymes ?? [];
    geneFeatures = (data.features ?? []).map((f, i) => ({
      id: i + 1,
      name: f.name,
      start: f.start,
      end: f.end,
      type: f.type,
      color: f.color,
      forward: f.forward
    }));
    selectionNotes = data.selectionNotes ? data.selectionNotes.map(n => ({
      start: n.start,
      end: n.end,
      text: n.text
    })) : [];

    // Load notebook pages
    if (data.notebookPages && data.notebookPages.length > 0) {
      notebookPages = data.notebookPages;
      currentPageIdx = 0;
      const page = notebookPages[0];
      propNotesMarkdown = page.markdownContent;
      elnTitle = page.title;
      elnCategory = page.category;
      elnTagsString = page.tags.join(', ');
    } else {
      const initialNoteContent = data.notes !== undefined ? data.notes : `# SPICE notes for ${plasmidName}\n\nThis plasmid contains standard cloning vectors, including an AmpR antibiotic selection marker and pUC replication origin.`;
      notebookPages = [{
        id: `eln_${Date.now()}`,
        title: m.elnDefaultTitle(),
        author: propAuthor,
        date: new Date().toLocaleDateString(),
        category: 'Cloning',
        markdownContent: initialNoteContent,
        tags: ['SPICE', 'ELN', 'Auto_Sign']
      }];
      currentPageIdx = 0;
      propNotesMarkdown = initialNoteContent;
      elnTitle = m.elnDefaultTitle();
      elnCategory = 'Cloning';
      elnTagsString = 'SPICE, ELN, Auto_Sign';
    }
    isProjectDirty = false; // Reset dirty state on successful load!
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }
  function handleDragLeave() {
    isDragging = false;
  }
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      await handleGeneFile(file);
    }
  }

  async function handleGeneFile(file: File) {
    initialLoadComplete = false; // Temporarily block dirty tracking during load
    if (file.name.endsWith('.dna')) {
      const buffer = await file.arrayBuffer();
      try {
        const parsed = parseSnapGeneDna(new Uint8Array(buffer));
        if (parsed.sequence && parsed.sequence.length > 0) {
          dnaSeq = parsed.sequence.toUpperCase();
          plasmidName = parsed.name || file.name.replace(/\.dna$/, '');
          geneFeatures = parsed.features as any;
          activeTab = parsed.circular ? 'circular' : 'linear';
          isProjectDirty = false; // Reset dirty state!
          pushLog(m.logSnapGeneImportSuccess({ name: file.name, length: dnaSeq.length, count: geneFeatures.length }));
          pushToast('success', m.snapgeneImportSuccess(), file.name);
        } else {
          pushToast('error', m.importFailed(), m.toastNoDnaInDnaFile());
        }
      } catch (err: any) {
        pushLog(m.logSnapGeneImportFail({ error: err.message }));
        pushToast('error', m.toastSnapGeneImportFail(), err.message);
      }
      return;
    }
    const text = await file.text();
    if (file.name.endsWith('.spiceg') || text.includes('"format": "SPICE_GENE"')) {
      await loadSpiceg(text);
    } else {
      // Try standard format parsing (GenBank, FASTA, EMBL, FASTQ)
      const fmt = detectFormat(file.name, text);
      if (fmt && fmt !== 'plain') {
        try {
          const parsed = parseSequenceFile(text, fmt);
          if (parsed.sequence && parsed.sequence.length > 0) {
            dnaSeq = parsed.sequence.toUpperCase();
            if (parsed.name) plasmidName = parsed.name;
            if (parsed.circular !== undefined) {
              // could set linear based on this
            }
            const feats = parsed.features as any[];
            if (feats && feats.length > 0) {
              geneFeatures = feats.map((f: any, i: number) => ({
                id: i + 1,
                name: f.name || 'feature',
                start: (f.start ?? 0) + 1,
                end: (f.end ?? 0) + 1,
                type: f.type || 'misc',
                color: f.color || 'var(--pix-accent-2)',
                forward: f.forward ?? true
              }));
            }
            // Record in history
            histMgr.push({
              label: `Import ${fmt.toUpperCase()}: ${file.name}`,
              operationType: 'import',
              sequence: dnaSeq,
              features: geneFeatures,
              meta: { format: fmt, fileName: file.name }
            });
            isProjectDirty = false; // Reset dirty state!
            pushLog(m.logFileImportSuccess({ format: fmt.toUpperCase(), name: file.name, length: dnaSeq.length }));
            pushToast('success', m.importFmtOk({ toUpperCase: fmt.toUpperCase() }), file.name);
            return;
          }
        } catch (e: any) {
          pushLog(m.logFileImportFallback({ format: fmt.toUpperCase(), error: e.message ?? e }));
        }
      }
      // Fallback: raw ATCG extraction
      const clean = text.toUpperCase().replace(/[^ATCGN]/g, '');
      if (clean.length > 0) {
        dnaSeq = clean;
        isProjectDirty = false; // Reset dirty state!
        pushLog(m.logExternalImportSuccess({ name: file.name, length: clean.length }));
        pushToast('success', m.sequenceImportSuccess(), file.name);
      } else {
        pushLog(m.logExternalImportFail({ name: file.name }));
        pushToast('error', m.fileLoadFailed(), m.toastNoValidBases());
      }
    }
  }

  function getLogColorClass(line: string): string {
    if (line.includes('[OK]') || line.includes(m.success()) || line.includes(m.logKeywordInit())) return 'good';
    if (line.includes('[FAIL]') || line.includes(m.failedShort())) return 'bad';
    if (line.includes('NCBI') || line.includes(m.optimize())) return 'info';
   if (line.includes('PCR') || line.includes(m.primer())) return 'warn';
   return '';
 }

  // SnapGene parity: Sorted/filtered features for Features view
  const sortedFilteredFeatures = $derived.by(() => {
     let feats = [...geneFeatures];
     if (featureFilterType !== 'all') {
       feats = feats.filter(f => f.type === featureFilterType);
     }
     if (featureSearchText.trim()) {
       const q = featureSearchText.trim().toLowerCase();
       feats = feats.filter(f => f.name.toLowerCase().includes(q));
     }
     const sortFns: Record<string, (a: any, b: any) => number> = {
       name: (a, b) => a.name.localeCompare(b.name),
       start: (a, b) => a.start - b.start,
       size: (a, b) => Math.abs(a.end - a.start) - Math.abs(b.end - b.start),
       type: (a, b) => a.type.localeCompare(b.type),
       color: (a, b) => a.color.localeCompare(b.color),
     };
     feats.sort(sortFns[featureSortKey] || sortFns.start);
     return feats;
   });

  // SnapGene parity: Sanger trace file import (.ab1/.scf)
  async function handleSangerFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      let trace: any = null;
      if (file.name.toLowerCase().endsWith('.ab1') || file.name.toLowerCase().endsWith('.abif')) {
        trace = parseAb1(buf);
      } else if (file.name.toLowerCase().endsWith('.scf')) {
        trace = parseScf(buf);
      } else {
        pushToast('error', m.toastFileFormatNotSupported(), m.pleaseImportAb1OrScfFile());
        return;
      }
      const valResult = validateSangerAgainstRef(trace, dnaSeq);
      sangerTraces = [...sangerTraces, { trace, validation: valResult }];
      pushLog(m.logSangerImport({ name: file.name, identity: (valResult.identity * 100).toFixed(1), mismatches: valResult.mismatches }));
      pushToast('success', m.sangerFileImportSuccess(), file.name);
    } catch (e: any) {
      pushLog(m.logSangerParseFail({ error: e.message ?? e }));
      pushToast('error', m.sangerFileImportFailed(), e.message ?? e);
    }
  }

  // SnapGene parity: Multiple sequence alignment
  async function runMultipleAlignment() {
    const cleanSeqs: string[] = [];
    let current = '';
    for (const line of alignmentMultiText.trim().split('\n')) {
      if (line.startsWith('>')) {
        if (current) { cleanSeqs.push(current); current = ''; }
      } else {
        current += line.trim();
      }
    }
    if (current) cleanSeqs.push(current);
    if (cleanSeqs.length < 2) {
      pushToast('error', m.toastMultipleAlignment(), m.toastPleaseInputTwoSequences());
      return;
    }
    const seqObjs = cleanSeqs.map((s, i) => ({ id: `seq${i}`, name: `Seq${i + 1}`, seq: s }));
    pushLog(m.logMafftStarting({ count: cleanSeqs.length }));
    const isProtein = cleanSeqs.some((s) => /[^ATGCN-]/i.test(s));

    try {
      const res = await backend.runNativeMsa(seqObjs, isProtein);
      if (res.error && res.demo) {
        // Fallback to handwritten alignment if Tauri is not active
        const result = multipleAlign(seqObjs);
        alignmentMultiResult = {
          rows: result.rows,
          consensus: result.consensus,
          width: result.width,
          identity: result.identity,
        };
        pushLog(m.logAlignDemo({ identity: (result.identity * 100).toFixed(1) }));
      } else {
        const r = res.data;
        alignmentMultiResult = {
          rows: r.rows,
          consensus: r.consensus,
          width: r.rows[0]?.alignedSeq.length || 0,
          identity: r.averageIdentity,
        };
        pushLog(m.logMafftComplete({ width: alignmentMultiResult.width, identity: (alignmentMultiResult.identity * 100).toFixed(1) }));
        pushToast('success', m.toastAlignCompleteTitle(), m.toastAlignCompleteDesc({ count: cleanSeqs.length }));
      }
    } catch (e: any) {
      pushLog(m.logMafftFail({ error: e.message ?? e }));
      pushToast('error', m.alignmentFailed(), e.message ?? e);
    }
  }

  // SnapGene parity: Sequence Search
  function runSequenceSearch() {
    if (searchQuery.trim().length < 3) {
      pushToast('error', m.sequenceSearch(), m.toastSearchMinBasesDesc());
      return;
    }
    searchResults = searchSequence(searchQuery, dnaSeq);
    pushLog(m.logSearchCount({ query: searchQuery, count: searchResults.count }));
  }

  // SnapGene parity: ORF computation (wired to showOrfs toggle)
  const orfList = $derived.by(() => {
    if (!showOrfs || dnaSeq.length < 30) return [];
    return findOrfsInPlasmid(dnaSeq, !linear, 100, false, false);
  });

  // SnapGene parity: Manual Feature Annotation
  function saveFeature() {
    const feat = editingFeature;
    if (!feat.name || feat.start > feat.end) {
      pushToast('error', m.featureAnnotation(), m.toastFeatureNameRangeDesc());
      return;
    }
    if (feat.id !== undefined) {
      geneFeatures = geneFeatures.map(f => f.id === feat.id ? { ...feat, id: feat.id as number } : f);
      pushLog(m.featEditLog({ name: feat.name, start: feat.start, end: feat.end }));
    } else {
      const newId = Math.max(0, ...geneFeatures.map(f => f.id)) + 1;
      geneFeatures = [...geneFeatures, { ...feat, id: newId }];
      pushLog(m.featAddLog({ name: feat.name, start: feat.start, end: feat.end }));
    }
    pushHistory(`Feature: ${feat.name}`, 'edit');
    showFeatureEditor = false;
    pushToast('success', m.toastFeatureSaveSuccess(), feat.name);
  }

  function deleteFeature(id: number) {
    const feat = geneFeatures.find(f => f.id === id);
    geneFeatures = geneFeatures.filter(f => f.id !== id);
    pushHistory(`Delete feature: ${feat?.name || id}`, 'edit');
    pushLog(m.featureDeleteFeatureFeatNameId({ nameid: feat?.name || id }));
  }

  // SnapGene parity: Add Selection Note/Annotation (Gap 17)
  function handleAddSelectionNote() {
    if (selectionStart === 1 && selectionEnd === 1) {
      pushToast('error', m.toastAnnotationFailedTitle(), m.toastAnnotationFailedDesc());
      return;
    }
    // Switch to Notes tab and initialize
    activeTab = 'notes';
    newSelectionNoteText = '';
    pushToast('info', m.toastNotesPanelOpenedTitle(), m.toastNotesPanelOpenedDesc({ start: selectionStart, end: selectionEnd }));
  }

  function saveNoteForActiveSelection() {
    if (selectionStart === 1 && selectionEnd === 1) {
      pushToast('error', m.toastAnnotationFailedTitle(), m.toastAnnotationFailedDesc());
      return;
    }
    const noteText = newSelectionNoteText.trim();
    if (!noteText) {
      pushToast('error', m.saveFailed(), m.pleaseInputCommentContent());
      return;
    }

    selectionNotes = [...selectionNotes, {
      start: selectionStart,
      end: selectionEnd,
      text: noteText
    }];
    newSelectionNoteText = ''; // Clear input
    pushLog(m.logNoteAdded({ start: selectionStart, end: selectionEnd, text: noteText }));
    pushToast('success', m.toastAnnotationSuccessTitle(), `${selectionStart}..${selectionEnd} bp`);
  }

  function openFeatureEditor(feat?: any) {
    if (feat) {
      editingFeature = { ...feat };
    } else {
      editingFeature = { name: '', start: selectionStart, end: selectionEnd || selectionStart, type: 'cds', color: '#4cd6ff', forward: true };
    }
    showFeatureEditor = true;

    // Switch tool mode back to browse after selecting range in annotation mode
    if (seqTool === 'annotate') {
      seqTool = 'browse';
    }
  }

  // SnapGene parity: Auto-Annotate
  async function runAutoAnnotate() {
    if (annBusy) return;
    annBusy = true;
    try {
    // Builtin curated parts + (optionally) the synced public UniVec_Core library.
    const library = getCommonFeatureLibrary();
    if (useUnevec && unevecDb.length) {
      for (const e of unevecDb) library.push({ name: e.name, seq: e.seq });
    }
    let result;
    if (annAlgorithm === 'sw' && backend.isTauri()) {
      const res = await backend.annotateFeaturesSw(dnaSeq, library.map(e => ({ name: e.name, seq: e.seq })));
      result = swHitsToFeatures(res.data || []);
    } else {
      // Browser (no native SW) falls back to k-mer even if 'sw' is selected.
      const algo: 'exact' | 'kmer' = annAlgorithm === 'exact' ? 'exact' : 'kmer';
      result = annotateFeatures(dnaSeq, library, algo);
    }
    if (result.count === 0) {
      pushToast('info', m.toastAutoAnnotate(), m.toastAutoAnnotateNoneDesc());
      return;
    }
    // Skip features already present at the same span so re-running is idempotent.
    const existing = new Set(geneFeatures.map(g => `${g.name}|${g.start}|${g.end}`));
    const base = Math.max(0, ...geneFeatures.map(g => g.id));
    const fresh = result.features.filter(f => !existing.has(`${f.name}|${f.start + 1}|${f.end + 1}`));
    if (fresh.length === 0) {
      pushToast('info', m.toastAutoAnnotate(), m.toastAutoAnnotateNoNewDesc({ v1: result.count }));
      return;
    }
    const newFeatures = fresh.map((f, i) => ({
      id: base + 1 + i,
      name: f.name,
      start: f.start + 1,
      end: f.end + 1,
      type: f.type,
      color: f.color,
      forward: f.strand === 'forward'
    }));
    geneFeatures = [...geneFeatures, ...newFeatures];
    pushHistory('Auto-annotate features', 'edit');
    pushLog(m.logAutoAnnotateAdded({ v1: annAlgorithm, v2: fresh.length, v3: library.length }));
    pushToast('success', m.toastAutoAnnotateCompleteTitle(), m.toastAutoAnnotateAddedDesc({ v1: fresh.length }));
    } finally {
      annBusy = false;
    }
  }

  function resyncUnevec() {
    annDbSyncing = true;
    backend.syncUnevecDb().then(res => {
      unevecDb = res.data || [];
      if (typeof localStorage !== 'undefined' && unevecDb.length) {
        try { localStorage.setItem('spice_unevec_db', JSON.stringify(unevecDb)); } catch { /* ignore */ }
      }
      pushToast('success', m.toastFeatureDbSync(), m.toastFeatureDbSyncDesc({ v1: unevecDb.length }));
    }).catch(() => {
      pushToast('error', m.toastFeatureDbSyncFailed(), m.toastFeatureDbSyncFailedDesc());
    }).finally(() => { annDbSyncing = false; });
  }

  async function importFromNcbi() {
    ncbiLoading = true;
    pushLog(m.logNcbiRetrieving({ query: ncbiQuery }));
    try {
      const res = await backend.importFromNcbi(ncbiQuery.trim(), ncbiOrganism);
      if (res.data?.sequence) {
        dnaSeq = res.data.sequence.toUpperCase();
        plasmidName = res.data.name || ncbiQuery;
        if (res.data.features && res.data.features.length > 0) {
          geneFeatures = res.data.features.map((f: any, i: number) => ({
            id: i + 1, name: f.name || 'feature',
            start: f.start || 1, end: f.end || 1,
            type: f.ftype || f.type || 'misc', color: 'var(--pix-accent-2)',
            forward: f.strand !== undefined ? f.strand >= 0 : true
          }));
        }
        pushHistory(`NCBI import: ${ncbiQuery}`, 'import');
        pushLog(m.logNcbiImportSuccess({ v1: plasmidName, v2: dnaSeq.length }));
        pushToast('success', m.ncbiImportSuccess(), plasmidName);
      } else {
        pushLog(m.ncbiNoResultFail({ errorNotfound: res.error || m.notFound() }));
        pushToast('error', m.ncbiImportFailed(), res.error || m.notFound());
      }
    } catch (e: any) {
      pushLog(m.ncbiImportFail({ messagee: e.message ?? e }));
      pushToast('error', m.ncbiImportError(), e.message ?? e);
    }
    ncbiLoading = false;
  }

  // SnapGene parity: UniProt direct GFF import (Gap 13)
  async function importFromUniprot() {
    if (!uniprotQuery.trim()) {
      pushToast('error', m.uniprotImport(), m.accessionInputPrompt());
      return;
    }
    uniprotLoading = true;
    pushLog(m.logUniProtRetrieving({ query: uniprotQuery }));
    try {
      const url = `https://rest.uniprot.org/uniprotkb/${uniprotQuery.trim().toUpperCase()}.gff`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(m.httpExceptionResponseStatus({ status: response.status }));
      }
      const gffText = await response.text();
      const parsed = parseUniProtGff(gffText);
      
      if (parsed && parsed.sequence) {
        dnaSeq = parsed.sequence;
        plasmidName = parsed.name || `${uniprotQuery.toUpperCase()}_protein`;
        geneFeatures = parsed.features as any;
        activeTab = 'linear';
        pushHistory(`UniProt import: ${uniprotQuery}`, 'import');
        pushLog(m.logUniProtImportSuccess({ v1: plasmidName, v2: dnaSeq.length, v3: geneFeatures.length }));
        pushToast('success', m.uniprotImportSuccess(), plasmidName);
        showUniprotPanel = false;
      } else {
        throw new Error(m.errorParseGffFailed());
      }
    } catch (e: any) {
      pushLog(m.uniprotImportFail({ messagee: e.message ?? e }));
      pushToast('error', m.uniprotImportFailed(), e.message ?? e);
    } finally {
      uniprotLoading = false;
    }
  }

  // SnapGene parity: Anneal Oligos
  function runAnnealOligos() {
    if (annealForward.length < 4 || annealReverse.length < 4) {
      pushToast('error', m.menuCloneAnneal(), m.toastAnnealMinBasesDesc());
      return;
    }
    annealResult = annealOligos(annealForward, annealReverse);
    pushLog(m.logAnnealProduct({ len: annealResult.duplexLength, tm: annealResult.tm }));
    pushToast('success', m.toastAnnealSuccess(), m.toastAnnealSuccessDesc({ v1: annealResult.duplexLength, v2: annealResult.tm }));
  }



  // SnapGene parity: Silent Mutagenesis
  function runSilentMutagenesisFn() {
    silentMutResult = simulateSilentMutagenesis(dnaSeq, {
      [silentMutMode === 'add' ? 'addSite' : 'removeSite']: silentMutSite,
      readingFrame: 0
    });
    if (silentMutResult.mutations.length > 0) {
      pushLog(m.logSilentMutAppliedCount({ mode: silentMutMode === 'add' ? m.add() : m.remove(), site: silentMutSite, count: silentMutResult.mutations.length }));
      pushToast('success', m.toastSilentMutSuccess(), m.toastSilentMutSuccessDesc({ v1: silentMutResult.mutations.length }));
    } else {
      pushLog(m.logSilentMutFail({ mode: silentMutMode === 'add' ? m.add() : m.remove(), site: silentMutSite }));
      pushToast('warn', m.toastSilentMutFailTitle(), m.toastSilentMutFailDesc());
    }
  }


  // SnapGene parity: Primer 5' modifications
  function runPrimerModification() {
    const enzymeSite = enzymeDatabase[primerModEnzyme]?.seq || '';
    const protect = 'GCA'.slice(0, primerModProtectBases);
    const modified = (primerModPhosphorylated ? '/' : '') + protect + enzymeSite + primerModSeq;
    primerModResult = {
      original: primerModSeq,
      modified,
      enzymeSite,
      protectBases: protect,
      phosphorylated: primerModPhosphorylated,
      length: modified.replace(/\//g, '').length,
    };
    pushLog(m.logPrimerModResult({ enzyme: primerModEnzyme, count: primerModProtectBases, phos: primerModPhosphorylated ? m.logPrimerModPhosSuffix() : '', seq: modified }));
    pushToast('success', m.toastPrimerModSuccess(), m.toastPrimerModSuccessDesc({ v1: primerModResult.length }));
  }

  // SnapGene parity: DNA End Modification
  function runEndModification(action: 'fillIn' | 'chewBack' | 'phosphorylate' | 'dephosphorylate') {
    const inputDna = {
      sequence: dnaSeq,
      leftEnd: {
        overhangType: endModLeftType,
        overhangSeq: endModLeftSeq,
        phosphorylated: endModLeftPhos
      },
      rightEnd: {
        overhangType: endModRightType,
        overhangSeq: endModRightSeq,
        phosphorylated: endModRightPhos
      }
    };

    let resultDna;
    if (action === 'fillIn') {
      resultDna = EndModificationEngine.fillIn(inputDna);
      pushHistory('Klenow Fill-in applied', 'edit');
      pushLog(m.endModFillInLog());
      pushToast('success', m.endModFillInToastTitle(), m.endModFillInToastDesc());
    } else if (action === 'chewBack') {
      resultDna = EndModificationEngine.chewBack(inputDna);
      pushHistory('T4 Chew-back applied', 'edit');
      pushLog(m.endModChewBackLog());
      pushToast('success', m.endModChewBackToastTitle(), m.endModChewBackToastDesc());
    } else if (action === 'phosphorylate') {
      resultDna = EndModificationEngine.setPhosphorylation(inputDna, true);
      pushHistory('Phosphorylation applied', 'edit');
      pushLog(m.endModPhosLog());
      pushToast('success', m.endModPhosToastTitle(), m.endModPhosToastDesc());
    } else {
      resultDna = EndModificationEngine.setPhosphorylation(inputDna, false);
      pushHistory('Dephosphorylation applied', 'edit');
      pushLog(m.endModDephosLog());
      pushToast('success', m.endModDephosToastTitle(), m.endModDephosToastDesc());
    }

    dnaSeq = resultDna.sequence;
    endModLeftType = resultDna.leftEnd.overhangType;
    endModLeftSeq = resultDna.leftEnd.overhangSeq;
    endModLeftPhos = resultDna.leftEnd.phosphorylated;
    endModRightType = resultDna.rightEnd.overhangType;
    endModRightSeq = resultDna.rightEnd.overhangSeq;
    endModRightPhos = resultDna.rightEnd.phosphorylated;
  }



  // SnapGene parity: GC sliding window
  function runGcWindow() {
    gcWindowResult = gcSlidingWindow(dnaSeq, 50, 10);
    pushLog(m.logGcWindowResult({ count: gcWindowResult.length }));
    pushToast('success', m.toastGcWindowDone(), m.toastGcWindowDoneDesc({ v1: gcWindowResult.length }));
  }

  // SnapGene parity: Fusion reading frame check
  function runFusionCheck() {
    fusionResult = checkFusionReadingFrame(dnaSeq, fusionFeat1Start, fusionFeat1End, fusionFeat2Start, fusionFeat2End, 0);
    pushLog(m.logFusionResult({ status: fusionResult.inFrame ? m.fusionStatusInFrame() : m.fusionStatusFrameshift(), offset: fusionResult.frameOffset }));
    if (fusionResult.inFrame) {
      pushToast('success', m.toastFusionInFrameTitle(), m.toastFusionInFrameDesc());
    } else {
      pushToast('warn', m.toastFusionFrameshiftTitle(), m.toastFusionFrameshiftDesc({ v1: fusionResult.frameOffset }));
    }
  }

  // SnapGene parity: Alignment file import
  async function handleAlignmentFile(file: File) {
    try {
      const text = await file.text();
      const imported = parseAlignmentFile(text);
      if (imported.rows.length > 0) {
        const seqObjs = imported.rows.map(r => ({ id: r.id, name: r.name, seq: r.seq }));
        alignmentMultiResult = multipleAlign(seqObjs);
        alignmentMultiMode = true;
        showAlignmentPanel = true;
        pushLog(m.logAlignFileImported({ v1: imported.format.toUpperCase(), v2: imported.rows.length }));
        pushToast('success', m.alignmentFileImport(), m.toastAlignImportedDesc({ v1: imported.format.toUpperCase(), v2: imported.rows.length }));
      } else {
        pushToast('error', m.alignmentFileImport(), m.notFoundSequenceData());
      }
    } catch (e: any) {
      pushLog(m.alignImportFail({ messagee: e.message ?? e }));
      pushToast('error', m.alignmentFileImportFailed(), e.message ?? e);
    }
  }

  // SnapGene parity: Unique cutters filter
  const uniqueCutterEnzymes = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const site of restrictionSites) {
      counts[site.name] = (counts[site.name] || 0) + 1;
    }
    return Object.entries(counts).filter(([, c]) => c === 1).map(([name]) => name);
  });

  // SnapGene parity: History click-to-trace
  function selectHistoryStep(idx: number) {
    selectedHistoryIdx = idx;
    const snap = histMgr.getAll()[idx];
    if (snap) {
      dnaSeq = snap.sequence;
      if (snap.features) geneFeatures = [...snap.features];
      pushLog(m.logHistoryStep({ step: idx + 1, label: snap.label }));
    }
  }

  function handleHistoryNodeClick(event: { type: 'vector' | 'insert' | 'product'; name: string; size: number; fullNode: any }) {
    pushLog(m.logTraceNode({ type: event.type.toUpperCase(), name: event.name, len: event.size }));

    const snaps = histMgr.getAll();
    let targetIdx = -1;
    // Look for the corresponding clone operation snapshot
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      if (snap.operationType === 'clone' && snap.label.includes(event.fullNode.productName)) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx !== -1) {
      selectHistoryStep(targetIdx);
      pushToast('success', m.toastAncestorRestoreTitle(), m.toastAncestorRestoreDesc({ v1: event.fullNode.productName }));
      
      // Auto-highlight insert if the fragment was clicked
      if (event.type === 'insert') {
        const queryName = event.name.split(' ')[0].toLowerCase();
        const matchingFeat = geneFeatures.find(f => f.name.toLowerCase().includes(queryName));
        if (matchingFeat) {
          selectionStart = matchingFeat.start;
          selectionEnd = matchingFeat.end;
          pushLog(m.logTraceHighlight({ name: matchingFeat.name, start: selectionStart, end: selectionEnd }));
        }
      }
    } else {
      // Fallback: search for any snapshot matching the name
      let foundAny = -1;
      for (let i = 0; i < snaps.length; i++) {
        if (snaps[i].label.toLowerCase().includes(event.name.toLowerCase())) {
          foundAny = i;
          break;
        }
      }
      if (foundAny !== -1) {
        selectHistoryStep(foundAny);
        pushToast('success', m.toastSnapshotRestoreTitle(), m.toastSnapshotRestoreDesc({ v1: snaps[foundAny].label }));
      } else {
        pushToast('info', m.toastLineagePositionTitle(), m.toastLineagePositionDesc({ v1: event.name, v2: event.size }));
      }
    }
  }

  // ---------------- GLOBAL SHORTCUT HANDLER ----------------
  function handleGlobalKeyDown(e: KeyboardEvent) {
    // 1. Avoid triggering shortcuts when focusing on inputs, textareas, or contenteditable elements
    const active = document.activeElement;
    if (active && (
      active.tagName === "INPUT" || 
      active.tagName === "TEXTAREA" || 
      active.classList.contains("s-texteditor-content") || 
      active.hasAttribute("contenteditable") ||
      active.closest('[contenteditable]')
    )) {
      return;
    }

    const str = getEventShortcutString(e);
    if (!str) return;

    // Load current keymap
    const activeKeymap = loadKeymap();
    const matched = activeKeymap.find(s => s.key === str && s.key !== 'None');
    if (!matched) return;

    // Found matching shortcut! Prevent default action
    e.preventDefault();
    e.stopPropagation();

    switch (matched.id) {
      case 'toggle_topology':
        activeTab = (activeTab === 'linear' ? 'circular' : 'linear');
        pushToast('info', m.shortcutToggleTopology(), activeTab === 'linear' ? m.shortcutSwitchedToLinear() : m.shortcutSwitchedToCircular());
        break;
      case 'switch_circular':
        activeTab = 'circular';
        pushToast('info', m.shortcutViewNavigation(), m.shortcutViewCircular());
        break;
      case 'switch_linear':
        activeTab = 'linear';
        pushToast('info', m.shortcutViewNavigation(), m.shortcutViewLinear());
        break;
      case 'switch_sequence':
        activeTab = 'sequence';
        pushToast('info', m.shortcutViewNavigation(), m.shortcutViewEditor());
        break;
      case 'switch_features':
        activeTab = 'features';
        pushToast('info', m.shortcutViewNavigation(), m.shortcutViewFeatures());
        break;
      case 'switch_properties':
        activeTab = 'properties';
        pushToast('info', m.shortcutViewNavigation(), m.shortcutViewProperties());
        break;
      case 'switch_notes':
        activeTab = 'notes';
        pushToast('info', m.shortcutViewNavigation(), m.shortcutViewNotes());
        break;
      case 'undo':
        if (canUndo) {
          undo();
          pushToast('success', m.shortcutUndoSuccess(), m.shortcutUndoDone());
        } else {
          pushToast('warn', m.shortcutUndoNothing(), m.shortcutHistoryStackEmpty());
        }
        break;
      case 'redo':
        if (canRedo) {
          redo();
          pushToast('success', m.shortcutRedoSuccess(), m.shortcutRedoDone());
        } else {
          pushToast('warn', m.shortcutRedoNothing(), m.shortcutAlreadyLatest());
        }
        break;
      case 'save_project':
        saveProjectAsSpiceg();
        break;
      case 'flip_sequence':
        flipSequence();
        break;
      case 'clear_selection':
        selectionStart = 1;
        selectionEnd = 1;
        pushToast('info', m.shortcutClearSelection(), m.shortcutSelectionReset());
        break;
      case 'toggle_search':
        showSearchBar = !showSearchBar;
        pushToast('info', m.shortcutSequenceSearching(), showSearchBar ? m.shortcutSearchBarOn() : m.shortcutSearchBarOff());
        break;
      case 'toggle_enzymes':
        showEnzymeSelector = !showEnzymeSelector;
        pushToast('info', m.shortcutEnzymeAnalysis(), showEnzymeSelector ? m.shortcutEnzymePanelOpen() : m.shortcutEnzymePanelClosed());
        break;
      case 'toggle_codon':
        showCodonOptimizer = !showCodonOptimizer;
        pushToast('info', m.shortcutCodonOptimize(), showCodonOptimizer ? m.codonOptimizePanelOpen() : m.codonOptimizePanelClose());
        break;
      case 'toggle_crispr':
        showCrisprDesigner = !showCrisprDesigner;
        pushToast('info', m.shortcutCRISPRDesign(), showCrisprDesigner ? m.shortcutCrisprEditorOpen() : m.shortcutCrisprEditorClosed());
        break;
      case 'toggle_validator':
        showCloningValidator = !showCloningValidator;
        pushToast('info', m.shortcutCloningValidate(), showCloningValidator ? m.shortcutCloningValidatorOpen() : m.shortcutCloningValidatorClosed());
        break;
      case 'toggle_gel':
        showVirtualGel = !showVirtualGel;
        pushToast('info', m.shortcutVirtualGel(), showVirtualGel ? m.shortcutGelShown() : m.shortcutGelHidden());
        break;
      case 'toggle_logger':
        showLogger = !showLogger;
        pushToast('info', m.shortcutConsoleLog(), showLogger ? m.shortcutLogShown() : m.shortcutLogHidden());
        break;
      case 'toggle_primers':
        showPrimerTable = !showPrimerTable;
        pushToast('info', m.shortcutPrimerCollab(), showPrimerTable ? m.limsPrimerDataPanelOpen() : m.limsPrimerDataPanelClose());
        break;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<div class="ove-editor" style="position: relative; flex: 1 1 auto; width: 100%; height: 100%; overflow: hidden; display: flex; flex-direction: column; background: {bgColor}; font-family: var(--pix-font);">
 <!-- SnapGene parity: customizable background color -->
  <input type="file" accept=".clustal,.aln,.fa,.fasta,.nexus,.nex,.phylip,.msf,.sto,.stockholm" bind:this={alignmentFileInput} onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) handleAlignmentFile(f); e.currentTarget.value = ''; }} style="display: none;" />
 <input type="file" accept=".spiceg,.dna,.gb,.gbk,.gbff,.genbank,.embl,.em,.fasta,.fa,.fna,.faa,.fastq,.fq,.seq,.txt" bind:this={geneFileInput} onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) handleGeneFile(f); e.currentTarget.value = ''; }} style="display: none;" />
  <input type="file" accept=".ab1,.abif,.scf" bind:this={sangerFileInput} onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) handleSangerFile(f); e.currentTarget.value = ''; }} style="display: none;" />

  <!-- Retro-style Menu Bar -->
  <div class="menu-bar" style="display: flex; gap: 4px; padding: 4px 8px; background: var(--pix-bg-3); border-bottom: 2px solid var(--pix-border); font-size: 11px; z-index: 9999; align-items: center;">
    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuFile()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn" onclick={() => geneFileInput?.click()}>
          <FileUpIcon size={12} /> {m.menuFileOpen()}
        </button>
        <button class="menu-action-btn" onclick={() => showEnsemblPanel = !showEnsemblPanel}>
          <Globe size={12} /> {m.menuFileEnsembl()}
        </button>
        <button class="menu-action-btn" onclick={() => showNcbiPanel = !showNcbiPanel}>
          <Globe size={12} /> {m.menuFileNcbi()}
        </button>
        <button class="menu-action-btn" onclick={() => showUniprotPanel = !showUniprotPanel}>
          <Globe size={12} /> {m.menuFileUniprot()}
        </button>
        <button class="menu-action-btn" onclick={() => showCollectionsPanel = !showCollectionsPanel}>
          <Folder size={12} /> {m.menuFileCollections()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={() => saveProjectAsSpiceg()}>
          <Save size={12} /> {m.menuFileSave()} <span style="margin-left: auto; font-size: 8px; opacity: 0.5; padding-left: 10px;">Ctrl+S</span>
        </button>
        <button class="menu-action-btn" onclick={() => showExportModal = true}>
          <Layers size={12} /> {m.menuFileExport()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={() => sangerFileInput?.click()}>
          <Activity size={12} /> {m.menuFileSanger()}
        </button>
      </div>
    </div>

    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuEdit()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn" onclick={undo} disabled={!canUndo}>
          <Undo2 size={12} /> {m.menuEditUndo()}
        </button>
        <button class="menu-action-btn" onclick={redo} disabled={!canRedo}>
          <Redo2 size={12} /> {m.menuEditRedo()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={() => { activeTab = (activeTab === 'linear' ? 'circular' : 'linear'); }}>
          <Circle size={12} /> {m.menuEditTopology({ topo: linear ? m.topologyCircular() : m.topologyLinear() })}
        </button>
        <button class="menu-action-btn" onclick={flipSequence}>
          <FlipHorizontal2 size={12} /> {m.menuEditFlip()}
        </button>
        <button class="menu-action-btn" onclick={() => { selectionStart = 1; selectionEnd = 1; }}>
          <RotateCw size={12} /> {m.menuEditClear()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={() => openFeatureEditor()}>
          <Plus size={12} /> {m.menuEditAddFeature()}
        </button>
        <button class="menu-action-btn" onclick={() => runAutoAnnotate()}>
          <BookOpen size={12} /> {m.menuEditAutoAnnotate()}
        </button>
        <button class="menu-action-btn" onclick={() => showSearchBar = !showSearchBar}>
          <Search size={12} /> {m.menuEditSearch()}
        </button>
      </div>
    </div>

    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuCloningDesign()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn {showEnzymeSelector ? 'active' : ''}" onclick={() => showEnzymeSelector = !showEnzymeSelector}>
          <Scissors size={12} /> {m.menuCloneEnzymes()}
        </button>
        <button class="menu-action-btn {showCodonOptimizer ? 'active' : ''}" onclick={() => showCodonOptimizer = !showCodonOptimizer}>
          <Dna size={12} /> {m.menuCloneCodon()}
        </button>
        <button class="menu-action-btn {showPrimerTable ? 'active' : ''}" onclick={() => showPrimerTable = !showPrimerTable}>
          <AlignLeft size={12} /> {m.menuClonePrimers()}
        </button>
        <button class="menu-action-btn {showPcrPanel ? 'active' : ''}" onclick={() => showPcrPanel = !showPcrPanel}>
          <Microscope size={12} /> {m.menuClonePcr()}
        </button>
        <button class="menu-action-btn {showVirtualGel ? 'active' : ''}" onclick={() => showVirtualGel = !showVirtualGel}>
          <Layers size={12} /> {m.menuCloneGel()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" style="color: var(--pix-accent-2);" onclick={() => showCloningModal = true}>
          <Sparkles size={12} /> {m.menuCloneWizard()}
        </button>
        <button class="menu-action-btn {showExpressionCassettePanel ? 'active' : ''}" style="color: var(--pix-cyan);" onclick={() => showExpressionCassettePanel = !showExpressionCassettePanel}>
          <Dna size={12} /> {m.menuCloneExpressionCassette()}
        </button>
        <button class="menu-action-btn {showVectorTemplatePanel ? 'active' : ''}" style="color: var(--pix-purple);" onclick={() => showVectorTemplatePanel = !showVectorTemplatePanel}>
          <GitMerge size={12} /> {m.menuCloneVectorTemplate()}
        </button>
        <button class="menu-action-btn {showCrisprDesigner ? 'active' : ''}" style="color: var(--pix-cyan);" onclick={() => showCrisprDesigner = !showCrisprDesigner}>
          <Sparkles size={12} /> {m.menuCloneCrispr()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn {showCalculatorsPanel ? 'active' : ''}" onclick={() => showCalculatorsPanel = !showCalculatorsPanel}>
          <FlaskIcon size={12} /> {m.menuCloneCalc()}
        </button>
        <button class="menu-action-btn {showPrimersLimsPanel ? 'active' : ''}" onclick={() => showPrimersLimsPanel = !showPrimersLimsPanel}>
          <Folder size={12} /> {m.menuCloneLims()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn {showSyntheticGeneQc ? 'active' : ''}" style="color: var(--pix-accent-2);" onclick={() => showSyntheticGeneQc = !showSyntheticGeneQc}>
          <Check size={12} /> {m.menuCloneQc()}
        </button>
        <button class="menu-action-btn {showNgsGenomicsPanel ? 'active' : ''}" style="color: var(--pix-cyan);" onclick={() => showNgsGenomicsPanel = !showNgsGenomicsPanel}>
          <Microscope size={12} /> {m.menuCloneNgs()}
        </button>
        <button class="menu-action-btn {showCloningExtensionPanel ? 'active' : ''}" style="color: var(--pix-purple);" onclick={() => showCloningExtensionPanel = !showCloningExtensionPanel}>
          <GitMerge size={12} /> {m.menuCloneExtension()}
        </button>
        <button class="menu-action-btn {showCodesignPanel ? 'active' : ''}" style="color: var(--pix-accent);" onclick={() => showCodesignPanel = !showCodesignPanel}>
          <Sparkles size={12} /> {m.tabCodesignPareto()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn {showAnnealPanel ? 'active' : ''}" onclick={() => showAnnealPanel = !showAnnealPanel}>
          <GitMerge size={12} /> {m.menuCloneAnneal()}
        </button>
        <button class="menu-action-btn {showSilentMutPanel ? 'active' : ''}" onclick={() => showSilentMutPanel = !showSilentMutPanel}>
          <CaseSensitive size={12} /> {m.menuCloneSilentMut()}
        </button>
        <button class="menu-action-btn {showReverseTranslatePanel ? 'active' : ''}" onclick={() => showReverseTranslatePanel = !showReverseTranslatePanel}>
          <Activity size={12} /> {m.menuCloneRevTranslate()}
        </button>
        <button class="menu-action-btn {showPrimerModifier ? 'active' : ''}" onclick={() => showPrimerModifier = !showPrimerModifier}>
          <FlaskConical size={12} /> {m.menuClonePrimerMod()}
        </button>
        <button class="menu-action-btn {showEndModPanel ? 'active' : ''}" onclick={() => showEndModPanel = !showEndModPanel}>
          <Scissors size={12} /> {m.menuCloneEndMod()}
        </button>
        <button class="menu-action-btn {showFusionCheckPanel ? 'active' : ''}" onclick={() => showFusionCheckPanel = !showFusionCheckPanel}>
          <GitMerge size={12} /> {m.menuCloneFusionCheck()}
        </button>
        <button class="menu-action-btn {showSlippagePanel ? 'active' : ''}" onclick={() => showSlippagePanel = !showSlippagePanel}>
          <Dna size={12} /> {m.menuCloneSlippage()}
        </button>
      </div>
    </div>

    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuAnalysisViews()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn {showProteinView ? 'active' : ''}" onclick={() => showProteinView = !showProteinView}>
          <Layers size={12} /> {m.menuViewProtein()}
        </button>
        <button class="menu-action-btn {showRnaStructure ? 'active' : ''}" onclick={() => showRnaStructure = !showRnaStructure}>
          <Spline size={12} /> {m.menuViewRna()}
        </button>
        <button class="menu-action-btn {showSangerPanel ? 'active' : ''}" onclick={() => showSangerPanel = !showSangerPanel}>
          <Activity size={12} /> {m.menuViewSangerTrace()}
        </button>
        <button class="menu-action-btn {showCloningValidator ? 'active' : ''}" style="color: var(--pix-green);" onclick={() => showCloningValidator = !showCloningValidator}>
          <Check size={12} /> {m.menuViewSangerValidator()}
        </button>
        <button class="menu-action-btn {showGenomicsTools ? 'active' : ''}" onclick={() => showGenomicsTools = !showGenomicsTools}>
          <Dna size={12} /> {m.menuViewGenomics()}
        </button>
        <button class="menu-action-btn {showSynBioTools ? 'active' : ''}" onclick={() => showSynBioTools = !showSynBioTools}>
          <FlaskIcon size={12} /> {m.menuViewSynbio()}
        </button>
        <button class="menu-action-btn {showSeqAnalysisPanel ? 'active' : ''}" onclick={() => showSeqAnalysisPanel = !showSeqAnalysisPanel}>
          <Search size={12} /> {m.menuViewBlast()}
        </button>
        <button class="menu-action-btn {showAlignmentPanel ? 'active' : ''}" onclick={() => showAlignmentPanel = !showAlignmentPanel}>
          <AlignLeft size={12} /> {m.menuViewAlignment()}
        </button>
        <button class="menu-action-btn {showGcWindow ? 'active' : ''}" onclick={() => { showGcWindow = !showGcWindow; if (showGcWindow) runGcWindow(); }}>
          <Activity size={12} /> {m.menuViewGc()}
        </button>
        <button class="menu-action-btn" onclick={() => alignmentFileInput?.click()}>
          <FileUpIcon size={12} /> {m.menuViewImportAlignment()}
        </button>
      </div>
    </div>

    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuWindow()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn {showHistoryPanel ? 'active' : ''}" onclick={() => showHistoryPanel = !showHistoryPanel}>
          {m.menuWinHistory()}
        </button>
        <button class="menu-action-btn {showLogger ? 'active' : ''}" onclick={() => showLogger = !showLogger}>
          {m.menuWinLogger()}
        </button>
        <button class="menu-action-btn {showSettingsPanel ? 'active' : ''}" onclick={() => showSettingsPanel = !showSettingsPanel}>
          {m.menuWinSettings()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={() => showSingleStrand = !showSingleStrand}>
          {showSingleStrand ? m.menuWinDoubleStrand() : m.menuWinSingleStrand()}
        </button>
        <div class="menu-action-btn" style="display: flex; align-items: center; justify-content: space-between; padding: 3px 10px; font-size: 11px;">
          <span class="pix-dim">{m.menuWinColorTheme()}</span>
          <select class="pix-select" bind:value={colorTheme} style="padding: 1px 4px; font-size: 9px; height: 18px; margin-left: 6px; background: #000; border: 1px solid var(--pix-border); color: #fff;">
            <option value="monochrome">{m.themeMonochrome()}</option>
            <option value="atcg">{m.themeAtcg()}</option>
            <option value="snapgene">{m.themeSnapgene()}</option>
            <option value="benchling">{m.themeBenchling()}</option>
            <option value="sanger">{m.themeSanger()}</option>
            <option value="purine_pyrimidine">{m.themePurinePyrimidine()}</option>
            <option value="gc">{m.themeGc()}</option>
          </select>
        </div>
      </div>
    </div>

    <div style="flex: 1;"></div>
    
    <!-- Project Unsaved/Dirty State Indicator (Gap 17 Save Alignment) -->
    <div style="display: flex; align-items: center; gap: 8px; padding-right: 8px; font-size: 10px;" class="pix-dim">
      {#if projectStore.activeDocKind === 'gene' ? projectStore.dirty : isProjectDirty}
        <span class="pix-led warn" style="background: var(--pix-red);"></span>
        <span style="color: var(--pix-red); font-weight: bold; user-select: none;">{m.unsavedChanges()}</span>
      {:else}
        <span class="pix-led ok" style="background: var(--pix-green);"></span>
        <span style="color: var(--pix-fg-dim); user-select: none;">{m.projectSaved()}</span>
      {/if}
    </div>
  </div>

  {#if projectStore.activeDocKind === 'gene'}
    <ProjectDocBanner kind="gene" />
  {/if}

  <!-- OVE-style Top Toolbar: view tabs + actions -->
  <div class="ove-toolbar" style="display: flex; align-items: stretch; justify-content: space-between; border-bottom: 2px solid var(--pix-border); background: var(--pix-bg-2); z-index: 20;">
    <!-- View Tabs (Using unified Tabs component!) -->
    <div class="ove-tabs" style="display: flex; align-items: center; padding-left: 6px;">
      <Tabs {...ui} tabs={activeTabsList} bind:active={activeTab} />
    </div>
  </div>

  <!-- OVE-style Main Split: Map (left) + Sequence (right) -->
  <div class="ove-main" style="flex: 1; min-height: 0; display: flex;">
    
   <!-- Left pane: map / properties -->
 {#if activeTab === 'circular' || activeTab === 'linear' || activeTab === 'properties' || activeTab === 'features' || activeTab === 'notes'}
    <div class="ove-left" style={`width: ${leftW}px; flex: 0 0 auto; min-width: 0; display: flex; flex-direction: column; min-height: 0; position: relative;`}>

        <!-- Map viewport (circular or linear) -->
        {#if activeTab === 'circular' || activeTab === 'linear'}
        <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
          <PlasmidMap 
            {plasmidName} 
            bind:dnaSeq 
            {geneFeatures} 
            {restrictionSites} 
            primers={ovePrimers}
            {selectionNotes}
            bind:activeFeatureId 
            bind:selectionStart
            bind:selectionEnd
            {linear}
          />
        </div>
        {/if}

        <!-- Properties panel content (OVE "Properties" tab) -->
        {#if activeTab === 'properties'}
          <div style="flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; font-size: 10.5px;">
            
            <!-- Created / Modified dates (SnapGene standard top info) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-bottom: 1px dashed var(--pix-border); padding-bottom: 6px;">
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propCreatedAt()}</span>
                <input class="pix-input" type="text" bind:value={propCreatedDate} style="width: 100%; padding: 2px 4px; font-size: 10px; height: 18px;" />
              </div>
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propModifiedAt()}</span>
                <input class="pix-input" type="text" bind:value={propModifiedDate} style="width: 100%; padding: 2px 4px; font-size: 10px; height: 18px;" />
              </div>
            </div>

            <!-- Basic selection dropdowns -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propTopologyTypeLabel()}</span>
                <select class="pix-select" bind:value={propDnaType} style="width: 100%; font-size: 9.5px; height: 20px;">
                  <option value="Natural DNA">{m.propTypeNaturalDna()}</option>
                  <option value="Synthetic DNA">{m.propTypeSyntheticDna()}</option>
                  <option value="Genomic DNA">{m.propTypeGenomicDna()}</option>
                  <option value="Plasmid">{m.propTypePlasmid()}</option>
                </select>
              </div>
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propSequenceClassLabel()}</span>
                <select class="pix-select" bind:value={propSequenceClass} style="width: 100%; font-size: 9.5px; height: 20px;">
                  <option value="PLN - plant, fungal, and algal">{m.propClassPln()}</option>
                  <option value="BCT - bacteria">{m.propClassBct()}</option>
                  <option value="VRL - virus">{m.propClassVrl()}</option>
                  <option value="SYN - synthetic">{m.propClassSyn()}</option>
                </select>
              </div>
            </div>

            <!-- Laboratory Host -->
            <div>
              <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propLabHostLabel()}</span>
              <input class="pix-input" type="text" bind:value={propLabHost} style="width: 100%; padding: 2px 4px; font-size: 10px; height: 20px;" placeholder={m.propLabHostPlaceholder()} />
            </div>

            <!-- Description -->
            <div>
              <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propDescriptionLabel()}</span>
              <textarea class="pix-input" bind:value={propDescription} rows={2} style="width: 100%; padding: 4px; font-size: 10px; font-family: sans-serif; resize: vertical;" placeholder={m.propDescriptionPlaceholder()}></textarea>
            </div>

            <!-- Accession and Code Number -->
            <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 8px; align-items: flex-end;">
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propAccessionLabel()}</span>
                <div style="display: flex; gap: 2px; align-items: center;">
                  <input class="pix-input" type="text" bind:value={propAccession} style="flex: 1; padding: 2px 4px; font-size: 10px; height: 20px;" placeholder="e.g. DQ115396" />
                  <button class="pix-btn-reset" onclick={() => {
                    if (propAccession) {
                      window.open(`https://www.ncbi.nlm.nih.gov/nuccore/${propAccession}`, '_blank');
                    }
                  }} style="cursor: pointer; display: flex; align-items: center; justify-content: center; width: 22px; height: 20px; border: 1px solid var(--pix-border); background: #000; color: var(--pix-cyan); border-radius: 2px;" title={m.propOpenInNcbiTitle()}>
                    <Globe size={11} />
                  </button>
                </div>
              </div>
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propCodeNumberLabel()}</span>
                <input class="pix-input" type="text" bind:value={propCodeNumber} style="width: 100%; padding: 2px 4px; font-size: 10px; height: 20px;" placeholder={m.propCodeNumberPlaceholder()} />
              </div>
            </div>

            <!-- Author & Comments -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propAuthorLabel()}:</span>
                <input class="pix-input" type="text" readonly value={propAuthor} placeholder={m.elnAuthorLockedHint()} title={m.elnAuthorLockedHint()} style="width: 100%; padding: 2px 4px; font-size: 10px; height: 20px; {propAuthor ? '' : 'opacity: 0.45;'}" />
              </div>
              <div>
                <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propCommentsLabel()}</span>
                <input class="pix-input" type="text" bind:value={propComments} style="width: 100%; padding: 2px 4px; font-size: 10px; height: 20px;" placeholder={m.propCommentsPlaceholder()} />
              </div>
            </div>

            <!-- References -->
            <div>
              <span class="pix-dim" style="font-size: 9px; display: block; margin-bottom: 1px;">{m.propReferencesLabel()}</span>
              <textarea class="pix-input" bind:value={propReferences} rows={2} style="width: 100%; padding: 4px; font-size: 10px; resize: vertical;" placeholder={m.propReferencesPlaceholder()} />
            </div>

            <div style="border-top: 1px dashed var(--pix-border); margin-top: 4px; padding-top: 6px;">
              <div class="pix-title" style="color: var(--pix-accent-2); font-size: 11px;">{m.propEditDnaTitle()}</div>
              <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px; margin-top: 4px;">
                <span class="pix-dim" style="font-size: 11px; white-space: nowrap;">{m.propPlasmidNameLabel()}</span>
                <input class="pix-input" type="text" bind:value={plasmidName} style="flex:1; padding: 2px 4px; font-size: 11px; font-family: var(--pix-font); height: 20px;" />
              </div>
              
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="pdb-dropzone {isDragging ? 'dragging' : ''}" role="region" aria-label={m.dropzoneDna()}
                ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
                <Textarea {...ui} bind:value={dnaSeq} placeholder={m.inputDNASequence()} rows={4} />
                {#if isDragging}
                  <div class="drop-overlay pix-panel">
                    <FileUp size={16} style="color: var(--pix-accent-2); margin-bottom: 4px;" />
                    <span style="font-size: 8px; color: var(--pix-accent-2); font-weight: bold;">{m.propDropToLoad()}</span>
                  </div>
                {/if}
              </div>
              <div class="kv" style="font-size: 10px; margin-top: 4px;">
                <span class="pix-dim">{m.propLengthLabel()}</span>
                <span class="pix-num">{dnaSeq.length} bp</span>
                <span class="pix-dim">{m.propTopologyLabel()}</span>
                <span class="pix-num">{linear ? m.propTopologyLinearText() : m.propTopologyCircularText()}</span>
                <span class="pix-dim">{m.propGcContentLabel()}</span>
                <span class="pix-num {dnaGcContent > 60 || dnaGcContent < 40 ? 'warn' : 'good'}">{dnaGcContent.toFixed(1)}%</span>
              </div>
            </div>
         </div>
       {/if}

       <!-- Features list panel (activeTab === 'features') -->
       {#if activeTab === 'features'}
         <div style="flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 10.5px;">
           <div style="display: flex; gap: 6px; align-items: center;">
             <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 11px;">{m.featureLabel()} ({sortedFilteredFeatures.length})</span>
             <div style="flex: 1;"></div>
             <button class="pix-btn ok" onclick={() => openFeatureEditor()} style="padding: 2px 8px; font-size: 9px;">{m.menuEditAddFeature()}</button>
             <button class="pix-btn" onclick={runAutoAnnotate} style="padding: 2px 8px; font-size: 9px;">{m.menuEditAutoAnnotate()}</button>
           </div>
           <div style="display: flex; gap: 6px; align-items: center;">
             <input class="pix-input" type="text" bind:value={featureSearchText} placeholder={m.featureName()} style="flex: 1; padding: 2px 4px; font-size: 9.5px;" />
             <select class="pix-select" bind:value={featureFilterType} style="padding: 2px 4px; font-size: 9.5px;">
               <option value="all">{m.featAllTypes()}</option>
               {#each allFeatureTypes as t}<option value={t}>{t.toUpperCase()}</option>{/each}
             </select>
             <select class="pix-select" bind:value={featureSortKey} style="padding: 2px 4px; font-size: 9.5px;">
               <option value="start">{m.featColStart()}</option>
               <option value="name">{m.featColName()}</option>
               <option value="size">{m.featColSize()}</option>
               <option value="type">{m.featColType()}</option>
               <option value="color">{m.featColColor()}</option>
             </select>
           </div>
           <div style="display: grid; grid-template-columns: 12px 1fr 54px 54px 72px 22px 22px; gap: 4px; align-items: center; color: var(--pix-fg-dim); font-size: 9px; border-bottom: 1px solid var(--pix-border); padding-bottom: 3px;">
             <span></span><span>{m.featColName()}</span><span>{m.featColStart()}</span><span>{m.featColSize()}</span><span>{m.featColType()}</span><span></span><span></span>
           </div>
           {#each sortedFilteredFeatures as f (f.id)}
             <!-- svelte-ignore a11y_click_events_have_key_events -->
             <!-- svelte-ignore a11y_no_static_element_interactions -->
             <div class="pix-panel" onmouseenter={() => activeFeatureId = f.id} onmouseleave={() => activeFeatureId = null} onclick={() => { selectionStart = f.start; selectionEnd = f.end; }}
                  style="display: grid; grid-template-columns: 12px 1fr 54px 54px 72px 22px 22px; gap: 4px; align-items: center; padding: 3px 5px; font-size: 9.5px; cursor: pointer; border-color: {activeFeatureId === f.id ? 'var(--pix-cyan)' : 'var(--pix-border)'};">
               <span style="width: 10px; height: 10px; border-radius: 2px; background: {f.color}; display: inline-block;"></span>
               <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title={f.name}>{f.name}</span>
               <span class="pix-num">{f.start}</span>
               <span class="pix-num">{Math.abs(f.end - f.start) + 1}</span>
               <span class="pix-dim" style="text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title={f.type}>{f.type}</span>
               <button class="pix-btn-reset" onclick={(e) => { e.stopPropagation(); openFeatureEditor(f); }} title={m.menuEdit()} style="font-size: 10px; color: var(--pix-cyan); padding: 0 3px;">✎</button>
               <button class="pix-btn-reset" onclick={(e) => { e.stopPropagation(); deleteFeature(f.id); }} title={m.delete()} style="font-size: 10px; color: var(--pix-red); padding: 0 3px;">×</button>
             </div>
           {:else}
             <div class="pix-dim" style="text-align: center; padding: 10px; font-size: 9.5px;">{m.featEmpty()}</div>
           {/each}
         </div>
       {/if}

       <!-- Notes panel content (Rich Text editor and preview) (Gap 17) -->
       {#if activeTab === 'notes'}
         <div style="flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
           <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
             <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 11px;">{m.notesTitle()}</span>
             <div style="display: flex; gap: 6px; align-items: center;">
               <button class="pix-btn-reset" onclick={() => {
                 syncCurrentPage();
                 isProjectDirty = true;
                 saveProjectAsSpiceg();
                 pushToast('success', m.toastElnPageSaved(), elnTitle);
               }} style="font-size: 9.5px; color: var(--pix-green, #4caf50); cursor: pointer; border: none; background: transparent; display: inline-flex; align-items: center; gap: 3px;">[{m.elnSavePage()}]</button>
               <button class="pix-btn-reset" onclick={() => { syncCurrentPage(); showPageManagerModal = true; }} style="font-size: 9.5px; color: var(--pix-cyan); cursor: pointer; border: none; background: transparent; display: inline-flex; align-items: center; gap: 3px;">[{m.elnPageManager()} ({notebookPages.length})]</button>
             </div>
           </div>

           <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; background: rgba(226, 180, 72, 0.05); border-left: 2px solid var(--pix-accent-2); font-size: 9.5px; border-radius: 0 3px 3px 0; margin-bottom: 2px; font-family: var(--pix-font);">
             <span class="pix-dim">{m.elnCurrentPage()}: <strong style="color: var(--pix-accent-2);">{currentPageIdx + 1}. {elnTitle}</strong></span>
             <span class="pix-dim" style="opacity: 0.8;">{m.elnAuthor()}: {notebookPages[currentPageIdx]?.author || propAuthor} | {m.elnDate()}: {notebookPages[currentPageIdx]?.date || new Date().toLocaleDateString()}</span>
           </div>
           
           <div style="display: flex; flex-direction: column; gap: 4px; width: 100%;">
             <MilkdownEditor bind:this={editorRef} bind:value={propNotesMarkdown} onInsertDna={insertDnaBlock} onInsertProtein={insertProteinBlock} readonly={!!notebookPages[currentPageIdx]?.locked} />
           </div>

           <!-- Interactive selection note creation block -->
           {#if selectionStart !== 1 || selectionEnd !== 1}
             <div class="pix-panel" style="padding: 8px; border-color: var(--pix-accent-2); background: rgba(76, 214, 255, 0.05); margin-top: 6px;">
               <div style="font-weight: bold; color: var(--pix-accent-2); font-size: 10px; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                 <span>{m.noteAddSelectionNote()}</span>
                 <span class="pix-num" style="font-size: 8.5px; opacity: 0.8;">({selectionStart}..{selectionEnd} bp)</span>
               </div>
               <div style="display: flex; gap: 4px;">
                 <input 
                   class="pix-input" 
                   type="text" 
                   bind:value={newSelectionNoteText} 
                   placeholder={m.noteSelectionPlaceholder()} 
                   style="flex: 1; padding: 2px 6px; font-size: 10px; height: 24px;"
                   onkeydown={(e) => { if (e.key === 'Enter') saveNoteForActiveSelection(); }}
                 />
                 <button class="pix-btn ok" onclick={saveNoteForActiveSelection} style="padding: 2px 8px; font-size: 9px; height: 24px;">{m.add()}</button>
               </div>
             </div>
           {/if}

           <!-- Notes listing -->
           <div class="pix-title" style="color: var(--pix-accent-2); font-size: 11px; margin-top: 10px; display: inline-flex; align-items: center; gap: 4px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
             <span>{m.noteSelectionTable()}</span>
             <span style="font-size: 8.5px; opacity: 0.6; color: var(--pix-fg-dim);">({selectionNotes.length})</span>
           </div>
           <div style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
             {#each selectionNotes as note, idx}
               <!-- svelte-ignore a11y_click_events_have_key_events -->
               <!-- svelte-ignore a11y_no_static_element_interactions -->
               <div class="pix-panel" style="padding: 4px 6px; display: flex; justify-content: space-between; align-items: center; border-color: var(--pix-border); background: rgba(76, 214, 255, 0.03);">
                 <div style="flex: 1; min-width: 0; cursor: pointer;" onclick={() => { selectionStart = note.start; selectionEnd = note.end; pushToast('info', m.noteJumpToSelectionTitle(), `${note.start}..${note.end} bp`); }}>
                   <div style="font-weight: bold; font-size: 10px; color: #4cd6ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{note.text}</div>
                   <div class="pix-dim" style="font-size: 8.5px;">{m.range()} {note.start} - {note.end} bp ({note.end - note.start + 1} bp)</div>
                 </div>
                 <button class="pix-btn-reset" onclick={() => {
                   const deleted = selectionNotes[idx];
                   selectionNotes = selectionNotes.filter((_, i) => i !== idx);
                   pushLog(m.logNoteDeleted({ v1: deleted.text }));
                   pushToast('success', m.toastNoteDeletedTitle(), deleted.text);
                 }} style="font-size: 8px; color: var(--pix-red); cursor: pointer; padding: 2px 4px;">{m.elnDelete()}</button>
               </div>
             {/each}
             {#if selectionNotes.length === 0}
               <div class="pix-dim" style="text-align: center; padding: 8px; font-size: 9px;">{m.noteEmptyHint()}</div>
             {/if}
           </div>

           <!-- Feature 25: ELN (Electronic Lab Notebook) Digital Signer -->
           <div class="pix-title" style="color: var(--pix-accent-2); font-size: 11px; margin-top: 12px; display: inline-flex; align-items: center; gap: 4px; border-top: 1.5px solid var(--pix-border); padding-top: 8px;">
             <span>{m.elnSigningPanelTitle()}</span>
           </div>
           <div class="pix-panel" style="padding: 8px; border-color: var(--pix-border); background: rgba(0,0,0,0.25); display: flex; flex-direction: column; gap: 6px; font-family: var(--pix-font);">
             <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
               <div style="display: flex; flex-direction: column; gap: 3px;">
                 <span class="pix-dim">{m.elnTitleLabel()}</span>
                 <input class="pix-input" type="text" bind:value={elnTitle} style="width: 100%; height: 22px; padding: 2px 4px; font-size: 9.5px;" disabled={!!notebookPages[currentPageIdx]?.locked} />
               </div>
               <div style="display: flex; flex-direction: column; gap: 3px;">
                 <span class="pix-dim">{m.elnCategoryLabel()}</span>
                 <select class="pix-select" bind:value={elnCategory} style="width: 100%; height: 22px; padding: 1px 4px; font-size: 9.5px;" disabled={!!notebookPages[currentPageIdx]?.locked}>
                   <option value="Cloning">{m.elnCatCloning()}</option>
                   <option value="PCR">{m.elnCatPcr()}</option>
                   <option value="Cell_Transformation">{m.elnCatTransformation()}</option>
                   <option value="Electrophoresis">{m.elnCatElectrophoresis()}</option>
                   <option value="General">{m.elnCatGeneral()}</option>
                 </select>
               </div>
             </div>
             
             <div style="display: flex; flex-direction: column; gap: 3px;">
               <span class="pix-dim">{m.elnTagsLabel()}</span>
               <input class="pix-input" type="text" bind:value={elnTagsString} style="width: 100%; height: 22px; padding: 2px 4px; font-size: 9.5px;" placeholder={m.elnTagsPlaceholder()} disabled={!!notebookPages[currentPageIdx]?.locked} />
             </div>

             <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px; border: 1px solid var(--pix-border); background: rgba(76,214,255,0.04); font-size: 8.5px;">
               <span class="pix-dim">{m.orcidLabel()}: {identity.value.profile?.orcid || identity.value.orcid || m.elnOrcidMissing()}</span>
               <span style="color: {identity.value.profile ? 'var(--pix-green)' : 'var(--pix-accent-2)'};">{identityLoading ? m.elnOrcidLoading() : identity.value.profile ? m.elnOrcidResolved() : m.elnOrcidResolveHint()}</span>
               {#if !identity.value.profile}<button class="pix-btn-reset" onclick={resolveElnIdentity} disabled={identityLoading} style="font-size: 8px; color: var(--pix-cyan);">[{m.elnResolveOrcid()}]</button>{/if}
             </div>

             {#if !notebookPages[currentPageIdx]?.locked}
               <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                 <div style="display: flex; flex-direction: column; gap: 3px;">
                   <span class="pix-dim" style="color: var(--pix-accent-2);">{m.elnWitnessLabel()}</span>
                   <input class="pix-input" type="text" bind:value={elnWitness} placeholder={m.elnWitnessPlaceholder()} style="width: 100%; height: 22px; padding: 2px 4px; font-size: 9.5px; border-color: var(--pix-accent-2);" />
                 </div>
                 <div style="display: flex; flex-direction: column; gap: 3px;">
                   <span class="pix-dim">{m.elnSigningReasonLabel()}</span>
                   <input class="pix-input" type="text" bind:value={elnReason} style="width: 100%; height: 22px; padding: 2px 4px; font-size: 9.5px;" />
                 </div>
               </div>

               <div style="font-size: 8.5px; line-height: 1.35; padding: 5px; background: rgba(76, 214, 255, 0.05); border-left: 2px solid var(--pix-accent-2); border-radius: 0 4px 4px 0; color: var(--pix-fg-dim);">
                 ℹ️ <strong>{m.elnSignHintTitle()}</strong>: {m.elnSignHintPart1()}<strong>{m.elnSignHintBold()}</strong>{m.elnSignHintPart2()}<strong>{m.elnSignHintAudit()}</strong>{m.elnSignHintPart3()}
               </div>
               
               <button class="pix-btn ok" onclick={signCurrentEln} disabled={identityLoading} style="padding: 5px; font-weight: bold; font-size: 9.5px; margin-top: 2px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">{m.elnSignButton()}</button>
             {:else}
               <div style="border: 1.5px solid var(--pix-accent-2); background: rgba(226, 180, 72, 0.05); padding: 8px; border-radius: 4px; font-size: 8.5px;">
                 <strong style="color: var(--pix-accent-2);">🔒 {m.elnLockedState()}</strong>
                 <div>{m.orcidLabel()}: {notebookPages[currentPageIdx].orcid || identity.value.profile?.orcid || m.elnOrcidMissing()}</div>
                 <div>{m.elnSignatureDigest()}: {notebookPages[currentPageIdx].signatureDigest || m.elnDigestUnavailable()}</div>
               </div>
              {/if}
            </div>
      </div>
      {/if}
    </div>
    <div class="ove-resizer" role="separator" aria-orientation="vertical" tabindex="0"
         onpointerdown={startLeftResize}
         onkeydown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeSplit(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeSplit(1); } }}
         ondblclick={() => { leftW = 640; persistSplit(); }}
         title={m.resizerDragHint()}></div>
  {/if}

  <!-- Right pane: Sequence Viewer (DnaViewer) -->
  <div class="ove-right" style="flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; position: relative;">
    <DnaViewer
      bind:dnaSeq
      {plasmidName}
      {codonHost}
      bind:quickDbId
      {translatedProtein}
      {restrictionSites}
      {geneFeatures}
      parts={oveParts}
      primers={ovePrimers}
      bind:selectionStart
      bind:selectionEnd
      {showSingleStrand}
      {colorTheme}
      {modifiedRanges}
      bind:seqTool
      {showFeatures}
      {showTranslations}
      onAddSelectionNote={saveNoteForActiveSelection}
      onSaveProject={saveProjectAsSpiceg}
      onAddFeature={(start, end) => { selectionStart = start; selectionEnd = end; openFeatureEditor(); }}
    />
  </div>
  </div>

  {#if showSearchBar}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 360px; top: 80px; width: 340px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Search size={12} /> {m.menuEditSearch()}</span>
        <button class="pix-btn-reset" onclick={() => showSearchBar = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <div style="display: flex; gap: 4px;">
          <input class="pix-input" type="text" bind:value={searchQuery} placeholder={m.searchSeqPlaceholder()} style="flex: 1; padding: 2px 4px; font-size: 10px; font-family: monospace;" onkeydown={(e) => { if (e.key === 'Enter') runSequenceSearch(); }} />
          <button class="pix-btn ok" onclick={() => runSequenceSearch()} style="padding: 2px 8px; font-size: 10px;">{m.searchBtn()}</button>
        </div>
        {#if searchResults}
          <div class="pix-dim" style="font-size: 9px;">{m.searchFoundCount({ v1: searchResults.count })}</div>
          <div style="max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;">
            {#each searchResults.matches as match}
              <div class="pix-panel" style="padding: 3px 6px; font-size: 9px; cursor: pointer;" onclick={() => { selectionStart = match.position + 1; selectionEnd = match.position + searchResults.query.length; }}>
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: {match.strand === 'forward' ? 'var(--pix-green)' : 'var(--pix-accent)'};">{match.strand === 'forward' ? '→' : '←'} pos {match.position + 1}</span>
                </div>
                <div class="mono" style="font-size: 8px; color: var(--pix-cyan); word-break: break-all;">{match.context}</div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ FEATURE EDITOR MODAL ============ -->
  {#if showFeatureEditor}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-overlay" onclick={() => showFeatureEditor = false}>
      <div class="modal-box pix-panel" style="width: 420px;" onclick={(e) => e.stopPropagation()}>
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 8px; margin-bottom: 10px;">
          <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 12px;">{m.featureEditorTitle()}</span>
          <button class="pix-btn-reset" onclick={() => showFeatureEditor = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="pix-dim" style="width: 60px;">{m.featLabelName()}</span>
            <input class="pix-input" type="text" bind:value={editingFeature.name} placeholder={m.featureName()} style="flex: 1; padding: 3px 4px; font-size: 11px;" />
          </div>
          <div style="display: flex; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
              <span class="pix-dim" style="width: 60px;">{m.featLabelStart()}</span>
              <input class="pix-input" type="number" bind:value={editingFeature.start} style="flex: 1; padding: 3px 4px; font-size: 11px;" />
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
              <span class="pix-dim" style="width: 60px;">{m.featLabelEnd()}</span>
              <input class="pix-input" type="number" bind:value={editingFeature.end} style="flex: 1; padding: 3px 4px; font-size: 11px;" />
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
              <span class="pix-dim" style="width: 60px;">{m.featLabelType()}</span>
              <div style="display: flex; gap: 3px; flex: 1; align-items: center;">
                <select class="pix-select" bind:value={editingFeature.type} style="flex: 1; padding: 2px 4px; font-size: 11px; height: 24px; min-width: 80px;">
                  {#each allFeatureTypes as type}
                    <option value={type}>{type.toUpperCase()}</option>
                  {/each}
                </select>
                <button class="pix-btn-reset" onclick={() => {
                  const newType = prompt(m.customFeatTypePrompt());
                  if (newType) {
                    addCustomFeatureType(newType, editingFeature.color);
                    editingFeature.type = newType.toLowerCase();
                  }
                }} style="font-size: 10px; color: var(--pix-cyan); padding: 2px 5px; border: 1px solid var(--pix-border); background: #000; border-radius: 2px; cursor: pointer; height: 22px; display: flex; align-items: center; justify-content: center; font-weight: bold;" title={m.featAddCustomTypeTitle()}>+</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
              <span class="pix-dim" style="width: 60px;">{m.featLabelColor()}</span>
              <input class="pix-input" type="color" bind:value={editingFeature.color} style="width: 40px; height: 24px; border: 1px solid var(--pix-border); background: none; cursor: pointer;" />
            </div>
          </div>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" bind:checked={editingFeature.forward} style="cursor: pointer;" /> {m.featForwardStrand()}
          </label>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <button class="pix-btn ok" onclick={() => saveFeature()} style="flex: 1; padding: 6px; font-size: 11px;">{m.save()}</button>
          <button class="pix-btn" onclick={() => showFeatureEditor = false} style="flex: 1; padding: 6px; font-size: 11px;">{m.cancel()}</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ============ ELN PAGE MANAGER MODAL ============ -->
  {#if showPageManagerModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-overlay" onclick={() => { syncCurrentPage(); showPageManagerModal = false; }}>
      <div class="modal-box pix-panel" style="width: 440px;" onclick={(e) => e.stopPropagation()}>
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 8px; margin-bottom: 10px;">
          <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 12px;">{m.elnPageManagerTitle()}</span>
          <button class="pix-btn-reset" onclick={() => { syncCurrentPage(); showPageManagerModal = false; }} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 10px;">
          <span class="pix-dim">{m.elnTotalPages({ n: notebookPages.length })}</span>
          <button class="pix-btn ok" onclick={newElnPage} style="padding: 2px 10px; font-size: 9.5px;">+ {m.elnNewPage()}</button>
        </div>
        <div style="max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
          {#each notebookPages as p, idx (p.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="pix-panel" style="display: flex; align-items: center; gap: 8px; padding: 6px; cursor: pointer; border-color: {currentPageIdx === idx ? 'var(--pix-cyan)' : 'var(--pix-border)'};" onclick={() => selectPage(idx)}>
              <span class="pix-num" style="width: 20px; text-align: center; flex: 0 0 auto;">{idx + 1}</span>
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: bold; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{p.title || '(untitled)'}</div>
                <div class="pix-dim" style="font-size: 8.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  {p.category} · {p.date}{p.locked ? ' · 🔒 ' + m.elnLockedState() : ''}
                </div>
              </div>
              <button class="pix-btn-reset" onclick={(e) => { e.stopPropagation(); deleteElnPage(idx); }} style="font-size: 9px; color: var(--pix-red); padding: 1px 5px; flex: 0 0 auto; cursor: pointer; border: 1px solid var(--pix-border); background: transparent; border-radius: 2px;">{m.elnDelete()}</button>
            </div>
          {/each}
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
          <button class="pix-btn" onclick={() => { syncCurrentPage(); showPageManagerModal = false; }} style="padding: 4px 14px; font-size: 10px;">{m.elnFinishClose()}</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ============ UNIPROT IMPORT PANEL (Gap 13) ============ -->
  {#if showUniprotPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 310px; top: 180px; width: 320px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Globe size={12} /> {m.uniprotImportPanelTitle()}</span>
        <button class="pix-btn-reset" onclick={() => showUniprotPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <input class="pix-input" type="text" bind:value={uniprotQuery} placeholder="Accession Number (e.g. P0DTC2)" style="padding: 3px 4px; font-size: 10px;" onkeydown={(e) => { if (e.key === 'Enter') importFromUniprot(); }} />
        <button class="pix-btn ok" onclick={importFromUniprot} disabled={uniprotLoading} style="padding: 3px; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
          {#if uniprotLoading}<RotateCw size={11} class="spin" />{:else}<Globe size={11} />{/if}
          {uniprotLoading ? m.searchingIn() : m.uniprotImportBtn()}
        </button>
      </div>
    </div>
  {/if}

  <!-- ============ COLLECTIONS & BATCH PANEL ============ -->
  {#if showCollectionsPanel}
    <CollectionsBatchPanel
      bind:showCollectionsPanel
      {drag}
      bind:collectionsList
      bind:dnaSeq
      bind:plasmidName
      {pushLog}
      {pushToast}
    />
  {/if}

  <!-- ============ ANNEAL OLIGOS PANEL ============ -->
  {#if showAnnealPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 360px; top: 120px; width: 320px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><GitMerge size={12} /> {m.annealPanelTitle()}</span>
        <button class="pix-btn-reset" onclick={() => showAnnealPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <div>
          <span class="pix-dim" style="font-size: 9px;">{m.annealForwardLabel()}</span>
          <input class="pix-input" type="text" bind:value={annealForward} placeholder="ATCG..." style="width: 100%; padding: 2px 4px; font-size: 9px; font-family: monospace;" />
        </div>
        <div>
          <span class="pix-dim" style="font-size: 9px;">{m.annealReverseLabel()}</span>
          <input class="pix-input" type="text" bind:value={annealReverse} placeholder="ATCG..." style="width: 100%; padding: 2px 4px; font-size: 9px; font-family: monospace;" />
        </div>
        <button class="pix-btn ok" onclick={() => runAnnealOligos()} style="padding: 3px; font-size: 10px;">{m.annealRunBtn()}</button>
      </div>
      {#if annealResult}
        <div class="pix-panel" style="padding: 4px;">
          <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.annealDuplexLenLabel()}</span><span class="pix-num">{annealResult.duplexLength} bp</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="pix-dim">Tm:</span><span class="pix-num">{annealResult.tm}°C</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.annealLeftOverhangLabel()}</span><span class="pix-num">{annealResult.leftOverhang} bp</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.annealRightOverhangLabel()}</span><span class="pix-num">{annealResult.rightOverhang} bp</span></div>
          {#if annealResult.warnings.length > 0}
            <div style="font-size: 8px; color: var(--pix-accent); margin-top: 2px;">{annealResult.warnings.join('; ')}</div>
          {/if}
          <div class="mono" style="font-size: 8px; color: var(--pix-cyan); word-break: break-all; background: #040508; padding: 4px; border-radius: 3px; margin-top: 4px; white-space: pre-wrap;">{annealResult.doubleStranded}</div>
        </div>
      {/if}
      </div>
    {/if}

  <!-- ============ SILENT MUTAGENESIS PANEL ============ -->
  {#if showSilentMutPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 360px; top: 200px; width: 320px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><CaseSensitive size={12} /> {m.silentMutPanelTitle()}</span>
        <button class="pix-btn-reset" onclick={() => showSilentMutPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <div style="display: flex; gap: 4px;">
          <button class="pix-btn {silentMutMode === 'add' ? 'ok' : ''}" onclick={() => silentMutMode = 'add'} style="padding: 2px 6px; font-size: 9px;">{m.silentMutAddSiteBtn()}</button>
          <button class="pix-btn {silentMutMode === 'remove' ? 'ok' : ''}" onclick={() => silentMutMode = 'remove'} style="padding: 2px 6px; font-size: 9px;">{m.silentMutRemoveSiteBtn()}</button>
        </div>
        <input class="pix-input" type="text" bind:value={silentMutSite} placeholder={m.silentMutSitePlaceholder()} style="padding: 2px 4px; font-size: 10px; font-family: monospace;" />
        <button class="pix-btn ok" onclick={() => runSilentMutagenesisFn()} style="padding: 3px; font-size: 10px;">{m.runBtn()}</button>
      </div>
      {#if silentMutResult}
        <div class="pix-panel" style="padding: 4px; border-color: {silentMutResult.mutations.length > 0 ? 'var(--pix-green)' : 'var(--pix-red)'};">
          {#if silentMutResult.mutations.length > 0}
            <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.silentMutCountLabel()}</span><span class="pix-num">{silentMutResult.mutations.length}</span></div>
            {#each silentMutResult.mutations as mut}
              <div style="font-size: 8px; color: var(--pix-cyan);">pos {mut.position}: {mut.codonBefore} -> {mut.codonAfter}</div>
            {/each}
            <button class="pix-btn ok" onclick={() => { pushHistory('Silent mutagenesis applied', 'edit'); dnaSeq = silentMutResult.modifiedSequence; pushLog(m.logSilentMutSuccess()); pushToast('success', m.toastSilentMutApplied(), silentMutResult.mutations.length + ' mutations'); }} style="padding: 2px; font-size: 9px; margin-top: 3px;">{m.silentMutApplyBtn()}</button>
          {:else}
            <div style="font-size: 9px; color: var(--pix-red);">{m.silentMutCannot({ v1: silentMutMode === 'add' ? m.add() : m.remove() })}</div>
          {/if}
          {#if silentMutResult.warnings.length > 0}
            <div style="font-size: 8px; color: var(--pix-accent);">{silentMutResult.warnings.join('; ')}</div>
          {/if}
        </div>
      {/if}
      </div>
    {/if}

  {#if showReverseTranslatePanel}
    <ReverseTranslationPanel bind:showReverseTranslatePanel drag={drag} pushLog={pushLog} pushToast={pushToast} />
  {/if}

  {#if showExpressionCassettePanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel expression-design-panel" style="position: absolute; left: 320px; top: 110px; width: min(720px, calc(100vw - 40px)); max-height: calc(100vh - 140px); overflow: auto; z-index: 65;">
      <div class="panel-header" style="display:flex; justify-content:space-between; align-items:center;">
        <strong>{m.menuCloneExpressionCassette()}</strong>
        <button class="pix-btn-reset" type="button" onclick={() => showExpressionCassettePanel = false} aria-label={m.close()} style="color:var(--pix-red);">[X]</button>
      </div>
      <ExpressionCassetteBuilder cassette={expressionCassette} compact onChange={(next) => expressionCassette = next} onAssembled={applyAssemblyResult} />
    </div>
  {/if}

  {#if showVectorTemplatePanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel expression-design-panel" style="position: absolute; left: 340px; top: 130px; width: min(760px, calc(100vw - 40px)); max-height: calc(100vh - 140px); overflow: auto; z-index: 66;">
      <div class="panel-header" style="display:flex; justify-content:space-between; align-items:center;">
        <strong>{m.menuCloneVectorTemplate()}</strong>
        <button class="pix-btn-reset" type="button" onclick={() => showVectorTemplatePanel = false} aria-label={m.close()} style="color:var(--pix-red);">[X]</button>
      </div>
      <VectorTemplatePanel template={vectorTemplate} cassette={expressionCassette} compact onChange={(next) => expressionCassette = next} onAssembled={(result) => applyAssemblyResult(result)} />
    </div>
  {/if}

  <!-- ============ PRIMER MODIFIER PANEL ============ -->
  {#if showPrimerModifier}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 340px; top: 350px; width: 320px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Scissors size={12} /> {m.primerModPanelTitle()}</span>
        <button class="pix-btn-reset" onclick={() => showPrimerModifier = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <input class="pix-input" type="text" bind:value={primerModSeq} placeholder={m.primerSequence53()} style="padding: 2px 4px; font-size: 10px; font-family: monospace;" />
        <div style="display: flex; gap: 4px; align-items: center; width: 100%;">
          <select bind:value={primerModEnzyme} class="pix-select" style="flex: 1; padding: 2px 4px; font-size: 10px; height: 24px;">
            {#each Object.keys(enzymeDatabase) as enz}
              <option value={enz}>{enz} ({enzymeDatabase[enz].seq})</option>
            {/each}
          </select>
        </div>
        <div style="display: flex; gap: 4px; align-items: center;">
          <span class="pix-dim" style="font-size: 9px;">{m.primerModProtectCountLabel()}</span>
          <input class="pix-input" type="number" bind:value={primerModProtectBases} min={0} max={6} style="width: 40px; padding: 2px 4px; font-size: 9px;" />
          <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 9px;">
            <input type="checkbox" bind:checked={primerModPhosphorylated} style="cursor: pointer;" />
            {m.primerModPhosLabel()}
          </label>
        </div>
        <button class="pix-btn ok" onclick={() => runPrimerModification()} style="padding: 3px; font-size: 10px;">{m.primerModGenerateBtn()}</button>
        {#if primerModResult}
          <div class="pix-panel" style="padding: 4px;">
            <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.primerModLenLabel()}</span><span class="pix-num">{primerModResult.length} nt</span></div>
            <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.primerModSiteLabel()}</span><span class="pix-num">{primerModResult.enzymeSite}</span></div>
            <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.primerModProtectLabel()}</span><span class="pix-num">{primerModResult.protectBases}</span></div>
            <div class="mono" style="font-size: 9px; color: var(--pix-cyan); word-break: break-all; background: #040508; padding: 4px; border-radius: 3px; margin-top: 4px;">
              {#if primerModResult.phosphorylated}
                <span style="color: var(--pix-red); font-weight: bold; background: rgba(255,69,58,0.15); padding: 0px 3px; border-radius: 2px; margin-right: 4px;">[5'-Phosphate]</span>
              {/if}
              {primerModResult.modified}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ DNA END MODIFICATION PANEL ============ -->
  {#if showEndModPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 340px; top: 120px; width: 340px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Scissors size={12} /> {m.endModPanelTitle()}</span>
        <button class="pix-btn-reset" onclick={() => showEndModPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          
          <!-- Left End -->
          <div class="pix-panel" style="padding: 6px; border: 1px dashed var(--pix-border);">
            <div style="font-weight: bold; color: var(--pix-cyan); margin-bottom: 4px;">{m.endModLeftEndTitle()}</div>
            <div style="display: flex; gap: 4px; align-items: center; margin-bottom: 4px;">
              <span class="pix-dim" style="width: 50px;">{m.endModTypeLabel()}</span>
              <select bind:value={endModLeftType} class="pix-select" style="flex: 1; padding: 2px 4px; font-size: 9px; height: 20px;">
                <option value="blunt">{m.endModBlunt()}</option>
                <option value="5-overhang">{m.endMod5Overhang()}</option>
                <option value="3-overhang">{m.endMod3Overhang()}</option>
              </select>
            </div>
            {#if endModLeftType !== 'blunt'}
              <div style="display: flex; gap: 4px; align-items: center; margin-bottom: 4px;">
                <span class="pix-dim" style="width: 50px;">{m.endModSeqLabel()}</span>
                <input class="pix-input" type="text" bind:value={endModLeftSeq} placeholder={m.endModSeqPlaceholder()} style="flex: 1; padding: 2px 4px; font-size: 9px; font-family: monospace;" />
              </div>
            {/if}
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="checkbox" id="leftPhos" bind:checked={endModLeftPhos} style="cursor: pointer;" />
              <label for="leftPhos" style="cursor: pointer; font-size: 9px;">{m.endModPhosLabel()}</label>
            </div>
          </div>

          <!-- Right End -->
          <div class="pix-panel" style="padding: 6px; border: 1px dashed var(--pix-border);">
            <div style="font-weight: bold; color: var(--pix-cyan); margin-bottom: 4px;">{m.endModRightEndTitle()}</div>
            <div style="display: flex; gap: 4px; align-items: center; margin-bottom: 4px;">
              <span class="pix-dim" style="width: 50px;">{m.endModTypeLabel()}</span>
              <select bind:value={endModRightType} class="pix-select" style="flex: 1; padding: 2px 4px; font-size: 9px; height: 20px;">
                <option value="blunt">{m.endModBlunt()}</option>
                <option value="5-overhang">{m.endMod5Overhang()}</option>
                <option value="3-overhang">{m.endMod3Overhang()}</option>
              </select>
            </div>
            {#if endModRightType !== 'blunt'}
              <div style="display: flex; gap: 4px; align-items: center; margin-bottom: 4px;">
                <span class="pix-dim" style="width: 50px;">{m.endModSeqLabel()}</span>
                <input class="pix-input" type="text" bind:value={endModRightSeq} placeholder={m.endModSeqPlaceholder()} style="flex: 1; padding: 2px 4px; font-size: 9px; font-family: monospace;" />
              </div>
            {/if}
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="checkbox" id="rightPhos" bind:checked={endModRightPhos} style="cursor: pointer;" />
              <label for="rightPhos" style="cursor: pointer; font-size: 9px;">{m.endModPhosLabel()}</label>
            </div>
          </div>

        </div>

        <!-- Buttons Grid -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px;">
          <button class="pix-btn ok" onclick={() => runEndModification('fillIn')} style="padding: 3px; font-size: 9.5px;" title={m.endModFillInTitle()}>
            {m.endModFillInBtn()}
          </button>
          <button class="pix-btn ok" onclick={() => runEndModification('chewBack')} style="padding: 3px; font-size: 9.5px;" title={m.endModChewBackTitle()}>
            {m.endModChewBackBtn()}
          </button>
          <button class="pix-btn ok" onclick={() => runEndModification('phosphorylate')} style="padding: 3px; font-size: 9.5px; background: var(--pix-blue);" title={m.endModPhosTitle()}>
            {m.endModPhosBtn()}
          </button>
          <button class="pix-btn ok" onclick={() => runEndModification('dephosphorylate')} style="padding: 3px; font-size: 9.5px; background: var(--pix-yellow);" title={m.endModDephosTitle()}>
            {m.endModDephosBtn()}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ============ GC SLIDING WINDOW PANEL ============ -->
  {#if showGcWindow}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 690px; top: 120px; width: 320px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Activity size={12} /> {m.gcWindowPanelTitle()}</span>
        <button class="pix-btn-reset" onclick={() => showGcWindow = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <button class="pix-btn ok" onclick={() => runGcWindow()} style="padding: 3px; font-size: 10px;">{m.recalcBtn()}</button>
        {#if gcWindowResult.length > 0}
          {#if true}
          {@const maxGc = Math.max(...gcWindowResult.map(p => p.gc))}
          {@const minGc = Math.min(...gcWindowResult.map(p => p.gc))}
          {@const avgGc = gcWindowResult.reduce((s, p) => s + p.gc, 0) / gcWindowResult.length}
          <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.gcAvgLabel()}</span><span class="pix-num">{avgGc.toFixed(1)}%</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.gcRangeLabel()}</span><span class="pix-num">{minGc.toFixed(1)}% - {maxGc.toFixed(1)}%</span></div>
          <svg viewBox="0 0 300 80" style="width: 100%; height: 80px; background: #040508; border-radius: 3px;" preserveAspectRatio="none">
            <line x1="0" y1="40" x2="300" y2="40" stroke="rgba(255,255,255,0.1)" stroke-width="0.5" stroke-dasharray="2,2" />
            {#if gcWindowResult.length > 1}
              {@const range = maxGc - minGc || 1}
              {@const points = gcWindowResult.map((p, i) => {
                const x = (i / (gcWindowResult.length - 1)) * 300;
                const y = 75 - ((p.gc - minGc) / range) * 70;
                return x.toFixed(1) + ',' + y.toFixed(1);
              }).join(' ')}
              <polyline points={points} fill="none" stroke="var(--pix-cyan)" stroke-width="1.5" />
            {/if}
          </svg>
          {/if}
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ FUSION READING FRAME CHECK PANEL ============ -->
  {#if showFusionCheckPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 690px; top: 250px; width: 320px; z-index: 60;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><GitMerge size={12} /> {m.fusionPanelTitle()}</span>
        <button class="pix-btn-reset" onclick={() => showFusionCheckPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <div style="display: flex; gap: 8px;">
          <div style="flex: 1;">
            <span class="pix-dim" style="font-size: 9px;">{m.fusionFeat1StartLabel()}</span>
            <input class="pix-input" type="number" bind:value={fusionFeat1Start} style="width: 100%; padding: 2px 4px; font-size: 9px;" />
          </div>
          <div style="flex: 1;">
            <span class="pix-dim" style="font-size: 9px;">{m.fusionFeat1EndLabel()}</span>
            <input class="pix-input" type="number" bind:value={fusionFeat1End} style="width: 100%; padding: 2px 4px; font-size: 9px;" />
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <div style="flex: 1;">
            <span class="pix-dim" style="font-size: 9px;">{m.fusionFeat2StartLabel()}</span>
            <input class="pix-input" type="number" bind:value={fusionFeat2Start} style="width: 100%; padding: 2px 4px; font-size: 9px;" />
          </div>
          <div style="flex: 1;">
            <span class="pix-dim" style="font-size: 9px;">{m.fusionFeat2EndLabel()}</span>
            <input class="pix-input" type="number" bind:value={fusionFeat2End} style="width: 100%; padding: 2px 4px; font-size: 9px;" />
          </div>
        </div>
        <button class="pix-btn ok" onclick={() => runFusionCheck()} style="padding: 3px; font-size: 10px;">{m.fusionCheckBtn()}</button>
        {#if fusionResult}
          <div class="pix-panel" style="padding: 4px; border-color: {fusionResult.inFrame ? 'var(--pix-green)' : 'var(--pix-red)'};">
            <div style="display: flex; justify-content: space-between;">
              <span class="pix-dim">{m.fusionFrameLabel()}</span>
              <span class="pix-num" style="color: {fusionResult.inFrame ? 'var(--pix-green)' : 'var(--pix-red)'};">{fusionResult.inFrame ? m.fusionInFrameText() : m.fusionFrameshiftText()}</span>
            </div>
            <div style="display: flex; justify-content: space-between;"><span class="pix-dim">{m.fusionOffsetLabel()}</span><span class="pix-num">{fusionResult.frameOffset} bp</span></div>
            <div class="mono" style="font-size: 8px; color: var(--pix-cyan); word-break: break-all; background: #040508; padding: 4px; border-radius: 3px; margin-top: 4px;">{fusionResult.junctionSequence}</div>
            <div class="mono" style="font-size: 8px; color: var(--pix-accent-2); word-break: break-all; margin-top: 2px;">{fusionResult.junctionTranslation}</div>
            {#if fusionResult.warnings.length > 0}
              <div style="font-size: 8px; color: var(--pix-red); margin-top: 2px;">{fusionResult.warnings.join('; ')}</div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ RIBOSOMAL SLIPPAGE PANEL ============ -->
  {#if showSlippagePanel}
    <RibosomalSlippagePanel
      bind:showSlippagePanel
      {drag}
      {dnaSeq}
      {plasmidName}
      bind:geneFeatures
      {pushLog}
      {pushToast}
    />
  {/if}

  <!-- ============ SEQUENCE EVOLUTION & BLAST PANEL ============ -->
  {#if showSeqAnalysisPanel}
    <SequenceEvolutionPanel
      bind:showSeqAnalysisPanel
      {drag}
      {collectionsList}
      {plasmidName}
      {dnaSeq}
      {pushLog}
      {pushToast}
    />
  {/if}

  <!-- ============ ADVANCED GENOMICS TOOLS PANEL ============ -->
  {#if showGenomicsTools}
    <AdvancedGenomicsPanel
      bind:showGenomicsTools
      {drag}
      {dnaSeq}
      bind:geneFeatures
      {pushLog}
      {pushToast}
    />
  {/if}

  <!-- ============ SYNTHETIC BIOLOGY CAD PANEL ============ -->
  {#if showSynBioTools}
    <SyntheticBiologyCadPanel
      bind:showSynBioTools
      {drag}
      {plasmidName}
      {dnaSeq}
      {geneFeatures}
      {pushLog}
      {pushToast}
    />
  {/if}

  <!-- ============ PRIMER LIMS-LITE INVENTORY PANEL ============ -->
  {#if showPrimersLimsPanel}
    <PrimerLimsPanel
      bind:showPrimersLimsPanel
      {drag}
      bind:primerInventory
      {dnaSeq}
      {pushLog}
      {pushToast}
    />
  {/if}

  <!-- ============ REACTION CALCULATORS PANEL ============ -->
  {#if showCalculatorsPanel}
    <ReactionCalculators
      bind:showCalculatorsPanel
      {drag}
    />
  {/if}

  <!-- ============ ENZYME (RESTRICTION) SELECTOR ============ -->
  {#if showEnzymeSelector}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 60px; width: 360px; z-index: 62; max-height: 540px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><Scissors size={12} /> {m.menuCloneEnzymes()}</span>
        <button class="pix-btn-reset" onclick={() => showEnzymeSelector = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto;">
        <EnzymeSelector {restrictionSites} bind:selectedEnzymes {enzymeDatabase} />
      </div>
    </div>
  {/if}

  <!-- ============ CODON OPTIMIZER ============ -->
  {#if showCodonOptimizer}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 120px; width: 372px; z-index: 62; max-height: 540px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><Dna size={12} /> {m.menuCloneCodon()}</span>
        <button class="pix-btn-reset" onclick={() => showCodonOptimizer = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto;">
        <CodonOptimizer bind:dnaSeq {codonHost} {translatedProtein} onOptimizeLog={(msg: string) => pushLog(msg)} />
      </div>
    </div>
  {/if}

  <!-- ============ PRIMER TABLE / DESIGNER ============ -->
  {#if showPrimerTable}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 130px; width: 340px; z-index: 62; max-height: 520px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><AlignLeft size={12} /> {m.menuClonePrimers()}</span>
        <button class="pix-btn-reset" onclick={() => showPrimerTable = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto;">
        <PrimerTable {pcrPrimers} />
      </div>
    </div>
  {/if}

  <!-- ============ VIRTUAL GEL ============ -->
  {#if showVirtualGel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 40px; top: 60px; width: 380px; z-index: 62; max-height: 540px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><Layers size={12} /> {m.menuCloneGel()}</span>
        <button class="pix-btn-reset" onclick={() => showVirtualGel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto;">
        <VirtualGel fragments={[]} {plasmidName} bind:lanes={gelLanes} />
      </div>
    </div>
  {/if}

  <!-- ============ CRISPR DESIGNER ============ -->
  {#if showCrisprDesigner}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 100px; width: 400px; z-index: 63; max-height: 560px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-cyan); font-size: 10.5px;"><Sparkles size={12} /> {m.menuCloneCrispr()}</span>
        <button class="pix-btn-reset" onclick={() => showCrisprDesigner = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto;">
        <CrisprDesigner bind:dnaSeq onApplyLog={(msg: string) => pushLog(msg)} />
      </div>
    </div>
  {/if}

  <!-- ============ CLONING SIMULATOR WIZARD (MODAL) ============ -->
  {#if showCloningModal}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 660px; z-index: 90; max-height: 84%; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 11px;"><Sparkles size={12} /> {m.menuCloneWizard()}</span>
        <button class="pix-btn-reset" onclick={() => showCloningModal = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto;">
        <CloningSimulator vectorSeq={dnaSeq} vectorName={plasmidName} onCloneSuccess={handleCloneSuccess} />
      </div>
    </div>
  {/if}

  <!-- ============ CLONING VALIDATOR ============ -->
  {#if showCloningValidator}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 120px; width: 380px; z-index: 62; max-height: 560px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-green); font-size: 10.5px;"><Check size={12} /> {m.menuViewSangerValidator()}</span>
        <button class="pix-btn-reset" onclick={() => showCloningValidator = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto;">
        <CloningValidator referenceSeq={dnaSeq} referenceFeatures={geneFeatures} onValidationLog={(msg: string) => pushLog(msg)} />
      </div>
    </div>
  {/if}

  <!-- ============ SANGER CHROMATOGRAM VIEWER ============ -->
  {#if showSangerPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 40px; top: 70px; width: 384px; z-index: 62; max-height: 540px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><Activity size={12} /> {m.menuViewSangerTrace()}</span>
        <button class="pix-btn-reset" onclick={() => showSangerPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: flex-end;">
          <button class="pix-btn ok" onclick={() => sangerFileInput?.click()} style="padding: 2px 8px; font-size: 9px;">{m.sangerImportBtn()}</button>
        </div>
        {#if sangerTraces.length === 0}
          <div class="pix-dim" style="padding: 10px; font-size: 10px; text-align: center;">{m.sangerNoTrace()}</div>
        {:else}
          {#each sangerTraces as t, i (i)}
            {#if t.validation}
              <div class="pix-dim" style="font-size: 9px;">{m.sangerIdentityVsRef()}: {(t.validation.identity * 100).toFixed(1)}% · {m.sangerMismatches()}: {t.validation.mismatches}</div>
            {/if}
            <SangerChromatogram trace={t.trace ?? t} />
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ PROTEIN VIEW CABIN ============ -->
  {#if showProteinView}
    <ProteinViewPanel bind:showProteinView {drag} bind:dnaSeq bind:selectionStart bind:selectionEnd {pushLog} {pushToast} />
  {/if}

  <!-- ============ PCR SIMULATION PANEL ============ -->
  {#if showPcrPanel}
    <PcrSimulationPanel bind:showPcrPanel {drag} bind:dnaSeq {linear} bind:gelLanes bind:showVirtualGel {pushLog} {pushToast} {pushHistory} />
  {/if}

  <!-- ============ NGS GENOMICS PANEL ============ -->
  {#if showNgsGenomicsPanel}
    <NgsGenomicsPanel bind:showNgsGenomicsPanel {drag} {dnaSeq} {pushLog} {pushToast} />
  {/if}

  <!-- ============ CLONING EXTENSION PANEL ============ -->
  {#if showCloningExtensionPanel}
    <CloningExtensionPanel bind:showCloningExtensionPanel {drag} bind:dnaSeq {pushLog} {pushToast} />
  {/if}

  <!-- ============ CODESIGN PARETO PANEL ============ -->
  {#if showCodesignPanel}
    <CodesignParetoPanel bind:showCodesignPanel {drag} {plasmidName} bind:dnaSeq features={geneFeatures} {codonHost} {pushLog} {pushToast} />
  {/if}

  <!-- ============ SYNTHETIC GENE QC PANEL ============ -->
  {#if showSyntheticGeneQc}
    <SyntheticGeneQc bind:dnaSeq {geneFeatures} {pushLog} {pushToast} bind:showSyntheticGeneQc />
  {/if}

  <!-- ============ NCBI IMPORT PANEL ============ -->
  {#if showNcbiPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 50%; top: 120px; transform: translateX(-50%); width: 360px; z-index: 72; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><Globe size={12} /> {m.menuFileNcbi()}</span>
        <button class="pix-btn-reset" onclick={() => showNcbiPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <input class="pix-input" type="text" bind:value={ncbiQuery} placeholder={m.ncbiQueryPlaceholder()} onkeydown={(e) => { if (e.key === 'Enter') importFromNcbi(); }} style="width: 100%; padding: 3px 5px; font-size: 10px;" />
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="pix-dim" style="width: 42px; flex: 0 0 auto;">{m.speciesLabel()}</span>
          <select class="pix-select" bind:value={ncbiOrganism} style="flex: 1; padding: 2px 4px; font-size: 10px; height: 24px;">
            {#each NCBI_ORGANISMS as o}
              <option value={o.v}>{o.label}</option>
            {/each}
          </select>
        </div>
        <div class="pix-dim" style="font-size: 8px;">{m.ncbiAccessionTip()}</div>
        <button class="pix-btn ok" disabled={ncbiLoading} onclick={() => importFromNcbi()} style="padding: 3px; font-size: 10px;">{ncbiLoading ? m.searchingEllipsis() : m.importSequenceBtn()}</button>
      </div>
    </div>
  {/if}

  <!-- ============ ENSEMBL IMPORT PANEL ============ -->
  {#if showEnsemblPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 50%; top: 200px; transform: translateX(-50%); width: 360px; z-index: 72; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><Globe size={12} /> {m.menuFileEnsembl()}</span>
        <button class="pix-btn-reset" onclick={() => showEnsemblPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <input class="pix-input" type="text" bind:value={ensemblQuery} placeholder={m.ensemblQueryPlaceholder()} onkeydown={(e) => { if (e.key === 'Enter') importFromEnsembl(); }} style="width: 100%; padding: 3px 5px; font-size: 10px;" />
        <button class="pix-btn ok" disabled={ensemblLoading} onclick={() => importFromEnsembl()} style="padding: 3px; font-size: 10px;">{ensemblLoading ? m.searchingEllipsis() : m.importSequenceBtn()}</button>
      </div>
    </div>
  {/if}

  <!-- ============ EXPORT MODAL ============ -->
  {#if showExportModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-overlay" onclick={() => showExportModal = false}>
      <div class="modal-box pix-panel" style="width: 340px;" onclick={(e) => e.stopPropagation()}>
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 8px; margin-bottom: 10px;">
          <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 12px;"><Download size={13} /> {m.menuFileExport()}</span>
          <button class="pix-btn-reset" onclick={() => showExportModal = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <button class="pix-btn" onclick={() => exportSequence('spiceg')} style="padding: 6px; font-size: 11px; text-align: left;">{m.exportFmtSpiceg()}</button>
          <button class="pix-btn" onclick={() => exportSequence('genbank')} style="padding: 6px; font-size: 11px; text-align: left;">{m.exportFmtGenbank()}</button>
          <button class="pix-btn" onclick={() => exportSequence('fasta')} style="padding: 6px; font-size: 11px; text-align: left;">{m.exportFmtFasta()}</button>
          <button class="pix-btn" onclick={() => exportSequence('embl')} style="padding: 6px; font-size: 11px; text-align: left;">{m.exportFmtEmbl()}</button>
          <button class="pix-btn ok" onclick={() => saveProjectAsSpiceg()} style="padding: 6px; font-size: 11px; text-align: left;">{m.saveProjectFileBtn()}</button>
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
          <button class="pix-btn" onclick={() => showExportModal = false} style="padding: 4px 14px; font-size: 10px;">{m.elnFinishClose()}</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ============ HISTORY (UNDO/REDO) PANEL ============ -->
  {#if showHistoryPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 60px; width: 320px; z-index: 71; max-height: 540px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><History size={12} /> {m.menuWinHistory()}</span>
        <button class="pix-btn-reset" onclick={() => showHistoryPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;">
        {#if histMgr.getAll().length === 0}
          <div class="pix-dim" style="padding: 8px; font-size: 10px; text-align: center;">{m.noHistoryYet()}</div>
        {:else}
          {#each histMgr.getAll() as s, i (i)}
            <button class="pix-btn {i === selectedHistoryIdx ? 'ok' : ''}" onclick={() => selectHistoryStep(i)} style="width: 100%; text-align: left; padding: 3px 6px; font-size: 9.5px;">
              {i + 1}. {s.label} <span class="pix-dim" style="font-size: 8px;">[{s.operationType}]</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ CONSOLE LOG PANEL ============ -->
  {#if showLogger}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 10px; bottom: 10px; width: 360px; height: 240px; z-index: 71; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-green); font-size: 10.5px;"><Terminal size={12} /> {m.menuWinLogger()}</span>
        <button class="pix-btn-reset" onclick={() => showLogger = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div class="log" style="flex: 1; overflow-y: auto; font-family: var(--pix-font-mono, monospace); font-size: 9px; line-height: 1.35;">
        {#if log.length === 0}
          <div class="pix-dim">{m.noLogOutput()}</div>
        {:else}
          {#each [...log].reverse() as line, i (i)}
            <div class="log-line info">{line}</div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ VIEW SETTINGS PANEL ============ -->
  {#if showSettingsPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 60px; width: 300px; z-index: 71; max-height: 540px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><Settings size={12} /> {m.menuWinSettings()}</span>
        <button class="pix-btn-reset" onclick={() => showSettingsPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; font-size: 10px;">
        <div style="display: flex; gap: 4px; align-items: center;">
          <span class="pix-dim" style="width: 64px;">{m.viewTopologyLabel()}:</span>
          <button class="pix-btn {activeTab === 'circular' ? 'ok' : ''}" onclick={() => activeTab = 'circular'} style="flex: 1; padding: 2px; font-size: 9px;">{m.viewCircularBtn()}</button>
          <button class="pix-btn {activeTab === 'linear' ? 'ok' : ''}" onclick={() => activeTab = 'linear'} style="flex: 1; padding: 2px; font-size: 9px;">{m.topologyLinear()}</button>
        </div>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={showFeatures} /> {m.viewShowFeatures()}</label>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={showCutsites} /> {m.viewShowCutSites()}</label>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={showOrfs} /> {m.viewShowOrfs()}</label>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={showTranslations} /> {m.viewShowTranslations()}</label>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={showSingleStrand} /> {m.viewSingleStrand()}</label>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={showPrimersOnMap} /> {m.viewPrimersOnMap()}</label>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={showGcWindow} /> {m.viewGcSlidingWindow()}</label>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="pix-dim" style="width: 64px;">{m.viewBackground()}:</span>
          <input class="pix-input" type="color" bind:value={bgColor} style="width: 48px; height: 24px; border: 1px solid var(--pix-border); background: none; cursor: pointer;" />
        </div>
        <div style="border-top: 1px dashed var(--pix-border); margin: 4px 0;"></div>
        <div class="pix-dim" style="font-weight: bold;">{m.viewAutoAnnotateDb()}</div>
        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" bind:checked={useUnevec} /> {m.viewUseUnevec()}</label>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span class="pix-dim" style="width: 64px;">{m.viewMatcher()}:</span>
          <select class="pix-select" bind:value={annAlgorithm} style="flex: 1; padding: 2px 4px; font-size: 10px; height: 24px;">
            <option value="kmer">{m.viewMatcherKmer()}</option>
            <option value="sw">{m.viewMatcherSw()}</option>
            <option value="exact">{m.viewMatcherExact()}</option>
          </select>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; justify-content: space-between;">
          <span class="pix-dim" style="font-size: 9px;">UniVec: {unevecDb.length}{m.unitEntries()}{annDbSyncing ? m.syncingSuffix() : ''}</span>
          <button class="pix-btn" onclick={resyncUnevec} disabled={annDbSyncing} style="padding: 2px 8px; font-size: 9px;">{m.resyncBtn()}</button>
        </div>
        <button class="pix-btn ok" onclick={runAutoAnnotate} disabled={annBusy} style="padding: 3px; font-size: 10px;">{annBusy ? m.annotatingEllipsis() : m.runAutoAnnotateBtn()}</button>
      </div>
    </div>
  {/if}

  <!-- ============ RNA SECONDARY STRUCTURE PANEL ============ -->
  {#if showRnaStructure}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 40px; top: 60px; width: 380px; z-index: 70; max-height: 480px; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-cyan); font-size: 10.5px;"><Spline size={12} /> {m.menuViewRna()}</span>
        <button class="pix-btn-reset" onclick={() => showRnaStructure = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow-y: auto; font-size: 10px; display: flex; flex-direction: column; gap: 6px;">
        {#if isRnaLoading}
          <div class="pix-dim">{m.computingStructure()}</div>
        {:else if rnaResult}
          <div class="mono" style="word-break: break-all; font-size: 10px; color: var(--pix-cyan); background: #0c0800; padding: 5px; border-radius: 3px; border: 1px solid var(--pix-border);">{rnaResult.structure ?? rnaResult.dotBracket ?? rnaResult.mfe ?? '—'}</div>
          {#if typeof rnaResult.mfe === 'number'}<div class="pix-dim">ΔG = {rnaResult.mfe.toFixed(2)} kcal/mol</div>{/if}
          {#if rnaResult.length}<div class="pix-dim">{m.modelLength()}: {rnaResult.length} nt</div>{/if}
        {:else}
          <div class="pix-dim">{m.noStructureData()}</div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ============ MULTIPLE ALIGNMENT VIEWER ============ -->
  {#if showAlignmentPanel}
    <div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 10px; top: 60px; width: 460px; z-index: 71; max-height: 80%; display: flex; flex-direction: column;">
      <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;"><AlignLeft size={12} /> {m.menuViewAlignment()}</span>
        <button class="pix-btn-reset" onclick={() => showAlignmentPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
      </div>
      <div style="flex: 1; overflow: auto; font-size: 10px;">
        {#if alignmentMultiResult}
          <div class="pix-dim" style="font-size: 9px; margin-bottom: 4px;">{m.alignmentWidthLabel()}: {alignmentMultiResult.width} · {m.identity()}: {((alignmentMultiResult.identity ?? 0) * 100).toFixed(1)}%</div>
          <div class="mono" style="overflow-x: auto; white-space: pre; font-size: 9px; line-height: 1.35;">
            {#each (alignmentMultiResult.rows ?? []) as r, i (i)}
              <div><span style="color: var(--pix-cyan); display: inline-block; width: 84px;">{(r.name ?? r.id ?? ('Seq' + (i + 1))).toString().slice(0, 12)}</span>{r.alignedSeq ?? r.seq ?? ''}</div>
            {/each}
            {#if alignmentMultiResult.consensus}
              <div style="color: var(--pix-green);"><span style="display: inline-block; width: 84px;">{m.consensusLabel()}</span>{alignmentMultiResult.consensus}</div>
            {/if}
          </div>
        {:else}
          <div class="pix-dim">{m.noAlignmentImported()}</div>
        {/if}
      </div>
    </div>
  {/if}

  <Toaster />
</div>

<style>
  .ove-resizer {
    flex: 0 0 7px;
    cursor: col-resize;
    background: var(--pix-border);
    border-left: 1px solid var(--pix-border);
    border-right: 1px solid var(--pix-border);
    position: relative;
    z-index: 5;
    user-select: none;
    touch-action: none;
  }
  .ove-resizer::after {
    content: '';
    position: absolute;
    left: 2px; right: 2px; top: 50%;
    height: 26px; margin-top: -13px;
    background: repeating-linear-gradient(180deg, var(--pix-fg-dim) 0 2px, transparent 2px 5px);
    opacity: 0.5;
  }
  .ove-resizer:hover::after, .ove-resizer:focus-visible::after { opacity: 1; }
  .ove-resizer:hover, .ove-resizer:focus-visible { background: var(--pix-accent-2); outline: none; }
  .pix-select {
    font-family: var(--pix-font);
    font-size: 11px;
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    border: 2px solid var(--pix-border-hi);
    padding: 1px 4px;
    box-sizing: border-box;
    cursor: pointer;
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.5);
    height: 22px;
  }
  .pix-select:focus {
    outline: none;
    border-color: var(--pix-accent);
  }

  /* Dropdown Menu Styles */
  .menu-item-container {
    position: relative;
    display: inline-block;
  }
  .menu-trigger {
    background: none;
    border: none;
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 11px;
    font-weight: bold;
    padding: 4px 10px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: 1px solid transparent;
  }
  .menu-trigger:hover, .menu-item-container:hover .menu-trigger {
    background: var(--pix-bg-2);
    border-color: var(--pix-border);
    color: var(--pix-accent-2);
  }
  .menu-dropdown {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 260px;
    background: var(--pix-panel);
    border: 2px solid var(--pix-border-hi);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.75);
    z-index: 1000;
    padding: 4px 0;
  }
  .menu-item-container:hover .menu-dropdown {
    display: flex;
    flex-direction: column;
  }
  .menu-action-btn {
    background: none;
    border: none;
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 10.5px;
    text-align: left;
    padding: 6px 12px;
    cursor: pointer;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .menu-action-btn:hover {
    background: var(--pix-accent);
    color: #1a0f00 !important;
  }
  .menu-action-btn.active {
    color: var(--pix-green);
    font-weight: bold;
  }
  .menu-action-btn.active:hover {
    color: #1a0f00;
  }
  .menu-action-btn:disabled {
    color: var(--pix-fg-dim);
    opacity: 0.4;
    cursor: not-allowed;
  }
  .menu-action-btn:disabled:hover {
    background: none;
    color: var(--pix-fg-dim) !important;
  }
  .menu-divider {
    height: 2px;
    background: var(--pix-border);
    margin: 4px 0;
  }

  /* OVE-style view tabs */
  .ove-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .ove-tab:hover { color: #fff; background: rgba(255,255,255,0.03); }
  .ove-tab.active {
    color: var(--pix-cyan);
    border-bottom-color: var(--pix-cyan);
    background: rgba(76, 214, 255, 0.08);
    font-weight: bold;
  }

  .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; font-size: 11px; }
  .log { font-size: 10px; overflow-y: auto; }
  .log-line { white-space: nowrap; }
  .log-line.good { color: var(--pix-green); text-shadow: 0 0 2px rgba(83, 215, 105, 0.4); }
  .log-line.bad { color: var(--pix-red); text-shadow: 0 0 2px rgba(255, 93, 93, 0.4); }
  .log-line.info { color: var(--pix-cyan); text-shadow: 0 0 2px rgba(76, 214, 255, 0.4); }
  .log-line.warn { color: var(--pix-accent); text-shadow: 0 0 2px rgba(255, 159, 28, 0.4); }

  /* Dropzone styles */
  .pdb-dropzone {
    position: relative;
    width: 100%;
    margin-top: 4px;
    margin-bottom: 4px;
  }
  .drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(16, 20, 31, 0.95);
    border: 2px dashed var(--pix-accent-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 5;
    pointer-events: none;
    text-transform: uppercase;
    letter-spacing: 1px;
    image-rendering: pixelated;
  }

  /* Modal Dialog styles */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
  }
  .modal-box {
    background: #0b0f19;
    border: 3px solid var(--pix-border);
    padding: 14px;
    width: 780px;
    max-width: 90%;
    max-height: 90%;
    overflow-y: auto;
    border-radius: 4px;
    box-shadow: 0 0 25px rgba(0, 0, 0, 0.95);
  }

  /* Dock Panels */
  .floating-panel {
    background: rgba(11, 15, 25, 0.94);
    border: 2px solid var(--pix-border);
    padding: 8px 12px;
    border-radius: 4px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(4px);
    overflow: hidden;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  :global(.spin) { animation: spin 1s linear infinite; }

  .pix-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
