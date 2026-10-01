//! SPD (SPICE Protein Database) HTTP bridge for the Tauri desktop app.
//!
//! The production API (d-api.spicebio.top) only lists browser origins in its
//! CORS policy (d.spicebio.top + dev localhost), so a webview `fetch` from the
//! packaged app would be blocked. Routing through Rust/reqwest skips CORS
//! entirely — this command is the desktop transport for `src/lib/spd/client.ts`.
//! Browser mode keeps using `fetch` directly (dev origin is allow-listed).

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;

/// Perform one SPD HTTP call. Returns `{ status, body }` (body is raw text;
/// the client parses the JSON envelope). Network failures surface as Err.
#[tauri::command]
pub async fn spd_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs are allowed".into());
    }
    let method: reqwest::Method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let res = tauri::async_runtime::spawn_blocking(move || -> Result<(u16, String), String> {
        let client = reqwest::blocking::Client::builder()
            .user_agent("SPICE-GUI")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;
        let mut req = client.request(method, &url);
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(b) = body {
            req = req.body(b);
        }
        let mut resp = req.send().map_err(|e| format!("request failed: {e}"))?;
        let status = resp.status().as_u16();
        // Cap the body at 16 MiB — SPD JSON is small; refuse anything bigger.
        let mut buf = Vec::new();
        let mut chunk = [0u8; 65536];
        loop {
            let n = resp.read(&mut chunk).map_err(|e| format!("read body: {e}"))?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.len() > 16 * 1024 * 1024 {
                return Err("response exceeds 16 MiB".into());
            }
        }
        Ok((status, String::from_utf8_lossy(&buf).into_owned()))
    })
    .await
    .map_err(|e| format!("join: {e}"))??;
    Ok(serde_json::json!({ "status": res.0, "body": res.1 }))
}

/// Stream-SHA-256 the active ONNX checkpoint. SPD's model/fold schema demands
/// a `sha256:<64 hex>` checkpoint identity; hashing in Rust avoids shipping a
/// 100 MB+ model through the IPC boundary to the webview.
#[tauri::command]
pub fn model_sha256(
    state: tauri::State<'_, crate::spice::AppState>,
    model_path: Option<String>,
) -> serde_json::Value {
    let session = match state.onnx.get(model_path.as_deref()) {
        Ok(s) => s,
        Err(e) => return serde_json::json!({ "ok": false, "error": e }),
    };
    let path = session.model_path.clone();
    let result = std::fs::File::open(&path).and_then(|mut file| {
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 1 << 20];
        loop {
            let n = file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hasher.finalize())
    });
    match result {
        Ok(digest) => {
            let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
            serde_json::json!({
                "ok": true,
                "sha256": format!("sha256:{hex}"),
                "path": path,
            })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    }
}
