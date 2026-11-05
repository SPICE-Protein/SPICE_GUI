// Native transport for OpenAI-compatible chat providers.
//
// WKWebView enforces CORS on requests from the Tauri origin, and local model
// servers such as Ollama do not allow `tauri://localhost` by default. The
// frontend falls back to this command when a direct request fails at the
// network layer.

use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiNativeRequest {
    pub endpoint: String,
    pub api_key: Option<String>,
    pub body: Value,
}

fn truncate(text: &str, max: usize) -> String {
    let mut out = text.chars().take(max).collect::<String>();
    if text.chars().count() > max {
        out.push('…');
    }
    out
}

#[tauri::command]
pub async fn ai_chat_native(request: AiNativeRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let client = reqwest::blocking::Client::builder()
            .user_agent("SPICE-GUI")
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;

        let payload =
            serde_json::to_string(&request.body).map_err(|e| format!("encode request: {e}"))?;
        let mut builder = client
            .post(&request.endpoint)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(payload);
        if let Some(key) = request.api_key.filter(|key| !key.trim().is_empty()) {
            builder = builder.bearer_auth(key.trim());
        }

        let response = builder
            .send()
            .map_err(|e| format!("POST {}: {e}", request.endpoint))?;
        let status = response.status();
        let text = response.text().map_err(|e| format!("read body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "HTTP {}: {}",
                status.as_u16(),
                truncate(&text, 240)
            ));
        }
        serde_json::from_str(&text).map_err(|e| format!("decode response: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ai_get_native(url: String, api_key: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let client = reqwest::blocking::Client::builder()
            .user_agent("SPICE-GUI")
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;

        let mut builder = client.get(&url);
        if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
            builder = builder.bearer_auth(key.trim());
        }

        let response = builder.send().map_err(|e| format!("GET {url}: {e}"))?;
        let status = response.status();
        let text = response.text().map_err(|e| format!("read body: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "HTTP {}: {}",
                status.as_u16(),
                truncate(&text, 240)
            ));
        }
        serde_json::from_str(&text).map_err(|e| format!("decode response: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
