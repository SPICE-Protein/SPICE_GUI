//! ONNX inference of the SPICE pre-train model, plus the exact preprocessing
//! contract (tokenization + environment normalization) from
//! `model/docs/ONNX_USAGE.md` and `spice_pre/data/preprocessing.py`.
//!
//! The exported graph `export/spice_infer_fixed.onnx` has 3 inputs
//! (`tokens` int32 [B,L], `env` f32 [B,3], `mask` f32 [B,L]) and 6 outputs:
//! coords [B,L,3], dist_logits [B,L,L,48], mutation [B,L,20],
//! coords_mut [B,L,3], env_offset [B,2], conf [B,2].

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;

// AA order used by the tokenizer (1..20). Anything else -> 21 (unknown).
const AA: &str = "ACDEFGHIKLMNPQRSTVWY";

#[derive(Debug, Clone, Copy)]
pub struct Env3 {
    pub ph: f32,
    pub temp_k: f32,
    pub ionic_strength_m: f32,
}

/// Normalized environment vector (mirrors `normalize_env` in the Python pipeline).
pub fn normalize_env(e: Env3) -> [f32; 3] {
    let ph = ((e.ph - 0.0) / (14.0 - 0.0)).clamp(0.0, 1.0);
    let t = ((e.temp_k - 150.0) / (400.0 - 150.0)).clamp(0.0, 1.0);
    let ionic = e.ionic_strength_m.clamp(1e-3, 1.0);
    let i = (ionic.log10() / 1e-3f32.log10()).clamp(0.0, 1.0);
    [ph, t, i]
}

/// Tokenize a 1-letter sequence: 0 = padding (unused here), 1..20 = AA, 21 = unknown.
pub fn seq_to_tokens(seq: &str) -> Vec<i64> {
    let bytes = seq.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    for &b in bytes {
        let c = b as char;
        let tok = AA.find(c).map(|i| i as i64 + 1).unwrap_or(21);
        out.push(tok);
    }
    out
}

/// Distogram bin geometry (48 bins, 3..48 Å) — must match the Python postprocessing.
fn distogram_geometry() -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    // edges = linspace(3, 48, 47)
    let n = 47usize;
    let mut edges = Vec::with_capacity(n);
    for i in 0..n {
        edges.push(3.0 + (48.0 - 3.0) * (i as f32) / ((n - 1) as f32));
    }
    // centers = midpoints of [0, edges..., 72]
    let mut bounds = Vec::with_capacity(n + 2);
    bounds.push(0.0);
    bounds.extend_from_slice(&edges);
    bounds.push(72.0);
    let centers: Vec<f32> = bounds
        .windows(2)
        .map(|w| (w[0] + w[1]) / 2.0)
        .collect(); // 48
    // contact bins: those with edge < 8 Å
    let contact_bins = edges.iter().filter(|&&e| e < 8.0).count(); // 6
    let contact_mask: Vec<f32> = (0..centers.len())
        .map(|k| if k < contact_bins { 1.0 } else { 0.0 })
        .collect();
    (edges, centers, contact_mask)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FoldOutput {
    pub length: usize,
    /// Head A — Cα trace [L,3] Å
    pub coords: Vec<f32>,
    /// Head B' — mutant Cα trace [L,3] Å (pretrained weights are random, so this differs from the reference structure)
    pub coords_mut: Vec<f32>,
    /// Distogram — expected pairwise Cα distance matrix [L,L] Å
    pub dist_exp: Vec<f32>,
    /// Contact probability (Cα–Cα < 8 Å) [L,L]
    pub p_contact: Vec<f32>,
    /// Head B — per-position mutation probabilities [L,20] (softmax)
    pub mutation: Vec<f32>,
    /// Head C — environment offset [ΔpH, ΔT] (raw suggestion)
    pub env_offset: Vec<f32>,
    /// Head D — two-path stability confidence [pathA, pathB] ∈ [0,1]
    pub conf: Vec<f32>,
    /// Heads that actually carry trained weights in this checkpoint
    pub trained_heads: Vec<String>,
    pub model_path: String,
    pub run_ms: f64,
}

pub struct OnnxSession {
    // ort v2 `Session::run` takes `&mut self`; Mutex lets us share the session
    // across commands while serializing access.
    session: std::sync::Mutex<ort::session::Session>,
    pub model_path: String,
}

impl OnnxSession {
    pub fn load(path: &std::path::Path) -> Result<Self, String> {
        let session = ort::session::Session::builder()
            .map_err(|e| format!("ort builder: {e}"))?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)
            .map_err(|e| format!("ort opt: {e}"))?
            .commit_from_file(path)
            .map_err(|e| format!("ort load '{}': {e}", path.display()))?;
        Ok(Self {
            session: std::sync::Mutex::new(session),
            model_path: path.display().to_string(),
        })
    }
}

/// Canonical locations searched for the exported ONNX model.
pub fn default_model_candidates() -> Vec<PathBuf> {
    let mut v = vec![
        PathBuf::from("../model/export/spice_infer_fixed.onnx"),
        PathBuf::from("../../model/export/spice_infer_fixed.onnx"),
        PathBuf::from("model/export/spice_infer_fixed.onnx"),
        PathBuf::from("/Users/redelectricity/Documents/Projects/SPICE/model/export/spice_infer_fixed.onnx"),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join("spice_infer_fixed.onnx"));
            v.push(dir.join("../../model/export/spice_infer_fixed.onnx"));
        }
    }
    v
}

pub fn find_model(explicit: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = explicit {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Ok(pb);
        }
        return Err(format!("model not found at explicit path: {p}"));
    }
    for cand in default_model_candidates() {
        if cand.exists() {
            return Ok(cand);
        }
    }
    Err("i18n:beErrOnnxModelMissing".to_string())
}

/// Run full-head inference for one sequence (batch 1).
/// `logits_only` unused for now; we always compute the derived distance maps.
pub fn infer(
    sess: &OnnxSession,
    seq: &str,
    env: Env3,
) -> Result<FoldOutput, String> {
    let l = seq.len();
    if l == 0 {
        return Err("empty sequence".into());
    }
    if l > 1024 {
        return Err(format!("sequence too long ({l} > 1024 positional-encoding cap)"));
    }
    let tokens = seq_to_tokens(seq); // [L] i64
    let envn = normalize_env(env); // [3]
    let mask = vec![1.0f32; l];

    let tokens_t = ort::value::Tensor::from_array(([1usize, l], tokens))
        .map_err(|e| format!("tokens tensor: {e}"))?;
    let env_t = ort::value::Tensor::from_array(([1usize, 3], envn.to_vec()))
        .map_err(|e| format!("env tensor: {e}"))?;
    let mask_t = ort::value::Tensor::from_array(([1usize, l], mask))
        .map_err(|e| format!("mask tensor: {e}"))?;

    let start = std::time::Instant::now();
    let mut guard = sess
        .session
        .lock()
        .map_err(|e| format!("onnx session lock: {e}"))?;
    let outputs = guard
        .run(ort::inputs! {
            "tokens" => tokens_t,
            "env"    => env_t,
            "mask"   => mask_t,
        })
        .map_err(|e| format!("onnx run: {e}"))?;

    let coords = extract_f32(&outputs, "coords")?; // Head A [1,L,3] flat
    let dist_logits = extract_f32(&outputs, "dist_logits")?; // [1,L,L,48] flat
    let mutation = extract_f32(&outputs, "mutation")?; // Head B [1,L,20] flat
    let coords_mut = extract_f32(&outputs, "coords_mut")?; // Head B' [1,L,3] flat
    let env_offset = extract_f32(&outputs, "env_offset")?; // Head C [1,2] flat
    let conf = extract_f32(&outputs, "conf")?; // Head D [1,2] flat
    drop(outputs);
    drop(guard);

    let run_ms = start.elapsed().as_secs_f64() * 1000.0;

    // --- postprocess ---
    // batch dim is 1, so the flat arrays are already [L,3] / [L,L,48] / [L,20]...
    let coords_vec: Vec<f32> = coords.clone();

    let (_, centers, contact_mask) = distogram_geometry();
    let mut dist_exp = vec![0.0f32; l * l];
    let mut p_contact = vec![0.0f32; l * l];
    // softmax over the last axis of dist_logits [1,L,L,48]
    let logs = &dist_logits;
    for i in 0..l {
        for j in 0..l {
            let base = (i * l + j) * 48;
            // numerically-stable softmax
            let mut mx = f32::NEG_INFINITY;
            for k in 0..48 {
                mx = mx.max(logs[base + k]);
            }
            let mut sum = 0.0f32;
            let mut p = [0.0f32; 48];
            for k in 0..48 {
                let e = (logs[base + k] - mx).exp();
                p[k] = e;
                sum += e;
            }
            let mut dexp = 0.0f32;
            let mut pc = 0.0f32;
            for k in 0..48 {
                let pr = p[k] / sum;
                dexp += pr * centers[k];
                pc += pr * contact_mask[k];
            }
            dist_exp[i * l + j] = dexp;
            p_contact[i * l + j] = pc;
        }
    }

    // mutation -> softmax [L,20]
    let mut mutation_soft = Vec::with_capacity(l * 20);
    let mlogs = &mutation;
    for i in 0..l {
        let base = i * 20;
        let mut mx = f32::NEG_INFINITY;
        for k in 0..20 {
            mx = mx.max(mlogs[base + k]);
        }
        let mut sum = 0.0f32;
        let mut ps = [0.0f32; 20];
        for k in 0..20 {
            let e = (mlogs[base + k] - mx).exp();
            ps[k] = e;
            sum += e;
        }
        for k in 0..20 {
            mutation_soft.push(ps[k] / sum);
        }
    }

    Ok(FoldOutput {
        length: l,
        coords: coords_vec,
        coords_mut,
        dist_exp,
        p_contact,
        mutation: mutation_soft,
        env_offset: env_offset[..2].to_vec(),
        conf: conf[..2].to_vec(),
        trained_heads: vec!["A".into(), "distogram".into()],
        model_path: sess.model_path.clone(),
        run_ms,
    })
}

/// Extract an f32 tensor output by name, flattened row-major.
fn extract_f32(outputs: &ort::session::SessionOutputs, name: &str) -> Result<Vec<f32>, String> {
    let value = outputs
        .get(name)
        .ok_or_else(|| format!("missing output {name}"))?;
    let arr = value
        .try_extract_array::<f32>()
        .map_err(|e| format!("output {name}: {e}"))?;
    Ok(arr.iter().copied().collect())
}

/// Lazy ONNX session holder (init on first fold, shared across commands).
pub struct OnnxState {
    pub session: Mutex<Option<Arc<OnnxSession>>>,
    /// User-set model path override (settings panel / downloaded model).
    pub override_path: Mutex<Option<PathBuf>>,
}

impl OnnxState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            override_path: Mutex::new(None),
        }
    }

    /// Point the session at a specific model file (download / manual path).
    pub fn set_override(&self, path: PathBuf) {
        *self.override_path.lock().unwrap() = Some(path);
    }

    /// Clear the override and fall back to the canonical candidates.
    pub fn clear_override(&self) {
        *self.override_path.lock().unwrap() = None;
    }

    /// Get a loaded session, (re)loading from `model_path` / override / candidates.
    pub fn get(&self, model_path: Option<&str>) -> Result<Arc<OnnxSession>, String> {
        let path = if let Some(p) = model_path {
            PathBuf::from(p)
        } else if let Some(o) = self.override_path.lock().unwrap().clone() {
            o
        } else {
            find_model(None)?
        };

        let mut guard = self.session.lock().map_err(|e| e.to_string())?;
        let path_str = path.display().to_string();
        if let Some(s) = guard.as_ref() {
            if s.model_path == path_str {
                return Ok(s.clone());
            }
        }
        let sess = OnnxSession::load(&path)?;
        let arc = Arc::new(sess);
        *guard = Some(arc.clone());
        Ok(arc)
    }
}
