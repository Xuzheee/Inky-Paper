use serde::Serialize;
use std::{
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "paper-notice";
const WIDTH: f64 = 300.0;
const HEIGHT: f64 = 156.0;
const LIFETIME: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Notice {
    id: String,
    message: String,
}

#[derive(Default)]
struct NoticeState {
    current: Option<Notice>,
    generation: u64,
    shown_generation: Option<u64>,
    ready: bool,
}

impl NoticeState {
    fn replace(&mut self, id: String, message: String) -> Result<(), String> {
        if id.trim().is_empty() || id.chars().count() > 128 {
            return Err("提醒标识必须为 1–128 个字符".into());
        }
        let message = message.trim().to_owned();
        if message.is_empty() || message.chars().count() > 800 {
            return Err("提醒内容必须为 1–800 个字符".into());
        }
        self.generation = self.generation.wrapping_add(1);
        self.current = Some(Notice { id, message });
        self.shown_generation = None;
        Ok(())
    }

    fn matches(&self, id: &str, generation: Option<u64>) -> bool {
        self.current.as_ref().is_some_and(|notice| notice.id == id)
            && generation.is_none_or(|value| self.generation == value)
    }

    fn clear(&mut self) {
        self.current = None;
        self.shown_generation = None;
    }
}

#[derive(Default)]
struct NoticeRuntime(Mutex<NoticeState>);

// All state and window operations run on the native UI thread. Besides ordering
// show/close/expiry, this avoids holding a mutex while another thread waits for a
// window getter whose UI callback would itself need the same mutex.
async fn on_main_thread<T: Send + 'static>(
    app: tauri::AppHandle,
    operation: impl FnOnce(&tauri::AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let target = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(operation(&target));
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?
}

// Use the same native visibility path for show and hide: ShowWindow does not
// update Tao's initial hidden-state cache, so WebviewWindow::hide can be a no-op.
fn hide_window(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindowVisible, ShowWindow, SW_HIDE};
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            ShowWindow(hwnd.0, SW_HIDE);
            if IsWindowVisible(hwnd.0) != 0 {
                return Err("提醒窗口未能关闭".into());
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    window.hide().map_err(|error| error.to_string())
}

fn show_without_activation(window: &WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IsWindowVisible, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
            SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            ShowWindow(hwnd.0, SW_SHOWNOACTIVATE);
            SetWindowPos(
                hwnd.0,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
            );
            if IsWindowVisible(hwnd.0) == 0 {
                return Err("提醒窗口未能显示".into());
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    window.show().map_err(|error| error.to_string())
}

fn adjacent_position(
    main: PhysicalPosition<i32>,
    main_width: u32,
    extent: tauri::PhysicalSize<u32>,
    area: tauri::PhysicalRect<i32, u32>,
    gap: i32,
) -> PhysicalPosition<i32> {
    let right = i64::from(main.x) + i64::from(main_width) + i64::from(gap);
    let end = i64::from(area.position.x) + i64::from(area.size.width);
    let preferred = if right + i64::from(extent.width) <= end {
        right
    } else {
        i64::from(main.x) - i64::from(extent.width) - i64::from(gap)
    };
    let x = preferred.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    PhysicalPosition::new(
        crate::clamp_axis(x, extent.width, area.position.x, area.size.width),
        crate::clamp_axis(main.y, extent.height, area.position.y, area.size.height),
    )
}

fn position_window(app: &tauri::AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不可用".to_owned())?;
    let monitor = main
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(app.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or_else(|| "显示器不可用".to_owned())?;
    let scale = monitor.scale_factor();
    let position = adjacent_position(
        main.outer_position().map_err(|error| error.to_string())?,
        main.outer_size().map_err(|error| error.to_string())?.width,
        tauri::PhysicalSize::new(
            (WIDTH * scale).ceil() as u32,
            (HEIGHT * scale).ceil() as u32,
        ),
        *monitor.work_area(),
        (12.0 * scale).round() as i32,
    );
    window
        .set_position(position)
        .map_err(|error| error.to_string())
}

// The caller keeps the state locked through native visibility changes. A stale
// timer therefore cannot hide a newer notice between checking its id and hiding.
fn show_pending(app: &tauri::AppHandle, state: &mut NoticeState) -> Result<(), String> {
    if !state.ready || state.shown_generation == Some(state.generation) {
        return Ok(());
    }
    let Some(notice) = state.current.clone() else {
        return Ok(());
    };
    let window = app
        .get_webview_window(LABEL)
        .ok_or_else(|| "提醒窗口不可用".to_owned())?;
    position_window(app, &window)?;
    window
        .emit("paper:notice", Some(&notice))
        .map_err(|error| error.to_string())?;
    show_without_activation(&window)?;
    let generation = state.generation;
    state.shown_generation = Some(generation);
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(LIFETIME);
        let target = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = dismiss(&target, &notice.id, Some(generation)) {
                eprintln!("Paper notice expiry failed: {error}");
            }
        });
    });
    Ok(())
}

fn dismiss(app: &tauri::AppHandle, id: &str, generation: Option<u64>) -> Result<(), String> {
    let runtime = app.state::<NoticeRuntime>();
    let mut state = runtime.0.lock().map_err(|error| error.to_string())?;
    if !state.matches(id, generation) {
        return Ok(());
    }
    let window = app
        .get_webview_window(LABEL)
        .ok_or_else(|| "提醒窗口不可用".to_owned())?;
    hide_window(&window)?;
    state.clear();
    window
        .emit("paper:notice", Option::<Notice>::None)
        .map_err(|error| error.to_string())
}

pub fn start(app: tauri::AppHandle) -> Result<(), String> {
    app.manage(NoticeRuntime::default());
    let window = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App("index.html?paperNotice=1".into()),
    )
    .title("Inky Paper · 提醒")
    .inner_size(WIDTH, HEIGHT)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .on_page_load(|window, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Started {
            let runtime = window.state::<NoticeRuntime>();
            if let Ok(mut state) = runtime.0.lock() {
                state.ready = false;
            };
        }
    })
    .build()
    .map_err(|error| error.to_string())?;
    let close_app = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let runtime = close_app.state::<NoticeRuntime>();
            if let Ok(mut state) = runtime.0.lock() {
                if let Some(window) = close_app.get_webview_window(LABEL) {
                    if hide_window(&window).is_ok() {
                        state.clear();
                        let _ = window.emit("paper:notice", Option::<Notice>::None);
                    }
                }
            };
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn paper_show_notice(
    window: WebviewWindow,
    id: String,
    message: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只有主窗口可以发布操作提醒".into());
    }
    on_main_thread(window.app_handle().clone(), move |app| {
        let runtime = app.state::<NoticeRuntime>();
        let mut state = runtime.0.lock().map_err(|error| error.to_string())?;
        state.replace(id, message)?;
        show_pending(app, &mut state)
    })
    .await
}

#[tauri::command]
pub async fn paper_current_notice(window: WebviewWindow) -> Result<Option<Notice>, String> {
    if !matches!(window.label(), "main" | LABEL) {
        return Err("此窗口不能读取操作提醒".into());
    }
    let is_notice_window = window.label() == LABEL;
    on_main_thread(window.app_handle().clone(), move |app| {
        let runtime = app.state::<NoticeRuntime>();
        let mut state = runtime.0.lock().map_err(|error| error.to_string())?;
        // Called after the notice UI installs its event listener. Pending messages
        // survive slow WebView initialization; their eight seconds start at show.
        if is_notice_window {
            state.ready = true;
            show_pending(app, &mut state)?;
        }
        Ok(state.current.clone())
    })
    .await
}

#[tauri::command]
pub async fn paper_dismiss_notice(window: WebviewWindow, id: String) -> Result<(), String> {
    if !matches!(window.label(), "main" | LABEL) {
        return Err("此窗口不能关闭操作提醒".into());
    }
    on_main_thread(window.app_handle().clone(), move |app| {
        dismiss(app, &id, None)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_notice_replaces_the_previous_without_queuing() {
        let mut state = NoticeState::default();
        state.replace("first".into(), "已保存".into()).unwrap();
        let old_generation = state.generation;
        state.replace("second".into(), "已撤销".into()).unwrap();
        assert_eq!(state.current.as_ref().unwrap().message, "已撤销");
        assert!(!state.matches("first", None));
        assert!(!state.matches("first", Some(old_generation)));
        assert!(state.matches("second", None));
    }

    #[test]
    fn reused_id_cannot_be_expired_by_a_previous_timer() {
        let mut state = NoticeState::default();
        state.replace("same".into(), "第一条".into()).unwrap();
        let old_generation = state.generation;
        state.replace("same".into(), "第二条".into()).unwrap();
        assert!(!state.matches("same", Some(old_generation)));
        assert!(state.matches("same", Some(state.generation)));
    }

    #[test]
    fn bounds_count_characters_and_invalid_input_preserves_the_current_notice() {
        let mut state = NoticeState::default();
        state.replace("valid".into(), "好".repeat(800)).unwrap();
        assert!(state.replace("long".into(), "好".repeat(801)).is_err());
        assert!(state.replace("empty".into(), " \n ".into()).is_err());
        assert!(state.replace(" ".into(), "已保存".into()).is_err());
        assert!(state.replace("a".repeat(129), "已保存".into()).is_err());
        assert_eq!(state.current.as_ref().unwrap().id, "valid");
    }

    #[test]
    fn placement_prefers_the_right_then_left_and_clamps_to_work_area() {
        let area = tauri::PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: tauri::PhysicalSize::new(1200, 800),
        };
        let size = tauri::PhysicalSize::new(300, 156);
        assert_eq!(
            adjacent_position(PhysicalPosition::new(100, 80), 320, size, area, 12),
            PhysicalPosition::new(432, 80)
        );
        assert_eq!(
            adjacent_position(PhysicalPosition::new(880, 760), 320, size, area, 12),
            PhysicalPosition::new(568, 644)
        );
        let small = tauri::PhysicalRect {
            position: PhysicalPosition::new(-600, 0),
            size: tauri::PhysicalSize::new(600, 400),
        };
        assert_eq!(
            adjacent_position(PhysicalPosition::new(-500, -100), 320, size, small, 12),
            PhysicalPosition::new(-600, 0)
        );
    }
}
