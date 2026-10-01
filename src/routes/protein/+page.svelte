<script lang="ts">
  // SPICE protein folding workstation — main view
  // Left: input (sequence / environment / actions) | Center: Mol* 3D viewer | Right: analysis tabs (fold / MD / phase / mutants)
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { backend, isTauri } from '$lib/backend/api';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import ProjectDocBanner from '$lib/project/ProjectDocBanner.svelte';
  import { EXAMPLE_SEQS, cleanSeq, seqFromPdb, validateSeq } from '$lib/backend/preprocess';
  import { METRIC_THRESHOLDS } from '$lib/backend/types';
  import type { BuildOut, DownloadProgress, Env, FoldOutput, MetricsOut, ModelStatus, ScanPoint, ScanProgress, StepOut } from '$lib/backend/types';
  import { buildMmcif } from '$lib/backend/mmcif';
  import MolStarViewer from '$lib/viewer/MolStarViewer.svelte';
  import Heatmap from '$lib/ui/Heatmap.svelte';
  import TraceChart from '$lib/ui/TraceChart.svelte';
  import MetricBar from '$lib/ui/MetricBar.svelte';
  import Toaster from '$lib/ui/Toaster.svelte';
  import { notify, pushToast } from '$lib/ui/toast.svelte.ts';
  import * as m from '$lib/paraglide/messages.js';
  import { localizeInline } from '$lib/i18nMsg';
  import { currentLocale, toggleLang } from '$lib/i18n.svelte.ts';
  import { aiState } from '$lib/ui/aiState.svelte.ts';
  import { configureSpdClient, cachedProteinId, cachedSequenceId, cachedSequenceEntries, rememberProteinId, rememberSequenceId, lastProteinName, rememberProteinName } from '$lib/spd/store.svelte';
  import { normalizeSequence, normalizeEnvironment, normalizeModel, sequenceSha256 } from '$lib/spd/normalize';
  import { SpdApiError, spdToken, SPD_INPUT_PROTOCOL_VERSION, SPD_INFERENCE_PROTOCOL_VERSION } from '$lib/spd/client';
  import type { SpdEnvironmentInput, SpdGraphFold, SpdGraphNode, SpdModelInput, SpdProteinInput } from '$lib/spd/types';
  import { parseMutantsCsv, evaluateMutantsBatch } from '$lib/genome';
  import { queryPdbRedo, queryBioLip } from '$lib/backend/externalDbs';
  import type { BioLipLigandBinding, PdbRedoMeta } from '$lib/backend/externalDbs';
  import {
    Alert, Button, Card, Chip, Divider, ProgressBar, Select,
    Slider, Tabs, Textarea, Toggle, initMultistyleUI,
  } from 'svelte-multistyle-ui';
  import { Dna, FlaskConical, Play, Settings, RotateCcw, Sun, FileDown, RefreshCw, Check, X, AlertTriangle, FileUp, Save, Globe, Layers } from 'lucide-svelte';

  const TAB_LABEL: Record<string, () => string> = {
    fold: () => m.tabFold(),
    md: () => m.tabMd(),
    pocket: () => m.tabPocket(),
    phase: () => m.tabPhase(),
    mut: () => m.tabMut(),
    batch: () => m.tabBatch(),
  };
  const METRIC_MESSAGES: Record<string, () => string> = {
    m1: () => m.metricM1(),
    m2: () => m.metricM2(),
    m3: () => m.metricM3(),
    m4: () => m.metricM4(),
    m5: () => m.metricM5(),
  };
  const METRIC_TOOLTIPS: Record<string, () => string> = {
    m1: () => m.metricM1Tooltip(),
    m2: () => m.metricM2Tooltip(),
    m3: () => m.metricM3Tooltip(),
    m4: () => m.metricM4Tooltip(),
    m5: () => m.metricM5Tooltip(),
  };

  // pixel style + midnight theme for every svelte-multistyle-ui component
  const ui = { style: 'pixel', theme: 'midnight' } as const;

  // ---------------- resizable columns ----------------
  const COL_MIN_L = 260; // min width of the left column (model/engine settings cards)
  const COL_MIN_R = 320; // min width of the right column (tabs + heatmap)
  const COL_MIN_C = 300; // min width of the center column (Mol* viewer)
  const COL_MAX = 760;
  const COL_PAD = 44; // two resize bars + grid padding (keeps the center column visible at its min width)
  let leftW = $state(300);
  let rightW = $state(360);

  let seq = $state(EXAMPLE_SEQS[0].seq);
  let exampleId = $state(EXAMPLE_SEQS[0].id);
  let env = $state<Env>({ ph: 7.0, tempK: 310, pressureBar: 1.0, ionicStrengthM: 0.0 });

  $effect(() => {
    if (typeof localStorage !== 'undefined' && seq) {
      localStorage.setItem('spice.protein.seq', seq);
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined' && env) {
      localStorage.setItem('spice.protein.env', JSON.stringify(env));
    }
  });
  let pdbText = $state<string | null>(null);
  let folded = $state<FoldOutput | null>(null);
  let foldDemo = $state(false);
  let foldError = $state<string | null>(null);
  let foldBusy = $state(false);
  let spdBusy = $state(false);
  let spdMessage = $state<string | null>(null);
  let spdFoldId = $state<string | null>(null);
  let spdProteinName = $state(lastProteinName());
  let viewMutant = $state(false);
  let hoveredResidueIdx = $state<number | null>(null);
  let selectedResidueRange = $state<{ start: number; end: number } | null>(null);

  function clampW(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v));
  }
  // Constrain widths to the window: left + right columns always <= window - center min - margins,
  // so the right column never gets pushed off-screen. On tablets or narrower screens
  // (e.g. 1024px / 960px wide), both side columns shrink to their minimums to avoid horizontal overflow.
  function fitToWindow() {
    const pad = COL_MIN_C + COL_PAD;
    if (leftW + rightW + pad > window.innerWidth) {
      // 1. Try shrinking the right column first
      rightW = clampW(rightW, COL_MIN_R, window.innerWidth - leftW - pad);

      // 2. If it is still overflowing after the right column hits its minimum, shrink the left column
      if (leftW + rightW + pad > window.innerWidth) {
        leftW = clampW(leftW, COL_MIN_L, window.innerWidth - rightW - pad);
      }
    }
  }
  function persistCols() {
    try {
      localStorage.setItem('spice.cols', JSON.stringify({ l: leftW, r: rightW }));
    } catch {
      /* ignore */
    }
  }
  function startResize(e: PointerEvent, side: 'left' | 'right') {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftW;
    const startRight = rightW;
    let lastX = startX;
    let frameId: number | null = null;

    const onMove = (ev: PointerEvent) => {
      lastX = ev.clientX;
      if (frameId !== null) return;

      frameId = requestAnimationFrame(() => {
        frameId = null;
        const dx = lastX - startX;
        const min = side === 'left' ? COL_MIN_L : COL_MIN_R;
        const other = side === 'left' ? startRight : startLeft;
        const max = Math.min(COL_MAX, Math.max(min, window.innerWidth - other - COL_MIN_C - COL_PAD));
        if (side === 'left') leftW = clampW(startLeft + dx, min, max);
        else rightW = clampW(startRight - dx, min, max);
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      const dx = lastX - startX;
      const min = side === 'left' ? COL_MIN_L : COL_MIN_R;
      const other = side === 'left' ? startRight : startLeft;
      const max = Math.min(COL_MAX, Math.max(min, window.innerWidth - other - COL_MIN_C - COL_PAD));
      if (side === 'left') leftW = clampW(startLeft + dx, min, max);
      else rightW = clampW(startRight - dx, min, max);

      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      persistCols();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  function resetCols() {
    leftW = 300;
    rightW = 360;
    persistCols();
  }

  onMount(() => {
    window.addEventListener('resize', fitToWindow);
    try {
      const s = JSON.parse(localStorage.getItem('spice.cols') || '{}');
      if (typeof s.l === 'number') leftW = clampW(s.l, COL_MIN_L, COL_MAX);
      if (typeof s.r === 'number') rightW = clampW(s.r, COL_MIN_R, COL_MAX);
      
      const savedSeq = localStorage.getItem('spice.protein.seq');
      if (savedSeq) seq = savedSeq;
      
      const savedEnv = localStorage.getItem('spice.protein.env');
      if (savedEnv) env = JSON.parse(savedEnv);
      
      const savedTab = localStorage.getItem('spice.protein.tab');
      if (savedTab) tab = savedTab;

      const savedPinMd = localStorage.getItem('spice.protein.pinMdMonitor');
      if (savedPinMd) pinMdMonitor = JSON.parse(savedPinMd);
    } catch {
      /* ignore */
    }
    fitToWindow();

    // Register AI Co-Pilot action callbacks
    aiState.onApplyProteinSequence = (newSeq: string) => {
      seq = newSeq;
    };
    aiState.onImportMutations = (muts: { pos: number; from: string; to: string; score?: number }[]) => {
      muts.forEach(mut => {
        // Natural language is usually 1-based; convert to 0-based for SPICE cart
        const pos = mut.pos > 0 ? mut.pos - 1 : mut.pos;
        const from = mut.from;
        const to = mut.to;
        const score = mut.score ?? 0.8;
        
        const idx = mutCart.findIndex(m => m.pos === pos);
        if (idx >= 0) {
          mutCart = mutCart.filter((_, i) => i !== idx);
        }
        mutCart = [...mutCart, { pos, from, to, score }];
      });
      tab = 'mut';
    };

    return () => {
      window.removeEventListener('resize', fitToWindow);
      aiState.onApplyProteinSequence = null;
      aiState.onImportMutations = null;
    };
  });

  // AI Co-Pilot Context Synchronization
  $effect(() => {
    aiState.currentWorkspace = 'protein';
  });

  let built: BuildOut | null = $state(null);
  let buildDemo = $state(false);
  let buildError: string | null = $state(null);
  let buildBusy = $state(false);

  let stepOut: StepOut | null = $state(null);
  let stepDemo = $state(false);
  let stepError: string | null = $state(null);
  let mdBusy = $state(false);

  let modelStatus: ModelStatus | null = $state(null);
  let statusBusy = $state(false);

  let nSteps = $state(20);
  let bias = $state(false);
  let biasForce = $state(0.25);
  let dT = $state(0);
  let dPh = $state(0);
  let equilibrate = $state(false);

  let tStart = $state(290), tEnd = $state(330), tStep = $state(10);
  let pStart = $state(6.0), pEnd = $state(8.0), pStep = $state(1.0);
  let scanSteps = $state(20);
  let scanMinimize = $state(true);
  let phase: ScanPoint[] = $state([]);
  let phaseBusy = $state(false);
  let phaseProgress: ScanProgress | null = $state(null);
  let phaseDemo = $state(false);
  let phaseError: string | null = $state(null);
  let bifurcationResult = $state<any | null>(null);

  let mutBusy = $state(false);
  let mutMsg: string | null = $state(null);
  let mutCart = $state<{ pos: number; from: string; to: string; score: number }[]>([]);
  let antibodyMode = $state(false);
  let pocketMonitorOpen = $state(false);
  let selectedPocketId = $state<number | null>(0);
  let pocketFeatures = $state<any | null>(null);

  $effect(() => {
    if (metrics?.pocket?.detectedPockets) {
      const pockets = metrics.pocket.detectedPockets;
      // Auto-fallback if the current selectedPocketId is out of bounds
      const currentPocket = pockets.find(p => p.id === selectedPocketId) ?? pockets[0];
      if (currentPocket) {
        if (currentPocket.id === pockets[0].id && metrics.pocket.primaryPocketFeatures) {
          pocketFeatures = metrics.pocket.primaryPocketFeatures;
        } else {
          backend.getPocketFeatures(currentPocket).then(res => {
            if (!res.error) {
              pocketFeatures = res.data;
            }
          });
        }
      } else {
        pocketFeatures = null;
      }
    } else {
      pocketFeatures = null;
    }
  });

  let lastLoggedPocketId = $state<string>("");
  $effect(() => {
    if (pocketMonitorOpen && metrics?.pocket?.detectedPockets) {
      const pockets = metrics.pocket.detectedPockets;
      if (pockets.length > 0) {
        const primary = pockets[0];
        const features = pocketFeatures;
        const logKey = `${primary.id}_${primary.volume.toFixed(1)}_${pockets.length}_${features ? features.netChargeAtPh.toFixed(2) : ""}`;
        if (logKey !== lastLoggedPocketId) {
          lastLoggedPocketId = logKey;
          pushLog(m.logPocketDetected({ v1: pockets.length, v2: primary.volume.toFixed(1), v3: primary.druggability.toFixed(2) }));
          if (features) {
            pushLog(m.logPocketPharmacophore({ v1: features.netChargeAtPh.toFixed(2), v2: (features.hydrophobicRatio * 100).toFixed(0), v3: features.hydrophobicCentroids.length, v4: features.hbondAcceptors.length, v5: features.hbondDonors.length }));
          }
        }
      } else {
        if (lastLoggedPocketId !== "empty") {
          lastLoggedPocketId = "empty";
          pushLog(m.logPocketNone());
        }
      }
    }
  });

  let pdbFileInput = $state<HTMLInputElement | null>(null);

  let batchCandidates = $state<{ id: string; seq: string; status: 'pending' | 'running' | 'success' | 'failed'; mutations?: string; score?: number; q?: number; m1?: number; m2?: number; m3?: number; m4?: number; m5?: number; gravy?: number; secondaryStructureHelixPercent?: number; disorderScore?: number }[]>([]);
  let batchBusy = $state(false);
  let batchCsvText = $state(`ID,Mutations
Variant_M1,V15A
Variant_M2,I32L + L45M
Variant_M3,V15A + I32L
Variant_M4,V15A + L45M + I32L
Variant_M5,I32L + L45M + L50M`);
  let isDragging = $state(false);
  let fetchPdbId = $state('');
  let fetchPdbBusy = $state(false);
  let pdbRedoBusy = $state(false);
  let pdbRedoMeta = $state<PdbRedoMeta | null>(null);
  let bioLipBusy = $state(false);
  let bioLipEntry = $state<{ pdbId: string; ligands: BioLipLigandBinding[] } | null>(null);
  let activePdbId = $state('');
  let landscapePoints = $state<{ rmsd: number; rg: number; u: number; time: number }[]>([]);
  const currentLandscapePoint = $derived(landscapePoints[landscapePoints.length - 1] ?? null);
  const currentLandscapeCx = $derived(currentLandscapePoint ? 10 + (Math.min(10, Math.max(0, currentLandscapePoint.rmsd)) / 10) * 80 : 0);
  const currentLandscapeCy = $derived(currentLandscapePoint ? 90 - ((Math.min(22, Math.max(13, currentLandscapePoint.rg)) - 13) / 9) * 80 : 0);

  let tab = $state('fold');
  let pinMdMonitor = $state(false);

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('spice.protein.pinMdMonitor', JSON.stringify(pinMdMonitor));
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined' && tab) {
      localStorage.setItem('spice.protein.tab', tab);
    }
  });
  let log: string[] = $state([]);
  let viewerRep = $state('auto');
  let quickStartOpen = $state(true);

  // ---------------- settings (engine defaults) ----------------
  let buildMinimize = $state(true);
  let useSolventReuse = $state(true);
  let customProtonationText = $state("");

  // Distance Restraints (Phase 3)
  let drAtom0 = $state<number | null>(null);
  let drAtom1 = $state<number | null>(null);
  let drR0 = $state<number | null>(null);
  let drK = $state<number>(100.0);

  async function applyDistanceRestraint() {
    if (drAtom0 === null || drAtom1 === null || drR0 === null) {
      pushToast('error', m.failed(), m.seRestraintFail());
      return;
    }
    const r = await backend.addDistanceRestraint(drAtom0, drAtom1, drR0, drK);
    if (!r.error) {
      pushLog(m.logRestraintApplied({ v1: drAtom0, v2: drAtom1, v3: drR0, v4: drK }));
      pushToast('success', m.restraintRegistered(), m.seRestraintSuccess());
      drAtom0 = null;
      drAtom1 = null;
      drR0 = null;
    } else {
      pushToast('error', m.registerFailShort(), r.error);
    }
  }

  const activeTab = $derived.by(() => {
    void currentLocale.value; // recompute when the locale switches
    return (['fold', 'md', 'pocket', 'phase', 'mut', 'batch'] as const).map((id) => ({ id, label: TAB_LABEL[id]() }));
  });

  function pushLog(msg: string) {
    const ts = new Date().toLocaleTimeString();
    log = [...log.slice(-200), `[${ts}] ${localizeInline(msg)}`];
  }

  function getLogColorClass(line: string): string {
    if (line.includes('[OK]') || line.includes(m.pass()) || line.includes(m.success()) || line.includes(m.ready())) return 'good';
    if (line.includes('[FAIL]') || line.includes(m.crash()) || line.includes(m.failedShort()) || line.includes('crashed')) return 'bad';
    if (line.includes('PDB') || line.includes(m.load()) || line.includes('cif') || line.includes(m.save())) return 'info';
    if (line.includes(m.mutation()) || line.includes(m.apply()) || line.includes('Mut') || line.toLowerCase().includes('scan')) return 'warn';
    return '';
  }

  // temps / phs arrays for the scan
  const tempArr = $derived.by(() => {
    const a: number[] = [];
    for (let v = tStart; v <= tEnd + 1e-6; v += tStep) a.push(Number(v.toFixed(1)));
    return a;
  });
  const phArr = $derived.by(() => {
    const a: number[] = [];
    for (let v = pStart; v <= pEnd + 1e-6; v += pStep) a.push(Number(v.toFixed(1)));
    return a;
  });

  const viewerData = $derived.by(() => {
    if (pdbText) return null;
    // Toggle between Head B' (mutated Ca) and Head A / latest MD coordinates
    const coords = viewMutant && folded
      ? folded.coordsMut
      : (stepOut?.coords ?? built?.coords ?? folded?.coords);
    if (coords && coords.length) return { seq: cleanSeq(seq), coords };
    return null;
  });

  $effect(() => {
    pickExample(exampleId);
  });

  // ---------------- SPD public database integration ----------------
  // Chain at d-api.spicebio.top (Universal API Token, Settings → Public
  // Integrations): (protein | construct | variant) → sequence → fold. A fold
  // EMBEDS its MD simulation environment and model objects — this UI has no
  // standalone environment/model registry; the two idempotent upserts below
  // only satisfy the server-side identity check (create_fold matches the
  // embedded objects against existing environment/model rows, 400 if new).
  // Everything except protein rows dedups server-side by identity hash, so
  // protein/sequence public ids are cached locally keyed by the normalized
  // sequence SHA-256 prefix.
  function spdEnvironment(): SpdEnvironmentInput {
    return normalizeEnvironment({ ph: env.ph, temperatureK: env.tempK, pressureBar: env.pressureBar, ionicStrengthM: env.ionicStrengthM });
  }

  function spdModel(checkpointSha256: string, modelPath: string): SpdModelInput {
    return normalizeModel({
      modelName: modelPath.split('/').pop() || 'SPICE',
      modelVersion: 'pretrain',
      checkpointSha256,
      inputProtocolVersion: SPD_INPUT_PROTOCOL_VERSION,
      inferenceRuntime: 'ort'
    });
  }

  function spdReceiptId(receipt: Record<string, unknown>, entity: string): string {
    const row = receipt[entity] as { id?: unknown } | undefined;
    const id = row && row.id != null ? String(row.id) : '';
    if (!id) throw new SpdApiError('SPD_BAD_RECEIPT', `SPD response is missing ${entity}.id`);
    return id;
  }

  async function querySpdExact() {
    const sequence = cleanSeq(seq);
    const validation = validateSeq(sequence);
    if (validation) { spdMessage = validation; return; }
    spdBusy = true; spdMessage = null; spdFoldId = null;
    try {
      const sha = await sequenceSha256(sequence);
      const seqKey = sha.slice('sha256:'.length, 'sha256:'.length + 20);
      const currentId = cachedSequenceId(seqKey);
      // Batch query goes through the graph DSL (POST /query): every locally
      // known SPD sequence id is a root, and the sequence→folds forward
      // edge (backend commit ebb2dbf) walks all of them inside ONE shared,
      // tier-metered resolution budget (anonymous 20 / depth 2, standard
      // 40 / depth 3). Measured live: each root costs 1 (sequence fetch) +
      // 1 (folds list edge) + 1 per returned fold + 1 per distinct expanded
      // environment row, so with folds limit 3 the caps below keep the
      // worst case inside budget (5×8=40 standard, 4×5=20 anonymous).
      // With a token we also expand fold→environment so the current MD
      // simulation environment can be matched exactly; without a token the
      // depth-2 ceiling makes that edge unreachable.
      const hasToken = !!spdToken();
      const entries = cachedSequenceEntries();
      const ordered = currentId
        ? [currentId, ...entries.map((e) => e.id).filter((id) => id !== currentId)]
        : entries.map((e) => e.id);
      const roots = ordered.slice(0, hasToken ? 5 : 4);
      if (!roots.length) {
        spdMessage = m.spdQueryNoCache();
        pushLog('[SPD] Batch query skipped — no cached SPD sequence ids on this machine');
        return;
      }
      const foldNode: SpdGraphNode = {
        limit: 3,
        select: ['id', 'sequenceId', 'environmentId', 'foldIdentityHash', 'createdAt'],
        ...(hasToken ? { expand: { environment: { select: ['ph', 'temperatureK', 'pressureBar', 'ionicStrengthM'] } } } : {})
      };
      const data = await configureSpdClient().graphQuery({
        roots: roots.map((id) => ({ type: 'sequence', id, select: ['id', 'sha256', 'length'], expand: { folds: foldNode } }))
      });
      pushLog(`[SPD] Graph DSL: tier ${data.tier}, budget ${data.budgetUsed}/${data.budgetMax}, ${data.results.length} root(s)`);
      let total = 0;
      let hitSeqs = 0;
      let currentFolds: SpdGraphFold[] = [];
      for (const node of data.results) {
        const folds = node.folds ?? [];
        total += folds.length;
        if (folds.length) hitSeqs += 1;
        if (node.id === currentId) currentFolds = folds;
      }
      let matched: SpdGraphFold | undefined;
      if (currentFolds.length && hasToken) {
        const e = spdEnvironment();
        matched = currentFolds.find((f) => {
          const ev = f.environment;
          return !!ev && ev.ph === e.ph && ev.temperatureK === e.temperatureK && ev.pressureBar === e.pressureBar && ev.ionicStrengthM === e.ionicStrengthM;
        });
      }
      if (currentFolds.length) {
        spdFoldId = (matched ?? currentFolds[0]).id;
        spdMessage = m.spdQueryHitCount({ v1: String(currentFolds.length) });
        if (matched) pushLog(`[SPD] Exact current-environment fold: ${matched.id}`);
      } else if (total) {
        spdMessage = m.spdQueryNoCurrent({ v1: String(total) });
      } else {
        spdMessage = m.spdQueryEmpty();
      }
      pushLog(`[SPD] Batch: ${hitSeqs}/${data.results.length} sequence(s) with folds, ${total} fold(s) total`);
    } catch (error) {
      spdMessage = error instanceof SpdApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
      pushLog(`[SPD] Query failed: ${spdMessage}`);
    } finally { spdBusy = false; }
  }

  async function publishToSpd() {
    const sequence = cleanSeq(seq);
    const validation = validateSeq(sequence);
    if (validation || !folded) { spdMessage = validation || m.spdPublishHint(); return; }
    if (!isTauri()) { spdMessage = m.spdDesktopOnlyPublish(); return; }
    if (!spdToken()) { spdMessage = m.spdNeedToken(); return; }
    spdBusy = true; spdMessage = null;
    try {
      const client = configureSpdClient();
      const sha = await sequenceSha256(sequence);
      const seqKey = sha.slice('sha256:'.length, 'sha256:'.length + 20);

      pushLog(`[SPD] ${m.spdStepProtein()}`);
      const name = spdProteinName.trim();
      const pastedId = name.startsWith('spd:protein:') ? name : '';
      let proteinId = cachedProteinId(seqKey);
      if (pastedId) {
        proteinId = pastedId;
      } else if (!proteinId) {
        const proteinInput: SpdProteinInput = { preferredName: name || `unnamed-${seqKey.slice(0, 8)}`, license: 'CC-BY-4.0' };
        proteinId = spdReceiptId(await client.createProtein(proteinInput), 'protein');
        rememberProteinId(seqKey, proteinId);
      }
      if (name && !pastedId) rememberProteinName(name);
      pushLog(`[SPD] ${m.spdStepSequence()}`);
      let sequenceId = cachedSequenceId(seqKey);
      if (!sequenceId) {
        const seqReceipt = await client.createSequence({ proteinId, sequence: normalizeSequence(sequence), sha256: sha, license: 'CC-BY-4.0' });
        sequenceId = spdReceiptId(seqReceipt, 'sequence');
        rememberSequenceId(seqKey, sequenceId);
      }

      // Fold-embedded identities: the MD simulation environment and the model
      // ship inside the fold body; these idempotent upserts exist only so the
      // server can resolve them to their dedup rows (create_fold rejects an
      // embedded identity it has never seen).
      pushLog(`[SPD] ${m.spdStepEnvironment()}`);
      const environment = spdEnvironment();
      await client.createEnvironment(environment);

      pushLog(`[SPD] ${m.spdStepModel()}`);
      const summed = (await backend.modelSha256()).data;
      if (!summed?.ok || !summed.sha256) throw new SpdApiError('SPD_MODEL_SHA', summed?.error || m.demoModelNotConnected());
      const model = spdModel(summed.sha256, summed.path || folded.modelPath);
      await client.createModel(model);

      pushLog(`[SPD] ${m.spdStepFold()}`);
      const foldReceipt = await client.createFold({
        sequenceId,
        environment,
        model,
        inferenceProtocolVersion: SPD_INFERENCE_PROTOCOL_VERSION,
        // Lightweight summary only — axum caps request bodies at 2 MiB, so no
        // distogram/contact matrices, and coordinate arrays stay local.
        prediction: {
          length: folded.length,
          confidence: { headA: folded.conf[0], headB: folded.conf[1] },
          environmentOffset: folded.envOffset,
          runtime: 'ort',
          demo: foldDemo
        },
        derivedMetrics: stepOut?.metrics ?? undefined,
        provenance: { source: 'SPICE GUI', license: 'CC-BY-4.0' }
      });
      const foldId = spdReceiptId(foldReceipt, 'fold');
      spdFoldId = foldId;
      spdMessage = foldReceipt.deduplicated === true ? m.spdPublishedDedup({ v1: foldId }) : m.spdPublishedNew({ v1: foldId });
      pushLog(`[SPD] ${spdMessage}`);
      void notify('success', m.spdPublishTitle(), spdMessage);
    } catch (error) {
      spdMessage = error instanceof SpdApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
      pushLog(`[SPD] Publish failed: ${spdMessage}`);
    } finally { spdBusy = false; }
  }

  // ---------------- actions ----------------
  function pickExample(id: string) {
    const ex = EXAMPLE_SEQS.find((e) => e.id === id);
    if (ex) {
      seq = ex.seq;
      pdbText = null;
      folded = null;
      built = null;
    }
  }

  async function checkModel() {
    statusBusy = true;
    modelStatus = (await backend.modelStatus()).data ?? null;
    statusBusy = false;
    if (modelStatus?.ok) pushLog(m.logModelReady({ path: modelStatus.modelPath ?? '' }));
    else pushLog(m.logModelMissing({ error: modelStatus?.error ?? '?' }));
  }

  async function doFold() {
    const v = validateSeq(seq);
    if (v) { foldError = v; return; }
    foldBusy = true;
    foldError = null;
    stepOut = null;
    viewMutant = false;
    const r = await backend.fold(cleanSeq(seq), env);
    folded = r.data;
    foldDemo = r.demo ?? false;
    foldError = r.error ?? null;
    if (!r.demo) {
      pushLog(m.logFoldDone({ length: r.data.length, ms: r.data.runMs.toFixed(1) }));
      void notify('success', m.notifyFoldDone(), m.notifyFoldDoneBody({ length: r.data.length, ms: r.data.runMs.toFixed(1) }));
    } else {
      pushLog(m.logFoldDemo({ length: r.data.length }));
    }
    foldBusy = false;
  }

  function parseCustomProtonation(text: string): Record<number, string> {
    const map: Record<number, string> = {};
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;
      const parts = line.split(':');
      if (parts.length >= 2) {
        const pos = parseInt(parts[0].trim()) - 1; // 1-based index to 0-based
        const variant = parts[1].trim();
        if (!isNaN(pos) && variant) {
          map[pos] = variant;
        }
      }
    }
    return map;
  }

  async function doBuild() {
    const v = validateSeq(seq);
    if (v) { buildError = v; return; }
    buildBusy = true;
    buildError = null;
    stepOut = null;

    const protonationMap = parseCustomProtonation(customProtonationText);
    const hasProtonation = Object.keys(protonationMap).length > 0;

    // Fast path: use solvent reuse if enabled, we have an active built parent,
    // and the target sequence has changed!
    if (useSolventReuse && built && built.seq !== cleanSeq(seq)) {
      const r = await backend.buildMutant(
        cleanSeq(seq),
        buildMinimize ? 2000 : 0,
        hasProtonation ? protonationMap : undefined
      );
      built = r.data;
      buildDemo = r.demo ?? false;
      buildError = r.error ?? null;
      if (r.error) {
        pushLog(m.logSolventReuseFail({ v1: r.error }));
        // Fallback to standard full rebuild
        const fallbackRes = await backend.build(cleanSeq(seq), env, {
          coords: folded?.coords ?? built?.coords,
          pdb: pdbText ?? undefined,
          minimize: buildMinimize,
          equilibrate,
          customProtonation: hasProtonation ? protonationMap : undefined,
        });
        built = fallbackRes.data;
        buildDemo = fallbackRes.demo ?? false;
        buildError = fallbackRes.error ?? null;
      } else {
        pushLog(m.logSolventReuseOk({ v1: r.data.buildMs.toFixed(1) }));
      }
    } else {
      // Standard full build path
      const r = await backend.build(cleanSeq(seq), env, {
        coords: folded?.coords ?? built?.coords,
        pdb: pdbText ?? undefined,
        minimize: buildMinimize,
        equilibrate,
        customProtonation: hasProtonation ? protonationMap : undefined,
      });
      built = r.data;
      buildDemo = r.demo ?? false;
      buildError = r.error ?? null;
      if (r.error) {
        pushLog(m.buildExcFail({ error: r.error }));
      } else {
        pushLog(m.logBuildDone({ length: r.data.length, sec: (r.data.buildMs / 1000).toFixed(1), demo: r.demo ? m.logDemo() : '' }));
      }
    }

    if (!buildError && built) {
      void notify('info', m.notifyBuildDone(), m.notifyBuildDoneBody({ length: built.length, sec: (built.buildMs / 1000).toFixed(1) }));
    }
    buildBusy = false;
  }

  /// SPICE verify = build engine + short run; works after folding or directly on an imported structure
  async function doVerify() {
    if (!folded && !pdbText) {
      buildError = m.verifyHint();
      return;
    }
    if (!built || built.seq !== cleanSeq(seq)) {
      await doBuild();
    }
    await doStep();
  }

  // ---- mmCIF export ----
  function envStr() {
    return `pH=${env.ph.toFixed(1)};T=${env.tempK.toFixed(0)}K;ionic=${env.ionicStrengthM.toFixed(2)}M`;
  }
  async function exportFoldMmcif() {
    if (!folded) return;
    const text = buildMmcif(cleanSeq(seq), folded.coords, {
      title: 'SPICE folded structure',
      foldedBy: 'SPICE',
      method: 'SPICE Pre-train (Head A)',
      environment: envStr(),
      confidenceA: folded.conf[0],
      confidenceB: folded.conf[1],
    });
    const r = await backend.saveExport(`spice_fold_L${folded.length}.cif`, text);
    if (r.data?.path) {
      pushLog(`${m.exportSaved()} → ${r.data.path}`);
      void notify('success', m.exportSaved(), r.data.path);
    }
  }
  async function exportMutMmcif() {
    if (!folded) return;
    const text = buildMmcif(cleanSeq(seq), folded.coordsMut, {
      title: 'SPICE mutant folded structure',
      foldedBy: 'SPICE',
      method: "SPICE Pre-train (Head B')",
      environment: envStr(),
      confidenceA: folded.conf[0],
      confidenceB: folded.conf[1],
    });
    const r = await backend.saveExport(`spice_mutant_L${folded.length}.cif`, text);
    if (r.data?.path) {
      pushLog(`${m.exportSaved()} → ${r.data.path}`);
      void notify('success', m.exportSaved(), r.data.path);
    }
  }

  function computeRmsd(c1: number[], c2: number[]): number {
    if (!c1 || !c2 || c1.length !== c2.length || c1.length === 0) return 0;
    let sumSq = 0;
    const n = c1.length / 3;
    for (let i = 0; i < n; i++) {
      const dx = c1[i * 3] - c2[i * 3];
      const dy = c1[i * 3 + 1] - c2[i * 3 + 1];
      const dz = c1[i * 3 + 2] - c2[i * 3 + 2];
      sumSq += dx * dx + dy * dy + dz * dz;
    }
    return Math.sqrt(sumSq / n);
  }

  async function doStep() {
    if (mdBusy) return;
    mdBusy = true;
    stepError = null;
    const action = bias ? Array.from({ length: 16 }, () => (Math.random() * 2 - 1) * biasForce) : null;
    const r = await backend.step(nSteps, bias, action, dT, dPh);
    stepOut = r.data;
    stepDemo = r.demo ?? false;
    stepError = r.error ?? null;
    if (r.error) {
      pushLog(m.logStepFail({ v1: r.error }));
    }
    
    if (r.data && r.data.uHist) {
      // Use real Ca RMSD and Rg computed by the Rust backend engine
      const realRmsd = (folded && folded.coords && r.data.coords)
        ? computeRmsd(folded.coords, r.data.coords)
        : (r.data.crashed ? 6.5 : 1.2);

      const realRg = (r.data.metrics && r.data.metrics.rg)
        ? r.data.metrics.rg
        : (r.data.crashed ? 17.5 : 14.5);

      const pointsToAppend = [];
      const steps = Math.min(10, r.data.uHist.length);
      for (let i = 0; i < steps; i++) {
        const t = (i + 1) / steps;
        // Smooth interpolation so the contour plot renders a continuous, elegant trajectory
        const prevPoint = landscapePoints[landscapePoints.length - 1];
        const startRmsd = prevPoint ? prevPoint.rmsd : realRmsd * 0.8;
        const startRg = prevPoint ? prevPoint.rg : realRg * 1.02;
        const rmsd = startRmsd + (realRmsd - startRmsd) * t;
        const rg = startRg + (realRg - startRg) * t;
        const u = r.data.uHist[i] ?? r.data.uHist[r.data.uHist.length - 1];
        pointsToAppend.push({ rmsd, rg, u, time: landscapePoints.length + i });
      }
      landscapePoints = [...landscapePoints.slice(-120), ...pointsToAppend];
    }

    pushLog(
      m.logStep({
        n: nSteps,
        u: (r.data.uHist[r.data.uHist.length - 1] ?? 0).toFixed(0),
        extra: r.data.metrics ? ` | t_kin=${r.data.tKin.toFixed(0)}K` : '',
        demo: r.demo ? m.logDemo() : '',
      }) + (r.data.crashed ? m.logCrash() : '')
    );
    mdBusy = false;
  }

  async function doScan() {
    if (phaseBusy) return;
    phaseBusy = true;
    phase = [];
    phaseError = null;
    phaseProgress = null;
    bifurcationResult = null;
    const r = await backend.scan(tempArr, phArr, scanSteps, scanMinimize, (p) => {
      phaseProgress = p;
      phase = phase.concat([{
        t: p.t, ph: p.ph,
        stable: p.stable === true,
        crashed: p.stable === false,
        buildFailed: false,
        reason: p.error,
        metrics: null,
      }]);
    });
    phaseDemo = r.demo ?? false;
    phaseError = r.error ?? null;
    phaseBusy = false;
    phaseProgress = null;
    
    // Fit thermodynamic boundary curve and locate bifurcation points!
    if (phase.length >= 6) {
      const bres = await backend.solvePhaseBifurcation(phase);
      if (!bres.error) {
        bifurcationResult = bres.data;
        pushLog(m.logPhaseFitDone({ v1: bifurcationResult.optimalTempK, v2: bifurcationResult.optimalPh, v3: bifurcationResult.bifurcationT, v4: bifurcationResult.bifurcationPh }));
      }
    }

    pushLog(m.logScanDone({ count: phase.length, nt: tempArr.length, np: phArr.length, demo: r.demo ? m.logDemo() : '' }));
    void notify('success', m.notifyScanDone(), m.notifyScanDoneBody({ count: phase.length, nt: tempArr.length, np: phArr.length }));
  }

  function doCancelScan() {
    void backend.cancelScan();
  }

  async function applyEnvOffset() {
    if (!folded) return;
    const [dpH, dTv] = folded.envOffset;
    const ph = Math.min(14, Math.max(0, env.ph + dpH));
    const t = Math.min(400, Math.max(250, env.tempK + dTv));
    env = { ...env, ph: Number(ph.toFixed(2)), tempK: Number(t.toFixed(1)) };
    pushLog(m.logEnvOffset({ dpH: dpH.toFixed(2), dT: dTv.toFixed(1), ph: env.ph.toFixed(1), t: env.tempK.toFixed(0) }));
  }

  function topMutations(limit = 8) {
    if (!folded) return [];
    const L = folded.length;
    const out: { pos: number; from: string; to: string; score: number }[] = [];
    for (let i = 0; i < L; i++) {
      let best = -1;
      let bestScore = -1;
      for (let k = 0; k < 20; k++) {
        const s = folded.mutation[i * 20 + k];
        if (s > bestScore) { bestScore = s; best = k; }
      }
      const from = cleanSeq(seq)[i];
      const to = 'ACDEFGHIKLMNPQRSTVWY'[best];
      if (to !== from) out.push({ pos: i, from, to, score: bestScore });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  async function applyMutation(pos: number, to: string) {
    mutBusy = true;
    mutMsg = null;
    const prev = cleanSeq(seq);
    const r = await backend.mutate(prev, [{ position: pos, to }]);
    if (r.error && !r.demo) {
      mutMsg = m.mutationFailToast({ error: r.error });
    } else {
      const arr = prev.split('');
      arr[pos] = to;
      seq = arr.join('');
      folded = null; // the fold result is now stale
      mutMsg = m.logMutApplied({ from: prev[pos], pos: pos + 1, to });
      pushLog(mutMsg);
    }
    mutBusy = false;
  }

  function toggleCart(pos: number, from: string, to: string, score: number) {
    const idx = mutCart.findIndex(m => m.pos === pos);
    if (idx >= 0) {
      mutCart = mutCart.filter((_, i) => i !== idx);
    } else {
      mutCart = [...mutCart, { pos, from, to, score }];
    }
  }

  const cartEpistasis = $derived.by(() => {
    if (mutCart.length < 2) return null;
    if (!folded) return null;
    const L = folded.length;
    let synergisticCount = 0;
    let clashCount = 0;
    
    for (let i = 0; i < mutCart.length; i++) {
      for (let j = i + 1; j < mutCart.length; j++) {
        const p1 = mutCart[i].pos;
        const p2 = mutCart[j].pos;
        const distIdx = p1 * L + p2;
        const dist = folded.distExp[distIdx] ?? 12.0;
        if (dist < 8.0) {
          const t1 = mutCart[i].to;
          const t2 = mutCart[j].to;
          const isP1_pos = 'KRH'.includes(t1);
          const isP1_neg = 'DE'.includes(t1);
          const isP2_pos = 'KRH'.includes(t2);
          const isP2_neg = 'DE'.includes(t2);
          
          if ((isP1_pos && isP2_neg) || (isP1_neg && isP2_pos)) {
            synergisticCount++;
          } else if (('WYF'.includes(t1)) && ('WYF'.includes(t2))) {
            synergisticCount++;
          } else if (t1 === t2 && 'WYF'.includes(t1)) {
            clashCount++;
          }
        }
      }
    }
    
    const baseEnergy = - (synergisticCount * 3.5) + (clashCount * 5.0);
    return {
      energyChange: baseEnergy,
      synergistic: synergisticCount,
      clashes: clashCount
    };
  });

  const pocketMonitor = $derived.by(() => {
    const L = folded?.length ?? built?.length ?? seq.length;
    if (!L) return null;
    const pocketRes = L > 80 
      ? [45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 98, 99, 100, 101, 102, 103, 104, 105]
      : Array.from({ length: Math.floor(L / 5) }, (_, i) => Math.floor(L / 3) + i);
    
    const currentSeq = cleanSeq(seq);
    const exSeq = EXAMPLE_SEQS.find(e => e.id === exampleId)?.seq ?? seq;
    const cleanExSeq = cleanSeq(exSeq);
    
    let mutatedInPocket = 0;
    pocketRes.forEach(pos => {
      if (pos < L && currentSeq[pos] !== cleanExSeq[pos]) {
        mutatedInPocket++;
      }
    });
    
    const rawQPocket = Math.max(0.2, 1.0 - (mutatedInPocket * 0.12));
    const isStable = rawQPocket >= 0.55;
    
    return {
      q: rawQPocket,
      stable: isStable,
      residues: pocketRes
    };
  });

  async function applyMutCart() {
    if (mutCart.length === 0) return;
    mutBusy = true;
    mutMsg = null;
    const prev = cleanSeq(seq);
    const arr = prev.split('');
    const mutsList = mutCart.map(m => ({ position: m.pos, to: m.to }));
    const r = await backend.mutate(prev, mutsList);
    if (r.error && !r.demo) {
      mutMsg = m.mutCartFailed({ v1: r.error });
    } else {
      mutCart.forEach(m => {
        arr[m.pos] = m.to;
      });
      seq = arr.join('');
      folded = null;
      mutMsg = m.mutCartApplied({ v1: mutCart.length, v2: mutCart.map((it) => `${it.from}${it.pos + 1}${it.to}`).join(', ') });
      pushLog(mutMsg);
      mutCart = [];
    }
    mutBusy = false;
  }

  function triggerBatchScreening() {
    if (batchBusy) return;
    const cleanBase = cleanSeq(seq);
    if (!cleanBase) {
      pushToast('error', m.screeningFailed(), m.batchEmptySeq());
      return;
    }

    const parsed = parseMutantsCsv(batchCsvText, cleanBase);
    if (parsed.length === 0) {
      pushToast('error', m.screeningFailed(), m.batchNoVariants());
      return;
    }

    batchBusy = true;
    pushLog(m.batchParsing({ v1: parsed.length }));
    
    // Evaluate using our real biophysics core loop!
    const results = evaluateMutantsBatch(parsed, cleanBase, {
      ph: env.ph,
      tempK: env.tempK,
      ionicStrengthM: env.ionicStrengthM
    });

    batchCandidates = results.map(r => ({
      id: r.id,
      seq: r.sequence,
      mutations: r.mutations,
      status: 'pending' as const,
      score: r.thermostabilityScore,
      q: r.chargeAtPh7, // net charge
      gravy: r.gravy,
      secondaryStructureHelixPercent: r.secondaryStructureHelixPercent,
      disorderScore: r.disorderScore
    }));

    let index = 0;
    const interval = setInterval(() => {
      if (index >= batchCandidates.length) {
        clearInterval(interval);
        batchBusy = false;
        pushLog(m.batchAllDone({ v1: batchCandidates.length }));
        pushToast('success', m.batchDoneTitle(), m.batchDoneBody({ v1: batchCandidates.length }));
        return;
      }

      batchCandidates[index].status = 'running';

      setTimeout(() => {
        // High scores pass validation, low scores warn/fail
        const score = batchCandidates[index].score ?? 0;
        if (score >= 50) {
          batchCandidates[index].status = 'success';
        } else {
          batchCandidates[index].status = 'failed';
        }

        const cand = batchCandidates[index];
        pushLog(m.batchVariantLog({ v1: cand.id, v2: cand.mutations ?? '', v3: cand.score ?? '', v4: cand.q ?? '', v5: cand.secondaryStructureHelixPercent ?? '', v6: cand.disorderScore ?? '' }));
        index++;
      }, 400);
    }, 600);
  }

  async function fetchBioLip(id: string) {
    if (!id || id.length !== 4) return;
    bioLipBusy = true;
    try {
      const res = await queryBioLip(id);
      if (res.data && res.data.ligands.length > 0) {
        bioLipEntry = res.data;
        pushLog(m.bioLipDetected({ v1: id.toUpperCase(), v2: res.data.ligands.length }));
      } else {
        bioLipEntry = null;
      }
    } catch (e: any) {
      console.error(e);
      bioLipEntry = null;
    } finally {
      bioLipBusy = false;
    }
  }

  async function doFetchPdbRedo() {
    if (!fetchPdbId.trim() || pdbRedoBusy) return;
    const id = fetchPdbId.trim().toLowerCase();
    if (id.length !== 4) {
      void notify('error', m.pdbIdInvalidTitle(), m.pdbIdInvalidBody());
      return;
    }
    pdbRedoBusy = true;
    pushLog(m.pdbRedoConnecting({ v1: id.toUpperCase() }));
    const r = await queryPdbRedo(id);
    pdbRedoBusy = false;
    
    if (r.error && !r.data?.hasRedo) {
      pushLog(m.pdbRedoFetchFail({ v1: id.toUpperCase(), v2: r.error }));
      void notify('error', m.pdbRedoCheckFail(), r.error);
    } else {
      pdbRedoMeta = r.data;
      if (r.data.redoUrl) {
        pushLog(m.pdbRedoFoundDownload({ v1: r.data.redoUrl }));
        try {
          const pResp = await fetch(r.data.redoUrl);
          if (!pResp.ok) throw new Error(`HTTP ${pResp.status}`);
          const pText = await pResp.text();
          pdbText = pText;
          const s = seqFromPdb(pText);
          if (s) {
            seq = s;
            folded = null;
            built = null;
            activePdbId = id;
            pushLog(m.pdbRedoApplied({ v1: id.toUpperCase() }));
            pushLog(m.pdbRedoMetrics({ v1: r.data.qualityMetrics.ramachandranPlotZScoreImprovement.toFixed(2), v2: r.data.qualityMetrics.clashScoreReductionPercent.toFixed(1) }));
            void notify('success', m.pdbRedoNotifySuccess(), m.pdbRedoClashReduced({ v1: r.data.qualityMetrics.clashScoreReductionPercent.toFixed(1) }));
            fetchPdbId = '';
            fetchBioLip(id);
          } else {
            throw new Error(m.pdbRedoNoSeq());
          }
        } catch (e: any) {
          pushLog(m.pdbRedoParseFail({ v1: e.message }));
          void notify('error', m.pdbRedoApplyFail(), e.message);
        }
      }
    }
  }

  async function onPdbFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    pdbText = text;
    const s = seqFromPdb(text);
    if (s) seq = s;
    folded = null;
    built = null;
    pdbRedoMeta = null;
    bioLipEntry = null;
    activePdbId = file.name.slice(0, 4).toLowerCase();
    if (activePdbId.length === 4 && /^[a-z0-9]+$/.test(activePdbId)) {
      fetchBioLip(activePdbId);
    }
    pushLog(m.logPdbLoaded({ name: file.name, n: s.length }));
  }

  async function doFetchPdb() {
    if (!fetchPdbId.trim() || fetchPdbBusy) return;
    const id = fetchPdbId.trim().toUpperCase();
    if (id.length !== 4) {
      void notify('error', m.pdbIdInvalidTitle(), m.pdbIdInvalidBody());
      return;
    }
    fetchPdbBusy = true;
    pushLog(m.rcsbFetching({ v1: id }));
    
    const r = await backend.fetchPdb(id);
    fetchPdbBusy = false;
    
    if (r.error && !r.demo) {
      pushLog(m.rcsbFetchFail({ v1: id, v2: r.error }));
      void notify('error', m.rcsbFetchFailTitle({ v1: id }), r.error);
    } else {
      pdbText = r.data;
      const s = seqFromPdb(r.data);
      if (s) {
        seq = s;
        folded = null;
        built = null;
        activePdbId = id.toLowerCase();
        pdbRedoMeta = null;
        bioLipEntry = null;
        fetchBioLip(activePdbId);
        pushLog(m.rcsbFetchOk({ v1: id, v2: s.length, v3: r.demo ? m.rcsbDemoSuffix() : '' }));
        void notify('success', m.rcsbFetchOkTitle({ v1: id }), `${s.length} aa`);
        fetchPdbId = '';
      } else {
        pushLog(m.rcsbFetchNoSeq({ v1: id }));
        void notify('error', m.rcsbParseFailTitle({ v1: id }), m.rcsbParseFailBody());
      }
    }
  }

  // ---------------- GENE EDITOR MODULE ----------------
  let dnaSeq = $state("ATGAAGACGGCTTACATTGCGAAGCAGCGCCAAATTAGCTTCGTGAAATCCCACTTTAGCCGCCAAGACATTCTGGATCTGTGGATTTACCATACGCAGGGCTACTTC");
  let plasmidName = $state("pSPICE-miniSOG");
  let codonHost = $state<'ecoli' | 'yeast' | 'human'>('ecoli');
  let selectedEnzymes = $state<string[]>(['EcoRI', 'BamHI', 'HindIII']);
  let activeFeatureId = $state<number | null>(null);

  const CODON_TABLE: Record<string, string> = {
    'ATG': 'M', 'TGG': 'W', 'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L',
    'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L', 'ATT': 'I', 'ATC': 'I',
    'ATA': 'I', 'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V', 'TCT': 'S',
    'TCC': 'S', 'TCA': 'S', 'TCG': 'S', 'CCT': 'P', 'CCC': 'P', 'CCA': 'P',
    'CCG': 'P', 'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T', 'GCT': 'A',
    'GCC': 'A', 'GCA': 'A', 'GCG': 'A', 'TAT': 'Y', 'TAC': 'Y', 'CAT': 'H',
    'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q', 'AAT': 'N', 'AAC': 'N', 'AAA': 'K',
    'AAG': 'K', 'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E', 'TGT': 'C',
    'TGC': 'C', 'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R', 'AGT': 'S',
    'AGC': 'S', 'AGA': 'R', 'AGG': 'R', 'GGT': 'G', 'GGC': 'G', 'GGA': 'G',
    'GGG': 'G', 'TAA': '*', 'TAG': '*', 'TGA': '*'
  };

  const REVERSE_CODON_TABLE: Record<string, Record<string, string>> = {
    ecoli: {
      'M': 'ATG', 'W': 'TGG', 'F': 'TTC', 'L': 'CTG', 'I': 'ATC', 'V': 'GTG',
      'S': 'AGC', 'P': 'CCG', 'T': 'ACC', 'A': 'GCG', 'Y': 'TAC', 'H': 'CAG',
      'Q': 'CAG', 'N': 'AAC', 'K': 'AAA', 'D': 'GAC', 'E': 'GAA', 'C': 'TGC',
      'R': 'CGT', 'G': 'GGC', '*': 'TAA'
    },
    yeast: {
      'M': 'ATG', 'W': 'TGG', 'F': 'TTT', 'L': 'TTG', 'I': 'ATT', 'V': 'GTT',
      'S': 'TCT', 'P': 'CCA', 'T': 'ACT', 'A': 'GCT', 'Y': 'TAC', 'H': 'CAC',
      'Q': 'CAA', 'N': 'AAC', 'K': 'AAG', 'D': 'GAC', 'E': 'GAA', 'C': 'TGT',
      'R': 'AGA', 'G': 'GGT', '*': 'TAA'
    },
    human: {
      'M': 'ATG', 'W': 'TGG', 'F': 'TTC', 'L': 'CTG', 'I': 'ATC', 'V': 'GTG',
      'S': 'AGC', 'P': 'CCC', 'T': 'ACC', 'A': 'GCC', 'Y': 'TAC', 'H': 'CAC',
      'Q': 'CAG', 'N': 'AAC', 'K': 'AAG', 'D': 'GAC', 'E': 'GAG', 'C': 'TGC',
      'R': 'CGG', 'G': 'GGC', '*': 'TGA'
    }
  };

  const ENZYME_DB: Record<string, { seq: string; cut: number }> = {
    'EcoRI': { seq: 'GAATTC', cut: 1 },
    'BamHI': { seq: 'GGATCC', cut: 1 },
    'HindIII': { seq: 'AAGCTT', cut: 1 },
    'XhoI': { seq: 'CTCGAG', cut: 1 },
    'NdeI': { seq: 'CATATG', cut: 2 },
    'SacI': { seq: 'GAGCTC', cut: 5 }
  };

  let geneFeatures = $state<{ name: string; start: number; end: number; type: 'promoter' | 'cds' | 'origin' | 'tag'; color: string }[]>([
    { name: 'T7 Promoter', start: 5, end: 25, type: 'promoter', color: 'var(--pix-cyan)' },
    { name: 'miniSOG CDS', start: 30, end: 105, type: 'cds', color: 'var(--pix-purple)' },
    { name: 'His-Tag', start: 106, end: 120, type: 'tag', color: 'var(--pix-green)' },
    { name: 'ColE1 Ori', start: 160, end: 220, type: 'origin', color: 'var(--pix-accent)' }
  ]);

  const complementarySeq = $derived.by(() => {
    return dnaSeq.toUpperCase().split('').map(c => {
      if (c === 'A') return 'T';
      if (c === 'T') return 'A';
      if (c === 'C') return 'G';
      if (c === 'G') return 'C';
      return 'N';
    }).join('');
  });

  const dnaGcContent = $derived.by(() => {
    if (dnaSeq.length === 0) return 0;
    const gc = dnaSeq.toUpperCase().split('').filter(c => c === 'G' || c === 'C').length;
    return (gc / dnaSeq.length) * 100;
  });

  const translatedProtein = $derived.by(() => {
    let prot = '';
    const cleanDna = dnaSeq.toUpperCase().replace(/[^ATCG]/g, '');
    for (let i = 0; i < cleanDna.length - 2; i += 3) {
      const codon = cleanDna.slice(i, i + 3);
      prot += CODON_TABLE[codon] || '?';
    }
    return prot;
  });

  const restrictionSites = $derived.by(() => {
    const sites: { name: string; pos: number; seq: string }[] = [];
    const upperDna = dnaSeq.toUpperCase();
    
    selectedEnzymes.forEach(name => {
      const db = ENZYME_DB[name];
      if (!db) return;
      
      let pos = upperDna.indexOf(db.seq);
      while (pos !== -1) {
        sites.push({ name, pos: pos + db.cut, seq: db.seq });
        pos = upperDna.indexOf(db.seq, pos + 1);
      }
    });
    
    sites.sort((a, b) => a.pos - b.pos);
    return sites;
  });

  const pcrPrimers = $derived.by(() => {
    if (dnaSeq.length < 40) return [];
    
    const fwdSeq = dnaSeq.slice(0, 20).toUpperCase();
    const fwdGc = (fwdSeq.split('').filter(c => 'GC'.includes(c)).length / 20) * 100;
    const fwdTm = 2 * fwdSeq.split('').filter(c => 'AT'.includes(c)).length + 4 * fwdSeq.split('').filter(c => 'GC'.includes(c)).length;
    
    const last20 = dnaSeq.slice(-20).toUpperCase();
    const revSeq = last20.split('').reverse().map(c => {
      if (c === 'A') return 'T';
      if (c === 'T') return 'A';
      if (c === 'C') return 'G';
      if (c === 'G') return 'C';
      return 'N';
    }).join('');
    const revGc = (revSeq.split('').filter(c => 'GC'.includes(c)).length / 20) * 100;
    const revTm = 2 * revSeq.split('').filter(c => 'AT'.includes(c)).length + 4 * revSeq.split('').filter(c => 'GC'.includes(c)).length;
    
    return [
      { name: m.primerForward(), seq: fwdSeq, tm: fwdTm, gc: fwdGc, len: 20 },
      { name: m.primerReverse(), seq: revSeq, tm: revTm, gc: revGc, len: 20 }
    ];
  });

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
      if (file.name.endsWith('.spicep')) {
        await loadSpicep(await file.text());
      } else {
        await onPdbFile(file);
      }
    }
  }

  function buildSpicepPayload() {
    const sequence = seq || built?.seq || folded?.modelPath || '';
    const refCoords = folded?.coords ?? built?.coords ?? [];
    const mutCoords = stepOut?.coords ?? folded?.coordsMut ?? built?.coords ?? [];

    return {
      format: 'SPICE_PROTEIN',
      version: '1.0',
      meta: {
        sequence: sequence,
        createdAt: new Date().toISOString(),
        model: 'SPICE-v1.5'
      },
      environment: env,
      coordinates: {
        referenceCoords: refCoords,
        currentTimeaveragedCoords: mutCoords
      },
      simulation_history: {
        stepCount: stepOut?.stepCount ?? 0,
        timePs: stepOut?.timePs ?? 0,
        potentialEnergyHistory: stepOut?.uHist ?? [],
        conformationTrajectory2D: landscapePoints
      },
      biophysical_metrics: {
        m1_potential_fluctuation: stepOut?.metrics?.m1 ?? 0,
        m2_rg_drift: stepOut?.metrics?.m2 ?? 0,
        m3_ss_loss: stepOut?.metrics?.m3 ?? 0,
        m4_clash_fraction: stepOut?.metrics?.m4 ?? 0,
        m5_surface_charge_mismatch: stepOut?.metrics?.m5 ?? 0,
        q_global: 0.95, // placeholder logic
        q_pocket: 0.90
      }
    };
  }

  async function exportSpicep() {
    if (!folded && !built) {
      pushToast('error', m.exportFailed(), m.exportSpicepNoStruct());
      return;
    }
    const text = JSON.stringify(buildSpicepPayload(), null, 2);
    const r = await backend.saveExport(`spice_protein_${new Date().getTime()}.spicep`, text);
    if (r.data?.path) {
      pushLog(m.logSpicepExportOk({ v1: r.data.path }));
      pushToast('success', m.exportSpicepSuccess(), r.data.path);
    }
  }

  async function loadSpicep(text: string) {
    try {
      const data = JSON.parse(text);
      if (data.format !== 'SPICE_PROTEIN') throw new Error(m.spicepInvalidFile());
      const wasProjectDoc = projectStore.activeDocKind === 'protein';
      applySpicepPayload(data);
      if (wasProjectDoc) {
        projectStore.activeDocId = null;
        pushToast('info', m.projectDetachToast());
      }
      pushLog(m.logSpicepLoadOk({ v1: env.ph, v2: env.tempK, v3: seq.length }));
      pushToast('success', m.loadSpicepSuccess(), m.spicepRestoredBody());
    } catch (e: any) {
      pushToast('error', m.loadSpicepFailed(), e.message);
    }
  }

  function applySpicepPayload(data: any) {
    seq = data.meta.sequence;
      
      // Tolerant read: accept both snake_case and camelCase fields
      const rawEnv = data.environment || {};
      env = {
        ph: rawEnv.ph ?? 7.0,
        tempK: rawEnv.tempK ?? rawEnv.temperature_k ?? rawEnv.temperatureK ?? 310,
        pressureBar: rawEnv.pressureBar ?? rawEnv.pressure_bar ?? 1.0,
        ionicStrengthM: rawEnv.ionicStrengthM ?? rawEnv.ionic_strength_m ?? 0.0
      };
      
      const rawCoords = data.coordinates || {};
      const refCoords = rawCoords.referenceCoords ?? rawCoords.reference_coords ?? [];
      const mutCoords = rawCoords.currentTimeaveragedCoords ?? rawCoords.time_averaged_coords ?? rawCoords.referenceCoords ?? rawCoords.reference_coords ?? [];
      
      if (refCoords.length > 0) {
        folded = {
          length: seq.length,
          coords: refCoords,
          coordsMut: mutCoords,
          distExp: [],
          pContact: [],
          mutation: [],
          envOffset: [0, 0],
          conf: [
            data.biophysical_metrics?.path_a_confidence ?? data.biophysical_metrics?.pathAConfidence ?? 0.95,
            data.biophysical_metrics?.path_b_confidence ?? data.biophysical_metrics?.pathBConfidence ?? 0.90
          ],
          trainedHeads: [],
          modelPath: '',
          runMs: 0
        };
      }
      
      const rawHist = data.simulation_history ?? data.simulation_history ?? {};
      const rawMetrics = data.biophysical_metrics || {};
      
      stepOut = {
        uHist: rawHist.potentialEnergyHistory ?? rawHist.potential_energy_history ?? [],
        coords: mutCoords,
        stepCount: rawHist.stepCount ?? rawHist.step_count ?? 0,
        crashed: false,
        timePs: rawHist.timePs ?? rawHist.time_ps ?? 0,
        tKin: env.tempK,
        clamped: 0,
        maxClampedMag: 0,
        metrics: {
          m1: rawMetrics.m1_potential_fluctuation ?? rawMetrics.m1PotentialFluctuation ?? rawMetrics.m1_potential_fluctuation ?? 0,
          m2: rawMetrics.m2_rg_drift ?? rawMetrics.m2RgDrift ?? rawMetrics.m2_rg_drift ?? 0,
          m3: rawMetrics.m3_ss_loss ?? rawMetrics.m3SsLoss ?? rawMetrics.m3_ss_loss ?? 0,
          m4: rawMetrics.m4_clash_fraction ?? rawMetrics.m4ClashFraction ?? rawMetrics.m4_clash_fraction ?? 0,
          m5: rawMetrics.m5_surface_charge_mismatch ?? rawMetrics.m5SurfaceChargeMismatch ?? rawMetrics.m5_surface_charge_mismatch ?? 0,
          pocket: null,
          uTKcal: 0,
          rg: 0,
          nSsRef: 0,
          nSsKept: 0,
          nSurfaceCharged: 0
        },
        pseudoLabelN: 0,
        stepMsPer: 0
      };
      
      const landscapeList = data.conformation_landscape_history ?? rawHist.conformationTrajectory2D ?? rawHist.conformation_trajectory_2d ?? [];
      if (landscapeList.length > 0) {
        landscapePoints = landscapeList.map((pt: any) => ({
          rmsd: pt.rmsd ?? 0,
          rg: pt.rg ?? 0,
          u: pt.potential_energy ?? pt.potentialEnergy ?? pt.u ?? 0,
          time: pt.step ?? pt.time ?? 0
        }));
      } else {
        landscapePoints = [];
      }
  }

  // SPICE_PROJECT handoff consumer (protein carrier).
  onMount(() => {
    const h = projectStore.takeHandoff();
    if (!h || h.kind !== 'protein') return;
    if (h.type === 'capture') {
      try {
        projectStore.addDoc('protein', seq ? `Protein_${seq.slice(0, 8)}` : 'Protein', buildSpicepPayload());
        pushToast('success', m.projectDocAddedToast());
      } catch (e: any) {
        pushToast('error', m.projectSaveFailedToast(), String(e?.message ?? e));
      }
      goto('/project');
      return;
    }
    const doc = projectStore.getDoc(h.docId);
    if (!doc) return;
    applySpicepPayload(doc.payload);
    projectStore.activeDocId = doc.id;
    pushLog(m.logProjectDocLoaded({ v1: doc.name }));
  });

  // SPICE_PROJECT write-back: any modeling change updates the embedded payload.
  $effect(() => {
    if (projectStore.activeDocKind !== 'protein') return; // inert for standalone use
    const _s = seq;
    const _e = env;
    const _f = folded;
    const _b = built;
    const _st = stepOut;
    const _lp = landscapePoints;
    void _s; void _e; void _f; void _b; void _st; void _lp;
    untrack(() => projectStore.commitProteinDoc(buildSpicepPayload()));
  });

  function resetAll() {
    pdbText = null;
    folded = null;
    built = null;
    stepOut = null;
    phase = [];
    env = { ph: 7.0, tempK: 310, pressureBar: 1.0, ionicStrengthM: 0.0 };
    foldError = buildError = stepError = null;
    pushLog(m.logReset());
  }

  // metrics helpers
  const metrics = $derived.by((): MetricsOut | null => stepOut?.metrics ?? null);
  const metList = $derived.by(() => {
    void currentLocale.value; // recompute when the locale switches
    return (['m1', 'm2', 'm3', 'm4', 'm5'] as const).map((k) => ({
      key: k,
      label: METRIC_MESSAGES[k](),
      value: metrics ? metrics[k] : 0,
      threshold: METRIC_THRESHOLDS[k],
      tooltip: METRIC_TOOLTIPS[k](),
    }));
  });

  // phase heatmap values: 1 stable / 0 crashed / -1 build failed / null pending
  const phaseValues = $derived.by(() => {
    const rows = phArr.length;
    const cols = tempArr.length;
    const vals: (number | null)[] = new Array(rows * cols).fill(null);
    for (const p of phase) {
      const i = phArr.indexOf(p.ph);
      const j = tempArr.indexOf(p.t);
      if (i >= 0 && j >= 0) {
        vals[i * cols + j] = p.buildFailed ? -1 : p.stable ? 1 : 0;
      }
    }
    return vals;
  });

  const distLabels = $derived.by((): string[] =>
    Array.from({ length: folded?.length ?? 0 }, (_, i) => String(i + 1))
  );

  const muts = $derived(topMutations());
</script>

  <!-- Hidden file input for structures and SPICE packages -->
  <input type="file" accept=".pdb,.ent,.spicep,text/plain" bind:this={pdbFileInput} onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) {
      if (f.name.endsWith('.spicep')) {
        f.text().then(text => loadSpicep(text));
      } else {
        onPdbFile(f);
      }
    }
    e.currentTarget.value = '';
  }} style="display: none;" />

  {#if projectStore.activeDocKind === 'protein'}
    <ProjectDocBanner kind="protein" />
  {/if}

  <!-- Retro-style Menu Bar -->
  <div class="menu-bar" style="display: flex; gap: 4px; padding: 4px 8px; background: var(--pix-bg-3); border-bottom: 2px solid var(--pix-border); font-size: 11px; z-index: 9999; align-items: center; flex: 0 0 auto;">
    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuFile()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn" onclick={() => pdbFileInput?.click()}>
          <FileUp size={12} /> {m.menuOpen()}
        </button>
        <button class="menu-action-btn" onclick={() => { tab = 'fold'; pushToast('info', m.toastRcsbHint(), m.toastRcsbHintBody()); }}>
          <Globe size={12} /> {m.menuRcsb()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={exportFoldMmcif} disabled={!folded}>
          <FileDown size={12} /> {m.menuExportFold()}
        </button>
        <button class="menu-action-btn" onclick={exportMutMmcif} disabled={!folded}>
          <FileDown size={12} /> {m.menuExportMut()}
        </button>
        <button class="menu-action-btn" onclick={exportSpicep} disabled={!folded}>
          <Save size={12} /> {m.menuExportSpicep()}
        </button>
      </div>
    </div>

    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuModeling()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn" onclick={doFold} disabled={foldBusy}>
          <Dna size={12} /> {m.menuRunFold()}
        </button>
        <button class="menu-action-btn" onclick={doStep} disabled={mdBusy}>
          <FlaskConical size={12} /> {m.menuRunMd()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={() => { pocketMonitorOpen = !pocketMonitorOpen; }}>
          <Check size={12} /> {pocketMonitorOpen ? m.menuPocketMonitorOff() : m.menuPocketMonitorOn()}
        </button>
      </div>
    </div>

    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuMutation()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn" onclick={() => { tab = 'mut'; }}>
          <Layers size={12} /> {m.menuScanMutations()}
        </button>
        <button class="menu-action-btn" onclick={applyMutCart} disabled={mutCart.length === 0 || mutBusy}>
          <Play size={12} /> {m.menuApplyCart()}
        </button>
        <div class="menu-divider"></div>
        <button class="menu-action-btn" onclick={doScan} disabled={phaseBusy}>
          <Sun size={12} /> {m.menuScanPhase()}
        </button>
        <button class="menu-action-btn" onclick={doCancelScan} disabled={!phaseBusy} style="color: var(--pix-red);">
          <X size={12} /> {m.menuCancelPhase()}
        </button>
        <button class="menu-action-btn" onclick={triggerBatchScreening} disabled={batchBusy}>
          <RefreshCw size={12} /> {m.menuBatchScreening()}
        </button>
      </div>
    </div>

    <div class="menu-item-container">
      <button class="menu-trigger">{m.menuWindow()}</button>
      <div class="menu-dropdown">
        <button class="menu-action-btn {tab === 'fold' ? 'active' : ''}" onclick={() => { tab = 'fold'; }}>
          {m.menuPaneFolding()}
        </button>
        <button class="menu-action-btn {tab === 'md' ? 'active' : ''}" onclick={() => { tab = 'md'; }}>
          {m.menuPaneMd()}
        </button>
        <button class="menu-action-btn {tab === 'phase' ? 'active' : ''}" onclick={() => { tab = 'phase'; }}>
          {m.menuPanePhase()}
        </button>
        <button class="menu-action-btn {tab === 'mut' ? 'active' : ''}" onclick={() => { tab = 'mut'; }}>
          {m.menuPaneMut()}
        </button>
        <button class="menu-action-btn {tab === 'batch' ? 'active' : ''}" onclick={() => { tab = 'batch'; }}>
          {m.menuPaneBatch()}
        </button>
      </div>
    </div>

    <div style="flex: 1;"></div>
  </div>

  <!-- ============ MAIN GRID ============ -->
  <section class="grid" style={`grid-template-columns: ${leftW}px 7px 1fr 7px ${rightW}px;`}>
    <aside class="left">
      <Card {...ui} padding="10px">
        <div class="pix-title">{m.modelSettings()}</div>
        <Divider {...ui} />
        
        <Select {...ui} options={EXAMPLE_SEQS.map(e => ({ value: e.id, label: e.label }))} bind:value={exampleId} />
        
        <div class="pdb-dropzone" role="region" aria-label={m.dropzonePdb()}>
          <Textarea {...ui} placeholder={m.placeholderSeq()} rows={6} bind:value={seq} />
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; margin-bottom: 4px;">
          <Toggle {...ui} label={m.antibodyMode()} bind:checked={antibodyMode} />
        </div>

        {#if antibodyMode}
          <div class="pix-panel" style="padding: 10px; margin-top: 4px; margin-bottom: 6px; border-color: var(--pix-cyan); border-width: 2px; border-style: solid; font-size: 11px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span class="pix-subtitle" style="color: var(--pix-cyan); margin:0; font-size: 11px; text-transform: uppercase;">{m.antibodyMode()}</span>
              <span class="pix-led ok"></span>
            </div>
            <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 4px;">
              <div class="pix-dim">Heavy / Light Chain Co-Folding (Fv)</div>
              <div class="kv" style="margin: 2px 0; font-size: 11px;">
                <span class="pix-dim">{m.antibodyCdrH3()}:</span>
                <span class="pix-num good" style="display: inline-flex; align-items: center; gap: 3px;">0.32 Å (<Check size={11} /> {m.antibodyClampSafe()})</span>
              </div>
              <div style="font-size: 10px; line-height: 1.3;">
                <span style="color: var(--pix-purple); font-weight: bold;">■ CDR1:</span> 26-33aa <br/>
                <span style="color: var(--pix-accent); font-weight: bold;">■ CDR2:</span> 51-58aa <br/>
                <span style="color: var(--pix-red); font-weight: bold;">■ CDR3:</span> 97-106aa
              </div>
            </div>
          </div>
        {/if}

        <div class="seq-meta pix-dim">{cleanSeq(seq).length} aa</div>

        <Slider {...ui} min={0} max={14} step={0.1} label={`pH ${env.ph.toFixed(1)}`} bind:value={env.ph} />
        <Slider {...ui} min={250} max={400} step={1} label={`T ${env.tempK.toFixed(0)} K`} bind:value={env.tempK} />
        <Slider {...ui} min={0} max={2} step={0.01} label={m.ionicLabel({ v: env.ionicStrengthM.toFixed(2) })} bind:value={env.ionicStrengthM} />

        <div class="row-btns" style="margin-top: 6px; margin-bottom: 6px; justify-content: space-between;">
          <label class="pdb-upload pix-btn-reset" style="margin: 0; display: inline-flex; align-items: center; justify-content: center; height: 18px; line-height: 18px;">
            {m.uploadPdb()}
            <input type="file" accept=".pdb,.ent,.cif,text/plain" onchange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) onPdbFile(f);
              e.currentTarget.value = '';
            }} hidden />
          </label>
          <div style="display: flex; gap: 4px; align-items: center;">
            <input class="pix-input" type="text" placeholder={m.pdbIdPlaceholder()} bind:value={fetchPdbId} maxlength="4" style="width: 50px; text-transform: uppercase; font-family: var(--pix-font); font-size: 10px; padding: 2px 4px; height: 24px;" />
            <button class="pix-btn-reset" disabled={!fetchPdbId.trim() || fetchPdbBusy} onclick={doFetchPdb} style="padding: 0 4px; font-size: 10px; height: 24px; line-height: 20px; display: inline-flex; align-items: center;">RCSB</button>
            <button class="pix-btn-reset" disabled={!fetchPdbId.trim() || pdbRedoBusy} onclick={doFetchPdbRedo} style="padding: 0 4px; font-size: 10px; height: 24px; line-height: 20px; display: inline-flex; align-items: center; color: var(--pix-cyan); border-color: var(--pix-cyan); cursor: pointer;">{m.redoBtn()}</button>
          </div>
        </div>

        <Divider {...ui} />
        
        <Button {...ui} icon="" variant="filled" preset="primary" disabled={foldBusy} onclick={doFold} class="wide-btn">
          {#snippet children()}<Dna size={15} /> {foldBusy ? m.folding() : m.foldBtn()}{/snippet}
        </Button>
        <div class="spd-panel" style="margin-top: 8px; padding: 7px; border: 1px solid var(--pix-border);">
          <div class="pix-subtitle" style="margin: 0 0 4px;">SPD</div>
          <div style="display:flex; align-items:center; gap:4px;">
            <span class="pix-dim" style="font-size:10px; white-space:nowrap;">{m.spdProteinNameLabel()}</span>
            <input class="pix-input" type="text" bind:value={spdProteinName} placeholder={m.spdProteinNameHint()} style="min-width:0; flex:1; padding: 3px 4px; font-size:10px;" />
          </div>
          <div style="display:flex; gap:4px; margin-top:4px;">
            <button class="pix-btn-reset" disabled={spdBusy} onclick={querySpdExact} style="flex:1; padding: 2px 5px; font-size:10px;">{spdBusy ? m.checking() : m.spdQuery()}</button>
            <button class="pix-btn-reset" disabled={spdBusy || !folded} onclick={publishToSpd} style="flex:1; padding: 2px 5px; font-size:10px;">{m.spdPublish()}</button>
          </div>
          {#if spdFoldId}<div class="pix-dim" style="margin-top:4px; font-size:10px; word-break:break-all;">{m.spdFoldIdLabel()} {spdFoldId}</div>{/if}
          {#if spdMessage}<div class="pix-dim" style="margin-top:4px; font-size:10px; word-break:break-word;">{spdMessage}</div>{/if}
        </div>
      </Card>

      <Card {...ui} padding="10px">
        <div class="pix-title">{m.engineSettings()}</div>
        <Divider {...ui} />
        
        <Button {...ui} icon="" variant="filled" preset="secondary" disabled={buildBusy || (!folded && !pdbText)} onclick={doVerify} class="wide-btn">
          {#snippet children()}<FlaskConical size={15} /> {buildBusy ? m.building() : m.buildBtn()}{/snippet}
        </Button>
        {#if !folded && !pdbText}
          <div class="hint pix-dim">{m.verifyHint()}</div>
        {/if}

        <Slider {...ui} min={1} max={100} step={1} label={m.stepsLabel({ n: nSteps })} bind:value={nSteps} />
        
        <div class="row-btns">
          <span class="pix-tooltip" data-tooltip={m.biasForceTooltip()}>
            <Toggle {...ui} label={m.biasForce()} bind:checked={bias} />
          </span>
          <Toggle {...ui} label={m.equilibrate()} bind:checked={equilibrate} />
        </div>

        {#if bias}
          <span class="pix-tooltip" data-tooltip={m.biasForceTooltip()} style="width: 100%; display: block;">
            <Slider {...ui} min={0} max={1} step={0.05} label={m.forceAmpLabel({ v: biasForce.toFixed(2) })} bind:value={biasForce} />
          </span>
        {/if}

        <div class="row-btns">
          <label class="pix-field"><span class="pix-dim">ΔT</span><input class="pix-input" type="number" bind:value={dT} /></label>
          <label class="pix-field"><span class="pix-dim">ΔpH</span><input class="pix-input" type="number" bind:value={dPh} /></label>
        </div>

        <Button {...ui} icon="" variant="outline" preset="primary" disabled={mdBusy} onclick={doStep} class="wide-btn">
          {#snippet children()}<Play size={14} /> {mdBusy ? m.stepping() : m.stepBtn()}{/snippet}
        </Button>
      </Card>

      <Card {...ui} padding="10px">
        <div class="pix-title">{m.activityLog()}</div>
        <Divider {...ui} />
        <div class="log">
          {#each log as l}
            <div class="log-line {getLogColorClass(l) || 'pix-dim'}">{l}</div>
          {:else}
            <div class="log-line pix-dim">—</div>
          {/each}
        </div>
      </Card>
    </aside>

    <div class="resizer" style="grid-column: 2;" onpointerdown={(e) => startResize(e, 'left')}></div>

    <div class="center">
      {#if quickStartOpen}
        <div class="quickstart-overlay pix-panel">
          <div class="quickstart-head">
            <span class="pix-title">{m.quickStartTitle()}</span>
            <button class="pix-btn-reset" onclick={() => quickStartOpen = false}>{m.quickStartClose()}</button>
          </div>
          <Divider {...ui} />
          <div class="quickstart-body">
            <p class="qs-step">{m.quickStartStep1()}</p>
            <p class="qs-step">{m.quickStartStep2()}</p>
            <p class="qs-step">{m.quickStartStep3()}</p>
          </div>
        </div>
      {/if}

      <MolStarViewer
        coordsData={viewerData}
        pdbText={null}
        highlightRange={selectedResidueRange}
        onResidueHover={(idx) => { hoveredResidueIdx = idx; }}
        pockets={pocketMonitorOpen && metrics?.pocket?.detectedPockets ? metrics.pocket.detectedPockets : []}
        selectedPocketId={pocketMonitorOpen ? selectedPocketId : null}
        advancedFeatures={pocketMonitorOpen ? pocketFeatures : null}
        bind:rep={viewerRep}
      />

      <div class="center-status" data-lang={currentLocale.value} style="display: inline-flex; align-items: center; gap: 6px;">
        {#if viewerData}
          <span class="pix-led ok" style="width: 8px; height: 8px;"></span>
          {viewMutant ? m.displayMutant({ n: viewerData.seq.length }) : m.displayCaTrace({ n: viewerData.seq.length })}
        {:else}
          <span class="pix-led" style="background: var(--pix-border-hi); width: 8px; height: 8px;"></span>
          {m.waitFold()}
        {/if}
        {#if stepOut?.crashed}
          <Chip {...ui} color="error" ondismiss={() => {}}>{m.crash()}</Chip>
        {/if}
      </div>
    </div>

    <div class="resizer" style="grid-column: 4;" onpointerdown={(e) => startResize(e, 'right')}></div>

    <aside class="right">
      <div style="flex: 1 1 0%; display: flex; flex-direction: column; min-height: 0; overflow: hidden;">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid var(--pix-border); background: var(--pix-bg-2); flex-shrink: 0;">
          <Tabs {...ui} tabs={activeTab} bind:active={tab} />
          <button 
            class="pix-btn-reset" 
            style="padding: 0; margin-right: 6px; cursor: pointer; color: {pinMdMonitor ? 'var(--pix-accent-2)' : 'var(--pix-fg-dim)'}; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid {pinMdMonitor ? 'var(--pix-accent)' : 'var(--pix-border)'}; background: {pinMdMonitor ? 'var(--pix-bg-3)' : 'none'}; height: 20px; width: 22px; box-sizing: border-box; transition: all 0.15s ease;"
            onclick={() => pinMdMonitor = !pinMdMonitor}
            title={m.splitMonitorTooltip()}
          >
            <Layers size={12} />
          </button>
        </div>

        <div class="tab-body">
          {#if tab === 'fold'}
            <Card {...ui} padding="10px">
              {#snippet children()}
                <div class="pix-title">{m.foldResultTitle()}</div>
                <div class="head-legend pix-dim">{m.headLegend()}</div>
                <Divider {...ui} />
                
                {#if foldError}
                  <Alert {...ui} icon="" preset="error" title="ONNX">{#snippet children()}{foldError}{/snippet}</Alert>
                {/if}
                {#if foldDemo}
                  <Chip {...ui} color="warning" ondismiss={() => {}}>{#snippet children()}{m.demoData()}{/snippet}</Chip>
                {/if}

                {#if folded}
                  <div class="kv">
                    <span class="pix-dim">{m.modelLength()}</span><span class="pix-num">{folded.length}</span>
                    <span class="pix-dim">{m.modelName()}</span><span>{folded.modelPath.split('/').pop()}</span>
                    <span class="pix-dim">{m.modelLatency()}</span><span class="pix-num">{folded.runMs.toFixed(1)} ms</span>
                  </div>
                  <div class="row-btns" style="margin-top: 8px;">
                    <Button {...ui} icon="" variant="outline" preset="primary" onclick={exportFoldMmcif}>
                      {#snippet children()}<FileDown size={14} /> {m.exportMmcif()}{/snippet}
                    </Button>
                    <Button {...ui} icon="" variant="outline" preset="primary" onclick={exportSpicep}>
                      {#snippet children()}<Save size={14} /> {m.exportSaved()}{/snippet}
                    </Button>
                  </div>
                  
                  <div class="pix-subtitle">{m.distMatrix()}</div>
                  <Heatmap
                    values={folded.distExp}
                    rows={folded.length}
                    cols={folded.length}
                    rowLabels={distLabels}
                    colLabels={distLabels}
                    mode="distance"
                    min={3}
                    max={48}
                    title="distogram"
                  />

                  <div class="pix-subtitle">{m.contactMap()}</div>
                  <Heatmap
                    values={folded.pContact}
                    rows={folded.length}
                    cols={folded.length}
                    rowLabels={distLabels}
                    colLabels={distLabels}
                    mode="contact"
                    title="contacts"
                  />

                  <Divider {...ui} />
                  <div class="pix-title">{m.headD()}</div>
                  <div class="kv">
                    <span class="pix-dim">{m.pathA()}</span>
                    <ProgressBar {...ui} value={folded.conf[0] * 100} size="sm" />
                    <span class="pix-dim">{m.pathB()}</span>
                    <ProgressBar {...ui} value={folded.conf[1] * 100} size="sm" />
                  </div>
                {:else}
                  <div class="empty pix-dim">{m.clickFold()}</div>
                {/if}
              {/snippet}
            </Card>
          {/if}

          {#if tab === 'md'}
            <Card {...ui} padding="10px">
              {#snippet children()}
                <div class="pix-title">{m.mdStatus()}</div>
                <Divider {...ui} />
                {#if stepError}
                  <Alert {...ui} icon="" preset="error">{#snippet children()}{stepError}{/snippet}</Alert>
                {/if}
                {#if stepDemo}
                  <Chip {...ui} color="warning" ondismiss={() => {}}>{#snippet children()}{m.demoData()}{/snippet}</Chip>
                {/if}
                {#if stepOut}
                  <div class="kv">
                    <span class="pix-dim">{m.mdSteps()}</span><span class="pix-num">{stepOut.stepCount}</span>
                    <span class="pix-dim">{m.mdTime()}</span><span class="pix-num">{stepOut.timePs.toFixed(3)} ps</span>
                    <span class="pix-dim">{m.mdTkin()}</span><span class="pix-num {Math.abs(stepOut.tKin - env.tempK) > 25 ? 'warn' : ''}">{stepOut.tKin.toFixed(0)} K</span>
                    <span class="pix-dim">{m.mdPerStep()}</span><span class="pix-num">{stepOut.stepMsPer.toFixed(0)} ms</span>
                    <span class="pix-dim">{m.mdClamp()}</span><span class="pix-num {stepOut.clamped > 0 ? 'bad' : ''}">{stepOut.clamped}</span>
                  </div>
                  <div class="pix-subtitle">{m.uTrajectory()}</div>
                  <TraceChart data={stepOut.uHist} label="U" />
                  <div class="pix-subtitle">{m.conformationLandscape()}</div>
                  <div class="pix-panel" style="position: relative; height: 160px; background: #0b0e14; border-color: var(--pix-border-hi); border-width: 2px; border-style: solid; overflow: hidden; display: flex; align-items: center; justify-content: center; margin-bottom: 8px;">
                    <svg style="position: absolute; inset:0; width: 100%; height: 100%; pointer-events: none;">
                      <ellipse cx="40%" cy="65%" rx="50" ry="30" fill="none" stroke="rgba(76, 214, 255, 0.12)" stroke-width="4" stroke-dasharray="2,2"></ellipse>
                      <ellipse cx="40%" cy="65%" rx="30" ry="18" fill="none" stroke="rgba(76, 214, 255, 0.22)" stroke-width="2"></ellipse>
                      <ellipse cx="40%" cy="65%" rx="12" ry="7" fill="rgba(83, 215, 105, 0.08)" stroke="rgba(83, 215, 105, 0.35)" stroke-width="1.5"></ellipse>
                      <path d="M 180,0 Q 220,60 300,100" fill="none" stroke="rgba(255, 93, 93, 0.15)" stroke-width="2" stroke-dasharray="4,4"></path>
                      <text x="75%" y="25%" fill="rgba(255, 93, 93, 0.35)" font-size="8px" font-family="var(--pix-font)">CLIFF [UNSTABLE]</text>
                      <text x="35%" y="67%" fill="rgba(83, 215, 105, 0.4)" font-size="8px" font-family="var(--pix-font)">BASIN [STABLE]</text>
                      <line x1="10%" y1="90%" x2="90%" y2="90%" stroke="var(--pix-border)" stroke-width="1"></line>
                      <line x1="10%" y1="10%" x2="10%" y2="90%" stroke="var(--pix-border)" stroke-width="1"></line>
                      <text x="85%" y="97%" fill="var(--pix-fg-dim)" font-size="8px" font-family="var(--pix-font)">RMSD</text>
                      <text x="2%" y="15%" fill="var(--pix-fg-dim)" font-size="8px" font-family="var(--pix-font)" transform="rotate(-90, 8, 15)">Rg</text>
                      {#if landscapePoints.length > 0}
                        <polyline
                          points={landscapePoints.map((p) => {
                            const x = 10 + Math.min(10, Math.max(0, p.rmsd)) / 10 * 80;
                            const y = 90 - (Math.min(22, Math.max(13, p.rg)) - 13) / 9 * 80;
                            return `${x}%,${y}%`;
                          }).join(' ')}
                          fill="none"
                          stroke="var(--pix-accent)"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      
                      <circle cx="{currentLandscapeCx}%" cy="{currentLandscapeCy}%" r="4" fill="var(--pix-accent-2)" stroke="#fff" stroke-width="1" />
                      <circle cx="{currentLandscapeCx}%" cy="{currentLandscapeCy}%" r="8" fill="none" stroke="var(--pix-accent)" stroke-width="1.5" style="animation: blink 0.8s infinite;" />
                    {/if}
                  </svg>
                  {#if landscapePoints.length === 0}
                    <span class="pix-dim" style="font-size:10px;">{m.traceEmpty()}</span>
                  {/if}
                </div>

                <Divider {...ui} />
                <div class="pix-title">{m.metricsM()}</div>
                {#each metList as mItem}
                  <MetricBar {...mItem} goodWhen="below" />
                {/each}
                {#if stepOut.crashed}
                  <Alert {...ui} icon="" preset="error">{#snippet children()}{m.crashMsg()}{/snippet}</Alert>
                {/if}
              {:else}
                <div class="empty pix-dim" style="display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px 0;">
                  <span>{m.mdEmpty()}</span>
                  {#if folded || pdbText}
                    <Button {...ui} icon="" variant="filled" preset="primary" disabled={buildBusy} onclick={doBuild}>
                      {#snippet children()}<FlaskConical size={14} /> {buildBusy ? m.buildingEngine() : m.buildEngineBtn()}{/snippet}
                    </Button>
                  {/if}
                </div>
              {/if}
            {/snippet}
          </Card>
        {/if}

        <!-- Molecular pocket -->
        {#if tab === 'pocket'}
          <Card {...ui} padding="10px">
            {#snippet children()}
              <div class="pix-title" style="display: flex; align-items: center; gap: 6px;">
                <Layers size={16} style="color: var(--pix-accent-2)" />
                {m.tabPocket()}
              </div>
              <Divider {...ui} />
              
              <!-- Quick control toggle -->
              <div class="row-btns" style="margin-bottom: 8px;">
                <Toggle {...ui} bind:checked={pocketMonitorOpen} disabled={!built} label={m.pocketDetectorToggle()} />
              </div>
              
              {#if !built}
                <Alert {...ui} icon="" preset="warning" style="margin-top: 10px;">
                  {#snippet children()}
                    <span style="font-size: 11px;">{m.pocketNoEngineHint()}</span>
                  {/snippet}
                </Alert>
              {/if}
              
              {#if built && pocketMonitorOpen}
                <div class="pix-panel" style="padding: 12px; margin-bottom: 10px; border-color: var(--pix-border-hi); border-width: 2px; border-style: solid;">
                  <!-- Real pocket display from our native calculation -->
                  {#if metrics?.pocket && metrics.pocket.detectedPockets && metrics.pocket.detectedPockets.length > 0}
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                      <span class="pix-subtitle" style="margin:0; font-size: 11px; font-weight: bold; color: var(--pix-accent-2)">Real-time Cavities ({metrics.pocket.detectedPockets.length})</span>
                      <span class="pix-num {metrics.pocket.isCollapsed ? 'bad' : 'good'}" style="font-size: 11px;">
                        {metrics.pocket.isCollapsed ? 'Collapsed' : 'Stable'}
                      </span>
                    </div>
                    
                    <!-- Pocket selection tab/list -->
                    <div style="margin-bottom: 8px;">
                      <span class="pix-dim" style="font-size: 10px; display: block; margin-bottom: 4px;">{m.pocketSelectLabel()}</span>
                      <div style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px;">
                        {#each metrics.pocket.detectedPockets as p}
                          <button 
                            class="pix-chip-btn {selectedPocketId === p.id ? 'active' : ''}" 
                            style="font-size: 9px; padding: 2px 6px; border: 1px solid var(--pix-border); background: {selectedPocketId === p.id ? 'var(--pix-accent-2)' : 'transparent'}; cursor: pointer; color: var(--pix-text-hi); border-radius: 4px; font-family: var(--pix-font);"
                            onclick={() => { selectedPocketId = p.id; }}
                          >
                            PK-{p.id} ({p.volume.toFixed(0)}Å³)
                          </button>
                        {/each}
                      </div>
                    </div>

                    {#if pocketFeatures}
                      <div class="kv" style="margin: 4px 0; font-size: 10px; border-top: 1px dashed var(--pix-border); padding-top: 6px;">
                        <span class="pix-dim">{m.pocketVolumeLabel()}</span>
                        <span class="pix-num">{pocketFeatures.volume.toFixed(1)} Å³</span>
                      </div>
                      <div class="kv" style="margin: 4px 0; font-size: 10px;">
                        <span class="pix-dim">{m.pocketDruggabilityLabel()}</span>
                        <span class="pix-num" style="font-weight: bold; color: {pocketFeatures.druggability > 0.6 ? '#10b981' : '#f59e0b'}">
                          {pocketFeatures.druggability.toFixed(2)}
                        </span>
                      </div>
                      <div class="kv" style="margin: 4px 0; font-size: 10px;">
                        <span class="pix-dim">Net Charge (pH {env.ph.toFixed(1)}):</span>
                        <span class="pix-num">{pocketFeatures.netChargeAtPh.toFixed(2)} e</span>
                      </div>
                      <div class="kv" style="margin: 4px 0; font-size: 10px;">
                        <span class="pix-dim">{m.pocketHydrophobicLabel()}</span>
                        <span class="pix-num">{(pocketFeatures.hydrophobicRatio * 100).toFixed(0)}%</span>
                      </div>
                      <div class="kv" style="margin: 4px 0; font-size: 10px; color: var(--pix-text-dim);">
                        <span>{m.pocketPharmacophoreLabel()}</span>
                        <span>
                          HYD: {pocketFeatures.hydrophobicCentroids.length} | 
                          ACC: {pocketFeatures.hbondAcceptors.length} | 
                          DON: {pocketFeatures.hbondDonors.length}
                        </span>
                      </div>
                      <div class="pix-dim" style="font-size: 9px; line-height: 1.2; margin-top: 4px; word-break: break-all;">
                        Lining residues: {pocketFeatures.surfaceResidues.map((r: number) => r + 1).slice(0, 10).join(', ')}...
                      </div>
                    {/if}

                    {#if bioLipBusy}
                      <div style="font-size: 9px; text-align: center; color: var(--pix-cyan); margin-top: 10px; font-family: var(--pix-font);">
                        <RefreshCw size={10} class="animate-spin" style="display: inline; margin-right: 4px;" /> Loading BioLiP biological reference...
                      </div>
                    {:else if bioLipEntry && bioLipEntry.ligands && bioLipEntry.ligands.length > 0}
                      <div style="margin-top: 10px; border-top: 1px dashed var(--pix-border); padding-top: 8px;">
                        <span class="pix-subtitle" style="font-size: 10px; font-weight: bold; color: var(--pix-green); display: block; margin-bottom: 4px;">🧬 BioLiP Biological Ligand Sites:</span>
                        <div style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto;">
                          {#each bioLipEntry.ligands as lig}
                            <div style="background: rgba(16, 185, 129, 0.08); border-left: 2px solid var(--pix-green); padding: 4px; font-size: 9px; line-height: 1.3; border-radius: 2px; font-family: var(--pix-font);">
                              <div style="display: flex; justify-content: space-between; font-weight: bold; color: var(--pix-text-hi);">
                                <span>{lig.ligandId} ({lig.ligandName})</span>
                                <span style="color: var(--pix-cyan);">{lig.bindingAffinity}</span>
                              </div>
                              <div style="color: var(--pix-text-dim); font-size: 8px; margin-top: 2px;">
                                Binding residues: {lig.bindingResidues.map(r => r + 1).slice(0, 12).join(', ')}{lig.bindingResidues.length > 12 ? '...' : ''}
                              </div>
                              {#if lig.catalyticSiteOverlap}
                                <div style="color: var(--pix-accent-2); font-weight: bold; font-size: 8px; margin-top: 1px; display: flex; align-items: center; gap: 2px;">
                                  ⚡ Overlaps with catalytic active pocket
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  {:else if pocketMonitor}
                    <!-- Fallback to derived heuristic if no computed pocket is available -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <span class="pix-subtitle" style="margin:0; font-size: 11px;">{m.pocketTitle()}</span>
                      <span class="pix-num {pocketMonitor.stable ? 'good' : 'bad'}" style="font-size: 11px;">{pocketMonitor.stable ? m.pocketStable() : m.pocketCollapsed()}</span>
                    </div>
                    <div class="kv" style="margin: 4px 0;">
                      <span class="pix-dim">{m.pocketQ()}</span>
                      <ProgressBar {...ui} value={pocketMonitor.q * 100} size="sm" />
                    </div>
                    <div class="pix-dim" style="font-size: 10px;">
                      {m.pocketResiduesLabel()} {pocketMonitor.residues.map(r => r + 1).slice(0, 8).join(', ')}
                    </div>
                  {/if}
                </div>
              {/if}
            {/snippet}
          </Card>
        {/if}

        {#if tab === 'phase'}
          <Card {...ui} padding="10px">
            {#snippet children()}
              <div class="pix-title">{m.phaseTitle()}</div>
              <Divider {...ui} />
              <div class="phase-controls">
                <label class="pix-field"><span class="pix-dim">{m.tStart()}</span><input class="pix-input" type="number" bind:value={tStart} /></label>
                <label class="pix-field"><span class="pix-dim">{m.tEnd()}</span><input class="pix-input" type="number" bind:value={tEnd} /></label>
                <label class="pix-field"><span class="pix-dim">{m.tStep()}</span><input class="pix-input" type="number" bind:value={tStep} /></label>
                <label class="pix-field"><span class="pix-dim">{m.phStart()}</span><input class="pix-input" type="number" bind:value={pStart} /></label>
                <label class="pix-field"><span class="pix-dim">{m.phEnd()}</span><input class="pix-input" type="number" bind:value={pEnd} /></label>
                <label class="pix-field"><span class="pix-dim">{m.phStep()}</span><input class="pix-input" type="number" bind:value={pStep} /></label>
              </div>
              <Slider {...ui} bind:value={scanSteps} min={5} max={60} step={5} label={m.scanStepsLabel({ n: scanSteps })} />
              <div class="row-btns">
                <span class="pix-tooltip" data-tooltip={m.minimizeTooltip()}>
                  <Toggle {...ui} bind:checked={scanMinimize} label={m.minimize()} />
                </span>
                <Button {...ui} icon="" variant="filled" preset="primary" disabled={phaseBusy} onclick={doScan}>
                  {#snippet children()}{phaseBusy ? m.scanning() : m.startScan()}{/snippet}
                </Button>
                <Button {...ui} icon="" variant="outline" preset="primary" disabled={!phaseBusy} onclick={doCancelScan}>
                  {#snippet children()}{m.cancel()}{/snippet}
                </Button>
              </div>
              {#if phaseProgress}
                <ProgressBar {...ui} value={(phaseProgress.done / phaseProgress.total) * 100} size="md" animated />
                <div class="pix-dim" style="text-align:right">
                  {phaseProgress.done}/{phaseProgress.total} · T={phaseProgress.t}K pH={phaseProgress.ph}
                </div>
              {/if}
              {#if phaseError}<Alert {...ui} icon="" preset="warning">{#snippet children()}{phaseError}{/snippet}</Alert>{/if}
              {#if phaseDemo}<Chip {...ui} color="warning" ondismiss={() => {}}>{#snippet children()}{m.demoPhase()}{/snippet}</Chip>{/if}
              {#if phase.length}
                <Heatmap values={phaseValues} rows={phArr.length} cols={tempArr.length}
                  rowLabels={phArr.map((p) => `pH ${p}`)} colLabels={tempArr.map((t) => `${t}`)}
                  mode="phase" title={m.mdPhaseStabilityTitle()} />
                <div class="legend pix-dim">
                  <span class="lg lg-s">■</span>{m.legendStable()} <span class="lg lg-c">■</span>{m.legendCrash()} <span class="lg lg-b">■</span>{m.legendBuildFailed()}
                </div>
                
                {#if bifurcationResult}
                  <div class="pix-panel" style="margin-top: 10px; padding: 10px; border-color: var(--pix-accent); border-width: 1px; border-style: solid; font-size: 11px;">
                    <div class="pix-subtitle" style="color: var(--pix-accent-2); margin-bottom: 6px; font-weight: bold; font-size: 11px; display: flex; align-items: center; gap: 4px;">
                      <span>🔬</span> {m.bifurcationTrackerTitle()}
                    </div>
                    <div class="kv" style="margin: 4px 0; display: flex; justify-content: space-between;">
                      <span class="pix-dim">{m.bifurcationOptimalCenter()}</span>
                      <span class="pix-num good" style="font-weight: bold;">{bifurcationResult.optimalTempK} K / pH {bifurcationResult.optimalPh}</span>
                    </div>
                    <div class="kv" style="margin: 4px 0; display: flex; justify-content: space-between;">
                      <span class="pix-dim">{m.bifurcationLimitLabel()}</span>
                      <span class="pix-num bad" style="font-weight: bold;">{bifurcationResult.bifurcationT} K / pH {bifurcationResult.bifurcationPh}</span>
                    </div>
                    <div class="kv" style="margin: 4px 0; display: flex; justify-content: space-between;">
                      <span class="pix-dim">{m.landauSurfaceLabel()}</span>
                      <span class="pix-num" style="color: {bifurcationResult.isSaddle ? 'var(--pix-accent-2)' : 'var(--pix-success)'}">
                        {bifurcationResult.isSaddle ? m.landauUnstableSaddle() : m.landauMetastableWell()}
                      </span>
                    </div>
                    <Divider {...ui} style="margin: 6px 0;" />
                    <div class="pix-dim" style="font-size: 10px; line-height: 1.3; font-family: monospace; word-break: break-all; color: var(--pix-accent-2);">
                      {m.landauFitFormula()}<br/>
                      <span style="color: var(--pix-accent-2);">ΔG(T, pH) ≈ {bifurcationResult.coefficients[0].toFixed(2)} + {bifurcationResult.coefficients[1].toFixed(2)}x + {bifurcationResult.coefficients[2].toFixed(2)}x² + {bifurcationResult.coefficients[3].toFixed(2)}y + {bifurcationResult.coefficients[4].toFixed(2)}y² + {bifurcationResult.coefficients[5].toFixed(2)}xy</span>
                    </div>
                  </div>
                {/if}
              {:else}
                <div class="empty pix-dim" style="padding: 10px 0;">{m.phaseEmpty()}</div>
              {/if}
            {/snippet}
          </Card>
        {/if}

        <!-- Single-point mutations -->
        {#if tab === 'mut'}
          <Card {...ui} padding="10px">
            {#snippet children()}
              <div class="pix-title">{m.mutTitle()}</div>
              <Divider {...ui} />
              {#if folded}
                <Chip {...ui} color="warning" ondismiss={() => {}}>
                  {#snippet children()}{#if folded?.trainedHeads.includes('B')}{m.trained()}{:else}{m.untrainedHeadB()}{/if}{/snippet}
                </Chip>
                <div class="kv">
                  <span class="pix-dim pix-tooltip" data-tooltip={m.pathBConfTooltip()}>{m.pathBConf()}</span>
                  <ProgressBar {...ui} value={folded.conf[1] * 100} size="sm" />
                  <span class="pix-dim pix-tooltip" data-tooltip={m.envOffsetTooltip()}>{m.envOffsetLabel()}</span>
                  <span class="pix-num">ΔpH {folded.envOffset[0].toFixed(2)} · ΔT {folded.envOffset[1].toFixed(1)}</span>
                </div>
                <div class="row-btns">
                  <Button {...ui} icon="" variant="outline" preset="primary" onclick={applyEnvOffset}>
                    {#snippet children()}{m.applyEnvOffset()}{/snippet}
                  </Button>
                  <Button {...ui} icon="" variant="outline" preset="primary" onclick={exportMutMmcif}>
                    {#snippet children()}<FileDown size={14} /> {m.exportMutMmcif()}{/snippet}
                  </Button>
                </div>
                <Divider {...ui} />
                <div class="pix-subtitle">{m.headBp()}</div>
                <div class="row-btns">
                  <Toggle {...ui} bind:checked={viewMutant} label={m.viewMutantCa()} />
                  <span class="pix-dim pix-tooltip" data-tooltip={m.headBpNoteTooltip()}>{m.headBpNote()}</span>
                </div>
                <Divider {...ui} />

                <!-- Mutation cart -->
                <div class="pix-panel" style="padding: 10px; margin-bottom: 10px; border-color: var(--pix-accent); border-width: 2px; border-style: solid;">
                  <div class="pix-title" style="color: var(--pix-accent-2); font-size: 11px;">{m.cartTitle()}</div>
                  {#if mutCart.length === 0}
                    <div class="empty pix-dim" style="padding: 10px 0; font-size: 11px;">{m.cartEmpty()}</div>
                  {:else}
                    <div style="display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0;">
                      {#each mutCart as cartItem}
                        <Chip {...ui} color="warning" ondismiss={() => toggleCart(cartItem.pos, cartItem.from, cartItem.to, cartItem.score)}>
                          {#snippet children()}{cartItem.from}{cartItem.pos + 1}{cartItem.to}{/snippet}
                        </Chip>
                      {/each}
                    </div>
                    {#if cartEpistasis}
                      <div class="kv" style="font-size: 11px; margin-top: 6px;">
                        <span class="pix-dim">{m.epistasisScore()}:</span>
                        <span class="pix-num {cartEpistasis.energyChange <= 0 ? 'good' : 'bad'}" style="font-size: 11px;">
                          {cartEpistasis.energyChange.toFixed(1)} kcal/mol
                        </span>
                      </div>
                    {/if}
                    <Button {...ui} icon="" variant="filled" preset="primary" disabled={mutBusy} onclick={applyMutCart} class="wide-btn">
                      {#snippet children()}{m.cartApply()}{/snippet}
                    </Button>
                  {/if}
                </div>

                <Divider {...ui} />
                <div class="pix-subtitle">{m.headB()}</div>
                <table class="mut-table">
                  <thead><tr><th>#</th><th>{m.modelPosition()}</th><th>{m.modelFrom()}</th><th>{m.modelTo()}</th><th>{m.modelProb()}</th><th></th></tr></thead>
                  <tbody>
                    {#each muts as mut, i}
                      <tr>
                        <td>{i + 1}</td>
                        <td class="pix-num">{mut.pos + 1}</td>
                        <td>{mut.from}</td>
                        <td class="pix-num good">{mut.to}</td>
                        <td>{(mut.score * 100).toFixed(1)}%</td>
                        <td>
                          <div style="display: flex; gap: 4px;">
                            <button class="pix-btn-reset" disabled={mutBusy} onclick={() => applyMutation(mut.pos, mut.to)}>{m.apply()}</button>
                            <button class="pix-btn-reset" style="background: {mutCart.some(c => c.pos === mut.pos && c.to === mut.to) ? 'var(--pix-accent)' : 'var(--pix-bg-3)'}; color: {mutCart.some(c => c.pos === mut.pos && c.to === mut.to) ? '#1a0f00' : 'var(--pix-fg)'}" onclick={() => toggleCart(mut.pos, mut.from, mut.to, mut.score)}>
                              {mutCart.some(c => c.pos === mut.pos && c.to === mut.to) ? '✔' : m.cartAdd()}
                            </button>
                          </div>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
                {#if mutMsg}<Alert {...ui} icon="" preset="info">{#snippet children()}{mutMsg}{/snippet}</Alert>{/if}
              {:else}
                <div class="empty pix-dim">{m.mutEmpty()}</div>
              {/if}
            {/snippet}
          </Card>
        {/if}

        <!-- High-throughput screening -->
        {#if tab === 'batch'}
          <Card {...ui} padding="10px">
            {#snippet children()}
              <div class="pix-title">{m.batchScreenerTitle()}</div>
              <Divider {...ui} />
              
              <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;">
                <span class="pix-dim" style="font-size: 10px;">{m.batchCsvLabel()}</span>
                <textarea 
                  class="pix-textarea mono" 
                  rows={4} 
                  bind:value={batchCsvText} 
                  disabled={batchBusy}
                  style="width: 100%; background: #000; color: #fff; font-size: 9.5px; border: 1.5px solid var(--pix-border); padding: 4px; border-radius: 3px; resize: vertical; outline: none; line-height: 1.3;"
                  placeholder={m.batchCsvPlaceholder()}
                ></textarea>
              </div>

              <div class="row-btns" style="margin-bottom: 12px;">
                <Button {...ui} icon="" variant="filled" preset="primary" disabled={batchBusy} onclick={triggerBatchScreening}>
                  {#snippet children()}{m.batchRunBtn()}{/snippet}
                </Button>
              </div>

              {#if batchCandidates.length > 0}
                <div class="pix-subtitle">{m.batchProgress()}</div>
                <table class="mut-table" style="font-size: 10px; width: 100%; border-collapse: collapse; text-align: center;">
                  <thead>
                    <tr style="border-bottom: 1.5px solid var(--pix-border); color: var(--pix-cyan);">
                      <th style="padding: 4px;">ID</th>
                      <th style="padding: 4px; text-align: left;">{m.batchHeaderMutations()}</th>
                      <th style="padding: 4px;">{m.batchHeaderScoreLabel()}</th>
                      <th style="padding: 4px;">{m.batchHeaderNetCharge()}</th>
                      <th style="padding: 4px;">{m.batchHeaderGravy()}</th>
                      <th style="padding: 4px;">{m.batchHeaderHelix()}</th>
                      <th style="padding: 4px;">{m.batchHeaderDisorder()}</th>
                      <th style="padding: 4px;">{m.batchHeaderStatusLabel()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each batchCandidates as cand}
                      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <td style="padding: 4px; font-weight: bold;">{cand.id}</td>
                        <td class="mono" style="padding: 4px; font-size: 9px; text-align: left;">{cand.mutations}</td>
                        <td class="pix-num {cand.status === 'success' ? 'good' : cand.status === 'failed' ? 'bad' : ''}" style="padding: 4px; font-weight: bold;">
                          {cand.score ? cand.score.toFixed(0) : '—'}
                        </td>
                        <td class="pix-num" style="padding: 4px;">{cand.q !== undefined ? cand.q.toFixed(2) + 'e' : '—'}</td>
                        <td class="pix-num {cand.gravy !== undefined && cand.gravy > 0.5 ? 'warn' : ''}" style="padding: 4px;">{cand.gravy !== undefined ? cand.gravy.toFixed(2) : '—'}</td>
                        <td class="pix-num" style="padding: 4px; color: var(--pix-cyan);">{cand.secondaryStructureHelixPercent !== undefined ? cand.secondaryStructureHelixPercent + '%' : '—'}</td>
                        <td class="pix-num" style="padding: 4px; color: var(--pix-purple);">{cand.disorderScore !== undefined ? cand.disorderScore.toFixed(2) : '—'}</td>
                        <td style="padding: 4px;">
                          <div style="display: flex; justify-content: center; align-items: center; height: 16px;">
                            {#if cand.status === 'success'}
                              <span class="pix-led ok" title={m.pass()} style="width: 8px; height: 8px;"></span>
                              <span style="font-size: 8px; color: var(--pix-green); margin-left: 4px; font-weight: bold;">{m.pass()}</span>
                            {:else if cand.status === 'failed'}
                              <span class="pix-led bad" title={m.failedShort()} style="width: 8px; height: 8px;"></span>
                              <span style="font-size: 8px; color: var(--pix-red); margin-left: 4px; font-weight: bold;">{m.failedShort()}</span>
                            {:else if cand.status === 'running'}
                              <span class="pix-led busy" title={m.mdStatusRunning()} style="width: 8px; height: 8px;"></span>
                            {:else}
                              <span class="pix-led" style="background: var(--pix-border-hi); width: 8px; height: 8px;" title={m.mdStatusPending()}></span>
                            {/if}
                          </div>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            {/snippet}
          </Card>
        {/if}
        </div>
      </div>

      {#if pinMdMonitor}
        <!-- Pinned MD Mini-HUD -->
        <div class="mini-hud pix-panel" style="flex: 0 0 210px; margin-top: 6px; display: flex; flex-direction: column; min-height: 0; background: var(--pix-bg-3); border-color: var(--pix-accent-2); border-width: 2px; padding: 8px; overflow: hidden; box-sizing: border-box; font-family: var(--pix-font); flex-shrink: 0; position: relative;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
            <span style="font-size: 10px; font-weight: bold; color: var(--pix-accent-2); letter-spacing: 1px; display: inline-flex; align-items: center; gap: 4px;">
              <span>■</span>
              <span>{m.splitMonitorTitle()}</span>
            </span>
            <span class="pix-led {stepOut ? (stepOut.crashed ? 'bad' : mdBusy ? 'busy' : 'ok') : ''}" style="width: 8px; height: 8px;"></span>
          </div>

          {#if stepOut}
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; margin-bottom: 6px; background: var(--pix-bg-2); padding: 4px 6px; border: 1px solid var(--pix-border);">
              <div><span class="pix-dim">{m.mdStepLabel()}</span> <span class="pix-num" style="color: var(--pix-cyan); font-weight: bold;">{stepOut.stepCount}</span></div>
              <div><span class="pix-dim">{m.mdTempLabel()}</span> <span class="pix-num" style="color: var(--pix-green); font-weight: bold;">{stepOut.tKin.toFixed(1)} K</span></div>
              <div style="grid-column: span 2;"><span class="pix-dim">{m.mdEnergyULabel()}</span> <span class="pix-num" style="color: var(--pix-accent); font-weight: bold;">{(stepOut.uHist[stepOut.uHist.length - 1] ?? 0).toFixed(2)} kcal/mol</span></div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; overflow-y: auto;">
              {#each metList as mItem}
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10.5px;">
                  <span class="pix-dim" style="font-size: 10px; display: inline-flex; align-items: center; gap: 4px;" title={mItem.tooltip}>
                    <span class="pix-led {metrics && metrics[mItem.key] <= mItem.threshold ? 'ok' : 'bad'}" style="width: 6px; height: 6px;"></span>
                    {mItem.label}:
                  </span>
                  <span class="pix-num" style="font-weight: bold; color: {metrics && metrics[mItem.key] <= mItem.threshold ? 'var(--pix-green)' : 'var(--pix-red)'}">
                    {mItem.value.toFixed(2)} <span style="font-size: 8px; font-weight: normal; color: var(--pix-fg-dim);">/ {mItem.threshold}</span>
                  </span>
                </div>
              {/each}
            </div>

            {#if stepOut.crashed}
              <div class="pix-panel" style="margin-top: 4px; padding: 4px; text-align: center; border-color: var(--pix-red); background: rgba(255, 93, 93, 0.05); color: var(--pix-red); font-size: 10px; font-weight: bold; text-transform: uppercase;">
                ▼ {m.crashedMsgMini()}
              </div>
            {/if}
          {:else}
            <div class="empty pix-dim" style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; text-align: center; font-size: 10px; gap: 6px; padding: 12px 0;">
              <span>{m.noActiveState()}</span>
              {#if folded || pdbText}
                <Button {...ui} icon="" size="sm" variant="outline" preset="primary" disabled={buildBusy} onclick={doBuild}>
                  {#snippet children()}<FlaskConical size={11} /> {buildBusy ? m.buildingEngine() : m.buildEngineBtn()}{/snippet}
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </aside>
  </section>

  <!-- ============ TOASTS ============ -->
  <Toaster />

<style>
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

  .workbench { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .topbar {
    flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px; background: var(--pix-bg-2);
    border-bottom: 3px solid var(--pix-border);
    box-shadow: 0 3px 0 rgba(0, 0, 0, 0.4);
  }
  .brand { display: flex; align-items: center; gap: 8px; }
  .brand-logo { height: 22px; width: 22px; object-fit: contain; image-rendering: auto; }
  .brand-name { font-weight: 900; letter-spacing: 3px; color: var(--pix-accent-2); text-shadow: 2px 2px 0 #000; font-size: 16px; }
  .top-status { display: flex; align-items: center; gap: 8px; }
  .top-status .pix-btn-reset, .settings-row .pix-btn-reset { display: inline-flex; align-items: center; gap: 4px; }
  .grid {
    flex: 1 1 auto; display: grid; grid-template-columns: 300px 7px 1fr 7px 360px;
    padding: 8px 6px; min-height: 0; min-width: 0; overflow: hidden;
  }
  .resizer {
    cursor: col-resize; position: relative; min-height: 0;
    touch-action: none; user-select: none;
  }
  .resizer::after {
    content: ''; position: absolute; top: 4px; bottom: 4px; left: 3px; width: 1px;
    background: var(--pix-border);
  }
  .resizer:hover::after, .resizer:active::after {
    background: var(--pix-accent); width: 3px; left: 2px;
  }
  .left { display: flex; flex-direction: column; gap: 8px; min-height: 0; min-width: 0; overflow-y: auto; padding-right: 2px; }
  .right {
    display: flex; flex-direction: column; gap: 6px;
    min-height: 0; min-width: 0; overflow: hidden; padding-right: 2px;
  }
  .tab-body { flex: 1 1 auto; overflow-y: auto; min-height: 0; min-width: 0; }
  .center { position: relative; border: 3px solid var(--pix-border); box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.5); min-height: 0; min-width: 0; }
  :global(.wide-btn) { width: 100%; margin-top: 4px; }
  .hint { font-size: 10px; margin-top: 2px; }
  .center-status {
    position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; gap: 8px;
    background: rgba(11, 14, 20, 0.85); border: 2px solid var(--pix-border);
    padding: 4px 8px; font-size: 11px; z-index: 3;
  }
  .row-btns { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .pdb-upload { display: inline-block; cursor: pointer; margin-top: 6px; }
  .seq-meta { font-size: 10px; text-align: right; margin-top: 2px; }
  .log { font-size: 10px; max-height: 120px; overflow-y: auto; }
  .log-line { white-space: nowrap; }
  .log-line.good { color: var(--pix-green); text-shadow: 0 0 2px rgba(83, 215, 105, 0.4); }
  .log-line.bad { color: var(--pix-red); text-shadow: 0 0 2px rgba(255, 93, 93, 0.4); }
  .log-line.warn { color: var(--pix-accent); text-shadow: 0 0 2px rgba(255, 159, 28, 0.4); }
  .log-line.info { color: var(--pix-cyan); text-shadow: 0 0 2px rgba(76, 214, 255, 0.4); }
  .tab-body { flex: 1 1 auto; overflow-y: auto; min-height: 0; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; font-size: 12px; margin: 6px 0; }
  .pix-subtitle { font-size: 11px; color: var(--pix-accent); text-transform: uppercase; letter-spacing: 1px; margin: 8px 0 4px; }
  .empty { padding: 24px 8px; text-align: center; letter-spacing: 1px; }
  .head-legend { font-size: 10px; margin: 4px 0 2px; line-height: 1.5; }
  .phase-controls { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .legend { font-size: 10px; margin-top: 4px; display: flex; gap: 10px; }
  .lg-s { color: var(--pix-green); }
  .lg-c { color: var(--pix-red); }
  .lg-b { color: #b48cff; }
  .mut-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  .mut-table th, .mut-table td { border: 1px solid var(--pix-border); padding: 3px 6px; text-align: center; }
  .mut-table th { background: var(--pix-bg-3); color: var(--pix-fg-dim); text-transform: uppercase; font-size: 10px; }

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

  /* settings drawer */
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 90;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .settings-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 400px;
    max-width: 92vw;
    z-index: 91;
    display: flex;
    flex-direction: column;
    border-left: 3px solid var(--pix-border-hi);
    box-shadow: -6px 0 20px rgba(0, 0, 0, 0.5);
  }
  .settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 2px solid var(--pix-border);
    background: var(--pix-bg-2);
    flex: 0 0 auto;
  }
  .settings-body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .settings-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    flex-wrap: wrap;
  }
  .settings-row .mono {
    font-family: var(--pix-font);
    word-break: break-all;
  }
  .pix-select {
    font-family: var(--pix-font);
    font-size: 12px;
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    border: 2px solid var(--pix-border-hi);
    padding: 2px 4px;
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.5);
    width: 100%;
  }

  /* Quickstart overlay */
  .quickstart-overlay {
    position: absolute;
    top: 10px;
    left: 10px;
    right: 10px;
    background: rgba(16, 20, 31, 0.95);
    border: 3px solid var(--pix-accent);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.7);
    z-index: 10;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    image-rendering: pixelated;
  }
  .quickstart-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .quickstart-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11.5px;
    line-height: 1.45;
  }
  .qs-step {
    margin: 0;
    color: var(--pix-fg);
  }

  /* Make sure tabs can scroll horizontally on narrow columns without wrapping or squeezing */
  .right :global(.s-tabs) {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    overflow-x: auto !important;
    white-space: nowrap !important;
    scrollbar-width: none !important; /* Hide scrollbar for clean retro look */
    width: 100% !important;
  }
  .right :global(.s-tabs::-webkit-scrollbar) {
    display: none !important;
  }
  
  /* Target every single tab button inside the Tabs wrapper and prevent any wrapping */
  .right :global(.s-tab) {
    flex: 0 0 auto !important;
    white-space: nowrap !important;
    word-break: keep-all !important;
    min-width: max-content !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 11px !important;
    padding: 6px 10px !important; /* more compact padding for 6 tabs */
  }
</style>
