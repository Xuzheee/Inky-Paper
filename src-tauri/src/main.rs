#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod coach;
mod coach_runtime;
mod notice_window;
mod paper;
mod paper_bridge;
mod paper_planning;
mod paper_markdown;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, LogicalSize, Manager, PhysicalPosition, Window,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const FULL_WIDTH: f64 = 320.0;
const FULL_HEIGHT: f64 = 520.0;
const FOCUS_WIDTH: f64 = 400.0;
const FOCUS_HEIGHT: f64 = 210.0;
const FOCUS_COMPLETE_WIDTH: f64 = 320.0;
const FOCUS_COMPLETE_HEIGHT: f64 = 482.0;
const MINI_WIDTH: f64 = 160.0;
const MINI_HEIGHT: f64 = 160.0;

fn window_dimensions(layout: &str) -> Option<(f64, f64)> {
    match layout {
        "full" => Some((FULL_WIDTH, FULL_HEIGHT)),
        "focus" => Some((FOCUS_WIDTH, FOCUS_HEIGHT)),
        "focus-complete" => Some((FOCUS_COMPLETE_WIDTH, FOCUS_COMPLETE_HEIGHT)),
        "rest" => Some((320.0, 442.0)),
        "mini" => Some((MINI_WIDTH, MINI_HEIGHT)),
        "paused" => Some((FOCUS_WIDTH, 304.0)),
        "focus-note" => Some((FOCUS_WIDTH, 398.0)),
        "receipt" => Some((320.0, 280.0)),
        "celebration" => Some((320.0, 420.0)),
        _ => None,
    }
}

fn toggle_window_visibility(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_window_layout(window: Window, layout: String) -> Result<(), String> {
    let (width, height) =
        window_dimensions(&layout).ok_or_else(|| format!("unsupported window layout: {layout}"))?;
    let size = LogicalSize::new(width, height);

    window.set_size(size).map_err(|error| error.to_string())?;
    if let Some(monitor) = window
        .current_monitor()
        .map_err(|error| error.to_string())?
    {
        let area = monitor.work_area();
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let position = window.outer_position().map_err(|error| error.to_string())?;
        let x = clamp_axis(
            position.x,
            (width * scale).ceil() as u32,
            area.position.x,
            area.size.width,
        );
        let y = clamp_axis(
            position.y,
            (height * scale).ceil() as u32,
            area.position.y,
            area.size.height,
        );
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn clamp_axis(position: i32, extent: u32, start: i32, available: u32) -> i32 {
    let last = (i64::from(start) + i64::from(available) - i64::from(extent)).max(i64::from(start));
    i64::from(position)
        .clamp(i64::from(start), last)
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[cfg(test)]
mod layout_tests {
    use super::clamp_axis;
    #[test]
    fn expansion_stays_inside_work_area_including_negative_monitors() {
        assert_eq!(clamp_axis(950, 780, 0, 1040), 260);
        assert_eq!(clamp_axis(-160, 480, -1920, 1920), -480);
        assert_eq!(clamp_axis(-2200, 480, -1920, 1920), -1920);
        assert_eq!(clamp_axis(50, 780, 0, 600), 0);
        assert_eq!(clamp_axis(200, 480, 0, 1920), 200);
    }
}

#[tauri::command]
fn move_window_by(window: Window, delta_x: f64, delta_y: f64) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let next_position = PhysicalPosition::new(
        position
            .x
            .saturating_add((delta_x * scale_factor).round() as i32),
        position
            .y
            .saturating_add((delta_y * scale_factor).round() as i32),
    );

    window
        .set_position(next_position)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_system_idle_ms() -> Result<u64, String> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut last_input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };

    let success = unsafe { GetLastInputInfo(&mut last_input) };

    if success == 0 {
        return Err("GetLastInputInfo failed".to_string());
    }

    let now = unsafe { GetTickCount() };
    Ok(now.wrapping_sub(last_input.dwTime) as u64)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_system_idle_ms() -> Result<u64, String> {
    Err("system idle is only supported on Windows".to_string())
}

fn main() {
    let toggle_shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyF);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle_shortcut && event.state() == ShortcutState::Pressed {
                        toggle_window_visibility(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();
            let app_data_dir = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let app_data_dir = std::env::var_os("INKY_PAPER_TEST_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app_data_dir);
            std::fs::create_dir_all(&app_data_dir)?;
            let connection =
                paper::open(&app_data_dir.join("paper.sqlite3")).map_err(std::io::Error::other)?;
            let _ = paper_markdown::sync(&connection, true);
            app.manage(paper::PaperDb(std::sync::Mutex::new(connection)));
            let bridge_status =
                paper_bridge::start(handle.clone(), &app_data_dir).unwrap_or_else(|error| {
                    eprintln!("Agent bridge unavailable: {error}");
                    paper_bridge::BridgeStatus {
                        available: false,
                        connection_file: String::new(),
                    }
                });
            app.manage(bridge_status);
            coach_runtime::start(handle.clone(), &app_data_dir).map_err(std::io::Error::other)?;
            notice_window::start(handle.clone()).map_err(std::io::Error::other)?;

            let show_hide =
                MenuItem::with_id(&handle, "show_hide", "显示/隐藏", true, None::<&str>)?;
            let quit = MenuItem::with_id(&handle, "quit", "退出 Inky Paper", true, None::<&str>)?;
            let menu = Menu::with_items(&handle, &[&show_hide, &quit])?;

            let tray_result = TrayIconBuilder::with_id("inky-paper")
                .tooltip("Inky Paper")
                .icon(
                    handle
                        .default_window_icon()
                        .expect("bundled application icon")
                        .clone(),
                )
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show_hide" => toggle_window_visibility(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app);

            if let Err(error) = tray_result {
                eprintln!("failed to create tray icon: {error}");
            }

            if let Err(error) = app.global_shortcut().register(toggle_shortcut) {
                eprintln!("failed to register Alt+Shift+F: {error}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            paper::paper_execute,
            paper_bridge::get_paper_bridge_status,
            paper_markdown::open_work_journal,
            get_system_idle_ms,
            set_window_layout,
            move_window_by,
            quit_app,
            coach_runtime::request_coaching,
            coach_runtime::coach_show_main,
            coach_runtime::coach_hide_prompt,
            notice_window::paper_show_notice,
            notice_window::paper_current_notice,
            notice_window::paper_dismiss_notice,
        ])
        .run(tauri::generate_context!())
        .expect("error while running focusflow");
}
