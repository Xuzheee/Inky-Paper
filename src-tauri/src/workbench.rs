//! Separate planning window and an on-demand ACP client. No background prompts.
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

type Reply = Result<Value, String>;
struct Turn {
    request: String,
    session: String,
    text: String,
    last_saved: i64,
}
struct Acp {
    child: Mutex<Child>,
    #[cfg(windows)]
    job: Mutex<Option<ProcessJob>>,
    input: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Reply>>>,
    next: AtomicU64,
    live: AtomicBool,
    active: Mutex<Option<Turn>>,
    loaded: Mutex<HashSet<String>>,
    permissions: Mutex<HashMap<String, Value>>,
}
pub struct Runtime {
    process: Mutex<Option<Arc<Acp>>>,
    busy: AtomicBool,
    cancelled: AtomicBool,
    dir: PathBuf,
    bridge: PathBuf,
    helper: PathBuf,
    host: PathBuf,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn history_db(rt: &Runtime) -> Result<Connection, String> {
    let c = Connection::open(rt.dir.join("conversations.sqlite3")).map_err(err)?;
    init_history(&c)?;
    Ok(c)
}
fn init_history(c: &Connection) -> Result<(), String> {
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session TEXT NOT NULL,role TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL);").map_err(err)?;
    // Additive migration: old conversations remain readable, without guessing their date.
    c.execute_batch("CREATE TABLE IF NOT EXISTS message_context(message_id TEXT PRIMARY KEY,context TEXT NOT NULL);").map_err(err)?;
    Ok(())
}
fn history_messages(c: &Connection, session: &str) -> Result<Vec<Value>, String> {
    let mut q = c.prepare("SELECT m.id,m.role,m.body,m.created,m.status,x.context FROM messages m LEFT JOIN message_context x ON x.message_id=m.id WHERE m.session=?1 ORDER BY m.created,m.rowid").map_err(err)?;
    let rows = q.query_map([session], |r| {
        let context = r.get::<_, Option<String>>(5)?.and_then(|text| serde_json::from_str::<Value>(&text).ok());
        Ok(json!({"id":r.get::<_,String>(0)?,"role":r.get::<_,String>(1)?,"text":r.get::<_,String>(2)?,"created":r.get::<_,i64>(3)?,"status":r.get::<_,String>(4)?,"context":context}))
    }).map_err(err)?.collect::<Result<Vec<_>, _>>().map_err(err)?;
    Ok(rows)
}
pub fn setup(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let folder = dir.join("workbench");
    std::fs::create_dir_all(&folder).map_err(err)?;
    let helper = folder.join("paper-mcp.mjs");
    // Compile into the executable so portable no-bundle releases need no source checkout.
    std::fs::write(&helper, include_bytes!("../resources/paper-mcp.mjs")).map_err(err)?;
    let host = folder.join("acp_host.py");
    std::fs::write(
        &host,
        include_bytes!("../../integrations/inky-workbench/acp_host.py"),
    )
    .map_err(err)?;
    let rt = Runtime {
        process: Mutex::new(None),
        busy: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        dir: folder,
        bridge: dir.join("paper-agent-bridge.json"),
        helper,
        host,
    };
    let c = history_db(&rt)?;
    c.execute(
        "UPDATE messages SET status='interrupted' WHERE status='sending'",
        [],
    )
    .map_err(err)?;
    app.manage(rt);
    Ok(())
}
#[tauri::command]
pub async fn open_workbench(app: AppHandle) -> Result<(), String> {
    // WebView2 creation must not block a synchronous IPC or window event handler.
    open_window(app)
}

fn prepare_step(c: &mut Connection, mut input: Value, item_id: Option<String>) -> Reply {
    let (current, _) = crate::paper::execute(c, "get_state", json!({}), "user")?;
    if current["state"]["sessions"]
        .as_array()
        .is_some_and(|sessions| {
            sessions
                .iter()
                .any(|session| session["status"] != "finished")
        })
    {
        return Err("本轮番茄钟还未结束，请先回到 Inky 保存本轮，再选择下一步。".into());
    }
    let item = if let Some(id) = item_id {
        current["state"]["planning"]["dayItems"]
            .as_array()
            .and_then(|items| {
                items.iter().find(|item| {
                    item["id"] == id
                        && item["taskId"] == input["taskId"]
                        && item["stepId"] == input["stepId"]
                        && item["removedAt"].is_null()
                })
            })
            .cloned()
            .ok_or("这条安排已变化，请刷新工作台后重试。")?
    } else {
        Value::Null
    };
    input["dayItemId"] = item["id"].clone();
    let (result, _) = crate::paper::execute(c, "prepare_step", input, "user")?;
    Ok(
        json!({"taskId":result["task"]["id"],"stepId":result["step"]["id"],"plannedSeconds":result["step"]["plannedSeconds"],"item":item}),
    )
}

#[tauri::command]
pub async fn workbench_prepare_step(
    app: AppHandle,
    input: Value,
    item_id: Option<String>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Inky 主窗口暂不可用，请重新打开应用。")?;
    let selection = {
        let db = app.state::<crate::paper::PaperDb>();
        let mut c = db.0.lock().map_err(err)?;
        prepare_step(&mut c, input, item_id)?
    };
    let _ = app.emit("paper:changed", ());
    window.emit("workbench:select", selection).map_err(err)?;
    window.unminimize().map_err(err)?;
    window.show().map_err(err)?;
    window.set_focus().map_err(err)?;
    Ok(())
}

pub fn open_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("workbench") {
        w.show().map_err(err)?;
        w.set_focus().map_err(err)?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        &app,
        "workbench",
        WebviewUrl::App("index.html?workbench=1".into()),
    )
    .title("Inky · 工作台")
    .inner_size(1440., 900.)
    .min_inner_size(1060., 640.)
    .resizable(true)
    .decorations(true)
    .transparent(false)
    .center()
    .build()
    .map_err(err)?;
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
    Ok(())
}
#[tauri::command]
pub fn workbench_history(app: AppHandle, session_id: Option<String>) -> Result<Value, String> {
    let rt = app.state::<Runtime>();
    let c = history_db(&rt)?;
    let mut q = c
        .prepare("SELECT id,title,updated FROM conversations ORDER BY updated DESC")
        .map_err(err)?;
    let sessions=q.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,"updated":r.get::<_,i64>(2)?}))).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
    let mut messages = history_messages(&c, session_id.as_deref().unwrap_or_default())?;
    let process = rt.process.lock().map_err(err)?.as_ref().cloned();
    let mut active = Value::Null;
    if let Some(p) = process {
        if let Some(turn) = p.active.lock().map_err(err)?.as_ref() {
            active = json!({"requestId":turn.request,"sessionId":turn.session});
            if session_id.as_deref() == Some(&turn.session) {
                if let Some(m) = messages
                    .iter_mut()
                    .find(|m| m["id"] == format!("{}-answer", turn.request))
                {
                    m["text"] = json!(turn.text);
                }
            }
        }
    }
    Ok(json!({"sessions":sessions,"messages":messages,"active":active}))
}

impl Acp {
    fn write(&self, v: Value) -> Result<(), String> {
        let mut input = self.input.lock().map_err(err)?;
        writeln!(input, "{v}").map_err(|_| "Hermes 连接已断开，请重新发送。".to_string())?;
        input.flush().map_err(err)
    }
    fn rpc(&self, method: &str, params: Value, timeout: u64) -> Reply {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(err)?.insert(id, tx);
        if let Err(e) = self.write(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
        {
            self.pending.lock().map_err(err)?.remove(&id);
            return Err(e);
        }
        let result = rx.recv_timeout(Duration::from_secs(timeout));
        self.pending.lock().map_err(err)?.remove(&id);
        result.map_err(|_| "Hermes 响应超时，已断开本次连接。历史保留，可重新连接。".to_string())?
    }
    fn stop(&self) {
        self.live.store(false, Ordering::SeqCst);
        #[cfg(windows)]
        {
            self.job.lock().unwrap().take();
        }
        let _ = self.child.lock().map(|mut c| {
            let _ = c.kill();
            let _ = c.wait();
        });
    }
}

// Own only the ACP child tree. Closing the job also reaps its MCP subprocesses.
#[cfg(windows)]
struct ProcessJob(isize);
#[cfg(windows)]
impl ProcessJob {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("无法创建 Hermes 进程组。".into());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(job, child.as_raw_handle()) == 0
            {
                CloseHandle(job);
                return Err("无法管理 Hermes 子进程，请重新启动 Inky。".into());
            }
            Ok(Self(job as isize))
        }
    }
}
#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}
pub fn shutdown(app: &AppHandle) {
    if let Some(rt) = app.try_state::<Runtime>() {
        if let Ok(p) = rt.process.lock() {
            if let Some(p) = p.as_ref() {
                p.stop();
            }
        }
    }
}
fn spawn(app: &AppHandle, rt: &Runtime) -> Result<Arc<Acp>, String> {
    let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default());
    let hermes = std::env::var_os("INKY_PAPER_HERMES_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            [
                home.join("Documents/hermes/venv/Scripts/python.exe"),
                home.join(".hermes/hermes-agent/venv/Scripts/python.exe"),
            ]
            .into_iter()
            .find(|p| p.is_file())
            .unwrap_or_else(|| home.join("Documents/hermes/venv/Scripts/python.exe"))
        });
    if !hermes.is_file() {
        return Err("未找到 Hermes。请先安装 Hermes 并配置模型，再发送消息。".into());
    }
    let mut cmd = Command::new(hermes);
    cmd.arg(&rt.host)
        .current_dir(&rt.dir)
        .env("HERMES_ACP_SKIP_CONFIGURED_MCP", "1")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("INKY_PAPER_CONNECTION_FILE", &rt.bridge)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|_| "无法启动 Hermes ACP，请检查 Hermes 安装。".to_string())?;
    #[cfg(windows)]
    let job = ProcessJob::attach(&child).inspect_err(|_| {
        let _ = child.kill();
        let _ = child.wait();
    })?;
    let input = child.stdin.take().ok_or("Hermes stdin 不可用")?;
    let output = child.stdout.take().ok_or("Hermes stdout 不可用")?;
    let acp = Arc::new(Acp {
        child: Mutex::new(child),
        #[cfg(windows)]
        job: Mutex::new(Some(job)),
        input: Mutex::new(input),
        pending: Mutex::new(HashMap::new()),
        next: AtomicU64::new(1),
        live: AtomicBool::new(true),
        active: Mutex::new(None),
        loaded: Mutex::new(HashSet::new()),
        permissions: Mutex::new(HashMap::new()),
    });
    let reader = acp.clone();
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut output = BufReader::new(output);
        loop {
            let mut line = String::new();
            match output.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                _ => {}
            }
            if line.len() > 8 * 1024 * 1024 {
                break;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if v["method"] == "session/update" {
                if let Ok(mut active) = reader.active.lock() {
                    if let Some(turn) = active.as_mut() {
                        if v["params"]["sessionId"] == turn.session {
                            let update = &v["params"]["update"];
                            if update["sessionUpdate"] == "agent_message_chunk" {
                                if let Some(text) = update["content"]["text"].as_str() {
                                    turn.text.push_str(text);
                                    let now = chrono::Utc::now().timestamp_millis();
                                    if now - turn.last_saved >= 1000 {
                                        if let Ok(c) = history_db(&handle.state::<Runtime>()) {
                                            let _ = c.execute(
                                                "UPDATE messages SET body=?1 WHERE id=?2",
                                                params![
                                                    turn.text,
                                                    format!("{}-answer", turn.request)
                                                ],
                                            );
                                        }
                                        turn.last_saved = now;
                                    }
                                }
                            }
                            // Thought content stays private; the UI receives visible answers/tool status only.
                            if matches!(
                                update["sessionUpdate"].as_str(),
                                Some("agent_message_chunk" | "tool_call" | "tool_call_update")
                            ) {
                                let _=handle.emit("workbench:chat",json!({"requestId":turn.request,"sessionId":turn.session,"update":update}));
                            }
                        }
                    }
                }
            } else if v["method"] == "session/request_permission" && !v["id"].is_null() {
                let key = v["id"].to_string();
                reader
                    .permissions
                    .lock()
                    .unwrap()
                    .insert(key.clone(), v.clone());
                let _ = handle.emit(
                    "workbench:permission",
                    json!({"key":key,"params":v["params"]}),
                );
            } else if v["method"].is_string() && !v["id"].is_null() {
                let _=reader.write(json!({"jsonrpc":"2.0","id":v["id"],"error":{"code":-32601,"message":"Client capability unavailable"}}));
            } else if let Some(id) = v["id"].as_u64() {
                if let Some(tx) = reader.pending.lock().unwrap().remove(&id) {
                    let reply = if v.get("error").is_some() {
                        Err(format!(
                            "Hermes: {}",
                            v["error"]["message"].as_str().unwrap_or("请求失败")
                        ))
                    } else {
                        Ok(v["result"].clone())
                    };
                    let _ = tx.send(reply);
                }
            }
        }
        reader.live.store(false, Ordering::SeqCst);
        for (_, tx) in reader.pending.lock().unwrap().drain() {
            let _ = tx.send(Err("Hermes 连接已断开，当前对话已保留。".into()));
        }
    });
    Ok(acp)
}
fn connect(app: &AppHandle, rt: &Runtime) -> Result<Arc<Acp>, String> {
    let mut process = rt.process.lock().map_err(err)?;
    if let Some(p) = process.as_ref() {
        if p.live.load(Ordering::SeqCst) {
            return Ok(p.clone());
        }
    }
    let p = spawn(app, rt)?;
    *process = Some(p.clone());
    drop(process);
    if let Err(e)=p.rpc("initialize",json!({"protocolVersion":1,"clientInfo":{"name":"inky-workbench","version":env!("CARGO_PKG_VERSION")},"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}),90){p.stop();return Err(e);}
    Ok(p)
}
#[tauri::command]
pub fn workbench_permission(
    app: AppHandle,
    key: String,
    option_id: Option<String>,
) -> Result<(), String> {
    let rt = app.state::<Runtime>();
    let p = rt
        .process
        .lock()
        .map_err(err)?
        .as_ref()
        .cloned()
        .ok_or("Hermes 已断开")?;
    let mut permissions = p.permissions.lock().map_err(err)?;
    let req = permissions.get(&key).ok_or("此请求已结束")?;
    if let Some(id) = option_id.as_ref() {
        if !req["params"]["options"]
            .as_array()
            .is_some_and(|o| o.iter().any(|x| x["optionId"] == *id))
        {
            return Err("INVALID_INPUT: permission option".into());
        }
    }
    let outcome = option_id
        .map(|id| json!({"outcome":"selected","optionId":id}))
        .unwrap_or(json!({"outcome":"cancelled"}));
    p.write(json!({"jsonrpc":"2.0","id":req["id"],"result":{"outcome":outcome}}))?;
    permissions.remove(&key);
    Ok(())
}
#[tauri::command]
pub fn workbench_cancel(app: AppHandle) -> Result<(), String> {
    let rt = app.state::<Runtime>();
    rt.cancelled.store(true, Ordering::SeqCst);
    let p = rt.process.lock().map_err(err)?.as_ref().cloned();
    if let Some(p) = p {
        let request = {
            let active = p.active.lock().map_err(err)?;
            if let Some(turn) = active.as_ref() {
                p.write(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":turn.session}}))?;
                Some(turn.request.clone())
            } else {
                None
            }
        };
        for (_, req) in p.permissions.lock().map_err(err)?.drain() {
            let _=p.write(json!({"jsonrpc":"2.0","id":req["id"],"result":{"outcome":{"outcome":"cancelled"}}}));
        }
        if let Some(request) = request {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                let unchanged = p
                    .active
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|x| x.request == request);
                if unchanged {
                    p.stop();
                }
            });
        } else {
            p.stop();
        }
    }
    Ok(())
}
fn send(
    app: AppHandle,
    request_id: String,
    session_id: Option<String>,
    message: String,
    context: Value,
) -> Reply {
    let rt = app.state::<Runtime>();
    if message.trim().is_empty() || message.chars().count() > 16000 {
        return Err("请输入 1–16000 字的消息。".into());
    }
    uuid::Uuid::parse_str(&request_id).map_err(|_| "INVALID_INPUT: requestId")?;
    if rt.busy.swap(true, Ordering::SeqCst) {
        return Err("Coach 正在回复，请等待或停止当前回复。".into());
    }
    struct Guard<'a>(&'a AtomicBool);
    impl Drop for Guard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _guard = Guard(&rt.busy);
    rt.cancelled.store(false, Ordering::SeqCst);
    let p = connect(&app, &rt)?;
    if rt.cancelled.load(Ordering::SeqCst) {
        p.stop();
        return Err("已停止连接，消息草稿保留。".into());
    }
    let node = std::env::var_os("INKY_WORKBENCH_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:/Program Files".into()),
            )
            .join("nodejs/node.exe")
        });
    if !node.is_file() {
        return Err("未找到 Node.js，Paper 工具暂时无法连接。安装 Node.js 后重试。".into());
    }
    let mcp = json!([{"name":"inky_workbench","command":node.to_string_lossy(),"args":[rt.helper.to_string_lossy()],"env":[{"name":"INKY_PAPER_CONNECTION_FILE","value":rt.bridge.to_string_lossy()}]}]);
    let mut params = json!({"cwd":rt.dir.to_string_lossy(),"mcpServers":mcp});
    let new = session_id.is_none();
    let session = if let Some(sid) = session_id {
        let c = history_db(&rt)?;
        if c.query_row(
            "SELECT COUNT(*) FROM conversations WHERE id=?1",
            [&sid],
            |r| r.get::<_, i64>(0),
        )
        .map_err(err)?
            == 0
        {
            return Err("此对话不属于当前工作台。".into());
        }
        if !p.loaded.lock().map_err(err)?.contains(&sid) {
            params["sessionId"] = json!(sid);
            if let Err(e) = p.rpc("session/load", params, 120) {
                p.stop();
                return Err(e);
            }
        }
        sid
    } else {
        let result = p
            .rpc("session/new", params, 120)
            .inspect_err(|_| p.stop())?;
        result["sessionId"]
            .as_str()
            .ok_or("Hermes 未返回会话标识")?
            .to_string()
    };
    p.loaded.lock().map_err(err)?.insert(session.clone());
    if rt.cancelled.load(Ordering::SeqCst) {
        p.stop();
        return Err("已停止连接，消息草稿保留。".into());
    }
    // Sample after connection/session loading, immediately before the request is saved.
    // Only identifiers and intent come from the UI; facts and dates come from Paper.
    let context = {
        let db = app.state::<crate::paper::PaperDb>();
        let c = db.0.lock().map_err(err)?;
        crate::workbench_context::build(&c, context, &message)?
    };
    let c = history_db(&rt)?;
    let now = chrono::Utc::now().timestamp_millis();
    c.execute("INSERT INTO conversations VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated",params![session,message.chars().take(28).collect::<String>(),now]).map_err(err)?;
    c.execute(
        "INSERT INTO messages VALUES(?1,?2,'user',?3,?4,'sent')",
        params![request_id, session, message, now],
    )
    .map_err(|_| "此次消息已发送，请在历史中查看。".to_string())?;
    let answer_id = format!("{request_id}-answer");
    c.execute(
        "INSERT INTO messages VALUES(?1,?2,'assistant','',?3,'sending')",
        params![answer_id, session, now + 1],
    )
    .map_err(err)?;
    c.execute(
        "INSERT INTO message_context(message_id,context) VALUES(?1,?3),(?2,?3)",
        params![request_id, answer_id, context.to_string()],
    )
    .map_err(err)?;
    *p.active.lock().map_err(err)? = Some(Turn {
        request: request_id.clone(),
        session: session.clone(),
        text: String::new(),
        last_saved: now,
    });
    let _ = app.emit(
        "workbench:chat",
        json!({"requestId":request_id,"sessionId":session,"context":context,"update":{"sessionUpdate":"connected"}}),
    );
    let rules = include_str!("../../integrations/inky-coach-hermes-plugin/skills/coach/SKILL.md");
    let intro = if new {
        format!("你在 Inky 工作台中担任按需工作 Coach。遵循以下工作流程：\n{rules}\n工作台已支持 ::inky-plan 卡片显示、编辑、选择和采用；无需 Hermes 桌面控件。你只可使用 inky_paper 工具与必要的 skill_view，不读取其它项目或旧 Inky。所有事实以工具最新返回为准。\n")
    } else {
        String::new()
    };
    let prompt = format!(
        "{intro}本次请求快照（由 Paper 刚读取；不能沿用旧聊天的日期、任务或版本）：{context}\n按 resolvedIntent 回应：plan 帮助取舍和安排，stuck 先找缺信息、外部依赖、范围过大或明确自报状态，review 依据记录回顾，auto 按当前原话理解。信息足够直接建议，只问会改变结果的缺失信息；简单事项不强拆。temporaryConstraints 只对本次请求有效，不能从计时或空白补造精力。若 truncated 标记为真或需要扩大范围，再用工具读取。\n除非用户明确指定另一日期，计划采用日期使用此处 date。生成候选时在 directive 中写明日期，例如 ::inky-plan{{batchId=\"返回的真实 UUID\" date=\"YYYY-MM-DD\"}}；日期使用确切日历日期。不要把今天等同于当前查看日期。\n用户消息：\n{message}"
    );
    let result = p.rpc(
        "session/prompt",
        json!({"sessionId":session,"prompt":[{"type":"text","text":prompt}]}),
        600,
    );
    if result.is_err() {
        p.stop();
    }
    let turn = p.active.lock().map_err(err)?.take();
    let text = turn.map(|x| x.text).unwrap_or_default();
    let status = if rt.cancelled.load(Ordering::SeqCst) {
        "interrupted"
    } else if result.is_err() {
        "error"
    } else if result
        .as_ref()
        .ok()
        .is_some_and(|x| x["stopReason"] == "cancelled")
    {
        "interrupted"
    } else {
        "done"
    };
    let text = if text.is_empty() {
        if status == "interrupted" {
            "已停止回复。".into()
        } else {
            result.as_ref().err().cloned().unwrap_or_else(|| {
                if status == "interrupted" {
                    "已停止回复。".into()
                } else {
                    "Hermes 未返回可显示的文本。可以继续补充问题。".into()
                }
            })
        }
    } else {
        text
    };
    c.execute(
        "UPDATE messages SET body=?1,status=?2 WHERE id=?3",
        params![text, status, answer_id],
    )
    .map_err(err)?;
    p.permissions.lock().map_err(err)?.clear();
    let error = if status == "interrupted" {
        None
    } else {
        result.err()
    };
    let response = json!({"sessionId":session,"requestId":request_id,"message":{"id":answer_id,"role":"assistant","text":text,"status":status,"created":now+1,"context":context},"error":error});
    let _ = app.emit("workbench:finished", response.clone());
    Ok(response)
}
#[tauri::command]
pub async fn workbench_send(
    app: AppHandle,
    request_id: String,
    session_id: Option<String>,
    message: String,
    context: Value,
) -> Reply {
    tauri::async_runtime::spawn_blocking(move || {
        send(app, request_id, session_id, message, context)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_keeps_request_scope_after_reopen_without_guessing_legacy_dates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite3");
        let scope = json!({"date":"2030-03-04","selectedTaskId":"task","stepText":"核对日期"});
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch("CREATE TABLE messages(id TEXT PRIMARY KEY,session TEXT NOT NULL,role TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,status TEXT NOT NULL); INSERT INTO messages VALUES('old','session','assistant','legacy',1,'done');").unwrap();
            init_history(&c).unwrap();
            c.execute(
                "INSERT INTO messages VALUES('new','session','assistant','suggestion',2,'done')",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO message_context VALUES('new',?1)",
                [scope.to_string()],
            )
            .unwrap();
        }
        let c = Connection::open(&path).unwrap();
        init_history(&c).unwrap();
        let messages = history_messages(&c, "session").unwrap();
        assert_eq!(messages.len(), 2);
        assert!(messages[0]["context"].is_null());
        assert_eq!(messages[1]["context"], scope);
    }

    fn call(c: &mut Connection, action: &str, mut input: Value) -> Value {
        if !action.starts_with("get_") {
            input["requestId"] = json!(uuid::Uuid::new_v4().to_string());
        }
        crate::paper::execute(c, action, input, "user").unwrap().0
    }

    #[test]
    fn choosing_next_step_does_not_start_a_clock_and_rejects_switching_during_a_session() {
        let mut c = crate::paper::open(Path::new(":memory:")).unwrap();
        let task = call(&mut c, "create_task", json!({"taskId":uuid::Uuid::new_v4().to_string(),"title":"工作台验证","nextAction":"核对日期"}))["task"].clone();
        let current = call(&mut c, "get_state", json!({}));
        let step = &current["state"]["planning"]["steps"][0];
        let input = json!({"requestId":uuid::Uuid::new_v4().to_string(),"taskId":task["id"],"stepId":step["id"],"expectedRevision":task["revision"],"expectedStepRevision":step["revision"]});
        let selected = prepare_step(&mut c, input.clone(), None).unwrap();
        assert_eq!(selected["stepId"], step["id"]);
        assert_eq!(
            call(&mut c, "get_state", json!({}))["state"]["sessions"],
            json!([])
        );
        call(
            &mut c,
            "start_session",
            json!({"taskId":task["id"],"expectedRevision":task["revision"],"kind":"focus","plannedSeconds":900}),
        );
        let before = call(&mut c, "get_state", json!({}))["state"].clone();
        assert!(prepare_step(&mut c, input, None)
            .unwrap_err()
            .contains("本轮番茄钟还未结束"));
        let after = call(&mut c, "get_state", json!({}))["state"].clone();
        assert_eq!(before["tasks"], after["tasks"]);
        assert_eq!(before["sessions"], after["sessions"]);
    }
}
