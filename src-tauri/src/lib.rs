use std::io::{Read, Write};
use std::net::TcpListener;

use tauri::{AppHandle, Emitter};
use tauri_plugin_sql::{Migration, MigrationKind};

// OAuth Authorization Code 흐름의 콜백을 받기 위해 127.0.0.1:<port> 에 1회용 HTTP 서버를 연다.
// 첫 요청을 캡처해 "auth-callback" 이벤트로 프론트엔드에 전체 URL 을 전달한 뒤 종료한다.
#[tauri::command]
fn start_oauth_listener(port: u16, app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 8192];
            if let Ok(n) = stream.read(&mut buf) {
                let req = String::from_utf8_lossy(&buf[..n]);
                if let Some(line) = req.lines().next() {
                    if let Some(path) = line.split_whitespace().nth(1) {
                        let full_url = format!("http://127.0.0.1:{port}{path}");
                        let _ = app.emit("auth-callback", full_url);
                    }
                }
            }
            let body = "<!doctype html><html><head><meta charset='utf-8'><title>QuickNote</title></head><body style='font-family:sans-serif;padding:32px;text-align:center'><h2>로그인 완료</h2><p>이 창을 닫고 QuickNote 앱으로 돌아가세요.</p><script>setTimeout(()=>window.close(),300)</script></body></html>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_initial_tables",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![start_oauth_listener])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:quicknote.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
