// Minimal Model Context Protocol (stdio) client.
//
// Each command starts the configured server, performs the JSON-RPC initialize
// handshake, sends one request, and terminates the child. MCP servers are
// user-provided commands, so sessions are short-lived and every call is
// approval-gated on the frontend.

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
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
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

#[tauri::command]
pub async fn mcp_list_tools(server: McpServerConfig) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
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
