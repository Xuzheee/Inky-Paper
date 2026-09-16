use crate::paper::{execute, PaperDb};
use serde::Serialize;
use serde_json::{json, Value};
use std::{io::Read, path::Path, thread};
use tauri::{Emitter, Manager};
use tiny_http::{Header, Method, Response, Server, StatusCode};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub available: bool,
    pub connection_file: String,
}
#[tauri::command]
pub fn get_paper_bridge_status(status: tauri::State<BridgeStatus>) -> BridgeStatus {
    status.inner().clone()
}
pub fn start(app: tauri::AppHandle, dir: &Path) -> Result<BridgeStatus, String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let address = server.server_addr().to_string();
    let token = uuid::Uuid::new_v4().to_string();
    let user_token = uuid::Uuid::new_v4().to_string();
    let file = dir.join("paper-agent-bridge.json");
    std::fs::write(&file,json!({"url":format!("http://{address}"),"token":token,"protocolVersion":1,"app":"inky-paper"}).to_string()).map_err(|e|e.to_string())?;
    // The MCP process receives only the model connection file. The dashboard's
    // server-side click proxy uses a distinct, adoption-only capability.
    std::fs::write(dir.join("paper-user-bridge.json"),json!({"url":format!("http://{address}"),"token":user_token,"protocolVersion":1,"app":"inky-paper","capability":"user-adoption"}).to_string()).map_err(|e|e.to_string())?;
    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let header = |name: &'static str| {
                request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv(name))
                    .map(|h| h.value.as_str())
            };
            let user_click = header("Authorization") == Some(format!("Bearer {user_token}").as_str());
            let model = header("Authorization") == Some(format!("Bearer {token}").as_str());
            if request.method() != &Method::Post
                || !(user_click || model)
                || header("Host") != Some(address.as_str())
                || header("Origin").is_some()
            {
                let _ = request.respond(Response::empty(StatusCode(403)));
                continue;
            }
            let action = request.url().trim_start_matches('/').to_string();
            let allowed = if user_click { crate::paper_permissions::user_proxy_action(&action) } else { crate::paper_permissions::model_action(&action) };
            if !allowed {
                let _ = request.respond(Response::from_string(json!({"error":"FORBIDDEN: 此连接无权执行该操作。"}).to_string()).with_status_code(403).with_header(Header::from_bytes("Content-Type","application/json").unwrap()));
                continue;
            }
            let mut body = String::new();
            let outcome = if request
                .as_reader()
                .take(524289)
                .read_to_string(&mut body)
                .is_err()
                || body.len() > 524288
            {
                Err("INVALID_INPUT: request too large".into())
            } else {
                serde_json::from_str::<Value>(&body)
                    .map_err(|e| e.to_string())
                    .and_then(|input| {
                        let db = app.state::<PaperDb>();
                        let mut c = db.0.lock().map_err(|e| e.to_string())?;
                        let (v, changed) = execute(&mut c, &action, input, if user_click { "user" } else { "hermes" })?;
                        if changed {
                            let _ = app.emit("paper:changed", ());
                        }
                        Ok(v)
                    })
            };
            let (status, data) = match outcome {
                Ok(v) => (200, json!({"data":v})),
                Err(e) => (400, json!({"error":e})),
            };
            let response = Response::from_string(data.to_string())
                .with_status_code(status)
                .with_header(Header::from_bytes("Content-Type", "application/json").unwrap());
            let _ = request.respond(response);
        }
    });
    Ok(BridgeStatus {
        available: true,
        connection_file: file.to_string_lossy().into(),
    })
}
