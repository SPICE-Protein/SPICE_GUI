// Shared types between the Svelte UI and the Tauri (Rust) backend.
// Field names are camelCase — the Rust side uses `#[serde(rename_all = "camelCase")]`.

import * as m from '$lib/paraglide/messages.js';

export interface Result<T> {
  data: T;
  demo?: boolean;
  error?: string;
}

export interface Env {
  ph: number;
  tempK: number;
  pressureBar: number;
  ionicStrengthM: number;
}

export interface FoldOutput {
  length: number;
  /** Head A — Cα trace [L,3] Å */
  coords: number[];
  /** Head B' — mutant Cα trace [L,3] Å (randomly pre-trained, differs from the reference structure) */
  coordsMut: number[];
  /** distogram — expected pairwise Cα distance matrix [L,L] Å */
  distExp: number[];
  /** contact probability (Cα–Cα < 8 Å) [L,L] */
  pContact: number[];
  /** Head B — per-position mutation probabilities [L,20] */
  mutation: number[];
  /** Head C — env offset [ΔpH, ΔT] */
  envOffset: number[];
  /** Head D — two-path confidence [pathA, pathB] ∈ [0,1] */
  conf: number[];
  trainedHeads: string[];
  modelPath: string;
  runMs: number;
}

export interface NativePocket {
  id: number;
  center: [number, number, number];
  volume: number;
  druggability: number;
  surfaceResidues: number[];
  voxels: [number, number, number][];
}

export interface AdvancedPocketFeatures {
  id: number;
  center: [number, number, number];
  volume: number;
  druggability: number;
  netChargeAtPh: number;
  hydrophobicRatio: number;
  hydrophobicCentroids: [number, number, number][];
  hbondAcceptors: [[number, number, number], [number, number, number]][];
  hbondDonors: [[number, number, number], [number, number, number]][];
  surfaceResidues: number[];
}

export interface PocketDelta {
  volumeDelta: number;
  jaccardOverlap: number;
}

export interface PocketMetricsOut {
  qPocket: number;
  chargeMismatch: number;
  isCollapsed: boolean;
  detectedPockets: NativePocket[];
  primaryPocketFeatures: AdvancedPocketFeatures | null;
}

export interface MetricsOut {
  m1: number;
  m2: number;
  m3: number;
  m4: number;
  m5: number;
  uTKcal: number;
  rg: number;
  nSsRef: number;
  nSsKept: number;
  nSurfaceCharged: number;
  pocket: PocketMetricsOut | null;
}

export interface BuildOut {
  length: number;
  seq: string;
  /** Cα [L,3] Å after build (minimized) */
  coords: number[];
  stepCount: number;
  env: Env;
  buildMs: number;
  note: string;
}

export interface StepOut {
  uHist: number[];
  coords: number[];
  stepCount: number;
  crashed: boolean;
  timePs: number;
  tKin: number;
  clamped: number;
  maxClampedMag: number;
  metrics: MetricsOut | null;
  pseudoLabelN: number;
  stepMsPer: number;
}

export interface ScanPoint {
  t: number;
  ph: number;
  stable: boolean;
  crashed: boolean;
  buildFailed: boolean;
  reason: string | null;
  metrics: MetricsOut | null;
}

export interface ScanProgress {
  total: number;
  done: number;
  t: number;
  ph: number;
  stable: boolean | null;
  error: string | null;
}

export interface ModelStatus {
  ok: boolean;
  modelPath?: string;
  sizeBytes?: number | null;
  trainedHeads?: string[];
  rlHeads?: string[];
  note?: string;
  error?: string;
}

export interface DownloadProgress {
  done: number;
  total: number | null;
  stage: string;
}

export const METRIC_THRESHOLDS = {
  m1: 1e5,
  m2: 0.15,
  m3: 0.55,
  m4: 0.05,
  m5: 1.0,
} as const;

/** Localized metric labels, resolved through the active locale on each access. */
export const METRIC_LABELS: Record<'m1' | 'm2' | 'm3' | 'm4' | 'm5', string> = {
  get m1() {
    return m.metricM1();
  },
  get m2() {
    return m.metricM2();
  },
  get m3() {
    return m.metricM3();
  },
  get m4() {
    return m.metricM4();
  },
  get m5() {
    return m.metricM5();
  },
};

export const ONE_TO_THREE: Record<string, string> = {
  A: 'ALA', C: 'CYS', D: 'ASP', E: 'GLU', F: 'PHE', G: 'GLY', H: 'HIS',
  I: 'ILE', K: 'LYS', L: 'LEU', M: 'MET', N: 'ASN', P: 'PRO', Q: 'GLN',
  R: 'ARG', S: 'SER', T: 'THR', V: 'VAL', W: 'TRP', Y: 'TYR', U: 'SEC',
};

// ═══════════════════════════════════════════════════════════════════════════
// Svelte 5 / Tauri Bridge New Biophysical Interfaces
// ═══════════════════════════════════════════════════════════════════════════

export interface CodesignMutation {
  id: string;
  label: string;
  aaPositions: number[];
  targetAas: string[];
  proteinEnergyDelta: number;
}

export interface CodesignRequest {
  dnaSequence: string;
  cdsStart: number;
  cdsEnd: number;
  host: string;
  mutations: CodesignMutation[];
}

export interface CodesignVariant {
  id: string;
  mutations: string;
  proteinEnergyDelta: number;
  cai: number;
  mrnaDeltaG: number;
  isParetoOptimal: boolean;
  updatedDna: string;
}

export interface PhaseBifurcationOutput {
  optimalTempK: number;
  optimalPh: number;
  isSaddle: boolean;
  coefficients: number[];
  meanT: number;
  stdT: number;
  meanPh: number;
  stdPh: number;
  boundaryCurve: [number, number][];
  deepestWellT: number;
  deepestWellPh: number;
  bifurcationT: number;
  bifurcationPh: number;
}

export interface GoldenGateAssemblyFragment {
  index: number;
  originalLen: number;
  leftOverhang: string;
  rightOverhang: string;
  insertSeq: string;
  orientationForward: boolean;
}

export interface GoldenGateResponse {
  success: boolean;
  productSeq: string;
  fragments: GoldenGateAssemblyFragment[];
  sortedIndices: number[];
  overhangs: string[];
  errors: string[];
  warnings: string[];
}
