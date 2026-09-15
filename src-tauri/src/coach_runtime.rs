use crate::{
    coach,
    paper::{self, PaperDb, PaperState},
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub struct Runtime {
    pub helper: PathBuf,
    pub running: Arc<AtomicBool>,
}
fn run(app: &tauri::AppHandle, action: &str, input: Value, source: &str) -> Result<Value, String> {
    let db = app.state::<PaperDb>();
    let mut c = db.0.lock().map_err(|e| e.to_string())?;
    let (v, changed) = if action == "runtime_tick" {
        paper::runtime_tick(&mut c, activity)?
    } else {
        paper::execute(&mut c, action, input, source)?
    };
    if changed {
        let _ = app.emit("paper:changed", ());
    }
    Ok(v)
}
#[cfg(windows)]
fn activity() -> Option<Value> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId},
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut title = [0u16; 501];
        let n = GetWindowTextW(hwnd, title.as_mut_ptr(), 501);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut path = [0u16; 1024];
        let mut size = 1024;
        let ok = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut size);
        CloseHandle(process);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&path[..size as usize]);
        let app = path.rsplit(['\\', '/']).next().unwrap_or("unknown");
        Some(
            json!({"app":app,"title":String::from_utf16_lossy(&title[..n.max(0) as usize]),"idleMs":crate::get_system_idle_ms().ok()?}),
        )
    }
}
#[cfg(not(windows))]
fn activity() -> Option<Value> {
    None
}

// Windows prompts are shown with SW_SHOWNOACTIVATE to preserve the foreground app.
// Match that native path when hiding: Tao still caches the initial hidden state.
fn hide_prompt_window(w: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = w.hwnd().map_err(|e| e.to_string())?;
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                IsWindowVisible, ShowWindow, SW_HIDE,
            };
            ShowWindow(hwnd.0, SW_HIDE);
            if IsWindowVisible(hwnd.0) != 0 {
                return Err("工作提示窗口未能关闭".into());
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    w.hide().map_err(|e| e.to_string())
}

pub fn start(app: tauri::AppHandle, dir: &std::path::Path) -> Result<(), String> {
    let helper = dir.join("paper-coach-helper.py");
    std::fs::write(&helper, include_str!("../../integrations/paper-coach.py"))
        .map_err(|e| e.to_string())?;
    app.manage(Runtime {
        helper,
        running: Arc::new(AtomicBool::new(false)),
    });
    WebviewWindowBuilder::new(
        &app,
        "coach-prompt",
        WebviewUrl::App("index.html?coachPrompt=1".into()),
    )
    .title("Inky Paper · 工作提示")
    .inner_size(320., 220.)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;
    thread::spawn(move || {
        let mut visible_key = String::new();
        let mut displayed_at = Instant::now();
        loop {
            thread::sleep(Duration::from_secs(5));
            let Ok(value) = run(&app, "runtime_tick", json!({}), "system") else {
                continue;
            };
            let Ok(s) = serde_json::from_value::<PaperState>(value["state"].clone()) else {
                continue;
            };
            let p = value["prompt"].clone();
            let key = if p.is_null() {
                String::new()
            } else {
                format!(
                    "{}:{}:{}",
                    p["kind"],
                    p["block"]["id"],
                    p["episode"]["shownAt"]
                        .as_array()
                        .map(|x| x.len())
                        .unwrap_or(0)
                )
            };
            if !key.is_empty() && visible_key != key {
                if let Some(w) = app.get_webview_window("coach-prompt") {
                    if let Some(main) = app.get_webview_window("main") {
                        if let (Ok(pos), Ok(Some(mon))) =
                            (main.outer_position(), main.current_monitor())
                        {
                            let scale = mon.scale_factor();
                            let area = mon.work_area();
                            let x = crate::clamp_axis(
                                pos.x,
                                (320. * scale).ceil() as u32,
                                area.position.x,
                                area.size.width,
                            );
                            let y = crate::clamp_axis(
                                pos.y + 20,
                                (220. * scale).ceil() as u32,
                                area.position.y,
                                area.size.height,
                            );
                            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                        }
                    }
                    let _ = w.emit("coach:prompt", &p);
                    #[cfg(windows)]
                    unsafe {
                        if let Ok(hwnd) = w.hwnd() {
                            #[cfg(debug_assertions)]
                            let focus_before =
                                windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
                            windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                                hwnd.0,
                                windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
                            );
                            windows_sys::Win32::UI::WindowsAndMessaging::SetWindowPos(
                                hwnd.0,
                                windows_sys::Win32::UI::WindowsAndMessaging::HWND_TOPMOST,
                                0,
                                0,
                                0,
                                0,
                                windows_sys::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE
                                    | windows_sys::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
                                    | windows_sys::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
                                    | windows_sys::Win32::UI::WindowsAndMessaging::SWP_SHOWWINDOW,
                            );
                            #[cfg(debug_assertions)]
                            eprintln!(
                                "COACH_PROMPT_VERIFY {}",
                                json!({"visible":windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible(hwnd.0)!=0,"foregroundUnchanged":focus_before==windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow(),"kind":p["kind"]})
                            );
                        }
                    }
                    #[cfg(not(windows))]
                    let _ = w.show();
                    let _ = run(
                        &app,
                        "coach_prompt_shown",
                        json!({"requestId":uuid::Uuid::new_v4().to_string(),"blockId":p["block"]["id"],"episodeId":p["episode"]["id"]}),
                        "user",
                    );
                    visible_key = key;
                    displayed_at = Instant::now();
                }
            } else if !visible_key.is_empty() && displayed_at.elapsed() > Duration::from_secs(35) {
                if let Some(w) = app.get_webview_window("coach-prompt") {
                    let _ = hide_prompt_window(&w);
                }
                visible_key.clear();
            }
            // Do not display stale follow-ups after rest, waiting, expiry or manual response.
            if !visible_key.is_empty()
                && p.is_null()
                && displayed_at.elapsed() > Duration::from_secs(1)
            {
                // A shown prompt is no longer due, but remains actionable until its brief display expires.
                let cancelled = coach::current(&s).is_none_or(|b| b.status != "expired");
                if cancelled {
                    if let Some(w) = app.get_webview_window("coach-prompt") {
                        let _ = hide_prompt_window(&w);
                    }
                    visible_key.clear();
                }
            }
            // Background work only stores local facts and delivers clock expiry notices.
            // Model requests originate exclusively from request_coaching below.
        }
    });
    Ok(())
}
fn validate_request_kind(kind: &str) -> Result<(), String> {
    if !matches!(kind, "goal" | "step" | "recovery" | "pace") {
        return Err("INVALID_INPUT: coaching kind".into());
    }
    Ok(())
}
fn generate(app: &tauri::AppHandle, kind: &str, blocker: &str) -> Result<Value, String> {
    validate_request_kind(kind)?;
    let rt = app.state::<Runtime>();
    if rt.running.swap(true, Ordering::SeqCst) {
        return Err("HERMES_BUSY: 正在整理一个建议。".into());
    }
    struct Guard(Arc<AtomicBool>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _guard = Guard(rt.running.clone());
    let context = run(app, "get_coach_context", json!({}), "system")?;
    if context["block"]["status"].as_str() != Some("active") {
        return Err("NO_ACTIVE_WORK".into());
    }
    let _ = run(
        app,
        "coach_analysis_status",
        json!({"status":"正在请 Hermes 整理建议…","started":true}),
        "system",
    );
    let result = (|| {
        let python = std::env::var_os("INKY_PAPER_HERMES_PYTHON").unwrap_or_else(|| {
            let home = PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_default());
            [
                home.join(".hermes/hermes-agent/venv/Scripts/python.exe"),
                home.join("Documents/hermes/venv/Scripts/python.exe"),
            ]
            .into_iter()
            .find(|p| p.is_file())
            .map(|p| p.into_os_string())
            .unwrap_or_else(|| "python".into())
        });
        let mut command = Command::new(python);
        command
            .arg(&rt.helper)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| "HERMES_UNAVAILABLE: 找不到可运行 Hermes 的 Python。".to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(
                    json!({"kind":kind,"blocker":blocker,"context":context})
                        .to_string()
                        .as_bytes(),
                )
                .map_err(|e| e.to_string())?;
        }
        let start = Instant::now();
        loop {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                break;
            }
            if start.elapsed() > Duration::from_secs(90) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("HERMES_TIMEOUT: 本地工作与计时仍可继续。".into());
            }
            thread::sleep(Duration::from_millis(200));
        }
        let mut output = String::new();
        if let Some(stdout) = child.stdout.take() {
            stdout
                .take(16384)
                .read_to_string(&mut output)
                .map_err(|e| e.to_string())?;
        }
        let answer: Value = serde_json::from_str(output.trim())
            .map_err(|_| "HERMES_RESPONSE: 暂未得到可用建议。".to_string())?;
        if answer["ok"] != true {
            return Err(answer["error"]
                .as_str()
                .unwrap_or("HERMES_UNAVAILABLE")
                .to_string());
        }
        let result = &answer["result"];
        let proposal = json!({"requestId":uuid::Uuid::new_v4().to_string(),"blockId":context["block"]["id"],"taskId":context["task"]["id"],"expectedTaskRevision":context["task"]["revision"],"kind":kind,"text":result["text"],"reason":result["reason"]});
        run(app, "propose_coaching_action", proposal, "hermes")?;
        Ok(json!({"saved":true,"model":answer["model"]}))
    })();
    let status = if result.is_ok() {
        "Hermes 建议已保存，是否采用由你决定。"
    } else {
        "Hermes 暂不可用；本地工作、计时和记录仍可继续。"
    };
    let _ = run(
        app,
        "coach_analysis_status",
        json!({"status":status}),
        "system",
    );
    result
}
#[tauri::command]
pub async fn request_coaching(
    app: tauri::AppHandle,
    kind: String,
    blocker: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        generate(&app, &kind, blocker.as_deref().unwrap_or(""))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn coach_show_main(app: tauri::AppHandle, view: String) -> Result<(), String> {
    if let Some(p) = app.get_webview_window("coach-prompt") {
        hide_prompt_window(&p)?;
    }
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        w.emit("coach:navigate", view).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn coach_hide_prompt(app: tauri::AppHandle) -> Result<(), String> {
    let w = app
        .get_webview_window("coach-prompt")
        .ok_or("工作提示窗口不存在")?;
    hide_prompt_window(&w)
}

#[cfg(test)]
mod tests {
    use super::validate_request_kind;

    #[test]
    fn manual_coaching_kinds_remain_available_but_observation_cannot_call_a_model() {
        for kind in ["goal", "step", "recovery", "pace"] {
            assert!(validate_request_kind(kind).is_ok());
        }
        assert!(validate_request_kind("observe").is_err());
        assert!(validate_request_kind("").is_err());
    }
}
