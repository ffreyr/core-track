//! Native shell for the Core-Track desktop app.
//!
//! The application logic lives entirely in the React frontend, which talks to
//! the FastAPI backend over HTTP. The Rust side only needs to create the
//! window, so no custom commands or plugins are registered (yet).

/// Build and run the Tauri application.
///
/// `mobile_entry_point` lets the same function serve as the entry point if the
/// project is ever built for iOS/Android through Tauri.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Core-Track application");
}
