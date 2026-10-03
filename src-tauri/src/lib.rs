// SPICE GUI — Tauri backend.
// Wraps the Rust `spice_engine` MD core + the ONNX pre-train model (`ort`).

mod onnx;
mod files;
mod spice;
mod cloning;
mod spd;

use spice::AppState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            // file export (mmCIF / PNG)
            files::save_export,
            files::save_file_direct,
            // SPD (d-api.spicebio.top) HTTP bridge + checkpoint hashing
            spd::spd_request,
            spd::spd_put_bytes,
            spd::model_sha256,
            // ONNX fold (pre-train model)
            spice::infer_fold,
            spice::model_status,
            spice::model_candidates,
            spice::download_model,
            spice::set_model_path,
            // SPICE engine
            spice::engine_build,
            spice::engine_build_mutant,
            spice::engine_add_distance_restraint,
            spice::engine_step,
            spice::engine_metrics,
            spice::engine_set_temperature,
            spice::engine_reset,
            spice::engine_validate,
            spice::engine_mutate,
            spice::engine_stability_scan,
            spice::engine_cancel_scan,
            spice::engine_get_pockets,
            spice::engine_get_pocket_features,
            spice::engine_get_pocket_delta,
            spice::engine_analyze_pocket_trajectory,
            // PDB fetch from RCSB
            spice::fetch_pdb_structure,
            // State-of-the-Art Molecular Cloning and Biophysical Calculations (SnapGene Parity)
            cloning::calculate_primer_tm,
            cloning::simulate_cloning_ligation,
            cloning::sync_rebase_db,
            cloning::sync_unevec_db,
            cloning::sync_card_amr_db,
            cloning::sync_biosecurity_db,
            cloning::fetch_kazusa_codon_table,
           cloning::import_from_ensembl,
           cloning::import_from_ncbi,
           cloning::run_native_msa,
           cloning::export_collection_zip,
           cloning::import_collection_zip,
           cloning::run_local_blast,
           cloning::calculate_dot_plot_rust,
           cloning::run_local_alignment,
           cloning::annotate_features_sw,
           cloning::analyze_fastq_quality_rust,
           cloning::find_orfs_rust,
           cloning::find_rna_structures_rust,
           cloning::pareto_codesign_evaluate,
           cloning::solve_phase_bifurcation,
           cloning::simulate_goldengate_assembly,
       ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
