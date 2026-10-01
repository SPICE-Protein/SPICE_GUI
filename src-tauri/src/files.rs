//! Native file export: open a save dialog and write the payload (mmCIF / PNG).
//! The frontend generates the content; this command handles dialog + disk I/O.

use serde::Serialize;
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveOut {
    pub saved: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn save_export(
    app: tauri::AppHandle,
    default_name: String,
    data_b64: String,
) -> Result<SaveOut, String> {
    let ext = std::path::Path::new(&default_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let mut dialog = app.dialog().file();
    if !ext.is_empty() {
        dialog = dialog.add_filter("Selected Format", &[ext]);
    }

    let picked = dialog
        .add_filter("SPICE Formats", &["spiceg", "spicep", "spiceproj", "mmcif", "cif", "png", "txt"])
        .set_file_name(&default_name)
        .blocking_save_file();

    let Some(fp) = picked else {
        // user cancelled the dialog
        return Ok(SaveOut {
            saved: false,
            path: None,
        });
    };
    let path = match fp {
        FilePath::Path(p) => p,
        FilePath::Url(u) => return Err(format!("unsupported path: {u}")),
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("base64: {e}"))?;

    std::fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(SaveOut {
        saved: true,
        path: Some(path.display().to_string()),
    })
}

#[tauri::command]
pub async fn save_file_direct(
    path: String,
    data_b64: String,
) -> Result<bool, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("base64: {e}"))?;

    std::fs::write(&path, bytes).map_err(|e| format!("write {path}: {e}"))?;
    Ok(true)
}
