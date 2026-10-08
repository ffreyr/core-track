//! Native shell for the Core-Track desktop app.
//!
//! The application logic lives in the React frontend, which talks to the
//! FastAPI backend over HTTP. The Rust side manages windows and the macOS
//! menu-bar presence:
//!
//! * **Main window** (`main`): the full app. Closing it only *hides* it, so
//!   Core-Track keeps running in the menu bar; clicking the Dock icon or the
//!   tray menu brings it back. "Quit" in the tray menu really quits.
//! * **Desktop widget** (`widget`): a small frameless, transparent window
//!   (declared in `tauri.conf.json`) showing today's tasks and the month's
//!   remaining budget. It sits below normal windows like a desktop widget
//!   and is toggled from the tray.
//! * **Tray icon**: a monochrome template image in the menu bar.
//!   Left-click toggles the widget; right-click (or Control-click) opens the
//!   menu with *Show Main Window*, *Toggle Desktop Widget* and *Quit*.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent,
};

/// Label of the main application window (see `tauri.conf.json`).
const MAIN_WINDOW: &str = "main";
/// Label of the desktop widget window (see `tauri.conf.json`).
const WIDGET_WINDOW: &str = "widget";

/// Gap between the widget and the screen edges, in logical points.
const WIDGET_MARGIN: f64 = 20.0;

/// The widget is auto-positioned only the first time it is shown; after
/// that it stays wherever the user dragged it.
static WIDGET_PLACED: AtomicBool = AtomicBool::new(false);

/// Show, un-minimise and focus the main window.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Move the widget to the top-right corner of its monitor's usable area
/// (excluding the menu bar and Dock).
fn place_widget(widget: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = widget.current_monitor()?.or(widget.primary_monitor()?) else {
        return Ok(());
    };
    let area = monitor.work_area();
    let margin = (WIDGET_MARGIN * monitor.scale_factor()).round() as i32;
    let size = widget.outer_size()?;
    let x = area.position.x + area.size.width as i32 - size.width as i32 - margin;
    let y = area.position.y + margin;
    widget.set_position(PhysicalPosition::new(x, y))
}

/// Show the widget if hidden, hide it if visible.
fn toggle_widget(app: &AppHandle) -> tauri::Result<()> {
    let Some(widget) = app.get_webview_window(WIDGET_WINDOW) else {
        return Ok(());
    };
    if widget.is_visible()? {
        widget.hide()
    } else {
        if !WIDGET_PLACED.swap(true, Ordering::SeqCst) {
            place_widget(&widget)?;
        }
        widget.show()
    }
}

/// Build the menu-bar icon, its menu, and the click handlers.
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show_main", "Show Main Window", true, None::<&str>)?;
    let widget = MenuItem::with_id(app, "toggle_widget", "Toggle Desktop Widget", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Core-Track", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&show, &widget, &separator, &quit])?;

    TrayIconBuilder::with_id("core-track")
        // Black-on-transparent glyph; as a template image macOS tints it
        // to match light/dark menu bars automatically.
        .icon(tauri::include_image!("./icons/tray-template.png"))
        .icon_as_template(true)
        .tooltip("Core-Track")
        .menu(&menu)
        // Left-click is reserved for toggling the widget; the menu opens on
        // right-click (or Control-click).
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_main" => show_main_window(app),
            "toggle_widget" => {
                let _ = toggle_widget(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_widget(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Command used by the widget's "Open Core-Track" button.
#[tauri::command]
fn open_main_window(app: AppHandle) {
    show_main_window(&app);
}

/// Build and run the Tauri application.
///
/// `mobile_entry_point` lets the same function serve as the entry point if the
/// project is ever built for iOS/Android through Tauri.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_main_window])
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it; the app keeps running in the
            // menu bar so the widget and tray stay available.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the Core-Track application");

    app.run(|app, event| {
        // Clicking the Dock icon while the main window is hidden reopens it.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            show_main_window(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
