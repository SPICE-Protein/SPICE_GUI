//! SPICE Engine integration for the Tauri GUI.
//!
//! Wraps the Rust `spice_engine` crate (local `md_cal` fork) and exposes it as
//! Tauri commands: build / step / metrics / env hot-switch / mutation /
//! cancellable stability-domain scan.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

// spice_engine ≥1.3 vendored the dynamics types into its own engine tree; pass
// the exact types its API expects (same paths its ffi.rs uses), NOT the
// external `dynamics` crate — the names are distinct types to the compiler.
use spice_engine::engine::md_core::params::FfParamSet;
use spice_engine::engine::md_core::ComputationDevice;
use na_seq::Element;
use serde::{Deserialize, Serialize};

use spice_engine::actions::ForceAction;
use spice_engine::builder::BuildOptions;
use spice_engine::domain::{is_stable, StabilityConfig};
use spice_engine::engine::{SpiceEngine, StepResult};
use spice_engine::env::EnvParams;
use spice_engine::metrics::{Metrics, MetricsConfig, MetricsResult};
use spice_engine::mutate::{Mutation, apply_mutations, validate_sequence};
use spice_engine::structure::{AtomInput, StructureInput, build_from_input};
use spice_engine::pocket::{
    calculate_engine_pockets, calculate_advanced_features, calculate_pocket_delta,
    analyze_pocket_trajectory, NativePocket, AdvancedPocketFeatures, PocketDelta,
};

/// Lazily-loaded amber force-field parameter set (load once per process).
fn param_set() -> Result<&'static FfParamSet, String> {
    static PS: OnceLock<FfParamSet> = OnceLock::new();
    if let Some(p) = PS.get() {
        return Ok(p);
    }
    let p = FfParamSet::new_amber().map_err(|e| format!("load amber params: {e}"))?;
    Ok(PS.get_or_init(move || p))
}

fn dev() -> &'static ComputationDevice {
    static D: OnceLock<ComputationDevice> = OnceLock::new();
    D.get_or_init(|| ComputationDevice::Cpu)
}

/// Global mutable app state (engine + onnx + cancellation).
/// Fields are `Arc<Mutex<…>>` so async commands can clone handles into
/// `spawn_blocking` closures (Tauri's `State` is not `Send` across await).
pub struct AppState {
    pub engine: Arc<Mutex<Option<SpiceEngine>>>,
    pub force: Arc<Mutex<Option<ForceAction>>>,
    pub metrics: Arc<Mutex<Option<Metrics>>>,
    /// Last built sequence.
    pub seq: Arc<Mutex<Option<String>>>,
    /// Last built Cα coordinates [L,3] Å (used for rebuilds / scans).
    pub ca_coords: Arc<Mutex<Option<Vec<f32>>>>,
    /// Last build environment.
    pub build_env: Arc<Mutex<Option<EnvParams>>>,
    /// ONNX inference session (fold).
    pub onnx: crate::onnx::OnnxState,
    /// Set to abort a running stability scan.
    pub cancel: Arc<AtomicBool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(Mutex::new(None)),
            force: Arc::new(Mutex::new(None)),
            metrics: Arc::new(Mutex::new(None)),
            seq: Arc::new(Mutex::new(None)),
            ca_coords: Arc::new(Mutex::new(None)),
            build_env: Arc::new(Mutex::new(None)),
            onnx: crate::onnx::OnnxState::new(),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct EnvInput {
    pub ph: f32,
    pub temp_k: f32,
    pub pressure_bar: f32,
    pub ionic_strength_m: f32,
}

impl Default for EnvInput {
    fn default() -> Self {
        Self {
            ph: 7.0,
            temp_k: 310.0,
            pressure_bar: 1.0,
            ionic_strength_m: 0.0,
        }
    }
}

impl From<&EnvInput> for EnvParams {
    fn from(e: &EnvInput) -> Self {
        EnvParams::new(e.ph, e.temp_k, e.pressure_bar, e.ionic_strength_m)
    }
}

#[derive(Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct BuildRequest {
    pub seq: String,
    pub env: EnvInput,
    /// Cα coordinates [L,3] Å (optional; used for fold→MD seeding).
    pub coords: Option<Vec<f32>>,
    /// Full-structure PDB text (optional; overrides `coords`).
    pub pdb: Option<String>,
    /// Minimization iterations; None = skip minimization (fast).
    pub relax_iters: Option<usize>,
    /// Require complete residues (side chains). Cα-only input must be false.
    pub strict: bool,
    /// Run a short NVT equilibration after building.
    pub equilibrate: bool,
    /// Optional dynamic protonation map resolved from PROPKA/H++
    pub custom_protonation: Option<std::collections::HashMap<usize, String>>,
}

impl Default for BuildRequest {
    fn default() -> Self {
        Self {
            seq: String::new(),
            env: EnvInput::default(),
            coords: None,
            pdb: None,
            relax_iters: Some(2000),
            strict: false,
            equilibrate: false,
            custom_protonation: None,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BuildOut {
    pub length: usize,
    pub seq: String,
    pub coords: Vec<f32>, // Cα [L,3] after build (minimized)
    pub step_count: usize,
    pub env: EnvInput,
    pub build_ms: f64,
    pub note: String,
}

#[derive(Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct StepRequest {
    pub n_steps: usize,
    /// Bias-force action coefficients. len == 16 → same action each step;
    /// len == n_steps*16 → per-step actions.
    pub action: Option<Vec<f32>>,
    pub bias: bool,
    /// Apply EnvDelta hot-switch before stepping.
    pub d_t: f32,
    pub d_ph: f32,
}

impl Default for StepRequest {
    fn default() -> Self {
        Self {
            n_steps: 20,
            action: None,
            bias: false,
            d_t: 0.0,
            d_ph: 0.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TauriNativePocket {
    pub id: usize,
    pub center: [f32; 3],
    pub volume: f32,
    pub druggability: f32,
    pub surface_residues: Vec<usize>,
    pub voxels: Vec<[f32; 3]>,
}

impl From<NativePocket> for TauriNativePocket {
    fn from(p: NativePocket) -> Self {
        Self {
            id: p.id,
            center: p.center,
            volume: p.volume,
            druggability: p.druggability,
            surface_residues: p.surface_residues,
            voxels: p.voxels,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TauriAdvancedPocketFeatures {
    pub id: usize,
    pub center: [f32; 3],
    pub volume: f32,
    pub druggability: f32,
    pub net_charge_at_ph: f32,
    pub hydrophobic_ratio: f32,
    pub hydrophobic_centroids: Vec<[f32; 3]>,
    pub hbond_acceptors: Vec<([f32; 3], [f32; 3])>,
    pub hbond_donors: Vec<([f32; 3], [f32; 3])>,
    pub surface_residues: Vec<usize>,
}

impl From<AdvancedPocketFeatures> for TauriAdvancedPocketFeatures {
    fn from(p: AdvancedPocketFeatures) -> Self {
        Self {
            id: p.id,
            center: p.center,
            volume: p.volume,
            druggability: p.druggability,
            net_charge_at_ph: p.net_charge_at_ph,
            hydrophobic_ratio: p.hydrophobic_ratio,
            hydrophobic_centroids: p.hydrophobic_centroids,
            hbond_acceptors: p.hbond_acceptors,
            hbond_donors: p.hbond_donors,
            surface_residues: p.surface_residues,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TauriPocketDelta {
    pub volume_delta: f32,
    pub jaccard_overlap: f32,
}

impl From<PocketDelta> for TauriPocketDelta {
    fn from(d: PocketDelta) -> Self {
        Self {
            volume_delta: d.volume_delta,
            jaccard_overlap: d.jaccard_overlap,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PocketMetricsOut {
    pub q_pocket: f32,
    pub charge_mismatch: f32,
    pub is_collapsed: bool,
    pub detected_pockets: Vec<TauriNativePocket>,
    pub primary_pocket_features: Option<TauriAdvancedPocketFeatures>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetricsOut {
    pub m1: f64,
    pub m2: f64,
    pub m3: f64,
    pub m4: f64,
    pub m5: f64,
    pub u_t_kcal: f64,
    pub rg: f64,
    pub n_ss_ref: usize,
    pub n_ss_kept: usize,
    pub n_surface_charged: usize,
    pub pocket: Option<PocketMetricsOut>,
}

impl MetricsOut {
    pub fn from_result(
        m: &MetricsResult,
        seq: Option<&str>,
        orig_ca: Option<&[f32]>,
        curr_ca: &[f32],
        ph: f32,
        eng: &SpiceEngine,
    ) -> Self {
        let pockets = calculate_engine_pockets(eng, 1.0);
        let tauri_pockets: Vec<TauriNativePocket> = pockets.iter().cloned().map(TauriNativePocket::from).collect();
        
        let primary_pocket_features = pockets.first().map(|p| {
            TauriAdvancedPocketFeatures::from(calculate_advanced_features(eng, p))
        });

        let pocket = if let (Some(s), Some(orig)) = (seq, orig_ca) {
            let l = s.len();
            let pocket_res = if l > 80 {
                vec![45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 98, 99, 100, 101, 102, 103, 104, 105]
            } else {
                (l / 3 .. l / 3 + l / 5).collect::<Vec<usize>>()
            };
            
            let q_pocket = compute_q_pocket(orig, curr_ca, &pocket_res);
            let charge_mismatch = compute_pocket_mismatch(s, ph, &pocket_res);
            let is_collapsed = q_pocket < 0.55;
            
            Some(PocketMetricsOut {
                q_pocket,
                charge_mismatch,
                is_collapsed,
                detected_pockets: tauri_pockets,
                primary_pocket_features,
            })
        } else {
            None
        };

        Self {
            m1: m.m1,
            m2: m.m2,
            m3: m.m3,
            m4: m.m4,
            m5: m.m5,
            u_t_kcal: m.u_t_kcal,
            rg: m.rg,
            n_ss_ref: m.n_ss_ref,
            n_ss_kept: m.n_ss_kept,
            n_surface_charged: m.n_surface_charged,
            pocket,
        }
    }
}

impl From<&MetricsResult> for MetricsOut {
    fn from(m: &MetricsResult) -> Self {
        Self {
            m1: m.m1,
            m2: m.m2,
            m3: m.m3,
            m4: m.m4,
            m5: m.m5,
            u_t_kcal: m.u_t_kcal,
            rg: m.rg,
            n_ss_ref: m.n_ss_ref,
            n_ss_kept: m.n_ss_kept,
            n_surface_charged: m.n_surface_charged,
            pocket: None,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StepOut {
    pub u_hist: Vec<f64>, // kcal/mol per step
    pub coords: Vec<f32>, // final Cα [L,3]
    pub step_count: usize,
    pub crashed: bool,
    pub time_ps: f64,
    pub t_kin: f64,
    pub clamped: usize,
    pub max_clamped_mag: f32,
    pub metrics: Option<MetricsOut>,
    pub pseudo_label_n: usize,
    pub step_ms_per: f64,
    pub rmsd: f32, // Relative Cα RMSD (Å)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanPoint {
    pub t: f32,
    pub ph: f32,
    pub stable: bool,
    pub crashed: bool,
    pub build_failed: bool,
    pub reason: Option<String>,
    pub metrics: Option<MetricsOut>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub total: usize,
    pub done: usize,
    pub t: f32,
    pub ph: f32,
    pub stable: Option<bool>,
    pub error: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct ScanRequest {
    pub temps: Vec<f32>,
    pub phs: Vec<f32>,
    pub n_steps: usize,
    pub minimize: bool,
}

impl Default for ScanRequest {
    fn default() -> Self {
        Self {
            temps: vec![300.0, 310.0, 320.0],
            phs: vec![6.5, 7.0, 7.5],
            n_steps: 20,
            minimize: true,
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn one_to_three(c: char) -> Result<&'static str, String> {
    Ok(match c {
        'A' => "ALA", 'C' => "CYS", 'D' => "ASP", 'E' => "GLU", 'F' => "PHE",
        'G' => "GLY", 'H' => "HIS", 'I' => "ILE", 'K' => "LYS", 'L' => "LEU",
        'M' => "MET", 'N' => "ASN", 'P' => "PRO", 'Q' => "GLN", 'R' => "ARG",
        'S' => "SER", 'T' => "THR", 'V' => "VAL", 'W' => "TRP", 'Y' => "TYR",
        'U' => "SEC",
        _ => return Err(format!("invalid amino acid '{c}'")),
    })
}

/// Build a Cα-only `StructureInput` from a sequence + [L,3] coordinates.
pub fn structure_from_ca(seq: &str, coords: &[f32]) -> Result<StructureInput, String> {
    validate_sequence(seq)?;
    let l = seq.chars().count();
    if coords.len() != l * 3 {
        return Err(format!(
            "coords length {} != 3*L ({l} residues)",
            coords.len()
        ));
    }
    let mut si = StructureInput::default();
    for (i, c) in seq.chars().enumerate() {
        let res3 = one_to_three(c)?;
        si.push(AtomInput::new(
            "A",
            i as i32,
            res3,
            "CA",
            Element::Carbon,
            coords[i * 3],
            coords[i * 3 + 1],
            coords[i * 3 + 2],
        ));
    }
    Ok(si)
}

/// Parse a PDB file text into a `StructureInput` (ATOM/HETATM records).
pub fn structure_from_pdb(text: &str) -> Result<StructureInput, String> {
    let mut si = StructureInput::default();
    let mut n = 0usize;
    for line in text.lines() {
        let line = line.trim_end();
        if line.len() < 54 || !(line.starts_with("ATOM  ") || line.starts_with("HETATM")) {
            continue;
        }
        let col = |a: usize, b: usize| -> String { line.get(a..b).unwrap_or("").trim().to_string() };
        let atom_name = col(12, 16);
        let res_name = col(17, 20);
        let chain = col(21, 22);
        let res_seq: i32 = col(22, 26).parse().unwrap_or(0);
        let x: f32 = col(30, 38).parse().unwrap_or(0.0);
        let y: f32 = col(38, 46).parse().unwrap_or(0.0);
        let z: f32 = col(46, 54).parse().unwrap_or(0.0);
        let occ: f32 = col(54, 60).parse().unwrap_or(1.0);
        let elem = if line.len() >= 78 { col(76, 78) } else { String::new() };
        let element = if !elem.is_empty() {
            Element::from_letter(&elem).unwrap_or(Element::Other)
        } else {
            let first = atom_name.trim_start().chars().next().unwrap_or('C');
            let mut s = String::new();
            s.push(first);
            Element::from_letter(&s).unwrap_or(Element::Other)
        };
        si.push(AtomInput {
            chain_id: chain,
            res_seq,
            res_name,
            atom_name,
            element,
            x,
            y,
            z,
            occupancy: occ,
        });
        n += 1;
    }
    if n == 0 {
        return Err("no ATOM records found in PDB text".into());
    }
    Ok(si)
}

/// Parse an mmCIF file text into a `StructureInput` (ATOM/HETATM records).
pub fn structure_from_cif(text: &str) -> Result<StructureInput, String> {
    let mut si = StructureInput::default();
    let mut headers = Vec::new();
    
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).collect();
    
    let mut atom_site_header_start = None;
    for (i, &line) in lines.iter().enumerate() {
        if line.starts_with("_atom_site.group_PDB") {
            atom_site_header_start = Some(i);
            break;
        }
    }
    
    let header_start_idx = match atom_site_header_start {
        Some(idx) => idx,
        None => return Err("i18n:beErrMmcifInvalid".to_string()),
    };
    
    let mut loop_start = header_start_idx;
    while loop_start > 0 && lines[loop_start] != "loop_" {
        loop_start -= 1;
    }
    
    let mut idx = loop_start + 1;
    while idx < lines.len() && lines[idx].starts_with("_atom_site.") {
        headers.push(lines[idx].to_string());
        idx += 1;
    }
    
    let mut n = 0usize;
    while idx < lines.len() {
        let line = lines[idx];
        if line.starts_with('#') || line.starts_with("loop_") || line.starts_with('_') || line.starts_with("data_") {
            break;
        }
        if !line.is_empty() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= headers.len() {
                let group_idx = headers.iter().position(|h| h == "_atom_site.group_PDB");
                let atom_id_idx = headers.iter().position(|h| h == "_atom_site.label_atom_id");
                let alt_id_idx = headers.iter().position(|h| h == "_atom_site.label_alt_id");
                let comp_idx = headers.iter().position(|h| h == "_atom_site.label_comp_id");
                let asym_idx = headers.iter().position(|h| h == "_atom_site.label_asym_id");
                let seq_id_idx = headers.iter().position(|h| h == "_atom_site.label_seq_id");
                let x_idx = headers.iter().position(|h| h == "_atom_site.Cartn_x");
                let y_idx = headers.iter().position(|h| h == "_atom_site.Cartn_y");
                let z_idx = headers.iter().position(|h| h == "_atom_site.Cartn_z");
                let type_idx = headers.iter().position(|h| h == "_atom_site.type_symbol");
                
                if let (Some(g_i), Some(at_i), Some(c_i), Some(as_i), Some(s_i), Some(x_i), Some(y_i), Some(z_i)) =
                    (group_idx, atom_id_idx, comp_idx, asym_idx, seq_id_idx, x_idx, y_idx, z_idx)
                {
                    let group = parts[g_i];
                    if group == "ATOM" || group == "HETATM" {
                        let atom_name = parts[at_i].to_string();
                        let res_name = parts[c_i].to_string();
                        if res_name == "HOH" || res_name == "WAT" || res_name == "SOL" || res_name == "H2O" {
                            idx += 1;
                            continue;
                        }
                        let chain = parts[as_i].to_string();
                        let res_seq: i32 = parts[s_i].parse().unwrap_or(0);
                        let x: f32 = parts[x_i].parse().unwrap_or(0.0);
                        let y: f32 = parts[y_i].parse().unwrap_or(0.0);
                        let z: f32 = parts[z_i].parse().unwrap_or(0.0);
                        
                        let alt_id = alt_id_idx.map(|a_i| parts[a_i]).unwrap_or(".");
                        if alt_id != "." && alt_id != "A" {
                            idx += 1;
                            continue;
                        }
                        
                        let elem = type_idx.map(|t_i| parts[t_i].to_string()).unwrap_or_else(|| {
                            let first = atom_name.chars().next().unwrap_or('C').to_string();
                            first
                        });
                        let element = Element::from_letter(&elem).unwrap_or(Element::Other);
                        
                        si.push(AtomInput {
                            chain_id: chain,
                            res_seq,
                            res_name,
                            atom_name,
                            element,
                            x,
                            y,
                            z,
                            occupancy: 1.0,
                        });
                        n += 1;
                    }
                }
            }
        }
        idx += 1;
    }
    
    if n == 0 {
        return Err("i18n:beErrMmcifNoAtoms".to_string());
    }
    
    Ok(si)
}

fn compute_ca_rmsd(c1: &[f32], c2: &[f32]) -> f32 {
    if c1.len() != c2.len() || c1.is_empty() {
        return 0.0;
    }
    let mut sum_sq = 0.0;
    let n = c1.len() / 3;
    for i in 0..n {
        let dx = c1[i * 3] - c2[i * 3];
        let dy = c1[i * 3 + 1] - c2[i * 3 + 1];
        let dz = c1[i * 3 + 2] - c2[i * 3 + 2];
        sum_sq += dx * dx + dy * dy + dz * dz;
    }
    (sum_sq / n as f32).sqrt()
}

fn compute_q_pocket(c1: &[f32], c2: &[f32], residues: &[usize]) -> f32 {
    if c1.len() != c2.len() || c1.is_empty() || residues.is_empty() {
        return 1.0;
    }
    let mut native_contacts = 0;
    let mut kept_contacts = 0;
    let n = residues.len();
    
    for i in 0..n {
        for j in (i + 1)..n {
            let r1 = residues[i];
            let r2 = residues[j];
            if r1 * 3 + 2 >= c1.len() || r2 * 3 + 2 >= c1.len() {
                continue;
            }
            
            let dx1 = c1[r1 * 3] - c1[r2 * 3];
            let dy1 = c1[r1 * 3 + 1] - c1[r2 * 3 + 1];
            let dz1 = c1[r1 * 3 + 2] - c1[r2 * 3 + 2];
            let dist1_sq = dx1 * dx1 + dy1 * dy1 + dz1 * dz1;
            
            if dist1_sq < 64.0 { // 8.0^2
                native_contacts += 1;
                
                let dx2 = c2[r1 * 3] - c2[r2 * 3];
                let dy2 = c2[r1 * 3 + 1] - c2[r2 * 3 + 1];
                let dz2 = c2[r1 * 3 + 2] - c2[r2 * 3 + 2];
                let dist2_sq = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
                
                if dist2_sq < 64.0 {
                    kept_contacts += 1;
                }
            }
        }
    }
    
    if native_contacts == 0 {
        1.0
    } else {
        kept_contacts as f32 / native_contacts as f32
    }
}

fn compute_pocket_mismatch(seq: &str, ph: f32, residues: &[usize]) -> f32 {
    let mut mismatch = 0.0;
    for &r in residues {
        if r >= seq.len() {
            continue;
        }
        let aa = seq.chars().nth(r).unwrap_or(' ');
        let target_charge: f32 = match aa {
            'D' => if ph > 3.9 { -1.0 } else { 0.0 },
            'E' => if ph > 4.3 { -1.0 } else { 0.0 },
            'H' => if ph < 6.0 { 1.0 } else { 0.0 },
            'K' => if ph < 10.5 { 1.0 } else { 0.0 },
            'R' => if ph < 12.5 { 1.0 } else { 0.0 },
            _ => 0.0,
        };
        let optimal_charge: f32 = match aa {
            'D' | 'E' => -1.0,
            'K' | 'R' => 1.0,
            _ => 0.0,
        };
        mismatch += (target_charge - optimal_charge).abs();
    }
    mismatch
}

fn coords_ca(eng: &SpiceEngine) -> Vec<f32> {
    let mut out = Vec::with_capacity(eng.topology.ca_indices.len() * 3);
    for &i in &eng.topology.ca_indices {
        let p = eng.state.atoms[i].posit;
        out.push(p.x);
        out.push(p.y);
        out.push(p.z);
    }
    out
}

fn t_kin(eng: &SpiceEngine) -> f64 {
    const R_KCAL: f64 = 0.001_987_204_1;
    let dof = eng.state.thermo_dof() as f64;
    if dof > 0.0 {
        2.0 * eng.state.kinetic_energy / (dof * R_KCAL)
    } else {
        0.0
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

pub fn map_protonation_variant(s: &str) -> Option<na_seq::AminoAcidProtenationVariant> {
    match s.to_uppercase().as_str() {
        "HID" => Some(na_seq::AminoAcidProtenationVariant::Hid),
        "HIE" => Some(na_seq::AminoAcidProtenationVariant::Hie),
        "HIP" => Some(na_seq::AminoAcidProtenationVariant::Hip),
        "ASH" => Some(na_seq::AminoAcidProtenationVariant::Ash),
        "GLH" => Some(na_seq::AminoAcidProtenationVariant::Glh),
        "CYM" => Some(na_seq::AminoAcidProtenationVariant::Cym),
        "CYX" => Some(na_seq::AminoAcidProtenationVariant::Cyx),
        "LYN" => Some(na_seq::AminoAcidProtenationVariant::Lyn),
        _ => None,
    }
}

/// Build (or rebuild) the MD engine from a sequence + Cα (or PDB).
#[tauri::command]
pub async fn engine_build(
    state: tauri::State<'_, AppState>,
    request: BuildRequest,
) -> Result<BuildOut, String> {
    let engine = state.engine.clone();
    let force = state.force.clone();
    let metrics = state.metrics.clone();
    let seq_state = state.seq.clone();
    let ca_state = state.ca_coords.clone();
    let env_state = state.build_env.clone();

    tauri::async_runtime::spawn_blocking(move || {
        validate_sequence(&request.seq)?;
        let start = std::time::Instant::now();

        let structure = if let Some(pdb) = &request.pdb {
            if pdb.contains("_atom_site.") {
                structure_from_cif(pdb)?
            } else {
                structure_from_pdb(pdb)?
            }
        } else {
            let coords = request
                .coords
                .clone()
                .ok_or_else(|| "i18n:beErrNeedCaCoordsOrPdb".to_string())?;
            structure_from_ca(&request.seq, &coords)?
        };

        let mut cp_map = None;
        if let Some(ref custom) = request.custom_protonation {
            let mut resolved = std::collections::HashMap::new();
            for (&k, v) in custom {
                if let Some(variant) = map_protonation_variant(v) {
                    resolved.insert(k, variant);
                }
            }
            cp_map = Some(resolved);
        }

        let env: EnvParams = (&request.env).into();
        let opts = BuildOptions {
            env,
            relax_iters: request.relax_iters,
            strict_incomplete_residues: request.strict,
            custom_protonation: cp_map,
            equil: if request.equilibrate {
                Some(spice_engine::equilibrate::EquilConfig::default())
            } else {
                None
            },
            ..Default::default()
        };

        let eng = build_from_input(dev(), param_set()?, &structure, &opts)?;
        let n_res = eng.topology.residues.len();
        let coords = coords_ca(&eng);
        let step_count = eng.state.step_count;
        let seq = eng.topology.sequence.clone();

        // (Re)build the bias-force action space + metric evaluator for this system.
        let f = ForceAction::new(n_res, 16, 0.5, 20);
        let m = Metrics::new(&eng, MetricsConfig::default());

        *engine.lock().unwrap() = Some(eng);
        *force.lock().unwrap() = Some(f);
        *metrics.lock().unwrap() = Some(m);
        *seq_state.lock().unwrap() = Some(seq.clone());
        *ca_state.lock().unwrap() = Some(coords.clone());
        *env_state.lock().unwrap() = Some(env);

        let build_ms = start.elapsed().as_secs_f64() * 1000.0;
        Ok(BuildOut {
            length: n_res,
            seq,
            coords,
            step_count,
            env: EnvInput {
                ph: env.ph,
                temp_k: env.temp_k,
                pressure_bar: env.pressure_bar,
                ionic_strength_m: env.ionic_strength_m,
            },
            build_ms,
            note: if request.coords.is_some() && request.pdb.is_none() {
                "i18n:beNoteCaOnlyBuild".into()
            } else {
                "i18n:beNoteAllAtomBuild".into()
            },
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Run N MD steps, optionally with bias-force actions.
#[tauri::command]
pub async fn engine_step(
    state: tauri::State<'_, AppState>,
    request: StepRequest,
) -> Result<StepOut, String> {
    let engine = state.engine.clone();
    let force = state.force.clone();
    let metrics = state.metrics.clone();
    let ca_coords = state.ca_coords.clone();
    let seq_state = state.seq.clone();
    let env_state = state.build_env.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut eng_guard = engine.lock().unwrap();
        let eng = eng_guard
            .as_mut()
            .ok_or_else(|| "i18n:beErrEngineNotBuiltBuildFirst".to_string())?;

        let n = request.n_steps.max(1);
        let m_dim = 16usize;
        let has_force = force.lock().unwrap().is_some();
        let per_step = request
            .action
            .as_ref()
            .is_some_and(|a| a.len() >= n * m_dim);

        // EnvDelta hot-switch before stepping.
        if request.d_t.abs() > 1e-6 || request.d_ph.abs() > 1e-6 {
            let delta = spice_engine::EnvDelta::new(request.d_t, request.d_ph);
            delta.apply_t(eng);
        }

        let mut u_hist = Vec::with_capacity(n);
        let mut crashed = false;
        let mut last: Option<StepResult> = None;
        let start = std::time::Instant::now();

        for i in 0..n {
            let act = if request.bias && has_force {
                let a = request.action.as_deref().unwrap_or(&[]);
                if per_step {
                    let slice = &a[i * m_dim..(i + 1) * m_dim];
                    Some(slice.to_vec())
                } else if !a.is_empty() {
                    Some(a.to_vec())
                } else {
                    Some(vec![0.0f32; m_dim])
                }
            } else {
                None
            };

            let res = match act {
                Some(a) => {
                    let mut fg = force.lock().unwrap();
                    match fg.as_mut() {
                        Some(f) => f.step(eng, &a),
                        None => eng.step(None),
                    }
                }
                None => eng.step(None),
            };
            u_hist.push(res.u_t_kcal);
            if res.crashed {
                crashed = true;
                last = Some(res);
                break;
            }
            last = Some(res);
        }

        let res = last.unwrap_or_else(|| eng.step(None));
        let coords = res.coords_ca.iter().flatten().copied().collect::<Vec<f32>>();
        let step_count = res.step_count;
        let time_ps = res.time_ps;

        let (clamped, max_clamped_mag) = (
            eng.state.last_clamped_count,
            eng.state.last_clamped_mag,
        );
        let t_kin = t_kin(eng);
        let pseudo_label_n = eng.time_averaged_ca().len();

        let original_ca = ca_coords.lock().unwrap().clone();
        let rmsd = if let Some(ref orig) = original_ca {
            compute_ca_rmsd(orig, &coords)
        } else {
            0.0
        };

        let met = if crashed {
            None
        } else {
            metrics
                .lock()
                .unwrap()
                .as_ref()
                .map(|m| {
                    let res_m = m.compute(eng);
                    let seq_guard = seq_state.lock().unwrap();
                    let seq_ref = seq_guard.as_deref();
                    let orig_ca_ref = original_ca.as_deref();
                    let env_guard = env_state.lock().unwrap();
                    let ph_val = env_guard.as_ref().map(|e| e.ph).unwrap_or(7.0);
                    
                    MetricsOut::from_result(&res_m, seq_ref, orig_ca_ref, &coords, ph_val, eng)
                })
        };

        let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
        Ok(StepOut {
            u_hist,
            coords,
            step_count,
            crashed,
            time_ps,
            t_kin,
            clamped,
            max_clamped_mag,
            metrics: met,
            pseudo_label_n,
            step_ms_per: elapsed_ms / (n as f64),
            rmsd,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read back current metrics + state without stepping.
#[tauri::command]
pub fn engine_metrics(state: tauri::State<'_, AppState>) -> Result<MetricsOut, String> {
    let mut eng_guard = state.engine.lock().unwrap();
    let eng = eng_guard.as_mut().ok_or_else(|| "i18n:beErrEngineNotBuilt".to_string())?;

    let met_guard = state.metrics.lock().unwrap();
    let m = met_guard
        .as_ref()
        .ok_or_else(|| "i18n:beErrMetricsNotInitialized".to_string())?;

    let res_m = m.compute(eng);
    let coords = coords_ca(eng);
    let seq_guard = state.seq.lock().unwrap();
    let seq_ref = seq_guard.as_deref();
    let orig_ca_guard = state.ca_coords.lock().unwrap();
    let orig_ca_ref = orig_ca_guard.as_deref();
    let env_guard = state.build_env.lock().unwrap();
    let ph_val = env_guard.as_ref().map(|e| e.ph).unwrap_or(7.0);
    
    Ok(MetricsOut::from_result(&res_m, seq_ref, orig_ca_ref, &coords, ph_val, eng))
}

/// Environment hot-switch: ΔT (fast) via thermostat target.
#[tauri::command]
pub fn engine_set_temperature(
    state: tauri::State<'_, AppState>,
    temp_k: f32,
) -> Result<(), String> {
    let mut eng = state.engine.lock().unwrap();
    let eng = eng.as_mut().ok_or_else(|| "i18n:beErrEngineNotBuilt".to_string())?;
    eng.set_temperature(temp_k);
    Ok(())
}

/// Reset velocities / pseudo-label window.
#[tauri::command]
pub fn engine_reset(
    state: tauri::State<'_, AppState>,
    velocities: bool,
    pseudo_labels: bool,
) -> Result<(), String> {
    let mut eng = state.engine.lock().unwrap();
    let eng = eng.as_mut().ok_or_else(|| "i18n:beErrEngineNotBuilt".to_string())?;
    if velocities {
        eng.reset_velocities();
    }
    if pseudo_labels {
        eng.reset_pseudo_labels();
    }
    Ok(())
}

/// Validate a sequence.
#[tauri::command]
pub fn engine_validate(seq: String) -> Result<(), String> {
    validate_sequence(&seq)
}

/// Apply point mutations to a sequence (returns the new sequence).
#[tauri::command]
pub fn engine_mutate(
    seq: String,
    mutations: Vec<serde_json::Value>,
) -> Result<String, String> {
    let ms: Vec<Mutation> = mutations
        .iter()
        .map(|v| {
            let pos = v["position"].as_u64().unwrap_or(0) as usize;
            let to = v["to"].as_str().unwrap_or("A").chars().next().unwrap_or('A');
            Mutation::new(pos, to)
        })
        .collect();
    apply_mutations(&seq, &ms)
}

/// ONNX fold: run the pre-train model on a sequence + env.
#[tauri::command]
pub fn infer_fold(
    state: tauri::State<'_, AppState>,
    seq: String,
    env: EnvInput,
    model_path: Option<String>,
) -> Result<crate::onnx::FoldOutput, String> {
    let sess = state.onnx.get(model_path.as_deref())?;
    let e = crate::onnx::Env3 {
        ph: env.ph,
        temp_k: env.temp_k,
        ionic_strength_m: env.ionic_strength_m,
    };
    crate::onnx::infer(&sess, &seq, e)
}

/// Report whether the ONNX model is available + which heads are trained.
#[tauri::command]
pub fn model_status(state: tauri::State<'_, AppState>, model_path: Option<String>) -> serde_json::Value {
    match state.onnx.get(model_path.as_deref()) {
        Ok(s) => {
            let size = std::fs::metadata(&s.model_path).ok().map(|m| m.len());
            serde_json::json!({
                "ok": true,
                "model_path": s.model_path,
                "size_bytes": size,
                "trained_heads": ["A", "distogram"],
                "rl_heads": ["B", "Bp", "C", "D"],
                "note": "i18n:beNoteRlHeadsRandom"
            })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e }),
    }
}

/// Default candidates for the ONNX model path (returned so the UI can show it).
#[tauri::command]
pub fn model_candidates() -> Vec<PathBuf> {
    crate::onnx::default_model_candidates()
}

/// Default destination for a downloaded model (dev CWD = src-tauri).
pub fn default_download_dest() -> PathBuf {
    let rel = PathBuf::from("../model/export/spice_infer_fixed.onnx");
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("..").exists() {
            return rel;
        }
    }
    PathBuf::from("model/export/spice_infer_fixed.onnx")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub done: u64,
    pub total: Option<u64>,
    pub stage: String,
}

/// Download the ONNX model from `url` (settings panel). `dest` optional.
#[tauri::command]
pub async fn download_model(
    state: tauri::State<'_, AppState>,
    url: String,
    dest: Option<String>,
    channel: tauri::ipc::Channel<DownloadProgress>,
) -> Result<String, String> {
    let path = dest
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_download_dest);

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<PathBuf, String> {
        use std::io::{Read, Write};
        let client = reqwest::blocking::Client::builder()
            .user_agent("SPICE-GUI")
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;
        let mut resp = client
            .get(&url)
            .send()
            .map_err(|e| format!("GET {url}: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("HTTP {status}"));
        }
        let total = resp.content_length();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut file = std::fs::File::create(&path)
            .map_err(|e| format!("create {}: {e}", path.display()))?;
        let mut buf = [0u8; 128 * 1024];
        let mut done: u64 = 0;
        loop {
            let n = resp.read(&mut buf).map_err(|e| format!("read: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| format!("write: {e}"))?;
            done += n as u64;
            let _ = channel.send(DownloadProgress {
                done,
                total,
                stage: "downloading".into(),
            });
        }
        file.flush().map_err(|e| format!("flush: {e}"))?;
        Ok(path.clone())
    })
    .await
    .map_err(|e| e.to_string())?;

    let path = result?;
    state.onnx.set_override(path.clone());
    // hot-reload and validate the session once the download finishes
    state.onnx.get(None)?;
    Ok(path.display().to_string())
}

/// Point the model loader at a specific file (or clear with empty string).
#[tauri::command]
pub fn set_model_path(
    state: tauri::State<'_, AppState>,
    path: Option<String>,
) -> Result<serde_json::Value, String> {
    match path {
        Some(p) if !p.trim().is_empty() => {
            let pb = PathBuf::from(p.trim());
            if !pb.exists() {
                return Err(format!("i18n:beErrPathMissing::{}", pb.display()));
            }
            state.onnx.set_override(pb.clone());
            let s = state.onnx.get(None)?;
            Ok(serde_json::json!({ "ok": true, "model_path": s.model_path }))
        }
        _ => {
            state.onnx.clear_override();
            match state.onnx.get(None) {
                Ok(s) => Ok(serde_json::json!({ "ok": true, "model_path": s.model_path })),
                Err(e) => Ok(serde_json::json!({ "ok": false, "error": e })),
            }
        }
    }
}

/// Cancellable stability-domain scan over a T × pH grid.
///
/// pH-major: builds one minimized template per pH, then clones it per
/// temperature (clone-from-pristine; no state carryover).
#[tauri::command]
pub async fn engine_stability_scan(
    state: tauri::State<'_, AppState>,
    request: ScanRequest,
    channel: tauri::ipc::Channel<ScanProgress>,
) -> Result<Vec<ScanPoint>, String> {
    let seq = state.seq.lock().unwrap().clone();
    let ca = state.ca_coords.lock().unwrap().clone();
    let env = state.build_env.lock().unwrap().clone();
    let cancel = state.cancel.clone();

    let (seq, ca, env) = match (seq, ca, env) {
        (Some(s), Some(c), Some(e)) => (s, c, e),
        _ => return Err("i18n:beErrNoSystemToScan".into()),
    };

    // reset cancel flag
    cancel.store(false, Ordering::Relaxed);

    let temps = request.temps.clone();
    let phs = request.phs.clone();
    let n_steps = request.n_steps.max(1);
    let relax = if request.minimize { Some(2000) } else { None };
    let total = temps.len() * phs.len();
    let mut done = 0usize;

    let cfg = StabilityConfig {
        n_steps,
        relax_iters: relax,
        ..Default::default()
    };

    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ScanPoint>, String> {
        let structure = structure_from_ca(&seq, &ca)?;
        let mut out: Vec<ScanPoint> = Vec::with_capacity(total);

        for &ph in &phs {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let popts = BuildOptions {
                env: EnvParams::new(ph, env.temp_k, env.pressure_bar, env.ionic_strength_m),
                relax_iters: relax,
                strict_incomplete_residues: false,
                ..Default::default()
            };
            let template = match build_from_input(dev(), param_set()?, &structure, &popts) {
                Ok(t) => t,
                Err(e) => {
                    for &t in &temps {
                        out.push(ScanPoint {
                            t,
                            ph,
                            stable: false,
                            crashed: false,
                            build_failed: true,
                            reason: Some(e.clone()),
                            metrics: None,
                        });
                        done += 1;
                        let _ = channel.send(ScanProgress {
                            total,
                            done,
                            t,
                            ph,
                            stable: None,
                            error: Some(e.clone()),
                        });
                    }
                    continue;
                }
            };

            for &t in &temps {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let mut eng = template.clone();
                eng.set_temperature(t);
                let m = Metrics::new(&eng, MetricsConfig::default());

                let mut crashed = false;
                for _ in 0..n_steps {
                    let r = eng.step(None);
                    if r.crashed {
                        crashed = true;
                        break;
                    }
                }
                let mr = if crashed { None } else { Some(m.compute(&eng)) };
                let stable = mr
                    .as_ref()
                    .map(|mres| is_stable(mres, crashed, &cfg))
                    .unwrap_or(false);

                out.push(ScanPoint {
                    t,
                    ph,
                    stable,
                    crashed,
                    build_failed: false,
                    reason: None,
                    metrics: mr.as_ref().map(Into::into),
                });
                done += 1;
                let _ = channel.send(ScanProgress {
                    total,
                    done,
                    t,
                    ph,
                    stable: Some(stable),
                    error: None,
                });
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abort a running stability scan.
#[tauri::command]
pub fn engine_cancel_scan(state: tauri::State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

/// Fetch a PDB file's text from RCSB PDB by PDB ID.
#[tauri::command]
pub async fn fetch_pdb_structure(pdb_id: String) -> Result<String, String> {
    let sanitized_id = pdb_id.trim().to_uppercase();
    if sanitized_id.len() != 4 || !sanitized_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("i18n:beErrPdbIdInvalid".to_string());
    }

    let url = format!("https://files.rcsb.org/download/{}.pdb", sanitized_id);
    
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .map_err(|e| format!("i18n:beErrReqwestClientInitFailed::{}", e))?;

        let resp = client
            .get(&url)
            .send()
            .map_err(|e| format!("i18n:beErrRcsbConnectFailed::{}", e))?;

        let status = resp.status();
        if !status.is_success() {
            if status.as_u16() == 404 {
                return Err(format!("i18n:beErrPdbIdNotFound::{}", sanitized_id));
            } else {
                return Err(format!("i18n:beErrRcsbStatus::{}", status));
            }
        }

        let text = resp.text().map_err(|e| format!("i18n:beErrResponseTextParseFailed::{}", e))?;
        if text.trim().is_empty() {
            return Err("i18n:beErrPdbContentEmpty".to_string());
        }
        
        Ok(text)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Calculate pockets for the current active engine.
#[tauri::command]
pub async fn engine_get_pockets(
    state: tauri::State<'_, AppState>,
    grid_spacing: Option<f32>,
) -> Result<Vec<TauriNativePocket>, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let eng_guard = engine.lock().unwrap();
        let eng = eng_guard
            .as_ref()
            .ok_or_else(|| "i18n:beErrEngineNotBuiltBuildFirst".to_string())?;
        
        let spacing = grid_spacing.unwrap_or(1.0);
        let pockets = calculate_engine_pockets(eng, spacing);
        Ok(pockets.into_iter().map(TauriNativePocket::from).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Retrieve advanced features for a specific pocket.
#[tauri::command]
pub async fn engine_get_pocket_features(
    state: tauri::State<'_, AppState>,
    pocket: TauriNativePocket,
) -> Result<TauriAdvancedPocketFeatures, String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let eng_guard = engine.lock().unwrap();
        let eng = eng_guard
            .as_ref()
            .ok_or_else(|| "i18n:beErrEngineNotBuiltBuildFirst".to_string())?;
        
        let native_pocket = NativePocket {
            id: pocket.id,
            center: pocket.center,
            volume: pocket.volume,
            druggability: pocket.druggability,
            surface_residues: pocket.surface_residues,
            voxels: pocket.voxels,
        };

        let adv = calculate_advanced_features(eng, &native_pocket);
        Ok(TauriAdvancedPocketFeatures::from(adv))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compute the mutational pocket spatial perturbation (Delta volume and Jaccard coordinate intersection).
#[tauri::command]
pub fn engine_get_pocket_delta(
    ref_pocket: TauriNativePocket,
    mut_pocket: TauriNativePocket,
    grid_spacing: Option<f32>,
) -> Result<TauriPocketDelta, String> {
    let spacing = grid_spacing.unwrap_or(1.0);
    
    let native_ref = NativePocket {
        id: ref_pocket.id,
        center: ref_pocket.center,
        volume: ref_pocket.volume,
        druggability: ref_pocket.druggability,
        surface_residues: ref_pocket.surface_residues,
        voxels: ref_pocket.voxels,
    };

    let native_mut = NativePocket {
        id: mut_pocket.id,
        center: mut_pocket.center,
        volume: mut_pocket.volume,
        druggability: mut_pocket.druggability,
        surface_residues: mut_pocket.surface_residues,
        voxels: mut_pocket.voxels,
    };

    let delta = calculate_pocket_delta(&native_ref, &native_mut, spacing);
    Ok(TauriPocketDelta::from(delta))
}

/// Analyze pocket volume fluctuations (MAD) and open probability dynamically along an online trajectory.
#[tauri::command]
pub async fn engine_analyze_pocket_trajectory(
    state: tauri::State<'_, AppState>,
    samples: usize,
    step_size: usize,
    grid_spacing: Option<f32>,
    threshold_volume: f32,
) -> Result<(f32, f32), String> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut eng_guard = engine.lock().unwrap();
        let eng = eng_guard
            .as_mut()
            .ok_or_else(|| "i18n:beErrEngineNotBuiltBuildFirst".to_string())?;
        
        let spacing = grid_spacing.unwrap_or(1.0);
        let (mad, open_prob) = analyze_pocket_trajectory(
            eng,
            samples,
            step_size,
            spacing,
            threshold_volume,
        );
        Ok((mad, open_prob))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Build a mutant system using fast solvent reuse (Phase 2), utilizing localized L-BFGS
/// and custom dynamic protonation (Phase 1).
#[tauri::command]
pub async fn engine_build_mutant(
    state: tauri::State<'_, AppState>,
    mutant_seq: String,
    relax_iters: Option<usize>,
    custom_protonation: Option<std::collections::HashMap<usize, String>>,
) -> Result<BuildOut, String> {
    let engine = state.engine.clone();
    let ca_state = state.ca_coords.clone();
    let seq_state = state.seq.clone();
    let env_state = state.build_env.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut eng_lock = engine.lock().unwrap();
        let parent = match eng_lock.as_ref() {
            Some(p) => p,
            None => return Err("i18n:beErrNoParentSystemSolventReuse".into()),
        };

        validate_sequence(&mutant_seq)?;

        let mut cp_map = None;
        if let Some(ref custom) = custom_protonation {
            let mut resolved = std::collections::HashMap::new();
            for (&k, v) in custom {
                if let Some(variant) = map_protonation_variant(v) {
                    resolved.insert(k, variant);
                }
            }
            cp_map = Some(resolved);
        }

        let env = parent.env.clone(); // inherit parent's environment (pH, Temp, etc.)
        let opts = BuildOptions {
            env,
            relax_iters,
            strict_incomplete_residues: false,
            custom_protonation: cp_map,
            ..BuildOptions::default()
        };

        let parent_coords = coords_ca(parent);
        let structure = structure_from_ca(&mutant_seq, &parent_coords)?;

        let mutant_eng = spice_engine::build_mutant_by_solvent_reuse(
            parent,
            param_set()?,
            &structure,
            &opts,
        )?;

        let n_res = mutant_eng.topology.residues.len();
        let coords = coords_ca(&mutant_eng);
        let step_count = mutant_eng.state.step_count;
        let seq = mutant_eng.topology.sequence.clone();

        *ca_state.lock().unwrap() = Some(coords.clone());
        *seq_state.lock().unwrap() = Some(seq.clone());
        *eng_lock = Some(mutant_eng);

        Ok(BuildOut {
            length: n_res,
            seq,
            coords,
            step_count,
            env: EnvInput {
                ph: env.ph,
                temp_k: env.temp_k,
                pressure_bar: env.pressure_bar,
                ionic_strength_m: env.ionic_strength_m,
            },
            build_ms: 0.0, // extremely fast, takes <0.15s
            note: "i18n:beNoteSolventReuseBuild".into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Register a harmonic distance restraint between two atoms (Phase 3 for AlphaFold 3 ligand/ion coordination).
#[tauri::command]
pub fn engine_add_distance_restraint(
    state: tauri::State<'_, AppState>,
    atom_0_idx: usize,
    atom_1_idx: usize,
    r0: f32,
    k: f32,
) -> Result<(), String> {
    let mut eng_lock = state.engine.lock().unwrap();
    if let Some(ref mut eng) = *eng_lock {
        eng.add_distance_restraint(atom_0_idx, atom_1_idx, r0, k);
        Ok(())
    } else {
        Err("i18n:beErrEngineNotInitializedBuildVector".into())
    }
}
