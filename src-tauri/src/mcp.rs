// Minimal Model Context Protocol client for two transports:
//
//  · stdio  — start the configured command, perform the JSON-RPC handshake,
//             send one request, and terminate the child.
//  · http   — Streamable HTTP (MCP 2025-03-26), used by the built-in SPD
//             catalog server. The bearer token is supplied per call from the
//             SPD settings, never persisted with the server definition.
//
// Sessions are short-lived and every call is approval-gated on the frontend.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub transport: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub url: String,
    /// Resolved on the frontend per call (SPD API token); never stored.
    #[serde(default)]
    pub token: String,
}

impl McpServerConfig {
    fn is_http(&self) -> bool {
        self.transport.eq_ignore_ascii_case("http")
    }
}

struct Session {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    responses: Receiver<Value>,
    next_id: u64,
}

impl Session {
    fn start(server: &McpServerConfig) -> Result<Self, String> {
        if server.command.trim().is_empty() {
            return Err("MCP server command is empty".into());
        }

        // Windows launchers such as `npx` are `.cmd` shims, which
        // CreateProcess does not resolve directly. Run those through cmd /C.
        #[cfg(windows)]
        let mut command = {
            let mut cmd = Command::new("cmd");
            cmd.arg("/C").arg(&server.command).args(&server.args);
            cmd
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut cmd = Command::new(&server.command);
            cmd.args(&server.args);
            cmd
        };

        let mut child = command
            .envs(server.env.clone())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", server.command))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "MCP server stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MCP server stdout unavailable".to_string())?;

        let (sender, responses) = mpsc::channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                    if sender.send(value).is_err() {
                        break;
                    }
                }
            }
        });

        let mut session = Session {
            child,
            stdin: BufWriter::new(stdin),
            responses,
            next_id: 1,
        };
        session.initialize()?;
        Ok(session)
    }

    fn send(&mut self, message: Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.stdin, &message)
            .map_err(|e| format!("encode MCP request: {e}"))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("write MCP request: {e}"))
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send(json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
    }

    fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;

        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!("MCP request '{method}' timed out"));
            }
            let message = self
                .responses
                .recv_timeout(remaining)
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => format!("MCP request '{method}' timed out"),
                    mpsc::RecvTimeoutError::Disconnected => {
                        "MCP server exited before replying".to_string()
                    }
                })?;

            // Ignore notifications and responses to other requests.
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                let detail = error
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| error.to_string());
                return Err(format!("MCP error: {detail}"));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    fn initialize(&mut self) -> Result<(), String> {
        self.request(
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "SPICE GUI", "version": env!("CARGO_PKG_VERSION") }
            }),
            Duration::from_secs(20),
        )?;
        self.notify("notifications/initialized", json!({}))?;
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// ---------------------------------------------------------------------------
// Streamable HTTP transport
// ---------------------------------------------------------------------------

const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

struct HttpSession {
    client: reqwest::blocking::Client,
    url: String,
    token: String,
    session_id: Option<String>,
    next_id: u64,
}

impl HttpSession {
    fn start(server: &McpServerConfig) -> Result<Self, String> {
        let url = server.url.trim();
        if url.is_empty() {
            return Err("MCP server URL is empty".into());
        }
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("MCP HTTP client: {e}"))?;
        let mut session = Self {
            client,
            url: url.to_string(),
            token: server.token.trim().to_string(),
            session_id: None,
            next_id: 1,
        };
        session.initialize()?;
        Ok(session)
    }

    fn send(&mut self, body: &Value) -> Result<Option<Value>, String> {
        let mut request = self
            .client
            .post(&self.url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "application/json, text/event-stream")
            .header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
            .body(serde_json::to_string(body).map_err(|e| format!("encode MCP request: {e}"))?);
        if !self.token.is_empty() {
            request = request.bearer_auth(&self.token);
        }
        if let Some(session_id) = &self.session_id {
            request = request.header("Mcp-Session-Id", session_id);
        }

        let response = request
            .send()
            .map_err(|e| format!("MCP HTTP request failed: {e}"))?;
        if let Some(value) = response.headers().get("mcp-session-id") {
            if let Ok(text) = value.to_str() {
                if !text.trim().is_empty() {
                    self.session_id = Some(text.trim().to_string());
                }
            }
        }

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!("MCP HTTP {status}: {}", body_snippet(&body)));
        }

        let is_sse = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_ascii_lowercase().contains("text/event-stream"))
            .unwrap_or(false);

        if is_sse {
            read_sse_response(response)
        } else {
            let body = response.text().unwrap_or_default();
            if body.trim().is_empty() {
                return Ok(None);
            }
            serde_json::from_str::<Value>(&body)
                .map(Some)
                .map_err(|e| format!("MCP HTTP response is not JSON: {e}"))
        }
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let response = self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;
        let message = response.ok_or_else(|| format!("MCP HTTP returned no reply to '{method}'"))?;
        if let Some(error) = message.get("error") {
            let detail = error
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| error.to_string());
            return Err(format!("MCP error: {detail}"));
        }
        Ok(message.get("result").cloned().unwrap_or(Value::Null))
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        // The reply to a notification is usually 202 with no body; some servers
        // hold an event stream open, so the response is deliberately dropped
        // without being read.
        let body = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let mut request = self
            .client
            .post(&self.url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .header(reqwest::header::ACCEPT, "application/json, text/event-stream")
            .header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
            .body(serde_json::to_string(&body).map_err(|e| format!("encode MCP notification: {e}"))?);
        if !self.token.is_empty() {
            request = request.bearer_auth(&self.token);
        }
        if let Some(session_id) = &self.session_id {
            request = request.header("Mcp-Session-Id", session_id);
        }
        let response = request
            .send()
            .map_err(|e| format!("MCP HTTP notification failed: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("MCP HTTP notification returned {status}"));
        }
        Ok(())
    }

    fn initialize(&mut self) -> Result<(), String> {
        self.request(
            "initialize",
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "SPICE GUI", "version": env!("CARGO_PKG_VERSION") }
            }),
        )?;
        self.notify("notifications/initialized", json!({}))?;
        Ok(())
    }
}

/// Read an SSE stream until the first complete JSON-RPC message arrives. The
/// server may hold the stream open for notifications, so the reader returns as
/// soon as a message with a usable payload is parsed and drops the connection.
fn read_sse_response(response: reqwest::blocking::Response) -> Result<Option<Value>, String> {
    parse_sse_json(BufReader::new(response))
}

fn parse_sse_json(reader: impl BufRead) -> Result<Option<Value>, String> {
    let mut data = String::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("MCP SSE read: {e}"))?;
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.strip_prefix(' ').unwrap_or(rest));
            continue;
        }
        if line.trim().is_empty() && !data.is_empty() {
            let parsed = serde_json::from_str::<Value>(&data).ok();
            data.clear();
            if let Some(value) = parsed {
                // Responses carry an id; notifications sent while the request is
                // open (progress, logging) do not and are skipped.
                if value.get("id").is_some() {
                    return Ok(Some(value));
                }
            }
        }
    }
    if !data.is_empty() {
        return serde_json::from_str::<Value>(&data)
            .map(Some)
            .map_err(|e| format!("MCP SSE payload is not JSON: {e}"));
    }
    Ok(None)
}

fn body_snippet(body: &str) -> String {
    let text = body.trim();
    if text.is_empty() {
        return "(empty body)".into();
    }
    text.chars().take(300).collect()
}

fn http_list_tools(server: &McpServerConfig) -> Result<Value, String> {
    let mut session = HttpSession::start(server)?;
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..50 {
        let params = match &cursor {
            Some(value) => json!({ "cursor": value }),
            None => json!({}),
        };
        let result = session.request("tools/list", params)?;
        if let Some(items) = result.get("tools").and_then(Value::as_array) {
            tools.extend(items.iter().cloned());
        }
        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if cursor.is_none() {
            break;
        }
    }
    Ok(json!({ "tools": tools }))
}

fn http_call_tool(
    server: &McpServerConfig,
    tool: &str,
    arguments: Value,
) -> Result<Value, String> {
    let mut session = HttpSession::start(server)?;
    session.request(
        "tools/call",
        json!({ "name": tool, "arguments": arguments }),
    )
}

#[tauri::command]
pub async fn mcp_list_tools(server: McpServerConfig) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        if server.is_http() {
            return http_list_tools(&server);
        }
        let mut session = Session::start(&server)?;
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;

        // MCP tool listings may be paginated. Follow nextCursor so large
        // servers are fully represented in the agent registry.
        for _ in 0..50 {
            let params = match &cursor {
                Some(value) => json!({ "cursor": value }),
                None => json!({}),
            };
            let result = session.request("tools/list", params, Duration::from_secs(20))?;
            if let Some(items) = result.get("tools").and_then(Value::as_array) {
                tools.extend(items.iter().cloned());
            }
            cursor = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }

        Ok(json!({ "tools": tools }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mcp_call_tool(
    server: McpServerConfig,
    tool: String,
    arguments: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        if server.is_http() {
            return http_call_tool(&server, &tool, arguments);
        }
        let mut session = Session::start(&server)?;
        session.request(
            "tools/call",
            json!({ "name": tool, "arguments": arguments }),
            Duration::from_secs(60),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn parses_first_json_message_from_sse() {
        let stream = "event: message\n\
                      data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\n\n\
                      event: message\n\
                      data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n\n";
        let value = parse_sse_json(Cursor::new(stream)).unwrap().unwrap();
        assert_eq!(value["id"], 1);
        assert!(value["result"]["tools"].is_array());
    }

    #[test]
    fn joins_multiline_sse_data() {
        let stream = "data: {\"jsonrpc\":\"2.0\",\ndata: \"id\":2,\"result\":{}}\n\n";
        let value = parse_sse_json(Cursor::new(stream)).unwrap().unwrap();
        assert_eq!(value["id"], 2);
    }

    #[test]
    fn empty_sse_stream_returns_none() {
        assert!(parse_sse_json(Cursor::new(": keepalive\n\n")).unwrap().is_none());
    }

    #[test]
    fn http_config_requires_a_url() {
        let server = McpServerConfig {
            id: "spd".into(),
            name: "SPD".into(),
            transport: "http".into(),
            command: String::new(),
            args: vec![],
            env: HashMap::new(),
            url: String::new(),
            token: String::new(),
        };
        assert!(HttpSession::start(&server).is_err());
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;

    /// Manual check against the public SPD catalog. The endpoint answers
    /// anonymously at a lower tier; set SPD_MCP_TOKEN to exercise the paid tier.
    #[test]
    #[ignore = "hits the public SPD MCP endpoint"]
    fn spd_catalog_lists_tools() {
        let server = McpServerConfig {
            id: "spd_catalog".into(),
            name: "SPD Protein Database".into(),
            transport: "http".into(),
            command: String::new(),
            args: vec![],
            env: HashMap::new(),
            url: std::env::var("SPD_MCP_URL")
                .unwrap_or_else(|_| "https://d-mcp.spicebio.top/mcp".to_string()),
            token: std::env::var("SPD_MCP_TOKEN").unwrap_or_default(),
        };
        let started = std::time::Instant::now();
        let result = http_list_tools(&server).expect("tools/list");
        eprintln!("live SPD tools/list took {:?}", started.elapsed());
        let tools = result["tools"].as_array().expect("tools array");
        assert!(!tools.is_empty());
        assert!(tools.iter().any(|tool| tool["name"]
            .as_str()
            .map(|name| name.starts_with("spd_"))
            .unwrap_or(false)));
    }
}
