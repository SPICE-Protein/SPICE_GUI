import { invoke, Channel } from '@tauri-apps/api/core';
import * as m from '$lib/paraglide/messages.js';
import { normalizePayload } from '$lib/i18nMsg';
import {
  parseSequenceFile,
  runLocalBlast,
  calculateDotPlot,
  analyzeFastqQuality,
  findOrfsInPlasmid,
  findRnaStructures
} from '$lib/genome';
import type { Result, FoldOutput, ModelStatus, DownloadProgress, BuildOut, Env, MetricsOut, ScanPoint, ScanProgress, StepOut, GoldenGateResponse, GoldenGateAssemblyFragment, NativePocket, AdvancedPocketFeatures, PocketDelta } from './types';
import {
  demoFold,
  demoScan,
  demoFetchPdb,
  demoGetPockets,
  demoGetPocketFeatures,
  demoGetPocketDelta,
  demoAnalyzePocketTrajectory,
  demoBuild,
  demoStep,
} from './demo';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function guarded<T>(real: () => Promise<T> | T, fallback: () => Promise<T> | T): Promise<Result<T>> {
  if (!isTauri()) {
    return { data: await fallback(), demo: true, error: m.demoModeNoTauri() };
  }
  try {
    return { data: await real(), demo: false };
  } catch (e: any) {
    const msg = typeof e === 'string' ? e : e?.message ?? String(e);
    return { data: await fallback(), demo: true, error: msg };
  }
}

// Parse a UniVec-style FASTA into {name, seq} feature entries (browser fallback path).
function parseFastaFeatures(text: string): { name: string; seq: string }[] {
  const out: { name: string; seq: string }[] = [];
  let name = '';
  let buf = '';
  const flush = () => {
    const clean = buf.toUpperCase().replace(/[^A-Z]/g, '');
    if (clean.length >= 12) out.push({ name: name.trim() || 'UniVec element', seq: clean });
    buf = '';
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('>')) {
      flush();
      const rest = line.slice(1);
      const sp = rest.indexOf(' ');
      name = sp === -1 ? rest : rest.slice(sp + 1);
    } else {
      buf += line;
    }
  }
  flush();
  return out;
}

export const backend = {
  isTauri,
  async fold(seq: string, env: Env): Promise<Result<FoldOutput>> {
    return guarded(
      () => invoke<FoldOutput>('infer_fold', {
        seq,
        env: { ph: env.ph, tempK: env.tempK, pressureBar: env.pressureBar, ionicStrengthM: env.ionicStrengthM },
        modelPath: null
      }),
      () => demoFold(seq, env)
    );
  },
  async modelStatus(): Promise<Result<ModelStatus>> {
    if (!isTauri()) {
      return { data: { ok: false, error: m.demoModelNotConnected() }, demo: true };
    }
    try {
      const r = await invoke<ModelStatus>('model_status', { modelPath: null });
      return { data: r, demo: false };
    } catch (e) {
      return { data: { ok: false, error: String(e) }, demo: true, error: String(e) };
    }
  },
  /** Stream-SHA-256 the active ONNX checkpoint — SPD requires a
   *  `sha256:<64 hex>` checkpoint identity for model/fold submissions. */
  async modelSha256(): Promise<Result<{ ok: boolean; sha256?: string; path?: string; error?: string }>> {
    if (!isTauri()) {
      return { data: { ok: false, error: m.demoModelNotConnected() }, demo: true };
    }
    try {
      const r = await invoke<{ ok: boolean; sha256?: string; path?: string; error?: string }>('model_sha256', { modelPath: null });
      return { data: r, demo: false };
    } catch (e) {
      return { data: { ok: false, error: String(e) } };
    }
  },
  async modelCandidates(): Promise<string[]> {
    if (!isTauri()) return [];
    try {
      return await invoke<string[]>('model_candidates');
    } catch {
      return [];
    }
  },
  async setModelPath(path: string | null): Promise<Result<{ ok: boolean; error?: string }>> {
    if (!isTauri()) return { data: { ok: false, error: m.runModeBrowser() }, demo: true };
    try {
      const r = await invoke<{ ok: boolean; error?: string }>('set_model_path', { path: path || null });
      return { data: r, demo: false };
    } catch (e: any) {
      return { data: { ok: false, error: String(e?.message ?? e) }, demo: true };
    }
  },
  async downloadModel(url: string, dest: string | null, onProgress: (p: DownloadProgress) => void): Promise<Result<string>> {
    if (!isTauri()) {
      return { data: 'demo://no-download', demo: true, error: m.demoDownloadNotSupported() };
    }
    try {
      const channel = new Channel();
      channel.onmessage = (p: any) => onProgress(p as DownloadProgress);
      const data = await invoke<string>('download_model', { url, dest, channel });
      return { data, demo: false };
    } catch (e: any) {
      return { data: '', demo: true, error: String(e?.message ?? e) };
    }
  },
  async build(seq: string, env: Env, opts: { coords?: number[]; pdb?: string; minimize?: boolean; equilibrate?: boolean; customProtonation?: Record<number, string> }): Promise<Result<BuildOut>> {
    return guarded(
      () => invoke<BuildOut>('engine_build', {
        request: {
          seq,
          env: { ph: env.ph, tempK: env.tempK, pressureBar: env.pressureBar, ionicStrengthM: env.ionicStrengthM },
          coords: opts.coords ?? null,
          pdb: opts.pdb ?? null,
          relaxIters: opts.minimize === false ? null : 2000,
          strict: false,
          equilibrate: opts.equilibrate ?? false,
          custom_protonation: opts.customProtonation ?? null
        }
      }),
      () => demoBuild(seq, env)
    );
  },
  async step(nSteps: number, bias: boolean, action: number[] | null, dT = 0, dPh = 0): Promise<Result<StepOut>> {
    return guarded(
      () => invoke<StepOut>('engine_step', {
        request: { nSteps, bias, action, dT, dPh }
      }),
      () => demoStep('A'.repeat(40), nSteps, bias)
    );
  },
  async metrics(): Promise<Result<MetricsOut>> {
    return guarded(
      () => invoke<MetricsOut>('engine_metrics'),
      () => {
        const m = demoStep('A'.repeat(40), 1, false).metrics;
        if (!m) throw new Error("Metrics not available in demo");
        return m;
      }
    );
  },
  async setTemperature(tempK: number): Promise<void> {
    if (!isTauri()) return;
    await invoke('engine_set_temperature', { tempK });
  },
  async reset(velocities: boolean, pseudoLabels: boolean): Promise<void> {
    if (!isTauri()) return;
    await invoke('engine_reset', { velocities, pseudoLabels });
  },
  async validate(seq: string): Promise<void> {
    if (!isTauri()) return;
    await invoke('engine_validate', { seq });
  },
  async mutate(seq: string, mutations: { position: number; to: string }[]): Promise<Result<string>> {
    return guarded(
      () => invoke<string>('engine_mutate', {
        seq,
        mutations: mutations.map((m) => ({ position: m.position, to: m.to }))
      }),
      () => {
        let s = seq.split('');
        for (const m of mutations) {
          if (m.position < s.length) s[m.position] = m.to;
        }
        return s.join('');
      }
    );
  },
  async buildMutant(seq: string, relaxIters: number, customProtonation?: Record<number, string>): Promise<Result<BuildOut>> {
    return guarded(
      () => invoke<BuildOut>('engine_build_mutant', { mutantSeq: seq, relaxIters, customProtonation: customProtonation ?? null }),
      () => demoBuild(seq, { ph: 7.0, tempK: 310, pressureBar: 1.0, ionicStrengthM: 0.0 })
    );
  },
  async addDistanceRestraint(atom0Idx: number, atom1Idx: number, r0: number, k: number): Promise<Result<boolean>> {
    return guarded(
      () => invoke<boolean>('engine_add_distance_restraint', { atom0Idx, atom1Idx, r0, k }),
      () => true
    );
  },
  async scan(temps: number[], phs: number[], nSteps: number, minimize: boolean, onProgress: (p: ScanProgress) => void): Promise<Result<ScanPoint[]>> {
    if (!isTauri()) {
      const pts = await demoScan(temps, phs, onProgress);
      return { data: pts, demo: true, error: m.demoSyntheticPhaseDiagram() };
    }
    try {
      const channel = new Channel();
      channel.onmessage = (p: any) => onProgress(p as ScanProgress);
      const data = await invoke<ScanPoint[]>('engine_stability_scan', {
        request: { temps, phs, nSteps, minimize },
        channel
      });
      return { data, demo: false };
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message ?? String(e);
      const pts = await demoScan(temps, phs, onProgress);
      return { data: pts, demo: true, error: msg };
    }
  },
  async cancelScan(): Promise<void> {
    if (!isTauri()) return;
    try {
      await invoke('engine_cancel_scan');
    } catch {}
  },
  async fetchPdb(pdbId: string): Promise<Result<string>> {
    return guarded(
      () => invoke<string>('fetch_pdb_structure', { pdbId }),
      () => demoFetchPdb(pdbId)
    );
  },
  async getPockets(gridSpacing?: number): Promise<Result<NativePocket[]>> {
    return guarded(
      () => invoke<NativePocket[]>('engine_get_pockets', { gridSpacing: gridSpacing ?? null }),
      () => demoGetPockets()
    );
  },
  async getPocketFeatures(pocket: NativePocket): Promise<Result<AdvancedPocketFeatures>> {
    return guarded(
      () => invoke<AdvancedPocketFeatures>('engine_get_pocket_features', { pocket }),
      () => demoGetPocketFeatures(pocket)
    );
  },
  async getPocketDelta(refPocket: NativePocket, mutPocket: NativePocket, gridSpacing?: number): Promise<Result<PocketDelta>> {
    return guarded(
      () => invoke<PocketDelta>('engine_get_pocket_delta', { refPocket, mutPocket, gridSpacing: gridSpacing ?? null }),
      () => demoGetPocketDelta(refPocket, mutPocket)
    );
  },
  async analyzePocketTrajectory(samples: [number, number, number][][], stepSize: number, thresholdVolume: number, gridSpacing?: number): Promise<Result<number[]>> {
    return guarded(
      () => invoke<number[]>('engine_analyze_pocket_trajectory', { samples, stepSize, thresholdVolume, gridSpacing: gridSpacing ?? null }),
      () => demoAnalyzePocketTrajectory()
    );
  },
  async calculatePrimerTm(seq: string, monovalentM: number, divalentM: number, primerM: number): Promise<Result<{ tm: number; enthalpy: number; entropy: number; gc: number }>> {
    return guarded(
      () => invoke<{ tm: number; enthalpy: number; entropy: number; gc: number }>('calculate_primer_tm', {
        seq,
        monovalentM,
        divalentM,
        primerM
      }),
      () => {
        const clean = seq.toUpperCase().replace(/[^ATCG]/g, '');
        const gc = clean.split('').filter((c) => c === 'G' || c === 'C').length / (clean.length || 1) * 100;
        const tm = 2 * clean.split('').filter((c) => 'AT'.includes(c)).length + 4 * clean.split('').filter((c) => 'GC'.includes(c)).length;
        return { tm, enthalpy: -8 * clean.length, entropy: -22 * clean.length, gc };
      }
    );
  },
  async simulateCloningLigation(vectorSeq: string, vectorName: string, insertSeq: string, insertName: string, leftEnzyme: string, rightEnzyme: string): Promise<Result<{ productSeq: string; productName: string; leftInsertPos: number; rightInsertPos: number }>> {
    return guarded(
      () => invoke<{ productSeq: string; productName: string; leftInsertPos: number; rightInsertPos: number }>(
        'simulate_cloning_ligation',
        { vectorSeq, vectorName, insertSeq, insertName, leftEnzyme, rightEnzyme }
      ),
      () => {
        const productSeq = vectorSeq + insertSeq;
        const productName = `${vectorName}_cloned_${insertName}`;
        return { productSeq, productName, leftInsertPos: vectorSeq.length, rightInsertPos: vectorSeq.length + insertSeq.length };
      }
    );
  },

  async syncRebaseDb(): Promise<Result<{ name: string; motif: string; cutIndex: number; isBlunt: boolean }[]>> {
    return guarded(
      () => invoke<{ name: string; motif: string; cutIndex: number; isBlunt: boolean }[]>('sync_rebase_db'),
      () => {
        if (typeof localStorage !== 'undefined') {
          const cached = localStorage.getItem('spice_rebase_db');
          if (cached) {
            try {
              return JSON.parse(cached);
            } catch {}
          }
        }
        return [
          { name: 'EcoRI', motif: 'GAATTC', cutIndex: 1, isBlunt: false },
          { name: 'BamHI', motif: 'GGATCC', cutIndex: 1, isBlunt: false },
          { name: 'HindIII', motif: 'AAGCTT', cutIndex: 1, isBlunt: false },
          { name: 'SalI', motif: 'GTCGAC', cutIndex: 1, isBlunt: false },
          { name: 'KpnI', motif: 'GGTACC', cutIndex: 5, isBlunt: false },
          { name: 'XhoI', motif: 'CTCGAG', cutIndex: 1, isBlunt: false },
          { name: 'NdeI', motif: 'CATATG', cutIndex: 2, isBlunt: false },
          { name: 'SacI', motif: 'GAGCTC', cutIndex: 5, isBlunt: false },
          { name: 'BsaI', motif: 'GGTCTC', cutIndex: 1, isBlunt: false },
          { name: 'ClaI', motif: 'ATCGAT', cutIndex: 2, isBlunt: false },
          { name: 'XbaI', motif: 'TCTAGA', cutIndex: 1, isBlunt: false },
          { name: 'MboI', motif: 'GATC', cutIndex: 0, isBlunt: false },
          { name: 'NotI', motif: 'GCGGCCGC', cutIndex: 2, isBlunt: false },
          { name: 'PstI', motif: 'CTGCAG', cutIndex: 5, isBlunt: false },
          { name: 'BglII', motif: 'AGATCT', cutIndex: 1, isBlunt: false },
          { name: 'SmaI', motif: 'CCCGGG', cutIndex: 3, isBlunt: true },
          { name: 'SpeI', motif: 'ACTAGT', cutIndex: 1, isBlunt: false },
          { name: 'SphI', motif: 'GCATGC', cutIndex: 5, isBlunt: false },
          { name: 'EcoRV', motif: 'GATATC', cutIndex: 3, isBlunt: true },
          { name: 'NcoI', motif: 'CCATGG', cutIndex: 1, isBlunt: false },
          { name: 'NheI', motif: 'GCTAGC', cutIndex: 1, isBlunt: false },
          { name: 'AflII', motif: 'CTTAAG', cutIndex: 1, isBlunt: false },
          { name: 'AvrII', motif: 'CCTAGG', cutIndex: 1, isBlunt: false },
          { name: 'DraI', motif: 'TTTAAA', cutIndex: 3, isBlunt: true },
          { name: 'HpaI', motif: 'GTTAAC', cutIndex: 3, isBlunt: true },
          { name: 'MluI', motif: 'ACGCGT', cutIndex: 1, isBlunt: false },
          { name: 'PvuII', motif: 'CAGCTG', cutIndex: 3, isBlunt: true },
          { name: 'ScaI', motif: 'AGTACT', cutIndex: 3, isBlunt: true },
          { name: 'StuI', motif: 'AGGCCT', cutIndex: 3, isBlunt: true },
          { name: 'SwaI', motif: 'ATTTAAAT', cutIndex: 4, isBlunt: true },
          { name: 'BbsI', motif: 'GAAGAC', cutIndex: 2, isBlunt: false },
          { name: 'BsmBI', motif: 'CGTCTC', cutIndex: 1, isBlunt: false },
          { name: 'SapI', motif: 'GCTCTTC', cutIndex: 1, isBlunt: false },
          { name: 'FokI', motif: 'GGATG', cutIndex: 9, isBlunt: false },
          { name: 'HincII', motif: 'GTYRAC', cutIndex: 3, isBlunt: true },
        ];
      }
    );
  },

  async syncUnevecDb(): Promise<Result<{ name: string; seq: string }[]>> {
    return guarded(
      () => invoke<{ name: string; seq: string }[]>('sync_unevec_db'),
      async () => {
        // Browser preview: try to fetch + parse UniVec_Core directly; else use cache; else empty.
        try {
          const res = await fetch('https://ftp.ncbi.nlm.nih.gov/pub/UniVec/UniVec_Core');
          if (res.ok) {
            const text = await res.text();
            if (text.trimStart().startsWith('>')) {
              const entries = parseFastaFeatures(text);
              if (entries.length > 0) {
                try { localStorage.setItem('spice_unevec_db', JSON.stringify(entries)); } catch { /* ignore */ }
                return entries;
              }
            }
          }
        } catch { /* fall through to cache */ }
        if (typeof localStorage !== 'undefined') {
          const cached = localStorage.getItem('spice_unevec_db');
          if (cached) { try { return JSON.parse(cached); } catch { /* ignore */ } }
        }
        return [];
      }
    );
  },

  async annotateFeaturesSw(
    query: string,
    entries: { name: string; seq: string }[],
    minSpan?: number
  ): Promise<Result<{ name: string; start: number; end: number; strand: string; score: number }[]>> {
    return guarded(
      () =>
        invoke<{ name: string; start: number; end: number; strand: string; score: number }[]>(
          'annotate_features_sw',
          { query, entries, minSpan: minSpan ?? null }
        ),
      // Browser preview has no native SW engine; return empty so callers fall back to k-mer.
      () => []
    );
  },

  async syncCardAmrDb(): Promise<Result<{ gene: string; resistanceTo: string; pattern: string }[]>> {
    return guarded(
      () => invoke<{ gene: string; resistanceTo: string; pattern: string }[]>('sync_card_amr_db'),
      () => {
        if (typeof localStorage !== 'undefined') {
          const cached = localStorage.getItem('spice_card_amr_db');
          if (cached) {
            try {
              return JSON.parse(cached);
            } catch {}
          }
        }
        // Local curated fallback representing public CARD/ResFinder databases
        return [
          { gene: "blaTEM-1", resistanceTo: "Beta-lactam (Penicillins)", pattern: "ATCAGTCAACC" },
          { gene: "kanR (aph(3')-Ia)", resistanceTo: "Aminoglycoside (Kanamycin)", pattern: "ATGAGCCATATTCAACGGG" },
          { gene: "tet(A)", resistanceTo: "Tetracycline", pattern: "GTGATCCTGGG" },
          { gene: "catA1 (CmR)", resistanceTo: "Phenicol (Chloramphenicol)", pattern: "ATGGAGAAAAAAATCACT" },
          { gene: "aac(6')-Ib-cr", resistanceTo: "Aminoglycoside, Fluoroquinolone", pattern: "CCGCTCGTGT" }
        ];
      }
    );
  },

  async syncBiosecurityDb(): Promise<Result<{ agent: string; pattern: string; description: string }[]>> {
    return guarded(
      async () => normalizePayload(await invoke<{ agent: string; pattern: string; description: string }[]>('sync_biosecurity_db')),
      () => {
        if (typeof localStorage !== 'undefined') {
          const cached = localStorage.getItem('spice_biosecurity_db');
          if (cached) {
            try {
              return JSON.parse(cached);
            } catch {}
          }
        }
        // Local curated fallback representing standard IGSC/CDC biosecurity select agents and toxins
        return [
          {
            agent: m.bioAgentRicin(),
            pattern: "TCTGGAGCGCATGATT",
            description: m.bioDescRicin()
          },
          {
            agent: m.bioAgentBotulinum(),
            pattern: "TTTGGATCCGGATAC",
            description: m.bioDescBotulinum()
          },
          {
            agent: m.bioAgentAnthraxLf(),
            pattern: "ATGAAACACGAAAA",
            description: m.bioDescAnthraxLf()
          },
          {
            agent: m.bioAgentVariola(),
            pattern: "TATAATGAGTCACA",
            description: m.bioDescVariola()
          }
        ];
      }
    );
  },

  async fetchKazusaCodonTable(taxonId: string): Promise<Result<Record<string, string>>> {
    return guarded(
      () => invoke<Record<string, string>>('fetch_kazusa_codon_table', { taxonId }),
      () => {
        // Fallback standard E. coli table
        return {
          'M': 'ATG', 'W': 'TGG', 'F': 'TTC', 'L': 'CTG', 'I': 'ATC', 'V': 'GTG',
          'S': 'AGC', 'P': 'CCG', 'T': 'ACC', 'A': 'GCG', 'Y': 'TAC', 'H': 'CAC',
          'Q': 'CAG', 'N': 'AAC', 'K': 'AAG', 'D': 'GAC', 'E': 'GAA', 'C': 'TGC',
          'R': 'AGA', 'G': 'GGC', '*': 'TAA'
        };
      }
    );
  },

  /**
   * Export a file via native save dialog (Tauri) or browser download (demo).
   * `data` may be a UTF-8 string (mmCIF / text) or a Uint8Array (PNG).
   */
  async saveExport(defaultName: string, data: string | Uint8Array): Promise<Result<{ saved: boolean; path?: string }>> {
    if (!isTauri()) {
      const blob =
        typeof data === 'string'
          ? new Blob([data], { type: 'text/plain' })
          : new Blob([data], {
              type: /\.png$/i.test(defaultName) ? 'image/png' : 'application/octet-stream'
            });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { data: { saved: true }, demo: true };
    }
    try {
      const b64 = typeof data === 'string' ? btoa(unescape(encodeURIComponent(data))) : bytesToBase64(data);
      const r = await invoke<{ saved: boolean; path: string | null }>('save_export', {
        defaultName,
        dataB64: b64,
      });
      return { data: { saved: r.saved, path: r.path ?? undefined }, demo: false };
    } catch (e: any) {
      return { data: { saved: false }, demo: true, error: String(e?.message ?? e) };
    }
  },

  /**
   * Directly save/overwrite a file silently (used for real-time background
   * Auto-Save). Accepts text or raw bytes (e.g. gzipped .spiceproj).
   */
  async saveFileDirect(path: string, data: string | Uint8Array): Promise<Result<boolean>> {
    if (!isTauri()) {
      return { data: true, demo: true };
    }
    try {
      const b64 = typeof data === 'string' ? btoa(unescape(encodeURIComponent(data))) : bytesToBase64(data);
      const ok = await invoke<boolean>('save_file_direct', {
        path,
        dataB64: b64,
      });
      return { data: ok, demo: false };
    } catch (e: any) {
      return { data: false, demo: true, error: String(e?.message ?? e) };
    }
  },

  /**
   * Import a gene or transcript from Ensembl via the REST API.
   * Falls back to a synthetic demo sequence in browser mode.
   */
 async importFromEnsembl(query: string): Promise<Result<{ name: string; sequence: string; features?: any[] }>> {
   // Tauri (production): call the native command, which performs the real Ensembl REST fetch.
   // Any backend error propagates so the UI can surface it as an error toast — no fabricated data.
   if (isTauri()) {
     const data = await invoke<{ name: string; sequence: string; features?: any[] }>('import_from_ensembl', { query });
     return { data, demo: false };
   }
   // Browser preview: best-effort direct fetch; failures throw (no synthetic sequence).
   return (async () => {
       try {
         let ensemblId = query.trim();
         if (!ensemblId.startsWith("ENS")) {
           const lookupUrl = `https://rest.ensembl.org/xrefs/symbol/homo_sapiens/${ensemblId}?content-type=application/json`;
           const res = await fetch(lookupUrl, { headers: { "Accept": "application/json" } });
           if (res.ok) {
             const arr = await res.json();
             if (Array.isArray(arr) && arr.length > 0 && arr[0].id) {
               ensemblId = arr[0].id;
             } else {
               const lookupUrlAlt = `https://rest.ensembl.org/xrefs/symbol/mus_musculus/${ensemblId}?content-type=application/json`;
               const resAlt = await fetch(lookupUrlAlt, { headers: { "Accept": "application/json" } });
               if (resAlt.ok) {
                 const arrAlt = await resAlt.json();
                 if (Array.isArray(arrAlt) && arrAlt.length > 0 && arrAlt[0].id) {
                   ensemblId = arrAlt[0].id;
                 }
               }
             }
           }
         }

         const seqUrl = `https://rest.ensembl.org/sequence/id/${ensemblId}?content-type=text/plain`;
         const seqRes = await fetch(seqUrl, { headers: { "Accept": "text/plain" } });
         if (!seqRes.ok) throw new Error(`Ensembl Sequence API error: ${seqRes.status}`);
         const rawSequence = await seqRes.text();
         const cleanSequence = rawSequence.trim().toUpperCase().replace(/[^ATCGN]/g, '');

         const featUrl = `https://rest.ensembl.org/overlap/id/${ensemblId}?feature=gene;feature=exon;feature=CDS;content-type=application/json`;
         const featRes = await fetch(featUrl, { headers: { "Accept": "application/json" } });
         let features: any[] = [];
         if (featRes.ok) {
           const arr = await featRes.json();
           if (Array.isArray(arr)) {
             features = arr.map(item => {
               const ftype = item.feature_type || "misc";
               const start = (item.start || 1) - 1;
               const end = (item.end || 1) - 1;
               const strand = item.strand || 1;
               const name = ftype === "gene" ? `${query}_gene` : ftype === "exon" ? `exon_${start}` : "CDS";
               return { name, ftype, start, end, strand };
             });
           }
         }

         return {
           data: { name: `Ensembl:${query}`, sequence: cleanSequence, features },
           demo: true,
           error: m.browserDirectNoTauri()
         };
       } catch (e: any) {
         console.warn("Ensembl REST API fetch failed", e);
         throw new Error(e?.message ? `Ensembl: ${e.message}` : 'Ensembl sequence fetch failed');
       }
     })();
 },
 
  /**
   * Import a sequence from NCBI by accession number (GenBank format).
   */
  async importFromNcbi(accession: string, organism?: string): Promise<Result<{ name: string; sequence: string; features?: any[]; organism?: string }>> {
    // Tauri (production): native command performs the real NCBI EFetch + GenBank parse.
    // Errors propagate to the caller for an error toast — never fabricate a sequence.
    const org = organism && organism.toLowerCase() !== 'any' ? organism.trim() : null;
    if (isTauri()) {
      const data = await invoke<{ name: string; sequence: string; features?: any[]; organism?: string }>('import_from_ncbi', { accession, organism: org });
      return { data, demo: false };
    }
    // Browser preview: best-effort direct fetch; failures throw.
    return (async () => {
        try {
          const q = accession.trim();
          // Resolve gene symbol / term to a concrete nuccore id (prefer RefSeq mRNA),
          // mirroring the Rust backend. Real accessions pass straight through.
          const looksAccession = /^[A-Za-z]{1,4}_?\d{3,}([.-]\d+)?$/.test(q);
          let id = q;
          if (!looksAccession) {
            const base = [
              `${q}[Gene Name] AND biomol_mrna[PROP] AND srcdb_refseq[PROP] NOT PREDICTED[Title]`,
              `${q}[Gene Name] AND biomol_mrna[PROP] NOT PREDICTED[Title]`,
              `${q}[Gene Name] NOT PREDICTED[Title]`,
            ];
            // Organism-constrained first, then organism-free fallback, then plain term.
            const terms: string[] = [];
            if (org) for (const b of base) terms.push(`${b} AND "${org}"[Organism]`);
            terms.push(...base, q);
            let found = '';
            for (const term of terms) {
              const es = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nuccore&term=${encodeURIComponent(term)}&retmax=1&sort=relevance&retmode=json`);
              if (!es.ok) continue;
              const ej = await es.json();
              const first = ej?.esearchresult?.idlist?.[0];
              if (first) { found = first; break; }
            }
            if (!found) throw new Error(org ? m.ncbiResolveFailedOrg({ q, org }) : m.ncbiResolveFailed({ q }));
            id = found;
          }
          const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${id}&rettype=gb&retmode=text`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`NCBI HTTP error: ${res.status}`);
          const text = await res.text();
          if (!text.trim() || text.includes("Error") || text.includes("Empty")) {
            throw new Error("NCBI sequence empty or not found");
          }
          const parsed: any = parseSequenceFile(text);
          return {
            data: {
              name: parsed.name || `NCBI:${accession}`,
              sequence: parsed.sequence,
              features: (parsed.features || []).map((f: any) => ({
                name: f.name || 'feature',
                ftype: f.type || 'misc',
                start: f.start,
                end: f.end,
                strand: f.forward !== false ? 1 : -1
              })),
              organism: 'NCBI organism'
            },
            demo: true,
            error: m.browserDirectNoTauri()
          };
        } catch (e: any) {
          console.warn("NCBI REST API fetch failed", e);
          throw new Error(e?.message ? `NCBI: ${e.message}` : 'NCBI sequence fetch failed');
        }
      })();
  },

  /**
   * Run high-performance MAFFT multiple sequence alignment on the Rust backend.
   */
  async runNativeMsa(
    sequences: { id: string; name: string; seq: string }[],
    isProtein: boolean
  ): Promise<Result<{ rows: { id: string; name: string; alignedSeq: string }[]; consensus: string; averageIdentity: number }>> {
    return guarded(
      () => invoke<{ rows: { id: string; name: string; alignedSeq: string }[]; consensus: string; averageIdentity: number }>('run_native_msa', { sequences, isProtein }),
      () => {
        const rows = sequences.map(s => ({ id: s.id, name: s.name, alignedSeq: s.seq }));
        return {
          rows,
          consensus: sequences[0]?.seq || '',
          averageIdentity: 1.0
        };
      }
    );
  },

  /**
   * Compress multiple sequence files in the collection into a native ZIP archive (Base64).
   */
  async exportCollectionZip(entries: { name: string; seq: string }[]): Promise<Result<string>> {
    return guarded(
      () => invoke<string>('export_collection_zip', { entries }),
      () => JSON.stringify(entries)
    );
  },

  /**
   * Decompress and parse multiple sequence files from an uploaded Base64-encoded ZIP archive.
   */
  async importCollectionZip(zipB64: string): Promise<Result<{ name: string; seq: string }[]>> {
    return guarded(
      () => invoke<{ name: string; seq: string }[]>('import_collection_zip', { zipB64 }),
      () => {
        try {
          return JSON.parse(zipB64);
        } catch {
          return [];
        }
      }
    );
  },

  /**
   * Run high-performance local BLAST search on the Rust backend or fallback to TS.
   */
  async runLocalBlast(query: string, subjects: { name: string; seq: string }[], k = 11): Promise<Result<any[]>> {
    return guarded(
      () => invoke<any[]>('run_local_blast', { query, subjects, k }),
      () => runLocalBlast(query, subjects, k)
    );
  },

  /**
   * Run high-performance 2D Dot Plot calculation on the Rust backend or fallback to TS.
   */
  async calculateDotPlot(seq1: string, seq2: string, windowSize = 15, threshold = 12): Promise<Result<any[]>> {
    return guarded(
      () => invoke<any[]>('calculate_dot_plot_rust', { seq1, seq2, windowSize, threshold }),
      () => calculateDotPlot(seq1, seq2, windowSize, threshold)
    );
  },

  /**
   * Run high-performance local pairwise alignment using rust-bio SIMD-ready Aligner with Affine Gap penalties.
   */
  async runLocalAlignment(query: string, subject: string): Promise<Result<any>> {
    return guarded(
      () => invoke<any>('run_local_alignment', { query, subject }),
      async () => {
        return {
          score: 100,
          queryStart: 0,
          queryEnd: query.length - 1,
          subjectStart: 0,
          subjectEnd: subject.length - 1,
          cigar: `${query.length}M`,
          alignmentStr: `Fallback aligned: ${query.length} bp match`
        };
      }
    );
  },

  /**
   * Run high-performance FASTQ Quality Control using rust-bio's optimized fastq reader.
   */
  async analyzeFastqQualityRust(fastqText: string): Promise<Result<any>> {
    return guarded(
      () => invoke<any>('analyze_fastq_quality_rust', { fastqText }),
      () => analyzeFastqQuality(fastqText)
    );
  },

  /**
   * Run high-performance ORF Finder using rust-bio's standard seq_analysis::orf Finder.
   */
  async findOrfsRust(dnaSeq: string, minLen = 90): Promise<Result<any[]>> {
    return guarded(
      () => invoke<any[]>('find_orfs_rust', { dnaSeq, minLen }),
      () => {
        // Fallback to TS orf finder
        const orfs = findOrfsInPlasmid(dnaSeq, false, minLen);
        return orfs.map((o: any) => ({
          start: o.start,
          end: o.end,
          strand: o.strand,
          length: o.length,
          seq: dnaSeq.slice(o.start, o.end)
        }));
      }
    );
  },

  /**
   * Run high-performance RNA folding secondary structure prediction (Nussinov) on Rust-side for 100x acceleration.
   */
  async findRnaStructuresRust(
    seq: string,
    isRna = true,
    windowSize = 120,
    stepSize = 60,
    minMfe = -10
  ): Promise<Result<any>> {
    return guarded(
      () => invoke<any>('find_rna_structures_rust', { seq, isRna, windowSize, stepSize, minMfe }),
      () => findRnaStructures(seq, isRna, windowSize, stepSize, minMfe)
    );
  },

  /**
   * Fits a Landau quadratic surface to the T-pH stability scan points and extracts
   * the metastable center, phase boundary, and bifurcation limits. Offloaded to Rust.
   */
  async solvePhaseBifurcation(points: any[]): Promise<Result<any>> {
    return guarded(
      () => invoke<any>('solve_phase_bifurcation', { request: { points } }),
      () => {
        // Fallback implementation in browser demo mode
        const n = points.length;
        if (n < 6) return null;
        let sumT = 0, sumPh = 0;
        points.forEach(p => { sumT += p.t; sumPh += p.ph; });
        const meanT = sumT / n;
        const meanPh = sumPh / n;

        // Generate synthetic boundary ellipse around the mean
        const boundaryCurve: [number, number][] = [];
        for (let i = 0; i <= 360; i += 10) {
          const rad = (i * Math.PI) / 180;
          boundaryCurve.push([
            meanT + 12 * Math.cos(rad) + (Math.random() - 0.5) * 0.5,
            meanPh + 0.8 * Math.sin(rad) + (Math.random() - 0.5) * 0.05
          ]);
        }

        return {
          optimalTempK: Math.round(meanT * 10) / 10,
          optimalPh: Math.round(meanPh * 100) / 100,
          isSaddle: false,
          coefficients: [0, 0, 0, 0, 0, 0],
          meanT, stdT: 15, meanPh, stdPh: 1.0,
          boundaryCurve,
          deepestWellT: Math.round(meanT * 10) / 10,
          deepestWellPh: Math.round(meanPh * 100) / 100,
          bifurcationT: Math.round((meanT + 12) * 10) / 10,
          bifurcationPh: Math.round((meanPh - 0.5) * 100) / 100,
        };
      }
    );
  },

  /**
   * Sequence-Structure-Expression multi-objective optimization (Pareto Co-design).
   * Evaluates CAI, mRNA 5' folding structure free energy, and identifies the Pareto-optimal candidates.
   */
  async paretoCodesignEvaluate(request: any): Promise<Result<any[]>> {
    return guarded(
      () => invoke<any[]>('pareto_codesign_evaluate', { request }),
      () => {
        // Fallback browser demo: compute basic CAI and estimate pseudo folding energy
        const variants = request.mutations.map((mut: any) => {
          const simulatedCai = 0.65 + Math.random() * 0.25 - (mut.aaPositions.length * 0.03);
          const simulatedMrnaDg = -4.0 - Math.random() * 8.0 + (mut.aaPositions.length * 0.5);
          return {
            id: mut.id,
            mutations: mut.label,
            proteinEnergyDelta: mut.proteinEnergyDelta,
            cai: Math.round(simulatedCai * 1000) / 1000,
            mrnaDeltaG: Math.round(simulatedMrnaDg * 10) / 10,
            isParetoOptimal: false,
            updatedDna: request.dnaSequence,
          };
        });

        // Compute Pareto efficiency: lower proteinEnergyDelta is better, higher CAI is better.
        for (let i = 0; i < variants.length; i++) {
          let dominant = false;
          for (let j = 0; j < variants.length; j++) {
            if (i === j) continue;
            const betterOrEqual = variants[j].proteinEnergyDelta <= variants[i].proteinEnergyDelta &&
                                 variants[j].cai >= variants[i].cai;
            const strictlyBetter = variants[j].proteinEnergyDelta < variants[i].proteinEnergyDelta ||
                                  variants[j].cai > variants[i].cai;
            if (betterOrEqual && strictlyBetter) {
              dominant = true;
              break;
            }
          }
          variants[i].isParetoOptimal = !dominant;
        }

        return variants;
      }
    );
  },

  /**
   * Simulates Golden Gate Type IIS multi-fragment restriction assembly.
   * Performs graph-based circular sequence ordering and overhang collision detection on Rust.
   */
  async simulateGoldenGateAssembly(fragments: string[], enzyme: string): Promise<Result<GoldenGateResponse>> {
    return guarded(
      () => invoke<GoldenGateResponse>('simulate_goldengate_assembly', { request: { fragments, enzyme } }),
      () => {
        // Fallback browser implementation of Golden Gate assembly
        const parsedFragments: GoldenGateAssemblyFragment[] = [];
        const errors: string[] = [];
        const warnings: string[] = [];
        const siteFwd = enzyme === 'BsaI' ? 'GGTCTC' : enzyme === 'BsmBI' ? 'CGTCTC' : 'GAAGAC';
        const siteRev = enzyme === 'BsaI' ? 'GAGACC' : enzyme === 'BsmBI' ? 'GAGACG' : 'GTCTTC';
        const offset = enzyme === 'BbsI' ? 8 : 7;

        for (let i = 0; i < fragments.length; i++) {
          const frag = fragments[i].trim().toUpperCase();
          if (frag.length < 15) {
            errors.push(m.ggFragmentTooShort({ n: i + 1 }));
            continue;
          }
          const fwdPos = frag.indexOf(siteFwd);
          const revPos = frag.indexOf(siteRev);

          if (fwdPos >= 0 && revPos >= 0 && fwdPos < revPos) {
            const leftOverhang = frag.substring(fwdPos + offset, fwdPos + offset + 4);
            const rightOverhang = frag.substring(revPos - 4, revPos);
            const insertSeq = frag.substring(fwdPos + offset + 4, revPos - 4);
            parsedFragments.push({
              index: i,
              originalLen: frag.length,
              leftOverhang,
              rightOverhang,
              insertSeq,
              orientationForward: true,
            });
          } else {
            errors.push(m.ggFragmentMissingSites({ n: i + 1, siteFwd, siteRev }));
          }
        }

        if (errors.length > 0) {
          return {
            success: false, productSeq: '', fragments: parsedFragments,
            sortedIndices: [], overhangs: [], errors, warnings
          };
        }

        // Simulating standard order assembly [0 -> 1 -> 2...]
        let productSeq = '';
        const sortedIndices: number[] = [];
        const overhangs: string[] = [];
        let currentOverhang = parsedFragments[0].leftOverhang;

        for (let i = 0; i < parsedFragments.length; i++) {
          const frag = parsedFragments[i];
          productSeq += frag.insertSeq;
          sortedIndices.push(frag.index);
          overhangs.push(frag.leftOverhang);
        }

        // Circular check
        if (parsedFragments[parsedFragments.length - 1].rightOverhang !== currentOverhang) {
          warnings.push(m.ggCircularizeMismatch());
        }

        return {
          success: true,
          productSeq,
          fragments: parsedFragments,
          sortedIndices,
          overhangs,
          errors,
          warnings
        };
      }
    );
  },
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
