//! Generic HTTP text bridge for external sequence databases (NCBI BLAST,
//! EBI Job Dispatcher, UniProt REST). The public services do not all send
//! CORS headers, so the packaged webview cannot call them with `fetch`.
//! Routing through reqwest avoids CORS; the browser build keeps using fetch
//! (e2e points the base URLs at a local mock).

use std::collections::HashMap;
use std::io::Read;

/// Perform one HTTP request and return `{ status, body }` as UTF-8 text.
/// BLAST result pages are larger than SPD payloads, so this allows 32 MiB and
/// a 90 s timeout (a Put still answers immediately; polling is short).
#[tauri::command]
pub async fn http_request(
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
            .timeout(std::time::Duration::from_secs(90))
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
        let mut buf = Vec::new();
        let mut chunk = [0u8; 65536];
        loop {
            let n = resp.read(&mut chunk).map_err(|e| format!("read body: {e}"))?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.len() > 32 * 1024 * 1024 {
                return Err("response exceeds 32 MiB".into());
            }
        }
        Ok((status, String::from_utf8_lossy(&buf).into_owned()))
    })
    .await
    .map_err(|e| format!("join: {e}"))??;
    Ok(serde_json::json!({ "status": res.0, "body": res.1 }))
}
