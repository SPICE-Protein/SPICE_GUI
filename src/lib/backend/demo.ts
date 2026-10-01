// Demo backend: lets the GUI run fully in a plain browser (no Tauri / no model /
// no engine) with synthetic but physically-plausible data, so the UI is testable
// end-to-end. Used as a fallback in `api.ts`.

import type { BuildOut, Env, FoldOutput, MetricsOut, ScanPoint, ScanProgress, StepOut } from './types';
import * as m from '$lib/paraglide/messages.js';

function helixCoords(seq: string, twist = 1.0): number[] {
  // α-helix: 3.6 res/turn, rise 1.5 Å/res, radius 2.3 Å
  const n = seq.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const theta = (i * (2 * Math.PI) / 3.6) * twist;
    const z = i * 1.5;
    const r = 2.3 + 0.35 * Math.sin(i * 0.9);
    out.push(r * Math.cos(theta), r * Math.sin(theta), z + 0.5 * Math.sin(i * 1.3));
  }
  return out;
}

function distanceMatrix(coords: number[]): number[] {
  const n = Math.floor(coords.length / 3);
  const d = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = coords[i * 3] - coords[j * 3];
      const dy = coords[i * 3 + 1] - coords[j * 3 + 1];
      const dz = coords[i * 3 + 2] - coords[j * 3 + 2];
      d[i * n + j] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  return d;
}

export function demoFold(seq: string, env: Env): FoldOutput {
  const coords = helixCoords(seq);
  // Head B' demo: Cα trace with a mild "mutation" perturbation (other head of the same ONNX model)
  const coordsMut = helixCoords(seq, 0.97);
  const distExp = distanceMatrix(coords);
  const n = seq.length;
  const pContact = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pContact[i * n + j] = distExp[i * n + j] < 8 ? 1 : 0;
    }
  }
  // smooth pseudo mutation logits
  const mutation: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 20; k++) {
      mutation.push(0.05 + 0.01 * Math.sin(i * 1.7 + k * 0.8));
    }
  }
  // env sensitivity: farther from neutral -> lower confidence
  const dev = Math.abs(env.ph - 7) / 7 + Math.abs(env.tempK - 310) / 90;
  const conf = [clamp(0.95 - dev, 0.1, 0.95), clamp(0.8 - dev, 0.05, 0.8)];
  return {
    length: n,
    coords,
    coordsMut,
    distExp,
    pContact,
    mutation,
    envOffset: [0, 0],
    conf,
    trainedHeads: ['A', 'distogram'],
    modelPath: 'demo://synthetic',
    runMs: 3.2,
  };
}

export function demoBuild(seq: string, env: Env): BuildOut {
  const coords = helixCoords(seq, 1.02); // slightly perturbed "minimized" structure
  return {
    length: seq.length,
    seq,
    coords,
    stepCount: 0,
    env,
    buildMs: 1840,
    note: m.demoBuildNote(),
  };
}

export function demoStep(seq: string, n: number, bias: boolean): StepOut {
  const base = helixCoords(seq);
  const uHist: number[] = [];
  let u = -8200;
  for (let i = 0; i < n; i++) {
    u += (bias ? -14 : -6) + (Math.random() - 0.5) * 40;
    uHist.push(u);
  }
  const coords = base.map((v, idx) => v + (Math.random() - 0.5) * 0.6);
  const metrics: MetricsOut = {
    m1: 4e4 + Math.random() * 2e4,
    m2: 0.05 + Math.random() * 0.04,
    m3: 0.15 + Math.random() * 0.1,
    m4: 0.02 + Math.random() * 0.02,
    m5: 0.3 + Math.random() * 0.3,
    uTKcal: uHist[uHist.length - 1],
    rg: 14.2 + Math.random(),
    nSsRef: 18,
    nSsKept: 16,
    nSurfaceCharged: 9,
    pocket: null,
  };
  return {
    uHist,
    coords,
    stepCount: n,
    crashed: false,
    timePs: n * 0.003,
    tKin: 309 + (Math.random() - 0.5) * 6,
    clamped: 0,
    maxClampedMag: 0,
    metrics,
    pseudoLabelN: n,
    stepMsPer: 62,
  };
}

export function demoScan(
  temps: number[],
  phs: number[],
  onProgress: (p: ScanProgress) => void
): Promise<ScanPoint[]> {
  return new Promise((resolve) => {
    const total = temps.length * phs.length;
    let done = 0;
    const points: ScanPoint[] = [];
    for (const ph of phs) {
      for (const t of temps) {
        // stability ~ gaussian peak at (310 K, pH 7)
        const dev =
          Math.abs(t - 310) / 40 + Math.abs(ph - 7) / 3;
        const stable = Math.random() < Math.exp(-dev * dev * 0.6);
        const crashed = !stable && Math.random() < 0.5;
        points.push({
          t,
          ph,
          stable,
          crashed,
          buildFailed: false,
          reason: stable ? null : 'energy_spike',
          metrics: stable
            ? {
                m1: 3e4, m2: 0.06, m3: 0.2, m4: 0.02, m5: 0.4,
                uTKcal: -8200, rg: 14.1, nSsRef: 18, nSsKept: 16, nSurfaceCharged: 9,
                pocket: null,
              }
            : null,
        });
        done += 1;
        const p: ScanProgress = { total, done, t, ph, stable, error: null };
        onProgress(p);
      }
    }
    setTimeout(() => resolve(points), 400);
  });
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function demoFetchPdb(pdbId: string): string {
  return `HEADER    FAKE PDB FOR DEMO PURPOSES - ${pdbId}\nATOM      1  CA  MET A   1      12.131  23.411  15.512  1.00 20.00           C\nATOM      2  CA  ALA A   2      14.231  25.121  18.112  1.00 20.00           C\nATOM      3  CA  TYR A   3      16.512  26.831  20.412  1.00 20.00           C\nTER\n`;
}

import type { NativePocket, AdvancedPocketFeatures, PocketDelta } from './types';

export function demoGetPockets(): NativePocket[] {
  return [
    {
      id: 0,
      center: [12.131, 23.411, 15.512],
      volume: 620.5,
      druggability: 0.78,
      surfaceResidues: [0, 1, 2],
      voxels: [
        [12.131, 23.411, 15.512],
        [13.131, 23.411, 15.512],
        [12.131, 24.411, 15.512],
      ],
    },
    {
      id: 1,
      center: [14.231, 25.121, 18.112],
      volume: 310.2,
      druggability: 0.45,
      surfaceResidues: [1, 2],
      voxels: [
        [14.231, 25.121, 18.112],
      ],
    }
  ];
}

export function demoGetPocketFeatures(pocket: NativePocket): AdvancedPocketFeatures {
  return {
    id: pocket.id,
    center: pocket.center,
    volume: pocket.volume,
    druggability: pocket.druggability,
    netChargeAtPh: -1.2,
    hydrophobicRatio: 0.65,
    hydrophobicCentroids: [
      [pocket.center[0] + 0.5, pocket.center[1] - 0.2, pocket.center[2] + 0.1],
    ],
    hbondAcceptors: [
      [[pocket.center[0] - 1.2, pocket.center[1], pocket.center[2]], [0.0, 1.0, 0.0]],
    ],
    hbondDonors: [
      [[pocket.center[0] + 1.2, pocket.center[1], pocket.center[2]], [0.0, -1.0, 0.0]],
    ],
    surfaceResidues: pocket.surfaceResidues,
  };
}

export function demoGetPocketDelta(ref: NativePocket, mut: NativePocket): PocketDelta {
  return {
    volumeDelta: mut.volume - ref.volume,
    jaccardOverlap: 0.82,
  };
}

export function demoAnalyzePocketTrajectory(): [number, number] {
  return [15.4, 0.85];
}
